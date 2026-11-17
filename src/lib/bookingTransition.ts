// E-4 (86e40ach2): admin lifecycle changes go through admin_transition_booking.

export interface TransitionClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export interface TransitionResult {
  ok: boolean;
  changed?: boolean;
  /** The move is outside the normal flow; the office may correct it with a reason. */
  needsCorrection?: boolean;
  error?: string;
}

export async function transitionBooking(
  client: TransitionClient,
  bookingId: string,
  to: string,
  opts: { reason?: string; force?: boolean } = {},
): Promise<TransitionResult> {
  const { data, error } = await client.rpc("admin_transition_booking", {
    p_booking_id: bookingId,
    p_to: to,
    p_reason: opts.reason ?? null,
    p_force: opts.force ?? false,
  });
  if (error) {
    return {
      ok: false,
      error: error.message,
      needsCorrection: !opts.force && /Correct status/.test(error.message),
    };
  }
  return { ok: true, changed: (data as { changed?: boolean } | null)?.changed !== false };
}
