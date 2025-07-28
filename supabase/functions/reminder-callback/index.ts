import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// Simple encryption/decryption functions
const ENCRYPTION_KEY = Deno.env.get('ENCRYPTION_KEY');

async function encrypt(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(ENCRYPTION_KEY),
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );
  
  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(encryptedText: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    const combined = new Uint8Array(
      atob(encryptedText).split('').map(char => char.charCodeAt(0))
    );
    
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(ENCRYPTION_KEY),
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encrypted
    );
    
    return decoder.decode(decrypted);
  } catch (error) {
    throw new Error('Decryption failed');
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }

  try {
    // Initialize Supabase client with service role key (no JWT verification)
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get URL parameters
    const url = new URL(req.url);
    const scheduleId = url.searchParams.get('schedule_id');
    const token = url.searchParams.get('token');

    if (!scheduleId || !token) {
      return new Response(`<!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>Invalid Request</h2>
          <p>Missing required parameters. Please use the link from your email.</p>
        </body>
        </html>`, {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html'
        }
      });
    }

    // Get the medicine schedule record
    const { data: scheduleData, error: fetchError } = await supabaseClient
      .from('medicine_schedule')
      .select('id, date, taken, prescription')
      .eq('id', scheduleId)
      .single();

    if (fetchError || !scheduleData) {
      console.error('Schedule fetch error:', fetchError);
      return new Response(`<!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>Schedule Not Found</h2>
          <p>The medication schedule could not be found. Please check your email link.</p>
          <p style="color: #666; font-size: 12px;">Schedule ID: ${scheduleId}</p>
        </body>
        </html>`, {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html'
        }
      });
    }

    // Get patient email using the exact query structure
    const { data: patientEmailData, error: emailError } = await supabaseClient.rpc('exec_sql', {
      sql: `
        SELECT au.email 
        FROM prescriptions pst 
        JOIN appointment apt ON pst.appointment_id = apt.appointment_id
        JOIN user_details ud ON apt.patient_id = ud.user_id
        JOIN auth.users au ON ud.user_id = au.id
        WHERE pst.prescription_id = $1
      `,
      params: [scheduleData.prescription]
    });

    // Alternative approach using regular Supabase queries if RPC doesn't work
    let patientEmail: string;
    
    if (emailError) {
      console.log('RPC failed, trying alternative approach:', emailError);
      // Get prescription first
      const { data: prescriptionData, error: prescError } = await supabaseClient
        .from('prescriptions')
        .select('prescription_id, appointment_id')
        .eq('prescription_id', scheduleData.prescription)
        .single();

      if (prescError || !prescriptionData) {
        console.error('Prescription error:', prescError);
        return new Response(`<!DOCTYPE html>
          <html>
          <head><title>Error</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>Prescription Not Found</h2>
            <p>Could not find prescription: ${scheduleData.prescription}</p>
          </body>
          </html>`, {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/html'
          }
        });
      }

      // Get appointment
      const { data: appointmentData, error: aptError } = await supabaseClient
        .from('appointment')
        .select('appointment_id, patient_id')
        .eq('appointment_id', prescriptionData.appointment_id)
        .single();

      if (aptError || !appointmentData) {
        console.error('Appointment error:', aptError);
        return new Response(`<!DOCTYPE html>
          <html>
          <head><title>Error</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>Appointment Not Found</h2>
            <p>Could not find appointment: ${prescriptionData.appointment_id}</p>
          </body>
          </html>`, {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/html'
          }
        });
      }

      // Get user details
      const { data: userDetailsData, error: udError } = await supabaseClient
        .from('user_details')
        .select('user_id')
        .eq('user_id', appointmentData.patient_id)
        .single();

      if (udError || !userDetailsData) {
        console.error('User details error:', udError);
        return new Response(`<!DOCTYPE html>
          <html>
          <head><title>Error</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>User Details Not Found</h2>
            <p>Could not find user: ${appointmentData.patient_id}</p>
          </body>
          </html>`, {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/html'
          }
        });
      }

      // Get user email from auth.users
      const { data: authUserData, error: authError } = await supabaseClient.auth.admin.getUserById(userDetailsData.user_id);

      if (authError || !authUserData.user || !authUserData.user.email) {
        console.error('Auth user error:', authError);
        return new Response(`<!DOCTYPE html>
          <html>
          <head><title>Error</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>User Email Not Found</h2>
            <p>Could not find email for user: ${userDetailsData.user_id}</p>
          </body>
          </html>`, {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/html'
          }
        });
      }

      patientEmail = authUserData.user.email;
    } else {
      // Use RPC result
      if (!patientEmailData || patientEmailData.length === 0 || !patientEmailData[0].email) {
        return new Response(`<!DOCTYPE html>
          <html>
          <head><title>Error</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>Patient Email Not Found</h2>
            <p>Could not retrieve patient email for verification.</p>
          </body>
          </html>`, {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/html'
          }
        });
      }
      patientEmail = patientEmailData[0].email;
    }

    // Decrypt and verify the token
    try {
      const tokenData = await decrypt(token);
      const expectedData = `${scheduleId}|${patientEmail}|${scheduleData.date}`;
      
      if (tokenData !== expectedData) {
        console.error('Token verification failed. Expected:', expectedData, 'Received:', tokenData);
        return new Response(`<!DOCTYPE html>
          <html>
          <head><title>Error</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>Invalid Token</h2>
            <p>This link is invalid or has expired. Please use the latest email link.</p>
          </body>
          </html>`, {
          status: 403,
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/html'
          }
        });
      }
    } catch (decryptError) {
      console.error('Token decryption failed:', decryptError);
      return new Response(`<!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>Invalid Token</h2>
          <p>This link is invalid or corrupted. Please use the latest email link.</p>
        </body>
        </html>`, {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html'
        }
      });
    }

    // Check if already taken
    if (scheduleData.taken) {
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Already Taken</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              text-align: center; 
              padding: 50px; 
              background-color: #f0f8ff;
            }
            .container { 
              max-width: 500px; 
              margin: 0 auto; 
              padding: 30px; 
              background: white; 
              border-radius: 10px; 
              box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            .success-icon { 
              font-size: 60px; 
              color: #4CAF50; 
              margin-bottom: 20px; 
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon"></div>
            <h2>Medicine Already Marked as Taken</h2>
            <p>This medication has already been marked as taken. No further action is needed.</p>
            <p><strong>Thank you for staying on top of your medication schedule!</strong></p>
            <p style="color: #666; font-size: 14px; margin-top: 30px;">
              Haivy Health - Your Healthcare Partner
            </p>
          </div>
        </body>
        </html>
      `, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html'
        }
      });
    }

    // Update the medicine schedule to mark as taken
    const { error: updateError } = await supabaseClient
      .from('medicine_schedule')
      .update({ taken: true })
      .eq('id', scheduleId);

    if (updateError) {
      console.error('Update error:', updateError);
      return new Response(`<!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>Update Failed</h2>
          <p>Failed to update your medication status. Please try again or contact support.</p>
        </body>
        </html>`, {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html'
        }
      });
    }

    // Return success page
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Medicine Taken Successfully</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background-color: #f0f8ff;
          }
          .container { 
            max-width: 500px; 
            margin: 0 auto; 
            padding: 30px; 
            background: white; 
            border-radius: 10px; 
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          }
          .success-icon { 
            font-size: 60px; 
            color: #4CAF50; 
            margin-bottom: 20px; 
          }
          .celebration { 
            animation: bounce 2s infinite; 
          }
          @keyframes bounce {
            0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
            40% { transform: translateY(-10px); }
            60% { transform: translateY(-5px); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon celebration"></div>
          <h2>Medicine Taken Successfully!</h2>
          <p>Your medication has been marked as taken. You will no longer receive reminder notifications for this dose.</p>
          <p><strong>Great job staying on track with your medication schedule!</strong></p>
          <p style="color: #666; font-size: 14px; margin-top: 30px;">
            Haivy Health - Your Healthcare Partner
          </p>
        </div>
      </body>
      </html>
    `, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html'
      }
    });

  } catch (error) {
    console.error('Function error:', error);
    return new Response(`<!DOCTYPE html>
      <html>
      <head><title>Error</title></head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2>Internal Error</h2>
        <p>Something went wrong. Please try again or contact support.</p>
        <p style="color: #666; font-size: 12px;">Error: ${error.message}</p>
      </body>
      </html>`, {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html'
      }
    });
  }
});