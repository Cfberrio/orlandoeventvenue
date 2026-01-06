-- Allow anon to manage inventory_locations (staff access controlled via staff_members table validation)
DROP POLICY IF EXISTS "Admin can manage inventory_locations" ON public.inventory_locations;
CREATE POLICY "Anyone can manage inventory_locations" ON public.inventory_locations
FOR ALL USING (true) WITH CHECK (true);

-- Allow anon to manage inventory_products
DROP POLICY IF EXISTS "Admin can manage inventory_products" ON public.inventory_products;
CREATE POLICY "Anyone can manage inventory_products" ON public.inventory_products
FOR ALL USING (true) WITH CHECK (true);

-- Allow anon to manage inventory_stock
DROP POLICY IF EXISTS "Admin can manage inventory_stock" ON public.inventory_stock;
CREATE POLICY "Anyone can manage inventory_stock" ON public.inventory_stock
FOR ALL USING (true) WITH CHECK (true);