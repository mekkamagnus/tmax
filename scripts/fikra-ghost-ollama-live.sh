#!/usr/bin/env bash
# fikra-ghost-ollama-live.sh — RFC-029 §8.8's ollama source, reproduced LIVE.
#
# Drives the REAL flow against the local ollama server: the ghost source
# fires the async /api/generate (model resolved from /api/tags), the
# completion lands through the http filter + completion callbacks, and
# the ghost sets AT THE CURSOR with the honest measured latency in the
# footer. Pre-warms the model (a cold 7B model takes ~20s on this class
# of machine; warm it is seconds).
#
# Requirements: bun, ollama at localhost:11434 with at least one model.
# Usage: ./scripts/fikra-ghost-ollama-live.sh [--keep]
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${HOME}/.bun/bin"
SOCK="/tmp/fikra-ghost-verify-$$.sock"
LOG="$(mktemp -d /tmp/fikra-ghost-verify-XXXXXX)"
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

say "== fikra ghost ollama live e2e ($(date '+%H:%M:%S')) =="
MODEL=$(curl -s --max-time 5 http://localhost:11434/api/tags | python3 -c 'import sys,json; print(json.load(sys.stdin)["models"][0]["name"])')
say "  (pre-warming $MODEL — a cold model takes ~20s; subsequent runs are seconds)"
curl -s --max-time 120 http://localhost:11434/api/generate \
  -d "{\"model\":\"$MODEL\",\"prompt\":\"hi\",\"stream\":false,\"options\":{\"num_predict\":4}}" > /dev/null
ok "model warm ($MODEL)"

# ── isolated daemon ───────────────────────────────────────────────────
( cd "$LOG" && TMAX_SOCKET="$SOCK" exec "$REPO/bin/tmax" --daemon > "$LOG/daemon.log" 2>&1 ) &
DAEMON_PID=$!
for i in $(seq 1 40); do [ -S "$SOCK" ] && break; sleep 0.5; done
[ -S "$SOCK" ] && ok "daemon up" || { bad "daemon socket never appeared"; exit 1; }

# ── the buffer + the source ───────────────────────────────────────────
ev '(progn (require-module "fikra/ghost")
  (buffer-create "probe.ts") (buffer-switch "probe.ts")
  (buffer-insert "const total = items.")
  (fikra/ghost/fikra-ghost-set-source "fikra/ghost/fikra-ghost-source-ollama")
  (fikra/ghost/fikra-ghost-maybe-trigger)
  "fired")' | tail -1 | grep -q fired && ok "trigger fired (async request out)" || bad "trigger failed"

# ── poll for the landed ghost (warm model: seconds; allow 120s) ───────
GHOST=""
for i in $(seq 1 120); do
  OUT=$(ev '(if (fikra/ghost/fikra-ghost-active-p) (fikra/ghost/fikra-ghost-text) "pending")' | tail -1)
  if [ "$OUT" != "pending" ] && [ -n "$OUT" ]; then GHOST="$OUT"; break; fi
  sleep 1
done
[ -n "$GHOST" ] && ok "ghost LANDED: $GHOST" || { bad "ghost never landed"; ev '(editor-status)'; exit 1; }

STATUS=$(ev '(editor-status)' | tail -1)
echo "$STATUS" | grep -q "ollama (local," && ok "footer: $STATUS" || bad "footer missing latency: $STATUS"
echo "$STATUS" | grep -Eq "[0-9]+ms" && ok "latency measured" || bad "no latency in footer"

# ── TAB accepts it (the full loop) ────────────────────────────────────
ev '(fikra/ghost/fikra-ghost-accept)' > /dev/null
LINE=$(ev '(buffer-text)' | tail -1)
case "$LINE" in
  items.reduce*|*items.reduce*) ok "TAB accepted — line now: $LINE";;
  *) bad "accept failed: $LINE";;
esac

say ""
say "== RESULT: $PASS ok, $FAIL fail =="
[ "$FAIL" -eq 0 ] && { say "GHOST OLLAMA LIVE: PASS"; exit 0; } || { say "GHOST OLLAMA LIVE: FAIL"; exit 1; }
