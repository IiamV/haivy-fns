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

    console.log('Starting cron job execution...')

    // Get current time and calculate time windows
    const now = new Date()
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
    const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000)

    // 1. Handle 3-day reminders
    await handleThreeDayReminders(supabase, now, threeDaysFromNow)

    // 2. Handle Google Meet link creation (30 minutes before)
    await handleMeetLinkCreation(supabase, now, thirtyMinutesFromNow)

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
      patient:user_details!appointment_patient_id_fkey1(user_id, full_name),
      staff:user_details!appointment_staff_id_fkey1(user_id, full_name)
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
      // Get Google Calendar tokens for both patient and staff
      const [patientTokens, staffTokens] = await Promise.all([
        getGoogleTokensForUser(supabase, appointment.patient_id),
        getGoogleTokensForUser(supabase, appointment.staff_id)
      ])

      // Create reminder in patient's calendar
      if (patientTokens) {
        await createCalendarReminder(appointment, patientTokens, 'patient')
      }

      // Create reminder in staff's calendar  
      if (staffTokens) {
        await createCalendarReminder(appointment, staffTokens, 'staff')
      }

      console.log(`Created reminders for appointment ${appointment.appointment_id}`)
    } catch (error) {
      console.error(`Failed to create reminder for appointment ${appointment.appointment_id}:`, error)
    }
  }
}

async function handleMeetLinkCreation(supabase: any, now: Date, thirtyMinutesFromNow: Date) {
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
      patient:user_details!appointment_patient_id_fkey1(user_id, full_name),
      staff:user_details!appointment_staff_id_fkey1(user_id, full_name)
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
      // Use staff's calendar to create the meeting
      const staffTokens = await getGoogleTokensForUser(supabase, appointment.staff_id)
      
      if (!staffTokens) {
        console.error(`No Google tokens found for staff ${appointment.staff_id}`)
        continue
      }

      const meetLink = await createGoogleMeetLink(appointment, staffTokens, supabase)
      
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

async function getGoogleTokensForUser(supabase: any, userId: string) {
  // Get Google OAuth tokens for a specific user
  const { data: tokenData, error } = await supabase
    .from('user_google_tokens')
    .select('refresh_token, access_token, expires_at')
    .eq('user_id', userId)
    .single()

  if (error || !tokenData) {
    console.log(`No Google tokens found for user ${userId}`)
    return null
  }

  // Check if access token is expired and refresh if needed
  const now = new Date()
  const expiresAt = new Date(tokenData.expires_at)
  
  if (now >= expiresAt) {
    console.log(`Access token expired for user ${userId}, refreshing...`)
    return await refreshAccessToken(supabase, userId, tokenData.refresh_token)
  }

  return tokenData
}

async function refreshAccessToken(supabase: any, userId: string, refreshToken: string) {
  const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!
  const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!
  
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const errorData = await response.text()
    throw new Error(`Failed to refresh access token: ${response.status} ${errorData}`)
  }

  const tokenData = await response.json()
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000)

  // Update tokens in database
  const { error } = await supabase
    .from('user_google_tokens')
    .update({
      access_token: tokenData.access_token,
      expires_at: expiresAt.toISOString()
    })
    .eq('user_id', userId)

  if (error) {
    console.error('Failed to update refreshed tokens:', error)
  }

  return {
    access_token: tokenData.access_token,
    refresh_token: refreshToken,
    expires_at: expiresAt.toISOString()
  }
}

async function createCalendarReminder(appointment: any, tokens: any, userType: string) {
  console.log(`Creating calendar reminder for ${userType} in appointment ${appointment.appointment_id}`)
  
  const reminderDate = new Date(appointment.meeting_date)
  reminderDate.setDate(reminderDate.getDate() - 3) // 3 days before

  const event = {
    summary: `Reminder: Medical Appointment in 3 days`,
    description: `You have a medical appointment scheduled for ${appointment.meeting_date}\n\nDetails:\n- Patient: ${appointment.patient?.full_name}\n- Staff: ${appointment.staff?.full_name}\n- Content: ${appointment.content}\n- Duration: ${appointment.duration} minutes\n- Type: ${appointment.is_online ? 'Online' : 'In-person'}`,
    start: {
      dateTime: reminderDate.toISOString(),
      timeZone: 'Asia/Ho_Chi_Minh',
    },
    end: {
      dateTime: new Date(reminderDate.getTime() + 15 * 60 * 1000).toISOString(), // 15 minute reminder
      timeZone: 'Asia/Ho_Chi_Minh',
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 0 },
        { method: 'popup', minutes: 0 }
      ]
    }
  }

  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  })

  if (!response.ok) {
    const errorData = await response.text()
    throw new Error(`Failed to create calendar reminder: ${response.status} ${errorData}`)
  }

  console.log(`Created calendar reminder for ${userType}`)
}

async function createGoogleMeetLink(appointment: any, tokens: any, supabase: any) {
  console.log(`Creating Google Meet link for appointment ${appointment.appointment_id}`)
  
  // Get emails from auth.users for both patient and staff
  const [patientAuth, staffAuth] = await Promise.all([
    supabase.auth.admin.getUserById(appointment.patient_id),
    supabase.auth.admin.getUserById(appointment.staff_id)
  ])

  if (patientAuth.error || staffAuth.error) {
    console.error('Error fetching user auth data:', patientAuth.error || staffAuth.error)
    throw new Error('Failed to get user email addresses')
  }

  const patientEmail = patientAuth.data.user?.email
  const staffEmail = staffAuth.data.user?.email

  if (!patientEmail || !staffEmail) {
    throw new Error('Missing email addresses for appointment participants')
  }
  
  // Calculate meeting times
  const meetingStart = new Date(appointment.meeting_date)
  const meetingEnd = new Date(meetingStart.getTime() + appointment.duration * 60 * 1000)
  
  // Create calendar event with Google Meet
  const event = {
    summary: `Medical Appointment - ${appointment.content || 'Consultation'}`,
    description: `Online medical consultation\n\nAppointment ID: ${appointment.appointment_id}\nPatient: ${appointment.patient?.full_name}\nStaff: ${appointment.staff?.full_name}\n\nDuration: ${appointment.duration} minutes`,
    start: {
      dateTime: meetingStart.toISOString(),
      timeZone: 'Asia/Ho_Chi_Minh',
    },
    end: {
      dateTime: meetingEnd.toISOString(),
      timeZone: 'Asia/Ho_Chi_Minh',
    },
    attendees: [
      { email: patientEmail },
      { email: staffEmail }
    ],
    conferenceData: {
      createRequest: {
        requestId: `appointment-${appointment.appointment_id}-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 30 },
        { method: 'popup', minutes: 15 }
      ]
    }
  }

  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokens.access_token}`,
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