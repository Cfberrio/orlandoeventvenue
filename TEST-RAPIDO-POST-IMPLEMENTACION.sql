-- =====================================================
-- TEST RÁPIDO POST-IMPLEMENTACIÓN
-- =====================================================
-- Ejecuta ESTE SQL inmediatamente después de implementar
-- Te dirá en 10 segundos si todo funciona
-- =====================================================

-- =====================================================
-- 🎯 RESULTADO ESPERADO
-- =====================================================
-- Todo debe mostrar ✅
-- Si algo muestra ❌, ve al query específico para más detalles
-- =====================================================

WITH installation_check AS (
  SELECT 
    -- MEJORA #1: Trigger automático
    EXISTS (
      SELECT 1 FROM pg_trigger 
      WHERE tgname = 'bookings_auto_trigger_automation'
    ) as trigger_instalado,
    
    EXISTS (
      SELECT 1 FROM pg_proc 
      WHERE proname = 'auto_trigger_booking_automation'
    ) as trigger_function_instalada,
    
    -- MEJORA #2: Cron de auto-reparación
    EXISTS (
      SELECT 1 FROM cron.job 
      WHERE jobname = 'auto-fix-missing-jobs-hourly' 
      AND active = true
    ) as autofix_cron_activo,
    
    -- MEJORA #4: Health check funciones
    EXISTS (
      SELECT 1 FROM pg_proc 
      WHERE proname = 'count_bookings_without_balance_jobs'
    ) as health_function_balance_instalada,
    
    EXISTS (
      SELECT 1 FROM pg_proc 
      WHERE proname = 'count_bookings_without_host_jobs'
    ) as health_function_host_instalada,
    
    -- MEJORA #4: Cron de health check
    EXISTS (
      SELECT 1 FROM cron.job 
      WHERE jobname = 'daily-health-check-8am-est' 
      AND active = true
    ) as healthcheck_cron_activo,
    
    -- Verificar que el procesador original sigue activo
    EXISTS (
      SELECT 1 FROM cron.job 
      WHERE jobname = 'process-scheduled-jobs-5min' 
      AND active = true
    ) as processor_original_activo
),
status_summary AS (
  SELECT 
    trigger_instalado,
    trigger_function_instalada,
    autofix_cron_activo,
    health_function_balance_instalada,
    health_function_host_instalada,
    healthcheck_cron_activo,
    processor_original_activo,
    -- Calcular score
    (CASE WHEN trigger_instalado THEN 1 ELSE 0 END +
     CASE WHEN trigger_function_instalada THEN 1 ELSE 0 END +
     CASE WHEN autofix_cron_activo THEN 1 ELSE 0 END +
     CASE WHEN health_function_balance_instalada THEN 1 ELSE 0 END +
     CASE WHEN health_function_host_instalada THEN 1 ELSE 0 END +
     CASE WHEN healthcheck_cron_activo THEN 1 ELSE 0 END +
     CASE WHEN processor_original_activo THEN 1 ELSE 0 END
    ) as components_ok,
    7 as total_components
  FROM installation_check
)
SELECT 
  CASE 
    WHEN components_ok = total_components THEN '🎉 ✅ IMPLEMENTACIÓN EXITOSA - TODO FUNCIONANDO'
    WHEN components_ok >= 5 THEN '⚠️ IMPLEMENTACIÓN PARCIAL - Revisar componentes faltantes'
    ELSE '❌ IMPLEMENTACIÓN INCOMPLETA - Revisar instalación'
  END as "📊 RESULTADO GENERAL",
  
  components_ok || '/' || total_components as "Componentes OK",
  
  CASE WHEN trigger_instalado THEN '✅' ELSE '❌ FALTA' END as "MEJORA #1: Trigger",
  CASE WHEN trigger_function_instalada THEN '✅' ELSE '❌ FALTA' END as "MEJORA #1: Función",
  CASE WHEN autofix_cron_activo THEN '✅' ELSE '❌ FALTA' END as "MEJORA #2: Cron Auto-Fix",
  CASE WHEN health_function_balance_instalada THEN '✅' ELSE '❌ FALTA' END as "MEJORA #4: Func Balance",
  CASE WHEN health_function_host_instalada THEN '✅' ELSE '❌ FALTA' END as "MEJORA #4: Func Host",
  CASE WHEN healthcheck_cron_activo THEN '✅' ELSE '❌ FALTA' END as "MEJORA #4: Cron Health",
  CASE WHEN processor_original_activo THEN '✅' ELSE '⚠️ INACTIVO' END as "Procesador Original",
  
  NOW() as "Verificado en"
FROM status_summary;

-- =====================================================
-- Si todo muestra ✅ arriba, tu implementación es EXITOSA
-- =====================================================

-- =====================================================
-- DETALLES ADICIONALES (Solo si algo falla arriba)
-- =====================================================

-- Ver todos los triggers en la tabla bookings
SELECT 
  tgname as trigger_name,
  CASE tgenabled
    WHEN 'O' THEN '✅ Activo'
    WHEN 'D' THEN '❌ Desactivado'
  END as estado
FROM pg_trigger
WHERE tgrelid = 'public.bookings'::regclass
ORDER BY tgname;

-- Ver todos los cron jobs
SELECT 
  jobname,
  schedule,
  CASE WHEN active THEN '✅ Activo' ELSE '❌ Inactivo' END as estado,
  CASE jobname
    WHEN 'process-scheduled-jobs-5min' THEN 'Original - Procesa jobs cada 5 min'
    WHEN 'auto-fix-missing-jobs-hourly' THEN 'NUEVO - Auto-reparación cada hora'
    WHEN 'daily-health-check-8am-est' THEN 'NUEVO - Health check diario 8 AM'
  END as descripcion
FROM cron.job
WHERE jobname IN (
  'process-scheduled-jobs-5min',
  'auto-fix-missing-jobs-hourly',
  'daily-health-check-8am-est'
)
ORDER BY jobname;

-- =====================================================
-- INSTRUCCIONES
-- =====================================================

/*
🎯 CÓMO INTERPRETAR LOS RESULTADOS:

RESULTADO: "🎉 ✅ IMPLEMENTACIÓN EXITOSA"
→ ¡Perfecto! Todo instalado correctamente
→ Siguiente paso: Leer GUIA-TESTING-MEJORAS.md para probar

RESULTADO: "⚠️ IMPLEMENTACIÓN PARCIAL"
→ La mayoría está bien, pero falta algo
→ Revisa las columnas con ❌ 
→ Ve a INSTRUCCIONES-IMPLEMENTACION-MEJORAS.md paso correspondiente

RESULTADO: "❌ IMPLEMENTACIÓN INCOMPLETA"
→ Algo falló durante la instalación
→ Verifica que ejecutaste: supabase db push
→ Verifica que el SERVICE_ROLE_KEY es correcto
→ Revisa los queries de "DETALLES ADICIONALES" arriba

---

PRÓXIMO PASO:
Si todo está ✅, ejecuta el health check manualmente para probarlo:

1. Ve a: Supabase Dashboard → Edge Functions → daily-health-check
2. Haz clic en "Invoke"
3. Body: {}
4. Click "Run"
5. Deberías ver: {"ok": true, "alert_sent": false, "message": "Sistema funcionando correctamente"}

Si recibes eso, ¡TODO FUNCIONA PERFECTAMENTE! 🎉
*/
