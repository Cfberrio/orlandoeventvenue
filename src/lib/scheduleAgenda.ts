import { isSameMonth } from "date-fns";

// UI2-4: data side of the phone agenda for /admin/schedule.

export type ScheduleEvent = {
  type: "booking" | "cleaning" | "block";
  id: string;
  title: string;
  subtitle: string;
  time: string;
  color: string;
  linkTo: string;
  bookingOrigin?: "website" | "internal" | "external";
  cancelled?: boolean;
};

export type AgendaDay = { day: Date; events: ScheduleEvent[] };

/**
 * Days the agenda lists. Week view: all 7 days, empty ones included, so the
 * week reads as a week. Month view: only days of that month that have events.
 */
export function agendaDays(
  days: Date[],
  eventsFor: (day: Date) => ScheduleEvent[],
  viewMode: "week" | "month",
  currentDate: Date,
): AgendaDay[] {
  return days
    .filter((day) => viewMode === "week" || isSameMonth(day, currentDate))
    .map((day) => ({ day, events: eventsFor(day) }))
    .filter((d) => viewMode === "week" || d.events.length > 0);
}
