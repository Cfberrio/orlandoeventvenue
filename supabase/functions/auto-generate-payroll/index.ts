import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const url = new URL(req.url);
  const backfill = url.searchParams.get("backfill") === "true";

  console.log(`[auto-payroll] Starting run. backfill=${backfill}`);

  try {
    // Get current Orlando time components
    const nowUtc = new Date();
    const orlandoFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const orlandoTimeFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const todayOrlando = orlandoFormatter.format(nowUtc); // YYYY-MM-DD
    const currentTimeOrlando = orlandoTimeFormatter.format(nowUtc); // HH:MM:SS

    console.log(`[auto-payroll] Orlando date=${todayOrlando}, time=${currentTimeOrlando}`);

    // Query assignments that need payroll generation
    // We need to join bookings to check event date/time and status
    // and left join staff_payroll_items to find those without payroll
    let query = `
      SELECT 
        bsa.id AS assignment_id,
        bsa.staff_id,
        bsa.booking_id,
        bsa.status AS assignment_status,
        b.event_date,
        b.start_time,
        b.end_time,
        b.booking_type,
        b.status AS booking_status,
        b.payment_status
      FROM booking_staff_assignments bsa
      JOIN bookings b ON b.id = bsa.booking_id
      LEFT JOIN staff_payroll_items spi ON spi.assignment_id = bsa.id
      WHERE bsa.booking_id IS NOT NULL
        AND bsa.status != 'cancelled'
        AND b.status NOT IN ('cancelled', 'declined')
        AND b.payment_status IN ('deposit_paid', 'fully_paid')
        AND (
          (b.booking_type = 'daily' AND b.event_date < '${todayOrlando}'::date)
          OR
          (b.booking_type = 'hourly' AND (
            b.event_date < '${todayOrlando}'::date
            OR (b.event_date = '${todayOrlando}'::date AND b.end_time <= '${currentTimeOrlando}'::time)
          ))
        )
    `;

    if (!backfill) {
      query += ` AND spi.id IS NULL`;
    }

    query += ` GROUP BY bsa.id, bsa.staff_id, bsa.booking_id, bsa.status, b.event_date, b.start_time, b.end_time, b.booking_type, b.status, b.payment_status`;

    const { data: assignments, error: queryError } = await supabase.rpc(
      // Can't use rpc for raw SQL, use rest approach instead
    ).catch(() => ({ data: null, error: { message: "rpc not available" } }));

    // Use a different approach: query via postgrest
    // First get assignments with bookings where event has passed
    const { data: rawAssignments, error: assignmentError } = await supabase
      .from("booking_staff_assignments")
      .select(`
        id,
        staff_id,
        booking_id,
        status,
        bookings!inner (
          event_date,
          start_time,
          end_time,
          booking_type,
          status,
          payment_status
        )
      `)
      .not("booking_id", "is", null)
      .neq("status", "cancelled")
      .in("bookings.payment_status", ["deposit_paid", "fully_paid"])
      .not("bookings.status", "in", "(cancelled,declined)");

    if (assignmentError) {
      console.error("[auto-payroll] Assignment query error:", assignmentError);
      return new Response(
        JSON.stringify({ error: assignmentError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!rawAssignments || rawAssignments.length === 0) {
      console.log("[auto-payroll] No assignments found matching criteria.");
      return new Response(
        JSON.stringify({ processed: 0, skipped: 0, failed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter by event date/time in Orlando timezone
    const eligibleAssignments = rawAssignments.filter((a: any) => {
      const booking = a.bookings;
      if (!booking) return false;

      const eventDate = booking.event_date; // YYYY-MM-DD string
      if (booking.booking_type === "daily") {
        return eventDate < todayOrlando;
      } else {
        // hourly
        if (eventDate < todayOrlando) return true;
        if (eventDate === todayOrlando && booking.end_time) {
          return booking.end_time <= currentTimeOrlando;
        }
        return false;
      }
    });

    console.log(`[auto-payroll] ${eligibleAssignments.length} assignments with past events (from ${rawAssignments.length} total).`);

    // If not backfill, filter out those that already have payroll items
    let assignmentsToProcess = eligibleAssignments;
    if (!backfill && assignmentsToProcess.length > 0) {
      const assignmentIds = assignmentsToProcess.map((a: any) => a.id);
      const { data: existingPayroll, error: payrollCheckError } = await supabase
        .from("staff_payroll_items")
        .select("assignment_id")
        .in("assignment_id", assignmentIds);

      if (payrollCheckError) {
        console.error("[auto-payroll] Payroll check error:", payrollCheckError);
      } else if (existingPayroll) {
        const hasPayroll = new Set(existingPayroll.map((p: any) => p.assignment_id));
        assignmentsToProcess = assignmentsToProcess.filter(
          (a: any) => !hasPayroll.has(a.id)
        );
      }
    }

    console.log(`[auto-payroll] ${assignmentsToProcess.length} assignments to process.`);

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const assignment of assignmentsToProcess) {
      try {
        // Step a: Mark assignment as completed if not already
        if (assignment.status !== "completed") {
          const { error: updateError } = await supabase
            .from("booking_staff_assignments")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
            })
            .eq("id", assignment.id);

          if (updateError) {
            console.error(
              `[auto-payroll] Failed to complete assignment ${assignment.id}:`,
              updateError
            );
            failed++;
            continue;
          }
        }

        // Step b: Call populate_staff_payroll_items RPC
        const { error: rpcError } = await supabase.rpc(
          "populate_staff_payroll_items",
          { p_assignment_id: assignment.id }
        );

        if (rpcError) {
          console.error(
            `[auto-payroll] RPC failed for assignment ${assignment.id}:`,
            rpcError
          );
          failed++;
          continue;
        }

        console.log(
          `[auto-payroll] Generated payroll for assignment ${assignment.id}, staff ${assignment.staff_id}, booking ${assignment.booking_id}`
        );
        processed++;
      } catch (err) {
        console.error(
          `[auto-payroll] Unexpected error for assignment ${assignment.id}:`,
          err
        );
        failed++;
      }
    }

    const skippedCount = eligibleAssignments.length - assignmentsToProcess.length;

    console.log(
      `[auto-payroll] Done. Processed: ${processed}, Skipped: ${skippedCount}, Failed: ${failed}`
    );

    return new Response(
      JSON.stringify({ processed, skipped: skippedCount, failed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[auto-payroll] Fatal error:", error);
    const msg = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
