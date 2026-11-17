-- Phase 2C, E-8 / E-9 (ClickUp 86e40ach2): void, offline mark-paid, resend.
--
-- Invoices could only be deleted: the Stripe link stayed payable and a payment
-- on a deleted invoice made stripe-webhook fail on every retry. Add-on invoices
-- could not be listed or voided (17 pending, $7,051.50, duplicates such as
-- CNZQVC 3 x $596). manage-invoice expires the Stripe session first and then
-- records the void here; the row is kept so a late payment still lands.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS paid_offline_method text,
  ADD COLUMN IF NOT EXISTS paid_offline_reference text;

ALTER TABLE public.booking_addon_invoices
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text;

ALTER TABLE public.booking_addon_invoices DROP CONSTRAINT IF EXISTS booking_addon_invoices_payment_status_check;
ALTER TABLE public.booking_addon_invoices ADD CONSTRAINT booking_addon_invoices_payment_status_check
  CHECK (payment_status = ANY (ARRAY['pending'::text, 'paid'::text, 'expired'::text, 'void'::text]));

-- Offline payments on standalone invoices: the method is one of the ways the
-- office actually takes money; a reference is required so it can be traced.
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_paid_offline_method_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_paid_offline_method_check
  CHECK (paid_offline_method IS NULL OR paid_offline_method IN ('cash', 'zelle', 'check', 'card_in_person', 'bank_transfer', 'other'));
