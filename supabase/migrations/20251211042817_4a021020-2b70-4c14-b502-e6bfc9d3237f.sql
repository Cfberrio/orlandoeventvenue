-- Create inventory_products table
CREATE TABLE public.inventory_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'unit',
  default_min_level INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create inventory_locations table
CREATE TABLE public.inventory_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create inventory_stock table
CREATE TABLE public.inventory_stock (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.inventory_products(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE CASCADE,
  current_level INTEGER NOT NULL DEFAULT 0,
  min_level INTEGER,
  status TEXT NOT NULL DEFAULT 'stocked' CHECK (status IN ('stocked', 'low', 'out')),
  photo_url TEXT,
  notes TEXT,
  shelf_label TEXT,
  updated_by_user_id UUID,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(product_id, location_id)
);

-- Create indexes
CREATE INDEX idx_inventory_stock_product ON public.inventory_stock(product_id);
CREATE INDEX idx_inventory_stock_location ON public.inventory_stock(location_id);
CREATE INDEX idx_inventory_stock_status ON public.inventory_stock(status);

-- Enable RLS
ALTER TABLE public.inventory_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_stock ENABLE ROW LEVEL SECURITY;

-- RLS Policies for inventory_products
CREATE POLICY "Admin and staff can view inventory_products" ON public.inventory_products
FOR SELECT USING (is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin can manage inventory_products" ON public.inventory_products
FOR ALL USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for inventory_locations
CREATE POLICY "Admin and staff can view inventory_locations" ON public.inventory_locations
FOR SELECT USING (is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin can manage inventory_locations" ON public.inventory_locations
FOR ALL USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for inventory_stock
CREATE POLICY "Admin and staff can view inventory_stock" ON public.inventory_stock
FOR SELECT USING (is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin can manage inventory_stock" ON public.inventory_stock
FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Seed locations
INSERT INTO public.inventory_locations (name, slug) VALUES
  ('Kitchen cabinets – lower left', 'kitchen_cabinets_lower_left'),
  ('Storage rack – entrance right side', 'storage_rack_entrance'),
  ('Bathroom cabinets – women''s bathroom', 'bathroom_cabinets_womens');

-- Seed products
INSERT INTO public.inventory_products (name, unit, default_min_level) VALUES
  ('Esponjas de lavar los platos', 'pack', 2),
  ('Bolsas grandes negras', 'caja', 1),
  ('Bolsas de 13g (kitchen trash bags)', 'caja', 1),
  ('Toallas desinfectantes Clorox', 'container', 1),
  ('Mapo nuevo', 'unit', 1),
  ('Bolsas pequeñas para baños', 'caja', 1),
  ('Paper Towels (Marathon 4000)', 'caja', 1),
  ('Papel higiénico', 'paquete', 1),
  ('Cepillo de inodoros', 'unit', 1),
  ('Toallas sanitarias', 'caja', 1),
  ('Dawn dish soap', 'bottle', 1),
  ('Hand Soap', 'bottle', 2);

-- Trigger for updated_at
CREATE TRIGGER update_inventory_products_updated_at
  BEFORE UPDATE ON public.inventory_products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_inventory_locations_updated_at
  BEFORE UPDATE ON public.inventory_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_inventory_stock_updated_at
  BEFORE UPDATE ON public.inventory_stock
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();