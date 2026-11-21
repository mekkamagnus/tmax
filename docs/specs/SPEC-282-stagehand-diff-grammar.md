# SPEC-282 — the Stagehand diff grammar + faces (#289)

## Goal

Stagehand T0: parse `git diff --no-color` output into line classes and
face them in the diff view — grammar-driven facing, NOT ANSI
passthrough. The `d` key opens per-path and per-section diffs from
the #286 status buffer.

## Design

- **Module** `src/tlisp/core/stagehand/diff.tlisp` (required by
  `stagehand/status`, which owns the `d` dispatch — it reads the
  status buffer's row/section state).
- **The grammar is PURE T-LISP** (`stagehand-diff-parse`): diff text →
  `((class line) ...)`, no git, no state — the fixture matrix lives in
  unit tests. Classes: `file-header` (`diff --git`, `index`, `---`,
  `+++`), `hunk-header` (`@@`), `add` (`+`), `remove` (`-`),
  `context` (leading space / bare), `meta` (new/deleted file mode,
  old/new mode, similarity/dissimilarity index, rename/copy from/to,
  `\ No newline at end of file`). Precedence: `---`/`+++` are FILE
  headers (they lead with `-`/`+`); meta markers precede the
  add/remove catch. The backslash marker literal is hex-decoded (the
  T-Lisp reader strips backslash escapes).
- **Faces are EMITTED from classes** (`stagehand-diff-face`): the one
  class → SGR source — file-header bold-cyan, hunk-header bold-blue,
  add green, remove red, meta dim, context bare. The ANSI rides the
  established buffer-carries-ANSI render pipeline (the fikra-diff
  precedent); the ADR names this as the face mechanism — no
  text-property plumbing existed to reuse (font-lock is a registered
  stub), and grammar-driven emission is not passthrough (the input is
  `--no-color`; WE emit from the parse). #312/#313 adopt this mapping
  as their one face source.
- **The `d` dispatch** (`stagehand-status-diff`, bound to `d` in the
  status buffer-local keymap): a FILE row → that path (Staged rows →
  `--cached`; Unstaged/Conflicted → the worktree side; paths
  shell-quoted). A SECTION header → the whole-section diff (same side
  selection; the Untracked section has no diff side). Untracked rows
  → status `untracked file — no diff` (v1 does not synthesize
  full-file diffs). Git failure (exit ≥1) → status names exit +
  stderr; the buffer is untouched.
- **The view** (`*Stagehand-Diff*`): faced lines under a one-line
  title; `n`/`p` navigate hunk-header lines (wrap — forward → first,
  backward → last); `q` closes (buffer-kill's recency survivor).
  Buffer-local keymap (n/p/q) + the `stagehand-diff` major mode.
- **Boundaries**: fikra chat-preview adoption is OUT (#312/#313 own
  it).

## Completion criteria

- [x] Parser unit matrix: every class, `---`/`+++` precedence,
      multi-file diffs, rename/copy headers, no-final-newline markers,
      empty diffs
- [x] Faces: each class → its SGR open + reset; context bare (the
      one-face-source mapping)
- [x] Integration from real temp repos: staged (`--cached`) and
      unstaged views render FACED; the untracked refusal; the
      section-level `d` (both files in one diff); the `d` KEY
      dispatches via handleKey
- [x] n/p hunk navigation with wrap (real two-hunk diff); q closes;
      the git-error path (status names the failure, buffer unchanged)
