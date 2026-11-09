import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tag, Plus, Edit, Trash2, History, AlertTriangle, DollarSign, Percent } from "lucide-react";
import { useDiscountCoupons, useCreateDiscountCoupon, useUpdateDiscountCoupon, useDeleteDiscountCoupon } from "@/hooks/useAdminData";
import { usePricing } from "@/hooks/usePricing";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { computeBookingPrice, describeDiscount, type CouponTerms } from "@/lib/bookingPricing";
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

type DiscountType = "percentage" | "fixed_amount";
type Target = "base_rental" | "total";

const MAX_FIXED = 5000;

interface CouponRow {
  id: string;
  code: string;
  discount_type: DiscountType;
  discount_value: number | string;
  applies_to: string;
  applies_to_hourly: boolean;
  applies_to_daily: boolean;
  is_active: boolean;
  created_at: string;
}

interface CouponSnapshotRow {
  discount_type: DiscountType;
  discount_value: number | string;
  applies_to: string;
  is_active: boolean;
}

interface AuditRow {
  action: string;
  old_row: CouponSnapshotRow | null;
  new_row: CouponSnapshotRow | null;
  actor: string | null;
  created_at: string;
}

const errorMessage = (e: unknown) => String((e as { message?: string } | null)?.message || "");

/** A code this large asks the admin to retype it before saving. */
function isLargeDiscount(type: DiscountType, value: number, target: Target, typicalSavings: number, typicalGross: number) {
  if (type === "percentage" && value >= 50) return true;
  if (type === "percentage" && target === "total" && value >= 25) return true;
  if (type === "fixed_amount" && value >= 300) return true;
  return typicalGross > 0 && typicalSavings / typicalGross >= 0.4;
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Discounts() {
  const { toast } = useToast();
  const { pricing } = usePricing();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<CouponRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CouponRow | null>(null);
  const [historyCode, setHistoryCode] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  // Form state. No default type on purpose: the admin must choose $ or %.
  const [formCode, setFormCode] = useState("");
  const [formType, setFormType] = useState<DiscountType | null>(null);
  const [formValue, setFormValue] = useState("");
  const [formAppliesTo, setFormAppliesTo] = useState<Target>("base_rental");
  const [formAppliesHourly, setFormAppliesHourly] = useState(true);
  const [formAppliesDaily, setFormAppliesDaily] = useState(true);
  const [formActive, setFormActive] = useState(true);

  const { data: coupons, isLoading } = useDiscountCoupons();
  const createCoupon = useCreateDiscountCoupon();
  const updateCoupon = useUpdateDiscountCoupon();
  const deleteCoupon = useDeleteDiscountCoupon();

  // How many bookings used each code (for the edit/delete warnings).
  const { data: usage } = useQuery({
    queryKey: ["discount-coupon-usage"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("discount_code")
        .not("discount_code", "is", null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        const code = String((row as { discount_code: string | null }).discount_code || "").trim().toUpperCase();
        if (code) counts[code] = (counts[code] ?? 0) + 1;
      }
      return counts;
    },
    staleTime: 60_000,
  });

  const { data: history } = useQuery({
    queryKey: ["discount-coupon-audit", historyCode],
    enabled: historyCode !== null,
    queryFn: async () => {
      // discount_coupon_audit is newer than the generated types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from as any)("discount_coupon_audit")
        .select("action, old_row, new_row, actor, created_at")
        .eq("code", historyCode)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  const parsedValue = parseFloat(formValue);
  const valueOk =
    formType !== null &&
    Number.isFinite(parsedValue) &&
    parsedValue > 0 &&
    (formType === "percentage" ? parsedValue <= 100 : parsedValue <= MAX_FIXED);

  // Live preview on two typical bookings, priced with the live rates.
  const preview = useMemo(() => {
    if (!valueOk || formType === null) return null;
    const terms: CouponTerms = {
      code: formCode || "CODE",
      discount_type: formType,
      discount_value: parsedValue,
      applies_to: formAppliesTo,
      applies_to_hourly: true,
      applies_to_daily: true,
    };
    const hourly = computeBookingPrice({ bookingType: "hourly", startTime: "18:00", endTime: "22:00" }, pricing, terms);
    const daily = computeBookingPrice({ bookingType: "daily" }, pricing, terms);
    return { hourly, daily, description: describeDiscount(formType, parsedValue, formAppliesTo) };
  }, [valueOk, formType, parsedValue, formAppliesTo, formCode, pricing]);

  const typical = preview ? (formAppliesHourly ? preview.hourly : preview.daily) : null;
  const large =
    preview && typical && formType !== null
      ? isLargeDiscount(formType, parsedValue, formAppliesTo, typical.discount?.amount ?? 0, typical.grossSubtotal)
      : false;

  const resetForm = () => {
    setFormCode("");
    setFormType(null);
    setFormValue("");
    setFormAppliesTo("base_rental");
    setFormAppliesHourly(true);
    setFormAppliesDaily(true);
    setFormActive(true);
    setConfirmText("");
  };

  const closeForm = () => {
    setIsAddOpen(false);
    setEditingCoupon(null);
    setConfirmOpen(false);
    resetForm();
  };

  const validate = (): boolean => {
    if (!formCode.trim()) {
      toast({ title: "Code is required", variant: "destructive" });
      return false;
    }
    if (!/^[A-Z0-9_-]{2,32}$/.test(formCode.trim())) {
      toast({ title: "Code: 2-32 letters, numbers, - or _", variant: "destructive" });
      return false;
    }
    if (formType === null) {
      toast({ title: "Choose dollars off or percent off", variant: "destructive" });
      return false;
    }
    if (!valueOk) {
      toast({
        title: formType === "percentage" ? "Percent must be between 1 and 100" : `Dollar amount must be between $1 and $${MAX_FIXED}`,
        variant: "destructive",
      });
      return false;
    }
    if (!formAppliesHourly && !formAppliesDaily) {
      toast({ title: "Must apply to at least one booking type", variant: "destructive" });
      return false;
    }
    return true;
  };

  const save = async () => {
    const payload = {
      discount_type: formType as DiscountType,
      discount_value: parsedValue,
      applies_to: formAppliesTo,
      applies_to_hourly: formAppliesHourly,
      applies_to_daily: formAppliesDaily,
      is_active: formActive,
    };
    try {
      if (editingCoupon) {
        await updateCoupon.mutateAsync({ id: editingCoupon.id, updates: payload });
        toast({ title: `${editingCoupon.code} updated`, description: preview?.description });
      } else {
        await createCoupon.mutateAsync({ code: formCode.trim(), ...payload });
        toast({ title: `${formCode.trim()} created`, description: preview?.description });
      }
      closeForm();
    } catch (error: unknown) {
      const msg = errorMessage(error);
      if (msg.includes("duplicate key")) toast({ title: "Code already exists", variant: "destructive" });
      else if (msg.includes("percentage_max")) toast({ title: "Percent can't exceed 100", variant: "destructive" });
      else toast({ title: "Failed to save coupon", description: msg || undefined, variant: "destructive" });
    }
  };

  const handleSubmit = () => {
    if (!validate()) return;
    if (large) {
      setConfirmText("");
      setConfirmOpen(true);
      return;
    }
    void save();
  };

  const handleEdit = (coupon: CouponRow) => {
    setEditingCoupon(coupon);
    setFormCode(coupon.code);
    setFormType(coupon.discount_type);
    setFormValue(String(coupon.discount_value));
    setFormAppliesTo(coupon.applies_to === "total" ? "total" : "base_rental");
    setFormAppliesHourly(coupon.applies_to_hourly);
    setFormAppliesDaily(coupon.applies_to_daily);
    setFormActive(coupon.is_active);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCoupon.mutateAsync(deleteTarget.id);
      toast({ title: `${deleteTarget.code} deleted` });
      setDeleteTarget(null);
    } catch (error: unknown) {
      const msg = errorMessage(error);
      toast({
        title: msg.includes("COUPON_IN_USE") ? "This code was used on bookings, so it can't be deleted" : "Failed to delete coupon",
        description: msg.includes("COUPON_IN_USE") ? "Deactivate it instead; past invoices keep referring to it." : undefined,
        variant: "destructive",
      });
    }
  };

  const handleToggleActive = async (coupon: CouponRow) => {
    try {
      await updateCoupon.mutateAsync({ id: coupon.id, updates: { is_active: !coupon.is_active } });
      toast({ title: coupon.is_active ? `${coupon.code} deactivated` : `${coupon.code} activated` });
    } catch {
      toast({ title: "Failed to update coupon", variant: "destructive" });
    }
  };

  const formatAppliesTo = (hourly: boolean, daily: boolean) => {
    if (hourly && daily) return "Hourly & Daily";
    if (hourly) return "Hourly only";
    if (daily) return "Daily only";
    return "None";
  };

  const usedCount = (code: string) => usage?.[code.toUpperCase()] ?? 0;
  const editingUsed = editingCoupon ? usedCount(editingCoupon.code) : 0;
  const deleteUsed = deleteTarget ? usedCount(deleteTarget.code) : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Discount Coupons</h1>
          <p className="text-muted-foreground mt-1">
            Every code is checked again on the server before a guest pays. Past bookings keep the terms they were charged under.
          </p>
        </div>
        <Dialog open={isAddOpen || editingCoupon !== null} onOpenChange={(open) => { if (!open) closeForm(); }}>
          <DialogTrigger asChild>
            <Button onClick={() => setIsAddOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Coupon
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingCoupon ? `Edit ${editingCoupon.code}` : "Create New Coupon"}</DialogTitle>
              {editingCoupon && editingUsed > 0 && (
                <DialogDescription>
                  Used on {editingUsed} booking{editingUsed === 1 ? "" : "s"}. Changes apply to new bookings only; existing bookings and their invoices keep their original terms.
                </DialogDescription>
              )}
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="code">Code *</Label>
                <Input
                  id="code"
                  placeholder="e.g., SUMMER100"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
                  disabled={editingCoupon !== null}
                />
              </div>

              <div className="space-y-2">
                <Label>What kind of discount? *</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={formType === "fixed_amount" ? "default" : "outline"}
                    className="h-14 flex-col gap-0.5"
                    onClick={() => setFormType("fixed_amount")}
                  >
                    <span className="flex items-center gap-1 font-semibold"><DollarSign className="h-4 w-4" />Dollars off</span>
                    <span className="text-xs opacity-80">e.g. $100 off</span>
                  </Button>
                  <Button
                    type="button"
                    variant={formType === "percentage" ? "default" : "outline"}
                    className="h-14 flex-col gap-0.5"
                    onClick={() => setFormType("percentage")}
                  >
                    <span className="flex items-center gap-1 font-semibold"><Percent className="h-4 w-4" />Percent off</span>
                    <span className="text-xs opacity-80">e.g. 10% off</span>
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="value">{formType === "percentage" ? "Percent off *" : formType === "fixed_amount" ? "Dollars off *" : "Amount *"}</Label>
                <div className="relative">
                  {formType === "fixed_amount" && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">$</span>
                  )}
                  <Input
                    id="value"
                    type="number"
                    inputMode="decimal"
                    min="1"
                    max={formType === "percentage" ? 100 : MAX_FIXED}
                    step={formType === "percentage" ? "1" : "0.01"}
                    disabled={formType === null}
                    placeholder={formType === null ? "Choose dollars or percent first" : formType === "percentage" ? "10" : "100"}
                    value={formValue}
                    onChange={(e) => setFormValue(e.target.value)}
                    className={formType === "fixed_amount" ? "pl-7" : formType === "percentage" ? "pr-8" : ""}
                  />
                  {formType === "percentage" && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">%</span>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="target">Takes the discount off *</Label>
                <Select value={formAppliesTo} onValueChange={(v: Target) => setFormAppliesTo(v)}>
                  <SelectTrigger id="target">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="base_rental">Base rental only</SelectItem>
                    <SelectItem value="total">Whole booking (rental + cleaning + package + add-ons)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {preview && (
                <div className={`rounded-md border p-3 text-sm space-y-1 ${large ? "border-red-300 bg-red-50 dark:bg-red-950/20" : "bg-muted/40"}`}>
                  <div className="font-semibold">
                    {formCode || "This code"} = {preview.description}
                  </div>
                  {formAppliesHourly && (
                    <div>
                      4-hour booking: {money(preview.hourly.grossSubtotal)} → guest pays <b>{money(preview.hourly.total)}</b>{" "}
                      <span className="text-muted-foreground">(saves {money(preview.hourly.discount?.amount ?? 0)})</span>
                    </div>
                  )}
                  {formAppliesDaily && (
                    <div>
                      Full-day booking: {money(preview.daily.grossSubtotal)} → guest pays <b>{money(preview.daily.total)}</b>{" "}
                      <span className="text-muted-foreground">(saves {money(preview.daily.discount?.amount ?? 0)})</span>
                    </div>
                  )}
                  {large && (
                    <div className="flex items-center gap-1 text-red-700 dark:text-red-400 font-medium pt-1">
                      <AlertTriangle className="h-4 w-4" /> Large discount: you'll be asked to confirm.
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <Label>Applies to * (select at least one)</Label>
                <div className="flex items-center space-x-2">
                  <Checkbox id="hourly" checked={formAppliesHourly} onCheckedChange={(c) => setFormAppliesHourly(c as boolean)} />
                  <label htmlFor="hourly" className="text-sm cursor-pointer">Hourly bookings</label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="daily" checked={formAppliesDaily} onCheckedChange={(c) => setFormAppliesDaily(c as boolean)} />
                  <label htmlFor="daily" className="text-sm cursor-pointer">Daily bookings</label>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox id="active" checked={formActive} onCheckedChange={(c) => setFormActive(c as boolean)} />
                <label htmlFor="active" className="text-sm cursor-pointer">Active (guests can use this code)</label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeForm}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={createCoupon.isPending || updateCoupon.isPending}>
                {editingCoupon ? "Save changes" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Coupons
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading coupons...</div>
          ) : !coupons || coupons.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No coupons yet. Click "Create Coupon" to add one.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Applies To</TableHead>
                  <TableHead className="text-right">Used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(coupons as unknown as CouponRow[]).map((coupon) => {
                  const value = Number(coupon.discount_value);
                  const target: Target = coupon.applies_to === "total" ? "total" : "base_rental";
                  const extreme =
                    (coupon.discount_type === "percentage" && value >= 50) ||
                    (coupon.discount_type === "fixed_amount" && value >= 300);
                  return (
                    <TableRow key={coupon.id}>
                      <TableCell><Badge>{coupon.code}</Badge></TableCell>
                      <TableCell className="font-medium">
                        <span className={extreme ? "text-red-700 dark:text-red-400" : ""}>
                          {describeDiscount(coupon.discount_type, value, target)}
                        </span>
                        {extreme && <AlertTriangle className="inline h-3.5 w-3.5 ml-1 text-red-600" />}
                      </TableCell>
                      <TableCell>{formatAppliesTo(coupon.applies_to_hourly, coupon.applies_to_daily)}</TableCell>
                      <TableCell className="text-right tabular-nums">{usedCount(coupon.code)}</TableCell>
                      <TableCell>
                        <Button variant={coupon.is_active ? "default" : "secondary"} size="sm" onClick={() => handleToggleActive(coupon)}>
                          {coupon.is_active ? "Active" : "Inactive"}
                        </Button>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{format(new Date(coupon.created_at), "MM/dd/yyyy")}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => handleEdit(coupon)} aria-label={`Edit ${coupon.code}`}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setHistoryCode(coupon.code)} aria-label={`History of ${coupon.code}`}>
                            <History className="h-4 w-4" />
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(coupon)} aria-label={`Delete ${coupon.code}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Large-discount confirmation: retype the code */}
      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!open) setConfirmOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" /> Confirm a large discount
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p><b>{formCode}</b> = {preview?.description}.</p>
                {typical && (
                  <p>
                    On a typical booking the guest saves <b>{money(typical.discount?.amount ?? 0)}</b> of {money(typical.grossSubtotal)} and pays {money(typical.total)}.
                  </p>
                )}
                <p>Type <b>{formCode}</b> to confirm.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value.toUpperCase())} placeholder={formCode} autoFocus />
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmText.trim() !== formCode.trim()}
              onClick={(e) => {
                e.preventDefault();
                if (confirmText.trim() !== formCode.trim()) return;
                setConfirmOpen(false);
                void save();
              }}
            >
              Save large discount
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* History */}
      <Dialog open={historyCode !== null} onOpenChange={(open) => { if (!open) setHistoryCode(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>History of {historyCode}</DialogTitle>
            <DialogDescription>Every change since 2026-11-09, newest first.</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-2 text-sm">
            {!history || history.length === 0 ? (
              <p className="text-muted-foreground">No recorded changes.</p>
            ) : (
              history.map((h, i) => {
                const after = h.new_row;
                const before = h.old_row;
                const fmt = (r: CouponSnapshotRow | null) => (r ? `${describeDiscount(r.discount_type, Number(r.discount_value), r.applies_to === "total" ? "total" : "base_rental")}${r.is_active ? "" : " (inactive)"}` : "");
                return (
                  <div key={i} className="rounded border p-2">
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(h.created_at), "MM/dd/yyyy h:mm a")} · {h.action} · {h.actor ? `admin ${h.actor.slice(0, 8)}` : "system"}
                    </div>
                    {before && h.action !== "insert" && <div className="line-through opacity-70">{fmt(before)}</div>}
                    {after && <div>{fmt(after)}</div>}
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteUsed > 0 ? `Deactivate ${deleteTarget?.code} instead?` : `Delete ${deleteTarget?.code}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteUsed > 0
                ? `This code was used on ${deleteUsed} booking${deleteUsed === 1 ? "" : "s"}, so it is kept for their records. Deactivating stops new guests from using it.`
                : "This code was never used. It will be permanently deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {deleteUsed > 0 ? (
              <AlertDialogAction
                onClick={() => {
                  if (deleteTarget?.is_active) void handleToggleActive(deleteTarget);
                  setDeleteTarget(null);
                }}
              >
                {deleteTarget?.is_active ? "Deactivate" : "Already inactive"}
              </AlertDialogAction>
            ) : (
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Delete
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
