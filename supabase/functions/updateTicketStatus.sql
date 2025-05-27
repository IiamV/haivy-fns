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