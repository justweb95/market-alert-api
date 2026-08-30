#!/usr/bin/env bash
#
# Deploy skripta za fb-alert-api na produkciju (Lightsail).
# Pokrece se NA SERVERU, posle raspakivanja deploy.tar.gz u ~/fb-alert-api.
#
# Sadrzaj ovog deploy-a:
#   - migracija 20260830120000_alert_cities_radius (Alert.cities, Alert.radiusKm)
#   - webhook fail-closed + resolveTier (subscription.controller)
#   - push naslovi bez [NOVO] prefiksa
#
# VAZNO: REVENUECAT_WEBHOOK_SECRET mora da postoji u .env PRE restart-a. Handler
# je od sada fail-closed - bez tajne vraca 503 i pretplate se ne sinhronizuju.

set -euo pipefail

APP_DIR="$HOME/fb-alert-api"
RC_SECRET="${RC_SECRET:-Rr6lpA3bBOTAlN7X39VDrdsLdR906tXr6OxDLJP1qDY}"

cd "$APP_DIR"

echo "==> 1/5 Backup .env i baze"
cp -n .env ".env.bak_$(date +%Y%m%d_%H%M%S)" || true
DB_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' | sed 's/?.*//')
BACKUP="/tmp/alerts_backup_$(date +%Y%m%d_%H%M%S).sql"
pg_dump "$DB_URL" > "$BACKUP"
ls -lh "$BACKUP"

echo "==> 2/5 RevenueCat webhook tajna"
if grep -q '^REVENUECAT_WEBHOOK_SECRET=' .env; then
  echo "    vec postoji u .env - ne diram"
else
  printf '\n# RevenueCat -> Project -> Integrations -> Webhooks (Authorization header)\nREVENUECAT_WEBHOOK_SECRET=%s\n' "$RC_SECRET" >> .env
  echo "    dodata"
fi

echo "==> 3/5 Prisma migracije"
npx prisma migrate deploy

echo "==> 4/5 Prisma client"
npx prisma generate

echo "==> 5/5 Restart"
pm2 restart fb-alert-api
sleep 6
pm2 logs fb-alert-api --lines 30 --nostream

echo
echo "==> Provera: nove kolone"
psql "$DB_URL" -c "\d \"Alert\"" | grep -E 'cities|radiusKm' || echo "GRESKA: kolone nisu tu"

echo
echo "==> Provera: webhook odbija bez tajne / prima sa tajnom"
echo -n "    bez header-a  -> HTTP "
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/subscription/webhook \
  -H 'Content-Type: application/json' -d '{"event":{"type":"INITIAL_PURCHASE","id":"x","app_user_id":"x","product_id":"x"}}'
echo -n "    sa tajnom     -> HTTP "
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/subscription/webhook \
  -H "Authorization: $RC_SECRET" \
  -H 'Content-Type: application/json' -d '{"event":{"type":"INITIAL_PURCHASE","id":"x","app_user_id":"nepostojeci","product_id":"market_monitor_gold_monthly"}}'
echo "    (ocekivano: 401 pa 200)"
