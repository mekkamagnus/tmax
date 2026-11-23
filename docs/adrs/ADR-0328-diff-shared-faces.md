# ADR-0328: the shared diff-grammar face source

- **Status**: Proposed (landing with #313)
- **Date**: 2026-11-25
- **Issue**: #313 · **Spec**: SPEC-313 · **Context**: RFC-032 §3.4, #289's line classes

## Decision

`editor/fikra/diff-face` is the ONE face source for the diff
grammar: `diff-face-line <class> <text>` (explicit class — the
caller knows its grammar position), `diff-classify-line` (the
git-shape intake classifier), `diff-face-strip` (ANSI drop; git's
colored output is not trusted). The chat preview path (event.tlisp)
and the viewer (diff.tlisp) both consume it; the add/remove palette
byte-preserves the chat's prior inline green/red.

## The wiring decisions the gates forced

1. **Top-level requires are load-bearing**: the first arc's require
   patch silently no-opped (its python `str.replace` anchor didn't
   exist; no assert) — no src file loaded the module, module
   resolution has no auto-load, and BOTH consumers died with
   `Undefined symbol` in production shape while the unit tests
   passed (the test file's own require masked the hole). The nav
   suite (4/13) was the honest witness.
2. **The classifier implements #289, not a loose approximation**:
   a leading space IS the context class (not dim meta); `--- a/`
   and `+++ b/` are FILE headers (not remove/add rows).
3. **Parts, not one blob**: the callers pass summary + patch +
   footer separately; `render-parts` composes VERBATIM
   summary/footer with the caller-PRE-FACED patch, driving
   `render-raw` (the buffer lifecycle without a re-facing wrap).
   Wrapping the composed blob re-faced the viewer's own palette —
   the gate-r2 decisive finding; it also defeated the ESC-detect
   perf guard (composed content always contains ESC).
4. **Join semantics**: separators go BETWEEN lines (git's trailing
   newline must not double; empty renders empty).
5. **The strip is a legacy guard, skipped when no ESC is present**
   — the --no-color spawns emit none; the per-char T-Lisp strip
   measured 1317ms/225KB superlinear.

## Honest-reporting lessons (recorded for the future)

- A `str.replace` patch without an anchor assert can silently
  no-op — the commit message then claims completion of a change
  that never landed (this bit BOTH the module require and the
  header comment in the r1 commit). The gates caught both as
  false completion claims.
- Face-agnostic test pins (`toContain("text")`) pass under
  re-face defects; pin the PALETTE BYTES when the claim is about
  faces surviving.
