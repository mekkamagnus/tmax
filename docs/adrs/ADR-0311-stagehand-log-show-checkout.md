# ADR-0311 — #290: the streaming log + checkout

- **Status**: Accepted
- **Date**: 2026-11-22
- **Issue**: #290
- **Spec**: SPEC-285

## Context

T0's last piece needs a STREAMING log (make-process, the #307
generation-guard pattern), a faced show view (#289's grammar), and
the tier's only remaining mutation (checkout). Three debugging
findings shaped the implementation and are recorded for the cluster:

1. **`:filter`/`:sentinel` names eval GLOBALLY** — module functions
   are invisible there (qualified or not). Top-level bridge defuns
   outside the defmodule forward to the qualified module fns.
2. **`buffer-append-to` is unreliable for streaming** — it appends
   into a buffer object the current-buffer read path does not observe;
   fikra's event.tlisp already documents the TEMPORARY-SWITCH
   workaround (switch → `buffer-append` → restore). Adopted verbatim.
3. **A filter-eval throw is INVISIBLE** — the TS catch logs to the
   process log only; the stream silently stops. The root cause here
   was `>=` on STRINGS ("requires exactly 2 numeric arguments") in
   the sha classifier — string comparisons must use `string<` (with
   range endpoints "0"→":" and "a"→"g" for hex digits).

## Decision

- The log streams with per-chunk line rendering (complete lines only;
  the trailing partial flushes at the sentinel). Field rows split on
  the hex-decoded 0x1f; the graph prefix yields the sha (trailing
  hex token after glyph filtering); refs render dimmed via emitted
  ANSI (#289's pipeline).
- Line→sha bookkeeping counts EVERY streamed line (art rows occupy
  buffer rows too) so nav math matches the buffer.
- Checkout resolves refs at invocation (`for-each-ref --points-at`),
  picks by class precedence, and checks out the SHORT name — the
  fully-qualified ref detaches (found live: the status said
  "checked out topic" while HEAD sat detached).
- The show view reuses #289's parse + faces wholesale — the grammar
  is the one face source, as designed.

## Consequences

- Cherry-pick/revert are FILED OUT (a follow-up issue referencing
  #295's continuation/abort framework) per the issue's OUT OF SCOPE.
- The bridge pattern is the template for any future module that
  wants process callbacks.
