# Bug: `markdown-follow-link` not working in the live editor (works in unit fixture)

## Goals

- Following a markdown link (inline `[text](url)` and `[text](file.md)`) works in the LIVE TUI/daemon editor, not just in unit tests.

## Completion Criteria (Definition of Done)

- [ ] **Reproduce first, in the mekkapi tab** (herdr pane `w2:p3`, md-journal): open a note with `[Anthropic](https://anthropic.com)` and `[local](./other.md)`, cursor on each, `gx` — record exactly what happens (message, no-op, wrong buffer).
- [ ] Root cause identified from that live repro (unit fixture PASSES both cases — URL → "Browse: …", local .md → buffer opens — so the defect is live-path-specific: gx chord dispatch, the markdown-mode-scoped `g x` keymap not active in the daemon/TUI, or follow's path resolution against the daemon cwd).
- [ ] Fix landed; live e2e: both link kinds follow in the mekkapi tab (URL → browse/open, relative .md → the note opens), verified by reading the pane.
- [ ] Unit regression added for whatever the live-specific cause was.
- [ ] `bun run typecheck` + markdown suites green.

## Known facts (investigated 2026-08-15)

- Unit fixture: `markdown-follow-link` on `[Anthropic](https://…)` → status "Browse: https://…" ✓; on `[local](other.md)` relative to the buffer's dir → opens `other.md` ✓. The FUNCTION is correct.
- `gx` = the `g x` chord, bound to `(markdown-do)` **only in markdown-mode.tlisp** (`(key-bind "g x" "(markdown-do)" "normal" "markdown")` — major-mode-scoped 4-arg form). In normal.tlisp, `g x` is bound to a non-markdown fallback. If the daemon/TUI path doesn't activate the markdown major-mode keymap (or resolves the unscoped binding first), gx does the wrong thing live.
- Likely interplay with SPEC-118 (wiki-links in gx): part of the user's "not working" experience was `gx` on `[[wiki]]` links, which markdown-do does not handle at all.

## Relevant Files

- `src/tlisp/core/modes/markdown-mode.tlisp:60` — the mode-scoped gx binding.
- `src/tlisp/core/commands/markdown/links.tlisp` — `markdown-follow-link`, `markdown-open-file-link`.
- `src/tlisp/core/commands/markdown/formatting.tlisp` — `markdown-do` dispatch.

## Severity

high — link-following is the core of a markdown journal workflow; broken live = the feature doesn't exist for the user.
