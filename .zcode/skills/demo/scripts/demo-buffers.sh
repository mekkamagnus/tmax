#!/usr/bin/env bash
# demo-buffers.sh — Demo buffer management (multiple buffers, switching).
#
# Exercises buffer creation, switching, listing, and the buffer
# switcher. Safe to re-run.
#
# Usage: bash .claude/skills/demo/scripts/demo-buffers.sh

source "$(dirname "$0")/demo-lib.sh"

demo_start

# ── Setup: create two temp files ────────────────────────────────────
FILE_A=$(demo_temp_file "buf-a.txt" "This is buffer A
Line 2 of A")
FILE_B=$(demo_temp_file "buf-b.txt" "This is buffer B
Line 2 of B")

demo_section "Multiple Buffers"

# Open the first file — creates a buffer named after the file.
demo_step "Open first file"
demo_open "$FILE_A"
demo_eval '(buffer-list)'

# Open the second file — creates another buffer.
demo_step "Open second file"
demo_open "$FILE_B"
demo_eval '(buffer-list)'

# List all buffers — should show both files plus *Messages* and *scratch*.
demo_step "List all buffers"
demo_eval '(buffer-list)'

demo_section "Buffer Switching"

# Switch back to the first file by name.
demo_step "Switch to buffer A"
demo_eval "(buffer-switch \"$FILE_A\")"
demo_eval '(buffer-list)'

# Show that the content is indeed buffer A.
demo_step "Buffer A content"
demo_buffer

# Switch to buffer B.
demo_step "Switch to buffer B"
demo_eval "(buffer-switch \"$FILE_B\")"
demo_step "Buffer B content"
demo_buffer

demo_section "*Messages* Buffer"

# The *Messages* buffer is special — it's read-only and accumulates
# editor event logs. Let's switch to it.
demo_step "Switch to *Messages*"
demo_eval '(buffer-switch "*Messages*")'
demo_step "*Messages* content (should show Opened events)"
demo_buffer

# Try to insert into *Messages* — should be rejected (read-only).
demo_step "Attempt insert into *Messages* (should fail)"
demo_eval '(buffer-insert "hacked!")' ""

demo_section "Buffer Line Count"

# Switch back to a writable buffer for line count demo.
demo_eval_silent "(buffer-switch \"buf-a.txt\")"
demo_step "Line count of buffer A"
demo_eval '(buffer-line-count)'

demo_end
