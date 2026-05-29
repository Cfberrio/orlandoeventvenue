-- Add line_items JSONB column for multi-item invoices
-- Format: [{"label": "Venue Rental", "amount": 1500}, {"label": "Production", "amount": 800}]
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS line_items jsonb;
