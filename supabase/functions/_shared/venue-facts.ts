// Canonical OEV venue facts for the AI draft agents.
//
// These are product facts, not prices: prices come from the venue_pricing table at
// request time (see venue-grounding.ts) because that table is what the checkout
// actually charges. Anything here that changes rarely and is not priced lives here.
//
// SOURCE OF TRUTH: src/lib/planningKitContent.ts (the Event Planning Kit the venue
// hands to every lead). supabase/functions/_tests/venue-grounding.test.ts asserts these
// lists still match it, so the agents can never quote an inclusion the kit contradicts.

export const VENUE_FACTS = {
  name: "Orlando Event Venue",
  address: "3847 E Colonial Dr, Orlando, FL 32803",
  address_note: "Colonial Town Center, look for the GLOBAL sign #3847, door on the left.",
  phone: "407-974-5979",
  booking_site: "orlandoeventvenue.org (checkout at /book)",
  approximate_size: "~1,830 sq ft",
  max_guests: 90,
  capacity_note:
    "Hard limit: 90 guests. Never quote or imply a higher headcount — reframe larger requests warmly.",

  included_with_rental: [
    "Room for up to 90 guests",
    "10 tables and 90 chairs",
    "Prep kitchen for staging and reheating",
    "Two bathrooms",
    "Free plaza parking",
    "Wi-Fi",
    "Standard venue cleaning",
    "Bar service options through OEV",
    "Available LED wall and audiovisual packages",
  ],

  guest_brings_or_arranges: [
    "Food and your caterer",
    "Plates, bowls, cups, and utensils",
    "Serving trays, bowls, tongs, and spoons",
    "Tablecloths and other linens",
    "Ice and coolers",
    "Water, soda, juice, and other nonalcoholic drinks",
    "Decorations and signs",
    "Extra trash bags",
    "Setup, event, and closing helpers",
  ],

  food_rules: [
    "The client may choose their own caterer.",
    "Professional caterers must provide proof of insurance.",
    "There is no cooking at the venue.",
    "The kitchen is for staging, assembling, and reheating food.",
    "Food should arrive ready to serve or only need warming.",
  ],

  alcohol_rule:
    "The venue is owned by a non-profit, so alcohol and bartending must be arranged through " +
    "Orlando Event Venue's licensed vendor (Chara Mobile Bar). A different bartender carries a " +
    "$250 admin vetting fee. Outside FOOD and catering are welcome — alcohol is the only " +
    "restriction. Never answer that alcohol is not allowed.",

  streaming: "Streaming supported; a Zoom link holds up to 100 online guests.",

  booking_rules: [
    "Hourly bookings have a 4-hour minimum.",
    "The daily rate is 24-hour access.",
    "The booked block includes the client's own setup and breakdown time.",
    "A 50% deposit holds the date; no date is held without a reservation.",
    "Guest-count changes are allowed up to 3 days before the event; after that no refund, because inventory is already purchased.",
  ],
} as const;

/**
 * The single most important thing the agents get wrong: treating a paid add-on as if it
 * came with the room. Every list above and every add_on priced in venue_pricing is
 * spelled out to the model with this rule attached.
 */
export const INCLUSION_RULE =
  "included_with_rental comes with every booking at no extra charge. " +
  "guest_brings_or_arranges is NOT provided by the venue — the client supplies it, unless it " +
  "appears in add_ons below, in which case OEV can provide it as a PAID extra that must be " +
  "quoted on top of the rental. Tablecloths are the classic example: not included, but " +
  "rentable per table. Never describe an add_on as included, and never tell a client to bring " +
  "something we sell without mentioning we offer it.";
