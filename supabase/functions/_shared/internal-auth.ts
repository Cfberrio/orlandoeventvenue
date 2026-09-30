// Internal-only switches on public (verify_jwt = false) scheduler functions.
//
// The schedulers are called by DB triggers and crons with the anon key, so
// they cannot require auth outright. Switches that cancel jobs or can create a
// payment link (force_reschedule on schedule-balance-payment) are only
// honoured when the caller presents the service-role key, which only other
// edge functions (reschedule-booking) hold.

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

export function isServiceRoleRequest(
  authorizationHeader: string | null | undefined,
  serviceRoleKey: string | null | undefined,
): boolean {
  if (!authorizationHeader || !serviceRoleKey) return false;
  return safeEqual(authorizationHeader, `Bearer ${serviceRoleKey}`);
}
