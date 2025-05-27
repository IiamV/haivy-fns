CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS http;

-- Create enumerated type: account_type
CREATE TYPE public.account_type AS ENUM ('staff', 'patient');

-- Create enumerated type: apt_status
CREATE TYPE public.apt_status AS ENUM ('pending', 'scheduled', 'in progress', 'completed', 'canceled', 'no show');

-- Create enumerated type: med_timing
CREATE TYPE public.med_timing AS ENUM ('empty stomach', 'before meal', 'with meal', 'after meal');

-- Create enumerated type: staff_role
CREATE TYPE public.staff_role AS ENUM ('doctor', 'staff', 'manager', 'admin');

-- Create enumerated type: ticket_interaction_type
CREATE TYPE public.ticket_interaction_type AS ENUM ('create', 'forward', 'dismiss', 'processed', 'other', 'comment');

-- Create enumerated type: ticket_type
CREATE TYPE public.ticket_type AS ENUM ('appointment', 'test', 'other');

-- Create enumerated type: tik_status
CREATE TYPE public.tik_status AS ENUM ('pending', 'booked', 'closed', 'canceled');

-- Create sequence for random_name_pool
CREATE SEQUENCE IF NOT EXISTS random_name_pool_id_seq;

create table random_name_pool(
  id integer primary key default nextval('random_name_pool_id_seq'::regclass),
  name text
);
-----------------------------------
-- account table  YES
create table AccountDetails(-- contains basic information of an account
  account_uid uuid primary key references auth.users(id) on delete cascade,
  first_name varchar(50), -- can be null and dummy name is auto-generated
  last_name varchar(50), -- can be null and dummy name is auto-generated
  dob date, -- can be null
  profile_picture text, -- can be null
  account_type account_type DEFAULT 'patient'::account_type
);
-----------------------------------
--patient table  YES
create table Patient(
  patient_uid uuid primary key default gen_random_uuid(), 
  account_uid uuid references auth.users(id),
  anonymous_status boolean default true -- when a patient has an account, can be use to set visibility of patient information
);
-----------------------------------
--staff table  YES
create table Staff(
  staff_id uuid primary key default gen_random_uuid(),
  account_uid uuid references auth.users(id),
  role staff_role,
  join_date date default now(),
  status boolean  
);
-----------------------------------
--ticket table  YES
create table Ticket(
  ticket_id uuid primary key default gen_random_uuid(),
  assigned_to uuid references Staff(staff_id),
  date_created date default now(),
  content text,
  status tik_status default 'pending'::tik_status,
  title text,
  ticket_type ticket_type default 'other'::ticket_type,
  created_by uuid references auth.users(id)
);
-----------------------------------
--appointment table  YES
create table Appointment(
  appointment_id uuid primary key default gen_random_uuid(),
  staff_id uuid references Staff(staff_id),
  ticket_id uuid references Ticket(ticket_id),
  patient_uid uuid references Patient(patient_uid),
  created_date timestamptz,
  meeting_date timestamptz,
  content text,
  visibility boolean,
  status apt_status default 'pending'::apt_status,
  duration integer not null default 30::smallint
);
-----------------------------------
--Doctor specification  YES
create table Specification(
  specification_id uuid primary key default gen_random_uuid(),
  name varchar(50),
  achieved_date date,
  level integer
);

create table DoctorSpecification(
  staff_id uuid references Staff(staff_id),
  specification_id uuid references Specification(specification_id),
  primary key(staff_id, specification_id)
);
-----------------------------------
--doctor schedule  YES
create table DaySession(
  day_session varchar(20) primary key default gen_random_uuid(),
  start_time time,
  end_time time,
  location varchar(50),
  status boolean -- true for Available and false for Busy
);
create table WeekDay(
  day_of_week varchar(20),
  day_session varchar(20) references DaySession(day_session),
  primary key (day_of_week, day_session)
);
create table DoctorSchedule(
  staff_id uuid references Staff(staff_id),
  day_of_week varchar(20),
  day_session varchar(20),
  foreign key (day_of_week, day_session) references WeekDay(day_of_week, day_session),
  primary key (staff_id, day_of_week, day_session)
);
-----------------------------------
-- --regimen associated  YES
/*
explanation:  
1.empty stomach ->  at least 1hr before meal or ~2hr after meal
2.before meal -> ~15-30min before meal
3.with meal -> taken together when having meal
4. after meal -> ~15-30min after a meal
the enums can be compared as numbered (ex: empty stomach < before meal)
*/
create table Medicine(
  medicine_id uuid primary key default gen_random_uuid(),
  name varchar(50),
  description text,
  is_available boolean,
  med_time med_timing
);
-----------------------------------
--prescription table  YES
create table Prescription(
  prescription_id uuid primary key default gen_random_uuid(),
  name varchar(50),
  note text
);
create table PrescriptionDetail(
  prescription_detail_id uuid primary key default gen_random_uuid(),
  prescription_id uuid references Prescription(prescription_id),
  medicine_id uuid references Medicine(medicine_id),
  start_time timestamptz,
  end_time timestamptz,
  dosage float,
  interval integer,
  note text
);
-----------------------------------
-- customized regimen  YES
create table CustomizedRegimen(
  cus_regimen_id uuid primary key default gen_random_uuid(),
  name varchar(50),
  description text,
  create_time date
);
create table CustomizedRegimenDetail(
  cus_regimen_detail_id uuid primary key default gen_random_uuid(),
  cus_regimen_id uuid references CustomizedRegimen(cus_regimen_id),
  prescription_id uuid references Prescription(prescription_id),
  start_date date,
  end_date date,
  total_dosage float,
  frequency integer,
  note text
);
-----------------------------------
-- original regimen  YES
create table Regimen(
  regimen_id uuid primary key default gen_random_uuid(),
  name varchar(50),
  create_date date,
  description text
);
create table RegimenDetail(
  regimen_detail_id uuid primary key default gen_random_uuid(),
  regimen_id uuid references Regimen(regimen_id),
  medicine_id uuid references Medicine(medicine_id),
  start_date date,
  end_date date,
  total_dosage float,
  frequency integer,
  note text
);
-----------------------------------
--patient medicine intake history  YES
create table IntakeHistory(
  intake_id uuid primary key default gen_random_uuid(),
  patient_uid uuid references Patient(patient_uid),
  prescription_id uuid references Prescription(prescription_id),
  take_time timestamptz,
  missed boolean,
  note text,
  remind_inc_appointment boolean
);

create table ticket_interaction_history(
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id uuid references Ticket(ticket_id),
  time timestamptz default now(),
  action ticket_interaction_type default 'other'::ticket_interaction_type,
  note text,
  by uuid default auth.uid()
);

-- Function 1: add_ticket_comment
CREATE OR REPLACE FUNCTION public.add_ticket_comment(tid UUID, content TEXT)
RETURNS VOID AS $$
BEGIN
    INSERT INTO ticket_interaction_history (ticket_id, action, note)
    VALUES (tid, 'comment'::ticket_interaction_type, content);
END;
$$ LANGUAGE plpgsql;

-- Function 2: forward_ticket
CREATE OR REPLACE FUNCTION public.forward_ticket(from_staff UUID, to_staff UUID)
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.ticket_interaction_history (ticket_id, action, note)
    VALUES (ticket_id, 'forward', 'Forwarded from ' || from_staff || ' to ' || to_staff);
    UPDATE public.ticket
    SET assigned_to = to_staff
    WHERE assigned_to = from_staff;
END;
$$ LANGUAGE plpgsql;

-- Function 3: get_account_details
CREATE OR REPLACE FUNCTION public.get_account_details()
RETURNS JSON AS $$
DECLARE
    acc_uid UUID;
    acc_details JSON;
    acc_auth_details JSON;
BEGIN
    SELECT (auth.uid()) INTO acc_uid;
    SELECT to_json(ad) INTO acc_details FROM accountdetails ad WHERE ad.account_uid = acc_uid;
    SELECT to_json(r) INTO acc_auth_details FROM (SELECT email, phone FROM auth.users WHERE id = acc_uid) r;
    RETURN acc_details::jsonb || acc_auth_details::jsonb;
END;
$$ LANGUAGE plpgsql;

-- Function 4: get_all_tickets
CREATE OR REPLACE FUNCTION public.get_all_tickets()
RETURNS JSON AS $$
DECLARE
    content JSON;
    results JSON;
BEGIN
    SELECT json_agg(ticket) INTO content FROM ticket;
    results := json_build_object(
        'tickets', COALESCE(content, '[]'::json)
    );
    RETURN results;
END;
$$ LANGUAGE plpgsql;

-- Function 5: get_display_name
CREATE OR REPLACE FUNCTION public.get_display_name(uid UUID)
RETURNS TEXT AS $$
DECLARE
    full_name TEXT;
BEGIN
    SELECT first_name || ' ' || last_name INTO full_name
    FROM accountdetails
    WHERE uid = account_uid;
    RETURN full_name;
END;
$$ LANGUAGE plpgsql;

-- Function 6: get_doctor_schedule_with_date
CREATE OR REPLACE FUNCTION public.get_doctor_schedule_with_date(date_required DATE)
RETURNS JSON AS $$
DECLARE 
    json_result json;
BEGIN
    SELECT json_agg(
        jsonb_build_object(
        'meeting_date', apt.meeting_date,
        'duration', apt.duration,
        'status', apt.status,
        'content', apt.content,
        'patient_information', jsonb_build_object(
            'uuid', pt.patient_uid,
            'account_uid', ad.account_uid,
            'full_name', concat(ad.first_name,' ', ad.last_name),
            'dob', ad.dob,
            'profile_picture', ad.profile_picture,
            'account_type', ad.account_type
        ),
        'ticket_id', ti.ticket_id
        )
    ) INTO json_result
    FROM appointment apt
    JOIN ticket ti ON ti.assigned_to = apt.ticket_id
    JOIN patient pt ON pt.patient_uid = apt.patient_uid
    JOIN accountdetails ad ON ad.account_uid = apt.staff_id
    WHERE apt.meeting_date = date_required;

    RETURN json_result;
END;
$$ LANGUAGE plpgsql;

-- Function 7: get_random_name
CREATE OR REPLACE FUNCTION public.get_random_name()
RETURNS TEXT AS $$
DECLARE
    random_name TEXT;
BEGIN
    SELECT name INTO random_name
    FROM random_name_pool
    ORDER BY RANDOM()
    LIMIT 1;
    RETURN random_name;
END;
$$ LANGUAGE plpgsql;

-- Function 8: get_ticket_details
CREATE OR REPLACE FUNCTION public.get_ticket_details(tid UUID)
RETURNS JSON AS $$
DECLARE 
    content JSON;
    history JSON;
    apt JSON;
    result JSON;
BEGIN
    -- Fetch the ticket data
    SELECT 
        to_jsonb(tic) || jsonb_build_object(
            'created_by', to_jsonb(ad)
        ) AS result
    INTO content
    FROM ticket tic
    LEFT JOIN accountdetails ad ON tic.created_by = ad.account_uid
    WHERE ticket_id = tid;

    -- Fetch interaction history
    SELECT json_agg(
        jsonb_set(
            to_jsonb(tih)::jsonb,
            '{by}',
            to_jsonb(ad)::jsonb,
            true
        )
    ) INTO history
    FROM ticket_interaction_history tih
    LEFT JOIN accountdetails ad ON tih.by = ad.account_uid
    WHERE ticket_id = tid;

    -- Fetch appointments
    SELECT json_agg(appointment) INTO apt 
    FROM appointment
    WHERE appointment.ticket_id = tid; 

    -- Build the final result
    result := json_build_object(
        'ticket', content,
        'interactions', COALESCE(history, '[]'::json),
        'appointments', COALESCE(apt, '[]'::json)
    );

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function 9: get_user_basic_info
CREATE OR REPLACE FUNCTION public.get_user_basic_info(uid UUID)
RETURNS JSON AS $$
DECLARE
    results JSON;
BEGIN
    SELECT row_to_json(ad)
    INTO results
    FROM accountdetails ad
    WHERE ad.account_uid = uid;
    RETURN results;
END;
$$ LANGUAGE plpgsql;

-- Function 10: handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.accountdetails (account_uid)
    VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function 11: get_full_name (referenced in log_new_ticket)
CREATE OR REPLACE FUNCTION public.get_full_name(uid UUID)
RETURNS TEXT AS $$
DECLARE
    full_name TEXT;
BEGIN
    SELECT COALESCE(first_name || ' ' || last_name, 'Unknown User') INTO full_name
    FROM accountdetails
    WHERE account_uid = uid;
    RETURN full_name;
END;
$$ LANGUAGE plpgsql;

-- Function 12: updateTicketStatus
CREATE OR REPLACE FUNCTION public.updateTicketStatus(
    ticket_id UUID,
    new_status tik_status
)
RETURNS VOID
SECURITY DEFINER --allow any user to run this func
AS $$
DECLARE
    current_user_id UUID;
    assigned_staff_id UUID;
    current_status tik_status;
BEGIN
    -- Get current user ID
    SELECT auth.uid() INTO current_user_id;
    
    -- Get the ticket assigned staff and current status
    SELECT t.assigned_to, t.status
    INTO assigned_staff_id, current_status
    FROM ticket t
    WHERE t.ticket_id = updateTicketStatus.ticket_id;
 
    
    -- Check if the current user == assigned staff
    IF NOT EXISTS (
        SELECT 1 FROM staff s 
        WHERE s.staff_id = assigned_staff_id 
        AND s.account_uid = current_user_id
        AND s.status = true
    ) THEN
        INSERT INTO ticket_interaction_history (ticket_id, action, note, by)
        VALUES (
            updateTicketStatus.ticket_id, 
            'dismiss'::ticket_interaction_type, 
            'Authorization denied',
            current_user_id
        );
        RETURN;
    END IF;
    
    -- Logs no changes
    IF current_status = new_status THEN
        INSERT INTO ticket_interaction_history (ticket_id, action, note)
        VALUES (
            updateTicketStatus.ticket_id, 
            'comment'::ticket_interaction_type, 
            'Status update but no change needed (already ' || current_status || ')'
        );
        RETURN;
    END IF;
    
    -- Update the ticket status
    UPDATE ticket 
    SET status = new_status 
    WHERE ticket.ticket_id = updateTicketStatus.ticket_id;
    
    -- Log the change in interaction history
    INSERT INTO ticket_interaction_history (ticket_id, action, note, by)
    VALUES (
        updateTicketStatus.ticket_id, 
        'processed'::ticket_interaction_type,
        'Status changed from ' || current_status || ' to ' || new_status, 
        current_user_id
    );
    
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION public.updateTicketStatus(UUID, tik_status) TO authenticated;


-- Function 13: log_new_ticket
-- createAppointment Database Function that calls create_ticket edge function 
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


-- Function 14: log_new_ticket
CREATE OR REPLACE FUNCTION public.log_new_ticket()
RETURNS TRIGGER AS $$
DECLARE
    caller_uid UUID;
    full_name TEXT;
BEGIN
    -- Get the caller's UID
    SELECT auth.uid() INTO caller_uid;

    IF caller_uid IS NULL THEN
        full_name := 'System';
    ELSE
        -- Get the full name based on the UID
        SELECT public.get_full_name(caller_uid) INTO full_name;
    END IF;

    -- Insert into ticket_interaction_history with full name
    INSERT INTO ticket_interaction_history (ticket_id, action, note)
    VALUES (
        NEW.ticket_id,
        'create'::ticket_interaction_type,
        'Ticket created by ' || full_name
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER ticket_creation
AFTER INSERT ON public.ticket
FOR EACH ROW
EXECUTE FUNCTION public.log_new_ticket();