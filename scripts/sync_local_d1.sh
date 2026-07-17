#!/bin/bash
# Pages 專案根目錄跟 worker-cron/ 子目錄，各自有獨立的本機 D1 模擬實例（.wrangler/state/v3/d1）
# ——同一個 elan-quant-db，但 wrangler pages dev 跟 wrangler dev 在不同目錄下各自模擬一份。
# 加新 migration 時很容易忘記兩邊都要套，2026-07-16 晚上就因為忘記同步過一次，導致
# daily_market_data 缺 updated_at 欄位讓本機測試失敗。這支腳本把 schema.sql 跟全部
# migrations 一次套到兩邊，不用每次手動想「這次是不是兩邊都套過了」。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCHEMA="$ROOT/worker-cron/schema.sql"

apply_to_both() {
  local file="$1"
  echo "-- $(basename "$file") --"
  ( cd "$ROOT" && npx wrangler d1 execute elan-quant-db --local --file="$file" ) \
    && echo "   [root]        OK" || echo "   [root]        skipped (likely already applied)"
  ( cd "$ROOT/worker-cron" && npx wrangler d1 execute elan-quant-db --local --file="$file" ) \
    && echo "   [worker-cron] OK" || echo "   [worker-cron] skipped (likely already applied)"
}

echo "== schema.sql =="
apply_to_both "$SCHEMA"

echo ""
echo "== migrations (idempotent — re-running an already-applied ALTER TABLE is expected to fail/skip) =="
for f in "$ROOT"/worker-cron/migrations/*.sql; do
  apply_to_both "$f"
done

echo ""
echo "Done. Both local D1 instances (Pages project root + worker-cron/) are now in sync."
