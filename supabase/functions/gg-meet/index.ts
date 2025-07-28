import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  console.log('=== CRON JOB STARTED ===');
  console.log('Request method:', req.method);
  console.log('Request URL:', req.url);
  console.log('Timestamp:', new Date().toISOString());

  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS request');
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('Initializing Supabase client...');
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    console.log('Supabase URL:', supabaseUrl ? 'Present' : 'Missing');
    console.log('Service Role Key:', supabaseKey ? 'Present' : 'Missing');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('Supabase client initialized successfully');

    // Get current time
    const now = new Date();
    console.log('Current time:', now.toISOString());
    console.log('Current time (Vietnam):', now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));

    console.log('Starting parallel task execution...');
    const startTime = Date.now();

    // Handle both tasks
    const results = await Promise.allSettled([
      handleGoogleMeetLinkCreation(supabase, now),
      handleThreeDayCalendarReminders(supabase, now)
    ]);

    const endTime = Date.now();
    console.log(`Tasks completed in ${endTime - startTime}ms`);

    // Check results
    results.forEach((result, index) => {
      const taskName = index === 0 ? 'Google Meet Link Creation' : '3-Day Calendar Reminders';
      if (result.status === 'fulfilled') {
        console.log(`✓ ${taskName}: Completed successfully`);
      } else {
        console.error(`✗ ${taskName}: Failed with error:`, result.reason);
      }
    });

    console.log('=== CRON JOB COMPLETED SUCCESSFULLY ===');
    return new Response(JSON.stringify({
      success: true,
      message: 'Cron job executed successfully',
      timestamp: now.toISOString(),
      executionTime: endTime - startTime
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('=== CRON JOB FAILED ===');
    console.error('Error details:', error);
    console.error('Error stack:', error.stack);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function handleGoogleMeetLinkCreation(supabase, now) {
  console.log('\n--- GOOGLE MEET LINK CREATION HANDLER ---');
  console.log('Handler started at:', new Date().toISOString());

  try {
    // Calculate 30 minutes from now
    const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000);
    
    console.log('Time window for Google Meet creation:');
    console.log('  From (now):', now.toISOString());
    console.log('  To (30 min from now):', thirtyMinutesFromNow.toISOString());
    console.log('  From (Vietnam):', now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    console.log('  To (Vietnam):', thirtyMinutesFromNow.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));

    console.log('Querying appointments from database...');
    const queryStart = Date.now();

    // Get appointments that are WITHIN the next 30 minutes, online, scheduled, and don't have a meeting link
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
      .gte('meeting_date', now.toISOString())  // From now
      .lte('meeting_date', thirtyMinutesFromNow.toISOString());  // To 30 minutes from now

    const queryEnd = Date.now();
    console.log(`Database query completed in ${queryEnd - queryStart}ms`);

    if (error) {
      console.error('Database query error:', error);
      throw error;
    }

    console.log(`Found ${appointments?.length || 0} appointments needing Google Meet links`);

    if (appointments && appointments.length > 0) {
      console.log('Appointment details:');
      appointments.forEach((apt, index) => {
        console.log(`  ${index + 1}. ID: ${apt.appointment_id}, Date: ${apt.meeting_date}, Patient: ${apt.patient?.full_name}, Staff: ${apt.staff?.full_name}`);
      });
    } else {
      console.log('No appointments found in the 30-minute window');
    }

    // Create Google Meet links for each appointment
    for (const [index, appointment] of (appointments || []).entries()) {
      console.log(`\n--- Processing appointment ${index + 1}/${appointments.length} ---`);
      console.log('Appointment ID:', appointment.appointment_id);
      console.log('Meeting date:', appointment.meeting_date);
      console.log('Patient:', appointment.patient?.full_name, '(ID:', appointment.patient_id, ')');
      console.log('Staff:', appointment.staff?.full_name, '(ID:', appointment.staff_id, ')');

      try {
        console.log('Getting Google tokens for staff...');
        const tokenStart = Date.now();
        // Use staff's calendar to create the meeting (they're the organizer)
        const staffTokens = await getGoogleTokensForUser(supabase, appointment.staff_id);
        const tokenEnd = Date.now();
        console.log(`Token retrieval completed in ${tokenEnd - tokenStart}ms`);

        if (!staffTokens) {
          console.error(`No valid Google tokens found for staff ${appointment.staff_id}`);
          continue;
        }

        console.log('Creating Google Meet link...');
        const meetStart = Date.now();
        const meetLink = await createGoogleMeetLink(appointment, staffTokens, supabase);
        const meetEnd = Date.now();
        console.log(`Google Meet link creation completed in ${meetEnd - meetStart}ms`);
        console.log('Generated Meet link:', meetLink);

        console.log('Updating appointment with meeting link...');
        const updateStart = Date.now();
        // Update appointment with meeting link
        const { error: updateError } = await supabase
          .from('appointment')
          .update({ meeting_link: meetLink })
          .eq('appointment_id', appointment.appointment_id);
        const updateEnd = Date.now();
        console.log(`Database update completed in ${updateEnd - updateStart}ms`);

        if (updateError) {
          console.error(`Failed to update appointment ${appointment.appointment_id} with meeting link:`, updateError);
        } else {
          console.log(`✓ Successfully created and saved Google Meet link for appointment ${appointment.appointment_id}`);
        }

      } catch (error) {
        console.error(`✗ Failed to create Google Meet link for appointment ${appointment.appointment_id}:`, error);
        console.error('Error stack:', error.stack);
      }
    }

    console.log('--- GOOGLE MEET LINK CREATION COMPLETED ---\n');

  } catch (error) {
    console.error('Critical error in handleGoogleMeetLinkCreation:', error);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

async function handleThreeDayCalendarReminders(supabase, now) {
  console.log('\n--- 3-DAY CALENDAR REMINDERS HANDLER ---');
  console.log('Handler started at:', new Date().toISOString());

  try {
    // Calculate 3 days from now
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    console.log('Looking for appointments 3 days from now:', threeDaysFromNow.toISOString());

    // Get appointments that are exactly 3 days away (within 30 second window for cron precision)
    const thirtySecondsAfter = new Date(threeDaysFromNow.getTime() + 30 * 1000);
    const thirtySecondsBefore = new Date(threeDaysFromNow.getTime() - 30 * 1000);

    console.log('Time window for 3-day reminders:');
    console.log('  From:', thirtySecondsBefore.toISOString());
    console.log('  To:', thirtySecondsAfter.toISOString());

    console.log('Querying appointments from database...');
    const queryStart = Date.now();

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
      .lte('meeting_date', thirtySecondsAfter.toISOString());

    const queryEnd = Date.now();
    console.log(`Database query completed in ${queryEnd - queryStart}ms`);

    if (error) {
      console.error('Database query error:', error);
      throw error;
    }

    console.log(`Found ${appointments?.length || 0} appointments for 3-day reminders`);

    if (appointments && appointments.length > 0) {
      console.log('Appointment details:');
      appointments.forEach((apt, index) => {
        console.log(`  ${index + 1}. ID: ${apt.appointment_id}, Date: ${apt.meeting_date}, Patient: ${apt.patient?.full_name}, Staff: ${apt.staff?.full_name}, Online: ${apt.is_online}`);
      });
    }

    // Create calendar reminders for each appointment
    for (const [index, appointment] of (appointments || []).entries()) {
      console.log(`\n--- Processing reminder ${index + 1}/${appointments.length} ---`);
      console.log('Appointment ID:', appointment.appointment_id);
      console.log('Meeting date:', appointment.meeting_date);
      console.log('Patient:', appointment.patient?.full_name, '(ID:', appointment.patient_id, ')');
      console.log('Staff:', appointment.staff?.full_name, '(ID:', appointment.staff_id, ')');
      console.log('Is online:', appointment.is_online);

      try {
        console.log('Getting Google Calendar tokens for both users...');
        const tokenStart = Date.now();
        // Get Google Calendar tokens for both patient and staff
        const [patientTokens, staffTokens] = await Promise.allSettled([
          getGoogleTokensForUser(supabase, appointment.patient_id),
          getGoogleTokensForUser(supabase, appointment.staff_id)
        ]);
        const tokenEnd = Date.now();
        console.log(`Token retrieval completed in ${tokenEnd - tokenStart}ms`);

        console.log('Patient tokens:', patientTokens.status === 'fulfilled' ? (patientTokens.value ? 'Available' : 'Not available') : 'Failed to retrieve');
        console.log('Staff tokens:', staffTokens.status === 'fulfilled' ? (staffTokens.value ? 'Available' : 'Not available') : 'Failed to retrieve');

        // Create reminder in patient's calendar
        if (patientTokens.status === 'fulfilled' && patientTokens.value) {
          console.log('Creating calendar reminder for patient...');
          const patientReminderStart = Date.now();
          await createCalendarReminder(appointment, patientTokens.value, 'patient');
          const patientReminderEnd = Date.now();
          console.log(`✓ Patient calendar reminder created in ${patientReminderEnd - patientReminderStart}ms`);
        } else {
          console.log('⚠ Skipping patient calendar reminder - no valid tokens');
        }

        // Create reminder in staff's calendar  
        if (staffTokens.status === 'fulfilled' && staffTokens.value) {
          console.log('Creating calendar reminder for staff...');
          const staffReminderStart = Date.now();
          await createCalendarReminder(appointment, staffTokens.value, 'staff');
          const staffReminderEnd = Date.now();
          console.log(`✓ Staff calendar reminder created in ${staffReminderEnd - staffReminderStart}ms`);
        } else {
          console.log('⚠ Skipping staff calendar reminder - no valid tokens');
        }

      } catch (error) {
        console.error(`✗ Failed to create calendar reminder for appointment ${appointment.appointment_id}:`, error);
        console.error('Error stack:', error.stack);
      }
    }

    console.log('--- 3-DAY CALENDAR REMINDERS COMPLETED ---\n');

  } catch (error) {
    console.error('Critical error in handleThreeDayCalendarReminders:', error);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

async function getGoogleTokensForUser(supabase, userId) {
  console.log(`Getting Google tokens for user ${userId}...`);
  
  try {
    const queryStart = Date.now();
    // Get Google OAuth tokens for a specific user - only if status is true
    const { data: tokenData, error } = await supabase
      .from('user_tokens')
      .select('gg_access_token, gg_refresh_token, gg_token_status')
      .eq('user_id', userId)
      .eq('gg_token_status', true)
      .single();
    
    const queryEnd = Date.now();
    console.log(`Token query completed in ${queryEnd - queryStart}ms`);

    if (error) {
      console.log(`Database error getting tokens for user ${userId}:`, error);
      return null;
    }

    if (!tokenData) {
      console.log(`No token data found for user ${userId}`);
      return null;
    }

    console.log(`Token data found for user ${userId}:`, {
      hasAccessToken: !!tokenData.gg_access_token,
      hasRefreshToken: !!tokenData.gg_refresh_token,
      tokenStatus: tokenData.gg_token_status
    });

    if (!tokenData.gg_token_status) {
      console.log(`Google tokens disabled for user ${userId}`);
      return null;
    }

    console.log(`Testing access token validity for user ${userId}...`);
    const testStart = Date.now();
    
    // Try to use the access token, if it fails, try to refresh
    try {
      // Test if the access token is valid by making a simple API call
      const testResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${tokenData.gg_access_token}`
        }
      });

      const testEnd = Date.now();
      console.log(`Token test completed in ${testEnd - testStart}ms`);

      if (testResponse.ok) {
        console.log(`✓ Access token is valid for user ${userId}`);
        return {
          access_token: tokenData.gg_access_token,
          refresh_token: tokenData.gg_refresh_token
        };
      } else {
        console.log(`Access token test failed for user ${userId} - Status: ${testResponse.status}`);
      }
    } catch (error) {
      console.log(`Access token test failed for user ${userId} - Error:`, error.message);
    }

    // If access token test failed, try to refresh
    console.log(`Attempting to refresh access token for user ${userId}...`);
    return await refreshAccessToken(supabase, userId, tokenData.gg_refresh_token);

  } catch (error) {
    console.error(`Error getting tokens for user ${userId}:`, error);
    return null;
  }
}

async function refreshAccessToken(supabase, userId, refreshToken) {
  console.log(`Refreshing access token for user ${userId}...`);
  
  try {
    const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
    const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');
    
    console.log('Google OAuth credentials:', {
      hasClientId: !!CLIENT_ID,
      hasClientSecret: !!CLIENT_SECRET
    });

    const refreshStart = Date.now();
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });

    const refreshEnd = Date.now();
    console.log(`Token refresh request completed in ${refreshEnd - refreshStart}ms`);

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`Failed to refresh access token for user ${userId}: ${response.status} ${errorData}`);
      // Mark token as invalid if refresh fails
      await markTokenAsInvalid(supabase, userId);
      throw new Error(`Failed to refresh access token: ${response.status} ${errorData}`);
    }

    const tokenData = await response.json();
    console.log(`✓ Successfully received new access token for user ${userId}`);

    console.log('Updating tokens in database...');
    const updateStart = Date.now();
    // Update tokens in database
    const { error } = await supabase
      .from('user_tokens')
      .update({
        gg_access_token: tokenData.access_token,
        gg_token_status: true  // Ensure it's marked as valid
      })
      .eq('user_id', userId);

    const updateEnd = Date.now();
    console.log(`Database update completed in ${updateEnd - updateStart}ms`);

    if (error) {
      console.error('Failed to update refreshed tokens:', error);
      throw new Error('Failed to update refreshed tokens in database');
    }

    console.log(`✓ Successfully refreshed and updated access token for user ${userId}`);
    return {
      access_token: tokenData.access_token,
      refresh_token: refreshToken
    };

  } catch (error) {
    console.error(`Error refreshing token for user ${userId}:`, error);
    await markTokenAsInvalid(supabase, userId);
    throw error;
  }
}

async function markTokenAsInvalid(supabase, userId) {
  console.log(`Marking Google tokens as invalid for user ${userId}...`);
  
  try {
    const updateStart = Date.now();
    const { error } = await supabase
      .from('user_tokens')
      .update({ gg_token_status: false })
      .eq('user_id', userId);

    const updateEnd = Date.now();
    console.log(`Token invalidation completed in ${updateEnd - updateStart}ms`);

    if (error) {
      console.error(`Failed to mark tokens as invalid for user ${userId}:`, error);
    } else {
      console.log(`✓ Successfully marked tokens as invalid for user ${userId}`);
    }
  } catch (error) {
    console.error(`Error marking tokens as invalid for user ${userId}:`, error);
  }
}

async function createCalendarReminder(appointment, tokens, userType) {
  console.log(`Creating calendar reminder for ${userType} in appointment ${appointment.appointment_id}...`);
  
  try {
    const reminderDate = new Date(appointment.meeting_date);
    reminderDate.setDate(reminderDate.getDate() - 3); // 3 days before

    console.log('Reminder details:', {
      appointmentDate: appointment.meeting_date,
      reminderDate: reminderDate.toISOString(),
      userType: userType,
      duration: appointment.duration
    });

    const event = {
      summary: `Reminder: Medical Appointment in 3 days`,
      description: `You have a medical appointment scheduled for ${new Date(appointment.meeting_date).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })}\n\nDetails:\n- Patient: ${appointment.patient?.full_name}\n- Staff: ${appointment.staff?.full_name}\n- Content: ${appointment.content}\n- Duration: ${appointment.duration} minutes\n- Type: ${appointment.is_online ? 'Online' : 'In-person'}\n\nAppointment ID: ${appointment.appointment_id}`,
      start: {
        dateTime: reminderDate.toISOString(),
        timeZone: 'Asia/Ho_Chi_Minh'
      },
      end: {
        dateTime: new Date(reminderDate.getTime() + 15 * 60 * 1000).toISOString(),
        timeZone: 'Asia/Ho_Chi_Minh'
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 0 },
          { method: 'popup', minutes: 0 }
        ]
      }
    };

    console.log('Making calendar API request...');
    const apiStart = Date.now();
    const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(event)
    });

    const apiEnd = Date.now();
    console.log(`Calendar API request completed in ${apiEnd - apiStart}ms`);

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`Calendar API error: ${response.status} ${errorData}`);
      throw new Error(`Failed to create calendar reminder: ${response.status} ${errorData}`);
    }

    const eventData = await response.json();
    console.log(`✓ Successfully created calendar reminder for ${userType} - Event ID: ${eventData.id}`);

  } catch (error) {
    console.error(`Error creating calendar reminder for ${userType}:`, error);
    throw error;
  }
}

async function createGoogleMeetLink(appointment, tokens, supabase) {
  console.log(`Creating Google Meet link for appointment ${appointment.appointment_id}...`);
  
  try {
    console.log('Getting user emails from auth...');
    const authStart = Date.now();
    // Get emails from auth.users for both patient and staff
    const [patientAuth, staffAuth] = await Promise.all([
      supabase.auth.admin.getUserById(appointment.patient_id),
      supabase.auth.admin.getUserById(appointment.staff_id)
    ]);

    const authEnd = Date.now();
    console.log(`Auth queries completed in ${authEnd - authStart}ms`);

    if (patientAuth.error || staffAuth.error) {
      console.error('Error fetching user auth data:', patientAuth.error || staffAuth.error);
      throw new Error('Failed to get user email addresses');
    }

    const patientEmail = patientAuth.data.user?.email;
    const staffEmail = staffAuth.data.user?.email;

    console.log('Email addresses:', {
      patientEmail: patientEmail || 'Missing',
      staffEmail: staffEmail || 'Missing'
    });

    if (!patientEmail || !staffEmail) {
      throw new Error('Missing email addresses for appointment participants');
    }

    // Calculate meeting times
    const meetingStart = new Date(appointment.meeting_date);
    const meetingEnd = new Date(meetingStart.getTime() + appointment.duration * 60 * 1000);

    console.log('Meeting times:', {
      start: meetingStart.toISOString(),
      end: meetingEnd.toISOString(),
      duration: appointment.duration + ' minutes'
    });

    // Create calendar event with Google Meet
    const event = {
      summary: `Medical Appointment - ${appointment.content || 'Consultation'}`,
      description: `Online medical consultation\n\nAppointment ID: ${appointment.appointment_id}\nPatient: ${appointment.patient?.full_name}\nStaff: ${appointment.staff?.full_name}\n\nDuration: ${appointment.duration} minutes\n\nScheduled for: ${meetingStart.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
      start: {
        dateTime: meetingStart.toISOString(),
        timeZone: 'Asia/Ho_Chi_Minh'
      },
      end: {
        dateTime: meetingEnd.toISOString(),
        timeZone: 'Asia/Ho_Chi_Minh'
      },
      attendees: [
        { email: patientEmail },
        { email: staffEmail }
      ],
      conferenceData: {
        createRequest: {
          requestId: `appointment-${appointment.appointment_id}-${Date.now()}`,
          conferenceSolutionKey: {
            type: 'hangoutsMeet'
          }
        }
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 30 },
          { method: 'popup', minutes: 15 }
        ]
      }
    };

    console.log('Creating calendar event with Google Meet...');
    const meetStart = Date.now();
    const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(event)
    });

    const meetEnd = Date.now();
    console.log(`Google Meet creation request completed in ${meetEnd - meetStart}ms`);

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`Google Meet creation error: ${response.status} ${errorData}`);
      throw new Error(`Failed to create Google Meet event: ${response.status} ${errorData}`);
    }

    const eventData = await response.json();
    console.log('Event created successfully:', {
      eventId: eventData.id,
      hasConferenceData: !!eventData.conferenceData,
      entryPointsCount: eventData.conferenceData?.entryPoints?.length || 0
    });

    const meetLink = eventData.conferenceData?.entryPoints?.[0]?.uri;
    if (!meetLink) {
      console.error('No Google Meet link found in event data');
      console.error('Conference data:', JSON.stringify(eventData.conferenceData, null, 2));
      throw new Error('No Google Meet link found in created event');
    }

    console.log(`✓ Successfully created Google Meet link: ${meetLink}`);
    return meetLink;

  } catch (error) {
    console.error(`Error creating Google Meet link:`, error);
    throw error;
  }
}