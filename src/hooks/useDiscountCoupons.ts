import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface DiscountCoupon {
  id: string;
  code: string;
  discount_percentage: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateCouponInput {
  code: string;
  discount_percentage: number;
  is_active?: boolean;
}

export interface UpdateCouponInput {
  id: string;
  code?: string;
  discount_percentage?: number;
  is_active?: boolean;
}

/**
 * Fetch all discount coupons
 */
export function useDiscountCoupons() {
  return useQuery({
    queryKey: ["discount-coupons"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("discount_coupons")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as DiscountCoupon[];
    },
  });
}

/**
 * Validate a coupon by code (for booking flow)
 */
export function useValidateCoupon(code: string | null) {
  return useQuery({
    queryKey: ["validate-coupon", code],
    queryFn: async () => {
      if (!code) return null;

      const { data, error } = await supabase
        .from("discount_coupons")
        .select("*")
        .eq("code", code.toUpperCase())
        .eq("is_active", true)
        .maybeSingle();

      if (error) throw error;
      return data as DiscountCoupon | null;
    },
    enabled: !!code,
  });
}

/**
 * Create a new discount coupon
 */
export function useCreateCoupon() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreateCouponInput) => {
      // Normalize code to uppercase
      const normalizedCode = input.code.trim().toUpperCase();

      const { data, error } = await supabase
        .from("discount_coupons")
        .insert({
          code: normalizedCode,
          discount_percentage: input.discount_percentage,
          is_active: input.is_active ?? true,
        })
        .select()
        .single();

      if (error) throw error;
      return data as DiscountCoupon;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discount-coupons"] });
      toast({
        title: "Coupon created",
        description: "The discount coupon has been created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error creating coupon",
        description: error.message || "Failed to create coupon. Please try again.",
        variant: "destructive",
      });
    },
  });
}

/**
 * Update an existing discount coupon
 */
export function useUpdateCoupon() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: UpdateCouponInput) => {
      const { id, ...updates } = input;

      // Normalize code if being updated
      if (updates.code) {
        updates.code = updates.code.trim().toUpperCase();
      }

      const { data, error } = await supabase
        .from("discount_coupons")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as DiscountCoupon;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discount-coupons"] });
      toast({
        title: "Coupon updated",
        description: "The discount coupon has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating coupon",
        description: error.message || "Failed to update coupon. Please try again.",
        variant: "destructive",
      });
    },
  });
}

/**
 * Delete a discount coupon
 */
export function useDeleteCoupon() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("discount_coupons")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discount-coupons"] });
      toast({
        title: "Coupon deleted",
        description: "The discount coupon has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting coupon",
        description: error.message || "Failed to delete coupon. Please try again.",
        variant: "destructive",
      });
    },
  });
}
