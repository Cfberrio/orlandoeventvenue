import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
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

export default function StandaloneAssignmentModal({
  isOpen,
  onClose,
  onSuccess,
}: StandaloneAssignmentModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [formData, setFormData] = useState({
    staff_id: "",
    scheduled_date: "",
    scheduled_start_time: "",
    scheduled_end_time: "",
    cleaning_type: "regular",
    celebration_surcharge: "0",
    notes: "",
    status: "assigned",
  });
  const [previewAmount, setPreviewAmount] = useState<number>(0);

  const { toast } = useToast();
  const { createStandaloneAssignment } = usePayrollData();

  // Load staff members (Custodial and Assistant only)
  useEffect(() => {
    const loadStaff = async () => {
      const { data, error } = await supabase
        .from('staff_members')
        .select('id, full_name, role')
        .in('role', ['Custodial', 'Assistant'])
        .eq('is_active', true)
        .order('full_name');

      if (!error && data) {
        setStaffMembers(data);
      }
    };

    if (isOpen) {
      loadStaff();
    }
  }, [isOpen]);

  // Calculate preview amount
  useEffect(() => {
    const baseRates: Record<string, number> = {
      touch_up: 40,
      regular: 80,
      deep: 150,
    };
    
    const base = baseRates[formData.cleaning_type] || 0;
    const surcharge = parseFloat(formData.celebration_surcharge) || 0;
    setPreviewAmount(base + surcharge);
  }, [formData.cleaning_type, formData.celebration_surcharge]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validations
    if (!formData.staff_id) {
      toast({
        title: "Validation Error",
        description: "Please select a staff member",
        variant: "destructive",
      });
      return;
    }
    
    if (!formData.scheduled_date) {
      toast({
        title: "Validation Error",
        description: "Please select a date",
        variant: "destructive",
      });
      return;
    }

    const surcharge = parseFloat(formData.celebration_surcharge);
    if (surcharge < 0 || surcharge > 70) {
      toast({
        title: "Validation Error",
        description: "Celebration surcharge must be between $0 and $70",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await createStandaloneAssignment({
        staff_id: formData.staff_id,
        scheduled_date: formData.scheduled_date,
        scheduled_start_time: formData.scheduled_start_time || undefined,
        scheduled_end_time: formData.scheduled_end_time || undefined,
        cleaning_type: formData.cleaning_type as 'touch_up' | 'regular' | 'deep',
        celebration_surcharge: surcharge,
        notes: formData.notes || undefined,
        status: formData.status as 'assigned' | 'in_progress' | 'completed',
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      onSuccess();
      
      // Reset form
      setFormData({
        staff_id: "",
        scheduled_date: "",
        scheduled_start_time: "",
        scheduled_end_time: "",
        cleaning_type: "regular",
        celebration_surcharge: "0",
        notes: "",
        status: "assigned",
      });
    } catch (error: any) {
      console.error('Error creating standalone assignment:', error);
      toast({
        title: "Creation Failed",
        description: error.message || "Failed to create standalone assignment",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Standalone Assignment</DialogTitle>
          <DialogDescription>
            Create a custodial assignment not linked to a booking
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Staff Member */}
            <div className="space-y-2">
              <Label htmlFor="staff_id">Staff Member *</Label>
              <Select
                value={formData.staff_id}
                onValueChange={(value) => setFormData({ ...formData, staff_id: value })}
              >
                <SelectTrigger id="staff_id">
                  <SelectValue placeholder="Select staff member" />
                </SelectTrigger>
                <SelectContent>
                  {staffMembers.map((staff) => (
                    <SelectItem key={staff.id} value={staff.id}>
                      {staff.full_name} ({staff.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date */}
            <div className="space-y-2">
              <Label htmlFor="scheduled_date">Date *</Label>
              <Input
                id="scheduled_date"
                type="date"
                value={formData.scheduled_date}
                onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                required
              />
            </div>

            {/* Time Range */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="scheduled_start_time">Start Time</Label>
                <Input
                  id="scheduled_start_time"
                  type="time"
                  value={formData.scheduled_start_time}
                  onChange={(e) => setFormData({ ...formData, scheduled_start_time: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scheduled_end_time">End Time</Label>
                <Input
                  id="scheduled_end_time"
                  type="time"
                  value={formData.scheduled_end_time}
                  onChange={(e) => setFormData({ ...formData, scheduled_end_time: e.target.value })}
                />
              </div>
            </div>

            {/* Cleaning Type */}
            <div className="space-y-2">
              <Label htmlFor="cleaning_type">Cleaning Type *</Label>
              <Select
                value={formData.cleaning_type}
                onValueChange={(value) => setFormData({ ...formData, cleaning_type: value })}
              >
                <SelectTrigger id="cleaning_type">
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
            <div className="space-y-2">
              <Label htmlFor="celebration_surcharge">
                Celebration Surcharge ($0-$70)
              </Label>
              <Input
                id="celebration_surcharge"
                type="number"
                min="0"
                max="70"
                step="0.01"
                value={formData.celebration_surcharge}
                onChange={(e) => setFormData({ ...formData, celebration_surcharge: e.target.value })}
              />
            </div>

            {/* Status */}
            <div className="space-y-2">
              <Label htmlFor="status">Status *</Label>
              <Select
                value={formData.status}
                onValueChange={(value) => setFormData({ ...formData, status: value })}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
              {formData.status === 'completed' && (
                <p className="text-sm text-muted-foreground">
                  Payroll will be calculated automatically when set to completed
                </p>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="E.g., Pre-clean before weekend bookings"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
              />
            </div>

            {/* Preview */}
            <div className="rounded-lg border bg-muted/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Estimated Payment:</span>
                <span className="text-2xl font-bold">
                  ${previewAmount.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Assignment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
