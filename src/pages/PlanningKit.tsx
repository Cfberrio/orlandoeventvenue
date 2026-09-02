import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Download, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePlanningKitState } from "@/hooks/usePlanningKitState";
import { downloadPlanningKitPdf } from "@/lib/planningKitPdf";
import {
  KIT_ADDRESS,
  KIT_OFFER_CODE,
  KIT_PHONE,
  SECTIONS,
  VENUE_SNAPSHOT,
  type Block,
  type Section,
} from "@/lib/planningKitContent";
import { trackPlanningKitViewed } from "@/lib/tracking/funnel";

type KitApi = ReturnType<typeof usePlanningKitState>;

/* ---------- Building blocks ---------- */

function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <>
      {/* Phones: a row becomes a labelled block, so no column is cut off mid-word. */}
      <div className="sm:hidden my-4 space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="rounded-lg border border-border overflow-hidden">
            {row.map((cell, j) => (
              <div key={j} className="px-4 py-2.5 border-t border-border first:border-t-0 first:bg-muted/40">
                <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {headers[j]}
                </p>
                <p className="text-[15px] leading-relaxed mt-0.5">{cell}</p>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="hidden sm:block overflow-x-auto my-4 rounded-lg border border-border">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="bg-muted/60">
              {headers.map((h) => (
                <th key={h} className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-border align-top">
                {row.map((cell, j) => (
                  <td key={j} className="px-4 py-2.5 leading-relaxed">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CheckList({ id, items, twoColumn, kit }: { id: string; items: string[]; twoColumn?: boolean; kit: KitApi }) {
  return (
    <ul className={twoColumn ? "grid sm:grid-cols-2 gap-x-8 gap-y-1 my-4" : "space-y-1 my-4"}>
      {items.map((item, index) => {
        const key = `${id}:${index}`;
        const checked = !!kit.state.checks[key];
        return (
          <li key={item}>
            <label
              htmlFor={key}
              className="flex items-start gap-2.5 py-1 cursor-pointer group text-[15px] leading-relaxed"
            >
              <Checkbox
                id={key}
                checked={checked}
                onCheckedChange={() => kit.toggleCheck(id, index)}
                className="mt-1 shrink-0"
              />
              <span className={checked ? "text-muted-foreground line-through decoration-muted-foreground/50" : ""}>
                {item}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function FillField({
  id,
  row,
  column,
  label,
  placeholder,
  kit,
}: {
  id: string;
  row: number;
  column: number;
  label: string;
  placeholder?: string;
  kit: KitApi;
}) {
  const key = `${id}:${row}:${column}`;
  return (
    <Input
      id={key}
      aria-label={label}
      placeholder={placeholder}
      value={kit.state.fields[key] ?? ""}
      onChange={(e) => kit.setField(id, row, column, e.target.value)}
      className="h-9 text-[15px]"
    />
  );
}

function Worksheet({
  id,
  headers,
  labels,
  kit,
}: {
  id: string;
  headers: string[];
  labels: string[];
  kit: KitApi;
}) {
  const inputHeaders = headers.slice(1);

  return (
    <>
      {/* Phones: each field stacks under its label instead of scrolling sideways. */}
      <div className="sm:hidden my-4 space-y-3">
        {labels.map((label, row) => (
          <div key={label} className="rounded-lg border border-border px-4 py-3">
            <p className="font-medium text-[15px]">{label}</p>
            <div className="mt-2 space-y-2">
              {inputHeaders.map((h, column) => (
                <div key={h} className="flex items-center gap-3">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground w-16 shrink-0">
                    {h}
                  </span>
                  <FillField id={id} row={row} column={column} label={`${label} ${h}`} kit={kit} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block my-4 rounded-lg border border-border overflow-hidden">
        <div
          className="grid gap-3 px-4 py-2.5 bg-muted/60 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          style={{ gridTemplateColumns: `minmax(0,1.4fr) repeat(${inputHeaders.length}, minmax(0,1fr))` }}
        >
          {headers.map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
        {labels.map((label, row) => (
          <div
            key={label}
            className="grid gap-3 items-center px-4 py-2 border-t border-border"
            style={{ gridTemplateColumns: `minmax(0,1.4fr) repeat(${inputHeaders.length}, minmax(0,1fr))` }}
          >
            <span className="text-[15px]">{label}</span>
            {inputHeaders.map((h, column) => (
              <FillField key={h} id={id} row={row} column={column} label={`${label} ${h}`} kit={kit} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function Schedule({ id, activities, kit }: { id: string; activities: string[]; kit: KitApi }) {
  return (
    <>
      <div className="sm:hidden my-4 space-y-3">
        {activities.map((activity, row) => (
          <div key={activity} className="rounded-lg border border-border px-4 py-3">
            <p className="font-medium text-[15px]">{activity}</p>
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground w-16 shrink-0">
                  Time
                </span>
                <FillField id={id} row={row} column={0} label={`${activity} time`} kit={kit} />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground w-16 shrink-0">
                  Person
                </span>
                <FillField id={id} row={row} column={1} label={`${activity} assigned person`} kit={kit} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block my-4 rounded-lg border border-border overflow-hidden">
        <div className="grid gap-3 px-4 py-2.5 bg-muted/60 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground grid-cols-[minmax(0,0.7fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
          <span>Time</span>
          <span>Activity</span>
          <span>Assigned person</span>
        </div>
        {activities.map((activity, row) => (
          <div
            key={activity}
            className="grid gap-3 items-center px-4 py-2 border-t border-border grid-cols-[minmax(0,0.7fr)_minmax(0,1.2fr)_minmax(0,1fr)]"
          >
            <FillField id={id} row={row} column={0} label={`${activity} time`} kit={kit} />
            <span className="text-[15px]">{activity}</span>
            <FillField id={id} row={row} column={1} label={`${activity} assigned person`} kit={kit} />
          </div>
        ))}
      </div>
    </>
  );
}

function OfferCallout() {
  return (
    <p className="my-5 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 text-[15px] font-medium">
      Use <span className="font-bold tracking-wide">{KIT_OFFER_CODE}</span> for{" "}
      <strong>$50 OFF your venue rental</strong>.
    </p>
  );
}

function BlockView({ block, kit }: { block: Block; kit: KitApi }) {
  switch (block.kind) {
    case "paragraph":
      return <p className="text-[15px] leading-relaxed my-3">{block.text}</p>;
    case "note":
      return <p className="text-[15px] leading-relaxed my-3 text-muted-foreground">{block.text}</p>;
    case "subheading":
      return <h3 className="text-lg font-bold mt-6 mb-2">{block.text}</h3>;
    case "bullets":
      return (
        <ul className="list-disc pl-5 space-y-1.5 text-[15px] leading-relaxed my-3">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "ordered":
      return (
        <ol className="list-decimal pl-5 space-y-1.5 text-[15px] leading-relaxed my-3 font-medium">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      );
    case "checklist":
      return <CheckList id={block.id} items={block.items} twoColumn={block.twoColumn} kit={kit} />;
    case "table":
      return <DataTable headers={block.headers} rows={block.rows} />;
    case "worksheet":
      return <Worksheet id={block.id} headers={block.headers} labels={block.labels} kit={kit} />;
    case "schedule":
      return <Schedule id={block.id} activities={block.activities} kit={kit} />;
    case "offer":
      return <OfferCallout />;
  }
}

function SectionView({ section, kit }: { section: Section; kit: KitApi }) {
  return (
    <section>
      <h2
        id={section.number ? `section-${section.number}` : undefined}
        className="flex items-baseline gap-3 text-2xl font-bold mt-14 mb-4 scroll-mt-24"
      >
        {section.number && (
          <span aria-hidden className="text-primary text-lg font-extrabold tabular-nums">
            {section.number}.
          </span>
        )}
        {section.title}
      </h2>
      {section.blocks.map((block, i) => (
        <BlockView key={i} block={block} kit={kit} />
      ))}
    </section>
  );
}

/* ---------- Page ---------- */

const PlanningKit = () => {
  const kit = usePlanningKitState();
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    document.title = "Your Event Planning Kit | Orlando Event Venue";
    // The kit is the payoff of the PLAN50 lead magnet, so reaching this page
    // is the milestone that says the magnet worked.
    trackPlanningKitViewed();
  }, []);

  const handleDownload = async () => {
    setGenerating(true);
    try {
      await downloadPlanningKitPdf(kit.state);
    } catch (error) {
      console.error("Planning kit PDF error:", error);
      toast({
        title: "We could not build your PDF.",
        description: `Try again, or call or text ${KIT_PHONE} and we will send you a copy.`,
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const downloadButton = (size: "default" | "lg") => (
    <Button onClick={handleDownload} disabled={generating} size={size}>
      {generating ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Building your PDF...
        </>
      ) : (
        <>
          <Download className="h-4 w-4 mr-2" />
          Download my kit as PDF
        </>
      )}
    </Button>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <div className="print:hidden">
        <Navigation />
      </div>

      <main className="flex-1">
        <header className="border-b border-border bg-muted/30">
          <div className="container mx-auto px-4 py-14 max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">Orlando Event Venue</p>
            <h1 className="text-4xl font-extrabold mt-2 leading-tight">Your Event Planning Kit</h1>
            <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
              Everything you need to plan a smooth event in our space, including the small things people often forget.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed">
              Orlando Event Venue is a local nonprofit venue built for events of up to 90 guests. You get a clean,
              private room that you can arrange for your event. You bring the plan, food, decorations, and event
              details. We provide the space and clear information so nothing catches you off guard.
            </p>
            <p className="mt-3 text-[15px] leading-relaxed">
              Tick the boxes and fill in the worksheets as you plan. Everything you type is saved on this device, so you
              can close the page and come back to it. When you are ready, download the whole kit as a PDF to print or
              share with your helpers.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3 print:hidden">
              <div className="space-y-1.5">
                <label htmlFor="kit-event-name" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Event
                </label>
                <Input
                  id="kit-event-name"
                  placeholder="Maria's 50th birthday"
                  value={kit.state.meta.eventName}
                  onChange={(e) => kit.setMeta("eventName", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="kit-event-date" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Date
                </label>
                <Input
                  id="kit-event-date"
                  type="date"
                  value={kit.state.meta.eventDate}
                  onChange={(e) => kit.setMeta("eventDate", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="kit-guests" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Guests
                </label>
                <Input
                  id="kit-guests"
                  inputMode="numeric"
                  placeholder="Up to 90"
                  value={kit.state.meta.guestCount}
                  onChange={(e) => kit.setMeta("guestCount", e.target.value)}
                />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3 print:hidden">
              {downloadButton("lg")}
              {kit.progress.hasAnything && (
                <span className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-green-600" />
                  {kit.progress.done} of {kit.progress.total} items ticked
                  {kit.progress.filled > 0 && `, ${kit.progress.filled} fields filled`}
                </span>
              )}
            </div>
          </div>
        </header>

        <div className="container mx-auto px-4 pb-20 max-w-3xl">
          <nav aria-label="Kit sections" className="mt-10 print:hidden">
            <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">In this kit</p>
            <ol className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 text-[15px]">
              {SECTIONS.map((s) => (
                <li key={s.number}>
                  <a href={`#section-${s.number}`} className="hover:text-primary transition-colors">
                    <span className="text-primary font-semibold tabular-nums">{s.number}.</span> {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <SectionView section={VENUE_SNAPSHOT} kit={kit} />

          {SECTIONS.map((section) => (
            <SectionView key={section.title} section={section} kit={kit} />
          ))}

          <section className="mt-16 rounded-xl border border-primary/40 bg-primary/5 px-6 py-8 sm:px-10 text-center print:hidden">
            <h2 className="text-2xl font-extrabold">Ready to Hold Your Date?</h2>
            <p className="mt-3 text-[15px] leading-relaxed max-w-xl mx-auto">
              You have the plan. The next step is holding the space. Your date is held after the first 50 percent is
              received. The Orlando Event Venue team will then review the timing, guest count, and setup before sending
              a separate confirmation.
            </p>
            <p className="mt-2 text-[15px] leading-relaxed">
              For direct bookings, the remaining balance is due 15 days before the event.
            </p>
            <p className="mt-4 text-[15px] font-medium">
              Use <span className="font-bold tracking-wide">{KIT_OFFER_CODE}</span> for{" "}
              <strong>$50 OFF your venue rental</strong>.
            </p>
            <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild size="lg">
                <a href="/book">Begin Your Booking</a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="/schedule-tour">Book a Tour</a>
              </Button>
            </div>
            <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center items-center">
              {downloadButton("default")}
              {kit.progress.hasAnything && (
                <button
                  type="button"
                  onClick={() => {
                    kit.reset();
                    toast({ title: "Your kit was cleared on this device." });
                  }}
                  className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Clear what I filled in
                </button>
              )}
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Questions? Call or text {KIT_PHONE}.
              <br />
              Luis and the Orlando Event Venue Team · {KIT_ADDRESS}
            </p>
          </section>
        </div>
      </main>

      <div className="print:hidden">
        <Footer />
      </div>
    </div>
  );
};

export default PlanningKit;
