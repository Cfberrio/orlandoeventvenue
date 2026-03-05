-- Add recurring invoice support columns
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurring_interval_days integer,
  ADD COLUMN IF NOT EXISTS recurring_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurring_next_send_at timestamptz,
  ADD COLUMN IF NOT EXISTS recurring_parent_id uuid REFERENCES public.invoices(id);

-- Index for the cron query that looks up due recurring invoices
CREATE INDEX IF NOT EXISTS idx_invoices_recurring_due
  ON public.invoices (recurring_next_send_at)
  WHERE recurring_active = true;

-- Index for finding child invoices of a recurring parent
CREATE INDEX IF NOT EXISTS idx_invoices_recurring_parent
  ON public.invoices (recurring_parent_id)
  WHERE recurring_parent_id IS NOT NULL;

-- DST-safe function to advance recurring_next_send_at by interval_days,
-- always landing on 3 PM America/New_York regardless of DST transitions.
CREATE OR REPLACE FUNCTION public.bump_recurring_next_send(p_invoice_id uuid)
RETURNS void AS $$
UPDATE public.invoices
SET recurring_next_send_at = (
  (recurring_next_send_at AT TIME ZONE 'America/New_York')::date
    + (recurring_interval_days * interval '1 day')
    + interval '15 hours'
) AT TIME ZONE 'America/New_York'
WHERE id = p_invoice_id
  AND recurring_active = true;
$$ LANGUAGE sql SECURITY DEFINER;
