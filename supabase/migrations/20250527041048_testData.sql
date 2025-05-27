-- Fixed Test Data Script for Supabase Local
-- This script creates test users in auth.users and populates all tables correctly

DO $$
DECLARE
    user_ids UUID[] := ARRAY[
        '550e8400-e29b-41d4-a716-446655440000', -- john.smith@example.com
        '6ba7b810-9dad-11d1-80b4-00c04fd430c8', -- jane.doe@example.com
        'f47ac10b-58cc-4372-a567-0e02b2c3d479', -- michael.brown@example.com
        '1629f8d2-1b3b-4e2a-9f4d-29e8f5a4b3c1', -- emily.davis@example.com
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890'  -- william.johnson@example.com
    ];
    temp_staff_ids UUID[];
    temp_patient_ids UUID[];
    temp_ticket_ids UUID[];
BEGIN
    -- Step 1: Insert test users into auth.users (if they don't exist)
    -- Note: In production, users would be created through Supabase Auth
    INSERT INTO auth.users (
        id, 
        email, 
        encrypted_password, 
        email_confirmed_at, 
        created_at, 
        updated_at,
        aud,
        role
    ) 
    SELECT 
        user_id,
        CASE 
            WHEN user_id = user_ids[1] THEN 'john.smith@example.com'
            WHEN user_id = user_ids[2] THEN 'jane.doe@example.com'
            WHEN user_id = user_ids[3] THEN 'michael.brown@example.com'
            WHEN user_id = user_ids[4] THEN 'emily.davis@example.com'
            WHEN user_id = user_ids[5] THEN 'william.johnson@example.com'
        END,
        crypt('password123', gen_salt('bf')), -- Default password for all test users
        NOW(),
        NOW(),
        NOW(),
        'authenticated',
        'authenticated'
    FROM unnest(user_ids) AS user_id
    WHERE NOT EXISTS (
        SELECT 1 FROM auth.users WHERE id = user_id
    );

    -- Step 2: Insert into random_name_pool
    INSERT INTO random_name_pool (name) VALUES
    ('John Smith'), ('Jane Doe'), ('Michael Brown'), ('Emily Davis'), ('William Johnson'),
    ('Sarah Wilson'), ('David Lee'), ('Laura Martinez'), ('James Taylor'), ('Anna Clark')
    ON CONFLICT DO NOTHING;

    -- Step 3: Insert into AccountDetails (using correct enum values)
    INSERT INTO AccountDetails (account_uid, first_name, last_name, dob, profile_picture, account_type) VALUES
    (user_ids[1], 'John', 'Smith', '1985-03-15', 'https://example.com/profiles/john.jpg', 'patient'::account_type),
    (user_ids[2], 'Jane', 'Doe', '1990-07-22', 'https://example.com/profiles/jane.jpg', 'staff'::account_type),
    (user_ids[3], 'Michael', 'Brown', '1978-11-30', NULL, 'staff'::account_type),
    (user_ids[4], 'Emily', 'Davis', '1995-04-12', 'https://example.com/profiles/emily.jpg', 'staff'::account_type),
    (user_ids[5], 'William', 'Johnson', '1982-09-05', NULL, 'staff'::account_type)
    ON CONFLICT (account_uid) DO NOTHING;

    -- Step 4: Insert into Patient (5 patients, some with multiple entries)
    INSERT INTO Patient (patient_uid, account_uid, anonymous_status) VALUES
    (gen_random_uuid(), user_ids[1], true),   -- John as patient
    (gen_random_uuid(), user_ids[1], false),  -- John second patient record
    (gen_random_uuid(), user_ids[2], true),   -- Jane as patient
    (gen_random_uuid(), user_ids[3], false),  -- Michael as patient  
    (gen_random_uuid(), user_ids[4], true);   -- Emily as patient
    
    -- Get patient IDs for later use
    SELECT ARRAY(SELECT patient_uid FROM Patient ORDER BY patient_uid) INTO temp_patient_ids;

    -- Step 5: Insert into Staff (4 staff members)
    INSERT INTO Staff (staff_id, account_uid, role, join_date, status) VALUES
    (gen_random_uuid(), user_ids[2], 'staff'::staff_role, '2022-06-01', true),     -- Jane: staff
    (gen_random_uuid(), user_ids[3], 'manager'::staff_role, '2021-03-10', true),   -- Michael: manager
    (gen_random_uuid(), user_ids[4], 'doctor'::staff_role, '2023-07-05', true),    -- Emily: doctor
    (gen_random_uuid(), user_ids[5], 'admin'::staff_role, '2020-11-20', true);     -- William: admin
    
    -- Get staff IDs for later use
    SELECT ARRAY(SELECT staff_id FROM Staff ORDER BY staff_id) INTO temp_staff_ids;

    -- Step 6: Insert into Ticket
    INSERT INTO Ticket (ticket_id, assigned_to, date_created, content, status, title, ticket_type, created_by) VALUES
    (gen_random_uuid(), temp_staff_ids[3], CURRENT_DATE, 'Check-up request', 'pending'::tik_status, 'Routine Check-up', 'appointment'::ticket_type, user_ids[1]),
    (gen_random_uuid(), temp_staff_ids[3], CURRENT_DATE, 'Lab test needed', 'booked'::tik_status, 'Blood Test', 'test'::ticket_type, user_ids[1]),
    (gen_random_uuid(), NULL, CURRENT_DATE, 'General inquiry', 'pending'::tik_status, 'Question about services', 'other'::ticket_type, user_ids[2]),
    (gen_random_uuid(), temp_staff_ids[2], CURRENT_DATE, 'Reschedule request', 'canceled'::tik_status, 'Reschedule Appointment', 'appointment'::ticket_type, user_ids[3]),
    (gen_random_uuid(), temp_staff_ids[4], CURRENT_DATE, 'Billing issue', 'closed'::tik_status, 'Billing Inquiry', 'other'::ticket_type, user_ids[4]),
    (gen_random_uuid(), temp_staff_ids[3], CURRENT_DATE, 'Follow-up needed', 'pending'::tik_status, 'Follow-up Visit', 'appointment'::ticket_type, user_ids[1]),
    (gen_random_uuid(), temp_staff_ids[1], CURRENT_DATE, 'Test result query', 'booked'::tik_status, 'Test Results', 'test'::ticket_type, user_ids[2]),
    (gen_random_uuid(), NULL, CURRENT_DATE, 'General feedback', 'pending'::tik_status, 'Feedback', 'other'::ticket_type, user_ids[3]),
    (gen_random_uuid(), temp_staff_ids[3], CURRENT_DATE, 'Consultation request', 'pending'::tik_status, 'Specialist Consultation', 'appointment'::ticket_type, user_ids[4]),
    (gen_random_uuid(), temp_staff_ids[2], CURRENT_DATE, 'Complaint', 'closed'::tik_status, 'Service Complaint', 'other'::ticket_type, user_ids[5]);
    
    -- Get ticket IDs for later use
    SELECT ARRAY(SELECT ticket_id FROM Ticket ORDER BY ticket_id) INTO temp_ticket_ids;

    -- Step 7: Insert into Appointment (using only doctor staff_id)
    INSERT INTO Appointment (
        appointment_id, 
        staff_id, 
        ticket_id, 
        patient_uid, 
        created_date, 
        meeting_date, 
        content, 
        visibility, 
        status, 
        duration
    ) VALUES
    (gen_random_uuid(), temp_staff_ids[3], temp_ticket_ids[1], temp_patient_ids[1], NOW(), NOW() + INTERVAL '5 days', 'Annual check-up', true, 'scheduled'::apt_status, 30),
    (gen_random_uuid(), temp_staff_ids[3], temp_ticket_ids[2], temp_patient_ids[2], NOW(), NOW() + INTERVAL '6 days', 'Blood panel test', false, 'scheduled'::apt_status, 15),
    (gen_random_uuid(), temp_staff_ids[3], temp_ticket_ids[6], temp_patient_ids[3], NOW(), NOW() + INTERVAL '7 days', 'Follow-up after test', true, 'pending'::apt_status, 30),
    (gen_random_uuid(), temp_staff_ids[3], temp_ticket_ids[9], temp_patient_ids[4], NOW(), NOW() + INTERVAL '8 days', 'Cardiology consultation', true, 'pending'::apt_status, 45),
    (gen_random_uuid(), temp_staff_ids[3], temp_ticket_ids[1], temp_patient_ids[5], NOW(), NOW() + INTERVAL '9 days', 'General health check', false, 'scheduled'::apt_status, 30);

    -- Step 8: Insert into Specification
    INSERT INTO Specification (specification_id, name, achieved_date, level) VALUES
    (gen_random_uuid(), 'Cardiology', '2018-05-10', 3),
    (gen_random_uuid(), 'Neurology', '2019-07-15', 2),
    (gen_random_uuid(), 'Pediatrics', '2020-03-20', 1),
    (gen_random_uuid(), 'Oncology', '2017-11-01', 4),
    (gen_random_uuid(), 'Dermatology', '2021-06-25', 2),
    (gen_random_uuid(), 'Orthopedics', '2016-09-12', 3),
    (gen_random_uuid(), 'Endocrinology', '2019-02-18', 2),
    (gen_random_uuid(), 'Gastroenterology', '2020-08-05', 1),
    (gen_random_uuid(), 'Psychiatry', '2018-12-30', 3),
    (gen_random_uuid(), 'Radiology', '2021-04-15', 2);

    -- Step 9: Insert into DoctorSpecification (only for doctor)
    INSERT INTO DoctorSpecification (staff_id, specification_id) 
    SELECT 
        temp_staff_ids[3], -- Emily (doctor)
        specification_id
    FROM Specification 
    LIMIT 5; -- Give Emily 5 specializations

    -- Step 10: Insert into DaySession
    INSERT INTO DaySession (day_session, start_time, end_time, location, status) VALUES
    ('Morning1', '08:00:00', '10:00:00', 'Clinic A', true),
    ('Morning2', '10:00:00', '12:00:00', 'Clinic B', true),
    ('Afternoon1', '13:00:00', '15:00:00', 'Clinic A', true),
    ('Afternoon2', '15:00:00', '17:00:00', 'Clinic B', false),
    ('Evening1', '17:00:00', '19:00:00', 'Clinic C', true),
    ('Morning3', '09:00:00', '11:00:00', 'Clinic A', true),
    ('Morning4', '11:00:00', '13:00:00', 'Clinic B', true),
    ('Afternoon3', '14:00:00', '16:00:00', 'Clinic C', false),
    ('Afternoon4', '16:00:00', '18:00:00', 'Clinic A', true),
    ('Evening2', '18:00:00', '20:00:00', 'Clinic B', true)
    ON CONFLICT (day_session) DO NOTHING;

    -- Step 11: Insert into WeekDay
    INSERT INTO WeekDay (day_of_week, day_session) VALUES
    ('Monday', 'Morning1'),
    ('Tuesday', 'Morning2'),
    ('Wednesday', 'Afternoon1'),
    ('Thursday', 'Afternoon2'),
    ('Friday', 'Evening1'),
    ('Monday', 'Morning3'),
    ('Tuesday', 'Morning4'),
    ('Wednesday', 'Afternoon3'),
    ('Thursday', 'Afternoon4'),
    ('Friday', 'Evening2')
    ON CONFLICT (day_of_week, day_session) DO NOTHING;

    -- Step 12: Insert into DoctorSchedule (only for doctor)
    INSERT INTO DoctorSchedule (staff_id, day_of_week, day_session) VALUES
    (temp_staff_ids[3], 'Monday', 'Morning1'),
    (temp_staff_ids[3], 'Tuesday', 'Morning2'),
    (temp_staff_ids[3], 'Wednesday', 'Afternoon1'),
    (temp_staff_ids[3], 'Thursday', 'Afternoon2'),
    (temp_staff_ids[3], 'Friday', 'Evening1')
    ON CONFLICT (staff_id, day_of_week, day_session) DO NOTHING;

    -- Step 13: Insert into Medicine
    INSERT INTO Medicine (medicine_id, name, description, is_available, med_time) VALUES
    (gen_random_uuid(), 'Aspirin', 'Pain reliever', true, 'with meal'::med_timing),
    (gen_random_uuid(), 'Metformin', 'Diabetes management', true, 'with meal'::med_timing),
    (gen_random_uuid(), 'Amoxicillin', 'Antibiotic', true, 'after meal'::med_timing),
    (gen_random_uuid(), 'Ibuprofen', 'Anti-inflammatory', true, 'with meal'::med_timing),
    (gen_random_uuid(), 'Lisinopril', 'Blood pressure control', true, 'before meal'::med_timing),
    (gen_random_uuid(), 'Omeprazole', 'Acid reflux treatment', true, 'empty stomach'::med_timing),
    (gen_random_uuid(), 'Atorvastatin', 'Cholesterol management', true, 'after meal'::med_timing),
    (gen_random_uuid(), 'Levothyroxine', 'Thyroid hormone', true, 'empty stomach'::med_timing),
    (gen_random_uuid(), 'Sertraline', 'Antidepressant', true, 'with meal'::med_timing),
    (gen_random_uuid(), 'Loratadine', 'Antihistamine', true, 'before meal'::med_timing);

    -- Step 14: Insert into Prescription
    INSERT INTO Prescription (prescription_id, name, note) VALUES
    (gen_random_uuid(), 'Pain Relief', 'For headache'),
    (gen_random_uuid(), 'Diabetes Control', 'Monitor blood sugar'),
    (gen_random_uuid(), 'Infection Treatment', 'Complete course'),
    (gen_random_uuid(), 'Anti-inflammatory', 'Take with food'),
    (gen_random_uuid(), 'Hypertension', 'Monitor BP'),
    (gen_random_uuid(), 'Acid Reflux', 'Take in morning'),
    (gen_random_uuid(), 'Cholesterol', 'Take at night'),
    (gen_random_uuid(), 'Thyroid', 'Take on empty stomach'),
    (gen_random_uuid(), 'Depression', 'Monitor mood'),
    (gen_random_uuid(), 'Allergy Relief', 'Take as needed');

    -- Step 15: Insert into PrescriptionDetail
    INSERT INTO PrescriptionDetail (prescription_detail_id, prescription_id, medicine_id, start_time, end_time, dosage, interval, note) 
    SELECT 
        gen_random_uuid(),
        p.prescription_id,
        m.medicine_id,
        NOW(),
        NOW() + INTERVAL '7 days',
        500.0,
        8,
        'Take as prescribed'
    FROM Prescription p
    CROSS JOIN Medicine m
    WHERE p.name = 'Pain Relief' AND m.name = 'Aspirin'
    LIMIT 1;

    -- Add more prescription details
    INSERT INTO PrescriptionDetail (prescription_detail_id, prescription_id, medicine_id, start_time, end_time, dosage, interval, note) 
    SELECT 
        gen_random_uuid(),
        p.prescription_id,
        m.medicine_id,
        NOW(),
        NOW() + INTERVAL '30 days',
        1000.0,
        12,
        'Monitor glucose'
    FROM Prescription p
    CROSS JOIN Medicine m
    WHERE p.name = 'Diabetes Control' AND m.name = 'Metformin'
    LIMIT 1;

    -- Step 16: Insert into CustomizedRegimen
    INSERT INTO CustomizedRegimen (cus_regimen_id, name, description, create_time) VALUES
    (gen_random_uuid(), 'Pain Management', 'For chronic pain', CURRENT_DATE),
    (gen_random_uuid(), 'Diabetes Plan', 'Blood sugar control', CURRENT_DATE),
    (gen_random_uuid(), 'Infection Control', 'Antibiotic regimen', CURRENT_DATE),
    (gen_random_uuid(), 'Inflammation Relief', 'Anti-inflammatory plan', CURRENT_DATE),
    (gen_random_uuid(), 'BP Management', 'Hypertension control', CURRENT_DATE);

    -- Step 17: Insert into CustomizedRegimenDetail
    INSERT INTO CustomizedRegimenDetail (cus_regimen_detail_id, cus_regimen_id, prescription_id, start_date, end_date, total_dosage, frequency, note) 
    SELECT 
        gen_random_uuid(),
        cr.cus_regimen_id,
        p.prescription_id,
        CURRENT_DATE,
        CURRENT_DATE + INTERVAL '7 days',
        3500.0,
        3,
        'Take with meals'
    FROM CustomizedRegimen cr
    CROSS JOIN Prescription p
    WHERE cr.name = 'Pain Management' AND p.name = 'Pain Relief'
    LIMIT 1;

    -- Step 18: Insert into Regimen
    INSERT INTO Regimen (regimen_id, name, create_date, description) VALUES
    (gen_random_uuid(), 'Standard Pain Relief', CURRENT_DATE, 'General pain management'),
    (gen_random_uuid(), 'Standard Diabetes', CURRENT_DATE, 'Diabetes control'),
    (gen_random_uuid(), 'Standard Antibiotic', CURRENT_DATE, 'Infection treatment'),
    (gen_random_uuid(), 'Standard Anti-inflammatory', CURRENT_DATE, 'Inflammation relief'),
    (gen_random_uuid(), 'Standard Hypertension', CURRENT_DATE, 'Blood pressure control');

    -- Step 19: Insert into RegimenDetail
    INSERT INTO RegimenDetail (regimen_detail_id, regimen_id, medicine_id, start_date, end_date, total_dosage, frequency, note) 
    SELECT 
        gen_random_uuid(),
        r.regimen_id,
        m.medicine_id,
        CURRENT_DATE,
        CURRENT_DATE + INTERVAL '7 days',
        3500.0,
        3,
        'Take with meals'
    FROM Regimen r
    CROSS JOIN Medicine m
    WHERE r.name = 'Standard Pain Relief' AND m.name = 'Aspirin'
    LIMIT 1;

    -- Step 20: Insert into IntakeHistory
    INSERT INTO IntakeHistory (intake_id, patient_uid, prescription_id, take_time, missed, note, remind_inc_appointment) 
    SELECT 
        gen_random_uuid(),
        temp_patient_ids[1],
        p.prescription_id,
        NOW() - INTERVAL '1 day',
        false,
        'Taken with breakfast',
        true
    FROM Prescription p
    WHERE p.name = 'Pain Relief'
    LIMIT 1;

    -- Add more intake history records
    INSERT INTO IntakeHistory (intake_id, patient_uid, prescription_id, take_time, missed, note, remind_inc_appointment) 
    SELECT 
        gen_random_uuid(),
        temp_patient_ids[2],
        p.prescription_id,
        NOW() - INTERVAL '2 days',
        true,
        'Missed dose',
        true
    FROM Prescription p
    WHERE p.name = 'Diabetes Control'
    LIMIT 1;

    -- Step 21: Insert into ticket_interaction_history
    INSERT INTO ticket_interaction_history (ticket_id, time, action, note, by) 
    SELECT 
        temp_ticket_ids[1],
        NOW() - INTERVAL '1 hour',
        'comment'::ticket_interaction_type,
        'Added note about patient history',
        user_ids[2];

    INSERT INTO ticket_interaction_history (ticket_id, time, action, note, by) 
    SELECT 
        temp_ticket_ids[2],
        NOW() - INTERVAL '2 hours',
        'forward'::ticket_interaction_type,
        'Forwarded to lab technician',
        user_ids[3];

    RAISE NOTICE 'Test data inserted successfully!';
    RAISE NOTICE 'Created % users, % staff members, % patients, % tickets, % appointments', 
        array_length(user_ids, 1), 
        array_length(temp_staff_ids, 1), 
        array_length(temp_patient_ids, 1), 
        array_length(temp_ticket_ids, 1), 
        (SELECT COUNT(*) FROM Appointment);

END $$;