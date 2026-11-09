import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildPricingRates, FALLBACK_RATES } from "@/lib/bookingPricing";

export interface VenuePricingItem {
  id: string;
  category: "rental" | "package" | "service" | "fee";
  item_key: string;
  label: string;
  description: string | null;
  price: number;
  price_unit: "per_hour" | "per_unit" | "flat" | "percentage";
  extra_fee: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PricingMap {
  hourly_rate: number;
  daily_rate: number;
  cleaning_fee: number;
  package_basic: number;
  package_led: number;
  package_workshop: number;
  setup_breakdown: number;
  tablecloth_rental: number;
  tablecloth_cleaning_fee: number;
  deposit_percentage: number;
  processing_fee: number;
}

// Same mapping and fallbacks create-checkout uses (src/lib/bookingPricing.ts).
const FALLBACK_PRICING: PricingMap = { ...FALLBACK_RATES };

const STALE_TIME_MS = 5 * 60 * 1000;

async function fetchPricing(): Promise<VenuePricingItem[]> {
  const { data, error } = await supabase
    .from("venue_pricing" as any)
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Failed to fetch venue pricing:", error);
    throw error;
  }

  return (data ?? []) as unknown as VenuePricingItem[];
}

function buildPricingMap(items: VenuePricingItem[]): PricingMap {
  return buildPricingRates(items);
}

export function usePricing() {
  const query = useQuery({
    queryKey: ["venue-pricing"],
    queryFn: fetchPricing,
    staleTime: STALE_TIME_MS,
    retry: 2,
  });

  const pricing: PricingMap = query.data
    ? buildPricingMap(query.data)
    : FALLBACK_PRICING;

  return {
    pricing,
    items: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

export function usePricingAdmin() {
  return useQuery({
    queryKey: ["venue-pricing-admin"],
    queryFn: async (): Promise<VenuePricingItem[]> => {
      const { data, error } = await supabase
        .from("venue_pricing" as any)
        .select("*")
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as VenuePricingItem[];
    },
    staleTime: 0,
  });
}
