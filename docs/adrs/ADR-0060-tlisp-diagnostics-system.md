# T-Lisp Diagnostics System

## Status

Accepted

## Context

T-Lisp evaluation errors were opaque: a single message string with no location, no structured code, no suggestion, and no stack. When a command failed, the user saw `Undefined symbol: foo` with no hint about where it was called or what to do instead. Debugging required reading the daemon console or checking `*Messages*` manually.

The evaluator had no way to attach source spans, error codes, or recovery hints to errors. The `EvalError` type was a flat `{ type, variant, message, details }` with no machine-readable structure.

## Decision

Add a structured diagnostics system to T-Lisp:

- **`src/tlisp/diagnostics.ts`** — `TLispDiagnostic` type with `severity`, `code`, `message`, `primarySpan`, `expected`, `actual`, `help`, and `stack` fields. Factory function `createDiagnostic()` builds diagnostics with all optional fields.
- **`src/tlisp/debug-state.ts`** — `DebugState` class tracking the current evaluation stack. Each evaluator frame pushes/pops, giving diagnostics a call stack.
- **`src/tlisp/source.ts`** / **`src/tlisp/source-metadata.ts`** — `SourceSpan` type (filename, start/end line/column) and metadata extraction from parsed AST nodes.
- **`src/tlisp/diagnostic-renderer.ts`** — `renderDiagnostic()` formats a diagnostic into a readable multi-line string for the `*Messages*` buffer.
- **Evaluator changes** — `makeError()` factory replaces ad-hoc error construction. `suggestSimilarSymbols()` provides "did you mean?" hints for undefined symbols using Levenshtein distance.
- **Server changes** — Diagnostics are serialized through JSON-RPC error responses with a `data.kind: 'tlisp-diagnostic'` envelope. Error codes changed from `-32603` (generic) to `-32010` (application-specific).
- **Editor changes** — `executeCommand()` now renders diagnostics to `*Messages*` and shows `[CODE] message` in the status line instead of raw error strings.

## Consequences

- Every T-Lisp error now has a machine-readable code (e.g., `TL1001` for undefined symbols), an optional source span, and a help string.
- The `*Messages*` buffer shows structured diagnostics instead of bare strings.
- The server propagates diagnostics to clients via JSON-RPC, enabling richer error UIs.
- The `tmaxclient --diagnostics` and `--last-error` commands can now show full diagnostic context.
- The evaluator is more complex due to stack tracking, but the overhead is negligible for an interactive editor.
