-- English-only sweep: inventory product names and units were seeded in Spanish
-- (20251211042817) and surface verbatim in Admin > Inventory, Staff > Inventory
-- and the cleaning report product dropdown.
--
-- useInventoryData.ts maps product name -> default location using lowercased
-- English keys, so these names must stay English or the auto-location
-- assignment silently stops matching. Matching here is case-insensitive so the
-- statements are idempotent against rows already renamed in production.

update public.inventory_products set name = 'Large Black Trash Bags'        where lower(name) in ('bolsas grandes negras', 'large black trash bags');
update public.inventory_products set name = '13g Bags (Kitchen Trash Bags)' where lower(name) in ('bolsas de 13g (kitchen trash bags)', '13g bags (kitchen trash bags)');
update public.inventory_products set name = 'Dish Sponges'                  where lower(name) in ('esponjas de lavar los platos', 'dish sponges');
update public.inventory_products set name = 'New Mop'                       where lower(name) in ('mapo nuevo', 'new mop');
update public.inventory_products set name = 'Small Bathroom Bags'           where lower(name) in ('bolsas pequeñas para baños', 'small bathroom bags');
update public.inventory_products set name = 'Toilet Paper'                  where lower(name) in ('papel higiénico', 'toilet paper');
update public.inventory_products set name = 'Clorox Disinfecting Wipes'     where lower(name) in ('toallas desinfectantes clorox', 'clorox disinfecting wipes');
update public.inventory_products set name = 'Sanitary Pads'                 where lower(name) in ('toallas sanitarias', 'sanitary pads');
update public.inventory_products set name = 'Toilet Brush'                  where lower(name) in ('cepillo de inodoros', 'toilet brush');
update public.inventory_products set name = 'Trash Bags'                    where lower(name) in ('bolsas de basura', 'trash bags');
update public.inventory_products set name = 'Clorox bleach'                 where lower(name) = 'clorox';

update public.inventory_products set unit = 'box'  where unit = 'caja';
update public.inventory_products set unit = 'pack' where unit = 'paquete';
