/**
 * Detects a lead-capture form that has stopped producing leads.
 *
 * A broken public form throws no server error: the failure happens in the
 * visitor's browser, so job and webhook checks stay green. The popup spent 63
 * days at zero leads (Sep-Nov 2026) with nothing alerting. Silence is the only
 * signal available server-side.
 *
 * Threshold from the real history: across 187 popup leads the longest ordinary
 * gap was 5.0 days. The only gap above 7 was a 46.7 day stretch (May-Jul 2026).
 */
export const LEAD_SILENCE_THRESHOLD_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/**
 * Whole days since the last lead when that silence should alert, else null.
 * A table with no leads, or an unparseable timestamp, is not evidence of an
 * outage, so both return null.
 */
export function leadSilenceDays(lastLeadAt: string | null | undefined, now: Date): number | null {
  if (!lastLeadAt) return null;
  const last = new Date(lastLeadAt).getTime();
  if (Number.isNaN(last)) return null;
  const days = Math.floor((now.getTime() - last) / MS_PER_DAY);
  return days >= LEAD_SILENCE_THRESHOLD_DAYS ? days : null;
}
