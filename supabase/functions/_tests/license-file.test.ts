import { describe, expect, it } from "vitest";
import { isLicenseSide, sniffLicenseFile } from "../_shared/license-file.ts";

const pad = (head: number[] | string, len = 16) => {
  const h = typeof head === "string" ? [...head].map((c) => c.charCodeAt(0)) : head;
  const out = new Uint8Array(len);
  out.set(h);
  return out;
};

describe("sniffLicenseFile", () => {
  it("detects JPEG, PNG, PDF", () => {
    expect(sniffLicenseFile(pad([0xff, 0xd8, 0xff, 0xe0]))?.contentType).toBe("image/jpeg");
    expect(sniffLicenseFile(pad([0x89, 0x50, 0x4e, 0x47]))?.contentType).toBe("image/png");
    expect(sniffLicenseFile(pad("%PDF-1.7"))?.ext).toBe("pdf");
  });

  it("detects WEBP and HEIC/HEIF by container brand", () => {
    expect(sniffLicenseFile(pad("RIFF\0\0\0\0WEBP"))?.contentType).toBe("image/webp");
    expect(sniffLicenseFile(pad("\0\0\0\x18ftypheic"))?.contentType).toBe("image/heic");
    expect(sniffLicenseFile(pad("\0\0\0\x18ftypmif1"))?.contentType).toBe("image/heif");
  });

  it("rejects other content even if it claims to be an image", () => {
    expect(sniffLicenseFile(pad("<html><script>"))).toBeNull();
    expect(sniffLicenseFile(pad("\0\0\0\x18ftypisom"))).toBeNull(); // mp4
    expect(sniffLicenseFile(new Uint8Array([0xff, 0xd8]))).toBeNull(); // too short
  });
});

describe("isLicenseSide", () => {
  it("accepts only front/back", () => {
    expect(isLicenseSide("front")).toBe(true);
    expect(isLicenseSide("back")).toBe(true);
    expect(isLicenseSide("../x")).toBe(false);
    expect(isLicenseSide(null)).toBe(false);
  });
});
