#!/usr/bin/env bash
# demo-messages.sh — Demo the *Messages* buffer subsystem.
#
# Exercises severity levels, format strings, level filtering,
# command context in errors, read-only guard, and daemon query.
# Safe to re-run — it's fully idempotent.
#
# Usage: bash .claude/skills/demo/scripts/demo-messages.sh

source "$(dirname "$0")/demo-lib.sh"

demo_start

# ── Setup: create a temp file for the demo ──────────────────────────
FILE=$(demo_temp_file "messages-demo.txt" "line 1
line 2
line 3
line 4
line 5")

demo_section "Severity Levels"

# Open a file — logs at [info] level.
demo_step "Opening a file (should log at [info])"
demo_open "$FILE"

# Use (message ...) with format strings — logs at [info] by default.
demo_step "Format-string message: %s and %d substitution"
demo_eval '(message "Saved %s (%d bytes)" "config.tlisp" 2048)'

# Use (log-message ...) with an explicit :warn level.
# T-Lisp uses symbols for keywords, so we quote ':warn'.
demo_step "Explicit warn-level log"
demo_eval "(log-message ':warn \"Deprecated API called\")" ""

# Check what's accumulated so far — unbound keys should NOT appear
# because they log at [debug] and the default min level is [info].
demo_step "Current messages (default level: info)"
demo_messages

demo_section "Format Strings"

# %s substitutes a string argument.
demo_step "%s substitution"
demo_eval '(message "Hello %s" "world")'

# %d substitutes an integer argument.
demo_step "%d substitution"
demo_eval '(message "Count: %d items" 42)'

# %% produces a literal percent sign.
demo_step "%% literal percent"
demo_eval '(message "100%% complete")'

# When no format directives exist, args are joined with spaces
# for backward compatibility.
demo_step "No directives — space-joined (backward compat)"
demo_eval '(message "hello" "world")'

demo_section "Level Filtering"

# By default, min level is [info] — debug messages are suppressed.
# Let's verify by sending an unbound key.
demo_step "Send unbound key (F1) — should NOT appear at default level"
demo_key "F1"

# Now enable debug level to see everything.
demo_step "Enable debug level"
demo_eval_silent "(set-message-log-level ':debug)"

# Send another unbound key — this one SHOULD appear now.
demo_step "Send unbound key (F2) — should appear with debug enabled"
demo_key "F2"

# Restore the default level.
demo_eval_silent "(set-message-log-level ':info)"

demo_section "Command Context in Errors"

# When a T-Lisp command fails, the error is logged with the command
# name attached. This goes through executeCommand which sets
# lastCommand before the error occurs.
demo_step "Trigger a T-Lisp error (undefined symbol)"
demo_eval "(undefined-demo-function)" ""

demo_section "Read-Only Guard"

# The *Messages* buffer is read-only. Attempting to insert text
# should be rejected.
demo_step "Switch to *Messages* buffer"
demo_eval_silent '(buffer-switch "*Messages*")'

demo_step "Try to insert text into read-only buffer (should fail)"
demo_eval '(buffer-insert "hacked!")' ""

# Switch back to our file.
demo_eval_silent "(buffer-switch \"$FILE\")"

demo_section "Ring Buffer and Clear"

# Show the current message-log-max setting.
demo_step "Current message-log-max"
demo_eval "(message-log-max)"

# Clear all messages.
demo_step "Clear all messages"
demo_eval_silent "(clear-messages)"

demo_step "Messages after clear (should be empty)"
demo_messages

demo_end
