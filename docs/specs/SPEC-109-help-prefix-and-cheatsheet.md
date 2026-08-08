# Feature: `C-h` real prefix + `cheatsheet` command (Tier 0)

## Feature Description
Two small help-UX fixes:
1. **`C-h` is a real prefix** — today it only prints a hint ("Help: (k)ey,
   (f)unction…") and does not capture the next key. Make it dispatch like `SPC h`
   (`C-h f` → describe-function, `C-h m` → describe-mode, `C-h a` → apropos,
   `C-h k` → describe-key, `C-h v` → describe-variable), plus the existing
   `C-h e/s/a/t` log viewers, and `C-h ?` showing the menu.
2. **A `cheatsheet` command** — opens a read-only markdown buffer with the
   essential keys (the BUG-76 splash content, expanded). Reuses the existing
   markdown renderer.

## Goals
- `C-h <X>` reaches the same commands as `SPC h <X>`; prefix shows a which-key
  menu after a pause.
- `M-x cheatsheet` opens a navigable cheatsheet buffer (markdown), reachable
  from the splash screen / a binding.
- The splash screen's "C-h  Help prefix" line becomes accurate (it's a real prefix).

## User Story
As a user (especially new), I want the documented help keys (`C-h f`, `C-h k`…)
to actually work as prefixes, and a one-page cheatsheet I can pull up anytime.

## Problem Statement
`C-h` is bound to `editor-handle-help-prefix` which only sets a status hint —
`C-h f` falls through. `SPC h` works fully; `C-h` doesn't, despite being the
canonical help key and what the splash advertises. There's also no cheatsheet
beyond the 13-line splash.

## Solution Statement
1. Make `C-h` set a pending-prefix state (mirroring how `SPC` builds `SPC <x>`)
   and dispatch the next key through a help keymap, falling back to which-key.
   Reuse the same command targets as `SPC h`.
2. Add `cheatsheet` (T-Lisp) that opens a markdown buffer seeded from a
   `CHEATSHEET` constant (or a `docs/cheatsheet.md`), in read-only mode.

## Relevant Files
- `src/tlisp/core/bindings/normal.tlisp` — `C-h` binding; `SPC h` leader.
- `src/editor/api/mode-ops.ts` — `editor-handle-help-prefix` (replace hint w/ dispatch).
- `src/editor/handlers/normal-handler.ts` — prefix-state dispatch (mirror SPC handling).
- `src/tlisp/core/commands/describe.tlisp` — command targets (describe-*, apropos).
- New: a cheatsheet source — `src/core/buffer.ts` `CHEATSHEET_TEXT` or `docs/cheatsheet.md`.

## Implementation Plan
### Phase 1: C-h prefix dispatch
Generalize the prefix mechanism so `C-h` sets `whichKeyPrefix = "C-h"` and the
next key resolves against a help keymap (same targets as `SPC h`).

### Phase 2: Cheatsheet command
Author a concise cheatsheet (modes, motions, operators, command-line, leader
menus); open read-only via `(cheatsheet)`; bind `SPC h c` / advertise on splash.

## Step by Step Tasks
### Task 1: C-h as a dispatching prefix
**Acceptance Criteria**:
- [ ] `C-h f/m/v/k/a` invoke the same commands as `SPC h f/m/v/k/a`.
- [ ] `C-h e/s/a/t` (log viewers) still work.
- [ ] `C-h ?` or a pause shows the which-key menu of help subcommands.

### Task 2: Cheatsheet
**Acceptance Criteria**:
- [ ] `M-x cheatsheet` opens a read-only markdown buffer.
- [ ] Bound on `SPC h c` (and the splash mentions it).
- [ ] Content covers: modes, motions, operators, `:e/:w/:q`, `SPC ;`, `SPC h`, `C-h`.

## Testing Strategy
- Unit: `C-h f` resolves to describe-function (keymap lookup); cheatsheet buffer
  opens read-only with expected headings.
- Manual: type `C-h` → see menu; `SPC h c` → cheatsheet.

## Acceptance Criteria (Completion)
- [ ] `C-h` dispatches as a real prefix matching `SPC h`.
- [ ] `cheatsheet` command + binding shipped; splash advertises help accurately.
- [ ] No regression to `SPC h` or the existing `C-h e/s/a/t` log viewers.

## Validation Commands
- `bun run typecheck`; `bun run build`
- `bun test test/unit/help-prefix.test.ts` (new)
- Manual: `C-h f`, `SPC h c`.

## Notes
- The `SPC h` leader already does full dispatch — this is about giving `C-h`
  parity (it's the key the splash + Emacs muscle-memory point to).
- Cheatsheet content should stay short (one screen) and link into `describe-*`
  rather than duplicating mode docs (SPEC-108).
