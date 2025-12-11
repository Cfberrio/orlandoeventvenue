import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight, Package, AlertTriangle, XCircle, CheckCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  useInventoryLocations,
  useInventoryProducts,
  useInventoryStock,
  useInventoryKPIs,
  useUpdateInventoryStock,
  useCreateInventoryStock,
  InventoryStockWithDetails,
} from "@/hooks/useInventoryData";

const statusConfig = {
  stocked: { color: "bg-green-500/10 text-green-600 border-green-500/20", icon: CheckCircle },
  low: { color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20", icon: AlertTriangle },
  out: { color: "bg-red-500/10 text-red-600 border-red-500/20", icon: XCircle },
};

export default function Inventory() {
  const [locationFilter, setLocationFilter] = useState("all");
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    kitchen_cabinets_lower_left: true,
    storage_rack_entrance: true,
    bathroom_cabinets_womens: true,
  });

  const { data: locations, isLoading: locationsLoading } = useInventoryLocations();
  const { data: products, isLoading: productsLoading } = useInventoryProducts();
  const { data: stock, isLoading: stockLoading } = useInventoryStock(locationFilter);
  const { data: kpis, isLoading: kpisLoading } = useInventoryKPIs();
  const updateStock = useUpdateInventoryStock();
  const createStock = useCreateInventoryStock();
  const { toast } = useToast();

  const isLoading = locationsLoading || productsLoading || stockLoading || kpisLoading;

  const toggleSection = (slug: string) => {
    setExpandedSections((prev) => ({ ...prev, [slug]: !prev[slug] }));
  };

  const getStockForLocation = (locationSlug: string) => {
    if (!stock || !locations) return [];
    const location = locations.find((l) => l.slug === locationSlug);
    if (!location) return [];
    return stock.filter((s) => s.location_id === location.id);
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

  const renderLocationSection = (locationSlug: string, title: string, showShelfLabel: boolean = false) => {
    const locationStock = getStockForLocation(locationSlug);
    const isExpanded = expandedSections[locationSlug];

    if (locationFilter !== "all" && locationFilter !== locationSlug) {
      return null;
    }

    return (
      <Collapsible open={isExpanded} onOpenChange={() => toggleSection(locationSlug)}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                  {title}
                </CardTitle>
                <Badge variant="outline">{locationStock.length} items</Badge>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {locationStock.length === 0 ? (
                <p className="text-muted-foreground text-sm py-4 text-center">
                  No inventory items in this location yet.
                </p>
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
                        {showShelfLabel && <TableHead>Shelf Label</TableHead>}
                        <TableHead>Notes</TableHead>
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
                            {showShelfLabel && (
                              <TableCell>
                                <Input
                                  className="w-32 h-8"
                                  placeholder="e.g. Rack 2"
                                  defaultValue={item.shelf_label || ""}
                                  onBlur={(e) => handleUpdateShelfLabel(item, e.target.value)}
                                />
                              </TableCell>
                            )}
                            <TableCell>
                              <Input
                                className="w-40 h-8"
                                placeholder="Notes..."
                                defaultValue={item.notes || ""}
                                onBlur={(e) => handleUpdateNotes(item, e.target.value)}
                              />
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

      {/* Inventory Sections */}
      <div className="space-y-4">
        {renderLocationSection("kitchen_cabinets_lower_left", "Kitchen Cabinets – Lower Left")}
        {renderLocationSection("storage_rack_entrance", "Storage Rack – Entrance Right Side", true)}
        {renderLocationSection("bathroom_cabinets_womens", "Bathroom Cabinets – Women's Bathroom")}
      </div>
    </div>
  );
}
