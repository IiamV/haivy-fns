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

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/gg-meet' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Google Calendar credentials from environment variables
    const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!
    const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!
    const REFRESH_TOKEN = Deno.env.get('GOOGLE_REFRESH_TOKEN')!

    console.log('Starting cron job execution...')

    // Get current time and calculate time windows
    const now = new Date()
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
    const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000)

    // 1. Handle 3-day reminders
    await handleThreeDayReminders(supabase, now, threeDaysFromNow)

    // 2. Handle Google Meet link creation (30 minutes before)
    await handleMeetLinkCreation(supabase, now, thirtyMinutesFromNow, {
      CLIENT_ID,
      CLIENT_SECRET,
      REFRESH_TOKEN
    })

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Cron job executed successfully',
        timestamp: now.toISOString()
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )

  } catch (error) {
    console.error('Error in cron job:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        status: 500,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }
})

async function handleThreeDayReminders(supabase: any, now: Date, threeDaysFromNow: Date) {
  console.log('Checking for 3-day reminders...')
  
  // Get appointments that are 3 days away (within a 30-minute window)
  const threeDaysAgo = new Date(threeDaysFromNow.getTime() - 30 * 60 * 1000)
  
  const { data: appointments, error } = await supabase
    .from('appointment')
    .select(`
      appointment_id,
      meeting_date,
      content,
      duration,
      is_online,
      patient_id,
      staff_id,
      user_details!appointment_patient_id_fkey1(user_id, email, first_name, last_name),
      staff:user_details!appointment_staff_id_fkey1(user_id, email, first_name, last_name)
    `)
    .gte('meeting_date', threeDaysAgo.toISOString())
    .lte('meeting_date', threeDaysFromNow.toISOString())
    .eq('status', 'confirmed')
    .eq('is_visible', true)

  if (error) {
    console.error('Error fetching appointments for reminders:', error)
    return
  }

  console.log(`Found ${appointments?.length || 0} appointments for 3-day reminders`)

  // Create calendar events for each appointment
  for (const appointment of appointments || []) {
    try {
      await createCalendarReminder(appointment)
      console.log(`Created reminder for appointment ${appointment.appointment_id}`)
    } catch (error) {
      console.error(`Failed to create reminder for appointment ${appointment.appointment_id}:`, error)
    }
  }
}

async function handleMeetLinkCreation(supabase: any, now: Date, thirtyMinutesFromNow: Date, credentials: any) {
  console.log('Checking for Google Meet link creation...')
  
  // Get appointments that need Google Meet links (30 minutes before, online appointments only)
  const thirtyMinutesAgo = new Date(thirtyMinutesFromNow.getTime() - 30 * 60 * 1000)
  
  const { data: appointments, error } = await supabase
    .from('appointment')
    .select(`
      appointment_id,
      meeting_date,
      content,
      duration,
      meeting_link,
      patient_id,
      staff_id,
      user_details!appointment_patient_id_fkey1(user_id, email, first_name, last_name),
      staff:user_details!appointment_staff_id_fkey1(user_id, email, first_name, last_name)
    `)
    .gte('meeting_date', thirtyMinutesAgo.toISOString())
    .lte('meeting_date', thirtyMinutesFromNow.toISOString())
    .eq('status', 'confirmed')
    .eq('is_online', true)
    .or('meeting_link.is.null,meeting_link.eq.')

  if (error) {
    console.error('Error fetching appointments for Meet links:', error)
    return
  }

  console.log(`Found ${appointments?.length || 0} appointments needing Google Meet links`)

  // Create Google Meet links for each appointment
  for (const appointment of appointments || []) {
    try {
      const meetLink = await createGoogleMeetLink(appointment, credentials)
      
      // Update appointment with meeting link
      const { error: updateError } = await supabase
        .from('appointment')
        .update({ meeting_link: meetLink })
        .eq('appointment_id', appointment.appointment_id)

      if (updateError) {
        console.error(`Failed to update appointment ${appointment.appointment_id} with meeting link:`, updateError)
      } else {
        console.log(`Created and saved Google Meet link for appointment ${appointment.appointment_id}`)
      }
    } catch (error) {
      console.error(`Failed to create Google Meet link for appointment ${appointment.appointment_id}:`, error)
    }
  }
}

async function createCalendarReminder(appointment: any) {
  console.log(`Creating calendar reminder for appointment ${appointment.appointment_id}`)
  console.log(`Patient: ${appointment.user_details?.first_name} ${appointment.user_details?.last_name}`)
  console.log(`Staff: ${appointment.staff?.first_name} ${appointment.staff?.last_name}`)
  console.log(`Meeting Date: ${appointment.meeting_date}`)
  console.log(`Content: ${appointment.content}`)
}

async function createGoogleMeetLink(appointment: any, credentials: any) {
  console.log(`Creating Google Meet link for appointment ${appointment.appointment_id}`)
  
  // Get access token
  const accessToken = await getAccessToken(credentials)
  
  // Calculate meeting times
  const meetingStart = new Date(appointment.meeting_date)
  const meetingEnd = new Date(meetingStart.getTime() + appointment.duration * 60 * 1000)
  
  // Create calendar event with Google Meet
  const event = {
    summary: `Medical Appointment - ${appointment.content || 'Consultation'}`,
    description: `Online medical consultation\nAppointment ID: ${appointment.appointment_id}`,
    start: {
      dateTime: meetingStart.toISOString(),
      timeZone: 'Asia/Ho_Chi_Minh',
    },
    end: {
      dateTime: meetingEnd.toISOString(),
      timeZone: 'Asia/Ho_Chi_Minh',
    },
    attendees: [
      { email: appointment.user_details?.email },
      { email: appointment.staff?.email }
    ],
    conferenceData: {
      createRequest: {
        requestId: `appointment-${appointment.appointment_id}-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  }

  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  })

  if (!response.ok) {
    const errorData = await response.text()
    throw new Error(`Failed to create Google Meet event: ${response.status} ${errorData}`)
  }

  const eventData = await response.json()
  const meetLink = eventData.conferenceData?.entryPoints?.[0]?.uri

  if (!meetLink) {
    throw new Error('No Google Meet link found in created event')
  }

  console.log(`Created Google Meet link: ${meetLink}`)
  return meetLink
}

async function getAccessToken(credentials: any) {
  const { CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN } = credentials
  
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const errorData = await response.text()
    throw new Error(`Failed to get access token: ${response.status} ${errorData}`)
  }

  const data = await response.json()
  return data.access_token
}