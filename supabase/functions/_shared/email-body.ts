// Shared email body helpers.
//
// Used by composio-gmail-webhook to turn a fetched Gmail message into plain text
// before handing it to the model. Kept here (instead of inline in the function) so
// supabase/functions/_tests can exercise the real implementation.

export function htmlToText(html: string): string {
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

export function stripQuotedReplyText(text: string): string {
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

/**
 * Normalizes a raw message body (HTML or plain) to text.
 *
 * stripQuotes MUST be false for contact form notifications: their body is a labelled
 * field list ("From: …", "Email: …") and the ^From: quoted-reply marker would cut the
 * whole submission away, leaving the model with just the notification header.
 */
export function emailBodyToText(raw: unknown, opts?: { stripQuotes?: boolean }): string {
  const str = (raw ?? "").toString();
  const looksHtml = /<[a-z!][\s\S]*>/i.test(str);
  const text = looksHtml ? htmlToText(str) : str;
  const body = opts?.stripQuotes === false ? text.trim() : stripQuotedReplyText(text);
  return body.slice(0, 6000);
}
