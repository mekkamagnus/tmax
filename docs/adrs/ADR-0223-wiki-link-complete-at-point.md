# ADR-0223: SPEC-120 — `[[` instantly opens the fuzzy vault-note finder

- **Status**: accepted
- **Date**: 2026-08-15
- **Issues**: #197
- **Spec**: [SPEC-120](../specs/SPEC-120-wiki-link-complete-at-point.md)

## Context

The wiki cluster (SPEC-116/117/118/119) all act AFTER a link exists. Creating
one meant typing the full target from memory or stopping to run `gx`. The
entire completion machinery (vault scan, candidate builders, accept dispatch)
already existed from SPEC-116 — whose `markdown-resolve-prepare` was split out
explicitly "so a future completion-at-point layer can drive the dispatch
without the prompt."

## Decision

Pure T-Lisp, zero new TS primitives, three pieces:

1. **Trigger** — one more consult in `insert-char` (insert-entries.tlisp),
   the chokepoint that already serves electric-pair: after `buffer-insert`,
   key = `[` + predecessor `[` + markdown major mode + `wiki-link-complete`
   minor on + the cursor is not sitting before an electric-pair `]` → open
   the finder. Both `[`s remain in the buffer.
2. **Finder** — the SPEC-116 prepare/table/accept shape, new instance:
   `markdown-complete-prepare` (vault scan + the `[[` position in defvars),
   `markdown-complete-table` (`+ Create: <input>` first for non-empty input,
   then every note — the minibuffer input IS the fuzzy query, no re-ranking),
   `markdown-complete-accept` (insert `<name>]]` at the recorded position,
   cursor after, insert mode; `+ Create` additionally writes the note from
   template WITHOUT opening). `require-match t` so raw text can never
   silently link nothing.
3. **Creation split** — `markdown-create-note-for` factored into
   `markdown-write-note-template` (mkdir + template + write, returns path);
   SPEC-116 keeps write+open, the finder writes without opening (creating
   must not yank the writer out of their note; the fresh link renders
   dimmed per SPEC-118 until followed).

## Consequences

- **Cancel was free**: `completing-read` records `return-mode` (insert here)
  and `minibuffer-cancel` restores it; the cursor never moved — no cancel
  code was written for this feature.
- Obsidian-flow parity, live-verified in the mekkapi tab: second `[` opens
  "Link to:" with the vault listed (1/5 → filtered 2/2), Down+Enter
  completes `[[2026-08-08]]` in place still in INSERT, and `gx` follows the
  fresh link immediately after.
- Fixture gotcha recorded: `setupMdEditor` does not run auto-mode — markdown
  tests need an explicit `(major-mode-set "markdown")`.
- Known v1 tradeoff (documented in the spec): `[[text](url)` also opens the
  finder (Escape costs one keystroke); smart suppression awaits BUG-82's
  fence spans.
- Suite: wiki-link-complete 13/13 (table ordering/omission, trigger matrix
  incl. non-markdown + mode-off + column-1 guard, existing-note accept with
  cursor + no-buffer-switch, +Create accept with file-written-not-opened,
  cancel + re-trigger, SPEC-116 create-still-opens regression); wiki cluster
  68/68; typecheck clean.
