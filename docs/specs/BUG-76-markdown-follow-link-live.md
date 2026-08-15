# Bug: `markdown-follow-link` not working in the live editor (works in unit fixture)

## Goals

- Following a markdown link (inline `[text](url)` and `[text](file.md)`) works in the LIVE TUI/daemon editor, not just in unit tests.

## Completion Criteria (Definition of Done)

- [x] **Reproduce first, in the mekkapi tab** (herdr pane `w2:p3`, md-journal): open a note with `[Anthropic](https://anthropic.com)` and `[local](./other.md)`, cursor on each, `gx` — record exactly what happens (message, no-op, wrong buffer).
- [x] Root cause identified from that live repro.
- [x] Fix landed; live e2e: both link kinds follow (URL → browse/open, relative .md → the note opens), verified by reading the pane.
- [x] Unit regression added for whatever the live-specific cause was.
- [x] `bun run typecheck` + markdown suites green.

## Root cause (diagnosed 2026-08-15)

The diagnosis required TWO layers — the command was double-broken live:

1. **Invisible feedback (the "silent" half).** `markdown-do`/`markdown-follow-link`
   executed correctly all along (confirmed: `*Messages*` logged
   `Browse: https://anthropic.com` at the exact timestamps of the "failing"
   keystrokes, and `/usr/bin/open` fired). But `captureFrame`
   (`src/render/capture-frame.ts`) — the renderer for the embedded Steep
   frontend (what bare `tmax` runs) and `tmax --capture` — had NO echo row for
   `state.statusMessage`. The TUI client renders the message at height-2
   (`src/client/tui-client.ts`), but the shared capture renderer omitted it,
   so every command gave zero visible feedback. The user (and the first
   investigation) reasonably concluded "not working".

2. **First-link-only detection (the real functional bug).** On a line with
   several links — `links: [Anthropic](https://anthropic.com) and [note](2026-08-08.md)` —
   `markdown-link-at-point` matched only the FIRST `[t](u)` regex hit and
   compared the cursor against ITS bounds: cursor on any later link → nil →
   "Nothing to do at point". `markdown-follow-link` carried its own inline
   copy of the same first-match check ("Cursor not on a link"). This is the
   same class of defect as BUG-74 (`markdown-wiki-link-at-point`), whose fix
   (cumulative-offset match loop) was not applied to the inline-link family.
   The unit fixture never caught it because every fixture line contained
   exactly one link.

## Fix

- `src/render/capture-frame.ts` — echo row: mirror the TUI client exactly
  (overlay `state.statusMessage` on the last buffer line, truncate to width,
  frame stays exactly `height` lines; minibuffer/command-mode input takes
  precedence).
- `src/tlisp/core/commands/markdown/links.tlisp` — `markdown-link-at-point`
  rewritten with the BUG-74 cumulative-offset loop; `markdown-follow-link`
  now reuses it instead of its own inline first-match regex (single source of
  truth — the duplicated inline check is what let the bug persist).

## Known facts (investigated 2026-08-15)

- Unit fixture: `markdown-follow-link` on `[Anthropic](https://…)` → status "Browse: …" ✓; on `[local](other.md)` relative to the buffer's dir → opens `other.md` ✓. The FUNCTION is correct.
- `gx` = the `g x` chord, bound to `(markdown-do)` in BOTH motions.tlisp (global T-Lisp keymap) and markdown-mode.tlisp (major-mode-scoped) — dispatch was never the problem; both resolve to markdown-do.
- The earlier "daemon TUI frame-sync clears chord state" hypothesis was disproven: the keypress RPC handler preserves `whichKeyPrefix` (it is absent from `syncFrameToEditor`'s patch, so `setEditorState`'s merge leaves the model value intact), and the `render` client-event is observability-only.

## Relevant Files

- `src/render/capture-frame.ts` — echo row (feedback half).
- `src/tlisp/core/commands/markdown/links.tlisp` — `markdown-link-at-point`, `markdown-follow-link` (detection half).
- `src/client/tui-client.ts` — reference implementation of the echo row.

## Severity

high — link-following is the core of a markdown journal workflow; broken live = the feature doesn't exist for the user.
