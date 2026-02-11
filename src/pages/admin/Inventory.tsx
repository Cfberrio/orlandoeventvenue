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
  Loader2, Plus, Settings, MapPin, Trash2, Minus, Check
} from "lucide-react";
import { cn } from "@/lib/utils";
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
import { ProductDialog } from "@/components/inventory/ProductDialog";

const statusConfig = {
  stocked: { color: "bg-green-500/10 text-green-600 border-green-500/20", icon: CheckCircle },
  low: { color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20", icon: AlertTriangle },
  out: { color: "bg-red-500/10 text-red-600 border-red-500/20", icon: XCircle },
};

export default function Inventory() {
  const [locationFilter, setLocationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "out" | "low" | "stocked">("all");
  const [viewMode, setViewMode] = useState<"detailed" | "simple">("detailed");
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [productsDialogOpen, setProductsDialogOpen] = useState(false);
  const [locationsDialogOpen, setLocationsDialogOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [addProductDialogOpen, setAddProductDialogOpen] = useState(false);
  const [preselectedLocationId, setPreselectedLocationId] = useState<string | undefined>();
  const [deleteStockConfirmOpen, setDeleteStockConfirmOpen] = useState(false);
  const [stockToDelete, setStockToDelete] = useState<InventoryStockWithDetails | null>(null);
  const [savingStockId, setSavingStockId] = useState<string | null>(null);
  const [savedStockId, setSavedStockId] = useState<string | null>(null);

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
    let filtered = stock.filter((s) => s.location_id === locationId);
    
    // Apply status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter((s) => s.status === statusFilter);
    }
    
    return filtered;
  };

  const handleUpdateLevel = async (stockItem: InventoryStockWithDetails, newLevel: number) => {
    if (newLevel < 0) return;
    
    setSavingStockId(stockItem.id);
    try {
      const minLevel = stockItem.min_level ?? stockItem.product.default_min_level;
      await updateStock.mutateAsync({
        id: stockItem.id,
        data: { current_level: newLevel, min_level: minLevel },
      });
      
      // Show saved checkmark
      setSavedStockId(stockItem.id);
      setTimeout(() => setSavedStockId(null), 2000);
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    } finally {
      setSavingStockId(null);
    }
  };

  const handleQuickIncrement = (stockItem: InventoryStockWithDetails) => {
    handleUpdateLevel(stockItem, stockItem.current_level + 1);
  };

  const handleQuickDecrement = (stockItem: InventoryStockWithDetails) => {
    if (stockItem.current_level > 0) {
      handleUpdateLevel(stockItem, stockItem.current_level - 1);
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
                        {viewMode === "detailed" && <TableHead>Unit</TableHead>}
                        {viewMode === "detailed" && <TableHead className="w-24">Min Level</TableHead>}
                        <TableHead className="w-48">Current Level</TableHead>
                        <TableHead>Status</TableHead>
                        {viewMode === "detailed" && <TableHead>Shelf Label</TableHead>}
                        {viewMode === "detailed" && <TableHead>Notes</TableHead>}
                        {viewMode === "detailed" && <TableHead className="w-12"></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {locationStock.map((item) => {
                        const config = statusConfig[item.status];
                        const StatusIcon = config.icon;
                        const isSaving = savingStockId === item.id;
                        const isSaved = savedStockId === item.id;
                        
                        // Row background classes based on status
                        const rowClasses = cn(
                          "transition-colors",
                          item.status === "out" && "bg-red-50 border-l-4 border-l-red-500 dark:bg-red-950/20",
                          item.status === "low" && "bg-yellow-50 border-l-4 border-l-yellow-500 dark:bg-yellow-950/20",
                        );
                        
                        return (
                          <TableRow key={item.id} className={rowClasses}>
                            <TableCell className="font-medium">
                              {item.product.name}
                            </TableCell>
                            {viewMode === "detailed" && (
                              <TableCell className="text-muted-foreground">{item.product.unit}</TableCell>
                            )}
                            {viewMode === "detailed" && (
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
                            )}
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-8 w-8 shrink-0"
                                  onClick={() => handleQuickDecrement(item)}
                                  disabled={isSaving || item.current_level === 0}
                                >
                                  <Minus className="h-4 w-4" />
                                </Button>
                                <Input
                                  type="number"
                                  min={0}
                                  className="w-16 h-8 text-center font-semibold"
                                  value={item.current_level}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value);
                                    if (!isNaN(val)) {
                                      handleUpdateLevel(item, val);
                                    }
                                  }}
                                />
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-8 w-8 shrink-0"
                                  onClick={() => handleQuickIncrement(item)}
                                  disabled={isSaving}
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                                {isSaving && (
                                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                )}
                                {isSaved && (
                                  <Check className="h-4 w-4 text-green-600 animate-in fade-in" />
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge 
                                className={cn(
                                  config.color,
                                  "text-sm px-3 py-1",
                                  item.status === "out" && "animate-pulse"
                                )}
                              >
                                <StatusIcon className="h-4 w-4 mr-1" />
                                {item.status === "out" ? "OUT OF STOCK" : item.status === "low" ? "LOW STOCK" : "STOCKED"}
                              </Badge>
                            </TableCell>
                            {viewMode === "detailed" && (
                              <TableCell>
                                <Input
                                  className="w-32 h-8"
                                  placeholder="e.g. Rack 2"
                                  defaultValue={item.shelf_label || ""}
                                  onBlur={(e) => handleUpdateShelfLabel(item, e.target.value)}
                                />
                              </TableCell>
                            )}
                            {viewMode === "detailed" && (
                              <TableCell>
                                <Input
                                  className="w-40 h-8"
                                  placeholder="Notes..."
                                  defaultValue={item.notes || ""}
                                  onBlur={(e) => handleUpdateNotes(item, e.target.value)}
                                />
                              </TableCell>
                            )}
                            {viewMode === "detailed" && (
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
                            )}
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
          <Button variant="outline" onClick={() => setAddProductDialogOpen(true)}>
            <Package className="h-4 w-4 mr-2" />
            Add Product
          </Button>
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
      <div className="flex flex-col gap-4">
        {/* Location Filter and View Toggle */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
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
              
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">View:</span>
                <Select value={viewMode} onValueChange={(v: "detailed" | "simple") => setViewMode(v)}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simple">Simple View</SelectItem>
                    <SelectItem value="detailed">Detailed View</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {kpis?.lastUpdate && (
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium">Last update:</span>{" "}
                  {format(new Date(kpis.lastUpdate), "MM/dd, h:mm a")}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Status Filter Chips */}
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={statusFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("all")}
            className="h-10"
          >
            All Items ({(kpis?.stocked || 0) + (kpis?.low || 0) + (kpis?.out || 0)})
          </Button>
          <Button
            variant={statusFilter === "out" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("out")}
            className={cn(
              "h-10",
              statusFilter === "out" 
                ? "bg-red-600 hover:bg-red-700" 
                : "border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400"
            )}
          >
            <XCircle className="h-4 w-4 mr-1" />
            Out of Stock ({kpis?.out || 0})
          </Button>
          <Button
            variant={statusFilter === "low" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("low")}
            className={cn(
              "h-10",
              statusFilter === "low" 
                ? "bg-yellow-600 hover:bg-yellow-700" 
                : "border-yellow-200 text-yellow-700 hover:bg-yellow-50 dark:border-yellow-800 dark:text-yellow-400"
            )}
          >
            <AlertTriangle className="h-4 w-4 mr-1" />
            Low Stock ({kpis?.low || 0})
          </Button>
          <Button
            variant={statusFilter === "stocked" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("stocked")}
            className={cn(
              "h-10",
              statusFilter === "stocked" && "bg-green-600 hover:bg-green-700"
            )}
          >
            <CheckCircle className="h-4 w-4 mr-1" />
            Stocked ({kpis?.stocked || 0})
          </Button>
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
      <ProductDialog 
        open={addProductDialogOpen} 
        onOpenChange={setAddProductDialogOpen} 
        product={null}
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