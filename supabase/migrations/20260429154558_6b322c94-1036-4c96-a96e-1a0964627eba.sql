-- Phase 1.5 Bar Service Runtime QA
-- Creates a temporary test booking + bar vendor, runs trigger validations, raises NOTICE with results, then cleans up.
-- No real customer data is touched. All artifacts are deleted at the end.

DO $$
DECLARE
  v_booking_id uuid := gen_random_uuid();
  v_vendor_id  uuid := gen_random_uuid();
  v_policy_id  uuid;
  v_label text; v_rate numeric; v_subtotal numeric;
  v_guest_count int; v_vendor uuid; v_assignment uuid;
  v_contacted boolean; v_contacted_at timestamptz; v_contacted_by uuid;
  v_phone_released boolean;
  v_lifecycle text; v_pre text;
  v_blocked_msg text := NULL;
  v_t1 text; v_t2 text; v_t3 text; v_t4 text;
BEGIN
  -- Pick any policy (required NOT NULL)
  SELECT id INTO v_policy_id FROM booking_policies LIMIT 1;
  IF v_policy_id IS NULL THEN
    RAISE EXCEPTION 'No booking_policies row available for test setup';
  END IF;

  -- Create temp Bar Vendor staff
  INSERT INTO staff_members(id, full_name, email, role, is_active, hourly_rate, payroll_type)
  VALUES (v_vendor_id, 'QA TEMP Bar Vendor', 'qa-bar-vendor-temp@oev.test', 'Bar Vendor', true, 0, 'none');

  -- Create temp test booking with minimal required fields
  INSERT INTO bookings(
    id, booking_type, event_date, number_of_guests, event_type,
    full_name, email, phone, package,
    base_rental, cleaning_fee, total_amount, deposit_amount, balance_amount,
    agree_to_rules, initials, signer_name, signature, signature_date,
    booking_origin, policy_id, status, lifecycle_status,
    bar_package
  ) VALUES (
    v_booking_id, 'daily', CURRENT_DATE + INTERVAL '60 days', 50, 'Wedding',
    'QA TEMP Booking', 'qa-temp@oev.test', '+10000000000', 'none',
    1000, 199, 1199, 600, 599,
    true, 'QA', 'QA TEMP', 'QA', CURRENT_DATE,
    'internal', v_policy_id, 'confirmed', 'pending',
    'none'
  );

  -- ============ TEST 1 — Subtotal trigger ============
  UPDATE bookings
     SET bar_package = 'signature_bar', bar_guest_count = 50
   WHERE id = v_booking_id;

  SELECT bar_package_label, bar_rate_per_guest, bar_subtotal
    INTO v_label, v_rate, v_subtotal
    FROM bookings WHERE id = v_booking_id;

  IF v_label = 'Signature Bar' AND v_rate = 32.13 AND v_subtotal = 1606.50 THEN
    v_t1 := 'PASS';
  ELSE
    v_t1 := 'FAIL';
  END IF;
  RAISE NOTICE 'TEST 1 [%]: label=%, rate=%, subtotal=%', v_t1, v_label, v_rate, v_subtotal;

  -- ============ TEST 3 — Pre-Event Ready gate BLOCKS (run before TEST 2 since state already set) ============
  -- Ensure incomplete state
  UPDATE bookings
     SET bar_vendor_id = NULL, bar_customer_contacted = false
   WHERE id = v_booking_id;

  BEGIN
    UPDATE bookings SET lifecycle_status = 'pre_event_ready' WHERE id = v_booking_id;
    v_t3 := 'FAIL (no exception raised)';
  EXCEPTION WHEN OTHERS THEN
    v_blocked_msg := SQLERRM;
    IF SQLERRM ILIKE '%Cannot move to Pre-Event Ready%bar%vendor%' THEN
      v_t3 := 'PASS';
    ELSE
      v_t3 := 'FAIL (wrong message)';
    END IF;
  END;
  RAISE NOTICE 'TEST 3 [%]: blocked_msg=%', v_t3, v_blocked_msg;

  -- ============ TEST 4 — Pre-Event Ready gate ALLOWS when complete ============
  UPDATE bookings
     SET bar_vendor_id = v_vendor_id,
         bar_customer_contacted = true,
         bar_customer_contacted_at = now()
   WHERE id = v_booking_id;

  BEGIN
    UPDATE bookings SET lifecycle_status = 'pre_event_ready' WHERE id = v_booking_id;
    SELECT lifecycle_status INTO v_lifecycle FROM bookings WHERE id = v_booking_id;
    IF v_lifecycle = 'pre_event_ready' THEN
      v_t4 := 'PASS';
    ELSE
      v_t4 := 'FAIL (status not applied: ' || v_lifecycle || ')';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_t4 := 'FAIL (unexpected exception: ' || SQLERRM || ')';
  END;
  RAISE NOTICE 'TEST 4 [%]: lifecycle_status=%', v_t4, v_lifecycle;

  -- ============ TEST 2 — Reset behavior on bar_package = 'none' ============
  -- Reset lifecycle first so trigger doesn't get in the way
  UPDATE bookings SET lifecycle_status = 'pending' WHERE id = v_booking_id;

  UPDATE bookings SET bar_package = 'none' WHERE id = v_booking_id;

  SELECT bar_package_label, bar_guest_count, bar_rate_per_guest, bar_subtotal,
         bar_vendor_id, bar_vendor_assignment_id,
         bar_customer_contacted, bar_customer_contacted_at, bar_customer_contacted_by,
         bar_client_phone_released
    INTO v_label, v_guest_count, v_rate, v_subtotal,
         v_vendor, v_assignment,
         v_contacted, v_contacted_at, v_contacted_by,
         v_phone_released
    FROM bookings WHERE id = v_booking_id;

  IF v_label IS NULL
     AND v_guest_count IS NULL
     AND v_rate = 0
     AND v_subtotal = 0
     AND v_vendor IS NULL
     AND v_assignment IS NULL
     AND v_contacted = false
     AND v_contacted_at IS NULL
     AND v_contacted_by IS NULL
     AND v_phone_released = false
  THEN
    v_t2 := 'PASS';
  ELSE
    v_t2 := 'FAIL';
  END IF;
  RAISE NOTICE 'TEST 2 [%]: label=%, guests=%, rate=%, subtotal=%, vendor=%, assignment=%, contacted=%, contacted_at=%, contacted_by=%, phone_released=%',
    v_t2, v_label, v_guest_count, v_rate, v_subtotal, v_vendor, v_assignment, v_contacted, v_contacted_at, v_contacted_by, v_phone_released;

  -- ============ CLEANUP ============
  DELETE FROM bookings WHERE id = v_booking_id;
  DELETE FROM staff_members WHERE id = v_vendor_id;

  RAISE NOTICE '=== QA SUMMARY: T1=% T2=% T3=% T4=% ===', v_t1, v_t2, v_t3, v_t4;
END $$;