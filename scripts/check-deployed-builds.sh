#!/usr/bin/env bash
# L2-04 (ClickUp 86e40ach2): show which build each deployed edge function runs.
#
# Safe by construction: it only sends OPTIONS (CORS preflight). Every function
# answers OPTIONS before doing any work, and functions that import
# _shared/build-info.ts put the build in the `x-oev-build` header. A function
# without the header prints "unknown" (old code, or not instrumented yet).
#
# Usage: scripts/check-deployed-builds.sh [function ...]
#
# The two cron functions (process-scheduled-jobs, check-post-event-transition)
# are best checked from their real cron responses, which carry `build` in the
# JSON body. In the Lovable SQL console:
#   SELECT created, status_code, left(content, 300)
#   FROM net._http_response ORDER BY created DESC LIMIT 20;
# check-post-event-transition on current code returns {success, due, moved, ...}.
set -euo pipefail

BASE="https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1"

FUNCTIONS=("$@")
if [ ${#FUNCTIONS[@]} -eq 0 ]; then
  FUNCTIONS=(
    process-scheduled-jobs check-post-event-transition
    stripe-webhook create-checkout create-balance-payment-link create-invoice create-addon-invoice
    manage-invoice cancel-booking reschedule-booking sync-to-ghl
    send-booking-confirmation send-balance-confirmation send-guest-feedback
    send-internal-booking-reminders send-low-rating-alert send-discount-email process-discount-drip
    schedule-balance-payment schedule-guest-feedback schedule-host-report-reminders
    send-staff-assignment send-staff-notices auto-generate-payroll daily-health-check
  )
fi

printf "%-36s %-6s %s\n" "function" "http" "build"
for fn in "${FUNCTIONS[@]}"; do
  headers=$(curl -s -o /dev/null -D - -X OPTIONS --max-time 15 \
    -H "Origin: https://orlandoeventvenue.org" \
    -H "Access-Control-Request-Method: POST" \
    "$BASE/$fn" || true)
  code=$(printf "%s" "$headers" | awk 'toupper($1) ~ /^HTTP/ {c=$2} END {print c}')
  build=$(printf "%s" "$headers" | awk -F': ' 'tolower($1)=="x-oev-build" {gsub(/\r/,"",$2); print $2}')
  printf "%-36s %-6s %s\n" "$fn" "${code:-none}" "${build:-unknown}"
done
