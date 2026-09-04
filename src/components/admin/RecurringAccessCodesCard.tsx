import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "sonner";
import { Repeat, Loader2, Copy, Pause, Play, Trash2, Plus } from "lucide-react";

interface RecurringCode {
  id: string;
  reservation_number: string;
  holder_name: string;
  email: string | null;
  status: "active" | "paused";
  valid_from: string;
  /** NULL means the code never expires — that is what new codes get. */
  expires_on: string | null;
  notes: string | null;
}

function formatDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isExpired(code: RecurringCode): boolean {
  if (!code.expires_on) return false;
  const today = new Date().toISOString().slice(0, 10);
  return code.expires_on < today;
}

const RecurringAccessCodesCard = () => {
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [codes, setCodes] = useState<RecurringCode[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<RecurringCode | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNumber, setNewNumber] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("recurring_access_codes" as never)
      .select("id,reservation_number,holder_name,email,status,valid_from,expires_on,notes")
      .order("holder_name");
    if (error) {
      toast.error("Could not load recurring codes", { description: error.message });
    } else {
      setCodes((data ?? []) as unknown as RecurringCode[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const updateCode = async (id: string, patch: Record<string, unknown>, successMsg: string) => {
    setBusyId(id);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("recurring_access_codes" as never)
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
        updated_by: userData?.user?.id ?? null,
      } as never)
      .eq("id", id);
    setBusyId(null);
    if (error) {
      toast.error("Update failed", { description: error.message });
      return;
    }
    toast.success(successMsg);
    await load();
  };

  const togglePause = (code: RecurringCode) => {
    const next = code.status === "active" ? "paused" : "active";
    void updateCode(
      code.id,
      { status: next },
      next === "paused" ? `${code.holder_name} paused` : `${code.holder_name} reactivated`,
    );
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    const { error } = await supabase
      .from("recurring_access_codes" as never)
      .delete()
      .eq("id", deleteTarget.id);
    setBusyId(null);
    setDeleteTarget(null);
    if (error) {
      toast.error("Delete failed", { description: error.message });
      return;
    }
    toast.success("Recurring code deleted");
    await load();
  };

  const handleAdd = async () => {
    const name = newName.trim();
    const number = newNumber.trim().toUpperCase();
    if (!name || !number) {
      toast.error("Name and reservation number are required");
      return;
    }
    // Any combination of letters and numbers is allowed (SyncUp 09/04). Dashes
    // stay legal for readability — the public lookup ignores them anyway.
    if (!/^[A-Z0-9-]+$/.test(number) || !/[A-Z0-9]/.test(number)) {
      toast.error("Reservation number can only contain letters, numbers and dashes");
      return;
    }
    setAdding(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("recurring_access_codes" as never).insert({
      reservation_number: number,
      holder_name: name,
      email: newEmail.trim() || null,
      valid_from: new Date().toISOString().slice(0, 10),
      // No expiration — the code stays valid until it is paused or deleted.
      expires_on: null,
      updated_by: userData?.user?.id ?? null,
    } as never);
    setAdding(false);
    if (error) {
      toast.error("Could not create code", { description: error.message });
      return;
    }
    toast.success(`${number} created (no expiration)`);
    setNewName("");
    setNewNumber("");
    setNewEmail("");
    setShowAdd(false);
    await load();
  };

  const copyLink = (code: RecurringCode) => {
    navigator.clipboard.writeText(
      `${window.location.origin}/accesscode?res=${encodeURIComponent(code.reservation_number)}`,
    );
    toast.success("Access link copied");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Repeat className="w-5 h-5 text-primary" />
          RECURRING ACCESS CODES
        </CardTitle>
        <CardDescription>
          Permanent reservation numbers for recurring tenants and internal staff (FCG, Global,
          Guest). Each code works on the public access page indefinitely and can be paused or
          removed at any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…
          </div>
        ) : codes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recurring codes yet.</p>
        ) : (
          <div className="space-y-3">
            {codes.map((code) => {
              const expired = isExpired(code);
              const busy = busyId === code.id;
              return (
                <div
                  key={code.id}
                  className="rounded-md border p-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{code.holder_name}</span>
                      <code className="font-mono text-sm">{code.reservation_number}</code>
                      {expired ? (
                        <Badge variant="destructive">Expired</Badge>
                      ) : code.status === "paused" ? (
                        <Badge variant="outline" className="border-amber-500 text-amber-600">
                          Paused
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-green-500 text-green-600">
                          Active
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {code.email || "No email on file"} · since {formatDate(code.valid_from)} ·{" "}
                      {code.expires_on ? `expires ${formatDate(code.expires_on)}` : "no expiration"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyLink(code)}
                      title="Copy access link"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => togglePause(code)}
                      title={code.status === "active" ? "Pause" : "Resume"}
                    >
                      {busy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : code.status === "active" ? (
                        <Pause className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={() => setDeleteTarget(code)}
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {showAdd ? (
          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="rac-name">Name</Label>
                <Input
                  id="rac-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="FCG"
                  maxLength={60}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rac-number">Reservation #</Label>
                <Input
                  id="rac-number"
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value.toUpperCase())}
                  placeholder="OEV-RXXX01"
                  className="font-mono"
                  maxLength={20}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rac-email">Email (optional)</Label>
                <Input
                  id="rac-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="tenant@example.com"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleAdd} disabled={adding}>
                {adding ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Add recurring code
          </Button>
        )}
      </CardContent>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.holder_name}'s recurring code?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.reservation_number} will stop working on the access page immediately.
              If access is needed again later, a new code can be issued. To stop access temporarily,
              use Pause instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default RecurringAccessCodesCard;
