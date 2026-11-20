// Per-IP rate limit for public endpoints (ClickUp 86e40ach2, X2-09).
// Same pattern as claim_license_upload_slot: one SECURITY DEFINER RPC,
// service role only, that locks per (bucket, ip), counts the window and
// records the attempt atomically.

// deno-lint-ignore no-explicit-any
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => any };

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (req.headers.get("cf-connecting-ip") || fwd?.split(",")[0] || "unknown").trim().slice(0, 64);
}

export interface RateLimit {
  bucket: string;
  max: number;
  windowSeconds: number;
}

/**
 * True when this request may proceed. A failed lookup is a refusal
 * (fail closed): an endpoint that sends email or SMS must not run unmetered.
 */
export async function claimRateSlot(client: RpcClient, ip: string, limit: RateLimit): Promise<boolean> {
  try {
    const { data, error } = await client.rpc("claim_public_rate_slot", {
      p_bucket: limit.bucket,
      p_ip: ip,
      p_max: limit.max,
      p_window_seconds: limit.windowSeconds,
    });
    if (error) {
      console.error(`[rate-limit] ${limit.bucket} claim failed:`, error);
      return false;
    }
    return data === true;
  } catch (err) {
    console.error(`[rate-limit] ${limit.bucket} claim threw:`, err);
    return false;
  }
}
