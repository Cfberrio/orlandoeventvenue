-- Add source column to track booking origin
-- This allows voice-check-availability to identify where bookings came from

ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'website';

-- Add index for queries filtering by date and status
CREATE INDEX IF NOT EXISTS idx_bookings_event_date_status 
ON bookings(event_date, status);

-- Add comment explaining the column
COMMENT ON COLUMN bookings.source IS 
'Origin of booking: website (from OEV website), google_calendar (synced from Google Calendar via GHL), ghl_manual (created manually in GHL), external (other sources)';
