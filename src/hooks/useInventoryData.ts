import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface InventoryProduct {
  id: string;
  name: string;
  unit: string;
  default_min_level: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryLocation {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface InventoryStock {
  id: string;
  product_id: string;
  location_id: string;
  current_level: number;
  min_level: number | null;
  status: "stocked" | "low" | "out";
  photo_url: string | null;
  notes: string | null;
  shelf_label: string | null;
  updated_by_user_id: string | null;
  updated_at: string;
  product?: InventoryProduct;
  location?: InventoryLocation;
}

export interface InventoryStockWithDetails extends InventoryStock {
  product: InventoryProduct;
  location: InventoryLocation;
}

export function useInventoryProducts() {
  return useQuery({
    queryKey: ["inventory-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_products")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as InventoryProduct[];
    },
  });
}

export function useInventoryLocations() {
  return useQuery({
    queryKey: ["inventory-locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_locations")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as InventoryLocation[];
    },
  });
}

export function useInventoryStock(locationSlug?: string) {
  return useQuery({
    queryKey: ["inventory-stock", locationSlug],
    queryFn: async () => {
      let query = supabase
        .from("inventory_stock")
        .select(`
          *,
          product:inventory_products(*),
          location:inventory_locations(*)
        `);

      if (locationSlug && locationSlug !== "all") {
        const { data: loc } = await supabase
          .from("inventory_locations")
          .select("id")
          .eq("slug", locationSlug)
          .maybeSingle();
        if (loc) {
          query = query.eq("location_id", loc.id);
        }
      }

      const { data, error } = await query.order("updated_at", { ascending: false });
      if (error) throw error;
      return data as InventoryStockWithDetails[];
    },
  });
}

export function useInventoryKPIs() {
  return useQuery({
    queryKey: ["inventory-kpis"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_stock")
        .select("status");
      if (error) throw error;

      const stocked = data.filter((s) => s.status === "stocked").length;
      const low = data.filter((s) => s.status === "low").length;
      const out = data.filter((s) => s.status === "out").length;

      // Get last update info
      const { data: lastUpdate } = await supabase
        .from("inventory_stock")
        .select("updated_at, updated_by_user_id")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return {
        stocked,
        low,
        out,
        lastUpdate: lastUpdate?.updated_at || null,
        lastUpdatedBy: lastUpdate?.updated_by_user_id || null,
      };
    },
  });
}

export function useUpdateInventoryStock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Omit<InventoryStock, "id" | "product" | "location">>;
    }) => {
      // Calculate status based on current_level and min_level
      let status = data.status;
      if (data.current_level !== undefined) {
        const minLevel = data.min_level ?? 1;
        if (data.current_level === 0) {
          status = "out";
        } else if (data.current_level < minLevel) {
          status = "low";
        } else {
          status = "stocked";
        }
      }

      const { error } = await supabase
        .from("inventory_stock")
        .update({ ...data, status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-stock"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-kpis"] });
    },
  });
}

export function useCreateInventoryStock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      product_id: string;
      location_id: string;
      current_level: number;
      min_level?: number;
      notes?: string;
      shelf_label?: string;
    }) => {
      // Calculate status
      const minLevel = data.min_level ?? 1;
      let status: "stocked" | "low" | "out" = "stocked";
      if (data.current_level === 0) {
        status = "out";
      } else if (data.current_level < minLevel) {
        status = "low";
      }

      const { error } = await supabase.from("inventory_stock").insert({
        ...data,
        status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-stock"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-kpis"] });
    },
  });
}

export function useUpsertInventoryFromCleaningReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      items,
      bookingReservationNumber,
    }: {
      items: Array<{ item_name: string; status: string; qty_used?: string }>;
      bookingReservationNumber?: string;
    }) => {
      // Get products and locations
      const { data: products } = await supabase
        .from("inventory_products")
        .select("id, name");
      const { data: locations } = await supabase
        .from("inventory_locations")
        .select("id, slug");

      if (!products || !locations) return;

      // Product name to location mapping
      const productLocationMap: Record<string, string> = {
        "trash bags": "kitchen_cabinets_lower_left",
        "bolsas grandes": "kitchen_cabinets_lower_left",
        "bolsas de 13g": "kitchen_cabinets_lower_left",
        "esponjas": "kitchen_cabinets_lower_left",
        "dawn": "kitchen_cabinets_lower_left",
        "cleaning spray": "kitchen_cabinets_lower_left",
        "clorox": "kitchen_cabinets_lower_left",
        "mapo": "kitchen_cabinets_lower_left",
        "paper towels": "storage_rack_entrance",
        "toallas de mano": "storage_rack_entrance",
        "papel higiénico": "storage_rack_entrance",
        "toilet paper": "bathroom_cabinets_womens",
        "hand soap": "bathroom_cabinets_womens",
        "bolsas pequeñas": "bathroom_cabinets_womens",
        "toallas sanitarias": "bathroom_cabinets_womens",
        "cepillo": "bathroom_cabinets_womens",
      };

      for (const item of items) {
        const itemNameLower = item.item_name.toLowerCase();

        // Try to match product
        const matchedProduct = products.find((p) =>
          itemNameLower.includes(p.name.toLowerCase()) ||
          p.name.toLowerCase().includes(itemNameLower)
        );

        if (!matchedProduct) continue;

        // Determine location
        let locationSlug = "kitchen_cabinets_lower_left";
        for (const [keyword, slug] of Object.entries(productLocationMap)) {
          if (itemNameLower.includes(keyword)) {
            locationSlug = slug;
            break;
          }
        }

        const matchedLocation = locations.find((l) => l.slug === locationSlug);
        if (!matchedLocation) continue;

        // Upsert stock
        const { data: existing } = await supabase
          .from("inventory_stock")
          .select("id, current_level")
          .eq("product_id", matchedProduct.id)
          .eq("location_id", matchedLocation.id)
          .maybeSingle();

        const status = item.status as "stocked" | "low" | "out";
        const currentLevel =
          status === "out" ? 0 : status === "low" ? 1 : existing?.current_level ?? 5;

        const notes = bookingReservationNumber
          ? `Updated from cleaning report for booking ${bookingReservationNumber}`
          : undefined;

        if (existing) {
          await supabase
            .from("inventory_stock")
            .update({ status, current_level: currentLevel, notes })
            .eq("id", existing.id);
        } else {
          await supabase.from("inventory_stock").insert({
            product_id: matchedProduct.id,
            location_id: matchedLocation.id,
            status,
            current_level: currentLevel,
            notes,
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-stock"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-kpis"] });
    },
  });
}
