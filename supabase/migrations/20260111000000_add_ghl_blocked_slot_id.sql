-- Add column to track GHL blocked slot ID
-- This allows voice-check-availability to query blocked slots for availability checking
-- since GHL appointments are not queryable by date range via API

ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS ghl_blocked_slot_id TEXT;

-- Add index for lookups
CREATE INDEX IF NOT EXISTS idx_bookings_ghl_blocked_slot_id 
ON bookings(ghl_blocked_slot_id);

-- Add comment
COMMENT ON COLUMN bookings.ghl_blocked_slot_id IS 
'GHL blocked slot ID created for this booking to block calendar availability. Used by voice-check-availability to detect conflicts.';
