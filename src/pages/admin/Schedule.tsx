import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus, Lock } from "lucide-react";
import { useScheduleData } from "@/hooks/useAdminData";
import { useAvailabilityBlocks } from "@/hooks/useAvailabilityBlocks";
import { InternalBookingWizard } from "@/components/admin/InternalBookingWizard";
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
  parseISO,
  isWithinInterval
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

export default function Schedule() {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showBookings, setShowBookings] = useState(true);
  const [showCleaning, setShowCleaning] = useState(true);
  const [showBlocks, setShowBlocks] = useState(true);
  const [internalBookingOpen, setInternalBookingOpen] = useState(false);

  const dateFrom = viewMode === "week" 
    ? format(startOfWeek(currentDate), "yyyy-MM-dd")
    : format(startOfMonth(currentDate), "yyyy-MM-dd");
  const dateTo = viewMode === "week"
    ? format(endOfWeek(currentDate), "yyyy-MM-dd")
    : format(endOfMonth(currentDate), "yyyy-MM-dd");

  const { data, isLoading } = useScheduleData(dateFrom, dateTo);
  const { data: blocks = [] } = useAvailabilityBlocks(dateFrom, dateTo);

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

  // Check if a date falls within a block's range
  const isDateInBlock = (day: Date, block: { start_date: string; end_date: string }) => {
    const start = parseISO(block.start_date);
    const end = parseISO(block.end_date);
    return isWithinInterval(day, { start, end });
  };

  const getEventsForDay = (day: Date) => {
    const events: Array<{
      type: "booking" | "cleaning" | "block";
      id: string;
      title: string;
      subtitle: string;
      time: string;
      color: string;
      linkTo: string;
    }> = [];

    // Add availability blocks
    if (showBlocks) {
      blocks
        .filter((block) => isDateInBlock(day, block))
        .forEach((block) => {
          // Only add if it's the start date or we want to show on all days
          const isStartDate = isSameDay(parseISO(block.start_date), day);
          const isEndDate = isSameDay(parseISO(block.end_date), day);
          const isMultiDay = block.start_date !== block.end_date;
          
          events.push({
            type: "block",
            id: block.id,
            title: block.source === "internal_admin" 
              ? `Internal${block.notes ? `: ${block.notes.substring(0, 20)}` : ""}` 
              : block.source === "blackout" 
                ? "Blackout" 
                : "System Block",
            subtitle: block.block_type === "hourly" && block.start_time && block.end_time
              ? `${block.start_time.slice(0,5)} - ${block.end_time.slice(0,5)}`
              : isMultiDay
                ? isStartDate 
                  ? `Starts → ${format(parseISO(block.end_date), "MMM d")}`
                  : isEndDate
                    ? `← Ends`
                    : "Continues"
                : "All day",
            time: block.block_type === "hourly" && block.start_time 
              ? block.start_time.slice(0, 5) 
              : "Block",
            color: block.source === "internal_admin" ? "bg-amber-500" : "bg-slate-500",
            linkTo: block.booking_id ? `/admin/bookings/${block.booking_id}` : "#",
          });
        });
    }

    if (showBookings) {
      data?.bookings
        .filter((b) => isSameDay(parseISO(b.event_date), day))
        .forEach((booking) => {
          events.push({
            type: "booking",
            id: booking.id,
            title: booking.full_name,
            subtitle: `${booking.event_type} • ${booking.number_of_guests} guests`,
            time: booking.start_time?.slice(0, 5) || "All day",
            color: lifecycleColors[booking.lifecycle_status] || "bg-muted",
            linkTo: `/admin/bookings/${booking.id}`,
          });
        });
    }

    if (showCleaning) {
      data?.cleaningReports
        .filter((r) => r.scheduled_start && isSameDay(parseISO(r.scheduled_start), day))
        .forEach((report) => {
          events.push({
            type: "cleaning",
            id: report.id,
            title: `Cleaning - ${(report.bookings as { full_name: string })?.full_name || "Unknown"}`,
            subtitle: report.status,
            time: report.scheduled_start ? format(parseISO(report.scheduled_start), "HH:mm") : "-",
            color: "bg-chart-5",
            linkTo: `/admin/bookings/${report.booking_id}`,
          });
        });
    }

    return events.sort((a, b) => a.time.localeCompare(b.time));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-foreground">Schedule</h1>
        <div className="flex items-center gap-4">
          <Button onClick={() => setInternalBookingOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Internal Booking
          </Button>
          <div className="flex items-center gap-2">
            <Checkbox 
              id="show-bookings" 
              checked={showBookings} 
              onCheckedChange={(c) => setShowBookings(!!c)} 
            />
            <label htmlFor="show-bookings" className="text-sm">Bookings</label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox 
              id="show-cleaning" 
              checked={showCleaning} 
              onCheckedChange={(c) => setShowCleaning(!!c)} 
            />
            <label htmlFor="show-cleaning" className="text-sm">Cleaning</label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox 
              id="show-blocks" 
              checked={showBlocks} 
              onCheckedChange={(c) => setShowBlocks(!!c)} 
            />
            <label htmlFor="show-blocks" className="text-sm">Blocks</label>
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
                          className={`block p-1 rounded text-xs ${event.color} text-primary-foreground truncate`}
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
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-chart-5" />
              <span className="text-xs">Cleaning</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Internal Booking Wizard */}
      <InternalBookingWizard open={internalBookingOpen} onOpenChange={setInternalBookingOpen} />
    </div>
  );
}
