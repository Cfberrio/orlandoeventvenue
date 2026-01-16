-- 🧪 SQL Script para verificar External Booking Implementation
-- Ejecutar en Supabase SQL Editor

-- ========================================
-- 1. VERIFICAR POLICIES
-- ========================================
SELECT 
  policy_name,
  requires_payment,
  send_deposit_emails,
  send_balance_emails,
  send_pre_event_30d,
  send_pre_event_7d,
  send_pre_event_1d,
  include_host_report,
  send_cleaning_report,
  send_staff_assignment_emails
FROM booking_policies
ORDER BY 
  CASE policy_name
    WHEN 'WEBSITE_FULL_FLOW' THEN 1
    WHEN 'INTERNAL_BLOCK_FLOW' THEN 2
    WHEN 'EXTERNAL_BLOCK_FLOW' THEN 3
  END;

-- Resultado esperado:
-- WEBSITE_FULL_FLOW:    TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE
-- INTERNAL_BLOCK_FLOW:  FALSE, FALSE, FALSE, FALSE, FALSE, TRUE, TRUE, FALSE, TRUE
-- EXTERNAL_BLOCK_FLOW:  FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE

-- ========================================
-- 2. VERIFICAR ENUM booking_origin
-- ========================================
SELECT 
  enumlabel as booking_origin_values
FROM pg_enum
WHERE enumtypid = (
  SELECT oid 
  FROM pg_type 
  WHERE typname = 'booking_origin'
)
ORDER BY enumsortorder;

-- Resultado esperado: website, internal, external

-- ========================================
-- 3. CONTAR BOOKINGS POR TIPO
-- ========================================
SELECT 
  b.booking_origin,
  p.policy_name,
  COUNT(*) as total_bookings,
  COUNT(CASE WHEN b.created_at::date = CURRENT_DATE THEN 1 END) as created_today
FROM bookings b
JOIN booking_policies p ON b.policy_id = p.id
GROUP BY b.booking_origin, p.policy_name
ORDER BY b.booking_origin;

-- ========================================
-- 4. VERIFICAR EXTERNAL BOOKINGS
-- ========================================
SELECT 
  b.id,
  b.full_name,
  b.email,
  b.booking_origin,
  p.policy_name,
  b.payment_status,
  b.lead_source,
  b.event_date,
  b.created_at
FROM bookings b
JOIN booking_policies p ON b.policy_id = p.id
WHERE b.booking_origin = 'external'
ORDER BY b.created_at DESC
LIMIT 10;

-- Verificar:
-- ✓ full_name empieza con "External - "
-- ✓ booking_origin = 'external'
-- ✓ policy_name = 'EXTERNAL_BLOCK_FLOW'
-- ✓ payment_status = 'invoiced'
-- ✓ lead_source = 'external_admin'

-- ========================================
-- 5. VERIFICAR AVAILABILITY BLOCKS DE EXTERNAL
-- ========================================
SELECT 
  ab.id,
  ab.booking_id,
  b.full_name,
  ab.block_type,
  ab.start_date,
  ab.end_date,
  ab.start_time,
  ab.end_time,
  ab.source,
  ab.notes
FROM availability_blocks ab
JOIN bookings b ON ab.booking_id = b.id
WHERE b.booking_origin = 'external'
ORDER BY ab.start_date DESC
LIMIT 10;

-- Verificar:
-- ✓ source = 'external_admin'
-- ✓ notes contiene "External booking"
-- ✓ booking_id corresponde a booking externo

-- ========================================
-- 6. VERIFICAR STAFF ASSIGNMENTS (si existen)
-- ========================================
SELECT 
  bsa.id,
  b.full_name as booking_name,
  b.booking_origin,
  s.full_name as staff_name,
  s.email as staff_email,
  bsa.assignment_role,
  bsa.created_at
FROM booking_staff_assignments bsa
JOIN bookings b ON bsa.booking_id = b.id
JOIN staff s ON bsa.staff_id = s.id
WHERE b.booking_origin = 'external'
ORDER BY bsa.created_at DESC
LIMIT 10;

-- ========================================
-- 7. VERIFICAR CUSTODIAL STAFF VIEW
-- ========================================
SELECT 
  booking_id,
  custodial_staff_id,
  custodial_email,
  custodial_name,
  custodial_role
FROM booking_custodial_staff
WHERE booking_id IN (
  SELECT id FROM bookings WHERE booking_origin = 'external'
)
LIMIT 10;

-- ========================================
-- 8. VERIFICAR STRIPE EVENT LOG (debe estar vacío para external)
-- ========================================
SELECT 
  sel.event_id,
  sel.event_type,
  b.full_name,
  b.booking_origin,
  sel.created_at
FROM stripe_event_log sel
JOIN bookings b ON sel.booking_id = b.id
WHERE b.booking_origin = 'external'
ORDER BY sel.created_at DESC
LIMIT 10;

-- Resultado esperado: 0 rows (external bookings no tienen pagos)

-- ========================================
-- 9. VERIFICAR GHL CALENDAR IDS
-- ========================================
SELECT 
  b.id,
  b.full_name,
  b.booking_origin,
  b.ghl_appointment_id,
  b.event_date
FROM bookings b
WHERE b.booking_origin = 'external'
  AND b.ghl_appointment_id IS NOT NULL
ORDER BY b.created_at DESC
LIMIT 10;

-- Verificar:
-- ✓ ghl_appointment_id existe (synced to GHL)

-- ========================================
-- 10. COMPARAR LOS 3 TIPOS DE BOOKINGS
-- ========================================
SELECT 
  b.booking_origin,
  p.policy_name,
  COUNT(*) as total,
  COUNT(CASE WHEN b.payment_status = 'fully_paid' THEN 1 END) as fully_paid,
  COUNT(CASE WHEN b.payment_status = 'deposit_paid' THEN 1 END) as deposit_paid,
  COUNT(CASE WHEN b.payment_status = 'invoiced' THEN 1 END) as invoiced,
  COUNT(CASE WHEN b.ghl_appointment_id IS NOT NULL THEN 1 END) as synced_to_ghl,
  AVG(b.total_amount) as avg_total_amount
FROM bookings b
JOIN booking_policies p ON b.policy_id = p.id
GROUP BY b.booking_origin, p.policy_name
ORDER BY b.booking_origin;

-- ========================================
-- 11. VERIFICAR INTEGRIDAD DE DATOS
-- ========================================

-- Todos los bookings deben tener policy_id
SELECT COUNT(*) as bookings_without_policy
FROM bookings
WHERE policy_id IS NULL;
-- Resultado esperado: 0

-- Todos los bookings deben tener booking_origin
SELECT COUNT(*) as bookings_without_origin
FROM bookings
WHERE booking_origin IS NULL;
-- Resultado esperado: 0

-- External bookings deben usar EXTERNAL_BLOCK_FLOW
SELECT COUNT(*) as mismatched_external
FROM bookings b
JOIN booking_policies p ON b.policy_id = p.id
WHERE b.booking_origin = 'external'
  AND p.policy_name != 'EXTERNAL_BLOCK_FLOW';
-- Resultado esperado: 0

-- Internal bookings deben usar INTERNAL_BLOCK_FLOW
SELECT COUNT(*) as mismatched_internal
FROM bookings b
JOIN booking_policies p ON b.policy_id = p.id
WHERE b.booking_origin = 'internal'
  AND p.policy_name != 'INTERNAL_BLOCK_FLOW';
-- Resultado esperado: 0

-- Website bookings deben usar WEBSITE_FULL_FLOW
SELECT COUNT(*) as mismatched_website
FROM bookings b
JOIN booking_policies p ON b.policy_id = p.id
WHERE b.booking_origin = 'website'
  AND p.policy_name != 'WEBSITE_FULL_FLOW';
-- Resultado esperado: 0

-- ========================================
-- 12. VERIFICAR NOMBRES DE EXTERNAL BOOKINGS
-- ========================================
SELECT 
  id,
  full_name,
  booking_origin,
  CASE 
    WHEN full_name LIKE 'External -%' THEN '✓ Correct format'
    ELSE '✗ Wrong format'
  END as name_format_check
FROM bookings
WHERE booking_origin = 'external'
ORDER BY created_at DESC
LIMIT 20;

-- Todos deben tener '✓ Correct format'

-- ========================================
-- 13. VERIFICAR lead_source
-- ========================================
SELECT 
  booking_origin,
  lead_source,
  COUNT(*) as total
FROM bookings
GROUP BY booking_origin, lead_source
ORDER BY booking_origin, lead_source;

-- Verificar:
-- external → external_admin
-- internal → internal_admin
-- website → website (o otros sources válidos)

-- ========================================
-- 14. TEST: Crear un External Booking de prueba
-- ========================================
/*
-- Descomentar para ejecutar test

DO $$
DECLARE
  v_policy_id UUID;
  v_booking_id UUID;
BEGIN
  -- Get EXTERNAL_BLOCK_FLOW policy
  SELECT id INTO v_policy_id
  FROM booking_policies
  WHERE policy_name = 'EXTERNAL_BLOCK_FLOW';

  -- Create test booking
  INSERT INTO bookings (
    booking_type,
    event_date,
    number_of_guests,
    event_type,
    full_name,
    email,
    phone,
    lead_source,
    status,
    lifecycle_status,
    payment_status,
    base_rental,
    cleaning_fee,
    package_cost,
    optional_services,
    taxes_fees,
    total_amount,
    deposit_amount,
    balance_amount,
    agree_to_rules,
    initials,
    signer_name,
    signature,
    signature_date,
    client_notes,
    booking_origin,
    policy_id
  ) VALUES (
    'daily',
    CURRENT_DATE + INTERVAL '7 days',
    50,
    'Corporate Event',
    'External - Test Client SQL',
    'test-sql@external.com',
    '(555) 999-9999',
    'external_admin',
    'confirmed',
    'confirmed',
    'invoiced',
    0, 0, 0, 0, 0, 0, 0, 0,
    TRUE,
    'TC',
    'Test Client SQL',
    'External Booking',
    CURRENT_DATE,
    'SQL test booking',
    'external',
    v_policy_id
  ) RETURNING id INTO v_booking_id;

  RAISE NOTICE 'Test external booking created: %', v_booking_id;
END $$;

-- Verificar el booking creado
SELECT * FROM bookings WHERE email = 'test-sql@external.com';

-- Limpiar (opcional)
-- DELETE FROM bookings WHERE email = 'test-sql@external.com';
*/

-- ========================================
-- 15. RESUMEN FINAL
-- ========================================
SELECT 
  '✅ VERIFICATION COMPLETE' as status,
  (SELECT COUNT(*) FROM booking_policies) as total_policies,
  (SELECT COUNT(*) FROM bookings WHERE booking_origin = 'website') as website_bookings,
  (SELECT COUNT(*) FROM bookings WHERE booking_origin = 'internal') as internal_bookings,
  (SELECT COUNT(*) FROM bookings WHERE booking_origin = 'external') as external_bookings,
  (SELECT COUNT(*) FROM bookings WHERE policy_id IS NULL) as bookings_without_policy,
  (SELECT COUNT(*) FROM stripe_event_log) as total_stripe_events;
