-- Create discount_coupons table for managing discount codes
CREATE TABLE public.discount_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  discount_percentage INTEGER NOT NULL CHECK (discount_percentage > 0 AND discount_percentage <= 100),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_discount_coupons_code ON public.discount_coupons(code);
CREATE INDEX idx_discount_coupons_active ON public.discount_coupons(is_active);

-- Enable RLS
ALTER TABLE public.discount_coupons ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Only authenticated users (admins) can manage coupons
CREATE POLICY "Admin can manage coupons" ON public.discount_coupons 
  FOR ALL 
  USING (auth.role() = 'authenticated');

-- Trigger for updated_at
CREATE TRIGGER set_updated_at 
  BEFORE UPDATE ON public.discount_coupons
  FOR EACH ROW 
  EXECUTE FUNCTION public.set_updated_at();

-- Add comment
COMMENT ON TABLE public.discount_coupons IS 'Stores discount coupon codes that can be applied to base rental costs';
