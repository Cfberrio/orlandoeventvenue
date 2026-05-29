import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type BarPackageKey =
  | "none"
  | "house_beer_wine"
  | "essential_bar"
  | "signature_bar"
  | "bespoke_bar";

export interface BarPackage {
  key: BarPackageKey;
  label: string;
  ratePerGuest: number;
  description?: string | null;
  sortOrder: number;
  badge?: string;
}

const FALLBACK_BAR_PACKAGES: BarPackage[] = [
  { key: "house_beer_wine", label: "House Beer & Wine", ratePerGuest: 18.0, sortOrder: 1 },
  { key: "essential_bar", label: "Essential Bar", ratePerGuest: 25.63, sortOrder: 2 },
  { key: "signature_bar", label: "Signature Bar", ratePerGuest: 32.13, sortOrder: 3, badge: "Most Popular" },
  { key: "bespoke_bar", label: "Bespoke Bar", ratePerGuest: 39.63, sortOrder: 4 },
];

const STALE_TIME_MS = 5 * 60 * 1000;

async function fetchBarPackages(): Promise<BarPackage[]> {
  const { data, error } = await supabase
    .from("venue_pricing" as any)
    .select("*")
    .eq("category", "bar_service")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as any[];
  if (!rows.length) return FALLBACK_BAR_PACKAGES;

  return rows
    .filter((r) => r.item_key && r.item_key !== "none")
    .map((r) => ({
      key: r.item_key as BarPackageKey,
      label: r.label,
      ratePerGuest: Number(r.price),
      description: r.description,
      sortOrder: r.sort_order ?? 0,
      badge: r.item_key === "signature_bar" ? "Most Popular" : undefined,
    }));
}

export function useBarPackages() {
  const query = useQuery({
    queryKey: ["bar-packages"],
    queryFn: fetchBarPackages,
    staleTime: STALE_TIME_MS,
    retry: 2,
  });

  const packages: BarPackage[] = query.data && query.data.length > 0
    ? query.data
    : FALLBACK_BAR_PACKAGES;

  return {
    packages,
    isLoading: query.isLoading,
    error: query.error,
  };
}

export function getBarRate(packages: BarPackage[], key: BarPackageKey): number {
  if (key === "none") return 0;
  return packages.find((p) => p.key === key)?.ratePerGuest ?? 0;
}

export function getBarLabel(packages: BarPackage[], key: BarPackageKey): string | null {
  if (key === "none") return null;
  return packages.find((p) => p.key === key)?.label ?? null;
}

export function calcBarSubtotal(rate: number, guests: number): number {
  if (!rate || !guests || guests <= 0) return 0;
  // Two-decimal precision
  return Math.round(rate * guests * 100) / 100;
}
