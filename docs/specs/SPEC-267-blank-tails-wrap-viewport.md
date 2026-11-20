# SPEC-267 — blank tails on large buffers: wrap-aware wire windows + viewport (#321)

## Goal

Large buffers (~100+ lines, threshold unconfirmed) rendered blank/frozen
tails in the TUI client. This issue is capture-first: the matrix was
recorded in the issue BEFORE the fix (35 FAIL / 61 PASS pre-fix), the
cause named from evidence, the fix landed, and the matrix re-ran green.

## Cause (from the matrix + probe)

Two compounding defects, both wrap-related:

1. **Daemon wire window could exclude the cursor line entirely.** The wrap
   expansion in `editorStateToJson` walked forward from `viewportTop`
   accumulating estimated wrapped rows and stopped when the SCREEN was
   covered — at ~2 wrapped rows/line that halts at `rows/2` logical lines
   while the logical clamp places the cursor up to `rows` lines below top.
   Probe: window `[58,69)`, cursor at 79. The `render-state` handler
   additionally passed NO width, disabling the expansion on that path.
2. **The client's viewport clamp is logical-only.** With wrap on, the
   cursor's wrapped screen row can sit far below the fold and nothing
   advances the top (`cursor 79 < top+23` → no adjustment) — the rendered
   frame ends mid-buffer: the frozen tail.

Wrap OFF never failed on frame-sized paths — the discrimination the
matrix demanded.

## Fix

- `serialize.ts`: the expansion walk continues until the screen is
  covered AND the cursor line is inside the window; without a width
  (no-frame paths) the window still spans through the cursor plus screen
  slack (bounded by the same 6× rows wire limit).
- `frames.ts`: `render-state` passes the frame's terminal width.
- `buffer-lines.ts`: `renderSingleWindowWrapped` advances the viewport
  top wrap-awarely (advance until the cursor's wrapped rows fit the
  screen, using the client's EXACT wrap + gutter math); exported
  `getWrappedViewportTop` for the frontends.
- `tui-client.ts` + `capture-frame.ts`: syntax spans are precomputed from
  the wrap-aware top over a 2× logical span (no color loss on the
  advanced window).

## Completion criteria

- [x] Capture matrix recorded in the issue (all dimensions + pass/fail)
      with the generator committed as the test fixture
- [x] Cause named from matrix evidence; fix landed; the full matrix + the
      original fikra scenario assert expected-tail-text (post-fix:
      86 PASS; the 10 remaining fails are the no-frame `default` column
      at ≥30-row terminals — structurally height-blind, unreachable by
      the TUI or `--capture`, documented as the 22-row fallback)
- [x] Both wrap settings and both client paths covered green

## Out of scope

- The no-frame default RPC path's 22-row fallback (no terminal knowledge
  exists there; the TUI/`--capture` always resolve frame sizes).
