import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUpdateBookingTimes } from "@/hooks/useAdminData";
import { isValidTimeRange, toTimeInputValue } from "@/lib/assignmentHours";

interface Props {
  bookingId: string;
  startTime: string | null;
  endTime: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function EventHoursEditDialog({ bookingId, startTime, endTime, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const { mutateAsync, isPending } = useUpdateBookingTimes();
  const [start, setStart] = useState(toTimeInputValue(startTime));
  const [end, setEnd] = useState(toTimeInputValue(endTime));

  useEffect(() => {
    if (open) {
      setStart(toTimeInputValue(startTime));
      setEnd(toTimeInputValue(endTime));
    }
  }, [open, startTime, endTime]);

  const save = async () => {
    if (!isValidTimeRange(start, end)) {
      toast({ title: "Invalid schedule", description: "The end time must be after the start time.", variant: "destructive" });
      return;
    }
    try {
      await mutateAsync({ bookingId, startTime: start, endTime: end });
      toast({ title: "Event schedule updated" });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Could not update", description: "Try again.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit event schedule</DialogTitle>
          <DialogDescription>Change the event start and end time. This affects every staff member’s derived hours.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="event-start">Start</Label>
            <Input id="event-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-end">End</Label>
            <Input id="event-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
