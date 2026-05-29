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
  useCreateInventoryLocation,
  useUpdateInventoryLocation,
  InventoryLocation,
} from "@/hooks/useInventoryData";

interface LocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location?: InventoryLocation | null;
}

export function LocationDialog({ open, onOpenChange, location }: LocationDialogProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const { toast } = useToast();

  const createLocation = useCreateInventoryLocation();
  const updateLocation = useUpdateInventoryLocation();

  const isEditing = !!location;

  useEffect(() => {
    if (location) {
      setName(location.name);
      setSlug(location.slug);
    } else {
      setName("");
      setSlug("");
    }
  }, [location, open]);

  // Auto-generate slug from name
  const handleNameChange = (value: string) => {
    setName(value);
    if (!isEditing) {
      const generatedSlug = value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "_")
        .replace(/-+/g, "_");
      setSlug(generatedSlug);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      toast({ title: "Location name is required", variant: "destructive" });
      return;
    }
    if (!slug.trim()) {
      toast({ title: "Slug is required", variant: "destructive" });
      return;
    }

    try {
      if (isEditing && location) {
        await updateLocation.mutateAsync({
          id: location.id,
          data: { name: name.trim(), slug: slug.trim() },
        });
        toast({ title: "Location updated" });
      } else {
        await createLocation.mutateAsync({
          name: name.trim(),
          slug: slug.trim(),
        });
        toast({ title: "Location created" });
      }
      onOpenChange(false);
    } catch {
      toast({ title: "Failed to save location", variant: "destructive" });
    }
  };

  const isLoading = createLocation.isPending || updateLocation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Location" : "Add Location"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Location Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g., Kitchen Cabinets - Lower Left"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug">Slug (identifier)</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g., kitchen_cabinets_lower_left"
            />
            <p className="text-xs text-muted-foreground">
              Used internally to identify this location. Use lowercase with underscores.
            </p>
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