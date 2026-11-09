#!/usr/bin/env bash
# Prints the Codex config block that registers herbot-mcp, using values from
# .env. Append it to ~/.codex/config.toml (or the bots-T3's CODEX_HOME) once:
#   ./scripts/codex-mcp-config.sh >> ~/.codex/config.toml
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
: "${HERBOT_INTERNAL_TOKEN:?set HERBOT_INTERNAL_TOKEN in .env}"
BIN="$(pwd)/target/release/herbot-mcp"
PERSONAL_ROOT="${HERBOT_AGENTS_DIR:-agents}"
case "$PERSONAL_ROOT" in
  /*) ;;
  *) PERSONAL_ROOT="$(pwd)/$PERSONAL_ROOT" ;;
esac
cat <<TOML

# Herbot's agent tools (from the herbot repo). Remove this block to turn them off.
[mcp_servers.herbot]
command = "$BIN"
startup_timeout_sec = 20
# ask_topic waits for another agent's turn (up to HERBOT_TURN_TIMEOUT_SECS).
tool_timeout_sec = $(( ${HERBOT_TURN_TIMEOUT_SECS:-600} + 60 ))

[mcp_servers.herbot.env]
DATABASE_URL = "${DATABASE_URL:-postgres://herbot:herbot@127.0.0.1:5433/herbot}"
HERBOT_AGENTS_DIR = "$PERSONAL_ROOT"
HERBOT_CORE_URL = "http://${HERBOT_BIND:-127.0.0.1:8787}"
HERBOT_INTERNAL_TOKEN = "$HERBOT_INTERNAL_TOKEN"
OPENAI_API_KEY = "${OPENAI_API_KEY:-}"
XAI_API_KEY = "${XAI_API_KEY:-}"
X_BEARER_TOKEN = "${X_BEARER_TOKEN:-}"
HERBOT_VIDEO_MODEL = "${HERBOT_VIDEO_MODEL:-}"
RUST_LOG = "warn"
TOML
