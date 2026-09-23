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
    let message = error.message;
    try {
      const payload = await (error as { context?: Response }).context?.json();
      if (payload?.error) message = payload.error;
    } catch {
      // keep the generic message
    }
    throw new Error(`Could not upload the ${side} of your license: ${message}`);
  }
  if (!data?.path) throw new Error(`Could not upload the ${side} of your license. Please try again.`);
  return data.path as string;
}
