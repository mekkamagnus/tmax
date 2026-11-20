#!/usr/bin/env bash
# fikra-l2-live-e2e.sh — RFC-029 §8.3's P1, mechanically reproduced LIVE.
#
# Proves the full L2 mediation loop against the REAL claude CLI:
#   real turn -> Bash permission parks via --permission-prompt-tool ->
#   MCP bridge -> daemon mediate -> the mockup-8.3 gate panel in *Fikra*
#   (earned ckpt) -> a HEADLESS eval allow is DENIED -> the TUI's 'a'
#   KEYPRESS resolves -> claude resumes -> the command runs -> the
#   completed transcript renders.
#
# Requirements: bun, git, tmux, claude >= 2.1.329 (with
# --permission-prompt-tool) FIRST on PATH. Run from anywhere; everything
# is isolated (TMAX_SOCKET, temp project dir, tmux session) and cleaned
# up on exit. Cost: ONE real claude turn (~30-60s).
#
# Usage: ./scripts/fikra-l2-live-e2e.sh [--keep]
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SOCK="/tmp/fikra-l2-verify-$$.sock"
LIVE="$(mktemp -d /tmp/fikra-l2-verify-XXXXXX)"
TMUX_SESS="fikra-l2-verify-$$"
LOG="$LIVE/e2e.log"
KEEP="${1:-}"
PASS=0; FAIL=0
say()  { printf '%s\n' "$*" | tee -a "$LOG"; }
ok()   { PASS=$((PASS+1)); say "  ok: $*"; }
bad()  { FAIL=$((FAIL+1)); say "  FAIL: $*"; }
cleanup() {
  tmux kill-session -t "$TMUX_SESS" 2>/dev/null
  pkill -f "TMAX_SOCKET=$SOCK" 2>/dev/null
  # The daemon holds the socket; kill by its unique socket arg match.
  [ -S "$SOCK" ] && pkill -f "src/main.ts --daemon" 2>/dev/null
  if [ "$KEEP" != "--keep" ]; then rm -rf "$LIVE" "$SOCK"; fi
}
trap cleanup EXIT

ev() {  # daemon eval (HEADLESS by construction — that is part of the proof)
  TMAX_SOCKET="$SOCK" "$REPO/bin/tmax" -e "$1" 2>&1
}

command -v bun    >/dev/null || { say "bun missing"; exit 2; }
command -v git    >/dev/null || { say "git missing"; exit 2; }
command -v tmux   >/dev/null || { say "tmux missing"; exit 2; }
command -v claude >/dev/null || { say "claude missing"; exit 2; }
if ! claude --help 2>/dev/null | tr -d '\n' | grep -q -- --permission-prompt-tool; then
  say "claude $(claude --version 2>/dev/null) lacks --permission-prompt-tool (need >= 2.1.329 first on PATH)"; exit 2
fi

say "== fikra L2 live e2e ($(date '+%H:%M:%S')) =="

# ── isolated project + daemon ────────────────────────────────────────
git init -q "$LIVE" && git -C "$LIVE" config user.email t@t && git -C "$LIVE" config user.name t
printf 'Answer in one short sentence. Do not explore.\n' > "$LIVE/CLAUDE.md"
git -C "$LIVE" add -A && git -C "$LIVE" commit -q -m init
( cd "$LIVE" && TMAX_SOCKET="$SOCK" nohup "$REPO/bin/tmax" --daemon > "$LIVE/daemon.log" 2>&1 ) &
for i in $(seq 1 40); do [ -S "$SOCK" ] && break; sleep 0.5; done
[ -S "$SOCK" ] && ok "daemon up on $SOCK" || { bad "daemon socket never appeared"; tail -5 "$LIVE/daemon.log"; exit 1; }

# ── TUI attach (the INTERACTIVE frame; sets the client context dir) ──
tmux new-session -d -s "$TMUX_SESS" -x 110 -y 32 -c "$LIVE"
tmux send-keys -t "$TMUX_SESS" "TMAX_SOCKET=$SOCK $REPO/bin/tmaxclient --tui $LIVE/CLAUDE.md" Enter
sleep 5
tmux capture-pane -t "$TMUX_SESS" -p | grep -q -- "--NORMAL--" && ok "TUI attached" || bad "TUI did not attach"

# ── setup: chat + backend claude; the probe must say AVAILABLE ───────
OUT=$(ev '(progn (require-module fikra/chat) (require-module fikra/approvals)
  (require-module fikra/mode) (require-module fikra/backend-claude)
  (fikra/chat/fikra-chat-open) (fikra/adapter/fikra-set-backend "claude")
  (concat (fikra/adapter/fikra-current-backend) "/"
    (if (fikra/backend-claude/fikra-claude-approvals-probe) "L2-AVAILABLE" "L2-OFF")))')
case "$OUT" in *claude/L2-AVAILABLE) ok "backend=claude, L2 AVAILABLE";; *) bad "setup: $OUT"; exit 1;; esac

# ── the live turn: a Bash permission must PARK ───────────────────────
ev '(fikra/chat/fikra-turn-send "Use the Bash tool to run exactly this single command: touch VERIFY.txt — then reply DONE.")' >/dev/null
PARKED=""
for i in $(seq 1 60); do
  OUT=$(ev '(concat (fikra/thread/fikra-thread-status) "/" (fikra/approvals/fikra-approval-pending-p))')
  case "$OUT" in confirming*) PARKED=1; break;; idle*|running*) sleep 2;; *) sleep 2;; esac
done
[ -n "$PARKED" ] && ok "turn PARKED at the live gate ($OUT)" || { bad "turn never parked: $OUT"; ev '(buffer-text)' ; exit 1; }

# ── the panel renders with the earned ckpt ───────────────────────────
PANEL=$(ev '(progn (buffer-switch "*Fikra*") (buffer-text))' | sed -e 's/\x1b\[[0-9;]*m//g')
echo "$PANEL" | grep -q "APPROVE ACTION" && ok "panel: APPROVE ACTION" || bad "panel title missing"
echo "$PANEL" | grep -q "a Allow  r Reject  A Always" && ok "panel: mockup keys row" || bad "panel keys row missing"
echo "$PANEL" | grep -q "ckpt" && echo "$PANEL" | grep -q "baseline" && ok "panel: ckpt row present" || bad "panel ckpt row missing"

# ── THE L2 CONTRACT: headless eval allow is DENIED ───────────────────
OUT=$(ev '(fikra/approvals/fikra-approval-answer-allow)')
[ "$OUT" = "null" ] && ok "headless allow DENIED (null)" || bad "headless allow returned: $OUT"
OUT=$(ev '(concat (fikra/thread/fikra-thread-status) "/" (fikra/approvals/fikra-approval-pending-p))')
case "$OUT" in confirming*) ok "still parked after headless attempt";; *) bad "headless attempt unparked it: $OUT";; esac
[ ! -e "$LIVE/VERIFY.txt" ] && ok "no file before the interactive key" || bad "file created WITHOUT approval"

# ── the INTERACTIVE resolve: the TUI's 'a' keypress ──────────────────
sleep 1
tmux send-keys -t "$TMUX_SESS" "a"
DONE=""
for i in $(seq 1 60); do
  OUT=$(ev '(fikra/thread/fikra-thread-status)')
  case "$OUT" in idle) DONE=1; break;; *) sleep 2;; esac
done
[ -n "$DONE" ] && ok "turn completed after the keypress" || bad "turn did not complete: $OUT"
[ -e "$LIVE/VERIFY.txt" ] && ok "VERIFY.txt created by the APPROVED action" || bad "VERIFY.txt missing"

# ── the completed transcript ─────────────────────────────────────────
CHAT=$(ev '(progn (buffer-switch "*Fikra*") (buffer-text))' | sed -e 's/\x1b\[[0-9;]*m//g')
echo "$CHAT" | grep -q "= allow" && ok "transcript: decision rendered" || bad "decision row missing"
echo "$CHAT" | grep -Eq "ok #[0-9a-f]+" && ok "transcript: correlated tool result" || bad "tool result missing"
echo "$CHAT" | grep -q "completed" && ok "transcript: turn completed" || bad "completion marker missing"

say ""
say "== RESULT: $PASS ok, $FAIL fail =="
[ "$FAIL" -eq 0 ] && { say "LIVE L2 MEDIATION: PASS"; exit 0; } || { say "LIVE L2 MEDIATION: FAIL"; exit 1; }
