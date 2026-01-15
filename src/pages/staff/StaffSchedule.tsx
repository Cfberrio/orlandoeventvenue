import { useState, useEffect } from "react";
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
  parseISO
} from "date-fns";

const lifecycleColors: Record<string, string> = {
  pending: "bg-muted",
  confirmed: "bg-primary",
  pre_event_ready: "bg-chart-1",
  in_progress: "bg-chart-2",
  post_event: "bg-chart-3",
  closed_review_complete: "bg-chart-4",
  cancelled: "bg-destructive",
};

type ViewMode = "week" | "month";

export default function StaffSchedule() {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const { staffMember } = useStaffSession();

  const dateFrom = viewMode === "week" 
    ? format(startOfWeek(currentDate), "yyyy-MM-dd")
    : format(startOfMonth(currentDate), "yyyy-MM-dd");
  const dateTo = viewMode === "week"
    ? format(endOfWeek(currentDate), "yyyy-MM-dd")
    : format(endOfMonth(currentDate), "yyyy-MM-dd");

  const { data, isLoading } = useStaffScheduleData(dateFrom, dateTo);

  // Debug logging
  useEffect(() => {
    if (data?.bookings) {
      console.log(`[Staff Calendar] ${staffMember?.full_name} (${staffMember?.role}) - ${data.bookings.length} bookings found for ${dateFrom} to ${dateTo}`);
      data.bookings.forEach(b => {
        console.log(`  - ${b.event_date}: ${b.full_name} (${b.event_type}) - Role: ${b.assignment_role}`);
      });
    }
  }, [data, staffMember, dateFrom, dateTo]);

  const days = eachDayOfInterval({
    start: viewMode === "week" ? startOfWeek(currentDate) : startOfMonth(currentDate),
    end: viewMode === "week" ? endOfWeek(currentDate) : endOfMonth(currentDate),
  });

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
              <> • <span className="font-medium text-primary">{data.bookings.length} assigned booking{data.bookings.length !== 1 ? 's' : ''}</span> in this period</>
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
                ? `${format(startOfWeek(currentDate), "MMM d")} - ${format(endOfWeek(currentDate), "MMM d, yyyy")}`
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
          ) : data?.bookings.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-muted-foreground">No bookings assigned to you in this period.</p>
              <p className="text-sm text-muted-foreground mt-2">Navigate to other weeks/months to see your assignments.</p>
            </div>
          ) : (
            <div className={`grid gap-2 ${viewMode === "week" ? "grid-cols-7" : "grid-cols-7"}`}>
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
                
                return (
                  <div
                    key={day.toISOString()}
                    className={`min-h-[120px] border rounded-lg p-2 ${
                      isToday ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    <div className={`text-sm font-medium mb-1 ${isToday ? "text-primary" : ""}`}>
                      {format(day, "d")}
                    </div>
                    <div className="space-y-1">
                      {events.slice(0, 3).map((event) => (
                        <Link
                          key={event.id}
                          to={event.linkTo}
                          className={`block p-1 rounded text-xs ${event.color} text-primary-foreground hover:opacity-80 transition-opacity`}
                          title={`${event.title} - ${event.subtitle} | Your role: ${event.role}`}
                        >
                          <div className="truncate">
                            <span className="font-medium">{event.time}</span> {event.title}
                          </div>
                          <div className="text-[10px] opacity-80 truncate">
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
          )}
        </CardContent>
      </Card>

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
