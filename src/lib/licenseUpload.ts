import { supabase } from "@/integrations/supabase/client";

export const LICENSE_BUCKET = "driver-licenses";
export const LICENSE_MAX_BYTES = 10 * 1024 * 1024;
export const LICENSE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

// Some browsers report HEIC photos with an empty type; fall back to the extension.
function resolveContentType(file: File): string | null {
  if (ALLOWED_TYPES.has(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return null;
}

/** Returns an error message, or null when the file is acceptable. */
export function validateLicenseFile(file: File): string | null {
  if (!resolveContentType(file)) return "Please upload a photo (JPG, PNG, HEIC, WEBP) or a PDF.";
  if (file.size > LICENSE_MAX_BYTES) return "File is too large. Maximum size is 10 MB.";
  return null;
}

/**
 * `guestFixable` = the guest can fix it (bad type, too large).
 * Anything else (service down, network) is ours, and the booking flow should
 * not block the guest on it.
 */
export class LicenseUploadError extends Error {
  constructor(message: string, public guestFixable: boolean) {
    super(message);
    this.name = "LicenseUploadError";
  }
}

// 429 is deliberately not here: a rate-limited guest continues without a license
// rather than being stuck for an hour.
const GUEST_FIXABLE_STATUSES = new Set([400, 413, 415]);

/**
 * Uploads one side of the guest's license through the upload-driver-license
 * edge function (the bucket has no guest write access) and returns the object
 * path. The function rate-limits and checks the real file type server-side.
 */
export async function uploadLicenseFile(file: File, side: "front" | "back"): Promise<string> {
  const body = new FormData();
  body.append("side", side);
  body.append("file", file);

  const { data, error } = await supabase.functions.invoke("upload-driver-license", { body });
  if (error) {
    const response = (error as { context?: Response }).context;
    let message = "Upload failed. Please try again.";
    try {
      const payload = await response?.json();
      if (payload?.error) message = payload.error;
    } catch {
      // keep the generic message
    }
    const fixable = !!response && GUEST_FIXABLE_STATUSES.has(response.status);
    throw new LicenseUploadError(message, fixable);
  }
  if (!data?.path) throw new LicenseUploadError("Upload failed. Please try again.", false);
  return data.path as string;
}
