-- Phase 2B, E-10 / E-11 / E-12 (ClickUp 86e40ach2): cleaning reports.
--
-- Staff portal users are anonymous (localStorage session; identity = staff_id).
-- The browser wrote reports, maintenance tickets and inventory in four
-- separate calls with no error checks:
-- - E-10: 0 booking cleaning reports ever, while cleaners uploaded photos.
-- - E-11: with issue notes, the ticket insert is blocked for anon, so staff
--   see "Failed to submit" and inventory + GHL sync are skipped.
-- - E-12: standalone reports require cleaner_id = auth.uid(); anon has no
--   uid, so they can never be saved.
-- One server function per form does all of it in one transaction and
-- returns a clear error. Same identity check as staff_unassign_self: the
-- staff member must be active and hold the assignment.

CREATE OR REPLACE FUNCTION public._cleaning_media_count(p jsonb, k text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE WHEN jsonb_typeof(p->k) = 'array' THEN jsonb_array_length(p->k) ELSE 0 END;
$function$;

CREATE OR REPLACE FUNCTION public._cleaning_media(p jsonb, k text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE WHEN jsonb_typeof(p->k) = 'array' THEN p->k ELSE '[]'::jsonb END;
$function$;

-- Applies inventory lines from a report: decrements the stock level by the
-- quantity used (or seeds a level from the status when no row exists).
CREATE OR REPLACE FUNCTION public._apply_cleaning_inventory(p_items jsonb, p_note text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_stock public.inventory_stock%ROWTYPE;
  v_status text;
  v_qty integer;
  v_n integer := 0;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' THEN
    RETURN 0;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('oev_inventory_stock'));
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    CONTINUE WHEN NULLIF(v_item->>'product_id', '') IS NULL OR NULLIF(v_item->>'location_id', '') IS NULL;
    v_status := CASE WHEN v_item->>'status' IN ('stocked', 'low', 'out') THEN v_item->>'status' ELSE 'stocked' END;
    v_qty := greatest(0, least(1000, COALESCE(NULLIF(regexp_replace(COALESCE(v_item->>'qty_used', ''), '[^0-9]', '', 'g'), '')::int, 0)));
    SELECT * INTO v_stock FROM public.inventory_stock
    WHERE product_id = (v_item->>'product_id')::uuid AND location_id = (v_item->>'location_id')::uuid
    LIMIT 1;
    IF FOUND THEN
      UPDATE public.inventory_stock
      SET status = v_status, current_level = greatest(0, COALESCE(current_level, 0) - v_qty),
          notes = p_note, updated_at = now()
      WHERE id = v_stock.id;
    ELSE
      INSERT INTO public.inventory_stock (product_id, location_id, status, current_level, notes)
      VALUES ((v_item->>'product_id')::uuid, (v_item->>'location_id')::uuid, v_status,
              CASE v_status WHEN 'out' THEN 0 WHEN 'low' THEN 1 ELSE 5 END, p_note);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

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
  v_ticket_id uuid;
  v_issues text := NULLIF(btrim(COALESCE(p_report->>'clean_issues_notes', '')), '');
  v_items jsonb := CASE WHEN jsonb_typeof(p_report->'inventory_items') = 'array' THEN p_report->'inventory_items' ELSE '[]'::jsonb END;
  v_inv integer;
  v_deep boolean := COALESCE((p_report->>'clean_check_deep_cleaning_done')::boolean, false);
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
  ) THEN
    RAISE EXCEPTION 'You are not assigned to this booking' USING ERRCODE = '42501';
  END IF;

  IF public._cleaning_media_count(p_report, 'media_front_door') < 1 THEN RAISE EXCEPTION 'Front door photo is required' USING ERRCODE = '22023'; END IF;
  IF public._cleaning_media_count(p_report, 'media_main_area') < 1 THEN RAISE EXCEPTION 'Main area photo is required' USING ERRCODE = '22023'; END IF;
  IF public._cleaning_media_count(p_report, 'media_rack') < 1 THEN RAISE EXCEPTION 'Tables & chairs rack photo is required' USING ERRCODE = '22023'; END IF;
  IF public._cleaning_media_count(p_report, 'media_bathrooms') < 2 THEN RAISE EXCEPTION 'At least 2 bathroom photos are required' USING ERRCODE = '22023'; END IF;
  IF public._cleaning_media_count(p_report, 'media_kitchen') < 1 THEN RAISE EXCEPTION 'Kitchen photo is required' USING ERRCODE = '22023'; END IF;
  IF v_deep AND public._cleaning_media_count(p_report, 'media_deep_cleaning') < 1 THEN
    RAISE EXCEPTION 'Deep cleaning photo is required when deep cleaning is checked' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_report_id FROM public.booking_cleaning_reports
  WHERE booking_id = p_booking_id ORDER BY created_at LIMIT 1;

  IF v_report_id IS NULL THEN
    INSERT INTO public.booking_cleaning_reports (booking_id) VALUES (p_booking_id) RETURNING id INTO v_report_id;
  END IF;

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
    completed_at = now()
  WHERE id = v_report_id;

  IF v_issues IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.maintenance_tickets
    WHERE booking_id = p_booking_id AND reported_by_role = 'cleaner' AND description = v_issues
  ) THEN
    INSERT INTO public.maintenance_tickets (booking_id, title, description, reported_by_role, priority)
    VALUES (p_booking_id, 'Issue from cleaning report for booking ' || COALESCE(v_booking.reservation_number, p_booking_id::text),
            v_issues, 'cleaner', 'medium')
    RETURNING id INTO v_ticket_id;
  END IF;

  v_inv := public._apply_cleaning_inventory(v_items, 'Updated from cleaning report for booking ' || COALESCE(v_booking.reservation_number, ''));

  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  VALUES (p_booking_id, 'cleaning_report_submitted', 'staff_portal', jsonb_build_object(
    'report_id', v_report_id, 'staff_id', p_staff_id, 'staff_name', v_staff.full_name,
    'ticket_id', v_ticket_id, 'inventory_lines', v_inv));

  RETURN jsonb_build_object('report_id', v_report_id, 'ticket_id', v_ticket_id, 'inventory_lines', v_inv);
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
  v_ticket_id uuid;
  v_issues_found boolean := COALESCE((p_report->>'issues_found')::boolean, false);
  v_damage_found boolean := COALESCE((p_report->>'damage_found')::boolean, false);
  v_issues text := NULLIF(btrim(COALESCE(p_report->>'issues_notes', '')), '');
  v_damage text := NULLIF(btrim(COALESCE(p_report->>'damage_description', '')), '');
  v_inv_needed boolean := COALESCE((p_report->>'inventory_update_needed')::boolean, false);
  v_items jsonb := CASE WHEN jsonb_typeof(p_report->'inventory_items') = 'array' THEN p_report->'inventory_items' ELSE '[]'::jsonb END;
  v_inv integer := 0;
  v_ticket_text text;
BEGIN
  SELECT * INTO v_staff FROM public.staff_members WHERE id = p_staff_id;
  IF NOT FOUND OR NOT v_staff.is_active THEN
    RAISE EXCEPTION 'Your staff session is not valid; sign in again' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_a FROM public.booking_staff_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND OR v_a.staff_id IS DISTINCT FROM p_staff_id THEN
    RAISE EXCEPTION 'This assignment is not yours' USING ERRCODE = '42501';
  END IF;
  IF v_a.status = 'cancelled' THEN
    RAISE EXCEPTION 'This assignment was cancelled' USING ERRCODE = 'P0001';
  END IF;
  IF public._cleaning_media_count(p_report, 'media_main_area') < 1 THEN
    RAISE EXCEPTION 'At least 1 main area photo is required' USING ERRCODE = '22023';
  END IF;
  IF v_issues_found AND v_issues IS NULL THEN RAISE EXCEPTION 'Please describe the issues found' USING ERRCODE = '22023'; END IF;
  IF v_damage_found AND v_damage IS NULL THEN RAISE EXCEPTION 'Please describe the damage found' USING ERRCODE = '22023'; END IF;

  SELECT id INTO v_report_id FROM public.standalone_cleaning_reports
  WHERE assignment_id = p_assignment_id ORDER BY created_at LIMIT 1;

  IF v_report_id IS NULL THEN
    INSERT INTO public.standalone_cleaning_reports (assignment_id, cleaner_id, cleaner_name, cleaner_role, status)
    VALUES (p_assignment_id, p_staff_id, v_staff.full_name, v_staff.role, 'pending')
    RETURNING id INTO v_report_id;
  END IF;

  -- status pending -> completed fires trg_auto_complete_on_standalone_report,
  -- which completes the assignment (and payroll) as before.
  UPDATE public.standalone_cleaning_reports SET
    cleaner_id = p_staff_id,
    cleaner_name = COALESCE(NULLIF(btrim(p_report->>'cleaner_name'), ''), v_staff.full_name),
    cleaner_role = COALESCE(NULLIF(btrim(p_report->>'cleaner_role'), ''), v_staff.role),
    clean_check_floors_swept_mopped = COALESCE((p_report->>'clean_check_floors_swept_mopped')::boolean, false),
    clean_check_bathrooms_cleaned = COALESCE((p_report->>'clean_check_bathrooms_cleaned')::boolean, false),
    clean_check_kitchen_cleaned = COALESCE((p_report->>'clean_check_kitchen_cleaned')::boolean, false),
    clean_check_trash_removed = COALESCE((p_report->>'clean_check_trash_removed')::boolean, false),
    clean_check_equipment_stored = COALESCE((p_report->>'clean_check_equipment_stored')::boolean, false),
    clean_check_tables_chairs_arranged = COALESCE((p_report->>'clean_check_tables_chairs_arranged')::boolean, false),
    clean_check_lights_off = COALESCE((p_report->>'clean_check_lights_off')::boolean, false),
    clean_check_office_door_locked = COALESCE((p_report->>'clean_check_office_door_locked')::boolean, false),
    clean_check_front_door_locked = COALESCE((p_report->>'clean_check_front_door_locked')::boolean, false),
    clean_check_deep_cleaning_done = COALESCE((p_report->>'clean_check_deep_cleaning_done')::boolean, false),
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
    completed_at = now()
  WHERE id = v_report_id;

  v_ticket_text := concat_ws(E'\n', CASE WHEN v_issues_found THEN 'Issues: ' || v_issues END,
                                    CASE WHEN v_damage_found THEN 'Damage: ' || v_damage END);
  IF NULLIF(v_ticket_text, '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.maintenance_tickets WHERE reported_by_role = 'cleaner' AND description = v_ticket_text
      AND created_at > now() - interval '30 days'
  ) THEN
    INSERT INTO public.maintenance_tickets (booking_id, title, description, reported_by_role, priority)
    VALUES (v_a.booking_id, 'Issue from standalone cleaning (' || v_staff.full_name || ', ' ||
            COALESCE(v_a.scheduled_date::text, to_char(now() AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')) || ')',
            v_ticket_text, 'cleaner', CASE WHEN v_damage_found THEN 'high' ELSE 'medium' END)
    RETURNING id INTO v_ticket_id;
  END IF;

  IF v_inv_needed THEN
    v_inv := public._apply_cleaning_inventory(v_items, 'Updated from standalone cleaning report');
  END IF;

  RETURN jsonb_build_object('report_id', v_report_id, 'ticket_id', v_ticket_id, 'inventory_lines', v_inv);
END;
$function$;

REVOKE ALL ON FUNCTION public._apply_cleaning_inventory(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_submit_cleaning_report(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_submit_standalone_cleaning_report(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_submit_cleaning_report(uuid, uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_submit_standalone_cleaning_report(uuid, uuid, jsonb) TO anon, authenticated, service_role;
