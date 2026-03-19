import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

const FALLBACK_PRICING: PricingMap = {
  hourly_rate: 140,
  daily_rate: 899,
  cleaning_fee: 199,
  package_basic: 79,
  package_led: 99,
  package_workshop: 149,
  setup_breakdown: 100,
  tablecloth_rental: 5,
  tablecloth_cleaning_fee: 25,
  deposit_percentage: 50,
  processing_fee: 3.5,
};

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
  const map = { ...FALLBACK_PRICING };

  for (const item of items) {
    const price = Number(item.price);
    switch (item.item_key) {
      case "hourly_rate":
        map.hourly_rate = price;
        break;
      case "daily_rate":
        map.daily_rate = price;
        break;
      case "cleaning_fee":
        map.cleaning_fee = price;
        break;
      case "package_basic":
        map.package_basic = price;
        break;
      case "package_led":
        map.package_led = price;
        break;
      case "package_workshop":
        map.package_workshop = price;
        break;
      case "setup_breakdown":
        map.setup_breakdown = price;
        break;
      case "tablecloth_rental":
        map.tablecloth_rental = price;
        map.tablecloth_cleaning_fee = Number(item.extra_fee) || 0;
        break;
      case "deposit_percentage":
        map.deposit_percentage = price;
        break;
      case "processing_fee":
        map.processing_fee = price;
        break;
    }
  }

  return map;
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
