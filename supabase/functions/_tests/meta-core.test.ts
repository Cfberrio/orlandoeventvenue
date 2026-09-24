/**
 * Tests for the pure half of the Meta Conversions API layer.
 *
 * Production location: supabase/functions/_shared/meta-core.ts — the Deno-free
 * parts live there precisely so they can be exercised here under vitest.
 *
 * Two things are load-bearing and are pinned by name below:
 *
 *  1. The dedup ids must match src/lib/tracking/core.ts byte for byte. Pixel
 *     and CAPI collapse into one Meta action only because both halves send the
 *     same string; drift doubles every conversion.
 *
 *  2. pickMatchSignals must never report an ad click that happened AFTER the
 *     event being attributed. That is the one place this pipeline could
 *     silently inflate what Meta believes its ads caused.
 *
 * Run with: bun run test:edge
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  bookingCreatedEventId,
  checkoutEventId,
  conversionValue,
  hashedUserData,
  leadEventId,
  normalizeEmail,
  normalizePhone,
  normalizeZip,
  pickMatchSignals,
  purchaseCustomData,
  purchaseEventId,
  sha256Hex,
  splitFullName,
  type VisitorSignals,
} from "../_shared/meta-core.ts";
import { deliverMetaEvent, retryFailedMetaEvents } from "../_shared/meta-capi.ts";

vi.mock("https://esm.sh/@supabase/supabase-js@2.39.3", () => ({
  createClient: vi.fn(),
}));

type MockDeliveryRow = {
  id: string;
  meta_event_id: string;
  booking_id: string | null;
  status: string;
  attempts: number;
  updated_at: string;
  request: unknown;
  response?: unknown;
  error?: string | null;
};

type MockResult = { data: unknown; error: unknown };

class MockMetaDatabase {
  claims = 0;
  retryLimit: number | null = null;
  retryOrder: { column: string; ascending: boolean } | null = null;
  retryFilter: string | null = null;

  constructor(
    readonly rows: MockDeliveryRow[],
    readonly bookingResult:
      | MockResult
      | ((bookingId: string) => MockResult) = { data: null, error: null },
    readonly consentResult: MockResult = { data: null, error: null },
  ) {}

  from(table: string) {
    return new MockMetaQuery(this, table);
  }
}

class MockMetaQuery implements PromiseLike<MockResult> {
  private operation: "insert" | "select" | "update" = "select";
  private columns = "";
  private values: Record<string, unknown> = {};
  private limitValue: number | null = null;
  private equals = new Map<string, unknown>();
  private lessThan = new Map<string, unknown>();
  private inValues = new Map<string, unknown[]>();
  private nonNullColumns = new Set<string>();
  private orFilter: string | null = null;
  private orderValue: { column: string; ascending: boolean } | null = null;

  constructor(
    private readonly database: MockMetaDatabase,
    private readonly table: string,
  ) {}

  select(columns: string) {
    this.columns = columns;
    return this;
  }

  insert(values: Record<string, unknown>) {
    this.operation = "insert";
    this.values = values;
    return this;
  }

  update(values: Record<string, unknown>) {
    this.operation = "update";
    this.values = values;
    return this;
  }

  eq(column: string, value: unknown) {
    this.equals.set(column, value);
    return this;
  }

  lt(column: string, value: unknown) {
    this.lessThan.set(column, value);
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    if (operator === "is" && value === null) this.nonNullColumns.add(column);
    return this;
  }

  or(filter: string) {
    this.orFilter = filter;
    return this;
  }

  order(column: string, options: { ascending: boolean }) {
    this.orderValue = { column, ascending: options.ascending };
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  in(column: string, values: unknown[]) {
    this.inValues.set(column, values);
    return this;
  }

  maybeSingle(): Promise<MockResult> {
    return this.execute(true);
  }

  then<TResult1 = MockResult, TResult2 = never>(
    onfulfilled?: ((value: MockResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute(false).then(onfulfilled, onrejected);
  }

  private matchingRows() {
    return this.database.rows.filter((row) => {
      for (const [column, value] of this.equals) {
        if (row[column as keyof MockDeliveryRow] !== value) return false;
      }
      const ids = this.inValues.get("id");
      if (ids && !ids.includes(row.id)) return false;
      const statuses = this.inValues.get("status");
      if (statuses && !statuses.includes(row.status)) return false;
      for (const column of this.nonNullColumns) {
        if (row[column as keyof MockDeliveryRow] === null) return false;
      }
      for (const [column, value] of this.lessThan) {
        const rowValue = row[column as keyof MockDeliveryRow];
        if (typeof value === "string" && typeof rowValue === "string" && rowValue >= value) {
          return false;
        }
        if (typeof value === "number" && typeof rowValue === "number" && rowValue >= value) {
          return false;
        }
      }
      if (this.orFilter) {
        const pendingBefore = this.orFilter.match(/updated_at\.lt\.([^)]*)/u)?.[1];
        const retryable =
          row.status === "error" ||
          row.status === "skipped_no_secrets" ||
          (row.status === "pending" && pendingBefore !== undefined && row.updated_at < pendingBefore);
        if (!retryable) return false;
      }
      return true;
    });
  }

  private async execute(single: boolean): Promise<MockResult> {
    if (this.operation === "insert") {
      if (
        this.table === "meta_event_delivery" &&
        this.database.rows.some((row) => row.meta_event_id === this.values.meta_event_id)
      ) {
        return { data: null, error: { code: "23505" } };
      }
      if (this.table === "meta_event_delivery") {
        this.database.rows.push({
          id: `inserted-${this.database.rows.length + 1}`,
          meta_event_id: String(this.values.meta_event_id),
          booking_id: this.values.booking_id as string | null,
          status: String(this.values.status),
          attempts: Number(this.values.attempts),
          updated_at: new Date().toISOString(),
          request: this.values.request,
          response: this.values.response,
          error: this.values.error as string | null | undefined,
        });
      }
      return { data: null, error: null };
    }

    if (this.operation === "select") {
      if (this.table === "bookings") {
        return typeof this.database.bookingResult === "function"
          ? this.database.bookingResult(String(this.equals.get("id")))
          : this.database.bookingResult;
      }
      if (this.table === "tracking_visitor") return this.database.consentResult;
      let rows = this.matchingRows();
      if (this.orderValue) {
        const { column, ascending } = this.orderValue;
        rows = [...rows].sort((a, b) => {
          const left = String(a[column as keyof MockDeliveryRow] ?? "");
          const right = String(b[column as keyof MockDeliveryRow] ?? "");
          return (left < right ? -1 : left > right ? 1 : 0) * (ascending ? 1 : -1);
        });
      }
      rows = rows.slice(0, this.limitValue ?? rows.length);
      if (this.columns === "id") {
        return { data: rows.map(({ id }) => ({ id })), error: null };
      }
      this.database.retryLimit = this.limitValue;
      this.database.retryOrder = this.orderValue;
      this.database.retryFilter = this.orFilter;
      return {
        data: rows,
        error: null,
      };
    }

    const matches = this.matchingRows();
    for (const row of matches) Object.assign(row, this.values);
    if (this.values.status === "pending" && typeof this.values.attempts === "number") {
      this.database.claims += matches.length;
    }
    return {
      data: single && matches.length === 1 ? { id: matches[0].id } : null,
      error: null,
    };
  }
}

const storedRequest = {
  data: [{ event_name: "Purchase", event_id: "evt_purchase_booking-1" }],
};

function retryRow(id: string, bookingId: string | null = null): MockDeliveryRow {
  return {
    id,
    meta_event_id: `evt_${id}`,
    booking_id: bookingId,
    status: "error",
    attempts: 1,
    updated_at: new Date().toISOString(),
    request: structuredClone(storedRequest),
  };
}

const retryEnv = { pixelId: "pixel", token: "token", testCode: "" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("dedup event ids", () => {
  // Must stay identical to src/lib/tracking/core.ts.
  it("match the browser-side format exactly", () => {
    const id = "6f1c2b7a-1111-4222-8333-444455556666";
    expect(purchaseEventId(id)).toBe(`evt_purchase_${id}`);
    expect(checkoutEventId(id)).toBe(`evt_checkout_${id}`);
    expect(bookingCreatedEventId(id)).toBe(`evt_booking_${id}`);
    expect(leadEventId("l1")).toBe("evt_lead_l1");
  });
});

describe("normalization", () => {
  it("lowercases and trims email, rejecting anything without an @", () => {
    expect(normalizeEmail("  Guest@Example.COM ")).toBe("guest@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it("prepends the US country code to a bare 10-digit number", () => {
    expect(normalizePhone("(407) 974-5979")).toBe("14079745979");
    expect(normalizePhone("+1 407 974 5979")).toBe("14079745979");
    // Already international — left alone.
    expect(normalizePhone("447700900123")).toBe("447700900123");
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it("accepts only a 5-digit ZIP", () => {
    expect(normalizeZip("32801")).toBe("32801");
    expect(normalizeZip("32801-1234")).toBe("32801");
    expect(normalizeZip("ABCDE")).toBeNull();
  });
});

describe("splitFullName", () => {
  // OEV collects one full_name field; Meta matches better on fn + ln.
  it("splits on the first space", () => {
    expect(splitFullName("Maria Gonzalez")).toEqual({
      firstName: "Maria",
      lastName: "Gonzalez",
    });
    expect(splitFullName("  Ana  Lucia  Perez ")).toEqual({
      firstName: "Ana",
      lastName: "Lucia Perez",
    });
  });

  it("never invents a last name", () => {
    // A fabricated surname hashes to garbage and LOWERS match quality.
    expect(splitFullName("Cher")).toEqual({ firstName: "Cher", lastName: null });
    expect(splitFullName("")).toEqual({ firstName: null, lastName: null });
    expect(splitFullName(null)).toEqual({ firstName: null, lastName: null });
  });
});

describe("conversionValue", () => {
  // The reported value is the deposit actually charged, matching GA4. Using
  // the contract total would double-count against the balance payment.
  it("prefers the amount Stripe actually charged", () => {
    expect(conversionValue(1058.75, 1000)).toBe(1058.75);
  });

  it("falls back to the base deposit for rows predating the fee columns", () => {
    expect(conversionValue(null, 1000)).toBe(1000);
    expect(conversionValue(0, 1000)).toBe(1000);
  });

  it("returns 0 rather than NaN when nothing is known", () => {
    expect(conversionValue(null, null)).toBe(0);
    expect(conversionValue(undefined, undefined)).toBe(0);
  });

  it("rounds to cents", () => {
    expect(conversionValue(10.005, null)).toBe(10.01);
  });
});

describe("Purchase custom_data privacy", () => {
  it("contains only value and currency", () => {
    const customData = purchaseCustomData(568.22);
    expect(customData).toEqual({ value: 568.22, currency: "USD" });
    expect(customData).not.toHaveProperty("event_type");
    expect(customData).not.toHaveProperty("guests");
    expect(customData).not.toHaveProperty("contract_total");
    expect(customData).not.toHaveProperty("content_name");
    expect(customData).not.toHaveProperty("content_category");
  });
});

describe("Stripe webhook idempotency", () => {
  const webhookSource = readFileSync(
    new URL("../stripe-webhook/index.ts", import.meta.url),
    "utf8",
  );

  it("claims the unique Stripe event before booking processing and skips 23505", () => {
    const bookingClaimMarker = webhookSource.indexOf("Claim before any booking mutation");
    const claimAt = webhookSource.indexOf(
      '.from("stripe_event_log")\n        .insert({',
      bookingClaimMarker,
    );
    const policyAt = webhookSource.indexOf('.select("booking_origin, booking_policies(*)")');
    expect(bookingClaimMarker).toBeGreaterThan(-1);
    expect(claimAt).toBeGreaterThan(-1);
    expect(claimAt).toBeLessThan(policyAt);
    expect(webhookSource).toContain('claimError.code === "23505"');
    expect(webhookSource).toContain('skipped: "already_processed"');
  });

  it("claims the deposit transition only while deposit_paid_at is null", () => {
    expect(webhookSource).toContain('.is("deposit_paid_at", null)');
    expect(webhookSource).toContain("if (!data)");
  });

  it("sends Purchase only for an explicit website deposit", () => {
    expect(webhookSource).toContain(
      'explicitPaymentType === "deposit" && bookingWithPolicy?.booking_origin === "website"',
    );
    const checkoutSource = readFileSync(
      new URL("../create-checkout/index.ts", import.meta.url),
      "utf8",
    );
    expect(checkoutSource).toContain('payment_type: "deposit"');
  });

  it("uses the Stripe consent snapshot to fail closed before Purchase", () => {
    const checkoutSource = readFileSync(
      new URL("../create-checkout/index.ts", import.meta.url),
      "utf8",
    );
    expect(checkoutSource).toContain('{ ad_consent: String(adConsentSnapshot) }');
    expect(webhookSource).toContain('session.metadata?.ad_consent === "false"');
    expect(webhookSource).toContain("if (sessionAdConsent === false)");
  });
});

describe("Meta CAPI retry", () => {
  const capiSource = readFileSync(
    new URL("../_shared/meta-capi.ts", import.meta.url),
    "utf8",
  );

  it("caps retries and conditionally claims error or stale pending rows", () => {
    expect(capiSource).toContain("const MAX_ATTEMPTS = 5");
    expect(capiSource).toContain("const STALE_PENDING_MS = 10 * 60 * 1000");
    expect(capiSource).toContain("const RETRY_CANDIDATE_LIMIT = 25");
    expect(capiSource).toContain("const RETRY_CLAIM_LIMIT = 5");
    expect(capiSource).toContain('.eq("status", row.status)');
    expect(capiSource).toContain('.eq("attempts", row.attempts)');
    expect(capiSource).toContain('row.status === "pending"');
    expect(capiSource).toContain("isStoredRequest(row.request)");
  });

  it("retries skipped-no-secrets rows only after credentials exist", () => {
    expect(capiSource).toContain('existing.status === "skipped_no_secrets"');
    expect(capiSource).toContain("secretsAvailable &&");
    expect(capiSource).toContain(
      "status.eq.error,status.eq.skipped_no_secrets,and(status.eq.pending",
    );
    expect(capiSource).toContain(
      'if (!pixelId || !token) return { claimed: 0, sent: 0, failed: 0 }',
    );
    expect(capiSource).toContain(
      "opts.adConsent === false || consentLookupFailed || !secretsAvailable ? 0 : 1",
    );
  });
});

describe("Meta CAPI retry behavior", () => {
  it("records a send Meta accepted after an in-flight opt-out, without restoring the payload", async () => {
    const eventId = "evt_direct_in_flight_optout";
    const database = new MockMetaDatabase([]);
    const response = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(response.promise);

    const inFlight = deliverMetaEvent(
      {
        eventName: "Purchase",
        eventId,
        sourceUrl: "https://orlandoeventvenue.org/book",
        userData: {},
        bookingId: "booking-1",
      },
      {
        database: database as never,
        fetchImpl: fetchMock,
        env: retryEnv,
      },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const optOut = await deliverMetaEvent(
      {
        eventName: "Purchase",
        eventId,
        sourceUrl: "https://orlandoeventvenue.org/book",
        userData: {},
        bookingId: "booking-1",
        adConsent: false,
      },
      { database: database as never, env: retryEnv },
    );
    response.resolve(new Response(JSON.stringify({ events_received: 1 }), { status: 200 }));

    expect(optOut).toBe("duplicate");
    expect(await inFlight).toBe("sent");
    expect(database.rows[0]).toMatchObject({
      status: "sent_after_consent_change",
      attempts: 1,
      request: null,
    });
  });

  it("does not restore an opt-out request when an in-flight retry fails", async () => {
    const row = retryRow("retry-in-flight-optout");
    const database = new MockMetaDatabase([row]);
    const response = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(response.promise);

    const inFlight = retryFailedMetaEvents({
      database: database as never,
      fetchImpl: fetchMock,
      env: retryEnv,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const optOut = await deliverMetaEvent(
      {
        eventName: "Purchase",
        eventId: row.meta_event_id,
        sourceUrl: "https://orlandoeventvenue.org/book",
        userData: {},
        bookingId: "booking-1",
        adConsent: false,
      },
      { database: database as never, env: retryEnv },
    );
    response.resolve(new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }));

    expect(optOut).toBe("duplicate");
    expect(await inFlight).toEqual({ claimed: 1, sent: 0, failed: 0 });
    expect(row).toMatchObject({
      status: "skipped_consent",
      attempts: 2,
      request: null,
    });
  });

  it("does not claim or post when the consent lookup fails", async () => {
    const row = retryRow("delivery-1", "booking-1");
    const database = new MockMetaDatabase(
      [row],
      {
        data: {
          id: "booking-1",
          email: "guest@example.com",
          ad_consent: null,
        },
        error: null,
      },
      { data: null, error: new Error("consent lookup unavailable") },
    );
    const fetchMock = vi.fn<typeof fetch>();

    const result = await retryFailedMetaEvents({
      database: database as never,
      fetchImpl: fetchMock,
      env: retryEnv,
    });

    expect(result).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row.attempts).toBe(1);
    expect(row.status).toBe("error");
    expect(row.request).toEqual(storedRequest);
  });

  it("clears the stored request after a successful send", async () => {
    const row = retryRow("delivery-1");
    const database = new MockMetaDatabase([row]);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 }),
    );

    const result = await retryFailedMetaEvents({
      database: database as never,
      fetchImpl: fetchMock,
      env: retryEnv,
    });

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(row.status).toBe("sent");
    expect(row.attempts).toBe(2);
    expect(row.request).toBeNull();
  });

  it("stops claiming at both the claim cap and elapsed-time budget", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 }),
    );
    const cappedDatabase = new MockMetaDatabase(
      Array.from({ length: 8 }, (_, index) => retryRow(`capped-${index}`)),
    );

    const capped = await retryFailedMetaEvents({
      database: cappedDatabase as never,
      fetchImpl: fetchMock,
      env: retryEnv,
    });

    expect(cappedDatabase.retryLimit).toBe(25);
    expect(cappedDatabase.retryOrder).toEqual({ column: "updated_at", ascending: true });
    expect(capped.claimed).toBe(5);

    const timedDatabase = new MockMetaDatabase([
      retryRow("timed-1"),
      retryRow("timed-2"),
      retryRow("timed-3"),
    ]);
    const timed = await retryFailedMetaEvents({
      database: timedDatabase as never,
      fetchImpl: fetchMock,
      env: retryEnv,
      timeBudgetMs: 10,
      now: () => timedDatabase.claims === 0 ? 0 : 10,
    });

    expect(timed.claimed).toBe(1);
    expect(timedDatabase.claims).toBe(1);
    expect(timedDatabase.rows[1].attempts).toBe(1);
  });

  it("terminalizes missing bookings and continues to a later valid row", async () => {
    const missingRows = Array.from(
      { length: 5 },
      (_, index) => retryRow(`missing-${index}`, `missing-booking-${index}`),
    );
    const validRow = retryRow("valid", "valid-booking");
    const database = new MockMetaDatabase(
      [...missingRows, validRow],
      (bookingId) => bookingId === "valid-booking"
        ? {
          data: {
            id: bookingId,
            email: "guest@example.com",
            ad_consent: null,
          },
          error: null,
        }
        : { data: null, error: null },
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 }),
    );

    const result = await retryFailedMetaEvents({
      database: database as never,
      fetchImpl: fetchMock,
      env: retryEnv,
    });

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(database.retryLimit).toBe(25);
    expect(fetchMock).toHaveBeenCalledOnce();
    for (const row of missingRows) {
      expect(row).toMatchObject({
        status: "error",
        error: "booking_missing",
        attempts: 5,
        request: null,
      });
    }
    expect(validRow).toMatchObject({ status: "sent", attempts: 2, request: null });
  });

  it("cancels a crashed pending row when a duplicate opts out", async () => {
    const eventId = "evt_duplicate_optout";
    const pendingRow = retryRow("pending-optout", "booking-1");
    pendingRow.meta_event_id = eventId;
    pendingRow.status = "pending";
    const database = new MockMetaDatabase([pendingRow]);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1 }), { status: 200 }),
    );

    const delivery = await deliverMetaEvent(
      {
        eventName: "Purchase",
        eventId,
        sourceUrl: "https://orlandoeventvenue.org/book",
        userData: {},
        bookingId: "booking-1",
        adConsent: false,
      },
      {
        database: database as never,
        fetchImpl: fetchMock,
        env: retryEnv,
      },
    );
    const retry = await retryFailedMetaEvents({
      database: database as never,
      fetchImpl: fetchMock,
      env: retryEnv,
    });

    expect(delivery).toBe("duplicate");
    expect(pendingRow.status).toBe("skipped_consent");
    expect(pendingRow.request).toBeNull();
    expect(database.retryFilter).not.toContain("skipped_consent");
    expect(retry).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("consent rejection propagation", () => {
  const trackEventSource = readFileSync(
    new URL("../track-event/index.ts", import.meta.url),
    "utf8",
  );

  it("marks a booking already linked to the rejecting visitor as opted out", () => {
    expect(trackEventSource).toContain(
      '.select("id,booking_id,first_utm,last_utm,first_landing_page,first_referrer,ad_consent")',
    );
    expect(trackEventSource).toContain("consent?.advertising === false && linkedBookingId");
    expect(trackEventSource).toContain('.update({ ad_consent: false })');
    expect(trackEventSource).toContain('.eq("id", linkedBookingId)');
  });
});

describe("hashedUserData", () => {
  it("SHA-256s the identifiers Meta requires hashed", async () => {
    const out = await hashedUserData({ email: "Guest@Example.com" });
    expect(out.em).toEqual([await sha256Hex("guest@example.com")]);
    // Never the raw value.
    expect(JSON.stringify(out)).not.toContain("Guest@Example.com");
    expect(JSON.stringify(out)).not.toContain("guest@example.com");
  });

  it("passes browser identifiers through unhashed, as Meta requires", async () => {
    const out = await hashedUserData({
      fbp: "fb.1.1700000000000.123",
      fbc: "fb.1.1700000000000.IwAR_abc",
      clientIp: "203.0.113.7",
      userAgent: "Mozilla/5.0",
    });
    expect(out.fbp).toBe("fb.1.1700000000000.123");
    expect(out.fbc).toBe("fb.1.1700000000000.IwAR_abc");
    expect(out.client_ip_address).toBe("203.0.113.7");
    expect(out.client_user_agent).toBe("Mozilla/5.0");
  });

  it("omits fields it cannot normalize instead of sending junk", async () => {
    const out = await hashedUserData({ email: "nope", phone: "12", zip: "ABCDE" });
    expect(out.em).toBeUndefined();
    expect(out.ph).toBeUndefined();
    expect(out.zp).toBeUndefined();
  });
});

describe("pickMatchSignals", () => {
  const AT = (iso: string) => new Date(iso);

  it("takes each signal from the newest row that actually has it", () => {
    // The Stripe-return row is newest but blank of the click id. Reading the
    // newest row wholesale would throw away the one datum proving the ad
    // caused the booking.
    const rows: VisitorSignals[] = [
      { first_seen_at: "2026-03-10T12:00:00Z", fbp: "fbp-new", last_ip: "203.0.113.9" },
      {
        first_touch_at: "2026-03-01T09:00:00Z",
        fbc: "fb.1.1.click",
        fbp: "fbp-old",
        last_user_agent: "InstagramUA",
      },
    ];
    expect(pickMatchSignals(rows, AT("2026-03-10T12:05:00Z"))).toEqual({
      fbc: "fb.1.1.click",
      fbp: "fbp-new",
      clientIp: "203.0.113.9",
      userAgent: "InstagramUA",
    });
  });

  it("refuses a click that happened AFTER the event being attributed", () => {
    // Clicked an ad the day after paying. Reporting that click as the cause of
    // the sale would be a lie to Meta's optimizer.
    const rows: VisitorSignals[] = [
      { first_seen_at: "2026-03-12T10:00:00Z", fbc: "fb.1.1.later-click", fbp: "fbp-1" },
    ];
    const signals = pickMatchSignals(rows, AT("2026-03-11T10:00:00Z"));
    expect(signals.fbc).toBeNull();
    // Identity still flows: fbp claims nothing about an ad.
    expect(signals.fbp).toBe("fbp-1");
  });

  it("drops a click from a row that cannot be shown to predate the event", () => {
    const rows: VisitorSignals[] = [{ fbc: "fb.1.1.undated", fbp: "fbp-1" }];
    expect(pickMatchSignals(rows, AT("2026-03-11T10:00:00Z")).fbc).toBeNull();
  });

  it("returns all nulls for a guest with no visitor rows", () => {
    expect(pickMatchSignals([], AT("2026-03-11T10:00:00Z"))).toEqual({
      fbc: null,
      fbp: null,
      clientIp: null,
      userAgent: null,
    });
  });

  it("ignores empty strings, which are not signals", () => {
    const rows: VisitorSignals[] = [
      { first_seen_at: "2026-03-01T00:00:00Z", fbc: "", fbp: "" },
      { first_seen_at: "2026-02-01T00:00:00Z", fbc: "fb.1.1.real", fbp: "fbp-real" },
    ];
    const signals = pickMatchSignals(rows, AT("2026-03-05T00:00:00Z"));
    expect(signals.fbc).toBe("fb.1.1.real");
    expect(signals.fbp).toBe("fbp-real");
  });
});
