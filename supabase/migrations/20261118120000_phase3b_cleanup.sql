-- Phase 3B cleanup (ClickUp 86e40ach2): C-3, C-8, C-9.
-- No money paths: nothing here reads or writes payments, invoices, payroll or revenue.

-- ---------------------------------------------------------------------------
-- C-3: one spelling per event type.
-- The public form stores codes ("birthday-party"); the admin wizards stored
-- labels ("Corporate Event", "Other"), so filters and reports split the same
-- type. A BEFORE trigger normalizes to a lowercase slug and never rejects, so
-- no writer (public checkout included) can fail because of it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_event_type_slug(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(btrim(regexp_replace(lower(btrim(p)), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'other')
$$;

CREATE OR REPLACE FUNCTION public.trg_normalize_booking_event_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.event_type IS NOT NULL THEN
    NEW.event_type := public.normalize_event_type_slug(NEW.event_type);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_booking_event_type ON public.bookings;
CREATE TRIGGER trg_normalize_booking_event_type
  BEFORE INSERT OR UPDATE OF event_type ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_booking_event_type();

-- Backfill with the booking triggers off for this statement only, so the
-- rewrite does not resync old bookings to the GHL calendar, rerun automation
-- or touch updated_at. All in one transaction; ENABLE runs before COMMIT.
DO $$
BEGIN
  ALTER TABLE public.bookings DISABLE TRIGGER USER;
  UPDATE public.bookings
     SET event_type = public.normalize_event_type_slug(event_type)
   WHERE event_type IS DISTINCT FROM public.normalize_event_type_slug(event_type);
  ALTER TABLE public.bookings ENABLE TRIGGER USER;
END;
$$;

-- ---------------------------------------------------------------------------
-- C-9: staff email is the staff-portal login, so it must be unique.
-- Stored trimmed + lowercase (the login already lowercases what is typed).
-- NULL stays allowed (staff who never use the portal); blank is not.
-- Existing duplicates (only test accounts today) keep the oldest row's email;
-- later rows get a plus-alias that still delivers to the same inbox.
-- ---------------------------------------------------------------------------
UPDATE public.staff_members
   SET email = NULLIF(lower(btrim(email)), '')
 WHERE email IS DISTINCT FROM NULLIF(lower(btrim(email)), '');

WITH ranked AS (
  SELECT id, email,
         row_number() OVER (PARTITION BY email ORDER BY created_at, id) AS rn
    FROM public.staff_members
   WHERE email IS NOT NULL
)
UPDATE public.staff_members s
   SET email = split_part(r.email, '@', 1) || '+' || left(s.id::text, 8) || '@' || split_part(r.email, '@', 2)
  FROM ranked r
 WHERE r.id = s.id AND r.rn > 1;

CREATE OR REPLACE FUNCTION public.trg_normalize_staff_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.email := NULLIF(lower(btrim(NEW.email)), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_staff_email ON public.staff_members;
CREATE TRIGGER trg_normalize_staff_email
  BEFORE INSERT OR UPDATE OF email ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_staff_email();

CREATE UNIQUE INDEX IF NOT EXISTS staff_members_email_unique
  ON public.staff_members (email)
  WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- C-8: Dashboard issue alerts only cleared when a booking reached "closed",
-- which almost never happens. The office can now resolve an alert.
-- ---------------------------------------------------------------------------
ALTER TABLE public.booking_cleaning_reports
  ADD COLUMN IF NOT EXISTS issue_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS issue_resolved_by uuid,
  ADD COLUMN IF NOT EXISTS issue_resolution_note text;

ALTER TABLE public.booking_host_reports
  ADD COLUMN IF NOT EXISTS issue_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS issue_resolved_by uuid,
  ADD COLUMN IF NOT EXISTS issue_resolution_note text;

CREATE OR REPLACE FUNCTION public.admin_resolve_issue_alert(
  p_kind text,
  p_report_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking uuid;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  PERFORM public._assert_admin_or_service();

  IF p_kind = 'cleaning' THEN
    UPDATE public.booking_cleaning_reports
       SET issue_resolved_at = now(),
           issue_resolved_by = auth.uid(),
           issue_resolution_note = v_note
     WHERE id = p_report_id AND issue_resolved_at IS NULL
    RETURNING booking_id INTO v_booking;
  ELSIF p_kind = 'guest' THEN
    UPDATE public.booking_host_reports
       SET issue_resolved_at = now(),
           issue_resolved_by = auth.uid(),
           issue_resolution_note = v_note
     WHERE id = p_report_id AND issue_resolved_at IS NULL
    RETURNING booking_id INTO v_booking;
  ELSE
    RAISE EXCEPTION 'Invalid alert kind: %', p_kind USING ERRCODE = '22023';
  END IF;

  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found_or_already_resolved');
  END IF;

  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  VALUES (v_booking, 'issue_alert_resolved', 'admin',
          jsonb_build_object('kind', p_kind, 'report_id', p_report_id, 'note', v_note, 'actor_id', auth.uid()));

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_resolve_issue_alert(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_issue_alert(text, uuid, text) TO authenticated, service_role;
