import { describe, expect, it } from "vitest";
import { isServiceRoleRequest } from "../_shared/internal-auth.ts";

describe("isServiceRoleRequest", () => {
  const key = "service-role-secret";

  it("accepts the exact service-role bearer", () => {
    expect(isServiceRoleRequest(`Bearer ${key}`, key)).toBe(true);
  });

  it("rejects anon or other bearers, prefixes and suffixes", () => {
    expect(isServiceRoleRequest("Bearer anon-key", key)).toBe(false);
    expect(isServiceRoleRequest(`Bearer ${key}x`, key)).toBe(false);
    expect(isServiceRoleRequest(`Bearer ${key.slice(0, -1)}`, key)).toBe(false);
    expect(isServiceRoleRequest(key, key)).toBe(false);
  });

  it("rejects when either side is missing (never matches an unset env var)", () => {
    expect(isServiceRoleRequest(null, key)).toBe(false);
    expect(isServiceRoleRequest("Bearer ", "")).toBe(false);
    expect(isServiceRoleRequest("Bearer undefined", undefined)).toBe(false);
  });
});
