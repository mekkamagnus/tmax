# ADR-0313 — #291: hunk staging via stdin patches (and process-close-stdin)

- **Status**: Accepted
- **Date**: 2026-11-23
- **Issue**: #291
- **Spec**: SPEC-287

## Context

#291 needs whole-hunk stage/unstage/discard. `git apply` reads its
patch from a file argument or STDIN; the issue normatively requires
stdin (`git apply --cached -` + `process-write`). Three findings
shaped the implementation:

1. **`process-write` alone leaves `git apply -` waiting forever** —
   apply reads until EOF, and no primitive closed stdin. Added
   `process-close-stdin <pid>` (`stdin.end()`), wired after every
   patch write.
2. **argv flags must be separate elements** — `"--cached -R"` as ONE
   string is a usage error (exit 129); each flag is its own list
   element.
3. **`git apply` takes no pathspec args** — the patch itself carries
   the paths; `--` after the `-` would parse as a second patch
   filename.

## Decision

- The diff view records its SIDE (`worktree`/`cached`), root, and
  paths at open (threaded from the status `d` dispatch) — the hunk
  ops dispatch on it: key availability first (a key that does not
  apply no-ops with a status), then the refusal scan, then the
  cursor's hunk.
- Hunk extraction is a pure walker over the #289-parsed pairs of the
  recorded raw diff: the file-header block + the hunk verbatim, the
  no-newline marker riding with it.
- The apply is SENTINEL-driven (async by nature): exit 0 → the view
  refreshes in place on the same side; ≠ 0 → the named failure +
  `refresh and retry` (stale diffs land here by design — no
  auto-retry).
- Refusals: binary / rename-copy / mode-only — named statuses, no
  apply. Selected-line staging split out → #331.

## Consequences

- `process-close-stdin` is a general primitive: any stdin-consuming
  child (filters, repl-style tools) can now be driven to completion.
- The `&optional` lesson: bare `(&optional a b)` and the full
  `(name default supplied-p)` form both bind; the defvars' state is
  module-scoped (setq from outside the module fails — tests go
  through exported getters/setters or real flows).
- The worktree-diff refresh keeps its side by contract; an unstage
  leg opens the cached view via the status buffer's staged row.
