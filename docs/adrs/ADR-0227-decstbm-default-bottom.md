# ADR-0227: #204 — DECSTBM's default bottom was hardcoded 24

- **Status**: accepted
- **Date**: 2026-08-20
- **Issues**: #204
- **Spec**: [BUG-84](../specs/BUG-84-shell-mode-unusable.md) (appendix)

## Context

After #201/#202/#203 the user still saw only "a piece of claude's orange box
at the top — the input box isn't showing". Diagnosis path: PTY verified at
pane size (#203 ok), colors ok, then a captured byte stream of claude's
welcome screen replayed through the parser in a unit harness — the input box
collapsed onto the status row in the replay too, giving a deterministic repro.

## Decision

- **DECSTBM (`ESC[r` with no bottom = reset to full screen)** now emits a -1
  sentinel the ScreenBuffer resolves to the CURRENT last row. The parser
  cannot know the row count; the old `(params[1] || 24) - 1` hardcoded 24, so
  on any terminal taller than 24 rows every cursorDown clamped at row 23 —
  claude draws its bottom UI with exactly those relative moves after a
  region reset.
- Precise IL/DL/DCH/ICH ops (at-cursor line insert/delete, char
  delete/insert with left/right shift) replace the old approximations
  (scroll-whole-region / blank-to-EOL) that corrupted Ink-style diff redraws.
- A REAL captured claude stream ships as a fixture
  (test/fixtures/claude-welcome-35x108.bin) with a replay regression pinning
  the input box at the bottom (not row 23).

## Consequences

- Live in the mekkapi tab: welcome box top, separators + input + status at
  the bottom rows; typing lands in the box.
- Diagnostic toolkit proven: env-gated raw-stream capture -> census -> event
  trace -> deterministic replay. Debug hook removed for landing; the fixture
  keeps the evidence.
- screen-buffer 22/22 (replay + bare-reset + 4 op-semantics tests), terminal
  cluster green, typecheck clean.
