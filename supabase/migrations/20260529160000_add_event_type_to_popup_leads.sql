-- Add event_type column to popup_leads to capture dropdown selection from discount popup
ALTER TABLE public.popup_leads
  ADD COLUMN IF NOT EXISTS event_type text;
