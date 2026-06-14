#!/usr/bin/env bash
# demo-completion.sh — Demo the completion system (M-x, find-file).
#
# Exercises the minibuffer completion framework: M-x command
# completion, find-file file completion, and history recall.
# Safe to re-run.
#
# Usage: bash .claude/skills/demo/scripts/demo-completion.sh

source "$(dirname "$0")/demo-lib.sh"

demo_start

# ── Setup: create a temp directory with some files ──────────────────
DIR=$(mktemp -d /tmp/tmax-demo-completion.XXXXXX)
echo "file-a.txt content" > "$DIR/file-a.txt"
echo "file-b.txt content" > "$DIR/file-b.txt"
echo "script.tlisp content" > "$DIR/script.tlisp"
_DEMO_TEMP_FILES+=("$DIR/file-a.txt" "$DIR/file-b.txt" "$DIR/script.tlisp")

demo_section "M-x Command Completion"

# M-x uses the completing-read framework with the command table.
# It populates candidates from callable T-Lisp functions that
# have documentation or key bindings.
demo_step "List callable commands"
demo_eval '(callable-command-details)'

# The command-history tracks M-x invocations.
demo_step "Command history (empty initially)"
demo_eval "(minibuffer-history-values \"command-history\")"

# Invoke a command by name through invoke-command (what M-x uses).
demo_step "Invoke cursor-position via command system"
demo_eval '(invoke-command "cursor-position")'

demo_section "File Completion"

# The find-file command uses file-table completion to list files
# in a directory. Let's test the completion table directly.
demo_step "File completion candidates for temp dir"
demo_eval "(completion-all-completions \"$DIR/\" \"file-completion-table\" nil)"

demo_section "Buffer Completion"

# Buffer switching uses buffer-list-details to build candidates.
demo_step "Open a file to create a buffer"
demo_open "$DIR/file-a.txt"

demo_step "Buffer completion candidates"
demo_eval '(buffer-list-details)'

demo_section "Minibuffer State"

# The minibuffer state machine is T-Lisp owned. We can inspect
# the current state — when no completion is active, it should be nil.
demo_step "Minibuffer state (should be nil when inactive)"
demo_eval '(minibuffer-state-get)'

# ── Cleanup temp directory ──────────────────────────────────────────
rm -rf "$DIR" 2>/dev/null || true

demo_end
