# ADR-0308 — #289: the diff grammar + faces (class → SGR emission)

- **Status**: Accepted
- **Date**: 2026-11-21
- **Issue**: #289
- **Spec**: SPEC-282

## Context

#289 wants `git diff --no-color` parsed into line classes and FACED —
explicitly not ANSI passthrough. The issue named the face mechanism:
"the existing face/overlay text-property mechanism... if faces need
new plumbing, that plumbing is this issue's named deliverable."

Survey of what actually exists:

- `font-lock-mode` is a REGISTERED TOGGLE STUB — per-buffer
  highlighting was deferred (#153's own comment); no T-Lisp-reachable
  primitive.
- `state.highlightSpans` has no production consumer (the BUG-15
  audit); the TUI computes spans CLIENT-side from the filename's
  language.
- What the render pipeline PROVES daily: **buffers carry ANSI** —
  fikra-diff embeds `git diff --color=always` output and the frontends
  display it colored (the fikra UI arcs are e2e-verified on this).

## Decision

The face mechanism this ADR names: **class → SGR emission into the
buffer**, riding the established carry-ANSI pipeline.

- The GRAMMAR stays pure T-Lisp over `--no-color` text
  (`stagehand-diff-parse` → `((class line) ...)`) — unit-testable
  without git, exactly as the issue demands.
- Facing is a separate, reusable mapping (`stagehand-diff-face`:
  file-header bold-cyan, hunk-header bold-blue, add green, remove red,
  meta dim, context bare) — the ONE face source #312/#313 adopt for
  chat previews and the shared viewer.
- This is NOT passthrough: the input is colorless; the ANSI is
  emitted from the parse. A future text-property mechanism can
  replace the emission layer without touching the grammar.

Rejected: building a per-line text-property pipeline now — it would
need daemon state → wire → client render changes (the
`highlightSpans` lesson says that path has no consumer today), all to
reach a display outcome the ANSI pipeline already delivers.

T-Lisp realities that shaped the code: backslash literals are
impossible (the reader strips escapes — the `\ No newline` marker is
hex-decoded); ANSI escapes likewise assemble via hex; `let*` for
sequential bindings (`let` cannot reference earlier bindings in the
same form); `string-join` is the builtin (separator first).

## Consequences

- `d` lands in the status buffer's keymap; `*Stagehand-Diff*` owns
  n/p/q via its buffer-local keymap + the `stagehand-diff` major mode.
- The untracked refusal and the section-side selection are v1 norms
  recorded in the spec (no synthesized full-file diffs).
- #312/#313 integrate the face source into fikra previews (explicitly
  out of scope here).
