# ADR-0219: BUG-76 — live link-follow was double-broken (missing echo row + first-link-only detection)

- **Status**: accepted
- **Date**: 2026-08-15
- **Issues**: #191
- **Spec**: [BUG-76](../specs/BUG-76-markdown-follow-link-live.md)

## Context

`gx` (markdown-do → markdown-follow-link) worked in unit fixtures but appeared
completely dead in the live editor: no message, no action, on both URL and
local-file links. The initial hypothesis — daemon frame-sync clearing the `g`
chord prefix between keystrokes — was disproven by code reading
(`syncFrameToEditor`'s patch omits `whichKeyPrefix`, so the merge preserves it;
the `render` client-event is observability-only).

## Decision

Instrument instead of theorize: reading the live session's `*Messages*` buffer
showed `Browse: https://anthropic.com` logged at the exact timestamps of the
"silent failures" — **the command worked; its feedback was invisible**. Two
fixes, both minimal:

1. **Echo row in `captureFrame`** (`src/render/capture-frame.ts`). The TUI
   client renders `state.statusMessage` at height-2; the shared capture
   renderer (embedded Steep = what bare `tmax` runs, plus `tmax --capture`)
   had no such branch. Mirror the TUI exactly — overlay on the last buffer
   line, truncate to width, minibuffer/command input takes precedence, frame
   stays exactly `height` lines. One branch; frontends are now behaviorally
   identical.

2. **Cumulative-offset loop in `markdown-link-at-point`**
   (`src/tlisp/core/commands/markdown/links.tlisp`) — the BUG-74 pattern. And
   `markdown-follow-link` now CALLS it instead of carrying its own inline
   first-match copy. The duplicated inline check is precisely what let the
   at-point bug persist in one function after being fixed in its sibling.

## Consequences

- Every command's `(message …)` feedback is now visible in the embedded
  frontend — not just link-follow. This retroactively surfaces "Unbound key",
  "Which-key", and error messages that were also silent.
- At-point link detection is correct for multi-link lines (the journal
  workflow's normal case: `links: [a](url1) and [b](note.md)`).
- Lesson recorded: `markdown-embed-target-at-point` still has a
  first-match-style loop WITHOUT the cumulative offset (positions relative to
  truncated text) — same defect class, out of scope here, worth an issue if
  embeds misbehave on multi-embed lines.
- Diagnostic lesson: **check `*Messages*` before concluding a command didn't
  run** — silent UI ≠ silent execution.
