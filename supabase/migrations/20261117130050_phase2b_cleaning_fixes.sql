-- Phase 2B fixes (ClickUp 86e40ach2, Codex review of 20261117130000).
-- Forward migration: the first version is already applied in production.
--
-- 1. Scope: only cleaning assignments may submit (Custodial / cleaner role or
--    assignment_type 'cleaning'), only once the event or job date has come,
--    and standalone submissions only for standalone jobs (booking_id IS NULL)
--    with the full checklist. Completing a standalone report completes the
--    assignment and generates payroll, so a non-cleaning or future assignment
--    must not be able to reach it.
-- 2. Inventory is applied once, on the first completion; editing a completed
--    report (both forms allow it) no longer subtracts the same items again.
-- 3. One report per booking / per standalone assignment, enforced by unique
--    indexes (0 rows today) and INSERT ... ON CONFLICT.
-- 4. One maintenance ticket per report (source_report_id), updated when the
--    report's notes are edited; no more free-text dedupe across jobs.

CREATE UNIQUE INDEX IF NOT EXISTS booking_cleaning_reports_booking_uidx ON public.booking_cleaning_reports (booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS standalone_cleaning_reports_assignment_uidx ON public.standalone_cleaning_reports (assignment_id);

ALTER TABLE public.maintenance_tickets ADD COLUMN IF NOT EXISTS source_report_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_tickets_source_report_uidx
  ON public.maintenance_tickets (source_report_id) WHERE source_report_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public._is_cleaning_assignment(p_role text, p_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT COALESCE(p_role, '') IN ('Custodial', 'cleaner') OR COALESCE(p_type, '') = 'cleaning';
$function$;

-- One ticket per report: created on first notes, kept in sync while open.
CREATE OR REPLACE FUNCTION public._sync_report_ticket(
  p_report_id uuid, p_booking_id uuid, p_title text, p_text text, p_priority text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NULLIF(btrim(COALESCE(p_text, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.maintenance_tickets (booking_id, title, description, reported_by_role, priority, source_report_id)
  VALUES (p_booking_id, p_title, p_text, 'cleaner', p_priority, p_report_id)
  ON CONFLICT (source_report_id) WHERE source_report_id IS NOT NULL
  DO UPDATE SET description = EXCLUDED.description, priority = EXCLUDED.priority, updated_at = now()
    WHERE public.maintenance_tickets.resolved_at IS NULL
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.maintenance_tickets WHERE source_report_id = p_report_id;
  END IF;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public._sync_report_ticket(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_submit_cleaning_report(p_staff_id uuid, p_booking_id uuid, p_report jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_staff public.staff_members%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_report_id uuid;
  v_was_completed boolean;
  v_ticket_id uuid;
  v_issues text := NULLIF(btrim(COALESCE(p_report->>'clean_issues_notes', '')), '');
  v_items jsonb := CASE WHEN jsonb_typeof(p_report->'inventory_items') = 'array' THEN p_report->'inventory_items' ELSE '[]'::jsonb END;
  v_inv integer := 0;
  v_deep boolean := COALESCE((p_report->>'clean_check_deep_cleaning_done')::boolean, false);
  v_today date := (now() AT TIME ZONE 'America/New_York')::date;
BEGIN
  SELECT * INTO v_staff FROM public.staff_members WHERE id = p_staff_id;
  IF NOT FOUND OR NOT v_staff.is_active THEN
    RAISE EXCEPTION 'Your staff session is not valid; sign in again' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.booking_staff_assignments
    WHERE booking_id = p_booking_id AND staff_id = p_staff_id
      AND status <> 'cancelled' AND COALESCE(response_status, 'pending') <> 'rejected'
      AND public._is_cleaning_assignment(assignment_role, assignment_type)
  ) THEN
    RAISE EXCEPTION 'You do not have a cleaning assignment on this booking' USING ERRCODE = '42501';
  END IF;
  IF v_booking.event_date > v_today THEN
    RAISE EXCEPTION 'The cleaning report opens on the event date' USING ERRCODE = 'P0001';
  END IF;

  IF public._cleaning_media_count(p_report, 'media_front_door') < 1 THEN RAISE EXCEPTION 'Front door photo is required' USING ERRCODE = '22023'; END IF;
  IF public._cleaning_media_count(p_report, 'media_main_area') < 1 THEN RAISE EXCEPTION 'Main area photo is required' USING ERRCODE = '22023'; END IF;
  IF public._cleaning_media_count(p_report, 'media_rack') < 1 THEN RAISE EXCEPTION 'Tables & chairs rack photo is required' USING ERRCODE = '22023'; END IF;
  IF public._cleaning_media_count(p_report, 'media_bathrooms') < 2 THEN RAISE EXCEPTION 'At least 2 bathroom photos are required' USING ERRCODE = '22023'; END IF;
  IF public._cleaning_media_count(p_report, 'media_kitchen') < 1 THEN RAISE EXCEPTION 'Kitchen photo is required' USING ERRCODE = '22023'; END IF;
  IF v_deep AND public._cleaning_media_count(p_report, 'media_deep_cleaning') < 1 THEN
    RAISE EXCEPTION 'Deep cleaning photo is required when deep cleaning is checked' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.booking_cleaning_reports (booking_id) VALUES (p_booking_id)
  ON CONFLICT (booking_id) DO NOTHING;
  SELECT id, status = 'completed' INTO v_report_id, v_was_completed
  FROM public.booking_cleaning_reports WHERE booking_id = p_booking_id FOR UPDATE;
  v_was_completed := COALESCE(v_was_completed, false);

  UPDATE public.booking_cleaning_reports SET
    cleaner_id = p_staff_id,
    cleaner_name = COALESCE(NULLIF(btrim(p_report->>'cleaner_name'), ''), v_staff.full_name),
    cleaner_role = COALESCE(NULLIF(btrim(p_report->>'cleaner_role'), ''), v_staff.role),
    clean_issues_notes = v_issues,
    inventory_update_needed = EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) i WHERE i->>'status' IN ('low', 'out')),
    inventory_items = v_items,
    media_front_door = public._cleaning_media(p_report, 'media_front_door'),
    media_main_area = public._cleaning_media(p_report, 'media_main_area'),
    media_rack = public._cleaning_media(p_report, 'media_rack'),
    media_bathrooms = public._cleaning_media(p_report, 'media_bathrooms'),
    media_kitchen = public._cleaning_media(p_report, 'media_kitchen'),
    media_deep_cleaning = public._cleaning_media(p_report, 'media_deep_cleaning'),
    clean_check_floors = COALESCE((p_report->>'clean_check_floors')::boolean, false),
    clean_check_bathrooms = COALESCE((p_report->>'clean_check_bathrooms')::boolean, false),
    clean_check_kitchen = COALESCE((p_report->>'clean_check_kitchen')::boolean, false),
    clean_check_trash_removed = COALESCE((p_report->>'clean_check_trash_removed')::boolean, false),
    clean_check_equipment_stored = COALESCE((p_report->>'clean_check_equipment_stored')::boolean, false),
    clean_check_tables_chairs_positioned = COALESCE((p_report->>'clean_check_tables_chairs_positioned')::boolean, false),
    clean_check_lights_off = COALESCE((p_report->>'clean_check_lights_off')::boolean, false),
    clean_check_office_door_closed = COALESCE((p_report->>'clean_check_office_door_closed')::boolean, false),
    clean_check_door_locked = COALESCE((p_report->>'clean_check_door_locked')::boolean, false),
    clean_check_deep_cleaning_done = v_deep,
    status = 'completed',
    completed_at = CASE WHEN v_was_completed THEN completed_at ELSE now() END
  WHERE id = v_report_id;

  v_ticket_id := public._sync_report_ticket(v_report_id, p_booking_id,
    'Issue from cleaning report for booking ' || COALESCE(v_booking.reservation_number, p_booking_id::text),
    v_issues, 'medium');

  IF NOT v_was_completed THEN
    v_inv := public._apply_cleaning_inventory(v_items, 'Updated from cleaning report for booking ' || COALESCE(v_booking.reservation_number, ''));
  END IF;

  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  VALUES (p_booking_id, CASE WHEN v_was_completed THEN 'cleaning_report_updated' ELSE 'cleaning_report_submitted' END,
          'staff_portal', jsonb_build_object(
    'report_id', v_report_id, 'staff_id', p_staff_id, 'staff_name', v_staff.full_name,
    'ticket_id', v_ticket_id, 'inventory_lines', v_inv));

  RETURN jsonb_build_object('report_id', v_report_id, 'ticket_id', v_ticket_id, 'inventory_lines', v_inv,
                            'updated', v_was_completed);
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_submit_standalone_cleaning_report(p_staff_id uuid, p_assignment_id uuid, p_report jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_staff public.staff_members%ROWTYPE;
  v_a public.booking_staff_assignments%ROWTYPE;
  v_report_id uuid;
  v_was_completed boolean;
  v_ticket_id uuid;
  v_issues_found boolean := COALESCE((p_report->>'issues_found')::boolean, false);
  v_damage_found boolean := COALESCE((p_report->>'damage_found')::boolean, false);
  v_issues text := NULLIF(btrim(COALESCE(p_report->>'issues_notes', '')), '');
  v_damage text := NULLIF(btrim(COALESCE(p_report->>'damage_description', '')), '');
  v_inv_needed boolean := COALESCE((p_report->>'inventory_update_needed')::boolean, false);
  v_items jsonb := CASE WHEN jsonb_typeof(p_report->'inventory_items') = 'array' THEN p_report->'inventory_items' ELSE '[]'::jsonb END;
  v_inv integer := 0;
  v_today date := (now() AT TIME ZONE 'America/New_York')::date;
  v_check text;
BEGIN
  SELECT * INTO v_staff FROM public.staff_members WHERE id = p_staff_id;
  IF NOT FOUND OR NOT v_staff.is_active THEN
    RAISE EXCEPTION 'Your staff session is not valid; sign in again' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_a FROM public.booking_staff_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND OR v_a.staff_id IS DISTINCT FROM p_staff_id THEN
    RAISE EXCEPTION 'This assignment is not yours' USING ERRCODE = '42501';
  END IF;
  IF v_a.booking_id IS NOT NULL OR NOT public._is_cleaning_assignment(v_a.assignment_role, v_a.assignment_type) THEN
    RAISE EXCEPTION 'This is not a standalone cleaning job' USING ERRCODE = '42501';
  END IF;
  IF v_a.status = 'cancelled' THEN
    RAISE EXCEPTION 'This assignment was cancelled' USING ERRCODE = 'P0001';
  END IF;
  IF v_a.scheduled_date IS NOT NULL AND v_a.scheduled_date > v_today THEN
    RAISE EXCEPTION 'The cleaning report opens on the scheduled date' USING ERRCODE = 'P0001';
  END IF;
  IF public._cleaning_media_count(p_report, 'media_main_area') < 1 THEN
    RAISE EXCEPTION 'At least 1 main area photo is required' USING ERRCODE = '22023';
  END IF;
  FOREACH v_check IN ARRAY ARRAY['clean_check_floors_swept_mopped', 'clean_check_bathrooms_cleaned', 'clean_check_kitchen_cleaned',
    'clean_check_trash_removed', 'clean_check_equipment_stored', 'clean_check_tables_chairs_arranged', 'clean_check_lights_off',
    'clean_check_office_door_locked', 'clean_check_front_door_locked', 'clean_check_deep_cleaning_done'] LOOP
    IF NOT COALESCE((p_report->>v_check)::boolean, false) THEN
      RAISE EXCEPTION 'All checklist items must be checked' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF v_issues_found AND v_issues IS NULL THEN RAISE EXCEPTION 'Please describe the issues found' USING ERRCODE = '22023'; END IF;
  IF v_damage_found AND v_damage IS NULL THEN RAISE EXCEPTION 'Please describe the damage found' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.standalone_cleaning_reports (assignment_id, cleaner_id, cleaner_name, cleaner_role, status)
  VALUES (p_assignment_id, p_staff_id, v_staff.full_name, v_staff.role, 'pending')
  ON CONFLICT (assignment_id) DO NOTHING;
  SELECT id, status = 'completed' INTO v_report_id, v_was_completed
  FROM public.standalone_cleaning_reports WHERE assignment_id = p_assignment_id FOR UPDATE;
  v_was_completed := COALESCE(v_was_completed, false);

  -- pending -> completed fires trg_auto_complete_on_standalone_report, which
  -- completes the assignment (and payroll), as before.
  UPDATE public.standalone_cleaning_reports SET
    cleaner_id = p_staff_id,
    cleaner_name = COALESCE(NULLIF(btrim(p_report->>'cleaner_name'), ''), v_staff.full_name),
    cleaner_role = COALESCE(NULLIF(btrim(p_report->>'cleaner_role'), ''), v_staff.role),
    clean_check_floors_swept_mopped = true,
    clean_check_bathrooms_cleaned = true,
    clean_check_kitchen_cleaned = true,
    clean_check_trash_removed = true,
    clean_check_equipment_stored = true,
    clean_check_tables_chairs_arranged = true,
    clean_check_lights_off = true,
    clean_check_office_door_locked = true,
    clean_check_front_door_locked = true,
    clean_check_deep_cleaning_done = true,
    media_front_door = public._cleaning_media(p_report, 'media_front_door'),
    media_main_area = public._cleaning_media(p_report, 'media_main_area'),
    media_rack = public._cleaning_media(p_report, 'media_rack'),
    media_bathrooms = public._cleaning_media(p_report, 'media_bathrooms'),
    media_kitchen = public._cleaning_media(p_report, 'media_kitchen'),
    media_deep_cleaning = public._cleaning_media(p_report, 'media_deep_cleaning'),
    issues_found = v_issues_found,
    issues_notes = CASE WHEN v_issues_found THEN v_issues END,
    damage_found = v_damage_found,
    damage_description = CASE WHEN v_damage_found THEN v_damage END,
    inventory_update_needed = v_inv_needed,
    inventory_items = CASE WHEN v_inv_needed THEN v_items ELSE '[]'::jsonb END,
    status = 'completed',
    completed_at = CASE WHEN v_was_completed THEN completed_at ELSE now() END
  WHERE id = v_report_id;

  v_ticket_id := public._sync_report_ticket(v_report_id, NULL,
    'Issue from standalone cleaning (' || v_staff.full_name || ', ' || COALESCE(v_a.scheduled_date::text, v_today::text) || ')',
    concat_ws(E'\n', CASE WHEN v_issues_found THEN 'Issues: ' || v_issues END,
                     CASE WHEN v_damage_found THEN 'Damage: ' || v_damage END),
    CASE WHEN v_damage_found THEN 'high' ELSE 'medium' END);

  IF v_inv_needed AND NOT v_was_completed THEN
    v_inv := public._apply_cleaning_inventory(v_items, 'Updated from standalone cleaning report');
  END IF;

  RETURN jsonb_build_object('report_id', v_report_id, 'ticket_id', v_ticket_id, 'inventory_lines', v_inv,
                            'updated', v_was_completed);
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_submit_cleaning_report(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_submit_standalone_cleaning_report(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_submit_cleaning_report(uuid, uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_submit_standalone_cleaning_report(uuid, uuid, jsonb) TO anon, authenticated, service_role;
