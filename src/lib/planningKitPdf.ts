import type { jsPDF } from "jspdf";
import {
  KIT_ADDRESS,
  KIT_OFFER_CODE,
  KIT_PHONE,
  SECTIONS,
  VENUE_SNAPSHOT,
  type Block,
  type Section,
} from "@/lib/planningKitContent";
import type { KitState } from "@/hooks/usePlanningKitState";

/* Letter portrait, in points. */
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 54;
const MARGIN_TOP = 62;
const MARGIN_BOTTOM = 58;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const INK: [number, number, number] = [17, 24, 39];
const BODY: [number, number, number] = [55, 65, 81];
const MUTED: [number, number, number] = [107, 114, 128];
const BRAND: [number, number, number] = [20, 173, 230];
const DARK: [number, number, number] = [11, 15, 25];
const RULE: [number, number, number] = [214, 221, 229];
const ZEBRA: [number, number, number] = [246, 248, 250];

type Ctx = {
  doc: jsPDF;
  y: number;
  page: number;
};

function newPage(ctx: Ctx) {
  ctx.doc.addPage();
  ctx.page += 1;
  ctx.y = MARGIN_TOP;
}

/** Reserve vertical space; break to a new page when the block would overflow. */
function ensure(ctx: Ctx, needed: number) {
  if (ctx.y + needed > PAGE_H - MARGIN_BOTTOM) newPage(ctx);
}

function setFont(ctx: Ctx, style: "normal" | "bold", size: number, color: [number, number, number]) {
  ctx.doc.setFont("helvetica", style);
  ctx.doc.setFontSize(size);
  ctx.doc.setTextColor(...color);
}

function writeLines(ctx: Ctx, text: string, opts: {
  size?: number;
  style?: "normal" | "bold";
  color?: [number, number, number];
  width?: number;
  leading?: number;
  indent?: number;
  gapAfter?: number;
}) {
  const size = opts.size ?? 10;
  const leading = opts.leading ?? size * 1.45;
  const indent = opts.indent ?? 0;
  const width = opts.width ?? CONTENT_W - indent;
  setFont(ctx, opts.style ?? "normal", size, opts.color ?? BODY);
  const lines = ctx.doc.splitTextToSize(text, width) as string[];
  for (const line of lines) {
    ensure(ctx, leading);
    ctx.doc.text(line, MARGIN_X + indent, ctx.y);
    ctx.y += leading;
  }
  ctx.y += opts.gapAfter ?? 0;
}

function checkbox(ctx: Ctx, x: number, baselineY: number, checked: boolean) {
  const size = 8.5;
  const top = baselineY - size + 1.5;
  ctx.doc.setLineWidth(0.8);
  ctx.doc.setDrawColor(...(checked ? BRAND : MUTED));
  ctx.doc.roundedRect(x, top, size, size, 1.5, 1.5, "S");
  if (checked) {
    ctx.doc.setDrawColor(...BRAND);
    ctx.doc.setLineWidth(1.4);
    ctx.doc.lines([[2.2, 2.4], [3.9, -5.2]], x + 1.8, top + 4.3);
    ctx.doc.setLineWidth(0.8);
  }
}

const FIELD_LEADING = 12;

/** Wrap a typed value to the column width; empty values become ruled blanks. */
function fieldLines(ctx: Ctx, value: string, width: number): string[] {
  if (!value.trim()) return [];
  setFont(ctx, "normal", 9.5, INK);
  return ctx.doc.splitTextToSize(value.trim(), width) as string[];
}

/**
 * Draw a filled-in value across as many lines as it needs, or a rule to write
 * on after printing. Returns the height consumed.
 */
function drawField(ctx: Ctx, value: string, x: number, width: number, top: number): number {
  const lines = fieldLines(ctx, value, width);
  if (lines.length === 0) {
    ctx.doc.setDrawColor(...RULE);
    ctx.doc.setLineWidth(0.6);
    ctx.doc.line(x, top + 1.5, x + width, top + 1.5);
    return FIELD_LEADING;
  }
  setFont(ctx, "normal", 9.5, INK);
  lines.forEach((line, i) => ctx.doc.text(line, x, top + i * FIELD_LEADING));
  return lines.length * FIELD_LEADING;
}

function sectionHeading(ctx: Ctx, section: Section) {
  /* Reserve enough room that a heading always drags real content with it,
     instead of stranding a title at the foot of a page. */
  ensure(ctx, 130);
  ctx.y += 12;
  if (section.number) {
    setFont(ctx, "bold", 11, BRAND);
    ctx.doc.text(`${section.number}.`, MARGIN_X, ctx.y);
  }
  setFont(ctx, "bold", 14, INK);
  const indent = section.number ? 20 : 0;
  const lines = ctx.doc.splitTextToSize(section.title, CONTENT_W - indent) as string[];
  for (const [i, line] of lines.entries()) {
    ctx.doc.text(line, MARGIN_X + indent, ctx.y);
    if (i < lines.length - 1) ctx.y += 17;
  }
  ctx.y += 8;
  ctx.doc.setDrawColor(...RULE);
  ctx.doc.setLineWidth(0.8);
  ctx.doc.line(MARGIN_X, ctx.y, MARGIN_X + CONTENT_W, ctx.y);
  ctx.y += 14;
}

function renderTable(ctx: Ctx, headers: string[], rows: string[][]) {
  const cols = headers.length;
  const colW = CONTENT_W / cols;
  const padX = 7;
  const padY = 6;
  const size = 9;
  const leading = size * 1.35;

  const drawHeader = () => {
    ensure(ctx, 26);
    ctx.doc.setFillColor(...DARK);
    ctx.doc.rect(MARGIN_X, ctx.y, CONTENT_W, 20, "F");
    setFont(ctx, "bold", 8.5, [255, 255, 255]);
    headers.forEach((h, i) => {
      ctx.doc.text(h.toUpperCase(), MARGIN_X + i * colW + padX, ctx.y + 13);
    });
    ctx.y += 20;
  };

  drawHeader();

  rows.forEach((row, rowIndex) => {
    setFont(ctx, "normal", size, BODY);
    const cellLines = row.map((cell) => ctx.doc.splitTextToSize(cell, colW - padX * 2) as string[]);
    const height = Math.max(...cellLines.map((l) => l.length)) * leading + padY * 2;

    if (ctx.y + height > PAGE_H - MARGIN_BOTTOM) {
      newPage(ctx);
      drawHeader();
    }

    if (rowIndex % 2 === 1) {
      ctx.doc.setFillColor(...ZEBRA);
      ctx.doc.rect(MARGIN_X, ctx.y, CONTENT_W, height, "F");
    }
    ctx.doc.setDrawColor(...RULE);
    ctx.doc.setLineWidth(0.5);
    ctx.doc.line(MARGIN_X, ctx.y, MARGIN_X + CONTENT_W, ctx.y);

    setFont(ctx, "normal", size, BODY);
    cellLines.forEach((lines, colIndex) => {
      lines.forEach((line, lineIndex) => {
        ctx.doc.text(line, MARGIN_X + colIndex * colW + padX, ctx.y + padY + leading * (lineIndex + 0.75));
      });
    });
    ctx.y += height;
  });

  ctx.doc.setDrawColor(...RULE);
  ctx.doc.line(MARGIN_X, ctx.y, MARGIN_X + CONTENT_W, ctx.y);
  ctx.y += 12;
}

function renderChecklist(ctx: Ctx, id: string, items: string[], state: KitState) {
  const size = 9.5;
  const leading = size * 1.5;
  const textX = MARGIN_X + 15;
  const width = CONTENT_W - 15;

  items.forEach((item, index) => {
    const checked = !!state.checks[`${id}:${index}`];
    setFont(ctx, "normal", size, checked ? MUTED : BODY);
    const lines = ctx.doc.splitTextToSize(item, width) as string[];
    ensure(ctx, leading * lines.length);
    checkbox(ctx, MARGIN_X, ctx.y, checked);
    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) ctx.y += leading;
      ctx.doc.text(line, textX, ctx.y);
    });
    ctx.y += leading;
  });
  ctx.y += 6;
}

function renderWorksheet(ctx: Ctx, id: string, headers: string[], labels: string[], state: KitState) {
  const inputCount = headers.length - 1;
  const labelW = CONTENT_W * (inputCount === 1 ? 0.42 : 0.44);
  const inputW = (CONTENT_W - labelW) / inputCount;

  /* Column headers repeat after a page break, otherwise the blanks on the
     following page have no label telling you what to write in them. */
  const drawHeader = () => {
    setFont(ctx, "bold", 8, MUTED);
    headers.forEach((h, i) => {
      const x = i === 0 ? MARGIN_X : MARGIN_X + labelW + (i - 1) * inputW + 4;
      ctx.doc.text(h.toUpperCase(), x, ctx.y);
    });
    ctx.y += 12;
  };

  ensure(ctx, 60);
  drawHeader();

  labels.forEach((label, rowIndex) => {
    setFont(ctx, "normal", 9.5, BODY);
    const labelLines = ctx.doc.splitTextToSize(label, labelW - 10) as string[];
    const valueHeights: number[] = [];
    for (let col = 0; col < inputCount; col++) {
      const value = state.fields[`${id}:${rowIndex}:${col}`] ?? "";
      const lines = fieldLines(ctx, value, inputW - 12);
      valueHeights.push(Math.max(1, lines.length) * FIELD_LEADING);
    }
    const rowH = Math.max(22, labelLines.length * FIELD_LEADING + 8, Math.max(...valueHeights) + 8);

    if (ctx.y + rowH > PAGE_H - MARGIN_BOTTOM) {
      newPage(ctx);
      drawHeader();
    }

    setFont(ctx, "normal", 9.5, BODY);
    labelLines.forEach((line, i) => {
      ctx.doc.text(line, MARGIN_X, ctx.y + i * FIELD_LEADING);
    });

    for (let col = 0; col < inputCount; col++) {
      const value = state.fields[`${id}:${rowIndex}:${col}`] ?? "";
      const x = MARGIN_X + labelW + col * inputW + 4;
      drawField(ctx, value, x, inputW - 12, ctx.y);
    }

    ctx.y += rowH;
    ctx.doc.setDrawColor(...RULE);
    ctx.doc.setLineWidth(0.4);
    ctx.doc.line(MARGIN_X, ctx.y - 8, MARGIN_X + CONTENT_W, ctx.y - 8);
  });
  ctx.y += 8;
}

function renderSchedule(ctx: Ctx, id: string, activities: string[], state: KitState) {
  const timeW = 84;
  const activityW = CONTENT_W * 0.42;
  const personW = CONTENT_W - timeW - activityW;

  const drawHeader = () => {
    setFont(ctx, "bold", 8, MUTED);
    ctx.doc.text("TIME", MARGIN_X, ctx.y);
    ctx.doc.text("ACTIVITY", MARGIN_X + timeW, ctx.y);
    ctx.doc.text("ASSIGNED PERSON", MARGIN_X + timeW + activityW, ctx.y);
    ctx.y += 12;
  };

  ensure(ctx, 60);
  drawHeader();

  activities.forEach((activity, rowIndex) => {
    const time = state.fields[`${id}:${rowIndex}:0`] ?? "";
    const person = state.fields[`${id}:${rowIndex}:1`] ?? "";
    const rowH = Math.max(
      22,
      Math.max(
        fieldLines(ctx, time, timeW - 12).length,
        fieldLines(ctx, person, personW - 8).length,
        1
      ) * FIELD_LEADING + 8
    );

    if (ctx.y + rowH > PAGE_H - MARGIN_BOTTOM) {
      newPage(ctx);
      drawHeader();
    }
    drawField(ctx, time, MARGIN_X, timeW - 12, ctx.y);
    setFont(ctx, "normal", 9.5, BODY);
    ctx.doc.text(activity, MARGIN_X + timeW, ctx.y);
    drawField(ctx, person, MARGIN_X + timeW + activityW, personW - 8, ctx.y);
    ctx.y += rowH;
    ctx.doc.setDrawColor(...RULE);
    ctx.doc.setLineWidth(0.4);
    ctx.doc.line(MARGIN_X, ctx.y - 8, MARGIN_X + CONTENT_W, ctx.y - 8);
  });
  ctx.y += 8;
}

function renderOffer(ctx: Ctx) {
  ensure(ctx, 42);
  const h = 34;
  ctx.doc.setFillColor(240, 249, 254);
  ctx.doc.setDrawColor(...BRAND);
  ctx.doc.setLineWidth(0.8);
  ctx.doc.roundedRect(MARGIN_X, ctx.y, CONTENT_W, h, 5, 5, "FD");
  setFont(ctx, "bold", 11, DARK);
  ctx.doc.text(KIT_OFFER_CODE, MARGIN_X + 14, ctx.y + 21);
  setFont(ctx, "normal", 9.5, BODY);
  ctx.doc.text("$50 OFF your venue rental. Enter the code during checkout.", MARGIN_X + 70, ctx.y + 21);
  ctx.y += h + 14;
}

function renderBlock(ctx: Ctx, block: Block, state: KitState) {
  switch (block.kind) {
    case "paragraph":
      writeLines(ctx, block.text, { size: 10, gapAfter: 6 });
      break;
    case "note":
      writeLines(ctx, block.text, { size: 9, color: MUTED, gapAfter: 8 });
      break;
    case "subheading":
      ensure(ctx, 72);
      ctx.y += 6;
      writeLines(ctx, block.text, { size: 11, style: "bold", color: INK, gapAfter: 4 });
      break;
    case "bullets":
      for (const item of block.items) {
        setFont(ctx, "normal", 9.5, BODY);
        const lines = ctx.doc.splitTextToSize(item, CONTENT_W - 16) as string[];
        ensure(ctx, 14 * lines.length);
        ctx.doc.setFillColor(...MUTED);
        ctx.doc.circle(MARGIN_X + 3, ctx.y - 3, 1.5, "F");
        lines.forEach((line, i) => {
          if (i > 0) ctx.y += 14;
          ctx.doc.text(line, MARGIN_X + 14, ctx.y);
        });
        ctx.y += 14;
      }
      ctx.y += 6;
      break;
    case "ordered":
      block.items.forEach((item, i) => {
        setFont(ctx, "bold", 9.5, BRAND);
        ensure(ctx, 15);
        ctx.doc.text(`${i + 1}.`, MARGIN_X, ctx.y);
        setFont(ctx, "normal", 9.5, BODY);
        const lines = ctx.doc.splitTextToSize(item, CONTENT_W - 18) as string[];
        lines.forEach((line, li) => {
          if (li > 0) ctx.y += 14;
          ctx.doc.text(line, MARGIN_X + 16, ctx.y);
        });
        ctx.y += 15;
      });
      ctx.y += 6;
      break;
    case "checklist":
      renderChecklist(ctx, block.id, block.items, state);
      break;
    case "table":
      renderTable(ctx, block.headers, block.rows);
      break;
    case "worksheet":
      renderWorksheet(ctx, block.id, block.headers, block.labels, state);
      break;
    case "schedule":
      renderSchedule(ctx, block.id, block.activities, state);
      break;
    case "offer":
      renderOffer(ctx);
      break;
  }
}

function coverPage(ctx: Ctx, state: KitState) {
  const { doc } = ctx;
  doc.setFillColor(...DARK);
  doc.rect(0, 0, PAGE_W, 210, "F");

  setFont(ctx, "bold", 9, BRAND);
  doc.text("ORLANDO EVENT VENUE", MARGIN_X, 78);

  setFont(ctx, "bold", 30, [255, 255, 255]);
  doc.text("Your Event Planning Kit", MARGIN_X, 118);

  setFont(ctx, "normal", 10.5, [203, 213, 225]);
  const intro = doc.splitTextToSize(
    "Everything you need to plan a smooth event in our space, including the small things people often forget.",
    CONTENT_W - 40
  ) as string[];
  intro.forEach((line, i) => doc.text(line, MARGIN_X, 144 + i * 15));

  ctx.y = 246;

  const meta: [string, string][] = [
    ["Event", state.meta.eventName],
    ["Date", state.meta.eventDate],
    ["Guests", state.meta.guestCount],
  ];
  const boxW = (CONTENT_W - 20) / 3;
  meta.forEach(([label, value], i) => {
    const x = MARGIN_X + i * (boxW + 10);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.8);
    doc.roundedRect(x, ctx.y, boxW, 52, 5, 5, "S");
    setFont(ctx, "bold", 7.5, MUTED);
    doc.text(label.toUpperCase(), x + 12, ctx.y + 18);
    if (value.trim()) {
      setFont(ctx, "bold", 12, INK);
      doc.text(doc.splitTextToSize(value.trim(), boxW - 24)[0], x + 12, ctx.y + 38);
    } else {
      doc.setDrawColor(...RULE);
      doc.setLineWidth(0.6);
      doc.line(x + 12, ctx.y + 38, x + boxW - 12, ctx.y + 38);
    }
  });
  ctx.y += 76;

  writeLines(
    ctx,
    "Orlando Event Venue is a local nonprofit venue built for events of up to 90 guests. You get a clean, private room that you can arrange for your event. You bring the plan, food, decorations, and event details. We provide the space and clear information so nothing catches you off guard.",
    { size: 10, gapAfter: 10 }
  );

  renderOffer(ctx);

  for (const block of VENUE_SNAPSHOT.blocks) renderBlock(ctx, block, state);
}

function stampFooters(doc: jsPDF) {
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    doc.setPage(page);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.5);
    doc.line(MARGIN_X, PAGE_H - 42, PAGE_W - MARGIN_X, PAGE_H - 42);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Orlando Event Venue  ·  ${KIT_ADDRESS}  ·  ${KIT_PHONE}`, MARGIN_X, PAGE_H - 28);
    doc.text(`${page} / ${total}`, PAGE_W - MARGIN_X, PAGE_H - 28, { align: "right" });
  }
}

function closingPage(ctx: Ctx) {
  ensure(ctx, 150);
  ctx.y += 10;
  setFont(ctx, "bold", 16, INK);
  ctx.doc.text("Ready to hold your date?", MARGIN_X, ctx.y);
  ctx.y += 22;
  writeLines(
    ctx,
    "You have the plan. The next step is holding the space. Your date is held after the first 50 percent is received. The Orlando Event Venue team will then review the timing, guest count, and setup before sending a separate confirmation.",
    { size: 10, gapAfter: 4 }
  );
  writeLines(ctx, "For direct bookings, the remaining balance is due 15 days before the event.", {
    size: 10,
    gapAfter: 10,
  });
  renderOffer(ctx);
  writeLines(ctx, "Begin your booking: orlandoeventvenue.org/book", { size: 10, style: "bold", color: INK, gapAfter: 2 });
  writeLines(ctx, `Questions? Call or text ${KIT_PHONE}.`, { size: 10, gapAfter: 2 });
  writeLines(ctx, "Luis and the Orlando Event Venue Team", { size: 10, color: MUTED });
}

function fileName(state: KitState): string {
  const raw = state.meta.eventName.trim();
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return slug ? `event-planning-kit-${slug}.pdf` : "event-planning-kit.pdf";
}

/**
 * Build the kit as a vector PDF (real selectable text, not a screenshot) and
 * hand it to the browser as a download. jsPDF is imported here so it only ships
 * to visitors who actually press the button.
 */
export async function downloadPlanningKitPdf(state: KitState): Promise<void> {
  const { jsPDF: JsPdf } = await import("jspdf");
  const doc = new JsPdf({ unit: "pt", format: "letter", compress: true });

  doc.setProperties({
    title: "Event Planning Kit — Orlando Event Venue",
    subject: "Event planning checklist, budget, timeline and run sheet",
    author: "Orlando Event Venue",
  });

  const ctx: Ctx = { doc, y: MARGIN_TOP, page: 1 };

  coverPage(ctx, state);

  for (const section of SECTIONS) {
    sectionHeading(ctx, section);
    for (const block of section.blocks) renderBlock(ctx, block, state);
  }

  closingPage(ctx);
  stampFooters(doc);

  doc.save(fileName(state));
}
