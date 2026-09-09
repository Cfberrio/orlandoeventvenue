import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUpdateStaffAssignment, type StaffAssignment } from "@/hooks/useAdminData";
import { getAssignmentHours, isValidTimeRange, toTimeInputValue } from "@/lib/assignmentHours";

interface Props {
  assignment: StaffAssignment;
  bookingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function StaffHoursEditDialog({ assignment, bookingId, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const { mutateAsync, isPending } = useUpdateStaffAssignment();
  const [start, setStart] = useState(toTimeInputValue(assignment.scheduled_start_time));
  const [end, setEnd] = useState(toTimeInputValue(assignment.scheduled_end_time));

  // Reseed on open so a reopened dialog never shows a stale draft.
  useEffect(() => {
    if (open) {
      setStart(toTimeInputValue(assignment.scheduled_start_time));
      setEnd(toTimeInputValue(assignment.scheduled_end_time));
    }
  }, [open, assignment]);

  const inherited = getAssignmentHours({
    scheduledStartTime: null,
    scheduledEndTime: null,
    assignmentRole: assignment.assignment_role,
    packageName: assignment.booking?.package ?? null,
    packageStartTime: assignment.booking?.package_start_time ?? null,
    packageEndTime: assignment.booking?.package_end_time ?? null,
    bookingStartTime: assignment.booking?.start_time ?? null,
    bookingEndTime: assignment.booking?.end_time ?? null,
  });

  const save = async () => {
    if (!isValidTimeRange(start, end)) {
      toast({ title: "Invalid schedule", description: "The end time must be after the start time.", variant: "destructive" });
      return;
    }
    try {
      await mutateAsync({ id: assignment.id, bookingId, scheduledStartTime: start, scheduledEndTime: end });
      toast({ title: "Staff hours updated" });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Could not update", description: "Try again.", variant: "destructive" });
    }
  };

  const reset = async () => {
    try {
      await mutateAsync({ id: assignment.id, bookingId, scheduledStartTime: null, scheduledEndTime: null });
      toast({ title: "Hours reset to the event schedule" });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Could not reset", description: "Try again.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit staff hours</DialogTitle>
          <DialogDescription>Give this staff member their own schedule. Leave empty to inherit the event schedule.</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Inherited from the event: {inherited.start?.slice(0, 5)} to {inherited.end?.slice(0, 5)}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="staff-start">Start</Label>
            <Input id="staff-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="staff-end">End</Label>
            <Input id="staff-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={reset} disabled={isPending}>Reset</Button>
          <Button onClick={save} disabled={isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
