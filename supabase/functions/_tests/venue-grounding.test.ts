/**
 * Tests for the venue services/pricing grounding handed to the AI draft agents.
 *
 * Why this exists: the agents used to escalate "are tablecloths included?" to a human
 * because their only live data was the calendar. They now receive venue_pricing (the
 * table the checkout charges from) plus the canonical inclusion lists, so the split
 * between "comes with the room" and "paid add-on" has to stay exactly right — quoting an
 * add-on as included is a real money mistake.
 *
 * Production locations:
 * - supabase/functions/_shared/venue-grounding.ts (grouping + live load)
 * - supabase/functions/_shared/venue-facts.ts (inclusion lists, policies)
 * - consumed by composio-gmail-webhook/index.ts (loadBrandGrounding)
 *
 * Run: deno test supabase/functions/_tests/venue-grounding.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildVenueServices, type VenuePricingRow } from "../_shared/venue-grounding.ts";
import { VENUE_FACTS } from "../_shared/venue-facts.ts";
import { SECTIONS } from "../../../src/lib/planningKitContent.ts";

/** Real shape of public.venue_pricing (active rows, Aug 2026). */
const ROWS: VenuePricingRow[] = [
  { category: "rental", item_key: "hourly_rate", label: "Hourly Rate", description: "Base venue rental per hour", price: "139.00", price_unit: "per_hour", extra_fee: "0.00", sort_order: 1 },
  { category: "rental", item_key: "daily_rate", label: "Daily Rate", description: "Full day venue rental (24 hours)", price: "899.00", price_unit: "flat", extra_fee: "0.00", sort_order: 2 },
  { category: "fee", item_key: "cleaning_fee", label: "Cleaning Fee", description: "Standard cleaning fee per event", price: "199.00", price_unit: "flat", extra_fee: "0.00", sort_order: 3 },
  { category: "package", item_key: "package_basic", label: "Basic A/V Package", description: "AV System, Microphones, Speakers, Projectors, Tech Assistant", price: "89.00", price_unit: "per_hour", extra_fee: "0.00", sort_order: 10 },
  { category: "package", item_key: "package_led", label: "LED Wall Package", description: "Basic + Stage LED Wall for presentations and immersive experiences", price: "99.00", price_unit: "per_hour", extra_fee: "0.00", sort_order: 11 },
  { category: "package", item_key: "package_workshop", label: "Workshop/Streaming Package", description: "LED + Streaming Equipment + Streaming Tech for streaming, recording, and VC", price: "149.00", price_unit: "per_hour", extra_fee: "0.00", sort_order: 12 },
  { category: "service", item_key: "setup_breakdown", label: "Setup & Breakdown of Chairs/Tables", description: "Full furniture setup and breakdown for your event", price: "199.00", price_unit: "flat", extra_fee: "0.00", sort_order: 20 },
  { category: "service", item_key: "tablecloth_rental", label: "Tablecloth Rental", description: "Professional tablecloths for your event (max 10)", price: "5.00", price_unit: "per_unit", extra_fee: "25.00", sort_order: 21 },
  { category: "bar_service", item_key: "house_beer_wine", label: "House Beer & Wine", description: "House beer and wine bar package.", price: "18.00", price_unit: "per_guest", extra_fee: "0.00", sort_order: 10 },
  { category: "bar_service", item_key: "signature_bar", label: "Signature Bar", description: "Signature bar service package. Most Popular.", price: "32.13", price_unit: "per_guest", extra_fee: "0.00", sort_order: 30 },
  { category: "fee", item_key: "deposit_percentage", label: "Deposit Percentage", description: "Percentage of subtotal required as deposit", price: "50.00", price_unit: "percentage", extra_fee: "0.00", sort_order: 30 },
  { category: "fee", item_key: "processing_fee", label: "Processing Fee", description: "Applied per transaction at checkout", price: "3.75", price_unit: "percentage", extra_fee: "0.00", sort_order: 31 },
];

const keys = (items: { key: string }[]) => items.map((i) => i.key);

Deno.test("base rental and mandatory fees are separated from add-ons", () => {
  const s = buildVenueServices(ROWS);

  assertEquals(keys(s.base_rental), ["hourly_rate", "daily_rate"]);
  assertEquals(keys(s.mandatory_fees), ["cleaning_fee"]);
  assertEquals(keys(s.payment_terms), ["deposit_percentage", "processing_fee"]);
});

Deno.test("tablecloths are a priced add-on, never an inclusion", () => {
  const s = buildVenueServices(ROWS);

  const tablecloth = s.add_ons.services.find((i) => i.key === "tablecloth_rental");
  assert(tablecloth, "tablecloth_rental must reach the agent");
  assertEquals(tablecloth?.price_usd, 5);
  assertEquals(tablecloth?.extra_fee_usd, 25);
  assertEquals(tablecloth?.billed, "per unit");
  assertEquals(tablecloth?.details, "Professional tablecloths for your event (max 10)");

  // The exact mistake that sent this to human review: treating it as included.
  assert(!s.included_with_rental.some((i) => /tablecloth/i.test(i)));
  assert(s.guest_brings_or_arranges.some((i) => /Tablecloths/i.test(i)));
});

Deno.test("A/V packages and bar service are add-ons with their billing unit", () => {
  const s = buildVenueServices(ROWS);

  assertEquals(keys(s.add_ons.av_packages), ["package_basic", "package_led", "package_workshop"]);
  assert(s.add_ons.av_packages.every((i) => i.billed === "per hour"));

  assertEquals(keys(s.add_ons.bar_service), ["house_beer_wine", "signature_bar"]);
  assert(s.add_ons.bar_service.every((i) => i.billed === "per guest"));

  assertEquals(keys(s.add_ons.services), ["setup_breakdown", "tablecloth_rental"]);
});

Deno.test("prices come through as numbers the model can do math with", () => {
  const s = buildVenueServices(ROWS);
  const hourly = s.base_rental.find((i) => i.key === "hourly_rate");

  assertEquals(hourly?.price_usd, 139);
  assertEquals(typeof hourly?.price_usd, "number");
  // extra_fee is omitted when zero, so it never reads as a hidden charge
  assertEquals(hourly?.extra_fee_usd, undefined);
});

Deno.test("an unknown category still reaches the agent instead of vanishing", () => {
  const s = buildVenueServices([
    ...ROWS,
    { category: "photo_video", item_key: "photo_hour", label: "Photo/Video", description: null, price: "200.00", price_unit: "per_hour", extra_fee: null, sort_order: 40 },
  ]);

  assertEquals(keys(s.add_ons.other ?? []), ["photo_hour"]);
});

Deno.test("capacity is the real 90, not the stale venue_config value", () => {
  const s = buildVenueServices(ROWS);
  // venue_config.venue_capacity says 150; the booking flow enforces 90.
  assertEquals(s.venue.max_guests, 90);
});

Deno.test("grounding tells the model these prices beat anything in its prompt", () => {
  const s = buildVenueServices(ROWS);
  assert(/override any price written in your instructions/i.test(s.how_to_read_this));
  assert(/never say you need to check/i.test(s.how_to_read_this));
});

Deno.test("inclusion lists stay in sync with the Event Planning Kit", () => {
  const provideSection = SECTIONS.find((s) => s.title === "What We Provide and What You Bring");
  assert(provideSection, "planning kit section renamed — update this test and venue-facts.ts");

  const table = provideSection!.blocks.find(
    (b): b is { kind: "table"; headers: string[]; rows: string[][] } =>
      b.kind === "table" && b.headers?.[0] === "Included With Your Rental",
  );
  assert(table, "planning kit inclusion table not found");

  assertEquals([...VENUE_FACTS.included_with_rental], table!.rows.map((r) => r[0]));
  assertEquals([...VENUE_FACTS.guest_brings_or_arranges], table!.rows.map((r) => r[1]));
});
