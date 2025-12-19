import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateInventoryProduct,
  useUpdateInventoryProduct,
  InventoryProduct,
} from "@/hooks/useInventoryData";

interface ProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: InventoryProduct | null;
}

export function ProductDialog({ open, onOpenChange, product }: ProductDialogProps) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("unit");
  const [defaultMinLevel, setDefaultMinLevel] = useState(1);
  const { toast } = useToast();

  const createProduct = useCreateInventoryProduct();
  const updateProduct = useUpdateInventoryProduct();

  const isEditing = !!product;

  useEffect(() => {
    if (product) {
      setName(product.name);
      setUnit(product.unit);
      setDefaultMinLevel(product.default_min_level);
    } else {
      setName("");
      setUnit("unit");
      setDefaultMinLevel(1);
    }
  }, [product, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      toast({ title: "Product name is required", variant: "destructive" });
      return;
    }

    try {
      if (isEditing && product) {
        await updateProduct.mutateAsync({
          id: product.id,
          data: { name: name.trim(), unit, default_min_level: defaultMinLevel },
        });
        toast({ title: "Product updated" });
      } else {
        await createProduct.mutateAsync({
          name: name.trim(),
          unit,
          default_min_level: defaultMinLevel,
        });
        toast({ title: "Product created" });
      }
      onOpenChange(false);
    } catch {
      toast({ title: "Failed to save product", variant: "destructive" });
    }
  };

  const isLoading = createProduct.isPending || updateProduct.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Product" : "Add Product"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Product Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Paper Towels"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="unit">Unit</Label>
            <Input
              id="unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="e.g., roll, bottle, box"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="min-level">Default Minimum Level</Label>
            <Input
              id="min-level"
              type="number"
              min={0}
              value={defaultMinLevel}
              onChange={(e) => setDefaultMinLevel(parseInt(e.target.value) || 0)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Saving..." : isEditing ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}