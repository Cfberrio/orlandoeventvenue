import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { History } from "lucide-react";
import { format } from "date-fns";
import { useBookingEvents, type BookingEvent } from "@/hooks/useAdminData";
import { useOptionalAuth } from "@/hooks/useAuth";

interface Props {
  bookingId: string;
}

interface ChangeRow {
  label: string;
  from: string;
  to: string;
}

const EDIT_EVENT_TYPES = ["booking_details_edited", "booking_rescheduled"];

const display = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
};

/** Normalises both edit shapes (field changes, and the reschedule RPC's old/new values). */
export function extractChanges(event: BookingEvent): ChangeRow[] {
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;

  if (Array.isArray(metadata.changes)) {
    return (metadata.changes as Array<Record<string, unknown>>).map((change) => ({
      label: String(change.label ?? change.field ?? "field"),
      from: display(change.from),
      to: display(change.to),
    }));
  }

  const oldValues = (metadata.old_values ?? {}) as Record<string, unknown>;
  const newValues = (metadata.new_values ?? {}) as Record<string, unknown>;
  return Object.keys(newValues)
    .filter((key) => display(oldValues[key]) !== display(newValues[key]))
    .map((key) => ({
      label: key.replace(/_/g, " "),
      from: display(oldValues[key]),
      to: display(newValues[key]),
    }));
}

/**
 * C-2: never print a raw auth user id. Older edits only stored actor_id; the
 * profiles table is readable only by its owner, so we can name the current
 * admin and fall back to a short tag for anyone else.
 */
export function actorLabel(
  metadata: Record<string, unknown>,
  currentUser?: { id: string; email?: string | null } | null,
): string {
  const email = typeof metadata.actor_email === "string" ? metadata.actor_email.trim() : "";
  if (email) return email;
  const id = typeof metadata.actor_id === "string" ? metadata.actor_id.trim() : "";
  if (!id) return "System";
  if (currentUser && currentUser.id === id) return currentUser.email || "You";
  return `Admin ·${id.slice(-4)}`;
}

export default function BookingEditHistoryCard({ bookingId }: Props) {
  const { data: events } = useBookingEvents(bookingId);
  const user = useOptionalAuth()?.user ?? null;
  const editEvents = (events ?? []).filter((event) => EDIT_EVENT_TYPES.includes(event.event_type));

  if (editEvents.length === 0) return null;

  return (
    <Card className="border-l-4 border-l-slate-400">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="h-5 w-5 text-slate-500" />
          Edit History
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {editEvents.map((event) => {
          const metadata = (event.metadata ?? {}) as Record<string, unknown>;
          const actor = actorLabel(metadata, user);
          const changes = extractChanges(event);

          return (
            <div key={event.id} className="border-b last:border-b-0 pb-3 last:pb-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {event.event_type === "booking_rescheduled" ? "Rescheduled" : "Details edited"}
                </span>
                <span>{format(new Date(event.created_at), "MM/dd/yyyy h:mm a")}</span>
                <span>·</span>
                <span>{actor}</span>
              </div>
              {typeof metadata.reason === "string" && metadata.reason && (
                <p className="text-sm mt-1">Reason: {metadata.reason}</p>
              )}
              <ul className="mt-1 space-y-0.5">
                {changes.map((change, index) => (
                  <li key={`${event.id}-${change.label}-${index}`} className="text-sm">
                    <span className="text-muted-foreground">{change.label}:</span>{" "}
                    <span className="line-through text-muted-foreground">{change.from}</span>{" "}
                    <span aria-hidden="true">→</span>{" "}
                    <span className="font-medium">{change.to}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
