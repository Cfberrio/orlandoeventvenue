import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus, Lock, Globe, ClipboardList, Download } from "lucide-react";
import { useScheduleData } from "@/hooks/useAdminData";
import { useAvailabilityBlocks } from "@/hooks/useAvailabilityBlocks";
import { InternalBookingWizard } from "@/components/admin/InternalBookingWizard";
import { ExternalBookingWizard } from "@/components/admin/ExternalBookingWizard";
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
  isWithinInterval,
  isAfter,
  startOfDay
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

const bookingOriginColors: Record<string, { bg: string; badge: string; icon: any }> = {
  website: { bg: "bg-green-500", badge: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", icon: Globe },
  internal: { bg: "bg-amber-500", badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400", icon: ClipboardList },
  external: { bg: "bg-purple-500", badge: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400", icon: Download },
};

type ViewMode = "week" | "month";

export default function Schedule() {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showBookings, setShowBookings] = useState(true);
  const [showCleaning, setShowCleaning] = useState(true);
  const [showBlocks, setShowBlocks] = useState(true);
  const [showWebsiteBookings, setShowWebsiteBookings] = useState(true);
  const [showInternalBookings, setShowInternalBookings] = useState(true);
  const [showExternalBookings, setShowExternalBookings] = useState(true);
  const [internalBookingOpen, setInternalBookingOpen] = useState(false);
  const [externalBookingOpen, setExternalBookingOpen] = useState(false);

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
      bookingOrigin?: "website" | "internal" | "external";
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
        .filter((b) => {
          if (!isSameDay(parseISO(b.event_date), day)) return false;
          
          // Apply booking origin filters
          if (b.booking_origin === "website" && !showWebsiteBookings) return false;
          if (b.booking_origin === "internal" && !showInternalBookings) return false;
          if (b.booking_origin === "external" && !showExternalBookings) return false;
          
          return true;
        })
        .forEach((booking) => {
          const originColor = bookingOriginColors[booking.booking_origin]?.bg || "bg-muted";
          
          events.push({
            type: "booking",
            id: booking.id,
            title: booking.full_name,
            subtitle: `${booking.event_type} • ${booking.number_of_guests} guests`,
            time: booking.start_time?.slice(0, 5) || "All day",
            color: lifecycleColors[booking.lifecycle_status] || "bg-muted",
            linkTo: `/admin/bookings/${booking.id}`,
            bookingOrigin: booking.booking_origin,
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

  const getDayIndicators = (day: Date) => {
    if (!data?.bookings) {
      return { hasWebsiteBookings: false, hasInternalBookings: false, hasExternalBookings: false };
    }

    const hasWebsiteBookings = showWebsiteBookings && data.bookings.some(
      b => b.booking_origin === "website" && isSameDay(parseISO(b.event_date), day)
    );
    const hasInternalBookings = showInternalBookings && data.bookings.some(
      b => b.booking_origin === "internal" && isSameDay(parseISO(b.event_date), day)
    );
    const hasExternalBookings = showExternalBookings && data.bookings.some(
      b => b.booking_origin === "external" && isSameDay(parseISO(b.event_date), day)
    );

    return { hasWebsiteBookings, hasInternalBookings, hasExternalBookings };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-foreground">Schedule</h1>
        <div className="flex items-center gap-4 flex-wrap">
          <Button onClick={() => setInternalBookingOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Internal Booking
          </Button>
          <Button onClick={() => setExternalBookingOpen(true)} size="sm" variant="secondary">
            <Plus className="h-4 w-4 mr-2" />
            External Booking
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
              id="show-website" 
              checked={showWebsiteBookings} 
              onCheckedChange={(c) => setShowWebsiteBookings(!!c)} 
            />
            <label htmlFor="show-website" className="text-sm flex items-center gap-1">
              <Globe className="h-3 w-3" />
              Website
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox 
              id="show-internal" 
              checked={showInternalBookings} 
              onCheckedChange={(c) => setShowInternalBookings(!!c)} 
            />
            <label htmlFor="show-internal" className="text-sm flex items-center gap-1">
              <ClipboardList className="h-3 w-3" />
              Internal
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox 
              id="show-external" 
              checked={showExternalBookings} 
              onCheckedChange={(c) => setShowExternalBookings(!!c)} 
            />
            <label htmlFor="show-external" className="text-sm flex items-center gap-1">
              <Download className="h-3 w-3" />
              External
            </label>
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

      {/* Highlighted Website Bookings Section */}
      {!isLoading && data?.bookings && data.bookings.filter(b => b.booking_origin === "website" && isAfter(parseISO(b.event_date), startOfDay(new Date())) || isSameDay(parseISO(b.event_date), new Date())).length > 0 && (
        <Card className="border-green-500/50 bg-green-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Globe className="h-5 w-5" />
              Próximos Bookings del Website
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.bookings
                .filter(b => b.booking_origin === "website" && (isAfter(parseISO(b.event_date), startOfDay(new Date())) || isSameDay(parseISO(b.event_date), new Date())))
                .sort((a, b) => parseISO(a.event_date).getTime() - parseISO(b.event_date).getTime())
                .slice(0, 5)
                .map((booking) => {
                  const lifecycleConfig = {
                    pending: { label: "Pending", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
                    confirmed: { label: "Confirmed", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
                    pre_event_ready: { label: "Pre-Event Ready", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400" },
                    in_progress: { label: "In Progress", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
                    post_event: { label: "Post-Event", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400" },
                    closed_review_complete: { label: "Closed", color: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400" },
                    cancelled: { label: "Cancelled", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
                  };
                  const lifecycle = lifecycleConfig[booking.lifecycle_status as keyof typeof lifecycleConfig] || { label: booking.lifecycle_status, color: "bg-muted" };
                  
                  return (
                    <Link
                      key={booking.id}
                      to={`/admin/bookings/${booking.id}`}
                      className="block p-4 rounded-lg border border-green-500/30 bg-background hover:bg-green-500/10 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <Badge className={bookingOriginColors.website.badge}>
                              <Globe className="h-3 w-3 mr-1" />
                              Website
                            </Badge>
                            <Badge className={lifecycle.color}>
                              {lifecycle.label}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {format(parseISO(booking.event_date), "MMM d, yyyy")}
                              {booking.start_time && ` • ${booking.start_time.slice(0, 5)}`}
                            </span>
                          </div>
                          <p className="font-medium text-foreground">{booking.full_name}</p>
                          <p className="text-sm text-muted-foreground">
                            {booking.event_type} • {booking.number_of_guests} invitados
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">${Number(booking.total_amount).toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">{booking.payment_status}</p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
            </div>
            {data.bookings.filter(b => b.booking_origin === "website" && (isAfter(parseISO(b.event_date), startOfDay(new Date())) || isSameDay(parseISO(b.event_date), new Date()))).length > 5 && (
              <Link 
                to="/admin/bookings" 
                className="block mt-4 text-sm text-green-600 hover:underline"
              >
                Ver todos los bookings →
              </Link>
            )}
          </CardContent>
        </Card>
      )}

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
                const { hasWebsiteBookings, hasInternalBookings, hasExternalBookings } = getDayIndicators(day);
                
                return (
                  <div
                    key={day.toISOString()}
                    className={`min-h-[160px] border rounded-lg p-2 ${
                      isToday ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    {/* Badges indicadores */}
                    {(hasWebsiteBookings || hasInternalBookings || hasExternalBookings) && (
                      <div className="flex gap-1 mb-1 flex-wrap">
                        {hasWebsiteBookings && (
                          <div className="px-1.5 py-0.5 rounded-full bg-green-500 text-white text-[10px] font-medium">
                            WEB
                          </div>
                        )}
                        {hasInternalBookings && (
                          <div className="px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-medium">
                            INT
                          </div>
                        )}
                        {hasExternalBookings && (
                          <div className="px-1.5 py-0.5 rounded-full bg-purple-500 text-white text-[10px] font-medium">
                            EXT
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className={`text-sm font-medium mb-1 ${isToday ? "text-primary" : ""}`}>
                      {format(day, "d")}
                    </div>
                    <div className="space-y-1">
                      {events.slice(0, 5).map((event) => {
                        const OriginIcon = event.bookingOrigin ? bookingOriginColors[event.bookingOrigin]?.icon : null;
                        
                        return (
                          <Link
                            key={event.id}
                            to={event.linkTo}
                            className={`block p-1 rounded text-xs ${event.color} text-primary-foreground truncate hover:opacity-90 transition-opacity`}
                            title={`${event.title} - ${event.subtitle}${event.bookingOrigin ? ` (${event.bookingOrigin})` : ""}`}
                          >
                            <div className="flex items-center gap-1">
                              {OriginIcon && <OriginIcon className="h-3 w-3 flex-shrink-0" />}
                              <span className="font-medium">{event.time}</span>
                              <span className="truncate">{event.title}</span>
                            </div>
                          </Link>
                        );
                      })}
                      {events.length > 5 && (
                        <div className="text-xs text-muted-foreground">
                          +{events.length - 5} more
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
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4">
              <span className="text-sm font-medium">Booking Status:</span>
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
            <div className="flex flex-wrap gap-4">
              <span className="text-sm font-medium">Booking Origin:</span>
              {Object.entries(bookingOriginColors).map(([origin, config]) => {
                const Icon = config.icon;
                return (
                  <div key={origin} className="flex items-center gap-1">
                    <Icon className="h-3 w-3" />
                    <span className="text-xs capitalize">{origin}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Internal Booking Wizard */}
      <InternalBookingWizard open={internalBookingOpen} onOpenChange={setInternalBookingOpen} />
      
      {/* External Booking Wizard */}
      <ExternalBookingWizard open={externalBookingOpen} onOpenChange={setExternalBookingOpen} />
    </div>
  );
}
