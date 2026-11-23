# ADR-0327: the chat line-index (diff-line-index)

- **Status**: Proposed (landing with #312)
- **Date**: 2026-11-24
- **Issue**: #312 · **Spec**: SPEC-312 · **Context**: RFC-032 §3.1, on #298/#306

## Decision

A per-buffer **line → target** registry — `editor/fikra/diff-line-index`
— mapping 0-based chat lines to `(path, line, side, hunk)` targets, in
a mutation-shared carrier (#306's state-model rules: one defvar,
function-seam rebinding). Two writers, two buffers, one structure:
the CHAT side records on emit (this issue); the VIEWER's rebuild
(#314) records its own rows into its own slot.

**Slot representation: an ALIST** — `((line target) ...)`. The first
draft used nested hashmaps and hit a keys-visibility ambiguity after
the second record (`hashmap-get` found entries; `hashmap-keys` on the
same slot returned empty in some load orders). Structural scans over
alists have nothing to materialize.

**Population (chat)**: every `buffer-append` site in the FAEP renderer
(streaming's temporary-switch pair, the non-streaming append, and the
rebuild's from-scratch append — i.e. REPLAY) calls a post-append scan.
The scan face-strips each appended line and records
`± <path> +<adds> -<dels>` rows (the file-change events' render) as
`(path-as-emitted, line nil, side nil)` at the pre-append base line +
offset. One code path: live and replay populate identically.

**Invalidation**: lazy — a lookup for a dead buffer drops its slot
(buffer-kill has no hook). Append-stability: existing entries are
never rewritten. Replay's from-scratch rebuild re-records at the same
lines (append-stability makes it a no-op).

**RET**: the index consults FIRST (`fikra-follow-link`); index hit →
open at (path, line) — new-side exact; old-side approximate (the file
must still contain the line; status-noted); deleted files refuse
honestly (`file deleted in worktree: <path>` — no phantom open);
index miss → the pre-existing regex fallback (whose match-INDEX
return quirk is pre-existing main behavior, kept as-is per the issue).

## Recorded decisions

1. **Paths resolve as-emitted** against the thread's working root
   (#298) at RET time — absolute paths pass through.
2. **No regex in the row parser** — the T-Lisp reader strips
   backslashes from string literals, making regex authorship
   error-prone; the `+<digits> -<digits>` tail is char-scanned with
   a strict validator.
3. **The scan is post-append, not in the renderer's fold** — the fold
   threads text opaquely; the append sites own the base-line truth.
4. **Tool-call preview rows (± content evidence) are not recorded in
   v1** — those events carry no path metadata (only the summary text,
   regex-extractable); the file-change events carry the path
   structurally. The fallback path covers unrecorded rows.

## Module-system lessons (hard-won, recorded for the future)

- A `(defmodule …)` whose export line closes with `))` seals the
  module THERE — every later defun defines GLOBALLY (unqualified,
  unresolvable as `mod/name`) with NO parse error. Close the module
  at EOF.
- A paren-short defun swallows the defuns after it (defined but
  nested/shadowed). Symptom pattern: later defuns in a module
  resolve as Undefined while earlier ones work.
- `true`/`false` are not T-Lisp literals — `t`/`nil`.
