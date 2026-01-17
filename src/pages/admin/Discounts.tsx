import { useState } from "react";
import { format } from "date-fns";
import { Plus, Pencil, Trash2, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import {
  useDiscountCoupons,
  useCreateCoupon,
  useUpdateCoupon,
  useDeleteCoupon,
  type DiscountCoupon,
} from "@/hooks/useDiscountCoupons";

export default function Discounts() {
  const { data: coupons, isLoading } = useDiscountCoupons();
  const createCoupon = useCreateCoupon();
  const updateCoupon = useUpdateCoupon();
  const deleteCoupon = useDeleteCoupon();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedCoupon, setSelectedCoupon] = useState<DiscountCoupon | null>(null);

  const [formData, setFormData] = useState({
    code: "",
    discount_percentage: 10,
    is_active: true,
  });

  const [searchQuery, setSearchQuery] = useState("");

  const resetForm = () => {
    setFormData({
      code: "",
      discount_percentage: 10,
      is_active: true,
    });
  };

  const handleCreate = async () => {
    await createCoupon.mutateAsync(formData);
    setIsCreateDialogOpen(false);
    resetForm();
  };

  const handleEdit = async () => {
    if (!selectedCoupon) return;
    await updateCoupon.mutateAsync({
      id: selectedCoupon.id,
      ...formData,
    });
    setIsEditDialogOpen(false);
    setSelectedCoupon(null);
    resetForm();
  };

  const handleDelete = async () => {
    if (!selectedCoupon) return;
    await deleteCoupon.mutateAsync(selectedCoupon.id);
    setIsDeleteDialogOpen(false);
    setSelectedCoupon(null);
  };

  const handleToggleActive = async (coupon: DiscountCoupon) => {
    await updateCoupon.mutateAsync({
      id: coupon.id,
      is_active: !coupon.is_active,
    });
  };

  const openCreateDialog = () => {
    resetForm();
    setIsCreateDialogOpen(true);
  };

  const openEditDialog = (coupon: DiscountCoupon) => {
    setSelectedCoupon(coupon);
    setFormData({
      code: coupon.code,
      discount_percentage: coupon.discount_percentage,
      is_active: coupon.is_active,
    });
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (coupon: DiscountCoupon) => {
    setSelectedCoupon(coupon);
    setIsDeleteDialogOpen(true);
  };

  const filteredCoupons = coupons?.filter((coupon) =>
    coupon.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Discount Coupons</h1>
          <p className="text-muted-foreground mt-1">
            Manage discount codes for bookings
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Create Coupon
        </Button>
      </div>

      <div className="bg-card border border-border rounded-lg p-6">
        <div className="mb-4">
          <Input
            placeholder="Search by code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-sm"
          />
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading coupons...
          </div>
        ) : filteredCoupons && filteredCoupons.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCoupons.map((coupon) => (
                <TableRow key={coupon.id}>
                  <TableCell className="font-mono font-semibold">
                    <div className="flex items-center gap-2">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      {coupon.code}
                    </div>
                  </TableCell>
                  <TableCell>{coupon.discount_percentage}% off</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={coupon.is_active}
                        onCheckedChange={() => handleToggleActive(coupon)}
                      />
                      <Badge variant={coupon.is_active ? "default" : "secondary"}>
                        {coupon.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(coupon.created_at), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(coupon)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openDeleteDialog(coupon)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            {searchQuery ? "No coupons found" : "No coupons yet. Create your first one!"}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Discount Coupon</DialogTitle>
            <DialogDescription>
              Create a new discount code that applies to base rental costs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="code">Coupon Code</Label>
              <Input
                id="code"
                placeholder="SUMMER2026"
                value={formData.code}
                onChange={(e) =>
                  setFormData({ ...formData, code: e.target.value.toUpperCase() })
                }
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Enter code without spaces (will be converted to uppercase)
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="percentage">Discount Percentage</Label>
              <Input
                id="percentage"
                type="number"
                min="1"
                max="100"
                value={formData.discount_percentage}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    discount_percentage: parseInt(e.target.value) || 0,
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                Discount applies to base rental only (1-100%)
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="active"
                checked={formData.is_active}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_active: checked })
                }
              />
              <Label htmlFor="active">Active (can be used immediately)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!formData.code || formData.discount_percentage < 1}>
              Create Coupon
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Discount Coupon</DialogTitle>
            <DialogDescription>
              Update the discount code settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-code">Coupon Code</Label>
              <Input
                id="edit-code"
                placeholder="SUMMER2026"
                value={formData.code}
                onChange={(e) =>
                  setFormData({ ...formData, code: e.target.value.toUpperCase() })
                }
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-percentage">Discount Percentage</Label>
              <Input
                id="edit-percentage"
                type="number"
                min="1"
                max="100"
                value={formData.discount_percentage}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    discount_percentage: parseInt(e.target.value) || 0,
                  })
                }
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="edit-active"
                checked={formData.is_active}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_active: checked })
                }
              />
              <Label htmlFor="edit-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={!formData.code || formData.discount_percentage < 1}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Coupon</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the coupon{" "}
              <span className="font-mono font-semibold">{selectedCoupon?.code}</span>?
              This action cannot be undone.
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
