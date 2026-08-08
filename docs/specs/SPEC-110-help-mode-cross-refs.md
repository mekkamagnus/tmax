# Feature: `help-mode` — cross-references + history in `*Help*` (Tier 1)

## Feature Description
Give the `*Help*` buffer a dedicated major mode that makes references clickable
and adds back/forward navigation — Emacs `help-mode` parity. Today `*Help*` is
plain text in normal mode: `` `save-buffer' ``, `<C-h>`, mode names, and
documentation.ts "related functions" are inert strings, not links. Make them
buttons that jump to the referenced symbol's/key's describe output, with a
history stack (`help-go-back` / `help-go-forward`).

## Goals
- In `*Help*`, references render as buttons: `` `symbol' `` → describe-function/
  describe-variable; `<key>` → describe-key; a documented mode name →
  describe-mode; documentation.ts "related" entries → their describe pages.
- `RET`/mouse on a button follows; `l`/`r` (or `C-c C-b`/`C-c C-f`) navigate
  back/forward through the help history.
- `TAB`/`S-TAB` cycle between buttons (Emacs parity).
- `q` buries the buffer.

## User Story
As a user exploring the editor, I want to click from `save-buffer`'s docs to
`write-file`'s (its related function) and back, the way I browse Wikipedia — not
re-type `SPC h f` each time.

## Problem Statement
`describe-to-help` writes plain text to `*Help*` and switches to normal mode.
Cross-references in docstrings / documentation.ts ("related functions",
`` `other-symbol' ``) are dead text. Browsing is linear: every jump is a fresh
`SPC h f` with no way back. This is the single biggest gap vs Emacs's help UX.

## Solution Statement
1. **`help-mode`** — a read-only major mode for `*Help*` with a button overlay
   model: a help renderer produces `(line, [buttons])` where each button has a
   target (`{kind: 'function'|'variable'|'key'|'mode', name}`).
2. **Rendering** — `describe-*` output goes through the renderer; references are
   detected (`` `name' ``, `<key>`, known mode names, explicit "related" lists)
   and turned into buttons.
3. **Navigation** — `help-history` stack; `RET` pushes current + jumps;
   `help-go-back`/`help-go-forward` pop; `TAB` cycles buttons; `q` buries.

## Relevant Files
- New: `src/tlisp/core/modes/help-mode.tlisp` (+ register with a description per SPEC-108).
- `src/tlisp/core/commands/describe.tlisp` — `describe-to-help` (route through renderer).
- `src/editor/api/describe-ops.ts` — produce structured (text + buttons) output.
- `src/frontend/render/` — button overlay rendering in the TUI; capture-mode key dispatch.
- `src/editor/handlers/normal-handler.ts` — `RET`/`TAB`/`l`/`r`/`q` in help-mode.

## Implementation Plan
### Phase 1: Button model + renderer
Define `HelpButton { kind, name }`; renderer maps describe output → text + button
ranges; reference detection for `` `sym' `` / `<key>` / related lists.

### Phase 2: help-mode keymap
`RET` follow, `TAB`/`S-TAB` cycle, `l`/`r` history, `q` bury, read-only.

### Phase 3: History stack
Push-on-follow; back/forward; clamp at both ends.

## Step by Step Tasks
### Task 1: Button model + reference detection
**Acceptance Criteria**:
- [ ] `` `save-buffer' `` in a docstring becomes a describe-function button.
- [ ] `<C-h>` becomes a describe-key button; related-function list → buttons.

### Task 2: help-mode + navigation
**Acceptance Criteria**:
- [ ] `*Help*` opens in `help-mode` (read-only); `RET` follows a button.
- [ ] `TAB`/`S-TAB` cycle buttons; `l`/`r` navigate history; `q` buries.
- [ ] Following a button pushes history; back returns to the prior page.

### Task 3: Wire all describe-* through the renderer
**Acceptance Criteria**:
- [ ] describe-function/-variable/-key/-mode output has working buttons.
- [ ] apropos results (SPEC-107) jump into describe-* via buttons.

## Testing Strategy
- Unit: reference detector (`` `foo' `` → button; plain `foo` → none).
- Unit: history push/pop/back/forward.
- Manual: browse `save-buffer` → `write-file` → back.

## Acceptance Criteria (Completion)
- [ ] `*Help*` is a `help-mode` buffer with clickable symbol/key/mode references.
- [ ] Back/forward history works; `TAB` cycles; `q` buries.
- [ ] All describe-* + apropos output is navigable via buttons.

## Validation Commands
- `bun run typecheck`; `bun run build`
- `bun test test/unit/help-mode.test.ts` (new)
- Manual: `SPC h f save-buffer RET` → click `write-file` → `l` returns.

## Notes
- This is the highest-value Tier 1 item: it turns the existing describe-* into a
  hypertext graph with minimal new doc authoring.
- Depends on describe-* output being structured (extend describe-ops). No Texinfo.
- Button rendering in a TUI (overlay/capture) is the piece with the largest
  **verification surface** — a new overlay subsystem with its own test surface.
  Budget tests there; the agent writing it is not the constraint, keeping it
  correct under the capture/render pipeline is.
