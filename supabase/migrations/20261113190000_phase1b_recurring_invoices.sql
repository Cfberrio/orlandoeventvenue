-- Phase 1B / M-31 + E-13 (ClickUp 86e40ach2): a recurring invoice period is
-- never skipped silently.
--
-- Before: the run advanced the schedule FIRST, then created and sent the
-- child invoice. Any failure after that (insert, create-invoice, network)
-- skipped that month for good, and only the function log knew.
--
-- Now: each child carries the period it belongs to (recurring_period); one
-- live child per period (unique index); the child is claimed before sending
-- (no double send by overlapping runs); the schedule advances only after the
-- invoice was actually issued. A failure leaves the period due, so the next
-- run (19:00 and 20:00 UTC daily) retries it, and the failure is shown on the
-- parent in Invoices.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS recurring_period timestamptz,
  ADD COLUMN IF NOT EXISTS recurring_send_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS recurring_last_error text,
  ADD COLUMN IF NOT EXISTS recurring_last_error_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_child_per_period_uidx
  ON public.invoices (recurring_parent_id, recurring_period)
  WHERE recurring_parent_id IS NOT NULL
    AND recurring_period IS NOT NULL
    AND payment_status <> 'cancelled';

-- Delivery is recorded only after the email went out (create-invoice sets it);
-- a payment link alone is not proof the customer got the invoice.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;
