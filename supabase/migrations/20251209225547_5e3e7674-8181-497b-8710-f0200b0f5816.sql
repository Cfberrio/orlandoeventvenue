-- Drop the timestamp column and add a boolean column instead
ALTER TABLE public.bookings DROP COLUMN IF EXISTS pre_event_checklist_completed_at;

-- The pre_event_ready boolean column already exists, just ensure it's being used correctly
-- It's already defined as: pre_event_ready boolean NOT NULL DEFAULT false