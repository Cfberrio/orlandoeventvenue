-- Discount type enum
CREATE TYPE discount_type AS ENUM ('percentage', 'fixed_amount');

-- Discount coupons table
CREATE TABLE discount_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  discount_type discount_type NOT NULL,
  discount_value NUMERIC NOT NULL CHECK (discount_value > 0),
  applies_to TEXT DEFAULT 'base_rental' NOT NULL,
  applies_to_hourly BOOLEAN DEFAULT TRUE,
  applies_to_daily BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_discount_coupons_code ON discount_coupons(code);
CREATE INDEX idx_discount_coupons_active ON discount_coupons(is_active);

-- RLS Policies
ALTER TABLE discount_coupons ENABLE ROW LEVEL SECURITY;

-- Admin can do everything
CREATE POLICY "Admin full access to discount_coupons"
  ON discount_coupons
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.email IN (
        SELECT email FROM profiles WHERE role = 'admin'
      )
    )
  );

-- Public can read active coupons (for validation during booking)
CREATE POLICY "Public can read active coupons"
  ON discount_coupons
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- Updated_at trigger
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON discount_coupons
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Add helpful comment
COMMENT ON TABLE discount_coupons IS 'Discount coupons for booking base rental';
