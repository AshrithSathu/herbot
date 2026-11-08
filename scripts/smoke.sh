#!/usr/bin/env bash
# Starts the real herbot-core binary, checks /health and /ready, then stops it.
set -euo pipefail

BIND="${HERBOT_BIND:-127.0.0.1:8788}"
LOG="$(mktemp -t herbot-smoke.XXXXXX)"

cargo build -q -p herbot-core
# Never poll Telegram from the smoke test: a second poller would steal updates.
TELEGRAM_BOT_TOKEN= HERBOT_BIND="$BIND" ./target/debug/herbot-core >"$LOG" 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  curl -fsS "http://$BIND/health" >/dev/null 2>&1 && break
  sleep 0.1
done

echo "GET /health -> $(curl -fsS "http://$BIND/health")"
echo "GET /ready  -> $(curl -fsS "http://$BIND/ready")"

kill -TERM "$PID"
wait "$PID" || true
trap - EXIT

if grep -q '"herbot-core stopped"\|herbot-core stopped' "$LOG"; then
  echo "graceful shutdown -> ok"
else
  echo "graceful shutdown -> NOT SEEN; log follows:" >&2
  cat "$LOG" >&2
  exit 1
fi
rm -f "$LOG"
