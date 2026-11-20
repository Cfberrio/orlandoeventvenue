// Sends the staff and office notices the database queued in
// public.staff_notifications (ClickUp 86e40ach2, ST2-10/16/17/25).
//
// Called by the database (pg_net, right after a notice is queued, and by the
// hourly staff-pending-notices cron). It takes no input: every email comes
// from a row the database wrote, and each row is claimed atomically
// (claim_staff_notifications, FOR UPDATE SKIP LOCKED) and sent at most once.
// So a public caller can only make it deliver what is already queued, which
// is why verify_jwt is off for the pg_net caller.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildStaffNotice, type StaffNoticeRow } from "../_shared/staff-notices.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!gmailUser || !gmailPassword) return json({ ok: false, error: "Email service not configured" }, 500);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: claimed, error: claimError } = await supabase.rpc("claim_staff_notifications", { p_limit: 25 });
  if (claimError) {
    console.error("[STAFF-NOTICES] claim failed:", claimError);
    return json({ ok: false, error: claimError.message }, 500);
  }
  const rows = (claimed ?? []) as StaffNoticeRow[];
  if (rows.length === 0) return json({ ok: true, sent: 0 });

  const finish = async (id: string, status: "sent" | "failed" | "skipped", lastError: string | null) => {
    const { error } = await supabase
      .from("staff_notifications")
      .update({ status, last_error: lastError, sent_at: status === "sent" ? new Date().toISOString() : null })
      .eq("id", id)
      .eq("status", "sending");
    if (error) console.error(`[STAFF-NOTICES] could not mark ${id} ${status}:`, error);
  };

  const client = new SMTPClient({
    connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: gmailUser, password: gmailPassword } },
  });

  const results = { sent: 0, failed: 0, skipped: 0 };
  try {
    for (const row of rows) {
      const built = buildStaffNotice(row);
      if (!built) {
        await finish(row.id, "skipped", "nothing to send");
        results.skipped++;
        continue;
      }

      let to = gmailUser; // office notices go to the venue inbox
      if (row.recipient === "staff") {
        if (!row.staff_id) {
          await finish(row.id, "skipped", "no staff_id");
          results.skipped++;
          continue;
        }
        const { data: staff, error: staffError } = await supabase
          .from("staff_members")
          .select("email, is_active")
          .eq("id", row.staff_id)
          .maybeSingle();
        if (staffError) {
          await finish(row.id, "failed", `staff lookup: ${staffError.message}`);
          results.failed++;
          continue;
        }
        if (!staff?.email || !staff.is_active) {
          await finish(row.id, "skipped", !staff?.email ? "staff has no email" : "staff inactive");
          results.skipped++;
          continue;
        }
        to = staff.email;
      }

      try {
        await client.send({
          from: `"Orlando Event Venue" <${gmailUser}>`,
          to,
          subject: built.subject,
          content: built.text,
          html: built.html,
        });
        await finish(row.id, "sent", null);
        results.sent++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[STAFF-NOTICES] send failed for ${row.id} (${row.kind}):`, msg);
        await finish(row.id, "failed", msg.slice(0, 500));
        results.failed++;
      }
    }
  } finally {
    try {
      await client.close();
    } catch (_e) {
      // connection never opened
    }
  }

  console.log(`[STAFF-NOTICES] claimed ${rows.length}:`, JSON.stringify(results));
  return json({ ok: true, claimed: rows.length, ...results });
});
