import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { isLicenseSide, LICENSE_MAX_BYTES, sniffLicenseFile } from "../_shared/license-file.ts";

// Public (verify_jwt = false): guests are anonymous. The bucket has no anon
// write policy, so this function is the only way in. It:
//   1. claims a rate-limit slot atomically (per IP + global, see
//      claim_license_upload_slot in migration 20260923170000),
//   2. checks size and the real file type from magic bytes,
//   3. writes with the service role to a random, never-reused path,
//   4. registers it in driver_license_uploads (migration 20260923180000).
// Retention is driven by that registry, not by bookings columns.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (req.headers.get("cf-connecting-ip") || fwd?.split(",")[0] || "unknown").trim();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Reject oversized bodies before reading them into memory.
  const declared = Number(req.headers.get("content-length") || "0");
  if (declared > LICENSE_MAX_BYTES + 64 * 1024) return json({ error: "File is too large. Maximum size is 10 MB." }, 413);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { data: allowed, error: claimError } = await supabase.rpc("claim_license_upload_slot", {
      p_ip: clientIp(req),
    });
    if (claimError) {
      console.error("claim_license_upload_slot failed:", claimError);
      return json({ error: "Upload is temporarily unavailable. Please try again." }, 503);
    }
    if (allowed !== true) {
      return json({ error: "Too many upload attempts. Please wait a few minutes and try again." }, 429);
    }

    const form = await req.formData();
    const side = form.get("side");
    const file = form.get("file");
    if (!isLicenseSide(side) || !(file instanceof File)) return json({ error: "Invalid request" }, 400);
    if (file.size === 0 || file.size > LICENSE_MAX_BYTES) {
      return json({ error: "File is too large. Maximum size is 10 MB." }, 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffLicenseFile(bytes);
    if (!kind) return json({ error: "Please upload a photo (JPG, PNG, HEIC, WEBP) or a PDF." }, 415);

    const path = `uploads/${crypto.randomUUID()}/${side}.${kind.ext}`;
    const { error: uploadError } = await supabase.storage
      .from("driver-licenses")
      .upload(path, bytes, { contentType: kind.contentType, upsert: false });
    if (uploadError) {
      console.error("driver-licenses upload failed:", uploadError);
      return json({ error: "Upload failed. Please try again." }, 500);
    }

    // Register the file so retention works off a table guests can't edit.
    const { error: registryError } = await supabase.from("driver_license_uploads").insert({ path, side });
    if (registryError) {
      console.error("driver_license_uploads insert failed:", registryError);
      const { error: rollbackError } = await supabase.storage.from("driver-licenses").remove([path]);
      if (rollbackError) console.error("rollback remove failed:", path, rollbackError);
      return json({ error: "Upload failed. Please try again." }, 500);
    }

    return json({ path });
  } catch (e) {
    console.error("upload-driver-license error:", e);
    return json({ error: "Upload failed. Please try again." }, 500);
  }
});
