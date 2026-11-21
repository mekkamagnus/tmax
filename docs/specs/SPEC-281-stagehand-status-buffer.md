# SPEC-281 — the Stagehand status buffer (#286)

## Goal

Stagehand T0: the `*Stagehand*` status buffer — porcelain -z parsing,
foldable sections, row navigation, refresh, the error states, and the
`SPC g` dispatch. Mutation keys (stage/unstage/discard, commit) are
explicitly NOT here — they arrive with #287/#288 and bind into this
buffer's keymap.

## Design

- **Module** `src/tlisp/core/stagehand/status.tlisp` (new
  `stagehand/` core-module prefix, resolved like `fikra/` — the path IS
  the directory; loader extended in `module-loader.ts`). Loaded at
  startup via `bindings/normal.tlisp` require.
- **Parsing**: `git status --porcelain=v1 -z` via `shell-exec` (NUL
  split through `(hex-decode "00")` — the reader strips backslash
  escapes, so a literal `"\0"` is unreliable). Rename/copy pairs carry
  the origin in the NEXT NUL field, re-joined structurally (never by
  string search). Rows render `<code> <path>` with renames as
  `new (from orig)`.
- **Sections**: `??` → Untracked; worktree-side column → Unstaged;
  index-side column → Staged; the conflicted set (DD AU UD UA DU AA UU)
  → a distinct fourth Conflicted section.
- **Repository + error states**: fresh `project-detect-root` every
  invocation (no cached root). Not a repo → status message, no buffer.
  Git failure (exit ≥1) → status names exit + first stderr line, no
  buffer. Unborn → buffer renders, header `unborn: <branch>`
  (symbolic-ref resolves on unborn repos; `rev-parse --verify HEAD`
  failing is the discriminator — a bare symbolic-ref failure means
  DETACHED, giving `HEAD detached at <sha>`). Empty → the four empty
  sections + `nothing to commit, working tree clean`. No upstream →
  the ` no upstream` suffix.
- **Folding + navigation**: TAB on a section header toggles fold state
  keyed by SECTION NAME in a hashmap — survives refresh (g re-parses in
  place). The rendered buffer is fold-aware (a folded section shows its
  header only). n/p move over the VISIBLE rows with explicit wrap
  (T-Lisp `mod` keeps negative remainders — `(mod -1 n)` is -1); the
  current row is derived FROM THE CURSOR (j/k moves stay in sync), and
  fold-toggle/refresh PRESERVE the cursor's row (place-cursor clamps
  when a re-render shrank the rows).
- **Row identity** (codex r1+r2): sections carry PARSED entry triples
  (code, path, rename-from); rendering is a display concern. RET's
  identity is POSITIONAL — the visible (display, path) pair under the
  cursor supplies the parsed path, so display text can never redirect
  RET: a file literally named `notes (from Alice).txt`, two renames
  rendering IDENTICALLY (`a ⟵ "b (from c"` and `"a (from b" ⟵ c` both
  display `R  a (from b (from c`), and filenames containing NEWLINES
  (display-escaped `\n`, one screen row) all open the right file.
  Repo state commits only on a SUCCESSFUL read (a failed re-open
  leaves the displayed status's root, rows, and RET addressing
  intact). Rename/copy origin consumption checks EITHER porcelain
  column (git emits index-side R/C only today, but a worktree-side
  record must not corrupt the following rows). Refresh (g) syncs the
  cursor's row BEFORE the re-parse — j/k position survives.
- **Keys**: buffer-local keymap (the fikra-diff pattern: `keymap-init`
  + `buffer-set-keymap`, the #206 chain's innermost tier) with Tab,
  n, p, g, q, Enter — spellings are the HANDLER's normalized names
  ("Enter"/"Tab", not "RET"/"TAB"). q = `buffer-kill` (the Editor path
  picks the recency-correct survivor — the #307 pattern). RET opens the
  file at point via `find-file` rooted at the repo root. `SPC g` is the
  global dispatch (unbound before this).
- **Engine refinement (keymaps.tlisp)**: `keymap-prefix-p` is now
  level-aware — the innermost chain level that knows the key AT ALL
  decides; a buffer-local FULL binding shadows an outer level's prefix
  (the Emacs rule). #206's any-level-prefix rule made a local full
  binding of an outer-prefixed key (vim's `g`) unreachable, which this
  issue's `g` refresh requires. Mid-sequence prefix waits are unchanged.
- **Mode**: `major-mode-register "stagehand-status"` + set on render —
  identification and the target for #287/#288's per-section keymaps.

## Completion criteria

- [x] Porcelain -z parsing matrix: every status class → its section;
      renames render `new (from orig)`; empty stream → four empty
      sections
- [x] Real temp-repo tests: normal, empty, unborn, detached,
      no-upstream, conflicted (UU via a real merge), rename with spaces
      in BOTH names, leading-dash filename, unicode filename
- [x] Git-failure and non-repo statuses (no buffer switch); fold
      persistence across refresh
- [x] n/p/TAB/g/q/RET behaviors tested — via exported functions AND
      real `handleKey` dispatch (SPC g opens; the buffer-local map
      fires; q restores recency); j/k-then-n continuity,
      fold-preserves-position, and j/k-then-g refresh continuity tested;
      the `X (from Y).txt` RET case, the identically-rendering rename
      pair, the newline filename, and the failed-re-open root integrity
      tested; worktree-side R/C origin consumption tested
- [x] The keymap-prefix-p refinement regression-tested in
      `test/unit/keymap-local.test.ts` (all 8 prior #206 rows still
      green)
