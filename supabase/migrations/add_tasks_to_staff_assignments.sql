-- Add tasks JSONB column to booking_staff_assignments
-- Run this in the Supabase SQL Editor

ALTER TABLE booking_staff_assignments
ADD COLUMN IF NOT EXISTS tasks jsonb NOT NULL DEFAULT '[]'::jsonb;
