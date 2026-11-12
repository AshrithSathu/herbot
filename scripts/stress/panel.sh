#!/usr/bin/env bash
# Runs the admin panel against worst-case data, never the real database:
#   ./scripts/stress/panel.sh        then sign in at http://127.0.0.1:3310
#                                    with the password stress-panel-pass-2026
# A separate database (herbot_stress) gets 220 hostile topics, a 6,000-message
# topic, 3,000 errors, 300 memories, 300 tasks and awkward files; herbot-core
# runs on 8790 with Telegram and OpenAI off; the panel's dev server on 3310.
# Ctrl+C stops both.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a
DB=postgres://herbot:herbot@127.0.0.1:5433/herbot_stress
AGENTS="$(mktemp -d)/agents"
psql() { docker compose exec -T postgres psql -U herbot "$@"; }

psql -d herbot -qc "DROP DATABASE IF EXISTS herbot_stress" -c "CREATE DATABASE herbot_stress OWNER herbot"
CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-target-agents} cargo build -q -p herbot-core
BIN="${CARGO_TARGET_DIR:-target-agents}/debug/herbot-core"

TELEGRAM_BOT_TOKEN= OPENAI_API_KEY= HERBOT_SIMULATE= DATABASE_URL=$DB \
  HERBOT_BIND=127.0.0.1:8790 HERBOT_AGENTS_DIR="$AGENTS" HERBOT_LOG_FORMAT=pretty \
  "$BIN" > /dev/null 2>&1 &
CORE=$!
trap 'kill $CORE ${PANEL:-} 2>/dev/null' EXIT
until curl -sf 127.0.0.1:8790/health > /dev/null; do sleep 0.5; done   # migrations applied

psql -d herbot_stress -v ON_ERROR_STOP=1 -q < scripts/stress/seed.sql 2> /dev/null
curl -sf -X PUT 127.0.0.1:8790/admin/api/preferences -H "authorization: Bearer $HERBOT_ADMIN_TOKEN" \
  -H 'content-type: application/json' --data "$(python3 -c 'import json; print(json.dumps({
  "custom_instructions": ("Always answer in **Markdown** with tables. " * 60)[:2990],
  "about_you": ("أنا مهندس برمجيات. I live in Hyderabad 🇮🇳 and like Rust 🦀. " * 40)[:1490]}))')" > /dev/null

FILES="$AGENTS/chat_-1004447072305/topic_1002/files"
mkdir -p "$FILES/out" "$FILES/deeply/nested/folder/structure/that/goes/on"
for i in $(seq 1 150); do echo "file $i" > "$FILES/report-$i.txt"; done
touch "$FILES/$(printf 'very_long_file_name_%.0s' {1..10}).pdf" "$FILES/名前のファイル 🦀.md" "$FILES/عربي.txt" \
  "$FILES/spaces   in   name .docx" "$FILES/no-extension" "$FILES/.hidden" "$FILES/zero-bytes.csv"
truncate -s 48m "$FILES/big-video.mp4"

echo "Stress panel: http://127.0.0.1:3310 (password stress-panel-pass-2026). Ctrl+C to stop."
HERBOT_CORE_URL=http://127.0.0.1:8790 HERBOT_ADMIN_PORT=3310 HERBOT_ADMIN_PASSWORD=stress-panel-pass-2026 \
  bun run --cwd apps/admin dev &
PANEL=$!
wait $PANEL
