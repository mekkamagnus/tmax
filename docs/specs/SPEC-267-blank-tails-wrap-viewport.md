# SPEC-267 — blank tails on large buffers: wrap-aware viewport + wire coverage (#321)

## Goal

Large buffers (~100+ lines, threshold unconfirmed) rendered blank/frozen
tails in the TUI client. This issue is capture-first: the matrix was
recorded in the issue BEFORE the fix (35 FAIL / 61 PASS pre-fix), the
cause named from evidence, the fix landed, and the matrix re-ran green.

## Cause (from the matrix + probe; wording corrected per verify-gate r1)

Wrap-unaware client viewport math, plus insufficient wire slack — two
distinct windows, precisely separated:

- **The CLIENT-RENDERED window was the failing surface.** The probe's
  "window [58,69), cursor 79" is the range the client actually RENDERED:
  from a logically-clamped top it fills the screen with wrapped rows and
  stops after ~`rows/2` logical lines, while the logical clamp believes
  the cursor (up to `rows` lines below top) is visible — nothing advances
  the top, so the cursor and the buffer tail sit below the fold. The
  frozen/blank tail.
- **The WIRE window** (pre-fix `neededRows = max(rows, i)`) always carried
  ≥ `renderHeight` logical lines, so the cursor was on the wire wherever
  the clamp invariant held — but with ZERO slack below the cursor for the
  client's wrap-expanded fill, and the `render-state` handler passed no
  width at all (expansion — the fill-slack mechanism — disabled on that
  path; width-less paths likewise sent exactly `rows`).

Wrap OFF never failed on frame-sized paths — the discrimination the
matrix demanded.

## Fix

- **Client (operative)**: `renderSingleWindowWrapped` advances the
  viewport top wrap-awarely — walk the cursor's wrapped-row span and
  advance until it fits the screen, using the client's EXACT wrapLine +
  gutter math (fold-hidden lines count zero rows). The advance lives in
  ONE shared helper (`advanceWrappedTop`); `getWrappedViewportTop` (for
  the frontends' span precompute) delegates to it.
- **Wire (coverage hardening)**: the expansion walk continues until the
  screen is covered AND past the cursor line (fill-below-cursor slack on
  width-carrying paths); width-less paths (no-frame / no-width) span
  through the cursor + screen slack under the same 6× wire bound.
- **render-state** passes the frame's terminal width.
- `tui-client.ts` + `capture-frame.ts`: syntax spans are precomputed from
  the wrap-aware top over a 2× logical span (no color loss on the advanced
  window).

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
