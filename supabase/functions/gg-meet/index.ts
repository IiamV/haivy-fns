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

    // Get current time
    const now = new Date()
    
    // Handle both tasks
    await Promise.all([
      handleGoogleMeetLinkCreation(supabase, now),
      handleThreeDayCalendarReminders(supabase, now)
    ])

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

async function handleGoogleMeetLinkCreation(supabase: any, now: Date) {
  console.log('Checking for Google Meet link creation...')
  
  // Calculate 30 minutes from now
  const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000)
  
  // Get appointments that are 30 minutes away, online, scheduled, and don't have a meeting link
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
    .eq('status', 'scheduled')
    .eq('is_online', true)
    .eq('is_visible', true)
    .or('meeting_link.is.null,meeting_link.eq.')
    .lte('meeting_date', thirtyMinutesFromNow.toISOString())
    .gte('meeting_date', now.toISOString()) // Only future appointments

  if (error) {
    console.error('Error fetching appointments for Meet links:', error)
    return
  }

  console.log(`Found ${appointments?.length || 0} appointments needing Google Meet links`)

  // Create Google Meet links for each appointment
  for (const appointment of appointments || []) {
    try {
      // Use staff's calendar to create the meeting (they're the organizer)
      const staffTokens = await getGoogleTokensForUser(supabase, appointment.staff_id)
      
      if (!staffTokens) {
        console.error(`No valid Google tokens found for staff ${appointment.staff_id}`)
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

async function handleThreeDayCalendarReminders(supabase: any, now: Date) {
  console.log('Checking for 3-day calendar reminders...')
  
  // Calculate 3 days from now
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
  
  // Get appointments that are exactly 3 days away (within 30 second window for cron precision)
  const thirtySecondsAfter = new Date(threeDaysFromNow.getTime() + 30 * 1000)
  const thirtySecondsBefore = new Date(threeDaysFromNow.getTime() - 30 * 1000)
  
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
    .eq('status', 'scheduled')
    .eq('is_visible', true)
    .gte('meeting_date', thirtySecondsBefore.toISOString())
    .lte('meeting_date', thirtySecondsAfter.toISOString())

  if (error) {
    console.error('Error fetching appointments for 3-day reminders:', error)
    return
  }

  console.log(`Found ${appointments?.length || 0} appointments for 3-day reminders`)

  // Create calendar reminders for each appointment
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
        console.log(`Created calendar reminder for patient in appointment ${appointment.appointment_id}`)
      }

      // Create reminder in staff's calendar  
      if (staffTokens) {
        await createCalendarReminder(appointment, staffTokens, 'staff')
        console.log(`Created calendar reminder for staff in appointment ${appointment.appointment_id}`)
      }

    } catch (error) {
      console.error(`Failed to create calendar reminder for appointment ${appointment.appointment_id}:`, error)
    }
  }
}

async function getGoogleTokensForUser(supabase: any, userId: string) {
  try {
    // Get Google OAuth tokens for a specific user - only if status is true
    const { data: tokenData, error } = await supabase
      .from('user_tokens')
      .select('gg_access_token, gg_refresh_token, gg_token_status')
      .eq('user_id', userId)
      .eq('gg_token_status', true)
      .single()

    if (error || !tokenData) {
      console.log(`No valid Google tokens found for user ${userId}`)
      return null
    }

    if (!tokenData.gg_token_status) {
      console.log(`Google tokens disabled for user ${userId}`)
      return null
    }

    // Try to use the access token, if it fails, try to refresh
    try {
      // Test if the access token is valid by making a simple API call
      const testResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${tokenData.gg_access_token}`,
        },
      })

      if (testResponse.ok) {
        return {
          access_token: tokenData.gg_access_token,
          refresh_token: tokenData.gg_refresh_token
        }
      }
    } catch (error) {
      console.log(`Access token test failed for user ${userId}, attempting refresh...`)
    }

    // If access token test failed, try to refresh
    return await refreshAccessToken(supabase, userId, tokenData.gg_refresh_token)
    
  } catch (error) {
    console.error(`Error getting tokens for user ${userId}:`, error)
    return null
  }
}

async function refreshAccessToken(supabase: any, userId: string, refreshToken: string) {
  try {
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
      console.error(`Failed to refresh access token for user ${userId}: ${response.status} ${errorData}`)
      
      // Mark token as invalid if refresh fails
      await markTokenAsInvalid(supabase, userId)
      throw new Error(`Failed to refresh access token: ${response.status} ${errorData}`)
    }

    const tokenData = await response.json()

    // Update tokens in database
    const { error } = await supabase
      .from('user_tokens')
      .update({
        gg_access_token: tokenData.access_token,
        gg_token_status: true // Ensure it's marked as valid
      })
      .eq('user_id', userId)

    if (error) {
      console.error('Failed to update refreshed tokens:', error)
      throw new Error('Failed to update refreshed tokens in database')
    }

    console.log(`Successfully refreshed access token for user ${userId}`)
    return {
      access_token: tokenData.access_token,
      refresh_token: refreshToken
    }
  } catch (error) {
    console.error(`Error refreshing token for user ${userId}:`, error)
    await markTokenAsInvalid(supabase, userId)
    throw error
  }
}

async function markTokenAsInvalid(supabase: any, userId: string) {
  console.log(`Marking Google tokens as invalid for user ${userId}`)
  
  const { error } = await supabase
    .from('user_tokens')
    .update({ gg_token_status: false })
    .eq('user_id', userId)

  if (error) {
    console.error(`Failed to mark tokens as invalid for user ${userId}:`, error)
  } else {
    console.log(`Successfully marked tokens as invalid for user ${userId}`)
  }
}

async function createCalendarReminder(appointment: any, tokens: any, userType: string) {
  console.log(`Creating calendar reminder for ${userType} in appointment ${appointment.appointment_id}`)
  
  const reminderDate = new Date(appointment.meeting_date)
  reminderDate.setDate(reminderDate.getDate() - 3) // 3 days before

  const event = {
    summary: `Reminder: Medical Appointment in 3 days`,
    description: `You have a medical appointment scheduled for ${new Date(appointment.meeting_date).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })}\n\nDetails:\n- Patient: ${appointment.patient?.full_name}\n- Staff: ${appointment.staff?.full_name}\n- Content: ${appointment.content}\n- Duration: ${appointment.duration} minutes\n- Type: ${appointment.is_online ? 'Online' : 'In-person'}\n\nAppointment ID: ${appointment.appointment_id}`,
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
    description: `Online medical consultation\n\nAppointment ID: ${appointment.appointment_id}\nPatient: ${appointment.patient?.full_name}\nStaff: ${appointment.staff?.full_name}\n\nDuration: ${appointment.duration} minutes\n\nScheduled for: ${meetingStart.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
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