-- =====================================================================
-- ANALISIS DE LEADS — CAMPAÑA GOOGLE ADS JUNIO 2026
-- Correr en: Supabase Dashboard → SQL Editor (requiere permisos admin)
-- Complementa: docs/marketing/POST-MORTEM-CAMPANA-GOOGLE-ADS-JUNIO-2026.md
-- =====================================================================

-- 1) Leads del popup por mes (2026): cuántos entraron y cuántos convirtieron
SELECT
  to_char(created_at, 'YYYY-MM') AS mes,
  count(*)                        AS leads,
  count(*) FILTER (WHERE is_converted)              AS convertidos,
  round(100.0 * count(*) FILTER (WHERE is_converted) / count(*), 1) AS pct_conversion,
  count(*) FILTER (WHERE email_1_sent_at IS NOT NULL) AS drip_1,
  count(*) FILTER (WHERE email_2_sent_at IS NOT NULL) AS drip_2,
  count(*) FILTER (WHERE email_3_sent_at IS NOT NULL) AS drip_3
FROM popup_leads
WHERE created_at >= '2026-01-01'
GROUP BY 1
ORDER BY 1;

-- 2) Leads de JUNIO en detalle (periodo de campaña)
SELECT
  created_at::date AS fecha_lead,
  full_name,
  email,
  event_type,
  preferred_event_date,
  is_converted,
  (email_1_sent_at IS NOT NULL) AS recibio_drip_1,
  (email_3_sent_at IS NOT NULL) AS recibio_drip_3
FROM popup_leads
WHERE created_at >= '2026-06-01' AND created_at < '2026-07-01'
ORDER BY created_at;

-- 3) ¿La fecha que querían estaba ocupada? (lead vs reservas confirmadas ese día)
SELECT
  pl.created_at::date  AS fecha_lead,
  pl.full_name,
  pl.preferred_event_date,
  pl.is_converted,
  EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.event_date = pl.preferred_event_date
      AND b.status <> 'cancelled'
      AND b.id IS NOT NULL
  ) AS fecha_ya_reservada
FROM popup_leads pl
WHERE pl.created_at >= '2026-06-01' AND pl.created_at < '2026-07-01'
  AND pl.preferred_event_date IS NOT NULL
ORDER BY pl.created_at;

-- 4) Leads de junio que terminaron reservando (match por email, aunque
--    is_converted no se haya marcado)
SELECT
  pl.email,
  pl.created_at::date AS fecha_lead,
  b.created_at::date  AS fecha_reserva,
  b.status,
  b.payment_status,
  b.total_amount,
  b.discount_code
FROM popup_leads pl
JOIN bookings b ON lower(b.email) = lower(pl.email)
WHERE pl.created_at >= '2026-06-01' AND pl.created_at < '2026-07-01';
