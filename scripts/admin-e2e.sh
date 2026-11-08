#!/usr/bin/env bash
# End-to-end test of the admin panel in a real browser (your installed Google
# Chrome), against a real herbot-core and a throwaway database. Never touches
# the live bot: its own DB (herbot_e2e), its own ports, no Telegram, a fake T3.
set -euo pipefail
cd "$(dirname "$0")/.."

PG="postgres://herbot:herbot@127.0.0.1:5433"
DB="herbot_e2e"
CORE="127.0.0.1:${E2E_CORE_PORT:-8789}"
PANEL_PORT="${E2E_PANEL_PORT:-3399}"
WORK="$(mktemp -d -t herbot-e2e.XXXXXX)"
ADMIN_TOKEN="e2e-admin-token-$(openssl rand -hex 16)"
export E2E_PASSWORD="e2e-password-$(openssl rand -hex 6)"
PIDS=()
cleanup() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

wait_for() {
  for _ in $(seq 1 100); do curl -fsS "$1" >/dev/null 2>&1 && return 0; sleep 0.1; done
  echo "timed out waiting for $1" >&2
  return 1
}

for port in "${CORE##*:}" "$PANEL_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $port is already in use; stop whatever holds it first" >&2
    exit 1
  fi
done

ROOT="$PWD"
psql_() { docker compose -f "$ROOT/docker-compose.yml" exec -T postgres psql -q -v ON_ERROR_STOP=1 -U herbot "$@"; }
psql_ -d herbot -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"

# A T3 that refuses everything, so no test can reach real threads.
printf '#!/bin/sh\necho "fake t3 for e2e: refusing $*" >&2\nexit 1\n' >"$WORK/t3"
chmod +x "$WORK/t3"
mkdir -p "$WORK/agents"

cargo build -q -p herbot-core
DATABASE_URL="$PG/$DB" HERBOT_BIND="$CORE" TELEGRAM_BOT_TOKEN= HERBOT_INTERNAL_TOKEN= \
  HERBOT_ADMIN_TOKEN="$ADMIN_TOKEN" HERBOT_AGENTS_DIR="$WORK/agents" HERBOT_T3_BIN="$WORK/t3" \
  HERBOT_LOG_FORMAT=pretty ./target/debug/herbot-core >"$WORK/core.log" 2>&1 &
PIDS+=($!)
wait_for "http://$CORE/health"

# Empties every table, then loads a seed file from apps/admin/e2e/.
SEED_DIR="$PWD/apps/admin/e2e"
seed() {
  psql_ -d "$DB" -c "TRUNCATE bots, chats, conversations, messages, agent_threads, pending_questions, kv, errors, audit_log RESTART IDENTITY CASCADE"
  psql_ -d "$DB" <"$SEED_DIR/$1"
}

cd apps/admin
pnpm -s build
HERBOT_CORE_URL="http://$CORE" HERBOT_ADMIN_TOKEN="$ADMIN_TOKEN" HERBOT_ADMIN_PASSWORD="$E2E_PASSWORD" \
  HERBOT_SESSION_SECRET="e2e-session-secret-$(openssl rand -hex 16)" \
  ./node_modules/.bin/srvx --prod --host 127.0.0.1 --port "$PANEL_PORT" -s ../client dist/server/server.js \
  >"$WORK/panel.log" 2>&1 &
PIDS+=($!)
wait_for "http://127.0.0.1:$PANEL_PORT/login"

export E2E_BASE_URL="http://127.0.0.1:$PANEL_PORT" E2E_DB="$DB"
run() {
  if ! pnpm -s exec playwright test "$@"; then
    echo "--- herbot-core log"; tail -40 "$WORK/core.log"
    echo "--- panel log"; tail -40 "$WORK/panel.log"
    exit 1
  fi
}

if [ $# -gt 0 ]; then
  # Specific specs: one seed (E2E_SEED=stress for the worst-case data).
  if [ "${E2E_SEED:-}" = "stress" ]; then seed seed-stress.sql; else seed seed.sql; fi
  run "$@"
else
  # Everything: normal behaviour on small data, then the worst case.
  seed seed.sql
  run e2e/panel.spec.ts
  seed seed-stress.sql
  run e2e/stress.spec.ts e2e/a11y.spec.ts
fi
