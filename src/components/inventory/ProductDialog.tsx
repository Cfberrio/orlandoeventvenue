import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, ChevronUp } from "lucide-react";
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { toast } = useToast();

  const createProduct = useCreateInventoryProduct();
  const updateProduct = useUpdateInventoryProduct();

  const isEditing = !!product;

  useEffect(() => {
    if (product) {
      setName(product.name);
      setUnit(product.unit);
      setDefaultMinLevel(product.default_min_level);
      setShowAdvanced(false);
    } else {
      setName("");
      setUnit("unit");
      setDefaultMinLevel(1);
      setShowAdvanced(false);
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
          <DialogTitle>{isEditing ? "Edit Product" : "Add New Product"}</DialogTitle>
          <DialogDescription>
            {isEditing 
              ? "Update the product information." 
              : "Add a new product type to track in your inventory. Just give it a name to start."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Essential Field */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Product Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Paper Towels, Hand Soap"
              className="text-lg"
              autoFocus
            />
          </div>

          {/* Advanced Options Toggle */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full"
          >
            {showAdvanced ? (
              <>
                <ChevronUp className="h-4 w-4 mr-2" />
                Hide optional settings
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-2" />
                Show optional settings
              </>
            )}
          </Button>

          {/* Optional Fields - Collapsible */}
          {showAdvanced && (
            <div className="space-y-4 pt-2 border-t">
              <div className="space-y-2">
                <Label htmlFor="unit">Unit of Measurement</Label>
                <Input
                  id="unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="e.g., roll, bottle, box, pack"
                />
                <p className="text-xs text-muted-foreground">
                  How you count this item (default: "unit")
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="min-level">Default Minimum Stock Level</Label>
                <Input
                  id="min-level"
                  type="number"
                  min={0}
                  value={defaultMinLevel}
                  onChange={(e) => setDefaultMinLevel(parseInt(e.target.value) || 0)}
                  placeholder="Default: 1"
                />
                <p className="text-xs text-muted-foreground">
                  Alert when stock falls below this number (you can adjust per location later)
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Saving..." : isEditing ? "Update Product" : "Add Product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}