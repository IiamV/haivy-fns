import "https://deno.land/std@0.168.0/dotenv/load.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
serve(async (req)=>{
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const body = await req.json().catch((err)=>{
    console.error("Invalid JSON:", err);
    throw err;
  });
  const { ticket_sender, ticket_overview, ticket_content } = body;
  const { data: staffList } = await supabase.from("staff").select("staff_id").eq("status", true);
  const staffWithTickets = await Promise.all(staffList.map(async (staff)=>{
    const { count, error } = await supabase.from("ticket").select("ticket_id", {
      count: "exact",
      head: true
    }).eq("assigned_to", staff.staff_id).eq("status", "pending");
    if (error) console.error(`Ticket count error for ${staff.staff_id}:`, error);
    return {
      staffId: staff.staff_id,
      ticketCount: count ?? 0
    };
  }));
  const staffWithLeastTickets = staffWithTickets.sort((a, b)=>a.ticketCount - b.ticketCount)[0];
  const ticketData = {
    assigned_to: staffWithLeastTickets.staffId,
    date_created: new Date().toISOString().split("T")[0],
    ticket_type: "appointment",
    content: ticket_content,
    title: ticket_overview,
    status: "pending",
    created_by: null
  };
  const { data: insertedTicket } = await supabase.from("ticket").insert(ticketData).select("ticket_id");
  const ticketId = insertedTicket?.[0]?.ticket_id;
  return new Response(JSON.stringify({
    success: true,
    message: "Ticket created",
    data: {
      ticketId,
      assignedTo: staffWithLeastTickets.staffId,
      ticketCount: staffWithLeastTickets.ticketCount
    }
  }), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}); 
/*

To test it locally

  curl -L -X POST 'https://[LINK]]/functions/v1/[FUNCTION_NAME]' \
    -H 'Authorization: Bearer [KEY]' \
    -H 'Content-Type: application/json' \
    --data '{"name":"value"}'

*/
