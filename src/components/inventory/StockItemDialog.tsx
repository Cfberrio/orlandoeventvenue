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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateInventoryStock,
  useInventoryProducts,
  useInventoryLocations,
} from "@/hooks/useInventoryData";

interface StockItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedLocationId?: string;
}

export function StockItemDialog({ open, onOpenChange, preselectedLocationId }: StockItemDialogProps) {
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [currentLevel, setCurrentLevel] = useState(0);
  const [minLevel, setMinLevel] = useState(1);
  const [shelfLabel, setShelfLabel] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const { data: products } = useInventoryProducts();
  const { data: locations } = useInventoryLocations();
  const createStock = useCreateInventoryStock();

  useEffect(() => {
    if (open) {
      setProductId("");
      setLocationId(preselectedLocationId || "");
      setCurrentLevel(0);
      setMinLevel(1);
      setShelfLabel("");
      setNotes("");
    }
  }, [open, preselectedLocationId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!productId) {
      toast({ title: "Please select a product", variant: "destructive" });
      return;
    }
    if (!locationId) {
      toast({ title: "Please select a location", variant: "destructive" });
      return;
    }

    try {
      await createStock.mutateAsync({
        product_id: productId,
        location_id: locationId,
        current_level: currentLevel,
        min_level: minLevel,
        shelf_label: shelfLabel || undefined,
        notes: notes || undefined,
      });
      toast({ title: "Stock item added" });
      onOpenChange(false);
    } catch {
      toast({ title: "Failed to add stock item", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Stock Item</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="product">Product</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a product" />
              </SelectTrigger>
              <SelectContent>
                {products?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.unit})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a location" />
              </SelectTrigger>
              <SelectContent>
                {locations?.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="current-level">Current Level</Label>
              <Input
                id="current-level"
                type="number"
                min={0}
                value={currentLevel}
                onChange={(e) => setCurrentLevel(parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="min-level">Min Level</Label>
              <Input
                id="min-level"
                type="number"
                min={0}
                value={minLevel}
                onChange={(e) => setMinLevel(parseInt(e.target.value) || 0)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="shelf-label">Shelf Label (optional)</Label>
            <Input
              id="shelf-label"
              value={shelfLabel}
              onChange={(e) => setShelfLabel(e.target.value)}
              placeholder="e.g., Rack 2"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createStock.isPending}>
              {createStock.isPending ? "Adding..." : "Add Stock Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}