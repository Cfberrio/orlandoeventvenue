-- 1) Drop the gating trigger (function kept harmlessly; safe to leave for future use)
DROP TRIGGER IF EXISTS trg_enforce_bar_pre_event_ready_gate ON public.bookings;

-- 2) Extend booking_addon_invoices with bar service columns
ALTER TABLE public.booking_addon_invoices
  ADD COLUMN IF NOT EXISTS bar_package text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS bar_package_label text,
  ADD COLUMN IF NOT EXISTS bar_guest_count integer,
  ADD COLUMN IF NOT EXISTS bar_rate_per_guest numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bar_subtotal numeric NOT NULL DEFAULT 0;