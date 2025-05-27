CREATE OR REPLACE FUNCTION createAppointment(
  p_duration INTEGER,
  p_meeting_date TIMESTAMPTZ,
  p_isPublic BOOLEAN,
  p_requested_doctor UUID,
  p_patient UUID
)
RETURNS UUID
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_content TEXT;
  v_response TEXT;
  v_supabase_url TEXT;
BEGIN
  -- Insert appointment
  INSERT INTO appointments (
    duration,
    meeting_date,
    visibility,
    staff_id,
    patient_uid,
    status,
    created_date
  ) VALUES (
    p_duration,
    p_meeting_date,
    p_isPublic,
    p_requested_doctor,
    p_patient,
    'pending'::appointment_status_enum,
    NOW()
  );

  -- Create ticket content
  v_ticket_content := format(
    'Overview: Confirm patient information.\nPlease confirm patient following information, by phone at number +849012345678.\n-Service: HIV treatment advisory appointment.\n-Time: %s.\n-Doctor: <Any doctor would be OK>.\nThank you.\nHaivy Limited Company.', to_char(p_meeting_date, 'Mon DD, YYYY - HH24:MI')
  );

  -- Call create_ticket edge function
  SELECT content INTO v_response
  FROM http((
    'POST',
    v_supabase_url || '/functions/v1/create_ticket',
    ARRAY[http_header('Content-Type', 'application/json')],
    jsonb_build_object(
      'ticket_sender', 'system',
      'ticket_overview', 'Confirm patient information',
      'ticket_content', v_ticket_content
    )::text
  )::http_request);

  RETURN v_appointment_uid;
END;
$$ LANGUAGE plpgsql;