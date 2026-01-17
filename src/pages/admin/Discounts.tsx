import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tag, Plus, Edit, Trash2, Info } from "lucide-react";
import { useDiscountCoupons, useCreateDiscountCoupon, useUpdateDiscountCoupon, useDeleteDiscountCoupon } from "@/hooks/useAdminData";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Hardcoded coupons for reference
const hardcodedCoupons = [
  { code: "CHRIS", type: "Percentage", value: "40%", appliesTo: "Hourly only", note: "Base rental discount" },
  { code: "NANO", type: "Percentage", value: "50%", appliesTo: "Hourly & Daily", note: "Base rental discount" },
  { code: "199", type: "Fixed Amount", value: "$199", appliesTo: "All", note: "Cleaning fee discount (special)" },
];

export default function Discounts() {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form state
  const [formCode, setFormCode] = useState("");
  const [formType, setFormType] = useState<"percentage" | "fixed_amount">("percentage");
  const [formValue, setFormValue] = useState("");
  const [formAppliesHourly, setFormAppliesHourly] = useState(true);
  const [formAppliesDaily, setFormAppliesDaily] = useState(true);
  const [formActive, setFormActive] = useState(true);

  const { data: coupons, isLoading } = useDiscountCoupons();
  const createCoupon = useCreateDiscountCoupon();
  const updateCoupon = useUpdateDiscountCoupon();
  const deleteCoupon = useDeleteDiscountCoupon();

  const resetForm = () => {
    setFormCode("");
    setFormType("percentage");
    setFormValue("");
    setFormAppliesHourly(true);
    setFormAppliesDaily(true);
    setFormActive(true);
  };

  const handleAdd = async () => {
    if (!formCode.trim()) {
      toast({ title: "Code is required", variant: "destructive" });
      return;
    }
    
    const value = parseFloat(formValue);
    if (!value || value <= 0) {
      toast({ title: "Valid discount value is required", variant: "destructive" });
      return;
    }

    if (!formAppliesHourly && !formAppliesDaily) {
      toast({ title: "Must apply to at least one booking type", variant: "destructive" });
      return;
    }

    try {
      await createCoupon.mutateAsync({
        code: formCode.trim(),
        discount_type: formType,
        discount_value: value,
        applies_to_hourly: formAppliesHourly,
        applies_to_daily: formAppliesDaily,
        is_active: formActive,
      });
      toast({ title: "Coupon created successfully" });
      setIsAddOpen(false);
      resetForm();
    } catch (error: any) {
      if (error.message?.includes("duplicate key")) {
        toast({ title: "Code already exists", variant: "destructive" });
      } else {
        toast({ title: "Failed to create coupon", variant: "destructive" });
      }
    }
  };

  const handleEdit = (coupon: any) => {
    setEditingCoupon(coupon.id);
    setFormCode(coupon.code);
    setFormType(coupon.discount_type);
    setFormValue(coupon.discount_value.toString());
    setFormAppliesHourly(coupon.applies_to_hourly);
    setFormAppliesDaily(coupon.applies_to_daily);
    setFormActive(coupon.is_active);
  };

  const handleUpdate = async () => {
    if (!editingCoupon) return;
    
    if (!formCode.trim()) {
      toast({ title: "Code is required", variant: "destructive" });
      return;
    }
    
    const value = parseFloat(formValue);
    if (!value || value <= 0) {
      toast({ title: "Valid discount value is required", variant: "destructive" });
      return;
    }

    if (!formAppliesHourly && !formAppliesDaily) {
      toast({ title: "Must apply to at least one booking type", variant: "destructive" });
      return;
    }

    try {
      await updateCoupon.mutateAsync({
        id: editingCoupon,
        updates: {
          code: formCode.trim(),
          discount_type: formType,
          discount_value: value,
          applies_to_hourly: formAppliesHourly,
          applies_to_daily: formAppliesDaily,
          is_active: formActive,
        },
      });
      toast({ title: "Coupon updated successfully" });
      setEditingCoupon(null);
      resetForm();
    } catch (error: any) {
      if (error.message?.includes("duplicate key")) {
        toast({ title: "Code already exists", variant: "destructive" });
      } else {
        toast({ title: "Failed to update coupon", variant: "destructive" });
      }
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    
    try {
      await deleteCoupon.mutateAsync(deleteConfirmId);
      toast({ title: "Coupon deleted successfully" });
      setDeleteConfirmId(null);
    } catch {
      toast({ title: "Failed to delete coupon", variant: "destructive" });
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      await updateCoupon.mutateAsync({
        id,
        updates: { is_active: !currentActive },
      });
      toast({ title: currentActive ? "Coupon deactivated" : "Coupon activated" });
    } catch {
      toast({ title: "Failed to update coupon", variant: "destructive" });
    }
  };

  const formatDiscountValue = (type: string, value: number) => {
    return type === "percentage" ? `${value}%` : `$${value}`;
  };

  const formatAppliesTo = (hourly: boolean, daily: boolean) => {
    if (hourly && daily) return "Hourly & Daily";
    if (hourly) return "Hourly only";
    if (daily) return "Daily only";
    return "None";
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Discount Coupons</h1>
          <p className="text-muted-foreground mt-1">
            Manage discount codes that apply to base rental costs
          </p>
        </div>
        <Dialog open={isAddOpen || editingCoupon !== null} onOpenChange={(open) => {
          if (!open) {
            setIsAddOpen(false);
            setEditingCoupon(null);
            resetForm();
          }
        }}>
          <DialogTrigger asChild>
            <Button onClick={() => setIsAddOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Coupon
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingCoupon ? "Edit Coupon" : "Create New Coupon"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="code">Code *</Label>
                <Input
                  id="code"
                  placeholder="e.g., SUMMER50"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                  disabled={editingCoupon !== null}
                />
                <p className="text-xs text-muted-foreground">Will be automatically converted to uppercase</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">Discount Type *</Label>
                <Select value={formType} onValueChange={(v: "percentage" | "fixed_amount") => setFormType(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage (e.g., 30% off)</SelectItem>
                    <SelectItem value="fixed_amount">Fixed Amount (e.g., $100 off)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="value">Discount Value *</Label>
                <Input
                  id="value"
                  type="number"
                  min="1"
                  step={formType === "percentage" ? "1" : "0.01"}
                  placeholder={formType === "percentage" ? "e.g., 30" : "e.g., 100"}
                  value={formValue}
                  onChange={(e) => setFormValue(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {formType === "percentage" ? "Enter percentage without % symbol" : "Enter dollar amount"}
                </p>
              </div>

              <div className="space-y-3">
                <Label>Applies To * (select at least one)</Label>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="hourly"
                    checked={formAppliesHourly}
                    onCheckedChange={(checked) => setFormAppliesHourly(checked as boolean)}
                  />
                  <label htmlFor="hourly" className="text-sm cursor-pointer">
                    Hourly Bookings
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="daily"
                    checked={formAppliesDaily}
                    onCheckedChange={(checked) => setFormAppliesDaily(checked as boolean)}
                  />
                  <label htmlFor="daily" className="text-sm cursor-pointer">
                    Daily Bookings
                  </label>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="active"
                  checked={formActive}
                  onCheckedChange={(checked) => setFormActive(checked as boolean)}
                />
                <label htmlFor="active" className="text-sm cursor-pointer">
                  Active (users can use this coupon)
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setIsAddOpen(false);
                setEditingCoupon(null);
                resetForm();
              }}>
                Cancel
              </Button>
              <Button onClick={editingCoupon ? handleUpdate : handleAdd}>
                {editingCoupon ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Hardcoded Coupons Reference */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Hardcoded Coupons (Reference Only)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground mb-4">
            These coupons are built into the code and always have priority over database coupons.
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Applies To</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hardcodedCoupons.map((coupon) => (
                <TableRow key={coupon.code}>
                  <TableCell>
                    <Badge variant="secondary">{coupon.code}</Badge>
                  </TableCell>
                  <TableCell>{coupon.type}</TableCell>
                  <TableCell className="font-medium">{coupon.value}</TableCell>
                  <TableCell>{coupon.appliesTo}</TableCell>
                  <TableCell className="text-muted-foreground">{coupon.note}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Database Coupons */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Database Coupons
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading coupons...</div>
          ) : !coupons || coupons.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No coupons created yet. Click "Create Coupon" to add one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Applies To</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coupons.map((coupon: any) => (
                  <TableRow key={coupon.id}>
                    <TableCell>
                      <Badge>{coupon.code}</Badge>
                    </TableCell>
                    <TableCell className="capitalize">{coupon.discount_type.replace("_", " ")}</TableCell>
                    <TableCell className="font-medium">
                      {formatDiscountValue(coupon.discount_type, coupon.discount_value)}
                    </TableCell>
                    <TableCell>{formatAppliesTo(coupon.applies_to_hourly, coupon.applies_to_daily)}</TableCell>
                    <TableCell>
                      <Button
                        variant={coupon.is_active ? "default" : "secondary"}
                        size="sm"
                        onClick={() => handleToggleActive(coupon.id, coupon.is_active)}
                      >
                        {coupon.is_active ? "Active" : "Inactive"}
                      </Button>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(coupon.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(coupon)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setDeleteConfirmId(coupon.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmId !== null} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Coupon?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The coupon code will be permanently deleted and users will no longer be able to use it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
