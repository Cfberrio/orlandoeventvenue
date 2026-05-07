// Supabase Edge Function: ghl-sms-draft (OEV)
// Deploy: supabase functions deploy ghl-sms-draft --no-verify-jwt
// Secrets needed:
//   ANTHROPIC_API_KEY=sk-ant-...
//   GHL_TOKEN_OEV=pit-...

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Brand = "OEV" | "RV";

interface InvokePayload {
  brand: Brand;
  ghl_location_id: string;
  lookback_minutes?: number;
}

interface ClaudeDecision {
  score: number;
  draft: string;
  reasoning: string;
  decision: "draft" | "skip" | "flag_human";
}

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5";

function ghlTokenFor(brand: Brand): string {
  const key = `GHL_TOKEN_${brand}`;
  const tok = Deno.env.get(key);
  if (!tok) throw new Error(`Missing secret ${key}`);
  return tok;
}

function anthropicKey(): string {
  const k = Deno.env.get("ANTHROPIC_API_KEY");
  if (!k) throw new Error("Missing ANTHROPIC_API_KEY");
  return k;
}

async function ghlFetch(path: string, brand: Brand, init: RequestInit = {}) {
  const r = await fetch(`${GHL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ghlTokenFor(brand)}`,
      Version: GHL_VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`GHL ${path} ${r.status}: ${body}`);
  }
  return r.json();
}

async function fetchUnreadConversations(brand: Brand, locationId: string, lookbackMinutes: number) {
  const url = `/conversations/search?locationId=${encodeURIComponent(locationId)}&status=unread&sort=desc&sortBy=last_message_date&limit=20`;
  const data = await ghlFetch(url, brand, { method: "GET" });
  const cutoff = Date.now() - lookbackMinutes * 60 * 1000;
  return (data.conversations ?? []).filter((c: any) => {
    const t = new Date(c.lastMessageDate ?? c.dateUpdated ?? 0).getTime();
    const lmt = (c.lastMessageType ?? "").toUpperCase();
    const isSms = lmt === "TYPE_SMS" || lmt === "SMS";
    const isInbound = (c.lastMessageDirection ?? "") === "inbound";
    return t >= cutoff && isSms && isInbound;
  });
}

function isSmsMessage(m: any): boolean {
  const mt = (m.messageType ?? "").toUpperCase();
  return mt === "TYPE_SMS" || mt === "SMS";
}

async function fetchRecentMessages(brand: Brand, conversationId: string) {
  const data = await ghlFetch(
    `/conversations/${conversationId}/messages?limit=20`,
    brand,
    { method: "GET" },
  );
  const messages = data.messages?.messages ?? data.messages ?? [];
  return messages.filter((m: any) => isSmsMessage(m));
}

function buildConversationHistory(messages: any[], maxTurns = 10) {
  const sms = messages.slice(0, maxTurns).reverse();
  const history = sms.map((m: any) => ({
    direction: m.direction,
    text: (m.body ?? "").trim(),
    date: m.dateAdded ?? m.dateUpdated ?? "",
  })).filter(h => h.text.length > 0);
  const lastInbound = messages.find((m: any) => m.direction === "inbound") ?? null;
  return { history, lastInbound };
}

async function fetchContact(brand: Brand, contactId: string) {
  if (!contactId) return null;
  try {
    const data = await ghlFetch(`/contacts/${contactId}`, brand, { method: "GET" });
    return data.contact ?? data;
  } catch {
    return null;
  }
}

function buildContactContext(contact: any) {
  if (!contact) return {};
  return {
    name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null,
    tags: contact.tags ?? [],
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    source: contact.source ?? null,
    customFields: contact.customFields ?? null,
  };
}

async function callClaude(
  systemPrompt: string,
  inboundText: string,
  contactContext: any,
  history: Array<{ direction: string; text: string; date: string }> = [],
): Promise<{ decision: ClaudeDecision; usage: any }> {
  const r = await fetch(ANTHROPIC_BASE, {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            `=== CONVERSATION HISTORY ===`,
            history.length > 0
              ? history.map(h => `- [${h.direction === "inbound" ? "lead" : "us"}] ${h.text}`).join("\n")
              : `No prior SMS history with this contact.`,
            ``,
            `=== LATEST INBOUND SMS TO RESPOND TO ===`,
            `"${inboundText}"`,
            ``,
            `=== CONTACT CONTEXT ===`,
            JSON.stringify(contactContext, null, 2),
            ``,
            `Respond with ONLY a JSON object — no prose, no markdown, no headers, no code fences. Start your output with the opening { brace and end with closing }.`,
          ].join("\n"),
        },
        { role: "assistant", content: "{" },
      ],
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Anthropic ${r.status}: ${body}`);
  }
  const data = await r.json();
  const text = data.content?.[0]?.text ?? "";
  const reconstructed = text.trim().startsWith("{") ? text : "{" + text;
  let parsed: ClaudeDecision;
  try {
    parsed = JSON.parse(reconstructed);
  } catch {
    const match = reconstructed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Claude returned non-JSON: ${text.slice(0, 200)}`);
    parsed = JSON.parse(match[0]);
  }
  return { decision: parsed, usage: data.usage };
}

async function postInternalComment(
  brand: Brand,
  conversationId: string,
  contactId: string,
  draft: string,
): Promise<{ messageId: string | null }> {
  const body = {
    type: "InternalComment",
    contactId,
    conversationId,
    message: `[AI DRAFT — copy/edit/send manually]\n\n${draft}`,
  };
  let res: any;
  try {
    res = await ghlFetch(`/conversations/messages`, brand, {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (String(e).includes("422")) {
      res = await ghlFetch(`/conversations/messages`, brand, {
        method: "POST",
        body: JSON.stringify({ ...body, mentions: [] }),
      });
    } else {
      throw e;
    }
  }
  const messageId = res?.messageId ?? res?.message?.id ?? res?.id ?? null;
  return { messageId };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();
  let payload: InvokePayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json body" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const { brand, ghl_location_id, lookback_minutes = 3 } = payload;
  if (!brand || !ghl_location_id) {
    return new Response(JSON.stringify({ error: "brand and ghl_location_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: promptRow, error: promptErr } = await supabase
    .from("brand_prompts")
    .select("prompt_text, version")
    .eq("brand", brand)
    .eq("active", true)
    .single();
  if (promptErr || !promptRow) {
    return new Response(JSON.stringify({ error: `no active prompt for ${brand}` }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const summary = { processed: 0, drafted: 0, skipped: 0, flagged: 0, errors: 0 };

  try {
    const conversations = await fetchUnreadConversations(brand, ghl_location_id, lookback_minutes);

    for (const conv of conversations) {
      const conversationId = conv.id;
      const contactId = conv.contactId ?? conv.contact_id;
      try {
        const recent = await fetchRecentMessages(brand, conversationId);
        const { history, lastInbound: inbound } = buildConversationHistory(recent, 10);
        if (!inbound) continue;

        const { data: existing } = await supabase
          .from("sms_draft_log")
          .select("id")
          .eq("conversation_id", conversationId)
          .eq("inbound_message_id", inbound.id)
          .maybeSingle();
        if (existing) continue;

        const contact = await fetchContact(brand, contactId);
        const contactContext = buildContactContext(contact);

        const { decision, usage } = await callClaude(
          promptRow.prompt_text,
          inbound.body ?? "",
          contactContext,
          history,
        );
        summary.processed++;

        let internalCommentId: string | null = null;
        let errorDetail: string | null = null;

        if (decision.decision === "draft" && decision.draft) {
          try {
            const r = await postInternalComment(brand, conversationId, contactId, decision.draft);
            internalCommentId = r.messageId;
            summary.drafted++;
          } catch (e) {
            errorDetail = String(e);
            summary.errors++;
          }
        } else if (decision.decision === "skip") {
          summary.skipped++;
        } else if (decision.decision === "flag_human") {
          summary.flagged++;
        }

        const insertResult = await supabase.from("sms_draft_log").insert({
          brand,
          ghl_location_id,
          contact_id: contactId,
          conversation_id: conversationId,
          inbound_message_id: inbound.id,
          inbound_message: inbound.body ?? "",
          contact_context: contactContext,
          draft_message: decision.draft ?? null,
          score: decision.score ?? null,
          decision: errorDetail
            ? "error"
            : (decision.decision && ["draft", "skip", "flag_human"].includes(decision.decision)
                ? decision.decision
                : "flag_human"),
          reasoning: decision.reasoning ?? null,
          prompt_version: promptRow.version,
          model: MODEL,
          input_tokens: usage?.input_tokens ?? null,
          output_tokens: usage?.output_tokens ?? null,
          ghl_draft_id: internalCommentId,
          scheduled_message_id: null,
          scheduled_for: null,
          error_detail: errorDetail,
        });
        if (insertResult.error) {
          console.error("INSERT_ERROR", insertResult.error);
        }
      } catch (e) {
        summary.errors++;
        await supabase.from("sms_draft_log").insert({
          brand,
          ghl_location_id,
          contact_id: contactId ?? null,
          conversation_id: conversationId ?? "unknown",
          inbound_message_id: `err-${Date.now()}`,
          inbound_message: "",
          decision: "error",
          error_detail: String(e),
        });
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e), summary }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, brand, ms: Date.now() - startedAt, ...summary }),
    { headers: { ...corsHeaders, "content-type": "application/json" } },
  );
});
