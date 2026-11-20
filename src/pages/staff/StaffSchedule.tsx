import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { useStaffScheduleData } from "@/hooks/useStaffData";
import { useStaffSession } from "@/hooks/useStaffSession";
import { 
  format, 
  startOfWeek, 
  endOfWeek, 
  startOfMonth, 
  endOfMonth,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  parseISO
} from "date-fns";
import { monthGridRange } from "@/lib/staffPortal";

const lifecycleColors: Record<string, string> = {
  pending: "bg-yellow-500 text-white",
  confirmed: "bg-blue-600 text-white",
  pre_event_ready: "bg-indigo-600 text-white",
  in_progress: "bg-green-600 text-white",
  post_event: "bg-purple-600 text-white",
  closed_review_complete: "bg-gray-500 text-white",
  cancelled: "bg-red-600 text-white",
};

type ViewMode = "week" | "month";

export default function StaffSchedule() {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const { staffMember } = useStaffSession();

  // ST2-13: the month grid starts on the Sunday of the first week (Dec 1, a
  // Tuesday, sits under Tue), like the admin Schedule.
  const range = viewMode === "week"
    ? { start: startOfWeek(currentDate), end: endOfWeek(currentDate) }
    : monthGridRange(currentDate);
  const dateFrom = format(range.start, "yyyy-MM-dd");
  const dateTo = format(range.end, "yyyy-MM-dd");
  // The header count covers the month itself, not the padding days.
  const periodFrom = viewMode === "week" ? dateFrom : format(startOfMonth(currentDate), "yyyy-MM-dd");
  const periodTo = viewMode === "week" ? dateTo : format(endOfMonth(currentDate), "yyyy-MM-dd");

  const { data, isLoading } = useStaffScheduleData(dateFrom, dateTo);
  const periodBookings = (data?.bookings ?? []).filter((b) => b.event_date >= periodFrom && b.event_date <= periodTo);

  const days = eachDayOfInterval(range);

  const navigate = (direction: "prev" | "next") => {
    if (viewMode === "week") {
      setCurrentDate(direction === "prev" ? subWeeks(currentDate, 1) : addWeeks(currentDate, 1));
    } else {
      setCurrentDate(direction === "prev" ? subMonths(currentDate, 1) : addMonths(currentDate, 1));
    }
  };

  const getEventsForDay = (day: Date) => {
    const events: Array<{
      id: string;
      title: string;
      subtitle: string;
      time: string;
      color: string;
      linkTo: string;
      role: string;
    }> = [];

    data?.bookings
      .filter((b) => isSameDay(parseISO(b.event_date), day))
      .forEach((booking) => {
        events.push({
          id: booking.id,
          title: booking.full_name,
          subtitle: `${booking.event_type} • ${booking.number_of_guests} guests`,
          time: booking.start_time?.slice(0, 5) || "All day",
          color: lifecycleColors[booking.lifecycle_status] || "bg-muted",
          linkTo: `/staff/bookings/${booking.id}`,
          role: booking.assignment_role || "Staff",
        });
      });

    return events.sort((a, b) => a.time.localeCompare(b.time));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Schedule</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {staffMember?.full_name} ({staffMember?.role})
            {!isLoading && data && (
              <> • <span className="font-medium text-primary">{periodBookings.length} assigned booking{periodBookings.length !== 1 ? 's' : ''}</span> in this period</>
            )}
          </p>
        </div>
        <div className="flex gap-1">
          <Button 
            variant={viewMode === "week" ? "default" : "outline"} 
            size="sm"
            onClick={() => setViewMode("week")}
          >
            Week
          </Button>
          <Button 
            variant={viewMode === "month" ? "default" : "outline"} 
            size="sm"
            onClick={() => setViewMode("month")}
          >
            Month
          </Button>
        </div>
      </div>

      {/* Navigation */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={() => navigate("prev")}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <CardTitle className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5" />
              {viewMode === "week"
                ? `${format(startOfWeek(currentDate), "MM/dd")} - ${format(endOfWeek(currentDate), "MM/dd/yyyy")}`
                : format(currentDate, "MMMM yyyy")}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={() => navigate("next")}>
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading schedule...</div>
          ) : periodBookings.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-muted-foreground">No bookings assigned to you in this period.</p>
              <p className="text-sm text-muted-foreground mt-2">Navigate to other weeks/months to see your assignments.</p>
            </div>
          ) : (
            <>
            {/* Phones: a 7-column grid is ~43px per day, so list the days with work instead. */}
            <div className="md:hidden space-y-3">
              {days
                .filter((day) => getEventsForDay(day).length > 0 && (viewMode === "week" || isSameMonth(day, currentDate)))
                .map((day) => (
                  <div key={day.toISOString()} className="space-y-2">
                    <div className={`text-sm font-semibold ${isSameDay(day, new Date()) ? "text-primary" : "text-foreground"}`}>
                      {format(day, "EEE, MMM d")}
                    </div>
                    {getEventsForDay(day).map((event) => (
                      <Link
                        key={event.id}
                        to={event.linkTo}
                        className={`block p-3 rounded-md text-sm ${event.color} hover:opacity-90`}
                      >
                        <div className="font-medium break-words">{event.time} · {event.title}</div>
                        <div className="text-xs opacity-90 break-words">{event.subtitle}</div>
                        <div className="text-xs opacity-90">Your role: {event.role}</div>
                      </Link>
                    ))}
                  </div>
                ))}
            </div>
            <div className="hidden md:grid gap-2 grid-cols-7">
              {/* Day headers */}
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div key={day} className="text-center text-sm font-medium text-muted-foreground py-2">
                  {day}
                </div>
              ))}

              {/* Calendar cells */}
              {days.map((day) => {
                const events = getEventsForDay(day);
                const isToday = isSameDay(day, new Date());
                const hasEvents = events.length > 0;
                
                const outside = viewMode === "month" && !isSameMonth(day, currentDate);
                return (
                  <div
                    key={day.toISOString()}
                    className={`min-h-[120px] border rounded-lg p-2 ${outside ? "opacity-50 " : ""}${
                      isToday 
                        ? "border-primary bg-primary/5" 
                        : hasEvents
                          ? "border-blue-300 bg-blue-50 dark:bg-blue-950/20"
                          : "border-border bg-background"
                    }`}
                  >
                    <div className={`text-sm font-medium mb-1 flex items-center justify-between ${isToday ? "text-primary" : ""}`}>
                      <span>{format(day, "d")}</span>
                      {hasEvents && (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-bold bg-blue-600 text-white">
                          {events.length}
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-1">
                      {events.slice(0, 3).map((event) => (
                        <Link
                          key={event.id}
                          to={event.linkTo}
                          className={`block p-2 rounded-md text-xs ${event.color} hover:opacity-90 transition-all shadow-sm border border-white/20`}
                          title={`${event.title} - ${event.subtitle} | Your role: ${event.role}`}
                        >
                          <div className="truncate">
                            <span className="font-medium">{event.time}</span> {event.title}
                          </div>
                          <div className="text-[10px] opacity-90 truncate">
                            {event.role}
                          </div>
                        </Link>
                      ))}
                      {events.length > 3 && (
                        <div className="text-xs text-muted-foreground">
                          +{events.length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Visual Guide */}
      {!isLoading && periodBookings.length > 0 && (
        <div className="text-sm p-3 bg-blue-50 dark:bg-blue-950/20 rounded-md border border-blue-200 dark:border-blue-800">
          <strong className="text-blue-900 dark:text-blue-100">📅 Visual Guide:</strong>{" "}
          <span className="text-blue-800 dark:text-blue-200">
            Days with a blue background have bookings assigned to you. The badge shows the number of bookings. 
            Click on any booking to see full details.
          </span>
        </div>
      )}

      {/* Legend */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-4">
            <span className="text-sm font-medium">Legend:</span>
            {Object.entries(lifecycleColors).map(([status, color]) => (
              <div key={status} className="flex items-center gap-1">
                <div className={`w-3 h-3 rounded ${color}`} />
                <span className="text-xs">{status.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
