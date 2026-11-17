// E-14 (86e40ach2): search bookings by client name, email or reservation #.
//
// PostgREST `or=` filters are comma/paren separated, so user text is reduced
// to characters that cannot break the filter before it is interpolated.

/** Cleaned search text, or null when nothing searchable is left. */
export function cleanBookingSearch(raw: string | null | undefined): string | null {
  const t = (raw ?? "").replace(/[^\p{L}\p{N}@.\-_' ]/gu, " ").replace(/\s+/g, " ").trim();
  return t.length > 0 ? t.slice(0, 80) : null;
}

/** `or` filter for supabase-js: name, email or reservation number contains the text. */
export function bookingSearchOrFilter(raw: string | null | undefined): string | null {
  const t = cleanBookingSearch(raw);
  if (!t) return null;
  // A pasted "#JZHY9Z" or "oev-jzhy9z" still matches OEV-JZHY9Z.
  const res = t.replace(/^#/, "");
  return [`full_name.ilike.%${t}%`, `email.ilike.%${t}%`, `reservation_number.ilike.%${res}%`].join(",");
}
