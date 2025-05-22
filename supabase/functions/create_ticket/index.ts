// // Follow this setup guide to integrate the Deno language server with your editor:
import "https://deno.land/std@0.168.0/dotenv/load.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        },
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { ticket_sender, ticket_overview, ticket_content } = body;
    console.log("Received request body:", JSON.stringify(body, null, 2));
    if (!ticket_sender || !ticket_overview || !ticket_content) {
      return new Response(
        JSON.stringify({ error: "Missing required ticket information" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
    const combinedContent = `${ticket_overview}\n${ticket_content}`;
    const { data: staffList, error: staffError } = await supabase
      .from("staff")
      .select("staff_id")
      .eq("status", true);
    if (staffError) {
      console.error("Staff fetch error:", staffError);
      return new Response(
        JSON.stringify({ error: "Error fetching staff data", details: staffError.message }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
    console.log("Staff list:", staffList);
    if (!Array.isArray(staffList) || staffList.length === 0) {
      console.warn("No available staff members found or invalid staff list:", staffList);
      return new Response(
        JSON.stringify({ error: "No available staff members found" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
    const staffWithTickets = await Promise.all(
      staffList.map(async (staff) => {
        const { count, error } = await supabase
          .from("ticket")
          .select("ticket_id", { count: "exact", head: true })
          .eq("assigned_to", staff.staff_id)
          .eq("status", "pending");
        if (error) {
          console.error(`Error counting tickets for staff ${staff.staff_id}:`, error);
          return { staffId: staff.staff_id, ticketCount: 0 };
        }
        return {
          staffId: staff.staff_id,
          ticketCount: count ?? 0,
        };
      })
    );
    console.log("Staff with ticket counts:", staffWithTickets);
    const staffWithLeastTickets = staffWithTickets
      .sort((a, b) => a.ticketCount - b.ticketCount)[0];
    console.log("Selected staff member:", staffWithLeastTickets);
    const currentDate = new Date().toISOString().split("T")[0];
    const ticketData = {
      assigned_to: staffWithLeastTickets.staffId,
      date_created: currentDate,
      ticket_type: "appointment",
      content: combinedContent,
    };
    console.log("Attempting to insert ticket with data:", JSON.stringify(ticketData, null, 2));
    let insertError = null;
    let insertedTicket = null;
    try {
      console.log("Trying lowercase 'ticket' table name...");
      const result = await supabase
        .from("ticket")
        .insert(ticketData)
        .select();
      insertedTicket = result.data;
      insertError = result.error;
      if (!insertError) {
        console.log("Success with lowercase table name!");
      }
    } catch (err) {
      console.log("Lowercase table name failed, trying uppercase...");
      insertError = err;
    }
    if (insertError) {
      try {
        console.log("Trying uppercase 'Ticket' table name...");
        const result = await supabase
          .from("Ticket")
          .insert(ticketData)
          .select();
        insertedTicket = result.data;
        insertError = result.error;
        if (!insertError) {
          console.log("Success with uppercase table name!");
        }
      } catch (err) {
        console.log("Both table names failed");
        insertError = err;
      }
    }
    if (insertError) {
      console.error("Ticket insertion error occurred");
      console.error("Error object:", insertError);
      console.error("Error message:", insertError?.message);
      console.error("Error details:", insertError?.details);
      console.error("Error hint:", insertError?.hint);
      console.error("Error code:", insertError?.code);
      console.error("Full error JSON:", JSON.stringify(insertError, null, 2));
      console.log("Attempting basic connectivity test...");
      try {
        const testResult = await supabase
          .from("ticket")
          .select("ticket_id")
          .limit(1);
        console.log("Basic select test result:", testResult);
        if (testResult.error) {
          console.log("Basic select failed - table might not exist or be accessible");
          console.log("Select error:", JSON.stringify(testResult.error, null, 2));
        }
      } catch (testErr) {
        console.log("Basic connectivity test failed:", testErr);
      }
      let errorMessage = "Error creating ticket";
      if (insertError?.message) {
        errorMessage += `: ${insertError.message}`;
      }
      if (insertError?.details) {
        errorMessage += ` (Details: ${insertError.details})`;
      }
      if (insertError?.hint) {
        errorMessage += ` (Hint: ${insertError.hint})`;
      }
      return new Response(
        JSON.stringify({ 
          error: errorMessage,
          code: insertError?.code,
          details: insertError?.details,
          hint: insertError?.hint,
          debugInfo: "Check server logs for detailed debugging information"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
    console.log("Ticket inserted successfully:", insertedTicket);
    return new Response(
      JSON.stringify({
        success: true,
        message: "Ticket created successfully",
        ticketId: insertedTicket?.[0]?.ticket_id || "Unknown"
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    console.error("Error stack:", error?.stack);
    console.error("Error name:", error?.name);
    console.error("Error message:", error?.message);
    return new Response(
      JSON.stringify({ 
        error: "An unexpected error occurred", 
        details: error?.message || "Unknown error",
        type: error?.name || "Unknown error type"
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});