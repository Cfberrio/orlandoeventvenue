-- Grant explicit permissions on the bookings table to anon and authenticated roles
GRANT INSERT ON public.bookings TO anon;
GRANT INSERT ON public.bookings TO authenticated;
GRANT SELECT ON public.bookings TO authenticated;
GRANT UPDATE ON public.bookings TO authenticated;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';