import { supabase } from "@/integrations/supabase/client";
import { BookingAttachment } from "@/hooks/useAdminData";
import { ImageOff, FileText } from "lucide-react";

/**
 * Photos the guest uploads with their post-event report. They land in the public
 * `cleaning-media` bucket with one `booking_attachments` row each, tagged
 * `category = 'host_post_event'` and `description = <field id>`. Issue photos use
 * `category = 'maintenance'`.
 *
 * `booking_attachments.category` has no CHECK constraint, and today `useGuestReport`
 * is the only writer of these two values. If an internal maintenance flow ever
 * uploads under `maintenance`, it will surface here as if the guest had sent it —
 * give that flow its own category instead of reusing this one.
 *
 * The bucket is public (migration 20251211015831), so these URLs carry no token and
 * do not expire. That predates this card; switch to `createSignedUrl` if guest
 * photos are ever treated as sensitive.
 */
const PHOTO_LABELS: Record<string, string> = {
  guest_main_area_media: "Main venue space",
  guest_front_door_media: "Locked entrance",
  guest_kitchen_trash_media: "Kitchen and trash",
  guest_bathrooms_media: "Bathrooms",
  guest_rack_media: "Tables and chairs rack",
  guest_issue_media: "Reported issue",
};

// Older reports used a longer photo list than the current two-photo form, so keep
// the known order and let anything unrecognised fall to the end.
const PHOTO_ORDER = Object.keys(PHOTO_LABELS);

function labelFor(attachment: BookingAttachment): string {
  return (
    (attachment.description && PHOTO_LABELS[attachment.description]) ||
    attachment.description ||
    attachment.filename
  );
}

function sortAttachments(a: BookingAttachment, b: BookingAttachment): number {
  const ai = PHOTO_ORDER.indexOf(a.description ?? "");
  const bi = PHOTO_ORDER.indexOf(b.description ?? "");
  if (ai !== bi) return (ai === -1 ? PHOTO_ORDER.length : ai) - (bi === -1 ? PHOTO_ORDER.length : bi);
  return a.created_at.localeCompare(b.created_at);
}

function publicUrl(storagePath: string): string {
  return supabase.storage.from("cleaning-media").getPublicUrl(storagePath).data.publicUrl;
}

interface Props {
  attachments: BookingAttachment[] | undefined;
}

const GuestReportPhotos = ({ attachments }: Props) => {
  const photos = (attachments ?? [])
    .filter((a) => a.category === "host_post_event" || a.category === "maintenance")
    .sort(sortAttachments);

  if (photos.length === 0) {
    return (
      <div className="border-t pt-4">
        <label className="text-sm font-medium text-muted-foreground mb-3 block">Guest Photos</label>
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-lg p-3">
          <ImageOff className="h-4 w-4 flex-shrink-0" />
          The guest submitted the report without photos.
        </div>
      </div>
    );
  }

  return (
    <div className="border-t pt-4">
      <label className="text-sm font-medium text-muted-foreground mb-3 block">
        Guest Photos ({photos.length})
      </label>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {photos.map((photo) => {
          const url = publicUrl(photo.storage_path);
          const label = labelFor(photo);
          const isImage = photo.content_type.startsWith("image/");
          return (
            <a
              key={photo.id}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="group block rounded-lg border overflow-hidden hover:border-primary transition-colors"
              title={`${label} — open full size`}
            >
              {isImage ? (
                <img
                  src={url}
                  alt={label}
                  loading="lazy"
                  className="w-full h-32 object-cover bg-muted"
                />
              ) : (
                <div className="w-full h-32 flex items-center justify-center bg-muted">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div className="p-2">
                <p className="text-xs font-medium truncate group-hover:text-primary">{label}</p>
                {photo.category === "maintenance" && (
                  <p className="text-xs text-destructive">Issue photo</p>
                )}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
};

export default GuestReportPhotos;
