# ADR-0205 — Major-mode documentation (`#175` / SPEC-108)

## Status
Accepted

## Context
`describe-mode` (`SPC h m`) listed the active mode's keybindings but didn't say
**what the mode is** — major modes registered without docstrings, so the mode
header was empty. There was no mechanism to document a mode's purpose in a way
the help system could surface.

## Decision
1. **Schema** — added `description?: string` to `MajorModeConfig` (mode-state.ts).
2. **Primitives** — `(major-mode-doc NAME DESC)` setter + `(major-mode-description NAME)` getter (major-mode-ops.ts). A separate form (rather than extending `major-mode-register`'s arity) — least invasive.
3. **Mode files** — every shipped major mode (all 22) carries a purpose description via `(major-mode-doc ...)` inside its module; `fundamental` seeded with a description in `domain-state.ts`.
4. **describe-mode** — renders "Major mode: <name> — <description>" before the key bindings (nested `let` to access `major` before computing `desc`).
5. **apropos-documentation** — iterates the major-mode registry (not just function globals/exports), so searching "Markdown" finds markdown-mode by its description.

## Consequences
- `SPC h m` now explains what the active mode DOES, not just its keys.
- Every registered mode has a non-empty description (test-pinned).
- `apropos-documentation` searches mode descriptions too — the "I think there's a mode for X" tool.
- Adding a new major mode should include a `(major-mode-doc ...)` call (not yet enforced by a drift guard — that's a future enhancement).

## Verification
`bun run typecheck` clean; `bun test test/unit/major-mode-docs.test.ts` → 3/3 pass
(all 22 modes documented; specific values correct; describe-mode shows description);
`test/unit/apropos.test.ts` → 6/6 (no regression); 38/38 broader regression.
Verify-gate (adversarial, 2-agent) verdict: **PASS** (retry 1 after adding
mode-doc feeding to apropos-documentation).
