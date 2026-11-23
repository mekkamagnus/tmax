#!/bin/sh
# ledger-scrapers.sh — start (or report) the footer-scraper pollers for the
# ledgered tabs (RFC-036 / #326). The pollers run detached in the tmux session
# "tmax-scrapers", so they outlive the Claude session that started them (a
# plain background process dies with it). Each poller is addressed by TAB
# LABEL and re-resolves its pane before every scrape, so herdr's pane-id
# compaction cannot point it at a different tab.
#
# Idempotent: a poller already running is left alone, and nothing is started
# for a tab that no longer exists or has no ledger yet (a closed tab's run is
# over — its poller already recorded why it stopped).
#
# Usage: sh scripts/ledger-scrapers.sh          # start whatever is missing
#        sh scripts/ledger-scrapers.sh status   # report only

set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)
SIBLING=$(dirname "$REPO")
WS=${TMAX_SCRAPER_WORKSPACE:-w2}
SESSION=tmax-scrapers
BUN=$(command -v bun)

# label|window-name|ledger — the live ledger lives in the worktree of the tab
# that owns it (the copies elsewhere are git-synced snapshots).
LEDGERS="issue-burn-down|burn-down|$SIBLING/tmax.wt-burn/agents/ledger/issue-burn-down-2026-11-21.jsonl
task: fikra|fikra|$SIBLING/tmax.wt-fikra/agents/ledger/task-fikra-2026-11-21.jsonl"

# Matches the bun poller process only (its argv ENDS with the tab label) — not
# the sh -c wrapper or the tee. Reliable on purpose: two pollers on ONE ledger
# each treat the other's append as a unit boundary and ping-pong scrape.
# The trailing anchor is a bare "$" (the final single-quoted piece).
running() { pgrep -f 'ledger-scrape\.ts - .* --workspace '"$WS"' --tab-label '"$1"'$' >/dev/null 2>&1; }

tab_exists() { herdr tab list --workspace "$WS" 2>/dev/null | grep -q "\"label\":\"$1\""; }

start() { # label name ledger
  cmd="$BUN scripts/ledger-scrape.ts - '$3' --workspace $WS --tab-label '$1' 2>&1 | tee -a '${TMPDIR:-/tmp}/tmax-ledger-scrape-$2.log'"
  if tmux has-session -t "=$SESSION" 2>/dev/null; then
    tmux new-window -d -t "=$SESSION" -n "$2" -c "$REPO" "$cmd"
  else
    tmux new-session -d -s "$SESSION" -n "$2" -c "$REPO" "$cmd"
  fi
  echo "started: $1"
}

report() {
  printf '%s\n' "$LEDGERS" | while IFS='|' read -r label name ledger; do
    if running "$label"; then echo "running  $label"
    else echo "STOPPED  $label"; fi
  done
}

if [ "${1:-}" = status ]; then
  report
  exit 0
fi

printf '%s\n' "$LEDGERS" | while IFS='|' read -r label name ledger; do
  if running "$label"; then echo "running: $label"; continue; fi
  if ! tab_exists "$label"; then echo "skipped (no such tab): $label"; continue; fi
  if [ ! -f "$ledger" ]; then echo "skipped (no ledger): $label"; continue; fi
  start "$label" "$name" "$ledger"
done
