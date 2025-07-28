// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

console.log("Hello from Functions!")

Deno.serve(async (req) => {
  const { name } = await req.json()
  const data = {
    message: `Hello ${name}!`,
  }

  return new Response(
    JSON.stringify(data),
    { headers: { "Content-Type": "application/json" } },
  )
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/reminder-callback' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
// supabase/functions/mark-medicine-taken/index.ts

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
    // Initialize Supabase client
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
        JSON.stringify({ error: 'Missing schedule_id or token' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Get the medicine schedule record to verify the token
    const { data: scheduleData, error: fetchError } = await supabaseClient
      .from('medicine_schedule')
      .select(`
        id,
        date,
        taken,
        prescription (
          appointment_id (
            patient_id (
              user_id (
                email
              )
            )
          )
        )
      `)
      .eq('id', scheduleId)
      .single()

    if (fetchError || !scheduleData) {
      return new Response(
        JSON.stringify({ error: 'Invalid schedule ID' }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Verify the token (recreate the same hash used in the email generation)
    const patientEmail = scheduleData.prescription.appointment_id.patient_id.user_id.email
    const expectedToken = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(scheduleId + patientEmail + scheduleData.date)
    ).then(buffer => 
      Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
    )

    if (token !== expectedToken) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
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
            <div class="success-icon">✅</div>
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
        headers: { ...corsHeaders, 'Content-Type': 'text/html' }
      })
    }

    // Update the medicine schedule to mark as taken
    const { error: updateError } = await supabaseClient
      .from('medicine_schedule')
      .update({ 
        taken: true,
        taken_at: new Date().toISOString()
      })
      .eq('id', scheduleId)

    if (updateError) {
      console.error('Update error:', updateError)
      return new Response(
        JSON.stringify({ error: 'Failed to update medicine schedule' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
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
          <div class="success-icon celebration">🎉</div>
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
      headers: { ...corsHeaders, 'Content-Type': 'text/html' }
    })

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
});