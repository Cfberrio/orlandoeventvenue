import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Wine, AlertTriangle, CheckCircle2, Phone, PhoneOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useStaffMembers } from "@/hooks/useAdminData";

interface BarServiceCardProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking: any;
}

export const BAR_VENDOR_ROLE = "Bar Vendor";

/**
 * Returns null if booking can move to pre_event_ready, or a user-friendly
 * error string explaining why the bar service requirements aren't met.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function checkBarServicePreEventBlock(booking: any): string | null {
  if (!booking) return null;
  if (!booking.bar_package || booking.bar_package === "none") return null;
  if (!booking.bar_vendor_id || booking.bar_customer_contacted !== true) {
    return "⛔ Cannot move to Pre-Event Ready.\nBar service is selected but vendor contact is not confirmed.\nAssign a bar vendor and wait for client contact confirmation.";
  }
  return null;
}

export default function BarServiceCard({ booking }: BarServiceCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: allStaff } = useStaffMembers({ isActive: true, role: BAR_VENDOR_ROLE });

  const hasBar = booking.bar_package && booking.bar_package !== "none";
  const vendors = useMemo(() => allStaff || [], [allStaff]);
  const [saving, setSaving] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["booking", booking.id] });
    queryClient.invalidateQueries({ queryKey: ["booking-staff-assignments", booking.id] });
  };

  const handleSelectVendor = async (vendorId: string) => {
    if (!hasBar) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      // Try to find existing bar service assignment
      const { data: existing } = await supabase
        .from("booking_staff_assignments")
        .select("id, staff_id")
        .eq("booking_id", booking.id)
        .eq("assignment_type", "bar_service")
        .neq("status", "cancelled")
        .maybeSingle();

      let assignmentId: string | undefined = existing?.id;

      if (existing) {
        const { error } = await supabase
          .from("booking_staff_assignments")
          .update({
            staff_id: vendorId,
            assignment_role: BAR_VENDOR_ROLE,
            assignment_type: "bar_service",
            customer_contact_required: true,
            customer_contacted: false,
            customer_contacted_at: null,
            customer_contact_due_at: dueAt,
            updated_at: now,
          })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { data: created, error } = await supabase
          .from("booking_staff_assignments")
          .insert({
            booking_id: booking.id,
            staff_id: vendorId,
            assignment_role: BAR_VENDOR_ROLE,
            assignment_type: "bar_service",
            customer_contact_required: true,
            customer_contacted: false,
            customer_contact_due_at: dueAt,
            status: "assigned",
          })
          .select("id")
          .single();
        if (error) throw error;
        assignmentId = created.id;
      }

      const { error: bErr } = await supabase
        .from("bookings")
        .update({
          bar_vendor_id: vendorId,
          bar_vendor_assignment_id: assignmentId,
          bar_vendor_assigned_at:
            booking.bar_vendor_assigned_at && booking.bar_vendor_id === vendorId
              ? booking.bar_vendor_assigned_at
              : now,
          bar_customer_contacted: false,
          bar_customer_contacted_at: null,
          bar_customer_contacted_by: null,
        })
        .eq("id", booking.id);
      if (bErr) throw bErr;

      toast({ title: "Bar vendor assigned" });
      invalidate();
    } catch (err) {
      console.error(err);
      toast({
        title: "Failed to assign bar vendor",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleContacted = async (markContacted: boolean) => {
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from("bookings")
        .update({
          bar_customer_contacted: markContacted,
          bar_customer_contacted_at: markContacted ? now : null,
          bar_customer_contacted_by: markContacted ? user?.id ?? null : null,
        })
        .eq("id", booking.id);
      if (error) throw error;

      if (booking.bar_vendor_assignment_id) {
        await supabase
          .from("booking_staff_assignments")
          .update({
            customer_contacted: markContacted,
            customer_contacted_at: markContacted ? now : null,
            customer_contacted_by: markContacted ? user?.id ?? null : null,
          })
          .eq("id", booking.bar_vendor_assignment_id);
      }

      toast({
        title: markContacted ? "Marked customer contacted" : "Marked as not contacted",
      });
      invalidate();
    } catch (err) {
      console.error(err);
      toast({
        title: "Failed to update contact status",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePhoneReleased = async (release: boolean) => {
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("bookings")
        .update({
          bar_client_phone_released: release,
          bar_client_phone_released_at: release ? now : null,
        })
        .eq("id", booking.id);
      if (error) throw error;
      toast({
        title: release ? "Client phone released to bar vendor" : "Client phone hidden from bar vendor",
      });
      invalidate();
    } catch (err) {
      console.error(err);
      toast({
        title: "Failed to update phone release",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-l-4 border-l-amber-500">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Wine className="h-5 w-5 text-amber-600" />
          Bar Service
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-muted-foreground text-xs">Package</div>
            <div className="font-medium">
              {hasBar ? booking.bar_package_label || booking.bar_package : "No bar service"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Guests</div>
            <div className="font-medium">{hasBar ? booking.bar_guest_count ?? "—" : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Subtotal</div>
            <div className="font-medium">
              ${Number(hasBar ? booking.bar_subtotal || 0 : 0).toFixed(2)}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Vendor</label>
          <Select
            value={booking.bar_vendor_id || ""}
            onValueChange={handleSelectVendor}
            disabled={!hasBar || saving}
          >
            <SelectTrigger>
              <SelectValue placeholder={hasBar ? "Select bar vendor" : "Not applicable"} />
            </SelectTrigger>
            <SelectContent>
              {vendors.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  No active Bar Vendors. Add one in Staff.
                </div>
              ) : (
                vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.full_name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Status</label>
          <div className="flex items-center justify-between gap-2">
            {!hasBar ? (
              <Badge variant="outline" className="opacity-60">
                N/A
              </Badge>
            ) : booking.bar_customer_contacted ? (
              <Badge className="bg-green-100 text-green-800 border-green-300 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Customer Contacted
              </Badge>
            ) : (
              <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Awaiting Vendor Contact
              </Badge>
            )}

            {hasBar && booking.bar_vendor_id && (
              booking.bar_customer_contacted ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleToggleContacted(false)}
                  disabled={saving}
                >
                  Mark as not contacted
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => handleToggleContacted(true)}
                  disabled={saving}
                >
                  Mark customer contacted
                </Button>
              )
            )}
          </div>
        </div>

        {/* Phone release control for bar vendor visibility */}
        {hasBar && booking.bar_vendor_id && (
          <div className="space-y-2 pt-2 border-t">
            <label className="text-sm font-medium">Client Phone Visibility</label>
            <div className="flex items-center justify-between gap-2">
              {booking.bar_client_phone_released ? (
                <Badge className="bg-blue-100 text-blue-800 border-blue-300 flex items-center gap-1">
                  <Phone className="h-3 w-3" /> Released to Bar Vendor
                </Badge>
              ) : (
                <Badge variant="outline" className="flex items-center gap-1">
                  <PhoneOff className="h-3 w-3" /> Hidden until day-of event
                </Badge>
              )}
              {booking.bar_client_phone_released ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleTogglePhoneReleased(false)}
                  disabled={saving}
                >
                  Hide client phone
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleTogglePhoneReleased(true)}
                  disabled={saving}
                >
                  Release client phone to bar vendor
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
