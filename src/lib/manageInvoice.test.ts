import { describe, expect, it } from "vitest";
import { manageInvoice, validateInvoiceAction } from "./manageInvoice";

describe("manage invoice (E-8/E-9)", () => {
  it("requires a reason to void and a method + reference to mark paid", () => {
    expect(validateInvoiceAction({ action: "void", kind: "invoice", id: "1", reason: " " })).toMatch(/why/);
    expect(validateInvoiceAction({ action: "mark_paid", kind: "invoice", id: "1", method: "venmo", reference: "x" })).toMatch(/how/);
    expect(validateInvoiceAction({ action: "mark_paid", kind: "invoice", id: "1", method: "zelle", reference: "" })).toMatch(/reference/);
    expect(validateInvoiceAction({ action: "resend", kind: "invoice", id: "1" })).toBeNull();
  });

  it("surfaces the server's refusal text", async () => {
    const client = {
      functions: {
        invoke: async () => ({
          data: null,
          error: { context: { json: async () => ({ error: "This invoice is already paid." }) } },
        }),
      },
    };
    expect(await manageInvoice(client, { action: "void", kind: "invoice", id: "1", reason: "dup" })).toEqual({
      ok: false,
      error: "This invoice is already paid.",
    });
  });

  it("passes success through", async () => {
    const client = { functions: { invoke: async () => ({ data: { ok: true, email_sent: true }, error: null }) } };
    expect(await manageInvoice(client, { action: "resend", kind: "invoice", id: "1" })).toEqual({ ok: true, email_sent: true });
  });
});
