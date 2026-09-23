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
 * Uploads one side of the guest's license to the private bucket and returns the
 * object path. The guest can write but never read back (see migration
 * 20260923160000), so the path is random and never reused.
 */
export async function uploadLicenseFile(file: File, side: "front" | "back"): Promise<string> {
  const contentType = resolveContentType(file);
  if (!contentType) throw new Error("Unsupported file type");
  const ext = contentType === "application/pdf" ? "pdf" : contentType.split("/")[1].replace("jpeg", "jpg");
  const path = `uploads/${crypto.randomUUID()}/${side}.${ext}`;

  const { error } = await supabase.storage
    .from(LICENSE_BUCKET)
    .upload(path, file, { contentType, upsert: false });
  if (error) throw new Error(`Could not upload the ${side} of your license: ${error.message}`);
  return path;
}
