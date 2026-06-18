import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound, Loader2, Copy, ExternalLink } from "lucide-react";

interface Row {
  code: string;
  label: string | null;
  updated_at: string;
}

const AccessCodeAdminCard = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [original, setOriginal] = useState<Row | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("venue_access_code" as never)
      .select("code,label,updated_at")
      .eq("id", 1)
      .maybeSingle();
    if (!error && data) {
      const row = data as unknown as Row;
      setOriginal(row);
      setCode(row.code);
      setLabel(row.label ?? "");
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      toast.error("Code cannot be empty");
      return;
    }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("venue_access_code" as never)
      .update({
        code: trimmed,
        label: label.trim() || null,
        updated_at: new Date().toISOString(),
        updated_by: userData?.user?.id ?? null,
      } as never)
      .eq("id", 1);
    setSaving(false);
    if (error) {
      toast.error("Could not save code", { description: error.message });
      return;
    }
    toast.success("Access code updated");
    await load();
  };

  const accessUrl = `${window.location.origin}/accesscode`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-primary" />
          OEV DAY OF EVENT
        </CardTitle>
        <CardDescription>
          Update the lockbox/access code shown to guests on the public lookup page.
          Guests find this page via the link sent in their reminder emails.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 space-y-1">
                <Label htmlFor="vac-code">Current Code</Label>
                <Input
                  id="vac-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="font-mono tracking-widest text-lg"
                  maxLength={32}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="vac-label">Label (optional)</Label>
                <Input
                  id="vac-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Lockbox keypad"
                  maxLength={60}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={handleSave}
                disabled={saving || (code === original?.code && (label || null) === (original?.label ?? null))}
              >
                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : "Save Code"}
              </Button>
              {original?.updated_at && (
                <span className="text-xs text-muted-foreground">
                  Last updated {new Date(original.updated_at).toLocaleString()}
                </span>
              )}
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Public lookup link
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate text-xs">{accessUrl}</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(accessUrl);
                    toast.success("Link copied");
                  }}
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={accessUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Guests enter their reservation number on this page to see the current code.
                Reminder emails now link here instead of including the code directly.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default AccessCodeAdminCard;
