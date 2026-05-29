import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CalendarIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { usePayrollData } from "@/hooks/usePayrollData";
import { supabase } from "@/integrations/supabase/client";

interface StandaloneAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface StaffMember {
  id: string;
  full_name: string;
  role: string;
}

const CLEANING_RATES: Record<string, number> = {
  touch_up: 40,
  regular: 80,
  deep: 150,
};

const initialFormState = {
  staff_id: "",
  scheduled_date: "",
  scheduled_start_time: "",
  scheduled_end_time: "",
  cleaning_type: "regular",
  celebration_surcharge: "0",
  notes: "",
  status: "assigned",
};

export default function StandaloneAssignmentModal({
  isOpen,
  onClose,
  onSuccess,
}: StandaloneAssignmentModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [formData, setFormData] = useState(initialFormState);

  const { toast } = useToast();
  const { createStandaloneAssignment } = usePayrollData();

  const surchargeNum = parseFloat(formData.celebration_surcharge) || 0;
  const baseRate = CLEANING_RATES[formData.cleaning_type] || 0;
  const estimatedTotal = baseRate + surchargeNum;

  useEffect(() => {
    if (!isOpen) return;
    const loadStaff = async () => {
      const { data } = await supabase
        .from("staff_members")
        .select("id, full_name, role")
        .in("role", ["Custodial", "Assistant"])
        .eq("is_active", true)
        .order("full_name");
      if (data) setStaffMembers(data);
    };
    loadStaff();
  }, [isOpen]);

  const update = (field: string, value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async () => {
    if (!formData.staff_id) {
      toast({ title: "Error", description: "Select a staff member", variant: "destructive" });
      return;
    }
    if (!formData.scheduled_date) {
      toast({ title: "Error", description: "Select a date", variant: "destructive" });
      return;
    }
    if (surchargeNum < 0 || surchargeNum > 70) {
      toast({ title: "Error", description: "Surcharge must be $0–$70", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createStandaloneAssignment({
        staff_id: formData.staff_id,
        scheduled_date: formData.scheduled_date,
        scheduled_start_time: formData.scheduled_start_time || undefined,
        scheduled_end_time: formData.scheduled_end_time || undefined,
        cleaning_type: formData.cleaning_type as "touch_up" | "regular" | "deep",
        celebration_surcharge: surchargeNum,
        notes: formData.notes || undefined,
        status: formData.status as "assigned" | "in_progress" | "completed",
      });

      if (result.error) throw new Error(result.error.message);

      setFormData(initialFormState);
      onSuccess();
    } catch (error: any) {
      toast({
        title: "Creation Failed",
        description: error.message || "Failed to create assignment",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Standalone Assignment</DialogTitle>
          <DialogDescription>
            Custodial assignment not linked to a booking
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Staff Member */}
          <div className="grid gap-1.5">
            <Label>Staff Member *</Label>
            <Select value={formData.staff_id} onValueChange={(v) => update("staff_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select staff member" />
              </SelectTrigger>
              <SelectContent>
                {staffMembers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.full_name} ({s.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date */}
          <div className="grid gap-1.5">
            <Label>Date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {formData.scheduled_date
                    ? format(parseISO(formData.scheduled_date + "T00:00:00"), "MM/dd/yyyy")
                    : "Select date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={formData.scheduled_date ? parseISO(formData.scheduled_date + "T00:00:00") : undefined}
                  onSelect={(d) => d && update("scheduled_date", format(d, "yyyy-MM-dd"))}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Time Range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Start Time</Label>
              <Input
                type="time"
                value={formData.scheduled_start_time}
                onChange={(e) => update("scheduled_start_time", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>End Time</Label>
              <Input
                type="time"
                value={formData.scheduled_end_time}
                onChange={(e) => update("scheduled_end_time", e.target.value)}
              />
            </div>
          </div>

          {/* Cleaning Type */}
          <div className="grid gap-1.5">
            <Label>Cleaning Type *</Label>
            <Select value={formData.cleaning_type} onValueChange={(v) => update("cleaning_type", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="touch_up">Touch Up ($40)</SelectItem>
                <SelectItem value="regular">Regular ($80)</SelectItem>
                <SelectItem value="deep">Deep Cleaning ($150)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Celebration Surcharge */}
          <div className="grid gap-1.5">
            <Label>Celebration Surcharge ($0–$70)</Label>
            <Input
              type="number"
              min="0"
              max="70"
              step="1"
              value={formData.celebration_surcharge}
              onChange={(e) => update("celebration_surcharge", e.target.value)}
            />
          </div>

          {/* Status */}
          <div className="grid gap-1.5">
            <Label>Status *</Label>
            <Select value={formData.status} onValueChange={(v) => update("status", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
            {formData.status === "completed" && (
              <p className="text-xs text-muted-foreground">
                Payroll will be calculated automatically
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="grid gap-1.5">
            <Label>Notes</Label>
            <Textarea
              placeholder="E.g., Pre-clean before weekend bookings"
              value={formData.notes}
              onChange={(e) => update("notes", e.target.value)}
              rows={2}
            />
          </div>

          {/* Estimated Payment */}
          <div className="rounded-md border bg-muted/50 p-3 flex items-center justify-between">
            <span className="text-sm font-medium">Estimated Payment</span>
            <span className="text-xl font-bold">${estimatedTotal.toFixed(2)}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Assignment
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
