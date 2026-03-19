import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Settings, Plus, Save, Loader2, DollarSign, Package, Wrench, Percent } from "lucide-react";
import { usePricingAdmin, VenuePricingItem } from "@/hooks/usePricing";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

type Category = "rental" | "package" | "service" | "fee";

const CATEGORY_LABELS: Record<Category, string> = {
  rental: "Venue Rental",
  package: "Production Packages",
  service: "Optional Services",
  fee: "Fees & Percentages",
};

const CATEGORY_ICONS: Record<Category, typeof DollarSign> = {
  rental: DollarSign,
  package: Package,
  service: Wrench,
  fee: Percent,
};

const CATEGORY_ORDER: Category[] = ["rental", "package", "service", "fee"];

const PRICE_UNIT_LABELS: Record<string, string> = {
  per_hour: "/hr",
  per_unit: "/unit",
  flat: "flat",
  percentage: "%",
};

interface FormState {
  category: Category;
  item_key: string;
  label: string;
  description: string;
  price: string;
  price_unit: string;
  extra_fee: string;
  is_active: boolean;
  sort_order: string;
}

const EMPTY_FORM: FormState = {
  category: "service",
  item_key: "",
  label: "",
  description: "",
  price: "",
  price_unit: "flat",
  extra_fee: "0",
  is_active: true,
  sort_order: "50",
};

export default function Pricing() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: items, isLoading } = usePricingAdmin();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const groupedItems = CATEGORY_ORDER.reduce<Record<Category, VenuePricingItem[]>>((acc, cat) => {
    acc[cat] = (items ?? []).filter((i) => i.category === cat);
    return acc;
  }, { rental: [], package: [], service: [], fee: [] });

  const openAddDialog = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setIsDialogOpen(true);
  };

  const openEditDialog = (item: VenuePricingItem) => {
    setEditingId(item.id);
    setForm({
      category: item.category as Category,
      item_key: item.item_key,
      label: item.label,
      description: item.description ?? "",
      price: String(item.price),
      price_unit: item.price_unit,
      extra_fee: String(item.extra_fee ?? 0),
      is_active: item.is_active,
      sort_order: String(item.sort_order),
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.label.trim() || !form.item_key.trim() || !form.price.trim()) {
      toast({ title: "Label, key, and price are required", variant: "destructive" });
      return;
    }

    const priceVal = parseFloat(form.price);
    if (isNaN(priceVal) || priceVal < 0) {
      toast({ title: "Price must be a valid positive number", variant: "destructive" });
      return;
    }

    setSaving(true);

    try {
      const payload = {
        category: form.category,
        item_key: form.item_key.trim().toLowerCase().replace(/\s+/g, "_"),
        label: form.label.trim(),
        description: form.description.trim() || null,
        price: priceVal,
        price_unit: form.price_unit,
        extra_fee: parseFloat(form.extra_fee) || 0,
        is_active: form.is_active,
        sort_order: parseInt(form.sort_order) || 0,
      };

      if (editingId) {
        const { error } = await supabase
          .from("venue_pricing" as any)
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
        toast({ title: "Pricing item updated" });
      } else {
        const { error } = await supabase
          .from("venue_pricing" as any)
          .insert(payload);
        if (error) throw error;
        toast({ title: "Pricing item created" });
      }

      queryClient.invalidateQueries({ queryKey: ["venue-pricing-admin"] });
      queryClient.invalidateQueries({ queryKey: ["venue-pricing"] });
      setIsDialogOpen(false);
    } catch (err: any) {
      console.error("Error saving pricing item:", err);
      toast({
        title: "Failed to save",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (item: VenuePricingItem) => {
    setTogglingId(item.id);
    try {
      const { error } = await supabase
        .from("venue_pricing" as any)
        .update({ is_active: !item.is_active })
        .eq("id", item.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["venue-pricing-admin"] });
      queryClient.invalidateQueries({ queryKey: ["venue-pricing"] });
    } catch (err: any) {
      toast({ title: "Failed to toggle", description: err?.message, variant: "destructive" });
    } finally {
      setTogglingId(null);
    }
  };

  const formatPrice = (item: VenuePricingItem) => {
    const price = Number(item.price);
    if (item.price_unit === "percentage") return `${price}%`;
    return `$${price.toFixed(2)}${PRICE_UNIT_LABELS[item.price_unit] !== "flat" ? PRICE_UNIT_LABELS[item.price_unit] : ""}`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Pricing & Packages</h1>
          <p className="text-muted-foreground mt-1">
            Manage venue rental rates, production packages, services, and fees
          </p>
        </div>
        <Button onClick={openAddDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Add Item
        </Button>
      </div>

      {CATEGORY_ORDER.map((category) => {
        const categoryItems = groupedItems[category];
        const IconComponent = CATEGORY_ICONS[category];

        return (
          <Card key={category}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <IconComponent className="h-5 w-5" />
                {CATEGORY_LABELS[category]}
                <Badge variant="secondary" className="ml-2">{categoryItems.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {categoryItems.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No items in this category</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Extra Fee</TableHead>
                      <TableHead className="text-center">Active</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryItems.map((item) => (
                      <TableRow key={item.id} className={!item.is_active ? "opacity-50" : ""}>
                        <TableCell>
                          <div>
                            <span className="font-medium">{item.label}</span>
                            {item.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 max-w-xs truncate">
                                {item.description}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{item.item_key}</code>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatPrice(item)}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(item.extra_fee) > 0 ? `$${Number(item.extra_fee).toFixed(2)}` : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={item.is_active}
                            onCheckedChange={() => handleToggleActive(item)}
                            disabled={togglingId === item.id}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => openEditDialog(item)}>
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Pricing Item" : "Add Pricing Item"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm({ ...form, category: v as Category })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_ORDER.map((c) => (
                      <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Item Key</Label>
                <Input
                  value={form.item_key}
                  onChange={(e) => setForm({ ...form, item_key: e.target.value })}
                  placeholder="e.g. package_premium"
                  disabled={!!editingId}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Label</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. Premium Package"
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Shown to customers in booking form"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Price</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder="0.00"
                />
              </div>

              <div className="space-y-2">
                <Label>Unit</Label>
                <Select
                  value={form.price_unit}
                  onValueChange={(v) => setForm({ ...form, price_unit: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flat">Flat</SelectItem>
                    <SelectItem value="per_hour">Per Hour</SelectItem>
                    <SelectItem value="per_unit">Per Unit</SelectItem>
                    <SelectItem value="percentage">Percentage</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Extra Fee</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.extra_fee}
                  onChange={(e) => setForm({ ...form, extra_fee: e.target.value })}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                />
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                />
                <Label>Active</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
              ) : (
                <><Save className="h-4 w-4 mr-2" />{editingId ? "Update" : "Create"}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
