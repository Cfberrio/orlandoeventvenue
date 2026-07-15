-- 1) Columns
ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS response_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS response_at timestamptz,
  ADD COLUMN IF NOT EXISTS response_due_at timestamptz DEFAULT (now() + interval '24 hours'),
  ADD COLUMN IF NOT EXISTS auto_rejected boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  ALTER TABLE public.booking_staff_assignments
    ADD CONSTRAINT booking_staff_assignments_response_status_check
    CHECK (response_status IN ('pending', 'accepted', 'rejected'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- 2) Grandfather existing assignments
UPDATE public.booking_staff_assignments
SET response_status = 'accepted',
    response_due_at = NULL
WHERE response_status = 'pending';

-- 3) RLS: staff portal anon updates
DROP POLICY IF EXISTS "Anon can respond to own assignments" ON public.booking_staff_assignments;
CREATE POLICY "Anon can respond to own assignments"
ON public.booking_staff_assignments
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

-- 4) pg_cron auto-reject stale assignments hourly at :10
DO $$
BEGIN
  PERFORM cron.unschedule('auto-reject-stale-staff-assignments');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'auto-reject-stale-staff-assignments',
  '10 * * * *',
  $$
  DO $body$
  DECLARE
    a RECORD;
    request_id bigint;
    rejected_count int := 0;
  BEGIN
    FOR a IN
      SELECT bsa.id, bsa.booking_id, bsa.assignment_role,
             sm.full_name AS staff_name,
             b.reservation_number, b.event_date
      FROM public.booking_staff_assignments bsa
      LEFT JOIN public.staff_members sm ON sm.id = bsa.staff_id
      LEFT JOIN public.bookings b ON b.id = bsa.booking_id
      WHERE bsa.response_status = 'pending'
        AND bsa.response_due_at IS NOT NULL
        AND bsa.response_due_at < now()
        AND bsa.status NOT IN ('cancelled', 'completed')
    LOOP
      UPDATE public.booking_staff_assignments
      SET response_status = 'rejected',
          auto_rejected = true,
          response_at = now(),
          updated_at = now()
      WHERE id = a.id;

      IF a.booking_id IS NOT NULL THEN
        INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
        VALUES (
          a.booking_id,
          'staff_assignment_auto_rejected',
          'system',
          jsonb_build_object(
            'assignment_id', a.id,
            'staff_name', a.staff_name,
            'assignment_role', a.assignment_role,
            'reason', 'No response before deadline'
          )
        );
      END IF;

      SELECT net.http_post(
        url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/send-staff-response-notification',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := jsonb_build_object(
          'response', 'auto_rejected',
          'staffName', COALESCE(a.staff_name, 'Unknown staff'),
          'staffRole', a.assignment_role,
          'reservationNumber', COALESCE(a.reservation_number, 'N/A'),
          'eventDate', COALESCE(a.event_date::text, 'N/A'),
          'bookingId', a.booking_id
        )
      ) INTO request_id;

      rejected_count := rejected_count + 1;
      RAISE NOTICE '[AUTO-REJECT] Assignment % (%) auto-rejected, notify request %',
        a.id, a.staff_name, request_id;
    END LOOP;

    IF rejected_count > 0 THEN
      RAISE NOTICE '[AUTO-REJECT] Completed: % assignments auto-rejected', rejected_count;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[AUTO-REJECT] Error occurred: %', SQLERRM;
  END $body$;
  $$
);