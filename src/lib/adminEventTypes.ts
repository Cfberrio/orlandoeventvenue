// Event types offered by the admin Internal/External booking wizards.
// Values are the same slugs the public form and the DB use (C-3); the DB
// trigger trg_normalize_booking_event_type also slugifies anything else.
// Kept apart from eventTypes.ts, which must stay byte-identical to the
// edge-function copy.
export const ADMIN_EVENT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "birthday-party", label: "Birthday Party" },
  { value: "baby-shower", label: "Baby Shower" },
  { value: "corporate-event", label: "Corporate Event" },
  { value: "wedding-reception", label: "Wedding Reception" },
  { value: "anniversary", label: "Anniversary" },
  { value: "graduation-party", label: "Graduation" },
  { value: "holiday-party", label: "Holiday Party" },
  { value: "other", label: "Other" },
];
