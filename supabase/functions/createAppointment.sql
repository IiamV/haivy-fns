CREATE OR REPLACE FUNCTION public.createAppointment(
  p_duration INTEGER,
  p_meeting_date TIMESTAMPTZ,
  p_isPublic BOOLEAN,
  p_requested_doctor UUID,
  p_patient UUID
)
RETURNS UUID AS $$
DECLARE
  v_appointment_id UUID;
  v_ticket_content TEXT;
  v_response JSONB;
  v_supabase_url TEXT := 'https://ejfeybaktdorddskajzc.supabase.co';
BEGIN
  -- Create ticket content with newlines
  v_ticket_content := format(
    'Overview: Confirm patient information\nPlease confirm patient following information, by phone at number +849012345678.\n- Service: HIV treatment advisory appointment\n- Time: %s\n- Doctor: <Any doctor would be OK>\nThank you\nHaivy Limited Company.',
    to_char(p_meeting_date, 'Mon DD, YYYY - HH24:MI')
  );

  -- Call create_ticket edge function
  SELECT content::jsonb INTO v_response
  FROM http_post(
    v_supabase_url || '/functions/v1/create_ticket',
    jsonb_build_object(
      'ticket_sender', 'system', --not being used by the edge function
      'ticket_overview', 'Confirm patient information',
      'ticket_content', v_ticket_content
    )::text,
    'application/json'
  );

  -- Insert appointment with ticket_id
  INSERT INTO Appointment (
    duration,
    meeting_date,
    visibility,
    staff_id,
    patient_uid,
    status,
    created_date,
    ticket_id
  ) VALUES (
    p_duration,
    p_meeting_date,
    p_isPublic,
    p_requested_doctor,
    p_patient,
    'pending'::apt_status,
    NOW(),
    (v_response->'data'->>'ticketId')::UUID
  ) RETURNING appointment_id INTO v_appointment_id;

  RETURN v_appointment_id;
END;
$$ LANGUAGE plpgsql;