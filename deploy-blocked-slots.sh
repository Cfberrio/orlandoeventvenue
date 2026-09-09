#!/bin/bash

# 🚀 Script de Deployment Automático: Blocked Slots Implementation
# Ejecuta: chmod +x deploy-blocked-slots.sh && ./deploy-blocked-slots.sh

set -e  # Exit on error

echo "🚀 Iniciando deployment de Blocked Slots..."
echo ""

# Colores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Verificar que estamos en el directorio correcto
if [ ! -f "supabase/config.toml" ]; then
    echo -e "${RED}❌ Error: No estás en el directorio del proyecto${NC}"
    echo "Ejecuta: cd /Users/cberrio04/Documents/OEV-PROJECT/orlandoeventvenue"
    exit 1
fi

# Verificar que Supabase CLI esté instalado
if ! command -v supabase &> /dev/null; then
    echo -e "${YELLOW}⚠️  Supabase CLI no está instalado${NC}"
    echo "Instalando Supabase CLI..."
    brew install supabase/tap/supabase
    echo -e "${GREEN}✅ Supabase CLI instalado${NC}"
fi

echo -e "${BLUE}📦 Versión de Supabase CLI:${NC}"
supabase --version
echo ""

# Verificar login
echo -e "${BLUE}🔐 Verificando autenticación...${NC}"
if ! supabase projects list &> /dev/null; then
    echo -e "${YELLOW}⚠️  No estás autenticado${NC}"
    echo "Abriendo navegador para login..."
    supabase login
fi
echo -e "${GREEN}✅ Autenticado correctamente${NC}"
echo ""

# Link proyecto (si no está linked)
echo -e "${BLUE}🔗 Verificando link con proyecto...${NC}"
if ! supabase status &> /dev/null; then
    echo "Linking con proyecto vsvsgesgqjtwutadcshi..."
    supabase link --project-ref vsvsgesgqjtwutadcshi
fi
echo -e "${GREEN}✅ Proyecto linked${NC}"
echo ""

# Aplicar migration
echo -e "${BLUE}📊 Aplicando migration a database...${NC}"
supabase db push
echo -e "${GREEN}✅ Migration aplicada${NC}"
echo ""

# Deploy funciones
echo -e "${BLUE}🚀 Deploying Edge Functions...${NC}"

echo "  📤 Deploying sync-ghl-calendar..."
supabase functions deploy sync-ghl-calendar --no-verify-jwt

echo "  📤 Deploying sync-blocked-slots-cron..."
supabase functions deploy sync-blocked-slots-cron --no-verify-jwt

echo "  📤 Deploying backfill-blocked-slots..."
supabase functions deploy backfill-blocked-slots --no-verify-jwt

echo -e "${GREEN}✅ Todas las funciones deployadas${NC}"
echo ""

# Verificar funciones
echo -e "${BLUE}🔍 Verificando funciones deployadas:${NC}"
supabase functions list
echo ""

# Verificar secrets
echo -e "${BLUE}🔑 Verificando secrets:${NC}"
supabase secrets list | grep -E "(GHL_PRIVATE_INTEGRATION_TOKEN|GHL_LOCATION_ID|GHL_CALENDAR_ID|GHL_ASSIGNED_USER_ID)" || true
echo ""

# Instrucciones para cron job
echo -e "${YELLOW}⚠️  ACCIÓN MANUAL REQUERIDA:${NC}"
echo ""
echo -e "${BLUE}Configura el Cron Job en el Dashboard:${NC}"
echo "1. Ir a: https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/functions"
echo "2. Click en tab 'Cron Jobs'"
echo "3. Click en 'Create a new cron job'"
echo "4. Function: sync-blocked-slots-cron"
echo "5. Schedule: 0 * * * * (cada hora)"
echo "6. Click 'Create'"
echo ""

# Preguntar si quiere ejecutar backfill
echo -e "${BLUE}🔄 ¿Quieres ejecutar el backfill ahora? (crea blocked slots para appointments existentes)${NC}"
read -p "Ejecutar backfill? (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}🔄 Ejecutando backfill...${NC}"
    echo ""
    echo -e "${YELLOW}Necesitas el SUPABASE_SERVICE_ROLE_KEY${NC}"
    echo "Lo encuentras en: https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/settings/api"
    echo ""
    read -p "Pega tu SERVICE_ROLE_KEY aquí: " SERVICE_KEY
    
    echo ""
    echo "Ejecutando backfill..."
    
    RESPONSE=$(curl -s -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/backfill-blocked-slots" \
      -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json")
    
    echo ""
    echo -e "${GREEN}Respuesta del backfill:${NC}"
    echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
    echo ""
fi

# Test final
echo -e "${BLUE}🧪 ¿Quieres hacer un test de voice-check-availability? (y/n)${NC}"
read -p "Ejecutar test? (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}🧪 Testeando voice-check-availability...${NC}"
    echo ""
    
    RESPONSE=$(curl -s -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/voice-check-availability" \
      -H "x-voice-agent-secret: $VOICE_AGENT_WEBHOOK_SECRET" \
      -H "Content-Type: application/json" \
      -d '{"booking_type":"daily","date":"2026-01-31"}')
    
    echo -e "${GREEN}Respuesta:${NC}"
    echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
    echo ""
fi

# Resumen final
echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ DEPLOYMENT COMPLETADO EXITOSAMENTE${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}📋 Resumen:${NC}"
echo "  ✅ Migration aplicada"
echo "  ✅ 3 Edge Functions deployadas"
echo "  ⚠️  Cron job pendiente (configurar manualmente)"
echo ""
echo -e "${BLUE}🔍 Ver logs:${NC}"
echo "  supabase functions logs sync-ghl-calendar"
echo "  supabase functions logs sync-blocked-slots-cron"
echo "  supabase functions logs voice-check-availability"
echo ""
echo -e "${BLUE}📊 Monitorear:${NC}"
echo "  Dashboard: https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi"
echo "  Functions: https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/functions"
echo ""
echo -e "${GREEN}🎉 Listo! Tu voice-check-availability ahora detectará conflictos correctamente.${NC}"
echo ""
