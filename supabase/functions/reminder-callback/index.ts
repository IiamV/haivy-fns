import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client with service role key (no JWT verification)
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get URL parameters
    const url = new URL(req.url)
    const scheduleId = url.searchParams.get('schedule_id')
    const token = url.searchParams.get('token')

    if (!scheduleId || !token) {
      return new Response(
        `<!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>Invalid Request</h2>
          <p>Missing required parameters. Please use the link from your email.</p>
        </body>
        </html>`,
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'text/html' } 
        }
      )
    }

    // Step 1: Get the medicine schedule
    const { data: scheduleData, error: scheduleError } = await supabaseClient
      .from('medicine_schedule')
      .select('id, date, taken, prescription')
      .eq('id', scheduleId)
      .single()

    if (scheduleError || !scheduleData) {
      console.error('Schedule error:', scheduleError)
      return new Response(
        `<!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>Schedule Not Found</h2>
          <p>Schedule ID: ${scheduleId}</p>
        </body>
        </html>`,
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/html' } }
      )
    }

    // Step 2: Get the prescription
    const { data: prescriptionData, error: prescriptionError } = await supabaseClient
      .from('prescriptions')
      .select('prescription_id, appointment_id')
      .eq('prescription_id', scheduleData.prescription)
      .single()

    if (prescriptionError || !prescriptionData) {
      console.error('Prescription error:', prescriptionError)
      return new Response(
        `<!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>Prescription Not Found</h2>
          <p>Could not find prescription: ${scheduleData.prescription}</p>
        </body>
        </html>`,
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/html' } }
      )
    }

    // Step 3: Get the appointment
    const { data: appointmentData, error: appointmentError } = await supabaseClient
      .from('appointment')
      .select('appointment_id, patient_id')
      .eq('appointment_id', prescriptionData.appointment_id)
      .single()

    if (appointmentError || !appointmentData) {
      console.error('Appointment error:', appointmentError)
      return new Response(
        `<!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>Appointment Not Found</h2>
          <p>Could not find appointment: ${prescriptionData.appointment_id}</p>
        </body>
        </html>`,
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/html' } }
      )
    }

    // Step 4: Get the patient user details
    const { data: userDetailsData, error: userDetailsError } = await supabaseClient
      .from('user_details')
      .select('user_id')
      .eq('user_id', appointmentData.patient_id)
      .single()

    if (userDetailsError || !userDetailsData) {
      console.error('User details error:', userDetailsError)
      return new Response(
        `<!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>User Details Not Found</h2>
          <p>Could not find user details for patient: ${appointmentData.patient_id}</p>
        </body>
        </html>`,
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/html' } }
      )
    }

    // Step 5: Get the patient email from auth.users
    const { data: authUserData, error: authUserError } = await supabaseClient
      .from('users')
      .select('email')
      .eq('id', userDetailsData.user_id)
      .single()

    if (authUserError || !authUserData || !authUserData.email) {
      console.error('Auth user error:', authUserError)
      return new Response(
        `<!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>User Email Not Found</h2>
          <p>Could not find email for user: ${userDetailsData.user_id}</p>
        </body>
        </html>`,
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/html' } }
      )
    }

    const patientEmail = authUserData.email

    // Verify the token
    const expectedToken = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(scheduleId + patientEmail + scheduleData.date)
    ).then(buffer => 
      Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
    )

    if (token !== expectedToken) {
      console.error('Token mismatch for email:', patientEmail)
      return new Response(
        `<!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>Invalid Token</h2>
          <p>This link is invalid or has expired.</p>
        </body>
        </html>`,
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'text/html' } }
      )
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
            <p>This medication has already been marked as taken.</p>
            <p><strong>Thank you for staying on top of your medication schedule!</strong></p>
          </div>
        </body>
        </html>
      `, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/html' }
      })
    }

    // Update the medicine schedule to mark as taken
    const { error: updateError } = await supabaseClient
      .from('medicine_schedule')
      .update({ taken: true })
      .eq('id', scheduleId)

    if (updateError) {
      console.error('Update error:', updateError)
      return new Response(
        `<!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>Update Failed</h2>
          <p>Failed to update your medication status.</p>
        </body>
        </html>`,
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'text/html' } }
      )
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
          <p>Your medication has been marked as taken.</p>
          <p><strong>Great job staying on track with your medication schedule!</strong></p>
        </div>
      </body>
      </html>
    `, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/html' }
    })

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      `<!DOCTYPE html>
      <html>
      <head><title>Error</title></head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2>Internal Error</h2>
        <p>Something went wrong: ${error.message}</p>
      </body>
      </html>`,
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'text/html' } }
    )
  }
})