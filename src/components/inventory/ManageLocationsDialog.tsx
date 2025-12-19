import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useInventoryLocations,
  useDeleteInventoryLocation,
  InventoryLocation,
} from "@/hooks/useInventoryData";
import { LocationDialog } from "./LocationDialog";
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

interface ManageLocationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ManageLocationsDialog({ open, onOpenChange }: ManageLocationsDialogProps) {
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<InventoryLocation | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [locationToDelete, setLocationToDelete] = useState<InventoryLocation | null>(null);
  
  const { data: locations } = useInventoryLocations();
  const deleteLocation = useDeleteInventoryLocation();
  const { toast } = useToast();

  const handleEdit = (location: InventoryLocation) => {
    setSelectedLocation(location);
    setLocationDialogOpen(true);
  };

  const handleAdd = () => {
    setSelectedLocation(null);
    setLocationDialogOpen(true);
  };

  const handleDeleteClick = (location: InventoryLocation) => {
    setLocationToDelete(location);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!locationToDelete) return;
    try {
      await deleteLocation.mutateAsync(locationToDelete.id);
      toast({ title: "Location deleted" });
    } catch {
      toast({ title: "Failed to delete location", variant: "destructive" });
    }
    setDeleteConfirmOpen(false);
    setLocationToDelete(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Manage Locations</span>
              <Button size="sm" onClick={handleAdd}>
                <Plus className="h-4 w-4 mr-1" />
                Add Location
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                      No locations yet. Add your first location.
                    </TableCell>
                  </TableRow>
                )}
                {locations?.map((location) => (
                  <TableRow key={location.id}>
                    <TableCell className="font-medium">{location.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {location.slug}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => handleEdit(location)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeleteClick(location)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <LocationDialog 
        open={locationDialogOpen} 
        onOpenChange={setLocationDialogOpen} 
        location={selectedLocation}
      />

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Location?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{locationToDelete?.name}" and all stock records
              associated with this location. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}