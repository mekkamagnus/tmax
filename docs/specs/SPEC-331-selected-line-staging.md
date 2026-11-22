# SPEC-331 — Stagehand: selected-line staging (partial-patch construction)

## Goal

Stage/unstage individual LINES or line-ranges within a hunk — not
just whole hunks (#291). The core is PARTIAL-PATCH CONSTRUCTION:
re-writing the `@@` header's counts and start offsets for an
arbitrary subset of a hunk's change lines, preserving context and
the `\ No newline` marker semantics, applied through #291's stdin
`git apply --cached [-R] -` paths.

## Normative contract

- **Selection model**: a per-hunk list of keep-flags over the hunk's
  BODY lines (one flag per body line, in stream order). Context
  lines (` `) are ALWAYS kept (their flags are ignored); `+`/`-`
  lines are kept iff flagged; the `\ No newline` marker rides its
  line's fate.
- **Header arithmetic**: `oldCount = kept-context + kept '-'`;
  `newCount = kept-context + kept '+'`. Starts adjust for LEADING
  dropped lines only: `oldStart = orig + dropped '-' before the
  first kept line`; `newStart = orig + dropped '+' before the first
  kept line`. Trailing drops never move the starts. Any heading text
  after the second `@@` is preserved verbatim.
- **No-newline refusal**: dropping a marker-annotated line REFUSES
  the operation (nil + a named status reason) — the replacement
  final line's newline state is not computable from the diff alone.
- **The patch** = the file-header block (per #291's collect:
  `diff --git` through `+++`, with mode/rename meta riding) + the
  rebuilt `@@` header + the kept body lines.
- **Apply paths**: identical to #291 — `git apply --cached -` (stage,
  worktree side), `git apply --cached -R -` (unstage, cached side);
  argv discipline, `2>&1` diagnostics capture, the in-flight guard,
  refresh-on-success.
- **Whole-hunk back-compat**: `s`/`u` with no selection behaves
  exactly as #291 (the all-flags constructor output is semantically
  the verbatim hunk patch).
- **UI**: the diff view gains a line-selection entry: with a
  selection present in the hunk at point, the staging op builds the
  partial patch; without one, whole-hunk. Selection input is the
  flagged body-line set (the view's mapping: body line k of hunk idx
  sits at view line hunk-start+1+k).

## Completion criteria

- [ ] The pure constructor: counts/starts arithmetic correct for
      leading-dropped `-`/`+`, mixed subsets, all/none selected;
      marker rides; marker-line-dropped refuses with a named reason;
      heading tail preserved.
- [ ] Round-trip tests against REAL git: partial stage leaves the
      index holding exactly context + selected changes and the
      worktree untouched; partial unstage symmetric.
- [ ] The no-newline matrix: selected → round-trips; dropped →
      refusal (nothing applied).
- [ ] Whole-hunk equivalence: all-flags output applies identically
      to the verbatim hunk patch.
- [ ] The UI selection path with refusal classes + in-flight guard
      intact.
