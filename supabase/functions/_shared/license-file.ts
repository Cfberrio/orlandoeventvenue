// Driver's license upload validation, shared by upload-driver-license and its tests.
// The declared Content-Type is attacker-controlled, so the real type comes from the
// file's leading bytes.

export const LICENSE_MAX_BYTES = 10 * 1024 * 1024;

export type LicenseKind = { contentType: string; ext: string };

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "heif"]);

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** Detects the file type from its magic bytes. Returns null for anything we don't accept. */
export function sniffLicenseFile(bytes: Uint8Array): LicenseKind | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { contentType: "image/jpeg", ext: "jpg" };
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG") return { contentType: "image/png", ext: "png" };
  if (ascii(bytes, 0, 5) === "%PDF-") return { contentType: "application/pdf", ext: "pdf" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return { contentType: "image/webp", ext: "webp" };
  if (ascii(bytes, 4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(bytes, 8, 12))) {
    const brand = ascii(bytes, 8, 12);
    return brand === "mif1" || brand === "msf1" || brand === "heif"
      ? { contentType: "image/heif", ext: "heif" }
      : { contentType: "image/heic", ext: "heic" };
  }
  return null;
}

export function isLicenseSide(v: unknown): v is "front" | "back" {
  return v === "front" || v === "back";
}
