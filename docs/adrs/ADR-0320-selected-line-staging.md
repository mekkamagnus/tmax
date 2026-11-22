# ADR-0320 — Selected-line staging: the partial-patch rules

**Issue:** #331 · **Spec:** [SPEC-331](../specs/SPEC-331-selected-line-staging.md)
**Status:** accepted · **Date:** 2026-11-23

## Context

#291 split selected-line staging out because partial-patch
construction is "materially larger and riskier" than verbatim hunk
reconstruction. It was: the correct construction needed three rules
that naive approaches get wrong.

## Decisions

1. **The conversion rule.** A dropped `-` line becomes a CONTEXT
   line (`' ' + content`), never vanishes: every old-side position
   must stay represented or the surrounding context mismatches the
   file. A dropped `+` line omits entirely.
2. **The held buffer.** Git coalesces adjacent changes into one
   block (`-b -c +B +C` — the `-` run precedes the `+` run), so a
   converted `-` is HELD while kept `+` lines jump over it:
   selecting b→B yields `-b +B ' c'`, not `-b ' c' +B`. Context
   lines, kept `-` lines and the hunk end flush the held
   lines (old-side order stays ascending: b(k) c(conv) d(k) →
   `-b ' c' -d`). A MARKER arriving with held context REFUSES by
   name — flushing between a kept line and its marker re-attaches
   the marker to the converted line (the gate's live-probed index
   corruption; the marker must be ADJACENT to its kept line).
3. **The sign-swap mirror for the cached side.** Unstaging a subset
   builds the patch with the body's signs swapped and the header
   starts exchanged: a dropped change STAYS in the index (its `+`
   line becomes context, its `-` line omits) and the selected
   change swaps to `-new/+old`. The result applies `git apply
   --cached -` WITHOUT `-R`.

Header arithmetic: counts credit context on both sides; starts
never move except LEADING dropped `+` lines (a new-start shift).
The no-newline marker must follow a KEPT-AS-IS line — anything
else refuses by name (the replacement final line's newline state
is uncomputable from the diff).

## The UI

`m` toggles a mark in the diff view; `s`/`u` with the mark inside
the cursor's hunk build the partial patch over the mark..cursor
ROWS (view rows map 1:1 to body lines; the flag list spans the full
body — a short list would default-to-keep its tail and over-stage).
A contiguous range cannot skip coalesced middle lines — the same
constraint git add -p solves with hunk splitting (documented, not
worked around). The mark clears at apply-launch, refresh and quit.
The whole-hunk path is untouched when no mark is set.

## Gotchas recorded

- The raw diff's trailing newline rides the #291 collect as a
  PHANTOM empty body line — kept by the exhausted-flags default,
  +1 to newC, and its blank line corrupts `git apply`. The split
  chomps trailing empties.
- `string-split` ate the heading tail's leading space; the rebuild
  re-carries it.
- T-Lisp symbols may not contain `@` (the reader rejects it) — the
  @@-parsing helpers are named `-hunk-spec`/`-tail-join`.
