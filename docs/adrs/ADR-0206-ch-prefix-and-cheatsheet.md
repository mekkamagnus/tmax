# ADR-0206 — C-h real prefix + cheatsheet command (`#176` / SPEC-109)

## Status
Accepted

## Context
`C-h` was bound as a single-key to `editor-handle-help-prefix` which only showed
a status hint ("Help: (k)ey, (f)unction…") and did NOT capture the next key.
Despite the splash screen advertising "C-h Help prefix", `C-h f` / `C-h m` etc.
fell through. Meanwhile `SPC h` had full dispatch. There was also no cheatsheet
beyond the 13-line splash screen.

## Decision
1. **Removed the single-key C-h intercept** (`normal.tlisp`), letting the normal
   handler's prefix detection treat C-h as a prefix (because C-h f/m/v/k/A/e/s/a/t
   bindings exist). A pause after C-h now shows the which-key menu.
2. **Added C-h subcommand bindings** mirroring SPC h: `C-h f/m/v/k` (describe-*),
   `C-h A` (apropos-documentation). Existing `C-h e/s/a/t` log viewers preserved.
3. **C-h a conflict resolved**: `C-h a` was already bound to `view-async-output`
   (observability.tlisp). Rather than override it, apropos name-search stays on
   `SPC h a` / M-x only; `C-h A` is apropos-documentation (no conflict).
4. **Cheatsheet command**: `(cheatsheet)` / `SPC h c` opens a read-only
   `*Cheatsheet*` buffer with essential tmax keys (modes, movement, editing,
   files, help). Expanded version of the splash hints.

## Consequences
- C-h now dispatches like SPC h (Emacs muscle-memory works): `C-h f` = describe
  function, etc.
- `SPC h c` / `(cheatsheet)` gives a one-page reference.
- `editor-handle-help-prefix` primitive is now orphaned dead code (cleanup item).
- The splash screen's "C-h Help prefix" line is now accurate.

## Verification
`bun run typecheck` clean; `bun test test/unit/help-prefix-cheatsheet.test.ts` →
3/3 pass (binding source-greps + cheatsheet runtime); 12/12 regression.
Verify-gate (adversarial, 2-agent) verdict: **PASS** (first try).
