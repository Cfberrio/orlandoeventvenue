// composio-gmail-webhook — universal per-brand Gmail draft agent (v1)
// Brand comes from env (BRAND_CODE=OEV in this project).
// HARD RULE: this function can NEVER send email. Allowlist below has no send tools.

import { createClient } from "npm:@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const MODEL = "claude-haiku-4-5";
const SCORE_GATE = 0.75;
const BRAND_TZ = "America/New_York";
const AVAILABILITY_WINDOW_DAYS = 90;
const HISTORY_LIMIT = 6;
const COMPOSIO_BASE = "https://backend.composio.dev/api/v3";

const TOOL_ALLOWLIST = new Set([
  "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
  "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
  "GMAIL_CREATE_EMAIL_DRAFT",
]);

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "score", "audience", "subject", "draft", "reasoning"],
  properties: {
    decision: { type: "string", enum: ["draft", "skip", "flag_human"] },
    score: { type: "number" },
    audience: { type: "string" },
    subject: { type: "string" },
    draft: { type: "string" },
    reasoning: { type: "string" },
  },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacB64(keyBytes: Uint8Array, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

async function verifyWebhook(secret: string, id: string, ts: string, rawBody: string, sigHeader: string): Promise<boolean> {
  if (!secret || !id || !ts || !sigHeader) return false;
  const tsNum = Number(ts);
  const tsMs = tsNum > 1e12 ? tsNum : tsNum * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > 5 * 60_000) return false;

  const msg = `${id}.${ts}.${rawBody}`;
  const enc = new TextEncoder();
  const keys: Uint8Array[] = [enc.encode(secret)];
  if (secret.startsWith("whsec_")) {
    try {
      const raw = atob(secret.slice(6));
      keys.push(Uint8Array.from(raw, (c) => c.charCodeAt(0)));
    } catch { /* not base64 — ignore */ }
  }
  const expected: string[] = [];
  for (const k of keys) expected.push(await hmacB64(k, msg));

  for (const part of sigHeader.split(" ")) {
    const candidate = part.includes(",") ? part.slice(part.indexOf(",") + 1) : part;
    for (const exp of expected) if (timingSafeEq(exp, candidate)) return true;
  }
  return false;
}

async function composioExecute(toolSlug: string, args: Record<string, unknown>): Promise<any> {
  if (!TOOL_ALLOWLIST.has(toolSlug)) throw new Error(`tool not allowlisted: ${toolSlug}`);
  const res = await fetch(`${COMPOSIO_BASE}/tools/execute/${toolSlug}`, {
    method: "POST",
    headers: { "x-api-key": Deno.env.get("COMPOSIO_API_KEY")!, "content-type": "application/json" },
    body: JSON.stringify({
      user_id: Deno.env.get("COMPOSIO_USER_ID"),
      connected_account_id: Deno.env.get("COMPOSIO_CONNECTED_ACCOUNT_ID"),
      arguments: { ...args, user_id: "me" },
    }),
  });
  if (!res.ok) throw new Error(`composio ${toolSlug} http ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  if (j?.successful === false || j?.error) throw new Error(`composio ${toolSlug}: ${JSON.stringify(j?.error).slice(0, 300)}`);
  return j?.data ?? j;
}

function htmlToText(html: string): string {
  let s = String(html);
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<head[\s\S]*?<\/head>/gi, " ");
  s = s.replace(/<blockquote[\s\S]*$/gi, " ");
  s = s.replace(/<div[^>]+gmail_quote[\s\S]*$/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#0?39;/g, "'");
  s = s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function stripQuotedReplyText(text: string): string {
  const markers = [
    /^On .{5,160} wrote:\s*$/m,
    /^El .{5,160} escribió:\s*$/m,
    /^-{2,}\s*(Original Message|Mensaje original)\s*-{2,}/im,
    /^_{5,}\s*$/m,
    /^From:\s.+/m,
    /^De:\s.+/m,
  ];
  let cut = text.length;
  for (const re of markers) {
    const m = re.exec(text);
    if (m && m.index > 40 && m.index < cut) cut = m.index;
  }
  let out = text.slice(0, cut);
  out = out.split("\n").filter((l) => !/^\s*>/.test(l)).join("\n");
  return out.trim();
}

function emailBodyToText(raw: unknown): string {
  const str = (raw ?? "").toString();
  const looksHtml = /<[a-z!][\s\S]*>/i.test(str);
  const text = looksHtml ? htmlToText(str) : str;
  return stripQuotedReplyText(text).slice(0, 6000);
}

function parseAddr(raw: unknown): { name: string; email: string } {
  const s = (raw ?? "").toString();
  const m = s.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: s.trim().toLowerCase() };
}

const AUTOMATED_SENDER_RE = /no-?reply|do-?not-?reply|noreply|mailer-daemon|postmaster|notifications?@|alerts?@|billing@|invoice\+?@|receipts?@|bounce/i;
const SKIP_CATEGORIES = new Set(["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"]);

function nowInTZ(tz: string) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "long",
  }).formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}`, weekday: map.weekday, timezone: tz };
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(dateISO: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(new Date(`${dateISO}T12:00:00Z`));
}

function hhmm(t: unknown): string { return (t ?? "").toString().slice(0, 5); }

async function loadVenueAvailability(supabase: any) {
  const t = nowInTZ(BRAND_TZ);
  const startDate = t.date;
  const endDate = addDaysISO(startDate, AVAILABILITY_WINDOW_DAYS);
  const [bookingsQ, blocksQ, blackoutsQ, configQ] = await Promise.all([
    supabase.from("bookings")
      .select("event_date, booking_type, start_time, end_time, status, payment_status")
      .gte("event_date", startDate).lte("event_date", endDate)
      .not("status", "in", "(cancelled,declined)")
      .in("payment_status", ["deposit_paid", "fully_paid", "invoiced"])
      .order("event_date"),
    supabase.from("availability_blocks")
      .select("start_date, end_date, start_time, end_time, block_type, source")
      .lte("start_date", endDate).gte("end_date", startDate),
    supabase.from("blackout_dates")
      .select("start_date, end_date")
      .lte("start_date", endDate).gte("end_date", startDate),
    supabase.from("venue_config").select("key, value")
      .in("key", ["minimum_booking_notice_hours", "balance_due_days", "deposit_percentage"]),
  ]);
  if (bookingsQ.error) throw bookingsQ.error;
  const busy = new Map<string, { full: boolean; hours: string[] }>();
  const mark = (date: string, full: boolean, hours?: string) => {
    if (date < startDate || date > endDate) return;
    const cur = busy.get(date) ?? { full: false, hours: [] };
    if (full) cur.full = true;
    else if (hours) cur.hours.push(hours);
    busy.set(date, cur);
  };
  for (const b of bookingsQ.data ?? []) {
    const isDaily = (b.booking_type ?? "").toString() === "daily";
    mark(b.event_date, isDaily, isDaily ? undefined : `${hhmm(b.start_time)}–${hhmm(b.end_time)}`);
  }
  const expand = (s: string, e: string, cb: (d: string) => void) => {
    let d = s < startDate ? startDate : s;
    const stop = e > endDate ? endDate : e;
    let guard = 0;
    while (d <= stop && guard++ < 400) { cb(d); d = addDaysISO(d, 1); }
  };
  for (const bl of blocksQ.data ?? []) {
    const isHourly = (bl.block_type ?? "").toString() === "hourly" && bl.start_time && bl.end_time;
    expand(bl.start_date, bl.end_date, (d) => mark(d, !isHourly, isHourly ? `${hhmm(bl.start_time)}–${hhmm(bl.end_time)}` : undefined));
  }
  for (const bo of blackoutsQ.data ?? []) expand(bo.start_date, bo.end_date, (d) => mark(d, true));
  const cfg = Object.fromEntries((configQ.data ?? []).map((c: any) => [c.key, c.value]));
  const busy_dates = [...busy.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, v]) => ({
    date, weekday: weekdayOf(date, BRAND_TZ),
    status: v.full ? "fully_booked" : "partially_booked",
    busy_hours: v.full ? "ALL DAY" : v.hours.join(", "),
  }));
  return {
    timezone: BRAND_TZ, today: startDate, window_end: endDate,
    minimum_booking_notice_hours: Number(cfg.minimum_booking_notice_hours ?? 48),
    deposit: "50% deposit holds the date; no date is held without a reservation",
    balance_due_days_before_event: Number(cfg.balance_due_days ?? 15),
    busy_dates,
    how_to_read_this:
      `This is the LIVE venue calendar from the bookings database, covering ${startDate} to ${endDate}. ` +
      `Every date in that window that is NOT listed in busy_dates is fully OPEN for both hourly and daily bookings. ` +
      `Dates marked partially_booked are open outside the listed busy_hours. ` +
      `Dates marked fully_booked are not available. Dates after ${endDate} are outside this snapshot — say you'll confirm those.`,
  };
}

async function loadOevBookingContext(supabase: any, email: string) {
  if (!email) return null;
  const t = nowInTZ(BRAND_TZ);
  const since = addDaysISO(t.date, -30);
  try {
    const { data } = await supabase.from("bookings")
      .select("reservation_number, event_date, start_time, end_time, booking_type, event_type, number_of_guests, status, payment_status, total_amount, deposit_amount, balance_amount, lifecycle_status")
      .ilike("email", email).gte("event_date", since).order("event_date").limit(5);
    return data?.length ? data : null;
  } catch (e) { console.error("booking context error", e); return null; }
}

async function loadBrandGrounding(supabase: any, brand: string): Promise<{ label: string; data: unknown } | null> {
  if (brand === "OEV" || brand === "RV") return { label: "VENUE_AVAILABILITY", data: await loadVenueAvailability(supabase) };
  return null;
}

async function loadContactContext(supabase: any, brand: string, email: string): Promise<{ label: string; data: unknown } | null> {
  if (brand === "OEV" || brand === "RV") {
    return { label: "BOOKING_CONTEXT (this sender's own bookings in our database, matched by email)", data: await loadOevBookingContext(supabase, email) };
  }
  return null;
}

async function processEvent(supabase: any, logId: string, ctx: {
  brand: string; brandEmail: string;
  messageId: string; threadId: string;
  fromName: string; fromEmail: string;
  subject: string; snippet: string;
}) {
  const patch = async (fields: Record<string, unknown>) => {
    await supabase.from("gmail_draft_log").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", logId);
  };
  try {
    let threadId = ctx.threadId;
    let msgs: any[] = [];
    if (threadId) {
      const th = await composioExecute("GMAIL_FETCH_MESSAGE_BY_THREAD_ID", { thread_id: threadId });
      msgs = th?.messages ?? [];
    } else {
      const m = await composioExecute("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", { message_id: ctx.messageId, format: "full" });
      threadId = m?.threadId ?? m?.thread_id ?? "";
      if (m) msgs = [m];
    }
    if (!threadId || !msgs.length) { await patch({ decision: "error", error_detail: "thread hydration returned empty" }); return; }

    msgs.sort((a, b) => Date.parse(a.messageTimestamp ?? 0) - Date.parse(b.messageTimestamp ?? 0));
    const last = msgs[msgs.length - 1];
    const lastFrom = parseAddr(last?.sender ?? last?.from).email;

    if (lastFrom && lastFrom === ctx.brandEmail.toLowerCase()) {
      await patch({ decision: "skip", skip_reason: "last message in thread is from the brand (already answered)" });
      return;
    }
    const headersArr = last?.payload?.headers ?? [];
    if (Array.isArray(headersArr) && headersArr.some((h: any) => /^list-unsubscribe$/i.test(h?.name ?? ""))) {
      await patch({ decision: "skip", skip_reason: "List-Unsubscribe header (bulk/marketing sender)" });
      return;
    }

    const history = msgs.slice(-HISTORY_LIMIT).map((m: any) => ({
      from: parseAddr(m.sender ?? m.from).email || "(unknown)",
      at: m.messageTimestamp ?? null,
      text: emailBodyToText(m.messageText ?? m.preview?.body ?? "").slice(0, 1800),
    }));
    const latestText = emailBodyToText(last?.messageText ?? last?.preview?.body ?? ctx.snippet);

    const { data: brandRow } = await supabase.from("brand").select("id").eq("code", ctx.brand).maybeSingle();
    if (!brandRow) { await patch({ decision: "error", error_detail: `brand not found: ${ctx.brand}` }); return; }
    const { data: promptRow } = await supabase.from("brand_prompts")
      .select("prompt_text, version")
      .eq("brand_id", brandRow.id).eq("channel", "gmail").eq("active", true).maybeSingle();
    if (!promptRow) { await patch({ decision: "error", error_detail: "no active gmail prompt in brand_prompts" }); return; }

    const grounding = await loadBrandGrounding(supabase, ctx.brand);
    const contactCtx = await loadContactContext(supabase, ctx.brand, ctx.fromEmail);
    const timeCtx = nowInTZ(BRAND_TZ);

    const blocks: string[] = [];
    blocks.push(`CURRENT_DATETIME (live, business local time):\n${JSON.stringify(timeCtx)}`);
    if (grounding) blocks.push(`${grounding.label} (live data from the business database, loaded seconds ago):\n${JSON.stringify(grounding.data, null, 2)}`);
    if (contactCtx) blocks.push(`${contactCtx.label}:\n${contactCtx.data ? JSON.stringify(contactCtx.data, null, 2) : "none found for this sender"}`);
    blocks.push(`SENDER: ${ctx.fromName ? `${ctx.fromName} <${ctx.fromEmail}>` : ctx.fromEmail}`);
    blocks.push(`SUBJECT: ${ctx.subject || "(no subject)"}`);
    blocks.push(`THREAD_HISTORY (chronological, last ${HISTORY_LIMIT} messages, quoted text stripped):\n${JSON.stringify(history, null, 2)}`);
    blocks.push(`LATEST_INBOUND_EMAIL (the message to answer):\n${latestText || "(empty body)"}`);

    const aRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        system: promptRow.prompt_text,
        messages: [{ role: "user", content: blocks.join("\n\n") }],
        output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      }),
    });
    if (!aRes.ok) {
      await patch({ decision: "error", error_detail: `claude http ${aRes.status}: ${(await aRes.text()).slice(0, 300)}` });
      return;
    }
    const aJson = await aRes.json();
    if (aJson?.stop_reason === "refusal") { await patch({ decision: "skip", skip_reason: "model refusal", model: MODEL }); return; }
    const textBlock = (aJson?.content ?? []).find((b: any) => b?.type === "text");
    let parsed: any = null;
    try { parsed = JSON.parse(textBlock?.text ?? ""); } catch { /* handled below */ }
    const usage = { input_tokens: aJson?.usage?.input_tokens ?? null, output_tokens: aJson?.usage?.output_tokens ?? null };
    if (!parsed) { await patch({ decision: "error", error_detail: `parse_fail: ${(textBlock?.text ?? "").slice(0, 300)}`, model: MODEL, ...usage }); return; }

    let decision: string = ["draft", "skip", "flag_human"].includes(parsed.decision) ? parsed.decision : "flag_human";
    const score: number | null = typeof parsed.score === "number" ? parsed.score : null;
    if (decision === "draft" && (score === null || score < SCORE_GATE)) {
      decision = "flag_human";
      parsed.reasoning = `${parsed.reasoning ?? ""} | score_gate: ${score ?? "null"} < ${SCORE_GATE}`.trim();
      if (parsed.draft && !parsed.draft.startsWith("⚠️")) {
        parsed.draft = `⚠️ HUMAN REVIEW — low confidence (${score ?? "?"}). Do not send as-is.\n\n${parsed.draft}`;
      }
    }

    let draftId: string | null = null;
    let draftMessageId: string | null = null;
    if ((decision === "draft" || decision === "flag_human") && parsed.draft) {
      const d = await composioExecute("GMAIL_CREATE_EMAIL_DRAFT", {
        thread_id: threadId,
        recipient_email: ctx.fromName ? `${ctx.fromName} <${ctx.fromEmail}>` : ctx.fromEmail,
        body: parsed.draft,
      });
      draftId = d?.id ?? null;
      draftMessageId = d?.message?.id ?? null;
    }

    await patch({
      decision,
      score,
      audience: parsed.audience || null,
      reasoning: parsed.reasoning || null,
      skip_reason: decision === "skip" ? (parsed.reasoning || "model skip") : null,
      draft_id: draftId,
      draft_message_id: draftMessageId,
      draft_body: parsed.draft || null,
      gmail_thread_id: threadId,
      prompt_version: promptRow.version,
      model: MODEL,
      ...usage,
    });
  } catch (e) {
    console.error("processEvent error", e);
    await patch({ decision: "error", error_detail: String(e).slice(0, 500) });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const brand = Deno.env.get("BRAND_CODE") ?? "";
  const brandEmail = (Deno.env.get("BRAND_EMAIL") ?? "").toLowerCase();
  const secret = Deno.env.get("COMPOSIO_WEBHOOK_SECRET") ?? "";
  const myCa = Deno.env.get("COMPOSIO_CONNECTED_ACCOUNT_ID") ?? "";

  const rawBody = await req.text();
  const ok = await verifyWebhook(
    secret,
    req.headers.get("webhook-id") ?? "",
    req.headers.get("webhook-timestamp") ?? "",
    rawBody,
    req.headers.get("webhook-signature") ?? "",
  );
  if (!ok) return json(401, { error: "invalid signature" });

  let evt: any;
  try { evt = JSON.parse(rawBody); } catch { return json(400, { error: "invalid json" }); }

  const evtType = evt?.type ?? "";
  const slug = evt?.metadata?.trigger_slug ?? evt?.trigger_slug ?? "";
  const ca = evt?.metadata?.connected_account_id ?? evt?.connected_account_id ?? "";
  if (!evtType.includes("trigger") || slug !== "GMAIL_NEW_GMAIL_MESSAGE") return json(200, { ignored: "not a gmail message trigger", type: evtType, slug });
  if (myCa && ca && ca !== myCa) return json(200, { ignored: "different connected account", got: ca });

  const data = evt?.data ?? {};
  console.log("gmail-webhook payload keys", brand, Object.keys(data));

  const messageId = (data.id ?? data.message_id ?? data.messageId ?? "").toString();
  const threadId = (data.thread_id ?? data.threadId ?? "").toString();
  const subject = (data.subject ?? "").toString();
  const from = parseAddr(data.sender ?? data.from ?? data.from_email ?? "");
  const snippet = (data.message_text ?? data.messageText ?? data.snippet ?? data.preview?.body ?? "").toString().slice(0, 1500);
  const labels: string[] = Array.isArray(data.label_ids ?? data.labelIds) ? (data.label_ids ?? data.labelIds) : [];
  if (!messageId) return json(200, { ignored: "no message id in payload" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: inserted } = await supabase
    .from("gmail_draft_log")
    .upsert(
      {
        brand_code: brand, event_id: evt?.id ?? null,
        gmail_message_id: messageId, gmail_thread_id: threadId || null,
        from_email: from.email || null, subject: subject || null, snippet,
        decision: "processing",
      },
      { onConflict: "gmail_message_id", ignoreDuplicates: true },
    )
    .select("id");
  if (!inserted?.length) return json(200, { ok: true, dedup: "already processed", messageId });
  const logId = inserted[0].id;

  const skip = async (reason: string) => {
    await supabase.from("gmail_draft_log").update({ decision: "skip", skip_reason: reason, updated_at: new Date().toISOString() }).eq("id", logId);
    return json(200, { ok: true, skipped: reason });
  };

  if (from.email && from.email === brandEmail) return await skip("self (anti-echo)");
  if (AUTOMATED_SENDER_RE.test(from.email)) return await skip(`automated sender: ${from.email}`);
  for (const l of labels) {
    if (SKIP_CATEGORIES.has(l)) return await skip(`gmail category: ${l}`);
    if (l === "SENT" || l === "DRAFT") return await skip(`label: ${l}`);
  }

  const work = processEvent(supabase, logId, {
    brand, brandEmail, messageId, threadId,
    fromName: from.name, fromEmail: from.email, subject, snippet,
  });
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
  else await work;

  return json(200, { ok: true, accepted: messageId, brand });
});
