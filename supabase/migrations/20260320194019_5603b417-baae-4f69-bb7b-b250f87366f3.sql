-- Deduplicate popup_leads by email (keep most recent row per normalized email)
DELETE FROM public.popup_leads
WHERE id NOT IN (
  SELECT DISTINCT ON (lower(trim(email))) id
  FROM public.popup_leads
  ORDER BY lower(trim(email)), created_at DESC NULLS LAST, id DESC
);

-- Create unique index on normalized email to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS popup_leads_email_unique ON public.popup_leads (lower(trim(email)));