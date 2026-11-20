// E-7 (86e40ach2): hourly staff whose completed assignment has no hours are
// paid $0 without a warning. List them and let the office enter the hours;
// the database recalculates the pay line.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface MissingRow {
  assignment_id: string;
  booking_id: string | null;
  reservation_number: string | null;
  event_date: string | null;
  staff_name: string;
  assignment_role: string;
  hourly_rate: number;
}

// ST2-21: completed work by someone whose pay type is "none" makes no line.
interface NoPayRow {
  assignment_id: string;
  booking_id: string | null;
  reservation_number: string | null;
  work_date: string | null;
  staff_name: string;
  assignment_role: string;
}

export function parseHours(raw: string): number | null {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n) || n <= 0 || n > 24) return null;
  return Math.round(n * 100) / 100;
}

export default function MissingHoursCard({ onChanged }: { onChanged?: () => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<MissingRow[]>([]);
  const [noPay, setNoPay] = useState<NoPayRow[]>([]);
  const [hours, setHours] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("admin_assignments_missing_hours");
    if (error) {
      setLoadError(error.message);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: noPayData, error: noPayError } = await (supabase.rpc as any)("admin_completed_work_without_pay");
    if (noPayError) {
      setLoadError(noPayError.message);
      return;
    }
    setLoadError(null);
    setRows((data as MissingRow[]) ?? []);
    setNoPay((noPayData as NoPayRow[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (row: MissingRow) => {
    const h = parseHours(hours[row.assignment_id] ?? "");
    if (h == null) {
      toast({ title: "Enter the hours worked (between 0 and 24)", variant: "destructive" });
      return;
    }
    setSaving(row.assignment_id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("admin_set_assignment_hours", {
      p_assignment_id: row.assignment_id,
      p_hours: h,
    });
    setSaving(null);
    if (error) {
      toast({ title: "Hours not saved", description: error.message, variant: "destructive" });
      return;
    }
    const amount = Number((data as { amount?: number })?.amount ?? 0);
    toast({ title: "Hours saved", description: `${row.staff_name}: ${h}h, pay line $${amount.toFixed(2)}` });
    await load();
    onChanged?.();
  };

  if (loadError) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6 text-sm text-destructive">Could not check for missing hours: {loadError}</CardContent>
      </Card>
    );
  }
  if (rows.length === 0 && noPay.length === 0) return null;

  return (
    <>
    {noPay.length > 0 && (
      <Card className="border-amber-400">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            No pay type: {noPay.length} completed assignment{noPay.length === 1 ? "" : "s"} paid $0
          </CardTitle>
          <CardDescription>
            These people have pay type "None" on Staff, so payroll created no line for work they completed in the last 45 days.
            If the venue should pay this person, set their pay type on Staff (future work is then paid; this work needs a pay line added by hand).
            If the venue does not pay them, nothing is needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {noPay.map((row) => (
            <div key={row.assignment_id} className="text-sm border-b pb-2 last:border-0 break-words">
              <span className="font-medium">{row.staff_name} · {row.assignment_role}</span>
              <span className="text-muted-foreground">
                {" · "}
                {row.booking_id ? (
                  <Link className="underline" to={`/admin/bookings/${row.booking_id}`}>
                    {row.reservation_number ?? "Booking"}
                  </Link>
                ) : (
                  "Standalone"
                )}
                {row.work_date ? ` · ${row.work_date}` : ""}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    )}
    {rows.length > 0 && (
    <Card className="border-amber-400">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          Hours missing: {rows.length} hourly assignment{rows.length === 1 ? "" : "s"} paid $0
        </CardTitle>
        <CardDescription>
          These events are done but nobody recorded how long the person worked, so payroll created no pay line.
          Enter the hours to generate it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row) => (
          <div key={row.assignment_id} className="flex flex-wrap items-center gap-3 border-b pb-3 last:border-0">
            <div className="min-w-[220px] flex-1 text-sm">
              <div className="font-medium">
                {row.staff_name} · {row.assignment_role}
              </div>
              <div className="text-muted-foreground">
                {row.booking_id ? (
                  <Link className="underline" to={`/admin/bookings/${row.booking_id}`}>
                    {row.reservation_number ?? "Booking"}
                  </Link>
                ) : (
                  "Standalone"
                )}
                {row.event_date ? ` · ${row.event_date}` : ""} · ${Number(row.hourly_rate).toFixed(2)}/h
              </div>
            </div>
            <Input
              className="w-24"
              type="number"
              min="0"
              max="24"
              step="0.25"
              placeholder="Hours"
              value={hours[row.assignment_id] ?? ""}
              onChange={(e) => setHours((h) => ({ ...h, [row.assignment_id]: e.target.value }))}
            />
            <Button size="sm" onClick={() => save(row)} disabled={saving === row.assignment_id}>
              {saving === row.assignment_id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save hours
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
    )}
    </>
  );
}
