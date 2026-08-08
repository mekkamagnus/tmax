# ADR-0198 — snippet-mode foundation (`#167`)

## Status

Accepted

## Context

tmax had no code-template/snippet expansion. The `abbrev-mode` (#153) was an
empty stub. Users had no way to type an abbreviation and expand it into a
multi-line template with fill-in fields.

## Decision

Implemented the **foundation** of yasnippet-style snippet expansion:

1. **SnippetManager** (`src/editor/api/snippet-ops.ts`) — loads snippet files
   from `~/.config/tmax/snippets/<mode>/` (plain text, any extension).
   Parses yasnippet format (`# key:` / `# name:` / `# --` / body).
   Placeholder parser extracts `$1`, `${1:default}`, `$0`, mirror fields.

2. **6 T-Lisp primitives**: `snippet-load-dir`, `snippet-lookup`, `snippet-list`,
   `snippet-reload`, `snippet-field-active-p`, `snippet-parse-body`.

3. **T-Lisp commands** (`src/tlisp/core/commands/snippet.tlisp`):
   `snippet-try-expand`, `snippet-expand`, `snippet-next-field`,
   `snippet-prev-field`, `snippet-exit`, `snippet-help`.

4. **Minor mode** (`src/tlisp/core/modes/snippet-mode.tlisp`): `snippet-mode`
   toggle + `global-snippet-mode`.

5. **Registered** in tlisp-api.ts + wired into normal.tlisp.

## Consequences

- Snippet files load from `~/.config/tmax/snippets/<mode>/` — plain text, any
  extension, yasnippet-compatible format.
- Placeholder parsing works: `$1`, `${1:default}`, `$0`, mirrors detected.
- Mode-scoped + `text-mode/` global fallback.
- `(snippet-list)` returns loaded snippets; `(snippet-reload)` re-reads.
- **Remaining work** (Phase 3-6 of SPEC-101): field marker tracking in the
  buffer (so Tab navigates between `$1`/`$2`/`$0`), mirror field live-update
  on keystroke, Tab hook in insert-handler (try-expand on Tab), and the actual
  RET routing for comint-mode (#165 interactive layer, SPEC-100).
- Verify-gate (SPEC-101): **PASS** — 13/13 tests, typecheck clean.
