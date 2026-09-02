// Website contact form: notification template + parser.
//
// Both sides of the contract live here on purpose. send-contact-form renders the
// notification; composio-gmail-webhook parses it back out of Gmail to draft the reply
// to the lead. If the labels drift apart the agent stops seeing the submission and
// answers "we didn't receive your details", so template and parser ship together and
// are covered by supabase/functions/_tests/contact-form.test.ts.

export interface ContactFormData {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
  eventDate?: string;
  website?: string; // Honeypot
  transactionalConsent: boolean;
  marketingConsent: boolean;
  timestamp: string;
  /**
   * Meta dedup id minted by the browser (src/lib/tracking/funnel.ts
   * trackContactFormLead). The Pixel fires the browser half of the Lead with
   * this id and send-contact-form sends the CAPI half with the same one, so
   * Meta collapses them into a single action. Absent = no CAPI Lead is sent.
   * Never rendered into the notification email.
   */
  metaEventId?: string;
}

/** Field labels written by the template and recognized by the parser. */
export const CONTACT_FORM_LABELS = [
  "From",
  "Email",
  "Phone",
  "Event Date",
  "Subject",
  "Message",
  "Consent Preferences",
] as const;

export function formatSubmittedAt(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Lead-supplied values are untrusted: never let them close a tag or forge a label. */
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Plain-text part of the notification.
 *
 * This is NOT a courtesy fallback: Gmail (and therefore the draft agent) reads the
 * text/plain part first, so every field needed to answer the lead must live here. A
 * one-line summary is what made the agent reply "we didn't receive your details".
 */
export function generateContactFormText(data: ContactFormData): string {
  const consent = [
    data.transactionalConsent ? "Transactional messages: Agreed" : null,
    data.marketingConsent ? "Marketing messages: Agreed" : null,
  ].filter(Boolean).join(" | ") || "No consent provided";

  const lines = [
    "New Contact Form Submission - Orlando Event Venue",
    "",
    `From: ${data.name}`,
    `Email: ${data.email}`,
  ];
  if (data.phone) lines.push(`Phone: ${data.phone}`);
  if (data.eventDate) lines.push(`Event Date: ${data.eventDate}`);
  lines.push(`Subject: ${data.subject}`);
  lines.push(`Message: ${data.message}`);
  lines.push(`Consent Preferences: ${consent}`);
  lines.push("", `Submitted on ${formatSubmittedAt(data.timestamp)}`);
  return lines.join("\n");
}

export function generateContactFormHTML(data: ContactFormData): string {
  const phoneSection = data.phone
    ? `<div class="field"><span class="label">Phone:</span><div class="value"><a href="tel:${escapeHtml(data.phone)}">${escapeHtml(data.phone)}</a></div></div>`
    : "";
  const eventDateSection = data.eventDate
    ? `<div class="field"><span class="label">Event Date:</span><div class="value">${escapeHtml(data.eventDate)}</div></div>`
    : "";
  const consentSection = data.transactionalConsent || data.marketingConsent
    ? (data.transactionalConsent ? '<div class="consent">✅ <strong>Transactional messages:</strong> Agreed</div>' : '') +
      (data.marketingConsent ? '<div class="consent">✅ <strong>Marketing messages:</strong> Agreed</div>' : '')
    : '<div class="value">No consent provided</div>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Contact Form Submission</title>
<style>
body{font-family:Arial,sans-serif;line-height:1.6;color:#333}
.container{max-width:600px;margin:0 auto;padding:20px}
.header{background:#0b1220;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0}
.content{background:#f9fafb;padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px}
.field{margin-bottom:20px}
.label{font-weight:bold;color:#0b1220;display:block;margin-bottom:5px}
.value{background:white;padding:12px;border-radius:6px;border:1px solid #e5e7eb}
.consent{background:#ecfeff;border-left:4px solid #0891b2;padding:12px;margin:10px 0;border-radius:4px}
.footer{text-align:center;margin-top:20px;font-size:12px;color:#6b7280}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1 style="margin:0;font-size:24px">📬 New Contact Form Submission</h1>
<p style="margin:8px 0 0 0;opacity:0.9">Orlando Event Venue</p>
</div>
<div class="content">
<div class="field"><span class="label">From:</span><div class="value">${escapeHtml(data.name)}</div></div>
<div class="field"><span class="label">Email:</span><div class="value"><a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a></div></div>
${phoneSection}
${eventDateSection}
<div class="field"><span class="label">Subject:</span><div class="value">${escapeHtml(data.subject)}</div></div>
<div class="field"><span class="label">Message:</span><div class="value" style="white-space:pre-wrap">${escapeHtml(data.message)}</div></div>
<div class="field"><span class="label">Consent Preferences:</span>${consentSection}</div>
<div class="footer">
<p><strong>Orlando Event Venue Team</strong></p>
<p>3847 E Colonial Dr, Orlando, FL 32803</p>
<p>Orlandoeventvenue@gmail.com | (407) 974-5979</p>
<p style="margin-top:8px;">Submitted on ${formatSubmittedAt(data.timestamp)}</p>
</div>
</div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Parsing side (composio-gmail-webhook)
// ---------------------------------------------------------------------------

// send-contact-form mails the notification FROM the brand inbox TO itself, so the
// subject is the only reliable marker. It is always "Contact Form - <topic>"; a reply
// in the same thread starts with "Re:" and is handled as a normal inbound instead.
export const CONTACT_FORM_SUBJECT_RE = /^contact form\b/i;

export function isContactFormNotification(fromEmail: string, brandEmail: string, subject: string): boolean {
  return fromEmail === brandEmail && CONTACT_FORM_SUBJECT_RE.test(subject.trim());
}

const CF_FIELD_RE = new RegExp(`^(${CONTACT_FORM_LABELS.join("|")})[ \\t]*:[ \\t]*`, "gim");
// Everything from the notification footer on is boilerplate, not lead data.
const CF_FOOTER_RE = /^[ \t]*(?:Submitted on[ \t]|[A-Z][\w &'’-]{2,40} Team[ \t]*$)/m;
const EMAIL_RE = /[^\s@<>"']+@[^\s@<>"',;]+\.[a-z]{2,}/i;

export type ContactFormFields = {
  name?: string;
  email?: string;
  phone?: string;
  event_date?: string;
  subject?: string;
  message?: string;
  consent?: string;
};

const CF_KEY_MAP: Record<string, keyof ContactFormFields> = {
  "from": "name",
  "email": "email",
  "phone": "phone",
  "event date": "event_date",
  "subject": "subject",
  "message": "message",
  "consent preferences": "consent",
};

/**
 * Pulls the labelled field list out of a contact form notification body (already
 * converted to text). Each value runs until the next label — so a multi-line message
 * survives intact — or until the footer.
 */
export function parseContactFormFields(plainText: string): ContactFormFields {
  const footerAt = plainText.search(CF_FOOTER_RE);
  const region = footerAt > 0 ? plainText.slice(0, footerAt) : plainText;

  const hits: { key: keyof ContactFormFields; start: number; valueAt: number }[] = [];
  for (const m of region.matchAll(CF_FIELD_RE)) {
    const key = CF_KEY_MAP[m[1].toLowerCase()];
    if (key && m.index !== undefined) hits.push({ key, start: m.index, valueAt: m.index + m[0].length });
  }

  const out: ContactFormFields = {};
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].start : region.length;
    const value = region.slice(hits[i].valueAt, end).trim();
    // First label wins: a lead who types "Email: someone-else@x.com" inside their own
    // message must not be able to redirect the draft away from their real address.
    if (value && !out[hits[i].key]) out[hits[i].key] = value.slice(0, 4000);
  }
  return out;
}

/**
 * Resolves who the draft must be addressed to. The lead is the person who filled the
 * form, never the brand inbox that forwarded the notification to itself.
 */
export function resolveContactFormLead(
  rawBody: string,
  fields: ContactFormFields,
  brandEmail: string,
): { name: string; email: string } | null {
  const candidates = [
    fields.email?.match(EMAIL_RE)?.[0],
    rawBody.match(/mailto:([^"'>\s?]+@[^"'>\s?]+)/i)?.[1],
    rawBody.match(/Email[ \t]*:\s*([^\s@<>"']+@[^\s@<>"',;]+\.[a-z]{2,})/i)?.[1],
  ];
  for (const candidate of candidates) {
    const email = (candidate ?? "").toLowerCase().trim();
    if (email && email !== brandEmail.toLowerCase()) {
      return { name: fields.name?.split("\n")[0]?.trim() ?? "", email };
    }
  }
  return null;
}
