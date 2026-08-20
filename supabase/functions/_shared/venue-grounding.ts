// Live venue services + pricing grounding for the AI draft agents.
//
// Reads venue_pricing, which is what the checkout actually charges and what the website
// displays (src/hooks/usePricing.ts). Prompts must NOT hardcode prices: the admin edits
// them in /admin/pricing and the agents have to follow within the same request.
//
// Note venue_config also holds price-looking keys. They are stale legacy values (e.g.
// hourly_rate 140 vs venue_pricing 139, venue_capacity 150 vs the real 90) and nothing
// but the agents ever read them — never ground pricing on that table.

import { INCLUSION_RULE, VENUE_FACTS } from "./venue-facts.ts";

export type VenuePricingRow = {
  category: string | null;
  item_key: string;
  label: string;
  description: string | null;
  price: number | string;
  price_unit: string | null;
  extra_fee: number | string | null;
  sort_order: number | null;
};

type PricedItem = {
  key: string;
  label: string;
  price_usd: number;
  billed: string;
  extra_fee_usd?: number;
  details?: string;
};

const UNIT_LABEL: Record<string, string> = {
  per_hour: "per hour",
  per_guest: "per guest",
  per_unit: "per unit",
  flat: "flat, once per event",
  percentage: "percent",
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toItem(row: VenuePricingRow): PricedItem {
  const extra = num(row.extra_fee);
  return {
    key: row.item_key,
    label: row.label,
    price_usd: num(row.price),
    billed: UNIT_LABEL[row.price_unit ?? ""] ?? (row.price_unit ?? "flat"),
    ...(extra > 0 ? { extra_fee_usd: extra } : {}),
    ...(row.description ? { details: row.description } : {}),
  };
}

/**
 * Groups venue_pricing rows into what the model needs to reason about a quote:
 * what the room costs, what is unavoidable, and what is a paid extra.
 *
 * Unknown categories fall into add_ons.other rather than disappearing, so a new
 * category added in the admin still reaches the agent instead of silently going
 * missing from quotes.
 */
export function buildVenueServices(rows: VenuePricingRow[]) {
  const sorted = [...rows].sort((a, b) => num(a.sort_order) - num(b.sort_order));

  const base_rental: PricedItem[] = [];
  const mandatory_fees: PricedItem[] = [];
  const payment_terms: PricedItem[] = [];
  const av_packages: PricedItem[] = [];
  const services: PricedItem[] = [];
  const bar_service: PricedItem[] = [];
  const other: PricedItem[] = [];

  for (const row of sorted) {
    const item = toItem(row);
    switch (row.category) {
      case "rental":
        base_rental.push(item);
        break;
      case "package":
        av_packages.push(item);
        break;
      case "service":
        services.push(item);
        break;
      case "bar_service":
        bar_service.push(item);
        break;
      case "fee":
        // deposit % and card processing % are terms, not a line item on the quote
        (row.price_unit === "percentage" ? payment_terms : mandatory_fees).push(item);
        break;
      default:
        other.push(item);
    }
  }

  return {
    venue: {
      name: VENUE_FACTS.name,
      address: VENUE_FACTS.address,
      address_note: VENUE_FACTS.address_note,
      phone: VENUE_FACTS.phone,
      booking_site: VENUE_FACTS.booking_site,
      approximate_size: VENUE_FACTS.approximate_size,
      max_guests: VENUE_FACTS.max_guests,
      capacity_note: VENUE_FACTS.capacity_note,
      streaming: VENUE_FACTS.streaming,
    },
    included_with_rental: VENUE_FACTS.included_with_rental,
    guest_brings_or_arranges: VENUE_FACTS.guest_brings_or_arranges,
    base_rental,
    mandatory_fees,
    payment_terms,
    add_ons: {
      av_packages,
      services,
      bar_service,
      ...(other.length ? { other } : {}),
    },
    booking_rules: VENUE_FACTS.booking_rules,
    food_rules: VENUE_FACTS.food_rules,
    alcohol_rule: VENUE_FACTS.alcohol_rule,
    how_to_read_this:
      "These are the venue's CURRENT prices, read from the same table the checkout charges " +
      "from, seconds ago. They override any price written in your instructions. " +
      INCLUSION_RULE +
      " You can and should answer 'what is included', 'is X extra', 'how many guests fit' and " +
      "'how much would X cost' directly from this block — never say you need to check.",
  };
}

export async function loadVenueServices(supabase: any) {
  const { data, error } = await supabase
    .from("venue_pricing")
    .select("category, item_key, label, description, price, price_unit, extra_fee, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return buildVenueServices((data ?? []) as VenuePricingRow[]);
}
