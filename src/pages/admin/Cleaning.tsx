import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Sparkles, Filter } from "lucide-react";
import { 
  useCleaningReports, 
  useStaffMembers, 
  useUpdateCleaningReport,
  type CleaningReport,
  type Booking
} from "@/hooks/useAdminData";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const cleaningStatuses = ["pending", "in_progress", "completed", "approved"];

export default function Cleaning() {
  const { toast } = useToast();
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
  const updateCleaningReport = useUpdateCleaningReport();

  const handleUpdateReport = async (id: string, updates: Partial<CleaningReport>) => {
    try {
      await updateCleaningReport.mutateAsync({ id, updates });
      toast({ title: "Report updated" });
    } catch {
      toast({ title: "Failed to update report", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Cleaning Management</h1>

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
                    {dateFrom ? format(dateFrom, "PP") : "Select"}
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
                    {dateTo ? format(dateTo, "PP") : "Select"}
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

      {/* Cleaning Reports Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Cleaning Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : cleaningReports?.length === 0 ? (
            <p className="text-muted-foreground">No cleaning reports found</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event Date</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Event Type</TableHead>
                    <TableHead>Cleaner</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cleaningReports?.map((report) => {
                    const booking = report.bookings as Booking;
                    const cleaner = staffMembers?.find((s) => s.id === report.cleaner_id);
                    return (
                      <TableRow key={report.id}>
                        <TableCell>
                          <Link to={`/admin/bookings/${booking?.id}`} className="hover:underline">
                            {booking?.event_date ? format(new Date(booking.event_date), "MMM d, yyyy") : "-"}
                          </Link>
                        </TableCell>
                        <TableCell className="font-medium">
                          <Link to={`/admin/bookings/${booking?.id}`} className="hover:underline">
                            {booking?.full_name || "-"}
                          </Link>
                        </TableCell>
                        <TableCell>{booking?.event_type || "-"}</TableCell>
                        <TableCell>{cleaner?.full_name || "Unassigned"}</TableCell>
                        <TableCell>
                          {report.scheduled_start
                            ? format(new Date(report.scheduled_start), "PPp")
                            : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              report.status === "approved"
                                ? "default"
                                : report.status === "completed"
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {report.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedReport(report)}
                          >
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!selectedReport} onOpenChange={(open) => !open && setSelectedReport(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Cleaning Report</DialogTitle>
          </DialogHeader>
          {selectedReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Booking</label>
                  <p className="mt-1">
                    {(selectedReport.bookings as Booking)?.full_name} -{" "}
                    {(selectedReport.bookings as Booking)?.event_date
                      ? format(new Date((selectedReport.bookings as Booking).event_date), "PPP")
                      : "-"}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium">Status</label>
                  <Select
                    value={selectedReport.status}
                    onValueChange={(value) =>
                      handleUpdateReport(selectedReport.id, { status: value })
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {cleaningStatuses.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Cleaner</label>
                <Select
                  value={selectedReport.cleaner_id || "unassigned"}
                  onValueChange={(value) =>
                    handleUpdateReport(selectedReport.id, { cleaner_id: value === "unassigned" ? null : value })
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Assign cleaner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {staffMembers?.map((staff) => (
                      <SelectItem key={staff.id} value={staff.id}>
                        {staff.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {["floors_clean", "restrooms_clean", "trash_removed", "surfaces_clean", "damage_found"].map(
                  (field) => (
                    <div key={field} className="flex items-center gap-2">
                      <Checkbox
                        checked={(selectedReport[field as keyof CleaningReport] as boolean) || false}
                        onCheckedChange={(checked) =>
                          handleUpdateReport(selectedReport.id, { [field]: checked })
                        }
                      />
                      <label className="text-sm capitalize">{field.replace(/_/g, " ")}</label>
                    </div>
                  )
                )}
              </div>

              {selectedReport.damage_found && (
                <div>
                  <label className="text-sm font-medium">Damage Notes</label>
                  <Textarea
                    className="mt-1"
                    placeholder="Describe the damage..."
                    value={selectedReport.damage_notes || ""}
                    onChange={(e) =>
                      handleUpdateReport(selectedReport.id, { damage_notes: e.target.value })
                    }
                  />
                </div>
              )}

              <div className="flex gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() =>
                    handleUpdateReport(selectedReport.id, {
                      started_at: new Date().toISOString(),
                      status: "in_progress",
                    })
                  }
                >
                  Mark Started
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    handleUpdateReport(selectedReport.id, {
                      completed_at: new Date().toISOString(),
                      status: "completed",
                    })
                  }
                >
                  Mark Completed
                </Button>
                <Button
                  onClick={() => handleUpdateReport(selectedReport.id, { status: "approved" })}
                >
                  Approve
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
