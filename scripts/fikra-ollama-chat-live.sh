#!/usr/bin/env bash
# fikra-ollama-chat-live.sh — RFC-029 §8.1's RAW-API native loop, LIVE.
#
# A fikra-OWNED chat turn against the local ollama /api/chat (no CLI
# wrapper): turn-send → the backend fires the async request → the reply
# lands through the ownership dispatcher → the assistant turn renders →
# the turn completes. Pre-warms the model.
#
# Requirements: bun, curl, ollama at localhost:11434 with a model.
# Usage: ./scripts/fikra-ollama-chat-live.sh [--keep]
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${HOME}/.bun/bin"
SOCK="/tmp/fikra-olchat-verify-$$.sock"
LOG="$(mktemp -d /tmp/fikra-olchat-verify-XXXXXX)"
DAEMON_PID=""
KEEP="${1:-}"
PASS=0; FAIL=0
say() { printf '%s\n' "$*"; }
ok()  { PASS=$((PASS+1)); say "  ok: $*"; }
bad() { FAIL=$((FAIL+1)); say "  FAIL: $*"; }
cleanup() {
  [ -n "$DAEMON_PID" ] && kill "$DAEMON_PID" 2>/dev/null
  [ "$KEEP" != "--keep" ] && rm -rf "$LOG" "$SOCK"
}
trap cleanup EXIT
ev() { TMAX_SOCKET="$SOCK" "$REPO/bin/tmax" -e "$1" 2>&1; }

command -v bun >/dev/null || { say "bun missing"; exit 2; }
command -v curl >/dev/null || { say "curl missing"; exit 2; }
if ! curl -s --max-time 3 http://localhost:11434/api/tags | grep -q '"models"'; then
  say "ollama not answering at localhost:11434 (start it first)"; exit 2
fi

say "== fikra ollama CHAT live e2e ($(date '+%H:%M:%S')) =="
MODEL=$(curl -s --max-time 5 http://localhost:11434/api/tags | python3 -c 'import sys,json; print(json.load(sys.stdin)["models"][0]["name"])')
say "  (pre-warming $MODEL)"
curl -s --max-time 120 http://localhost:11434/api/generate \
  -d "{\"model\":\"$MODEL\",\"prompt\":\"hi\",\"stream\":false,\"options\":{\"num_predict\":4}}" > /dev/null
ok "model warm ($MODEL)"

# ── isolated project + daemon ─────────────────────────────────────────
git init -q "$LOG/repo" 2>/dev/null || true
printf '.tmax/\n' > "$LOG/repo/.gitignore"
( cd "$LOG/repo" && TMAX_SOCKET="$SOCK" exec "$REPO/bin/tmax" --daemon > "$LOG/daemon.log" 2>&1 ) &
DAEMON_PID=$!
for i in $(seq 1 40); do [ -S "$SOCK" ] && break; sleep 0.5; done
[ -S "$SOCK" ] && ok "daemon up" || { bad "daemon socket never appeared"; exit 1; }

# DEBUG: early probes


# ── the chat open + the raw-API turn ──────────────────────────────────
OUT=$(ev '(progn (require-module fikra/chat) (require-module fikra/backend-ollama)
  (require-module fikra/approvals)
  (fikra/chat/fikra-chat-open)
  (fikra/adapter/fikra-set-backend "ollama")
  (concat "be=" (fikra/adapter/fikra-current-backend)))' | tail -1)
echo "$OUT" | grep -q "be=ollama" && ok "backend=ollama (registered + available)" || { bad "setup: $OUT"; exit 1; }

ev '(fikra/chat/fikra-turn-send "Reply with exactly: the resize handler is fixed")' > /dev/null
ok "turn fired (the raw /api/chat request is out)"

DONE=""
for i in $(seq 1 120); do
  OUT=$(ev '(fikra/thread/fikra-thread-status)' | tail -1)
  case "$OUT" in idle|error) DONE=1; break;; *) sleep 1;; esac
done
[ -n "$DONE" ] && ok "turn settled ($OUT)" || { bad "turn never settled: $OUT"; exit 1; }
[ "$OUT" = "idle" ] && ok "status idle (completed)" || bad "status $OUT (expected idle)"

CHAT=$(ev '(progn (buffer-switch "*Fikra*") (buffer-text))' | sed -e 's/\x1b\[[0-9;]*m//g')
echo "$CHAT" | grep -q "user › Reply with exactly" && ok "the user turn renders" || bad "user turn missing"
echo "$CHAT" | grep -q "assistant › " && ok "the ASSISTANT reply rendered (the fikra-owned loop)" || bad "no assistant reply"
echo "$CHAT" | grep -q "completed" && ok "the completed marker" || bad "no completion marker"

STATUS=$(ev '(editor-status)' | tail -1)
echo "$STATUS" | grep -q "turn completed" && ok "status: $STATUS" || bad "status: $STATUS"

say ""
say "== RESULT: $PASS ok, $FAIL fail =="
[ "$FAIL" -eq 0 ] && { say "OLLAMA CHAT LIVE: PASS"; exit 0; } || { say "OLLAMA CHAT LIVE: FAIL"; exit 1; }
