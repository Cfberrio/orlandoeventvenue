import { Link } from "react-router-dom";
import { format, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import type { AgendaDay, ScheduleEvent } from "@/lib/scheduleAgenda";

// UI2-4: below `md` the 7-column calendar gives each day 27-37 px, so the
// booking name and time were invisible. Phones get this agenda instead.

const ORIGIN_BADGE: Record<NonNullable<ScheduleEvent["bookingOrigin"]>, { label: string; className: string }> = {
  website: { label: "WEB", className: "bg-green-500" },
  internal: { label: "INT", className: "bg-amber-500" },
  external: { label: "EXT", className: "bg-purple-500" },
};

function typeBadge(event: ScheduleEvent): { label: string; className: string } | null {
  if (event.type === "booking") return event.bookingOrigin ? ORIGIN_BADGE[event.bookingOrigin] : null;
  if (event.type === "cleaning") return { label: "CLEAN", className: "bg-chart-5" };
  return { label: "BLOCK", className: "bg-slate-500" };
}

export function ScheduleDayEvents({ events }: { events: ScheduleEvent[] }) {
  if (events.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">Nothing scheduled.</p>;
  }
  return (
    <ul className="space-y-2">
      {events.map((event) => {
        const badge = typeBadge(event);
        const body = (
          <>
            <span className={cn("w-1.5 self-stretch shrink-0 rounded-full", event.color)} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums">{event.time}</span>
                {badge && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none text-white",
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "mt-0.5 block break-words text-sm font-medium text-foreground",
                  event.cancelled && "line-through opacity-60",
                )}
              >
                {event.title}
              </span>
              <span className="block break-words text-xs text-muted-foreground">{event.subtitle}</span>
            </span>
          </>
        );
        const rowClass = "flex gap-3 rounded-lg border border-border bg-background p-3";
        return (
          <li key={`${event.type}-${event.id}`}>
            {event.linkTo && event.linkTo !== "#" ? (
              <Link to={event.linkTo} className={cn(rowClass, "transition-colors hover:bg-accent active:bg-accent")}>
                {body}
              </Link>
            ) : (
              <div className={rowClass}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ScheduleAgenda({ groups, emptyLabel }: { groups: AgendaDay[]; emptyLabel: string }) {
  if (groups.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  const today = new Date();
  return (
    <div className="space-y-5" data-testid="schedule-agenda">
      {groups.map(({ day, events }) => {
        const isToday = isSameDay(day, today);
        return (
          <section key={day.toISOString()} aria-label={format(day, "EEEE, MMMM d")}>
            <h3
              className={cn(
                "mb-2 flex items-baseline gap-2 text-sm font-semibold",
                isToday ? "text-primary" : "text-foreground",
              )}
            >
              {format(day, "EEE, MMM d")}
              {isToday && <span className="text-xs font-medium">Today</span>}
            </h3>
            <ScheduleDayEvents events={events} />
          </section>
        );
      })}
    </div>
  );
}
