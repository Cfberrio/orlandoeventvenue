import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  ChevronDown, ChevronRight, Package, AlertTriangle, XCircle, CheckCircle, 
  Loader2, Plus, Settings, MapPin, Trash2 
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  useInventoryLocations,
  useInventoryProducts,
  useInventoryStock,
  useInventoryKPIs,
  useUpdateInventoryStock,
  useDeleteInventoryStock,
  InventoryStockWithDetails,
} from "@/hooks/useInventoryData";
import { ManageProductsDialog } from "@/components/inventory/ManageProductsDialog";
import { ManageLocationsDialog } from "@/components/inventory/ManageLocationsDialog";
import { StockItemDialog } from "@/components/inventory/StockItemDialog";

const statusConfig = {
  stocked: { color: "bg-green-500/10 text-green-600 border-green-500/20", icon: CheckCircle },
  low: { color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20", icon: AlertTriangle },
  out: { color: "bg-red-500/10 text-red-600 border-red-500/20", icon: XCircle },
};

export default function Inventory() {
  const [locationFilter, setLocationFilter] = useState("all");
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [productsDialogOpen, setProductsDialogOpen] = useState(false);
  const [locationsDialogOpen, setLocationsDialogOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [preselectedLocationId, setPreselectedLocationId] = useState<string | undefined>();
  const [deleteStockConfirmOpen, setDeleteStockConfirmOpen] = useState(false);
  const [stockToDelete, setStockToDelete] = useState<InventoryStockWithDetails | null>(null);

  const { data: locations, isLoading: locationsLoading } = useInventoryLocations();
  const { data: products, isLoading: productsLoading } = useInventoryProducts();
  const { data: stock, isLoading: stockLoading } = useInventoryStock(locationFilter);
  const { data: kpis, isLoading: kpisLoading } = useInventoryKPIs();
  const updateStock = useUpdateInventoryStock();
  const deleteStock = useDeleteInventoryStock();
  const { toast } = useToast();

  const isLoading = locationsLoading || productsLoading || stockLoading || kpisLoading;

  const toggleSection = (slug: string) => {
    setExpandedSections((prev) => ({ ...prev, [slug]: !prev[slug] }));
  };

  const getStockForLocation = (locationId: string) => {
    if (!stock) return [];
    return stock.filter((s) => s.location_id === locationId);
  };

  const handleUpdateLevel = async (stockItem: InventoryStockWithDetails, newLevel: number) => {
    try {
      const minLevel = stockItem.min_level ?? stockItem.product.default_min_level;
      await updateStock.mutateAsync({
        id: stockItem.id,
        data: { current_level: newLevel, min_level: minLevel },
      });
      toast({ title: "Stock updated" });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  const handleUpdateNotes = async (stockItem: InventoryStockWithDetails, notes: string) => {
    try {
      await updateStock.mutateAsync({
        id: stockItem.id,
        data: { notes },
      });
    } catch {
      toast({ title: "Failed to update notes", variant: "destructive" });
    }
  };

  const handleUpdateShelfLabel = async (stockItem: InventoryStockWithDetails, shelfLabel: string) => {
    try {
      await updateStock.mutateAsync({
        id: stockItem.id,
        data: { shelf_label: shelfLabel },
      });
    } catch {
      toast({ title: "Failed to update shelf label", variant: "destructive" });
    }
  };

  const handleAddStockToLocation = (locationId: string) => {
    setPreselectedLocationId(locationId);
    setStockDialogOpen(true);
  };

  const handleDeleteStockClick = (item: InventoryStockWithDetails) => {
    setStockToDelete(item);
    setDeleteStockConfirmOpen(true);
  };

  const handleDeleteStockConfirm = async () => {
    if (!stockToDelete) return;
    try {
      await deleteStock.mutateAsync(stockToDelete.id);
      toast({ title: "Stock item deleted" });
    } catch {
      toast({ title: "Failed to delete stock item", variant: "destructive" });
    }
    setDeleteStockConfirmOpen(false);
    setStockToDelete(null);
  };

  const renderLocationSection = (location: { id: string; name: string; slug: string }) => {
    const locationStock = getStockForLocation(location.id);
    const isExpanded = expandedSections[location.slug] ?? true;

    if (locationFilter !== "all" && locationFilter !== location.slug) {
      return null;
    }

    return (
      <Collapsible key={location.id} open={isExpanded} onOpenChange={() => toggleSection(location.slug)}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                  {location.name}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{locationStock.length} items</Badge>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddStockToLocation(location.id);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {locationStock.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground text-sm mb-4">
                    No inventory items in this location yet.
                  </p>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleAddStockToLocation(location.id)}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add First Item
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead className="w-24">Min Level</TableHead>
                        <TableHead className="w-24">Current</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Shelf Label</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {locationStock.map((item) => {
                        const config = statusConfig[item.status];
                        const StatusIcon = config.icon;
                        return (
                          <TableRow key={item.id}>
                            <TableCell className="font-medium">{item.product.name}</TableCell>
                            <TableCell>{item.product.unit}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                className="w-20 h-8"
                                defaultValue={item.min_level ?? item.product.default_min_level}
                                onBlur={(e) => {
                                  const val = parseInt(e.target.value);
                                  if (!isNaN(val)) {
                                    updateStock.mutate({
                                      id: item.id,
                                      data: { min_level: val, current_level: item.current_level },
                                    });
                                  }
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                className="w-20 h-8"
                                defaultValue={item.current_level}
                                onBlur={(e) => {
                                  const val = parseInt(e.target.value);
                                  if (!isNaN(val)) {
                                    handleUpdateLevel(item, val);
                                  }
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              <Badge className={config.color}>
                                <StatusIcon className="h-3 w-3 mr-1" />
                                {item.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Input
                                className="w-32 h-8"
                                placeholder="e.g. Rack 2"
                                defaultValue={item.shelf_label || ""}
                                onBlur={(e) => handleUpdateShelfLabel(item, e.target.value)}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="w-40 h-8"
                                placeholder="Notes..."
                                defaultValue={item.notes || ""}
                                onBlur={(e) => handleUpdateNotes(item, e.target.value)}
                              />
                            </TableCell>
                            <TableCell>
                              <Button 
                                size="icon" 
                                variant="ghost" 
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteStockClick(item)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory & Storage</h1>
          <p className="text-muted-foreground">Manage venue supplies and stock levels</p>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Settings className="h-4 w-4 mr-2" />
                Manage
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setProductsDialogOpen(true)}>
                <Package className="h-4 w-4 mr-2" />
                Manage Products
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLocationsDialogOpen(true)}>
                <MapPin className="h-4 w-4 mr-2" />
                Manage Locations
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => {
            setPreselectedLocationId(undefined);
            setStockDialogOpen(true);
          }}>
            <Plus className="h-4 w-4 mr-2" />
            Add Stock Item
          </Button>
        </div>
      </div>

      {/* Filters and KPIs */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Location Filter */}
        <Card className="flex-1">
          <CardContent className="pt-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Location:</span>
                <Select value={locationFilter} onValueChange={setLocationFilter}>
                  <SelectTrigger className="w-[280px]">
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {locations?.map((loc) => (
                      <SelectItem key={loc.slug} value={loc.slug}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {kpis?.lastUpdate && (
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium">Last full count:</span>{" "}
                  {format(new Date(kpis.lastUpdate), "MMM d, yyyy h:mm a")}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* KPI Chips */}
        <div className="flex gap-2 flex-wrap">
          <Card className="px-4 py-3 flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span className="text-sm font-medium">{kpis?.stocked || 0} Stocked</span>
          </Card>
          <Card className="px-4 py-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <span className="text-sm font-medium">{kpis?.low || 0} Low</span>
          </Card>
          <Card className="px-4 py-3 flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-600" />
            <span className="text-sm font-medium">{kpis?.out || 0} Out</span>
          </Card>
        </div>
      </div>

      {/* Inventory Sections - Dynamic based on locations */}
      <div className="space-y-4">
        {locations?.length === 0 ? (
          <Card className="p-8 text-center">
            <MapPin className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Locations Yet</h3>
            <p className="text-muted-foreground mb-4">
              Start by adding your first storage location.
            </p>
            <Button onClick={() => setLocationsDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Location
            </Button>
          </Card>
        ) : (
          locations?.map((location) => renderLocationSection(location))
        )}
      </div>

      {/* Dialogs */}
      <ManageProductsDialog open={productsDialogOpen} onOpenChange={setProductsDialogOpen} />
      <ManageLocationsDialog open={locationsDialogOpen} onOpenChange={setLocationsDialogOpen} />
      <StockItemDialog 
        open={stockDialogOpen} 
        onOpenChange={setStockDialogOpen} 
        preselectedLocationId={preselectedLocationId}
      />

      <AlertDialog open={deleteStockConfirmOpen} onOpenChange={setDeleteStockConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Stock Item?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the stock record for "{stockToDelete?.product.name}" 
              from "{stockToDelete?.location.name}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteStockConfirm} 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}