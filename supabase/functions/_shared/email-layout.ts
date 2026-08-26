/**
 * OEV shared email design system v2 — bold-mono, Domino's-style stacked
 * color modules. Single source of truth for every guest-facing email.
 * Table-based, fully inline-styled HTML for Gmail/Outlook/Apple Mail.
 *
 * Visual language:
 *  - thin accent action bar on top
 *  - compact black brand header: logo + personalized greeting + action chip
 *  - stacked rounded modules (radius 30) in soft blue / solid blue / ink
 *  - giant condensed-italic display type instead of photos
 *  - "burst" badge for the one number that matters (amount, code, date)
 *  - emoji icon steps row (Domino's PULL UP / CHECK IN / WE BRING IT pattern)
 *  - black footer with contact block
 *
 * No photography — type and color carry the design.
 */

export const BRAND = {
  accent: "#0284C7", // exact web primary: hsl(200 98% 39%)
  accentBright: "#38BDF8", // dark-bg links / gradient partner
  accentDeep: "#0369A1",
  ink: "#0B0F19",
  black: "#000000", // header bg — matches the logo's own background
  text: "#3B4252",
  muted: "#64748B",
  line: "#E2E8F0",
  softBlue: "#EAF4FB", // module ground, tinted toward brand hue
  pageBg: "#FFFFFF",
  success: "#059669",
  danger: "#DC2626",
  amber: "#D97706",
} as const;

export const ASSETS = {
  logo: "https://orlandoeventvenue.org/email/logo-dark.png",
} as const;

export const CONTACT = {
  name: "Orlando Event Venue",
  address: "3847 E Colonial Dr, Orlando, FL 32803",
  phone: "(407) 974-5979",
  phoneCompact: "407 974 5979",
  email: "orlandoeventvenue@gmail.com",
  site: "orlandoeventvenue.org",
  siteUrl: "https://orlandoeventvenue.org",
  mapsUrl: "https://maps.google.com/?q=3847+E+Colonial+Dr,+Orlando,+FL+32803",
} as const;

const FONT = "Arial,Helvetica,sans-serif";
const DISPLAY_FONT = "'Arial Black',Arial,Helvetica,sans-serif";

/** Base paragraph style — spread into <p style="${P}"> */
export const P = `margin:14px 0 0;font-size:15px;line-height:1.65;color:${BRAND.text};font-family:${FONT};`;

/** Escape user-supplied text for safe insertion into HTML */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function para(html: string): string {
  return `<p style="${P}">${html}</p>`;
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

export interface ShellOptions {
  title: string;
  preview: string;
  /** Personalized greeting for the header strip, e.g. "Maria, your date is held!" */
  greeting?: string;
  /** Small action chip in the header, e.g. { label: "EVENT PAGE", url: ... } */
  chip?: { label: string; url: string };
  /** Thin action bar above the header, e.g. { label: "OPEN YOUR EVENT PAGE →", url } */
  topBar?: { label: string; url: string };
  /** Stacked modules — build with heroModule / colorModule / stepsRow / venueCard / plain rows */
  body: string;
  /** Extra line in the footer small print */
  footerNote?: string;
  /** Accent color override for top bar + chip (e.g. BRAND.danger for cancellations) */
  accent?: string;
}

/**
 * The one shell. White page, 600px column of stacked rounded modules,
 * compact black brand header, black footer.
 */
export function emailShell(opts: ShellOptions): string {
  const ac = opts.accent || BRAND.accent;
  const topBar = opts.topBar
    ? `<tr><td align="center" bgcolor="${ac}" style="background:${ac};padding:9px 16px;border-radius:0 0 14px 14px;">
        <a href="${opts.topBar.url}" style="font-family:${FONT};font-size:12px;font-weight:bold;letter-spacing:2px;color:#FFFFFF;text-decoration:none;text-transform:uppercase;">${opts.topBar.label}</a>
      </td></tr>
      <tr><td style="height:10px;line-height:10px;font-size:0;">&nbsp;</td></tr>`
    : "";
  const chip = opts.chip
    ? `<td align="right" valign="middle">
        <a href="${opts.chip.url}" style="display:inline-block;background:${ac};color:#FFFFFF;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;text-decoration:none;padding:10px 18px;border-radius:999px;">${opts.chip.label}</a>
      </td>`
    : "";
  const greeting = opts.greeting
    ? `<tr><td colspan="2" align="center" style="padding:10px 8px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:#FFFFFF;"><strong>${opts.greeting}</strong></td></tr>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.pageBg};font-family:${FONT};color:${BRAND.ink};">
<div style="display:none;font-size:1px;color:${BRAND.pageBg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${opts.preview}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.pageBg};">
<tr><td align="center" style="padding:0 10px 28px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">
  ${topBar}
  <tr><td align="center" bgcolor="${BRAND.black}" style="background:${BRAND.black};border-radius:${opts.topBar ? "18px" : "0 0 18px 18px"};padding:16px 20px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="${opts.chip ? "left" : "center"}" valign="middle">
          <a href="${CONTACT.siteUrl}" style="text-decoration:none;">
            <img src="${ASSETS.logo}" alt="Orlando Event Venue" width="170" style="display:inline-block;width:170px;max-width:60%;height:auto;border:0;">
          </a>
        </td>
        ${chip}
      </tr>
      ${greeting}
    </table>
  </td></tr>
  <tr><td style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>
  ${opts.body}
  <tr><td align="center" bgcolor="${BRAND.black}" style="background:${BRAND.black};border-radius:22px;padding:26px 30px;">
    <img src="${ASSETS.logo}" alt="Orlando Event Venue" width="150" style="display:inline-block;width:150px;height:auto;border:0;">
    <p style="margin:14px 0 0;font-size:12px;line-height:1.8;color:rgba(255,255,255,.75);font-family:${FONT};">
      ${CONTACT.address}<br>
      <a href="tel:+14079745979" style="color:#FFFFFF;text-decoration:none;font-weight:bold;">${CONTACT.phone}</a>
      &nbsp;&middot;&nbsp;
      <a href="mailto:${CONTACT.email}" style="color:rgba(255,255,255,.75);text-decoration:none;">${CONTACT.email}</a>
    </p>
    <p style="margin:10px 0 0;font-size:13px;">
      <a href="${CONTACT.siteUrl}" style="color:${BRAND.accentBright};font-weight:bold;text-decoration:none;letter-spacing:.5px;">${CONTACT.site}</a>
    </p>
    <p style="margin:14px 0 0;font-size:10.5px;line-height:1.6;color:rgba(255,255,255,.4);font-family:${FONT};">
      This is an automated email. Please keep it for your records.${opts.footerNote ? `<br>${opts.footerNote}` : ""}
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Spacer row between modules (12px). */
export function gap(): string {
  return `<tr><td style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>`;
}

/* ------------------------------------------------------------------ */
/* Type + badges                                                       */
/* ------------------------------------------------------------------ */

/** Giant condensed-italic display headline — the Domino's "LARGE 3-TOPPING" move. */
export function displayTitle(text: string, opts?: { color?: string; size?: number }): string {
  const size = opts?.size ?? 40;
  return `<div style="font-family:${DISPLAY_FONT};font-style:italic;font-weight:900;font-size:${size}px;line-height:1.02;letter-spacing:-1px;text-transform:uppercase;color:${opts?.color || BRAND.accent};">${text}</div>`;
}

/** Two-tone display: first part ink, second part accent (like the logo's ORLANDO / EVENT VENUE). */
export function displayTitleDuo(top: string, bottom: string, opts?: { topColor?: string; bottomColor?: string; size?: number }): string {
  const size = opts?.size ?? 40;
  return `<div style="font-family:${DISPLAY_FONT};font-style:italic;font-weight:900;font-size:${size}px;line-height:1.05;letter-spacing:-1px;text-transform:uppercase;">
    <span style="color:${opts?.topColor || BRAND.ink};">${top}</span><br>
    <span style="color:${opts?.bottomColor || BRAND.accent};">${bottom}</span>
  </div>`;
}

/**
 * Burst badge — the one number that matters, Domino's price-burst style.
 * Solid accent pill, huge white type.
 */
export function burst(value: string, opts?: { sub?: string; color?: string; size?: number }): string {
  const size = opts?.size ?? 40;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
    <td align="center" bgcolor="${opts?.color || BRAND.accent}" style="background:${opts?.color || BRAND.accent};border-radius:999px;padding:16px 40px;">
      <div style="font-family:${DISPLAY_FONT};font-style:italic;font-weight:900;font-size:${size}px;line-height:1;letter-spacing:1px;color:#FFFFFF;">${value}</div>
      ${opts?.sub ? `<div style="font-family:${FONT};font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.85);padding-top:6px;">${opts.sub}</div>` : ""}
    </td>
  </tr></table>`;
}

/** Dashed ticket badge for codes the guest must type (reservation number, coupon). */
export function ticket(label: string, value: string, sub?: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" bgcolor="#FFFFFF" style="background:#FFFFFF;border:3px dashed ${BRAND.accent};border-radius:16px;padding:16px 36px;">
        <div style="font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:2.5px;text-transform:uppercase;color:${BRAND.muted};">${label}</div>
        <div style="font-family:${DISPLAY_FONT};font-weight:900;font-size:34px;line-height:1.15;letter-spacing:2px;color:${BRAND.ink};padding-top:4px;">${value}</div>
        ${sub ? `<div style="font-family:${FONT};font-size:12.5px;color:${BRAND.muted};padding-top:6px;">${sub}</div>` : ""}
      </td>
    </tr></table>
  </td></tr></table>`;
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

export function primaryButton(text: string, url: string, color?: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 0 4px;">
    <a href="${url}" style="display:inline-block;background:${color || BRAND.accent};color:#FFFFFF;text-decoration:none;padding:16px 46px;border-radius:999px;font-size:16px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;font-family:${FONT};">${text}</a>
  </td></tr></table>`;
}

/** White pill on a colored (drenched) module. */
export function invertedButton(text: string, url: string, textColor?: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:22px 0 4px;">
    <a href="${url}" style="display:inline-block;background:#FFFFFF;color:${textColor || BRAND.accent};text-decoration:none;padding:15px 42px;border-radius:999px;font-size:15px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;font-family:${FONT};">${text}</a>
  </td></tr></table>`;
}

export function secondaryButton(text: string, url: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:12px 0 2px;">
    <a href="${url}" style="display:inline-block;background:#FFFFFF;color:${BRAND.accent};text-decoration:none;padding:13px 38px;border:2px solid ${BRAND.accent};border-radius:999px;font-size:14px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;font-family:${FONT};">${text}</a>
  </td></tr></table>`;
}

/** Stacked full-row action buttons (Domino's BROWSE MENU / DEALS pattern). */
export function stackButtons(buttons: Array<{ label: string; url: string }>): string {
  return buttons
    .map(
      (b) => `<tr><td align="center" style="padding:5px 0;">
      <a href="${b.url}" style="display:inline-block;width:280px;max-width:88%;background:${BRAND.accent};color:#FFFFFF;text-decoration:none;padding:14px 0;border-radius:999px;font-size:14px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;text-align:center;font-family:${FONT};">${b.label}</a>
    </td></tr>`,
    )
    .join("");
}

/* ------------------------------------------------------------------ */
/* Modules (each returns a full shell row: <tr><td>…</td></tr>)        */
/* ------------------------------------------------------------------ */

export interface HeroModuleOptions {
  /** Small bold kicker, e.g. "PAYMENT RECEIVED" */
  eyebrow?: string;
  /** Output of displayTitle()/displayTitleDuo() */
  display: string;
  /** Output of burst()/ticket() — the focal number. Optional. */
  badge?: string;
  /** Short supporting copy (plain html, will be centered) */
  lede?: string;
  /** Output of primaryButton() */
  cta?: string;
  bg?: string;
}

/** Main offer module — soft blue rounded 30, centered, type-first. */
export function heroModule(opts: HeroModuleOptions): string {
  return `<tr><td align="center" bgcolor="${opts.bg || BRAND.softBlue}" style="background:${opts.bg || BRAND.softBlue};border-radius:30px;padding:38px 30px 34px;">
    ${opts.eyebrow ? `<div style="font-family:${FONT};font-size:12px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;color:${BRAND.accent};padding-bottom:12px;">${opts.eyebrow}</div>` : ""}
    ${opts.display}
    ${opts.badge ? `<div style="padding-top:22px;">${opts.badge}</div>` : ""}
    ${opts.lede ? `<div style="font-family:${FONT};font-size:15.5px;line-height:1.6;color:${BRAND.text};padding-top:18px;max-width:440px;margin:0 auto;">${opts.lede}</div>` : ""}
    ${opts.cta || ""}
  </td></tr>`;
}

export interface ColorModuleOptions {
  /** e.g. "WHAT HAPPENS" */
  title?: string;
  /** Giant white display line, e.g. "NEXT." — rendered via displayTitle with white */
  display?: string;
  /** Body html — white text on the colored ground */
  body?: string;
  /** Output of invertedButton() */
  cta?: string;
  bg?: string;
}

/** Drenched module — solid brand color, white type (Domino's CARRYOUT. DELIVERED.). */
export function colorModule(opts: ColorModuleOptions): string {
  const bg = opts.bg || BRAND.accent;
  return `<tr><td bgcolor="${bg}" style="background:${bg};border-radius:30px;padding:32px 34px;">
    ${opts.title ? `<div style="font-family:${FONT};font-size:14px;font-weight:bold;letter-spacing:2.5px;text-transform:uppercase;color:rgba(255,255,255,.85);padding-bottom:6px;">${opts.title}</div>` : ""}
    ${opts.display ? `<div style="font-family:${DISPLAY_FONT};font-style:italic;font-weight:900;font-size:34px;line-height:1.05;letter-spacing:-.5px;text-transform:uppercase;color:#FFFFFF;">${opts.display}</div>` : ""}
    ${opts.body ? `<div style="font-family:${FONT};font-size:15px;line-height:1.65;font-weight:bold;color:#FFFFFF;padding-top:14px;">${opts.body}</div>` : ""}
    ${opts.cta || ""}
  </td></tr>`;
}

export interface Step {
  /** Emoji icon, rendered big */
  icon: string;
  /** Short uppercase label */
  label: string;
  /** Optional one-line detail under the label */
  detail?: string;
}

/**
 * Icon steps row — Domino's STEP 1 / STEP 2 / STEP 3 pattern.
 * 2-4 steps, each: numbered chip, big emoji, bold label.
 */
export function stepsRow(steps: Step[], opts?: { bg?: string; stepWord?: string }): string {
  const bg = opts?.bg || BRAND.accentDeep;
  const word = opts?.stepWord ?? "Step";
  const width = Math.floor(100 / steps.length);
  const cells = steps
    .map(
      (s, i) => `<td width="${width}%" align="center" valign="top" style="padding:6px 6px 0;">
      <div style="display:inline-block;background:#FFFFFF;color:${bg};font-family:${FONT};font-size:10.5px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;border-radius:999px;padding:4px 12px;">${word} ${i + 1}</div>
      <div style="font-size:44px;line-height:1.25;padding-top:10px;">${s.icon}</div>
      <div style="font-family:${DISPLAY_FONT};font-style:italic;font-weight:900;font-size:17px;letter-spacing:.5px;text-transform:uppercase;color:#FFFFFF;padding-top:8px;">${s.label}</div>
      ${s.detail ? `<div style="font-family:${FONT};font-size:12px;line-height:1.5;color:rgba(255,255,255,.85);padding-top:5px;">${s.detail}</div>` : ""}
    </td>`,
    )
    .join("");
  return `<tr><td bgcolor="${bg}" style="background:${bg};border-radius:30px;padding:26px 18px 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>
  </td></tr>`;
}

/** White content module for running copy — rounded, bordered, left-aligned. */
export function textModule(bodyHtml: string): string {
  return `<tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid ${BRAND.line};border-radius:30px;padding:28px 32px 32px;">${bodyHtml}</td></tr>`;
}

/** Venue locator card — dark ink, big address (Domino's YOUR LOCAL STORE). */
export function venueCard(opts?: { title?: string; cta?: { label: string; url: string } }): string {
  return `<tr><td align="center" bgcolor="${BRAND.ink}" style="background:${BRAND.ink};border-radius:30px;padding:30px 34px;">
    <div style="font-size:40px;line-height:1;">📍</div>
    <div style="font-family:${DISPLAY_FONT};font-style:italic;font-weight:900;font-size:22px;letter-spacing:.5px;text-transform:uppercase;color:${BRAND.accentBright};padding-top:10px;">${opts?.title || "Your Venue"}</div>
    <div style="font-family:${FONT};font-size:21px;line-height:1.4;color:#FFFFFF;font-weight:bold;padding-top:8px;">3847 E Colonial Dr<br>Orlando, FL 32803</div>
    <div style="padding-top:16px;">
      <a href="${opts?.cta?.url || CONTACT.mapsUrl}" style="display:inline-block;background:transparent;color:#FFFFFF;text-decoration:none;padding:11px 30px;border:2px solid ${BRAND.accentBright};border-radius:999px;font-size:13px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;font-family:${FONT};">${opts?.cta?.label || "Get Directions"}</a>
    </div>
  </td></tr>`;
}

/* ------------------------------------------------------------------ */
/* Data blocks (used inside textModule / heroModule)                   */
/* ------------------------------------------------------------------ */

export function detailRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:9px 0;border-top:1px solid ${BRAND.line};font-size:13px;color:${BRAND.muted};font-family:${FONT};">${label}</td>
    <td align="right" style="padding:9px 0;border-top:1px solid ${BRAND.line};font-size:14px;color:${BRAND.ink};font-weight:bold;font-family:${FONT};">${value}</td>
  </tr>`;
}

export function detailTable(rows: Array<[string, string]>): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
    ${rows.map(([l, v]) => detailRow(l, v)).join("")}
  </table>`;
}

/** Labeled data card (soft ground) — for "FOR REFERENCE" style detail blocks. */
export function sectionCard(title: string, bodyHtml: string, icon?: string): string {
  return `<div style="background:${BRAND.softBlue};border-radius:18px;padding:18px 22px;margin:20px 0 0;text-align:left;">
    <p style="margin:0 0 8px;font-size:12px;color:${BRAND.accentDeep};text-transform:uppercase;letter-spacing:2px;font-weight:bold;">${icon ? `${icon}&nbsp; ` : ""}${title}</p>
    ${bodyHtml}
  </div>`;
}

/**
 * Numbered list rendered as big blue numerals beside the text.
 * The copy spec (ClickUp OEV POST BOOKING COMMUNICATIONS) numbers a list
 * whenever the reader has several things to do or check — this renders
 * those items without altering a word of them.
 */
export function numberedList(items: string[]): string {
  const rows = items
    .map(
      (item, i) => `<tr>
      <td width="46" valign="top" style="padding:0 12px 16px 0;">
        <div style="width:34px;height:34px;line-height:34px;border-radius:999px;background:${BRAND.accent};color:#FFFFFF;font-family:${DISPLAY_FONT};font-style:italic;font-weight:900;font-size:17px;text-align:center;">${i + 1}</div>
      </td>
      <td valign="top" style="padding:4px 0 16px;font-family:${FONT};font-size:15px;line-height:1.6;color:${BRAND.text};">${item}</td>
    </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;">${rows}</table>`;
}

/**
 * CTA button whose label is the destination itself, so the design adds
 * emphasis without inventing copy the spec does not contain.
 */
export function linkButton(url: string, label?: string): string {
  return primaryButton(label || url.replace(/^https?:\/\//, ""), url);
}

/**
 * The standard reference block — section 3 of the copy spec. Appears at the
 * bottom of every booking email, and must not interrupt the message.
 * Labels are fixed by the spec; only the values vary.
 */
export function referenceModule(rows: Array<[string, string]>): string {
  return `<tr><td bgcolor="${BRAND.softBlue}" style="background:${BRAND.softBlue};border-radius:30px;padding:26px 32px 28px;">
    <p style="margin:0 0 6px;font-family:${FONT};font-size:12px;font-weight:bold;letter-spacing:2.5px;text-transform:uppercase;color:${BRAND.accentDeep};">For Reference</p>
    ${detailTable(rows)}
  </td></tr>`;
}

/** Plain-link fallbacks under buttons */
export function fallbackLinks(urls: string[]): string {
  const lines = urls
    .map((u) => `<a href="${u}" style="word-break:break-all;color:${BRAND.accent};text-decoration:none;">${u}</a>`)
    .join("<br>");
  return `<p style="margin:14px 0 0;font-size:11.5px;line-height:1.5;color:${BRAND.muted};text-align:center;">If the buttons don't work, copy and paste these links into your browser:<br>${lines}</p>`;
}

/**
 * Team sign-off. The copy spec ends each email with a specific set of lines,
 * so pass only the lines that email actually carries — never add one.
 */
export function signature(opts?: { phone?: boolean; email?: boolean; site?: boolean; address?: boolean }): string {
  const lines = ["Luis and the Orlando Event Venue Team"];
  if (opts?.phone) lines.push(`<strong>${CONTACT.phoneCompact}</strong>`);
  if (opts?.site) {
    lines.push(`<a href="${CONTACT.siteUrl}" style="color:${BRAND.accent};text-decoration:none;">${CONTACT.site}</a>`);
  }
  if (opts?.email) {
    lines.push(`<a href="mailto:${CONTACT.email}" style="color:${BRAND.accent};text-decoration:none;">${CONTACT.email}</a>`);
  }
  if (opts?.address) lines.push(CONTACT.address);
  return `<p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:${BRAND.text};font-family:${FONT};">${lines.join("<br>")}</p>`;
}

/**
 * denomailer 1.6.0's quoted-printable encoder turns whitespace-only lines
 * into a literal "=20" that renders as visible junk. Strip trailing
 * whitespace per line before handing HTML to client.send().
 */
export function sanitizeForSmtp(html: string): string {
  return html
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
}
