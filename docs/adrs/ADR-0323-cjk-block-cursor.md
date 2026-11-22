# ADR-0323 — The painted block cursor walks visual widths

**Issue:** #328 · **Spec:** [SPEC-328](../specs/SPEC-328-cjk-block-cursor.md)
**Status:** accepted · **Date:** 2026-11-24

## Context

The #321 gate found (and fixed for the HARDWARE cursor) that a
logical column compared against terminal-cell widths picks the wrong
wrapped row under wide characters. The BLOCK-cursor paint loop had
the identical comparison — pre-existing at the #321 merge-base,
adjudicated a follow-up, filed as #328.

## Decision

One rule, applied to the paint: **convert the display cursor column
to a VISUAL offset (stringWidth of the prefix) before comparing
against wrapped-row widths**; the within-row column is the visual
remainder; the boundary-exact case prefers the NEXT row (the
renderer's next-row convention — the same choice `wrappedSegOf`
made for the hardware cursor). The tests assert PAINT↔HARDWARE
agreement (`getWrappedCursorRow`/`Column`) rather than only
absolute cells — the agreement is the actual invariant.

## Consequences

- The two cursor systems (painted block + hardware) share one
  visual-math convention; a future divergence fails the agreement
  assertions directly.
- The adjacent wiki-counting divergence (span-less
  `transformWikiLine` in counting paths) is documented out of scope
  per the issue's own low-priority bound — the textual backtick
  protection is span-independent by design.
