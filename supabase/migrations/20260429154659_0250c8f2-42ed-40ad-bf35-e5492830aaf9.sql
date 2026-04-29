CREATE TABLE IF NOT EXISTS public._qa_bar_service_results (
  test_name text PRIMARY KEY,
  status text,
  details text,
  ran_at timestamptz DEFAULT now()
);

TRUNCATE public._qa_bar_service_results;

DO $$
DECLARE
  v_booking_id uuid := gen_random_uuid();
  v_vendor_id  uuid := gen_random_uuid();
  v_policy_id  uuid;
  v_label text; v_rate numeric; v_subtotal numeric;
  v_guest_count int; v_vendor uuid; v_assignment uuid;
  v_contacted boolean; v_contacted_at timestamptz; v_contacted_by uuid;
  v_phone_released boolean;
  v_lifecycle text;
  v_blocked_msg text := NULL;
BEGIN
  SELECT id INTO v_policy_id FROM booking_policies LIMIT 1;

  INSERT INTO staff_members(id, full_name, email, role, is_active, hourly_rate, payroll_type)
  VALUES (v_vendor_id, 'QA TEMP Bar Vendor', 'qa-bar-vendor-temp@oev.test', 'Bar Vendor', true, 0, 'none');

  INSERT INTO bookings(
    id, booking_type, event_date, number_of_guests, event_type,
    full_name, email, phone, package,
    base_rental, cleaning_fee, total_amount, deposit_amount, balance_amount,
    agree_to_rules, initials, signer_name, signature, signature_date,
    booking_origin, policy_id, status, lifecycle_status, bar_package
  ) VALUES (
    v_booking_id, 'daily', CURRENT_DATE + INTERVAL '60 days', 50, 'Wedding',
    'QA TEMP Booking', 'qa-temp@oev.test', '+10000000000', 'none',
    1000, 199, 1199, 600, 599,
    true, 'QA', 'QA TEMP', 'QA', CURRENT_DATE,
    'internal', v_policy_id, 'confirmed', 'pending', 'none'
  );

  -- TEST 1 — Subtotal trigger
  UPDATE bookings SET bar_package = 'signature_bar', bar_guest_count = 50 WHERE id = v_booking_id;
  SELECT bar_package_label, bar_rate_per_guest, bar_subtotal INTO v_label, v_rate, v_subtotal FROM bookings WHERE id = v_booking_id;
  INSERT INTO public._qa_bar_service_results(test_name,status,details) VALUES (
    'TEST 1 - Subtotal trigger',
    CASE WHEN v_label='Signature Bar' AND v_rate=32.13 AND v_subtotal=1606.50 THEN 'PASS' ELSE 'FAIL' END,
    format('label=%s, rate=%s, subtotal=%s', v_label, v_rate, v_subtotal)
  );

  -- TEST 3 — Gate BLOCKS
  UPDATE bookings SET bar_vendor_id=NULL, bar_customer_contacted=false WHERE id=v_booking_id;
  BEGIN
    UPDATE bookings SET lifecycle_status='pre_event_ready' WHERE id=v_booking_id;
    INSERT INTO public._qa_bar_service_results(test_name,status,details) VALUES ('TEST 3 - Gate blocks incomplete','FAIL','no exception raised');
  EXCEPTION WHEN OTHERS THEN
    v_blocked_msg := SQLERRM;
    INSERT INTO public._qa_bar_service_results(test_name,status,details) VALUES (
      'TEST 3 - Gate blocks incomplete',
      CASE WHEN SQLERRM ILIKE '%Cannot move to Pre-Event Ready%bar%vendor%' THEN 'PASS' ELSE 'FAIL' END,
      v_blocked_msg
    );
  END;

  -- TEST 4 — Gate ALLOWS
  UPDATE bookings SET bar_vendor_id=v_vendor_id, bar_customer_contacted=true, bar_customer_contacted_at=now() WHERE id=v_booking_id;
  BEGIN
    UPDATE bookings SET lifecycle_status='pre_event_ready' WHERE id=v_booking_id;
    SELECT lifecycle_status INTO v_lifecycle FROM bookings WHERE id=v_booking_id;
    INSERT INTO public._qa_bar_service_results(test_name,status,details) VALUES (
      'TEST 4 - Gate allows complete',
      CASE WHEN v_lifecycle='pre_event_ready' THEN 'PASS' ELSE 'FAIL' END,
      format('lifecycle_status=%s', v_lifecycle)
    );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._qa_bar_service_results(test_name,status,details) VALUES ('TEST 4 - Gate allows complete','FAIL', SQLERRM);
  END;

  -- TEST 2 — Reset on 'none'
  UPDATE bookings SET lifecycle_status='pending' WHERE id=v_booking_id;
  UPDATE bookings SET bar_package='none' WHERE id=v_booking_id;
  SELECT bar_package_label, bar_guest_count, bar_rate_per_guest, bar_subtotal,
         bar_vendor_id, bar_vendor_assignment_id,
         bar_customer_contacted, bar_customer_contacted_at, bar_customer_contacted_by,
         bar_client_phone_released
    INTO v_label, v_guest_count, v_rate, v_subtotal, v_vendor, v_assignment,
         v_contacted, v_contacted_at, v_contacted_by, v_phone_released
    FROM bookings WHERE id=v_booking_id;
  INSERT INTO public._qa_bar_service_results(test_name,status,details) VALUES (
    'TEST 2 - Reset on none',
    CASE WHEN v_label IS NULL AND v_guest_count IS NULL AND v_rate=0 AND v_subtotal=0
              AND v_vendor IS NULL AND v_assignment IS NULL
              AND v_contacted=false AND v_contacted_at IS NULL AND v_contacted_by IS NULL
              AND v_phone_released=false
         THEN 'PASS' ELSE 'FAIL' END,
    format('label=%s guests=%s rate=%s subtotal=%s vendor=%s assignment=%s contacted=%s contacted_at=%s contacted_by=%s phone_released=%s',
      v_label, v_guest_count, v_rate, v_subtotal, v_vendor, v_assignment, v_contacted, v_contacted_at, v_contacted_by, v_phone_released)
  );

  -- CLEANUP test booking + staff
  DELETE FROM bookings WHERE id=v_booking_id;
  DELETE FROM staff_members WHERE id=v_vendor_id;
END $$;