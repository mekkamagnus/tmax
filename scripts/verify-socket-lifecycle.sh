#!/usr/bin/env bash
# verify-socket-lifecycle.sh — #235 (SPEC-235): live verification of the daemon
# socket lifecycle under Bun 1.4 semantics (EADDRINUSE bind, .sock cleanup on
# close). Re-runnable: run after any future Bun bump to re-verify.
#
# Scenarios:
#   1. happy path       — daemon start, eval round-trip, tmax --stop
#   2. double daemon    — second `tmax --daemon` must fail loudly (non-zero)
#   3. SIGKILL recovery — killed daemon leaves stale socket+lock; next start reclaims
#   4. sweep            — `tmax --sweep --apply` reaps the killed daemon's remains
#
# Uses the canonical socket (/tmp/tmax-<uid>/server) so sweep can discover it.
# Aborts (without killing) if a daemon it didn't start is already running.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TMAX="$PROJECT_DIR/bin/tmax"
TMAXCLIENT="$PROJECT_DIR/bin/tmaxclient"
SOCKET="${TMAX_SOCKET:-/tmp/tmax-$(id -u)/server}"
LOCK="$SOCKET.lock"
DAEMON_PID=""
OWNED=false  # true only once start_daemon has brought a daemon up — cleanup
             # must never touch a daemon this script didn't start

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1" >&2; exit 1; }

cleanup() {
  if [ "$OWNED" = true ]; then
    [ -n "$DAEMON_PID" ] && kill -9 "$DAEMON_PID" 2>/dev/null || true
    "$TMAX" --stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

start_daemon() {
  "$TMAX" --daemon >/tmp/tmax-235-daemon.log 2>&1 &
  DAEMON_PID=$!
  disown "$DAEMON_PID" 2>/dev/null || true  # no "Killed" job notices on our kill -9s
  # Wait for the daemon to ANSWER, not for the socket file to exist — a stale
  # socket file from a killed daemon satisfies -S instantly while the new
  # daemon is still reclaiming it.
  for _ in $(seq 1 40); do
    "$TMAXCLIENT" -s "$SOCKET" --ping >/dev/null 2>&1 && { OWNED=true; return 0; }
    sleep 0.25
  done
  fail "daemon never answered a ping on $SOCKET (log: /tmp/tmax-235-daemon.log)"
}

eval_ok() {
  local got
  got="$("$TMAXCLIENT" --eval '(+ 1 2)' 2>/dev/null)" || fail "eval round-trip failed: $1"
  [ "$got" = "3" ] || fail "eval round-trip returned '$got' (expected 3): $1"
}

echo "Bun $(bun --version) — socket $SOCKET"

# Abort if a daemon we don't own is already serving.
if "$TMAXCLIENT" --eval '(+ 1 1)' >/dev/null 2>&1; then
  fail "a live daemon is already at $SOCKET — run 'tmax --stop' first"
fi

# --- 1. happy path -----------------------------------------------------------
start_daemon
pass "1a daemon started, socket up"
eval_ok "1b"
pass "1b eval round-trip"
"$TMAX" --stop >/dev/null 2>&1
DAEMON_PID=""
for _ in $(seq 1 20); do [ ! -S "$SOCKET" ] && break; sleep 0.25; done
[ ! -S "$SOCKET" ] || fail "socket still present after tmax --stop"
[ ! -f "$LOCK" ] || fail "lock still present after tmax --stop"
pass "1c tmax --stop removed socket (+lock); close-cleanup + removeFile both tolerated"

# --- 2. double daemon fails loudly -------------------------------------------
start_daemon
pass "2a first daemon up"
set +e
"$TMAX" --daemon >/tmp/tmax-235-second.log 2>&1
SECOND_RC=$?
set -e
[ "$SECOND_RC" -ne 0 ] || fail "second tmax --daemon exited 0 — socket was stolen or reused"
grep -qiE "already running|EADDRINUSE|cannot acquire" /tmp/tmax-235-second.log || \
  fail "second daemon failed (rc=$SECOND_RC) but without a loud, diagnostic error (see /tmp/tmax-235-second.log)"
pass "2b second daemon failed loudly (rc=$SECOND_RC, diagnostic present)"
eval_ok "2c"
pass "2c first daemon unaffected"
"$TMAX" --stop >/dev/null 2>&1
DAEMON_PID=""

# --- 3. SIGKILL recovery ------------------------------------------------------
start_daemon
kill -9 "$DAEMON_PID"
DAEMON_PID=""
sleep 0.5
[ -e "$SOCKET" ] || [ -f "$LOCK" ] || echo "note: killed daemon left no stale files (close-cleanup raced the kill)"
start_daemon   # must reclaim stale socket+lock without manual cleanup
pass "3a next start reclaimed the killed daemon's socket+lock"
eval_ok "3b"
pass "3b recovered daemon serves eval"
"$TMAX" --stop >/dev/null 2>&1
DAEMON_PID=""

# --- 4. sweep reaps killed-daemon remains ------------------------------------
start_daemon
kill -9 "$DAEMON_PID"
DAEMON_PID=""
sleep 0.5
"$TMAX" --sweep --apply >/tmp/tmax-235-sweep.log 2>&1 || true
sleep 0.5
# Attribution: sweep itself must report having removed something — otherwise
# the absent files could be start's own reclaim path, not sweep.
grep -qE "removed [1-9][0-9]* (lock|socket)" /tmp/tmax-235-sweep.log || \
  fail "sweep --apply ran but reported removing nothing (see /tmp/tmax-235-sweep.log)"
[ ! -e "$SOCKET" ] || fail "sweep --apply left stale socket $SOCKET"
[ ! -f "$LOCK" ] || fail "sweep --apply left stale lock $LOCK"
pass "4  tmax --sweep --apply removed killed-daemon remains (sweep-attributed)"

echo "ALL SOCKET-LIFECYCLE CHECKS PASSED"
