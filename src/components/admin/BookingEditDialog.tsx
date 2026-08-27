import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarIcon, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useUpdateBookingDetails, type BookingFieldChange } from "@/hooks/useAdminData";

export interface EditableBooking {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  company: string | null;
  event_type: string;
  event_type_other: string | null;
  number_of_guests: number;
  client_notes: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
}

interface Props {
  booking: EditableBooking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the conflict-checked reschedule flow — date/time are not edited here. */
  onReschedule?: () => void;
}

/** Values written by the public booking form, plus the admin wizard labels. */
const EVENT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "birthday-party", label: "Birthday Party (adults or kids)" },
  { value: "baby-shower", label: "Baby Shower" },
  { value: "bridal-shower", label: "Bridal Shower" },
  { value: "wedding-reception", label: "Wedding Reception" },
  { value: "graduation-party", label: "Graduation Party" },
  { value: "corporate-meeting", label: "Corporate Meeting / Team Meeting" },
  { value: "training-seminar", label: "Training / Seminar" },
  { value: "workshop-class", label: "Workshop / Class" },
  { value: "networking-mixer", label: "Networking Mixer / Meetup" },
  { value: "celebration-of-life", label: "Celebration of Life / Memorial Reception" },
  { value: "other", label: "Other" },
];

const MAX_GUESTS = 90;
const MAX_NOTES = 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 10+ digits once punctuation is stripped, optional leading +. */
const PHONE_RE = /^\+?[\d\s().-]{10,}$/;

interface FormState {
  full_name: string;
  email: string;
  phone: string;
  company: string;
  event_type: string;
  event_type_other: string;
  number_of_guests: string;
  client_notes: string;
}

const toFormState = (b: EditableBooking): FormState => ({
  full_name: b.full_name ?? "",
  email: b.email ?? "",
  phone: b.phone ?? "",
  company: b.company ?? "",
  event_type: b.event_type ?? "",
  event_type_other: b.event_type_other ?? "",
  number_of_guests: String(b.number_of_guests ?? ""),
  client_notes: b.client_notes ?? "",
});

const FIELD_LABELS: Record<keyof FormState, string> = {
  full_name: "Client name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  event_type: "Event type",
  event_type_other: "Event type (other)",
  number_of_guests: "Guests",
  client_notes: "Client notes",
};

export function validateBookingEdit(form: FormState): string | null {
  if (!form.full_name.trim()) return "Client name is required.";
  if (!EMAIL_RE.test(form.email.trim())) return "Enter a valid email address.";
  if (!PHONE_RE.test(form.phone.trim())) return "Enter a valid phone number.";
  if (!form.event_type.trim()) return "Event type is required.";
  if (form.event_type === "other" && !form.event_type_other.trim())
    return "Specify the event type when 'Other' is selected.";
  const guests = Number(form.number_of_guests);
  if (!Number.isInteger(guests) || guests < 1)
    return "Guest count must be a whole number of at least 1.";
  if (guests > MAX_GUESTS) return `Maximum capacity is ${MAX_GUESTS} guests.`;
  if (form.client_notes.length > MAX_NOTES)
    return `Client notes must be ${MAX_NOTES} characters or fewer.`;
  return null;
}

/** Diffs the edited form against the saved booking, normalising empties to null. */
export function diffBookingEdit(
  booking: EditableBooking,
  form: FormState,
): { updates: Record<string, unknown>; changes: BookingFieldChange[] } {
  const original = toFormState(booking);
  const updates: Record<string, unknown> = {};
  const changes: BookingFieldChange[] = [];

  (Object.keys(original) as Array<keyof FormState>).forEach((key) => {
    const before = original[key].trim();
    const after = form[key].trim();
    if (before === after) return;

    if (key === "number_of_guests") {
      updates[key] = Number(after);
      changes.push({ field: key, label: FIELD_LABELS[key], from: Number(before), to: Number(after) });
      return;
    }

    const nullable = key === "company" || key === "client_notes" || key === "event_type_other";
    updates[key] = nullable && after === "" ? null : after;
    changes.push({ field: key, label: FIELD_LABELS[key], from: before || null, to: after || null });
  });

  // Selecting a non-"other" type leaves a stale free-text value behind.
  if (form.event_type !== "other" && booking.event_type_other && !("event_type_other" in updates)) {
    updates.event_type_other = null;
    changes.push({
      field: "event_type_other",
      label: FIELD_LABELS.event_type_other,
      from: booking.event_type_other,
      to: null,
    });
  }

  return { updates, changes };
}

export default function BookingEditDialog({ booking, open, onOpenChange, onReschedule }: Props) {
  const { toast } = useToast();
  const { mutateAsync, isPending } = useUpdateBookingDetails();
  const [form, setForm] = useState<FormState>(() => toFormState(booking));

  // Reseed on open so an abandoned draft never leaks into the next edit.
  useEffect(() => {
    if (open) setForm(toFormState(booking));
  }, [open, booking]);

  const set = (key: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const typeOptions = EVENT_TYPE_OPTIONS.some((o) => o.value === booking.event_type)
    ? EVENT_TYPE_OPTIONS
    : [{ value: booking.event_type, label: booking.event_type }, ...EVENT_TYPE_OPTIONS];

  const save = async () => {
    const validationError = validateBookingEdit(form);
    if (validationError) {
      toast({ title: "Check the form", description: validationError, variant: "destructive" });
      return;
    }

    const { updates, changes } = diffBookingEdit(booking, form);
    if (changes.length === 0) {
      toast({ title: "No changes to save" });
      onOpenChange(false);
      return;
    }

    try {
      const result = await mutateAsync({ bookingId: booking.id, updates, changes });
      toast({
        title: "Booking updated",
        description: result.auditLogged
          ? `${changes.length} field${changes.length === 1 ? "" : "s"} changed.`
          : "Saved, but the change could not be written to the edit history.",
      });
      onOpenChange(false);
    } catch (error) {
      console.error("Booking edit failed:", error);
      toast({
        title: "Failed to update booking",
        description: String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit booking details</DialogTitle>
          <DialogDescription>
            Update contact and event information. Every change is recorded in the edit history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Contact Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-full-name">Client name</Label>
                <Input
                  id="edit-full-name"
                  value={form.full_name}
                  onChange={(e) => set("full_name")(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-company">Company</Label>
                <Input
                  id="edit-company"
                  value={form.company}
                  onChange={(e) => set("company")(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email")(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Phone</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set("phone")(e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Event Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-event-type">Event type</Label>
                <Select value={form.event_type} onValueChange={set("event_type")}>
                  <SelectTrigger id="edit-event-type">
                    <SelectValue placeholder="Select event type" />
                  </SelectTrigger>
                  <SelectContent className="bg-background">
                    {typeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-guests">Guests</Label>
                <Input
                  id="edit-guests"
                  type="number"
                  min={1}
                  max={MAX_GUESTS}
                  value={form.number_of_guests}
                  onChange={(e) => set("number_of_guests")(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Maximum capacity: {MAX_GUESTS} guests</p>
              </div>
              {form.event_type === "other" && (
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="edit-event-type-other">Specify event type</Label>
                  <Input
                    id="edit-event-type-other"
                    value={form.event_type_other}
                    onChange={(e) => set("event_type_other")(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="rounded-md border bg-muted/40 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="flex items-center gap-1">
                  <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  {booking.event_date}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  {booking.start_time?.slice(0, 5) || "-"} - {booking.end_time?.slice(0, 5) || "-"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Date and time are changed through Reschedule, which checks for conflicts and shifts
                reminder jobs.
              </p>
              {onReschedule && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    onReschedule();
                  }}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  Reschedule instead
                </Button>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <Label htmlFor="edit-client-notes">Client notes</Label>
            <Textarea
              id="edit-client-notes"
              rows={4}
              maxLength={MAX_NOTES}
              value={form.client_notes}
              onChange={(e) => set("client_notes")(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {form.client_notes.length}/{MAX_NOTES}
            </p>
          </section>

          <p className="text-xs text-muted-foreground">
            Pricing, deposit and balance are not editable here — they follow the Stripe records.
            Editing details does not re-send the confirmation email; use the client's contact
            details if they need a new copy.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isPending}>
            {isPending ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
