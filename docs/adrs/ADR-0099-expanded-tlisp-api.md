# Expanded T-Lisp API — File I/O, String Ops, Spec Authoring

## Status

Accepted

## Context

The `tlisp-api.ts` surface had grown organically but lacked primitives needed by the adw pipeline and spec-authoring tools: file reading/writing, string manipulation (case conversion, splitting, trimming), spec-file generation, and documentation extraction. The editor handlers (normal, insert, visual, command) also needed updates to integrate the new markdown and observability commands.

## Decision

Expand the T-Lisp API with new primitives and update the editor handlers:

1. **`src/editor/tlisp-api.ts`** — added 50+ new T-Lisp functions: file I/O (`read-file`, `write-file`, `file-exists`), string ops (`upcase`, `downcase`, `split-string`, `trim`, `replace`), spec utilities, and environment queries. This is the largest single change to the API surface.
2. **`src/editor/api/documentation.ts`** — auto-generated API documentation extraction from the T-Lisp function registry.
3. **`src/editor/editor.ts` + handlers** — updated normal/insert/visual/command handlers to delegate new commands (markdown follow-link, observability queries) to T-Lisp.
4. **`src/tlisp/core/commands/markdown.tlisp`** — updated with new markdown commands (follow-link integration for the browse-url feature).
5. **`src/tlisp/core/commands/trt-commands.tlisp`** — TRT runner commands exposed to the editor.

## Consequences

**Easier:** T-Lisp code can perform file I/O and string manipulation without TS changes. Spec authoring is scriptable. The API is documented via `documentation.ts`.

**Harder:** The API surface is large (100+ functions), increasing the learning curve. File I/O primitives in T-Lisp blur the TS/T-Lisp boundary slightly (but remain "primitives" — the logic around them is T-Lisp).

**Related:** ADR-0094 (adw pipeline uses file I/O + string ops), ADR-0095 (browse-url uses string ops for URL detection), ADR-0097 (TRT commands).
