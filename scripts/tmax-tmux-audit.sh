#!/usr/bin/env bash
set -euo pipefail

cleanup=false
if [[ "${1:-}" == "--cleanup-stale-shells" ]]; then
  cleanup=true
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--cleanup-stale-shells]" >&2
  exit 2
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux not found" >&2
  exit 1
fi

sessions="$(tmux list-sessions -F '#{session_name}|#{session_attached}|#{session_created_string}' 2>/dev/null || true)"
if [[ -z "$sessions" ]]; then
  echo "No tmux sessions are running."
  exit 0
fi

list_session_panes() {
  local session="$1"
  local window_id
  tmux list-windows -t "$session" -F '#{window_id}' 2>/dev/null | while IFS= read -r window_id; do
    [[ -z "$window_id" ]] && continue
    tmux list-panes -t "$window_id" -F '  window=#{window_index}:#{window_name} pane=#{pane_index} cmd=#{pane_current_command} cwd=#{pane_current_path}' 2>/dev/null || true
  done
}

list_session_pane_commands() {
  local session="$1"
  local window_id
  tmux list-windows -t "$session" -F '#{window_id}' 2>/dev/null | while IFS= read -r window_id; do
    [[ -z "$window_id" ]] && continue
    tmux list-panes -t "$window_id" -F '#{pane_current_command}' 2>/dev/null || true
  done
}

echo "tmax tmux resources"
echo
printf '%-28s %-9s %-21s %s\n' "SESSION" "ATTACHED" "CREATED" "CLASS"

stale_shell_sessions=()
while IFS='|' read -r name attached created; do
  [[ -z "$name" ]] && continue

  class="other"
  if [[ "$name" == "tmax" ]]; then
    class="canonical"
  elif [[ "$name" == tmax-ui-* ]]; then
    class="harness"
  elif [[ "$name" == tmax-test* ]]; then
    class="manual-test"
  elif [[ "$name" == tmax* ]]; then
    class="manual"
  fi

  [[ "$class" == "other" ]] && continue
  printf '%-28s %-9s %-21s %s\n' "$name" "$attached" "$created" "$class"

  pane_lines="$(list_session_panes "$name")"
  if [[ -n "$pane_lines" ]]; then
    echo "$pane_lines"
  fi

  if [[ "$name" == tmax-ui-* && "$attached" == "0" ]]; then
    pane_commands="$(list_session_pane_commands "$name")"
    if [[ -n "$pane_commands" ]] && ! echo "$pane_commands" | rg -v '^(zsh|bash|sh|fish)$' >/dev/null 2>&1; then
      stale_shell_sessions+=("$name")
    fi
  fi
done <<< "$sessions"

echo
if [[ ${#stale_shell_sessions[@]} -eq 0 ]]; then
  echo "No detached stale harness shell sessions found."
else
  echo "Detached stale harness shell sessions:"
  printf '  %s\n' "${stale_shell_sessions[@]}"
  if [[ "$cleanup" == true ]]; then
    for name in "${stale_shell_sessions[@]}"; do
      tmux kill-session -t "$name" 2>/dev/null || true
    done
    echo "Cleaned ${#stale_shell_sessions[@]} stale harness shell session(s)."
  else
    echo
    echo "Run with --cleanup-stale-shells to kill only detached tmax-ui-* sessions whose panes are shells."
  fi
fi
