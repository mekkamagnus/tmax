#!/usr/bin/env bash
# demo-editing.sh — Demo basic editing operations.
#
# Exercises file opening, cursor movement, insert/delete,
# undo/redo, and save. Safe to re-run.
#
# Usage: bash .claude/skills/demo/scripts/demo-editing.sh

source "$(dirname "$0")/demo-lib.sh"

demo_start

# ── Setup: create a temp file with some content ─────────────────────
FILE=$(demo_temp_file "editing-demo.txt" "Hello World
This is line 2
This is line 3
This is line 4
This is line 5")

demo_section "File Operations"

# Open the file — the editor loads it into a gap buffer.
demo_step "Open a file"
demo_open "$FILE"

# Show the current buffer content.
demo_step "Buffer content after open"
demo_buffer

# Show current state — mode, cursor position, filename.
demo_step "Editor state"
demo_eval '(cursor-position)'
demo_eval '(editor-mode)'
demo_eval '(buffer-list)'

demo_section "Cursor Movement"

# Move down 2 lines using T-Lisp cursor primitives.
demo_step "Move cursor to line 3"
demo_eval '(cursor-move 2 0)'

# Show the new position.
demo_eval '(cursor-position)'

# Move to end of file (G key in normal mode).
demo_step "Go to end of file"
demo_key "G"
demo_eval '(cursor-position)'

# Go back to the top (gg sequence — double g).
demo_step "Go to top of file"
demo_key "g"
demo_key "g"
demo_eval '(cursor-position)'

demo_section "Insert Mode"

# Enter insert mode — the editor switches mode state.
demo_step "Enter insert mode"
demo_key "i"
demo_eval '(editor-mode)'

# Insert text at the cursor position.
demo_step "Insert text"
demo_insert "INSERTED "

# Return to normal mode.
demo_step "Back to normal mode"
demo_key "Escape"
demo_eval '(editor-mode)'

# Show the modified buffer.
demo_step "Buffer after insert"
demo_buffer

demo_section "Delete Operations"

# Delete a character with x key (vim-style).
demo_step "Delete character (x)"
demo_key "x"

# Show buffer after delete.
demo_step "Buffer after delete"
demo_buffer

demo_section "Undo/Redo"

# Undo the last change.
demo_step "Undo"
demo_key "u"

# Show buffer after undo — the deleted character should be back.
demo_step "Buffer after undo"
demo_buffer

demo_section "Save"

# Save the current buffer to disk.
demo_step "Save the file"
demo_save

# Verify the file was saved by checking the message log.
demo_eval '(message-log-max)'

demo_end
