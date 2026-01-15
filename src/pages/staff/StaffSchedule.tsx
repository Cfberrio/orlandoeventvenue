import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { useStaffScheduleData } from "@/hooks/useStaffData";
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

  const dateFrom = viewMode === "week" 
    ? format(startOfWeek(currentDate), "yyyy-MM-dd")
    : format(startOfMonth(currentDate), "yyyy-MM-dd");
  const dateTo = viewMode === "week"
    ? format(endOfWeek(currentDate), "yyyy-MM-dd")
    : format(endOfMonth(currentDate), "yyyy-MM-dd");

  const { data, isLoading } = useStaffScheduleData(dateFrom, dateTo);

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
        });
      });

    return events.sort((a, b) => a.time.localeCompare(b.time));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-foreground">My Schedule</h1>
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
                          className={`block p-1 rounded text-xs ${event.color} text-primary-foreground truncate hover:opacity-80 transition-opacity`}
                          title={`${event.title} - ${event.subtitle}`}
                        >
                          <span className="font-medium">{event.time}</span> {event.title}
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
