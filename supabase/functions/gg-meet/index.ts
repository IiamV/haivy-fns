import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  console.log('=== GOOGLE MEET LINK GENERATION STARTED ===');
  console.log('Timestamp:', new Date().toISOString());

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase environment variables');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    console.log('Current time:', now.toISOString());

    const startTime = Date.now();
    await handleGoogleMeetLinkCreation(supabase, now);
    const endTime = Date.now();

    console.log(`Google Meet link generation completed in ${endTime - startTime}ms`);

    return new Response(JSON.stringify({
      success: true,
      message: 'Google Meet link generation executed successfully',
      timestamp: now.toISOString(),
      executionTime: endTime - startTime
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('=== GOOGLE MEET LINK GENERATION FAILED ===');
    console.error('Error details:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});

async function handleGoogleMeetLinkCreation(supabase, now) {
  console.log('Handler started at:', new Date().toISOString());

  try {
    // Calculate 30 minutes from now
    const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000);
    console.log('Time window: from', now.toISOString(), 'to', thirtyMinutesFromNow.toISOString());

    const queryStart = Date.now();

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
      .gte('meeting_date', now.toISOString());

    const queryEnd = Date.now();
    console.log(`Database query completed in ${queryEnd - queryStart}ms`);

    if (error) {
      throw error;
    }

    console.log(`Found ${appointments?.length || 0} appointments needing Google Meet links`);

    // Create Google Meet links for each appointment
    for (const [index, appointment] of (appointments || []).entries()) {
      console.log(`Processing appointment ${index + 1}/${appointments.length} - ID: ${appointment.appointment_id}`);

      try {
        const meetStart = Date.now();
        const meetLink = await createGoogleMeetLink(appointment, supabase);
        const meetEnd = Date.now();
        console.log(`Google Meet link creation completed in ${meetEnd - meetStart}ms`);

        const updateStart = Date.now();
        
        // Update appointment with meeting link
        const { error: updateError } = await supabase
          .from('appointment')
          .update({ meeting_link: meetLink })
          .eq('appointment_id', appointment.appointment_id);

        const updateEnd = Date.now();
        console.log(`Database update completed in ${updateEnd - updateStart}ms`);

        if (updateError) {
          console.error(`Failed to update appointment ${appointment.appointment_id}:`, updateError);
        } else {
          console.log(`✓ Successfully created Google Meet link for appointment ${appointment.appointment_id}`);
        }

      } catch (error) {
        console.error(`✗ Failed to create Google Meet link for appointment ${appointment.appointment_id}:`, error);
      }
    }

  } catch (error) {
    console.error('Critical error in handleGoogleMeetLinkCreation:', error);
    throw error;
  }
}

async function createGoogleMeetLink(appointment, supabase) {
  console.log(`Creating Google Meet link for appointment ${appointment.appointment_id}...`);

  try {
    const authStart = Date.now();
    
    // Get emails from auth.users for both patient and staff
    const [patientAuth, staffAuth] = await Promise.all([
      supabase.auth.admin.getUserById(appointment.patient_id),
      supabase.auth.admin.getUserById(appointment.staff_id)
    ]);

    const authEnd = Date.now();
    console.log(`Auth queries completed in ${authEnd - authStart}ms`);

    if (patientAuth.error || staffAuth.error) {
      throw new Error('Failed to get user email addresses');
    }

    const patientEmail = patientAuth.data.user?.email;
    const staffEmail = staffAuth.data.user?.email;

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

    // Since we can't create actual Google Meet links without authentication,
    // we'll create a placeholder meet link for now
    const meetLink = `https://meet.google.com/lookup/${appointment.appointment_id}`;

    console.log(`✓ Generated placeholder Google Meet link: ${meetLink}`);
    return meetLink;

  } catch (error) {
    console.error(`Error creating Google Meet link:`, error);
    throw error;
  }
}