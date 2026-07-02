import { createClient } from "npm:@supabase/supabase-js@2";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const MODEL = "claude-haiku-4-5";
const SCORE_GATE = 0.75;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Channel = "sms" | "email";

const CHANNEL_CFG: Record<Channel, { maxTokens: number; historyLimit: number }> = {
  sms: { maxTokens: 600, historyLimit: 10 },
  email: { maxTokens: 1200, historyLimit: 6 },
};

function ghlHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    Accept: "application/json",
    "content-type": "application/json",
  };
}

function channelOf(t: unknown): Channel | null {
  const s = (t ?? "").toString().toUpperCase();
  if (s.includes("SMS")) return "sms";
  if (s.includes("EMAIL")) return "email";
  return null;
}

function msgChannel(m: any): Channel | null {
  return channelOf(m?.messageType ?? m?.type ?? "");
}

function isInbound(m: any): boolean {
  const d = (m?.direction ?? "").toString().toLowerCase();
  return d === "inbound" || m?.inbound === true;
}

function tryParseJson(s: string): any | null {
  try { return JSON.parse(s); } catch { /* ignore */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
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
  let text = looksHtml ? htmlToText(str) : str;
  if (looksHtml && text.length < 10) {
    text = htmlToText(str.replace(/<blockquote/gi, "<div").replace(/gmail_quote/gi, "gq"));
  }
  return stripQuotedReplyText(text).slice(0, 6000);
}

async function fetchEmailFull(
  token: string,
  m: any,
): Promise<{ subject: string | null; body: string | null }> {
  const candidates: string[] = [];
  const metaIds = m?.meta?.email?.messageIds;
  if (Array.isArray(metaIds) && metaIds.length) candidates.push(String(metaIds[metaIds.length - 1]));
  if (m?.id) candidates.push(String(m.id));
  for (const id of candidates) {
    try {
      const r = await fetch(`${GHL_BASE}/conversations/messages/email/${id}`, {
        headers: ghlHeaders(token),
      });
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      const em = j?.emailMessage ?? j;
      const body = em?.body ?? em?.bodyHtml ?? em?.html ?? null;
      const subject = em?.subject ?? null;
      if (body || subject) return { subject, body };
    } catch { /* try next candidate */ }
  }
  return { subject: m?.subject ?? null, body: null };
}

async function loadActivePrograms(supabase: any) {
  const { data, error } = await supabase
    .from("team")
    .select(`
      id, name, sport, status, season, price, capacity, is_ongoing, description,
      school:school_id ( name, location ),
      sessions:session ( start_date, end_date, start_time, end_time, day_of_week, recurrence )
    `)
    .eq("is_active", true);
  if (error) throw error;
  const filtered = (data ?? []).filter((t: any) =>
    t.status === "open" || (t.is_ongoing === true && t.status !== "archived")
  );
  return filtered.map((t: any) => ({
    sport: t.sport,
    team_name: t.name,
    school: t.school?.name ?? null,
    school_location: t.school?.location ?? null,
    season: t.season,
    registration_status:
      t.status === "open"
        ? "open_for_signup"
        : t.is_ongoing
        ? "currently_running_no_new_signups"
        : "unknown",
    price_usd: t.price,
    description: t.description,
    sessions: (t.sessions ?? []).map((s: any) => ({
      start_date: s.start_date,
      end_date: s.end_date,
      time: `${s.start_time}–${s.end_time}`,
      days: s.day_of_week,
      repeat: s.recurrence,
    })),
  }));
}

async function loadCateringMenu(supabase: any) {
  const [pillarsQ, itemsQ, settingsQ] = await Promise.all([
    supabase.from("catering_pillars")
      .select("id, title, tagline, price_chip_main, price_chip_sub, price_chip_extra")
      .eq("is_published", true).order("sort_order"),
    supabase.from("catering_items")
      .select("pillar_id, name, tagline, price, price_unit")
      .eq("is_published", true).order("sort_order"),
    supabase.from("catering_settings").select("key, value"),
  ]);
  if (pillarsQ.error) throw pillarsQ.error;
  if (itemsQ.error) throw itemsQ.error;
  if (settingsQ.error) throw settingsQ.error;
  const items = itemsQ.data ?? [];
  return {
    pillars: (pillarsQ.data ?? []).map((p: any) => ({
      title: p.title,
      tagline: p.tagline,
      pricing: [p.price_chip_main, p.price_chip_sub, p.price_chip_extra].filter(Boolean).join(" · "),
      items: items.filter((i: any) => i.pillar_id === p.id).map((i: any) => ({
        name: i.name,
        tagline: i.tagline,
        price: i.price,
        price_unit: i.price_unit,
      })),
    })),
    policies: Object.fromEntries((settingsQ.data ?? []).map((s: any) => [s.key, s.value])),
  };
}

async function loadBrandGrounding(
  supabase: any,
  brand: string,
): Promise<{ label: string; data: unknown } | null> {
  if (brand === "DR") return { label: "ACTIVE_PROGRAMS", data: await loadActivePrograms(supabase) };
  if (brand === "CTS") return { label: "CATERING_MENU", data: await loadCateringMenu(supabase) };
  return null;
}

async function postDraftComment(
  token: string,
  conversationId: string,
  contactId: string,
  channel: Channel,
  draft: string,
  subject: string | null,
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const header = channel === "email"
    ? "[AI DRAFT — EMAIL — copy/edit/send manually]"
    : "[AI DRAFT — copy/edit/send manually]";
  const message = channel === "email"
    ? `${header}\n\nSubject: ${subject ?? ""}\n\n${draft}`
    : `${header}\n\n${draft}`;
  const body: any = { type: "InternalComment", contactId, conversationId, message };
  let res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: "POST", headers: ghlHeaders(token), body: JSON.stringify(body),
  });
  if (res.status === 422) {
    res = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: "POST", headers: ghlHeaders(token),
      body: JSON.stringify({ ...body, mentions: [] }),
    });
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { ok: false, error: `${res.status} ${t}` };
  }
  const j = await res.json().catch(() => ({}));
  return { ok: true, messageId: j?.messageId ?? j?.id ?? j?.message?.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const started = Date.now();
  const summary = {
    ok: true, brand: "", ms: 0, processed: 0, drafted: 0, skipped: 0, flagged: 0, errors: 0,
    byChannel: { sms: 0, email: 0 } as Record<Channel, number>,
  };
  try {
    const body = await req.json().catch(() => ({}));
    const brand = String(body?.brand ?? "").toUpperCase();
    const lookback_minutes = Number(body?.lookback_minutes ?? 6);
    summary.brand = brand;
    if (!brand) {
      return new Response(JSON.stringify({ error: "brand required" }), {
        status: 400, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
    const ghl_location_id = body?.ghl_location_id ?? Deno.env.get(`LOCATION_ID_${brand}`);
    const ghlToken = Deno.env.get(`GHL_TOKEN_${brand}`) ?? Deno.env.get(`GHL_PRIVATE_KEY_${brand}`);
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ghl_location_id) {
      return new Response(JSON.stringify({ error: `ghl_location_id missing (body or LOCATION_ID_${brand} secret)` }), {
        status: 400, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
    if (!ghlToken || !anthropicKey) {
      return new Response(JSON.stringify({ error: `missing GHL_TOKEN_${brand}/GHL_PRIVATE_KEY_${brand} or ANTHROPIC_API_KEY` }), {
        status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: brandRow } = await supabase
      .from("brand").select("id").eq("code", brand).maybeSingle();
    if (!brandRow) throw new Error("brand not found: " + brand);

    const promptCache = new Map<Channel, { text: string; version: string } | null>();
    async function getPrompt(channel: Channel) {
      if (promptCache.has(channel)) return promptCache.get(channel) ?? null;
      const { data } = await supabase
        .from("brand_prompts")
        .select("prompt_text, version")
        .eq("brand_id", brandRow.id)
        .eq("channel", channel)
        .eq("active", true)
        .maybeSingle();
      const v = data ? { text: data.prompt_text, version: data.version } : null;
      promptCache.set(channel, v);
      return v;
    }

    const grounding = await loadBrandGrounding(supabase, brand);

    const convRes = await fetch(
      `${GHL_BASE}/conversations/search?locationId=${encodeURIComponent(ghl_location_id)}&status=unread&sort=desc&sortBy=last_message_date&limit=20`,
      { headers: ghlHeaders(ghlToken) },
    );
    if (!convRes.ok) throw new Error(`conv search ${convRes.status}`);
    const convJson = await convRes.json();
    const cutoff = Date.now() - lookback_minutes * 60_000;
    const allConvs = (convJson?.conversations ?? [])
      .map((c: any) => ({ ...c, __channel: channelOf(c?.lastMessageType) }));

    if (body?.debug === true) {
      return new Response(JSON.stringify({
        debug: true,
        now: new Date().toISOString(),
        cutoff: new Date(cutoff).toISOString(),
        total: allConvs.length,
        conversations: allConvs.slice(0, 15).map((c: any) => ({
          id: c.id,
          contactId: c.contactId ?? null,
          type: c.type ?? null,
          lastMessageType: c.lastMessageType ?? null,
          lastMessageDirection: c.lastMessageDirection ?? null,
          lastMessageDate: c.lastMessageDate ?? null,
          dateUpdated: c.dateUpdated ?? null,
          unreadCount: c.unreadCount ?? null,
          computedChannel: c.__channel,
          computedTs: new Date(c?.lastMessageDate ?? c?.dateUpdated ?? 0).getTime() || 0,
          passesCutoff: (new Date(c?.lastMessageDate ?? c?.dateUpdated ?? 0).getTime() || 0) >= cutoff,
        })),
      }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    const conversations = allConvs.filter((c: any) => {
      const dir = (c?.lastMessageDirection ?? "").toLowerCase();
      const ts = new Date(c?.lastMessageDate ?? c?.dateUpdated ?? 0).getTime() || 0;
      return c.__channel && dir === "inbound" && ts >= cutoff;
    });

    for (const conv of conversations) {
      summary.processed++;
      const channel: Channel = conv.__channel;
      summary.byChannel[channel]++;
      try {
        const msgRes = await fetch(
          `${GHL_BASE}/conversations/${conv.id}/messages?limit=20`,
          { headers: ghlHeaders(ghlToken) },
        );
        if (!msgRes.ok) { summary.errors++; continue; }
        const msgJson = await msgRes.json();
        const all = msgJson?.messages?.messages ?? msgJson?.messages ?? [];
        const chMsgs = all
          .filter((m: any) => msgChannel(m) === channel)
          .sort((a: any, b: any) =>
            Date.parse(a.dateAdded ?? a.createdAt ?? 0) - Date.parse(b.dateAdded ?? b.createdAt ?? 0)
          );
        const lastInbound = [...chMsgs].reverse().find(isInbound);
        if (!lastInbound) { summary.skipped++; continue; }
        const inboundMessageId = lastInbound.id;

        const { data: dup } = await supabase
          .from("sms_draft_log")
          .select("id")
          .eq("conversation_id", conv.id)
          .eq("inbound_message_id", inboundMessageId)
          .limit(1);
        if ((dup?.length ?? 0) > 0) { summary.skipped++; continue; }

        const prompt = await getPrompt(channel);
        if (!prompt) {
          summary.errors++;
          await supabase.from("sms_draft_log").insert({
            brand_id: brandRow.id, channel, ghl_location_id,
            contact_id: conv.contactId, conversation_id: conv.id,
            inbound_message_id: inboundMessageId,
            inbound_message: (lastInbound.body ?? lastInbound.message ?? "").toString().slice(0, 500),
            decision: "error", error_detail: `no active ${channel} prompt`, model: MODEL,
          });
          continue;
        }

        let inboundText: string;
        let inboundSubject: string | null = null;
        if (channel === "email") {
          const full = await fetchEmailFull(ghlToken, lastInbound);
          inboundSubject = full.subject ?? lastInbound.subject ?? conv.lastMessageSubject ?? null;
          inboundText = emailBodyToText(full.body ?? lastInbound.body ?? lastInbound.message ?? "");
        } else {
          inboundText = (lastInbound.body ?? lastInbound.message ?? "").toString();
        }
        if (!inboundText.trim() && !inboundSubject) {
          await supabase.from("sms_draft_log").insert({
            brand_id: brandRow.id, channel, ghl_location_id,
            contact_id: conv.contactId, conversation_id: conv.id,
            inbound_message_id: inboundMessageId, inbound_message: "",
            decision: "skip", reasoning: "empty inbound body", model: MODEL,
          });
          summary.skipped++;
          continue;
        }

        const cfg = CHANNEL_CFG[channel];
        const history = chMsgs.slice(-cfg.historyLimit).map((m: any) => ({
          direction: isInbound(m) ? "inbound" : "outbound",
          text: channel === "email"
            ? emailBodyToText(m.body ?? m.message ?? "").slice(0, 1500)
            : (m.body ?? m.message ?? ""),
          at: m.dateAdded ?? m.createdAt ?? null,
        }));

        let contact: any = null;
        if (conv.contactId) {
          const cRes = await fetch(`${GHL_BASE}/contacts/${conv.contactId}`, { headers: ghlHeaders(ghlToken) });
          if (cRes.ok) {
            const cj = await cRes.json();
            contact = cj?.contact ?? cj ?? null;
          }
        }

        const latestBlock = channel === "email"
          ? { subject: inboundSubject, body: inboundText, at: lastInbound.dateAdded ?? null }
          : { text: inboundText, at: lastInbound.dateAdded ?? null };
        const jsonShape = channel === "email"
          ? `{"score": number, "subject": string, "draft": string, "reasoning": string, "decision": "draft"|"skip"|"flag_human"}`
          : `{"score": number, "draft": string, "reasoning": string, "decision": "draft"|"skip"|"flag_human"}`;
        const blocks: string[] = [];
        if (grounding) blocks.push(`${grounding.label}:\n${JSON.stringify(grounding.data, null, 2)}`);
        blocks.push(`CHANNEL: ${channel.toUpperCase()}`);
        blocks.push(`CONVERSATION_HISTORY (chronological, last ${cfg.historyLimit} ${channel} messages):\n${JSON.stringify(history, null, 2)}`);
        blocks.push(`LATEST_INBOUND_${channel.toUpperCase()}:\n${JSON.stringify(latestBlock, null, 2)}`);
        blocks.push(`CONTACT_CONTEXT:\n${JSON.stringify(contact, null, 2)}`);
        blocks.push(`Respond with strict JSON: ${jsonShape}`);
        const userContent = blocks.join("\n\n");

        const aRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: cfg.maxTokens,
            system: prompt.text,
            messages: [
              { role: "user", content: userContent },
              { role: "assistant", content: "{" },
            ],
          }),
        });
        if (!aRes.ok) {
          const t = await aRes.text().catch(() => "");
          console.error("claude error", aRes.status, t);
          summary.errors++; continue;
        }
        const aJson = await aRes.json();
        const rawText = (aJson?.content?.[0]?.text ?? "").toString();
        const raw = rawText.trim().startsWith("{") ? rawText : "{" + rawText;
        const parsed = tryParseJson(raw);
        const input_tokens = aJson?.usage?.input_tokens ?? null;
        const output_tokens = aJson?.usage?.output_tokens ?? null;

        let decision: string;
        let draft: string | null = null;
        let score: number | null = null;
        let reasoning: string | null = null;
        let subject: string | null = null;
        let error_detail: string | null = null;

        if (!parsed || typeof parsed !== "object") {
          decision = "flag_human";
          reasoning = "parse_fail: model output was not valid JSON";
          error_detail = `parse_fail: ${rawText.slice(0, 300)}`;
        } else {
          decision = ["draft", "skip", "flag_human"].includes(parsed.decision) ? parsed.decision : "flag_human";
          draft = typeof parsed.draft === "string" && parsed.draft.length ? parsed.draft : null;
          score = typeof parsed.score === "number" ? parsed.score : null;
          reasoning = parsed.reasoning ?? null;
          subject = typeof parsed.subject === "string" && parsed.subject.length ? parsed.subject : null;
          if (decision === "draft" && !draft) {
            decision = "flag_human";
            reasoning = `${reasoning ?? ""} | draft missing`.trim();
          }
        }

        if (decision === "draft" && (score === null || score < SCORE_GATE)) {
          decision = "flag_human";
          reasoning = `${reasoning ?? ""} | score_gate: draft suppressed (score ${score ?? "null"} < ${SCORE_GATE})`.trim();
        }

        let ghl_draft_id: string | null = null;
        let finalDecision = decision;

        if (decision === "draft" && draft) {
          const postSubject = channel === "email"
            ? (subject ?? (inboundSubject ? `Re: ${inboundSubject}` : ""))
            : null;
          const r = await postDraftComment(ghlToken, conv.id, conv.contactId, channel, draft, postSubject);
          if (r.ok) {
            ghl_draft_id = r.messageId ?? null;
            summary.drafted++;
          } else {
            error_detail = r.error ?? "post failed";
            finalDecision = "error";
            summary.errors++;
          }
        } else if (decision === "flag_human") {
          summary.flagged++;
        } else {
          summary.skipped++;
        }

        await supabase.from("sms_draft_log").insert({
          brand_id: brandRow.id,
          channel,
          ghl_location_id,
          contact_id: conv.contactId,
          conversation_id: conv.id,
          inbound_message_id: inboundMessageId,
          inbound_message: channel === "email"
            ? `[${inboundSubject ?? "no subject"}] ${inboundText}`.slice(0, 4000)
            : inboundText,
          contact_context: contact,
          draft_message: channel === "email" && draft ? `Subject: ${subject ?? ""}\n\n${draft}` : draft,
          score,
          decision: finalDecision,
          reasoning,
          prompt_version: prompt.version,
          model: MODEL,
          input_tokens,
          output_tokens,
          ghl_draft_id,
          scheduled_message_id: null,
          scheduled_for: null,
          error_detail,
        });
      } catch (e) {
        console.error("conv error", conv?.id, e);
        summary.errors++;
      }
    }

    summary.ms = Date.now() - started;
    console.log("ghl-draft", summary);
    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    console.error("ghl-draft fatal", e);
    summary.ms = Date.now() - started;
    return new Response(JSON.stringify({ ...summary, ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
