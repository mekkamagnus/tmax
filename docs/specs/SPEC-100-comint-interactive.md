# Feature: comint-mode interactive layer — key bindings, major mode, RET routing

## Feature Description

The comint-mode foundation (ComintManager, 9 T-Lisp primitives, output accumulation) is implemented (#165 / ADR-0197) but **non-interactive** — users can't actually use comint buffers for REPL work because the key bindings connecting keystrokes to comint commands don't exist.

This spec completes the interactive layer:
- **RET sends input** to the process (not just inserts a newline)
- **M-p / M-n** cycle through input history
- **C-c C-c** sends SIGINT, **C-c C-d** sends EOF
- A **comint major mode** that activates automatically on comint buffers
- **Output protection** — output lines are read-only; only the input line at the bottom is editable
- Mode line shows **--COMINT--** when in a comint buffer

## User Story

As a tmax user running a Node or Python REPL,
I want to type expressions, press Enter to send them, use M-p for history, and C-c C-c to interrupt,
So that the REPL feels like a real interactive session — not just a buffer with a process attached.

## Problem Statement

The comint primitives (`comint-send-input`, `comint-interrupt`, `comint-prev-input`) exist as T-Lisp functions but have no key bindings. Pressing Enter in a comint buffer just inserts a newline — the input never reaches the subprocess. History navigation and process interruption are invisible to the user. The buffer is fully editable (output can be accidentally deleted).

## Solution Statement

### Key bindings (comint-specific, conditionally active)

Add key bindings that check `(comint-buffer-p (buffer-name))` before dispatching:

| Key | Normal mode | Insert mode (comint buffer) |
|-----|------------|---------------------------|
| Enter | — | `(comint-send-input)` if comint buffer, else `(insert-newline)` |
| M-p | `(comint-prev-input)` if comint | — |
| M-n | `(comint-next-input)` if comint | — |
| C-c C-c | `(comint-interrupt)` if comint | — |
| C-c C-d | `(comint-eof)` if comint | — |

### Comint major mode (`comint-mode.tlisp`)

- Registers with buffer-name patterns (`*node-repl*`, `*python-repl*`, `*comint*`)
- Sets syntax language to nil (no highlighting)
- Shows `--COMINT--` in the status line
- Activates automatically when a comint buffer is created

### Insert handler enhancement

The insert handler's Enter path (`src/editor/handlers/insert-handler.ts:41-47`) checks `(comint-buffer-p (buffer-name))` BEFORE calling `insert-newline`. If in a comint buffer, it calls `comint-send-input` instead.

### Output protection

Use the existing `buffer-set-read-only` primitive (#135, #149) to protect output lines. When a comint buffer is created, it starts read-only. When the user wants to type input, they press `i` (enter insert mode), which temporarily makes the last line editable. After sending input (Enter), the buffer returns to read-only. This follows the vim modal editing paradigm already used throughout tmax.

Simpler MVP: just keep comint buffers in insert mode (so the user can type at the bottom) and use a prompt marker (`>` or the process prompt) to visually distinguish the input area. Don't implement region-level read-only protection yet — that's a follow-up.

## Relevant Files

**Existing (modify):**
- `src/tlisp/core/commands/comint.tlisp` — add key bindings + prompt management
- `src/editor/handlers/insert-handler.ts` — RET routing for comint buffers
- `src/tlisp/core/bindings/normal.tlisp` — wire require-module
- `src/tlisp/core/commands/comint.tlisp` — enhance `run-node`/`run-python` to enter insert mode

**New files:**
- `src/tlisp/core/modes/comint-mode.tlisp` — comint major mode definition
- `test/unit/comint-interactive.test.ts` — interactive tests

## Implementation Plan

### Phase 1: Comint major mode + status line
- Create `comint-mode.tlisp` with `major-mode-register`
- Auto-activate on buffer patterns (`*node-repl*`, `*python-repl*`)
- Status line shows `--COMINT--` (add to modeDisplay)

### Phase 2: Key bindings (the critical path)
- Bind RET → `comint-send-input` (conditional on comint-buffer-p) in insert mode
- Bind M-p/M-n → history navigation in normal mode
- Bind C-c C-c → `comint-interrupt` in normal mode
- Bind C-c C-d → `comint-eof` in normal mode

### Phase 3: Insert handler RET routing
- Modify `insert-handler.ts` Enter path to check comint-buffer-p
- If comint: call `(comint-send-input)` instead of `(insert-newline)(post-newline-hook)`

### Phase 4: UX polish
- `run-node` / `run-python` enter insert mode after buffer switch
- Comint-send-input echoes the input to the buffer before sending (so the user sees what they typed)
- Prompt detection: after process output, enter insert mode at the end of buffer

## Step by Step Tasks

### Task 1: Comint major mode (`src/tlisp/core/modes/comint-mode.tlisp`)
- Create the file with `major-mode-register "comint" '("*node-repl*" "*python-repl*")`
- nil syntax-language
- Add to modeDisplay in status-line.ts: `comint: { text: "--COMINT--", color: "cyan" }`
- Wire into normal.tlisp: `(require-module editor/modes/comint)`

### Task 2: RET routing in insert handler
- In `src/editor/handlers/insert-handler.ts`, modify the Enter handler:
  ```typescript
  else if (normalizedKey === "Enter") {
    const isComint = isTruthyResult(editor.executeCommand("(comint-buffer-p (buffer-name))"));
    if (isComint) {
      editor.executeCommand("(comint-send-input)");
    } else {
      editor.executeCommand("(insert-newline)");
      editor.executeCommand("(post-newline-hook)");
    }
  }
  ```

### Task 3: Key bindings in comint.tlisp
- Add to `comint.tlisp` (after existing commands):
  ```lisp
  (key-bind "M-p" "(if (comint-buffer-p (buffer-name)) (comint-prev-input))" "normal")
  (key-bind "M-n" "(if (comint-buffer-p (buffer-name)) (comint-next-input))" "normal")
  ```
- Note: C-c C-c and C-c C-d go in normal mode with a prefix check (C-c is already a prefix key for window commands; need to verify no conflict)

### Task 4: Enhance run-node / run-python
- After `(buffer-switch buf)`, call `(editor-set-mode "insert")` so the user can type immediately
- Add `(message "RET to send, M-p/M-n for history, C-c C-c to interrupt")`

### Task 5: Improve comint-send-input
- Current: reads `(buffer-line (cursor-line))`, sends to process, inserts newline
- Enhanced: read the text AFTER the last prompt marker (or the whole line), echo it to the buffer as `> input\n`, send to process, move cursor to end

### Task 6: Tests
- Test: `(comint-run "echo" (list "test"))` → buffer has output
- Test: comint-buffer-p returns true for comint buffers
- Test: comint-send-input sends to process (verify via echo)
- Test: comint-history-prev/next cycle history
- Test: major-mode-list includes "comint"

## Testing Strategy

### Unit Tests
- comint-buffer-p identifies comint buffers correctly
- major-mode-list includes "comint"
- auto-mode-detect for *node-repl* / *python-repl*
- comint-send-input sends and echoes
- history ring cycles correctly

### Integration Tests (manual)
- `M-x run-node` → see Node prompt → type `1+1` → Enter → see `2`
- `M-p` → see previous input → Enter → re-sends it
- `C-c C-c` → interrupts running process
- Multiple comint buffers coexist

### Edge Cases
- Process exits while user is typing → status updates
- Empty input → Enter doesn't send empty lines
- Very long output → buffer grows, no truncation (MVP)
- Unicode in input/output

## Acceptance Criteria

- [ ] `M-x run-node` opens a Node REPL buffer, enters insert mode, shows Node prompt
- [ ] Typing `1+1` + Enter sends to process; `2` appears in buffer
- [ ] M-p cycles to previous input; M-n cycles forward
- [ ] C-c C-c sends SIGINT to the running process
- [ ] comint-buffer-p correctly identifies comint buffers
- [ ] major-mode-list includes "comint"
- [ ] auto-mode-detect for *node-repl* → "comint"
- [ ] Status line shows --COMINT-- when in a comint buffer
- [ ] Multiple comint buffers coexist (node + python)
- [ ] `bun run typecheck` clean; tests pass; core-bindings green

## Validation Commands

- `bun run typecheck`
- `bun test test/unit/comint-mode.test.ts test/unit/comint-interactive.test.ts`
- `bun test test/unit/core-bindings.test.ts test/unit/vim-bindings-smoke.test.ts`
- Manual: `tmax` → `M-x run-node` → type `1+1` → Enter → see `2` → M-p → Enter → C-c C-c

## Notes

- The ComintManager and 9 T-Lisp primitives are already implemented (#165, ADR-0197). This spec adds the interactive layer on top.
- C-c is currently a prefix key in tmax (C-w is window, etc.). The C-c C-c binding for comint-interrupt needs to coexist with the existing prefix system. The simplest approach: check `(comint-buffer-p)` before the C-c prefix dispatches, so C-c C-c only fires in comint buffers.
- Read-only output protection is explicitly deferred (MVP: comint buffers are fully editable). Region-level read-only is a follow-up.
- Prompt detection (parsing `$`, `>`, `>>>` from process output) is deferred — the user types at the bottom of the buffer for now.
