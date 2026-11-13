// Must stay byte-identical to the other copy (src/lib/eventTypes.ts <-> supabase/functions/_shared/event-types.ts); a test enforces it. ClickUp 86e40ach2 M-14.

export const EVENT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
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

export function eventTypeLabel(type: string | null | undefined, other?: string | null): string {
  const value = type?.trim();
  if (!value) return "Event";

  const normalized = value.toLowerCase();
  if (normalized === "other") {
    const customLabel = other?.trim();
    return customLabel ? customLabel.slice(0, 60) : "Other";
  }

  const option = EVENT_TYPE_OPTIONS.find((entry) => entry.value.toLowerCase() === normalized);
  if (option) return option.label;

  return value
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
