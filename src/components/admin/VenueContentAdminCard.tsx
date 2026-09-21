import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { DoorOpen, Lightbulb, Wifi, ScrollText, Loader2, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";

interface Step {
  title?: string | null;
  text: string;
}

interface RuleRow {
  rule: string;
  fee?: string | null;
}

interface RuleCategory {
  title: string;
  rules: RuleRow[];
}

interface ContentRow {
  entry_steps: Step[];
  lighting_steps: Step[];
  wifi_network: string | null;
  wifi_password: string | null;
  venue_rules: RuleCategory[];
  updated_at: string;
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

const VenueContentAdminCard = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [entrySteps, setEntrySteps] = useState<Step[]>([]);
  const [lightingSteps, setLightingSteps] = useState<Step[]>([]);
  const [wifiNetwork, setWifiNetwork] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [venueRules, setVenueRules] = useState<RuleCategory[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("venue_access_content" as never)
      .select("entry_steps,lighting_steps,wifi_network,wifi_password,venue_rules,updated_at")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      toast.error("Could not load access page content", { description: error.message });
    } else if (data) {
      const row = data as unknown as ContentRow;
      setEntrySteps(row.entry_steps ?? []);
      setLightingSteps(row.lighting_steps ?? []);
      setWifiNetwork(row.wifi_network ?? "");
      setWifiPassword(row.wifi_password ?? "");
      setVenueRules(row.venue_rules ?? []);
      setUpdatedAt(row.updated_at ?? null);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("venue_access_content" as never)
      .update({
        entry_steps: entrySteps,
        lighting_steps: lightingSteps,
        wifi_network: wifiNetwork.trim() || null,
        wifi_password: wifiPassword.trim() || null,
        venue_rules: venueRules,
        updated_at: new Date().toISOString(),
        updated_by: userData?.user?.id ?? null,
      } as never)
      .eq("id", 1);
    setSaving(false);
    if (error) {
      toast.error("Could not save access page content", { description: error.message });
      return;
    }
    toast.success("Access page content updated");
    await load();
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-primary" />
          Access Page Content
        </CardTitle>
        <CardDescription>
          Entry instructions, lighting instructions, Wi-Fi, and venue rules shown to guests on
          the access code page. Use <code className="text-xs">{"{{code}}"}</code> in a step's text
          to insert the guest's door code.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* Entry steps */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <DoorOpen className="w-4 h-4" /> How to Enter the Venue
          </h3>
          {entrySteps.map((step, i) => (
            <div key={i} className="flex gap-2 items-start rounded-md border p-3">
              <div className="flex-1 space-y-2">
                <Input
                  placeholder="Step title (optional)"
                  value={step.title ?? ""}
                  onChange={(e) =>
                    setEntrySteps((s) => s.map((r, ri) => (ri === i ? { ...r, title: e.target.value } : r)))
                  }
                />
                <Textarea
                  placeholder="Step instructions"
                  value={step.text}
                  onChange={(e) =>
                    setEntrySteps((s) => s.map((r, ri) => (ri === i ? { ...r, text: e.target.value } : r)))
                  }
                  rows={2}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Button size="icon" variant="ghost" onClick={() => setEntrySteps((s) => move(s, i, i - 1))}>
                  <ArrowUp className="w-3.5 h-3.5" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setEntrySteps((s) => move(s, i, i + 1))}>
                  <ArrowDown className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setEntrySteps((s) => s.filter((_, ri) => ri !== i))}
                >
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEntrySteps((s) => [...s, { title: "", text: "" }])}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add step
          </Button>
        </section>

        <Separator />

        {/* Lighting steps */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Lightbulb className="w-4 h-4" /> How to Turn On the Lights
          </h3>
          {lightingSteps.map((step, i) => (
            <div key={i} className="flex gap-2 items-start rounded-md border p-3">
              <Textarea
                className="flex-1"
                placeholder="Step instructions"
                value={step.text}
                onChange={(e) =>
                  setLightingSteps((s) => s.map((r, ri) => (ri === i ? { ...r, text: e.target.value } : r)))
                }
                rows={2}
              />
              <div className="flex flex-col gap-1">
                <Button size="icon" variant="ghost" onClick={() => setLightingSteps((s) => move(s, i, i - 1))}>
                  <ArrowUp className="w-3.5 h-3.5" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setLightingSteps((s) => move(s, i, i + 1))}>
                  <ArrowDown className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setLightingSteps((s) => s.filter((_, ri) => ri !== i))}
                >
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLightingSteps((s) => [...s, { text: "" }])}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add step
          </Button>
        </section>

        <Separator />

        {/* Wi-Fi */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Wifi className="w-4 h-4" /> Wi-Fi Information
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="wifi-network">Network</Label>
              <Input id="wifi-network" value={wifiNetwork} onChange={(e) => setWifiNetwork(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wifi-password">Password</Label>
              <Input id="wifi-password" value={wifiPassword} onChange={(e) => setWifiPassword(e.target.value)} />
            </div>
          </div>
        </section>

        <Separator />

        {/* Venue rules */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ScrollText className="w-4 h-4" /> Venue Rules
          </h3>
          {venueRules.map((category, ci) => (
            <div key={ci} className="rounded-md border p-3 space-y-3">
              <div className="flex gap-2 items-start">
                <Input
                  className="flex-1 font-semibold"
                  placeholder="Category title"
                  value={category.title}
                  onChange={(e) =>
                    setVenueRules((cats) =>
                      cats.map((c, i) => (i === ci ? { ...c, title: e.target.value } : c)),
                    )
                  }
                />
                <div className="flex flex-col gap-1">
                  <Button size="icon" variant="ghost" onClick={() => setVenueRules((c) => move(c, ci, ci - 1))}>
                    <ArrowUp className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setVenueRules((c) => move(c, ci, ci + 1))}>
                    <ArrowDown className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setVenueRules((c) => c.filter((_, i) => i !== ci))}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              {category.rules.map((row, ri) => (
                <div key={ri} className="flex gap-2 items-start pl-3 border-l-2">
                  <Textarea
                    className="flex-[2]"
                    placeholder="Rule"
                    value={row.rule}
                    onChange={(e) =>
                      setVenueRules((cats) =>
                        cats.map((c, i) =>
                          i === ci
                            ? { ...c, rules: c.rules.map((r, j) => (j === ri ? { ...r, rule: e.target.value } : r)) }
                            : c,
                        ),
                      )
                    }
                    rows={2}
                  />
                  <Input
                    className="flex-1"
                    placeholder="Fee or consequence (optional)"
                    value={row.fee ?? ""}
                    onChange={(e) =>
                      setVenueRules((cats) =>
                        cats.map((c, i) =>
                          i === ci
                            ? { ...c, rules: c.rules.map((r, j) => (j === ri ? { ...r, fee: e.target.value } : r)) }
                            : c,
                        ),
                      )
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      setVenueRules((cats) =>
                        cats.map((c, i) => (i === ci ? { ...c, rules: c.rules.filter((_, j) => j !== ri) } : c)),
                      )
                    }
                  >
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setVenueRules((cats) =>
                    cats.map((c, i) => (i === ci ? { ...c, rules: [...c.rules, { rule: "", fee: "" }] } : c)),
                  )
                }
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add rule
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVenueRules((c) => [...c, { title: "", rules: [] }])}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add category
          </Button>
        </section>

        <div className="flex items-center gap-3 pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…
              </>
            ) : (
              "Save Content"
            )}
          </Button>
          {updatedAt && (
            <span className="text-xs text-muted-foreground">
              Last updated {new Date(updatedAt).toLocaleString()}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default VenueContentAdminCard;
