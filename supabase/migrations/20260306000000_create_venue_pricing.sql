-- Create venue_pricing table for dynamic pricing management
CREATE TABLE IF NOT EXISTS venue_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN ('rental', 'package', 'service', 'fee')),
  item_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  price_unit TEXT NOT NULL DEFAULT 'flat' CHECK (price_unit IN ('per_hour', 'per_unit', 'flat', 'percentage')),
  extra_fee DECIMAL(10,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with current hardcoded values
INSERT INTO venue_pricing (category, item_key, label, description, price, price_unit, extra_fee, sort_order) VALUES
  ('rental', 'hourly_rate', 'Hourly Rate', 'Base venue rental per hour', 140.00, 'per_hour', 0, 1),
  ('rental', 'daily_rate', 'Daily Rate', 'Full day venue rental (24 hours)', 899.00, 'flat', 0, 2),
  ('fee', 'cleaning_fee', 'Cleaning Fee', 'Standard cleaning fee per event', 199.00, 'flat', 0, 3),
  ('package', 'package_basic', 'Basic A/V Package', 'AV System, Microphones, Speakers, Projectors, Tech Assistant', 79.00, 'per_hour', 0, 10),
  ('package', 'package_led', 'LED Wall Package', 'Basic + Stage LED Wall for presentations and immersive experiences', 99.00, 'per_hour', 0, 11),
  ('package', 'package_workshop', 'Workshop/Streaming Package', 'LED + Streaming Equipment + Streaming Tech for streaming, recording, and VC', 149.00, 'per_hour', 0, 12),
  ('service', 'setup_breakdown', 'Setup & Breakdown of Chairs/Tables', 'Full furniture setup and breakdown for your event', 100.00, 'flat', 0, 20),
  ('service', 'tablecloth_rental', 'Tablecloth Rental', 'Professional tablecloths for your event (max 10)', 5.00, 'per_unit', 25.00, 21),
  ('fee', 'deposit_percentage', 'Deposit Percentage', 'Percentage of subtotal required as deposit', 50.00, 'percentage', 0, 30),
  ('fee', 'processing_fee', 'Processing Fee', 'Applied per transaction at checkout', 3.50, 'percentage', 0, 31)
ON CONFLICT (item_key) DO NOTHING;

-- Enable RLS
ALTER TABLE venue_pricing ENABLE ROW LEVEL SECURITY;

-- Public read access (needed for /book page)
CREATE POLICY "venue_pricing_public_read" ON venue_pricing
  FOR SELECT USING (true);

-- Admin write access (authenticated users only)
CREATE POLICY "venue_pricing_admin_write" ON venue_pricing
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_venue_pricing_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER venue_pricing_updated_at
  BEFORE UPDATE ON venue_pricing
  FOR EACH ROW
  EXECUTE FUNCTION update_venue_pricing_updated_at();
