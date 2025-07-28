import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  console.log('=== MEETING LINK INSERTION STARTED ===');
  console.log('Timestamp:', new Date().toISOString());
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
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
    const result = await handleMeetingLinkInsertion(supabase, now);
    const endTime = Date.now();
    
    console.log(`Meeting link insertion completed in ${endTime - startTime}ms`);
    console.log('Result:', result);

    return new Response(JSON.stringify({
      success: true,
      message: 'Meeting link insertion executed successfully',
      timestamp: now.toISOString(),
      executionTime: endTime - startTime,
      ...result
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('=== MEETING LINK INSERTION FAILED ===');
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

async function handleMeetingLinkInsertion(supabase, now) {
  console.log('Handler started at:', new Date().toISOString());
  
  try {
    // Calculate 30 minutes from now
    const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000);
    console.log('Time window: from', now.toISOString(), 'to', thirtyMinutesFromNow.toISOString());
    
    const queryStart = Date.now();
    
    // Get appointments that are 30 minutes away, online, scheduled, and don't have a meeting link
    const { data: appointments, error } = await supabase
      .from('appointment')
      .select('appointment_id, meeting_date, meeting_link')
      .eq('status', 'scheduled')
      .eq('is_online', true)
      .eq('is_visible', true)
      .is('meeting_link', null)
      .lte('meeting_date', thirtyMinutesFromNow.toISOString())
      .gte('meeting_date', now.toISOString());
    
    const queryEnd = Date.now();
    console.log(`Database query completed in ${queryEnd - queryStart}ms`);
    
    if (error) {
      throw error;
    }

    console.log(`Found ${appointments?.length || 0} appointments needing meeting links`);
    
    if (!appointments || appointments.length === 0) {
      return {
        appointmentsFound: 0,
        appointmentsUpdated: 0,
        failedUpdates: 0
      };
    }

    // Update all appointments with "insert-test" in meeting_link field
    const updateStart = Date.now();
    
    const appointmentIds = appointments.map(apt => apt.appointment_id);
    
    const { data: updatedAppointments, error: updateError } = await supabase
      .from('appointment')
      .update({ meeting_link: 'insert-test' })
      .in('appointment_id', appointmentIds)
      .select('appointment_id');
    
    const updateEnd = Date.now();
    console.log(`Bulk update completed in ${updateEnd - updateStart}ms`);
    
    if (updateError) {
      console.error('Failed to update appointments:', updateError);
      throw updateError;
    }

    const updatedCount = updatedAppointments?.length || 0;
    console.log(`✓ Successfully updated ${updatedCount} appointments with meeting links`);
    
    return {
      appointmentsFound: appointments.length,
      appointmentsUpdated: updatedCount,
      failedUpdates: appointments.length - updatedCount
    };
    
  } catch (error) {
    console.error('Critical error in handleMeetingLinkInsertion:', error);
    throw error;
  }
}