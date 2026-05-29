import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  CalendarIcon, 
  Sparkles, 
  Filter, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  User, 
  Image as ImageIcon,
  Download,
  Eye,
  FileText,
  AlertTriangle,
  Package
} from "lucide-react";
import { 
  useCleaningReports, 
  useStaffMembers, 
  type CleaningReport,
  type Booking
} from "@/hooks/useAdminData";
import { format } from "date-fns";

const cleaningStatuses = ["pending", "in_progress", "completed", "approved"];

const statusConfig: Record<string, { color: string; icon: React.ReactNode }> = {
  pending: { color: "bg-muted text-muted-foreground", icon: <Clock className="h-4 w-4" /> },
  in_progress: { color: "bg-chart-2/20 text-chart-2", icon: <Clock className="h-4 w-4" /> },
  completed: { color: "bg-chart-1/20 text-chart-1", icon: <CheckCircle2 className="h-4 w-4" /> },
  approved: { color: "bg-primary/20 text-primary", icon: <CheckCircle2 className="h-4 w-4" /> },
};

const checklistItems = [
  { key: "clean_check_floors", label: "Floors swept/mopped" },
  { key: "clean_check_bathrooms", label: "Bathrooms cleaned" },
  { key: "clean_check_kitchen", label: "Kitchen cleaned" },
  { key: "clean_check_trash_removed", label: "Trash removed" },
  { key: "clean_check_equipment_stored", label: "Equipment stored" },
  { key: "clean_check_tables_chairs_positioned", label: "Tables/Chairs positioned" },
  { key: "clean_check_lights_off", label: "Lights off" },
  { key: "clean_check_office_door_closed", label: "Office door closed" },
  { key: "clean_check_door_locked", label: "Front door locked" },
  { key: "clean_check_deep_cleaning_done", label: "Deep cleaning done" },
];

const mediaFields = [
  { key: "media_front_door", label: "Front Door" },
  { key: "media_main_area", label: "Main Area" },
  { key: "media_rack", label: "Tables/Chairs Rack" },
  { key: "media_bathrooms", label: "Bathrooms" },
  { key: "media_kitchen", label: "Kitchen" },
  { key: "media_deep_cleaning", label: "Deep Cleaning" },
];

export default function Cleaning() {
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [statusFilter, setStatusFilter] = useState("");
  const [cleanerFilter, setCleanerFilter] = useState("");
  const [selectedReport, setSelectedReport] = useState<(CleaningReport & { bookings: Booking }) | null>(null);

  const { data: cleaningReports, isLoading } = useCleaningReports({
    dateFrom: dateFrom ? format(dateFrom, "yyyy-MM-dd") : undefined,
    dateTo: dateTo ? format(dateTo, "yyyy-MM-dd") : undefined,
    status: statusFilter && statusFilter !== "all" ? statusFilter : undefined,
    cleanerId: cleanerFilter && cleanerFilter !== "all" ? cleanerFilter : undefined,
  });

  const { data: staffMembers } = useStaffMembers({ role: "cleaner", isActive: true });

  const getMediaUrls = (report: CleaningReport, field: string): string[] => {
    const value = report[field as keyof CleaningReport];
    if (Array.isArray(value)) return value as string[];
    return [];
  };

  const getTotalMediaCount = (report: CleaningReport): number => {
    return mediaFields.reduce((count, field) => {
      return count + getMediaUrls(report, field.key).length;
    }, 0);
  };

  const getChecklistProgress = (report: CleaningReport): { completed: number; total: number } => {
    const completed = checklistItems.filter(
      item => report[item.key as keyof CleaningReport] === true
    ).length;
    return { completed, total: checklistItems.length };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Cleaning Management</h1>
        <Badge variant="outline" className="text-sm">
          {cleaningReports?.length || 0} reports
        </Badge>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Date From</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateFrom ? format(dateFrom, "MM/dd/yyyy") : "Select"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={dateFrom}
                    onSelect={setDateFrom}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Date To</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateTo ? format(dateTo, "MM/dd/yyyy") : "Select"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={setDateTo}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {cleaningStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Cleaner</label>
              <Select value={cleanerFilter} onValueChange={setCleanerFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All cleaners" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cleaners</SelectItem>
                  {staffMembers?.map((staff) => (
                    <SelectItem key={staff.id} value={staff.id}>
                      {staff.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cleaning Reports Grid */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading reports...</div>
      ) : cleaningReports?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Sparkles className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No cleaning reports found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cleaningReports?.map((report) => {
            const booking = report.bookings as Booking;
            const cleaner = staffMembers?.find((s) => s.id === report.cleaner_id);
            const status = statusConfig[report.status] || statusConfig.pending;
            const mediaCount = getTotalMediaCount(report);
            const checklist = getChecklistProgress(report);
            const inventoryItems = Array.isArray(report.inventory_items) ? report.inventory_items : [];
            const hasIssues = report.clean_issues_notes || report.inventory_update_needed;

            return (
              <Card key={report.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <Link 
                        to={`/admin/bookings/${booking?.id}`} 
                        className="font-semibold text-foreground hover:underline"
                      >
                        {booking?.full_name || "Unknown"}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {booking?.event_date ? format(new Date(booking.event_date + 'T00:00:00'), "MM/dd/yyyy") : "-"}
                      </p>
                    </div>
                    <Badge className={status.color}>
                      <span className="flex items-center gap-1">
                        {status.icon}
                        {report.status}
                      </span>
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Event Info */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <CalendarIcon className="h-4 w-4" />
                      {booking?.event_type || "-"}
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <User className="h-4 w-4" />
                      {report.cleaner_name || cleaner?.full_name || "Unassigned"}
                    </div>
                  </div>

                  {/* Progress Indicators */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{mediaCount} photos</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{checklist.completed}/{checklist.total} tasks</span>
                    </div>
                  </div>

                  {/* Issues Alert */}
                  {hasIssues && (
                    <div className="flex items-center gap-2 p-2 rounded-md bg-destructive/10 text-destructive text-sm">
                      <AlertTriangle className="h-4 w-4" />
                      {report.inventory_update_needed ? "Inventory needs update" : "Issues reported"}
                    </div>
                  )}

                  {/* Action Button */}
                  <Button 
                    variant="outline" 
                    className="w-full"
                    onClick={() => setSelectedReport(report)}
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    View Report
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* View Report Dialog */}
      <Dialog open={!!selectedReport} onOpenChange={(open) => !open && setSelectedReport(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Cleaning Report Details
            </DialogTitle>
          </DialogHeader>
          {selectedReport && (
            <ScrollArea className="max-h-[70vh] pr-4">
              <div className="space-y-6">
                {/* Header Info */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-lg bg-muted/50">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Booking</p>
                    <Link 
                      to={`/admin/bookings/${(selectedReport.bookings as Booking)?.id}`}
                      className="font-medium hover:underline"
                    >
                      {(selectedReport.bookings as Booking)?.full_name}
                    </Link>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Event Date</p>
                    <p className="font-medium">
                      {(selectedReport.bookings as Booking)?.event_date
                        ? format(new Date((selectedReport.bookings as Booking).event_date + 'T00:00:00'), "MM/dd/yyyy")
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Cleaner</p>
                    <p className="font-medium">{selectedReport.cleaner_name || "Not specified"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Completed</p>
                    <p className="font-medium">
                      {selectedReport.completed_at 
                        ? format(new Date(selectedReport.completed_at), "MM/dd/yyyy h:mm a")
                        : "Not completed"}
                    </p>
                  </div>
                </div>

                {/* Checklist */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Cleaning Checklist
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {checklistItems.map((item) => {
                      const isChecked = selectedReport[item.key as keyof CleaningReport] === true;
                      return (
                        <div key={item.key} className="flex items-center gap-2 text-sm">
                          {isChecked ? (
                            <CheckCircle2 className="h-4 w-4 text-chart-1" />
                          ) : (
                            <XCircle className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className={isChecked ? "text-foreground" : "text-muted-foreground"}>
                            {item.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Media Uploads */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <ImageIcon className="h-4 w-4" />
                    Uploaded Media
                  </h3>
                  <div className="space-y-4">
                    {mediaFields.map((field) => {
                      const urls = getMediaUrls(selectedReport, field.key);
                      if (urls.length === 0) return null;
                      return (
                        <div key={field.key}>
                          <p className="text-sm text-muted-foreground mb-2">{field.label}</p>
                          <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                            {urls.map((url, idx) => (
                              <div key={idx} className="relative group">
                                <img
                                  src={url}
                                  alt={`${field.label} ${idx + 1}`}
                                  className="w-full h-24 object-cover rounded-md border border-border"
                                />
                                <div className="absolute inset-0 bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 rounded-md">
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => window.open(url, '_blank')}
                                  >
                                    <Eye className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    asChild
                                  >
                                    <a href={url} download target="_blank" rel="noopener noreferrer">
                                      <Download className="h-3 w-3" />
                                    </a>
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {mediaFields.every(f => getMediaUrls(selectedReport, f.key).length === 0) && (
                      <p className="text-sm text-muted-foreground">No media uploaded</p>
                    )}
                  </div>
                </div>

                {/* Inventory */}
                {Array.isArray(selectedReport.inventory_items) && selectedReport.inventory_items.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Package className="h-4 w-4" />
                      Inventory / Supplies Used
                      {selectedReport.inventory_update_needed && (
                        <Badge variant="destructive" className="ml-2">Needs Restock</Badge>
                      )}
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-2 font-medium">Item</th>
                            <th className="text-center py-2 font-medium">Qty Used</th>
                            <th className="text-center py-2 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selectedReport.inventory_items as Array<{ item_name: string; status: string; qty_used?: string }>).map((item, idx) => (
                            <tr key={idx} className="border-b border-border/50">
                              <td className="py-2">{item.item_name}</td>
                              <td className="py-2 text-center">{item.qty_used || "-"}</td>
                              <td className="py-2 text-center">
                                <Badge variant={item.status === 'stocked' ? 'default' : item.status === 'low' ? 'secondary' : 'destructive'}>
                                  {item.status}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Notes */}
                {selectedReport.clean_issues_notes && (
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      Issues / Notes
                    </h3>
                    <div className="p-3 rounded-md bg-destructive/10 text-sm">
                      {selectedReport.clean_issues_notes}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
