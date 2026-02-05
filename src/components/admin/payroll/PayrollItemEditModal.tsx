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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePayrollData, PayrollLineItem } from "@/hooks/usePayrollData";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

interface PayrollItemEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  item: PayrollLineItem;
}

export default function PayrollItemEditModal({
  isOpen,
  onClose,
  onSuccess,
  item,
}: PayrollItemEditModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("edit");
  const [assignmentData, setAssignmentData] = useState<any>(null);
  const { toast } = useToast();
  const { updateAssignment, recalculatePayroll, addBonus, addDeduction } = usePayrollData();

  // Edit form state
  const [editForm, setEditForm] = useState({
    hours_worked: "",
    cleaning_type: "",
    celebration_surcharge: "0",
  });

  // Bonus form state
  const [bonusForm, setBonusForm] = useState({
    amount: "",
    description: "",
  });

  // Deduction form state
  const [deductionForm, setDeductionForm] = useState({
    amount: "",
    description: "",
  });

  // Load full assignment data
  useEffect(() => {
    const loadAssignmentData = async () => {
      // Find staff_id first from staff_members by name
      const { data: staffData } = await supabase
        .from('staff_members')
        .select('id')
        .eq('full_name', item.staff_name)
        .single();

      if (!staffData) return;

      // Find the assignment by staff_id and scheduled_date
      const { data: assignment } = await supabase
        .from('booking_staff_assignments')
        .select('*')
        .eq('staff_id', staffData.id)
        .eq('scheduled_date', item.assignment_date)
        .limit(1)
        .single();

      if (assignment) {
        setAssignmentData(assignment);
        
        // Populate edit form
        setEditForm({
          hours_worked: assignment.hours_worked?.toString() || "",
          cleaning_type: assignment.cleaning_type || "",
          celebration_surcharge: assignment.celebration_surcharge?.toString() || "0",
        });
      }
    };

    if (isOpen) {
      loadAssignmentData();
    }
  }, [isOpen, item]);

  const handleEdit = async () => {
    if (!assignmentData) {
      toast({
        title: "Error",
        description: "Assignment data not loaded",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const updates: any = {};

      // For hourly staff (Production)
      if (item.payroll_type === 'hourly' && editForm.hours_worked) {
        const hours = parseFloat(editForm.hours_worked);
        if (hours <= 0) {
          throw new Error("Hours worked must be greater than 0");
        }
        updates.hours_worked = hours;
      }

      // For per-assignment staff (Custodial/Assistant)
      if (item.payroll_type === 'per_assignment') {
        if (editForm.cleaning_type) {
          updates.cleaning_type = editForm.cleaning_type;
        }
        
        const surcharge = parseFloat(editForm.celebration_surcharge);
        if (surcharge < 0 || surcharge > 70) {
          throw new Error("Celebration surcharge must be between $0 and $70");
        }
        updates.celebration_surcharge = surcharge;
      }

      // Update assignment
      const updateResult = await updateAssignment(assignmentData.id, updates);
      if (updateResult.error) {
        throw new Error("Failed to update assignment");
      }

      // Recalculate payroll
      const recalcResult = await recalculatePayroll(assignmentData.id);
      if (!recalcResult.success) {
        throw new Error("Failed to recalculate payroll");
      }

      toast({
        title: "Update Successful",
        description: "Payroll has been recalculated",
      });

      onSuccess();
    } catch (error: any) {
      console.error('Error updating payroll:', error);
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update payroll",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddBonus = async () => {
    if (!assignmentData) return;

    const amount = parseFloat(bonusForm.amount);
    if (amount <= 0) {
      toast({
        title: "Validation Error",
        description: "Bonus amount must be greater than 0",
        variant: "destructive",
      });
      return;
    }

    if (!bonusForm.description.trim()) {
      toast({
        title: "Validation Error",
        description: "Please provide a description for the bonus",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Get staff_id from assignment
      const staffId = assignmentData.staff_id;
      
      const result = await addBonus(
        assignmentData.id,
        staffId,
        amount,
        bonusForm.description
      );

      if (!result.success) {
        throw new Error("Failed to add bonus");
      }

      toast({
        title: "Bonus Added",
        description: `$${amount.toFixed(2)} bonus has been added`,
      });

      setBonusForm({ amount: "", description: "" });
      onSuccess();
    } catch (error: any) {
      toast({
        title: "Failed to Add Bonus",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddDeduction = async () => {
    if (!assignmentData) return;

    const amount = parseFloat(deductionForm.amount);
    if (amount <= 0) {
      toast({
        title: "Validation Error",
        description: "Deduction amount must be greater than 0",
        variant: "destructive",
      });
      return;
    }

    if (!deductionForm.description.trim()) {
      toast({
        title: "Validation Error",
        description: "Please provide a description for the deduction",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const staffId = assignmentData.staff_id;
      
      const result = await addDeduction(
        assignmentData.id,
        staffId,
        amount,
        deductionForm.description
      );

      if (!result.success) {
        throw new Error("Failed to add deduction");
      }

      toast({
        title: "Deduction Added",
        description: `$${amount.toFixed(2)} deduction has been applied`,
      });

      setDeductionForm({ amount: "", description: "" });
      onSuccess();
    } catch (error: any) {
      toast({
        title: "Failed to Add Deduction",
        description: error.message,
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
          <DialogTitle>Edit Payroll Item</DialogTitle>
          <DialogDescription>
            {item.staff_name} - {item.assignment_date}
          </DialogDescription>
        </DialogHeader>

        {/* Current Info */}
        <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Current Amount:</span>
            <span className="text-lg font-bold">${Number(item.amount).toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Pay Category:</span>
            <Badge>{item.pay_category.replace(/_/g, ' ')}</Badge>
          </div>
          {item.hours && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Hours:</span>
              <span>{Number(item.hours).toFixed(2)}</span>
            </div>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="bonus">Add Bonus</TabsTrigger>
            <TabsTrigger value="deduction">Add Deduction</TabsTrigger>
          </TabsList>

          {/* Edit Tab */}
          <TabsContent value="edit" className="space-y-4">
            {item.payroll_type === 'hourly' ? (
              <div className="space-y-2">
                <Label htmlFor="hours_worked">Hours Worked</Label>
                <Input
                  id="hours_worked"
                  type="number"
                  step="0.01"
                  min="0"
                  value={editForm.hours_worked}
                  onChange={(e) => setEditForm({ ...editForm, hours_worked: e.target.value })}
                />
                <p className="text-sm text-muted-foreground">
                  Rate: ${item.rate ? Number(item.rate).toFixed(2) : '0.00'}/hr
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="cleaning_type">Cleaning Type</Label>
                  <Select
                    value={editForm.cleaning_type}
                    onValueChange={(value) => setEditForm({ ...editForm, cleaning_type: value })}
                  >
                    <SelectTrigger id="cleaning_type">
                      <SelectValue placeholder="Select cleaning type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="touch_up">Touch Up ($40)</SelectItem>
                      <SelectItem value="regular">Regular ($80)</SelectItem>
                      <SelectItem value="deep">Deep Cleaning ($150)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="celebration_surcharge">Celebration Surcharge ($0-$70)</Label>
                  <Input
                    id="celebration_surcharge"
                    type="number"
                    step="0.01"
                    min="0"
                    max="70"
                    value={editForm.celebration_surcharge}
                    onChange={(e) => setEditForm({ ...editForm, celebration_surcharge: e.target.value })}
                  />
                </div>
              </>
            )}

            <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950 p-3 flex gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                Updating these values will recalculate the payroll for this assignment
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button onClick={handleEdit} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update & Recalculate
              </Button>
            </DialogFooter>
          </TabsContent>

          {/* Bonus Tab */}
          <TabsContent value="bonus" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bonus_amount">Bonus Amount</Label>
              <Input
                id="bonus_amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={bonusForm.amount}
                onChange={(e) => setBonusForm({ ...bonusForm, amount: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bonus_description">Description</Label>
              <Textarea
                id="bonus_description"
                placeholder="E.g., Exceptional service, holiday bonus"
                value={bonusForm.description}
                onChange={(e) => setBonusForm({ ...bonusForm, description: e.target.value })}
                rows={3}
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button onClick={handleAddBonus} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Bonus
              </Button>
            </DialogFooter>
          </TabsContent>

          {/* Deduction Tab */}
          <TabsContent value="deduction" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="deduction_amount">Deduction Amount</Label>
              <Input
                id="deduction_amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={deductionForm.amount}
                onChange={(e) => setDeductionForm({ ...deductionForm, amount: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="deduction_description">Description</Label>
              <Textarea
                id="deduction_description"
                placeholder="E.g., Damaged equipment, late arrival penalty"
                value={deductionForm.description}
                onChange={(e) => setDeductionForm({ ...deductionForm, description: e.target.value })}
                rows={3}
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button 
                onClick={handleAddDeduction} 
                disabled={isSubmitting}
                variant="destructive"
              >
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Deduction
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
