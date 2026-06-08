# Feature: Strong T-Lisp Diagnostics and Debugging

## Feature Description
Implement LD-1 from `docs/memos/elisp-pain-points.md`: strong error messages and practical debugging for T-Lisp.

The feature adds source-aware parsing, structured diagnostics, Rust/Elm-style terminal rendering, stack traces with T-Lisp call frames, REPL/CLI/editor error surfaces, and lightweight debugging tools. The goal is that every parse, macro-expansion, module-loading, and evaluation error tells the user where it happened, what failed, why it failed, and what to try next.

The recommended form is a structured diagnostic core with multiple renderers:

- Internal data model: severity, code, source, message, primary span, labels, notes, help, suggestions, related locations, and stack frames.
- Human renderer: compact source excerpt with line/column and caret labels, modeled after Rust and Elm diagnostics.
- Tooling renderer: LSP-compatible diagnostic conversion for `.tlisp` buffers and future editor integrations.
- Debug renderer: Racket-style stack/error context and trace output without forcing a modal debugger.
- Agent observability renderer: JSON-safe diagnostic events and JSON-RPC error payloads that `tmaxclient` and daemon clients can query without scraping terminal text.

This is intentionally not a full stepping debugger in the first implementation. T-Lisp needs reliable source locations and structured error context before breakpoints, scopes, and variable inspection can be useful.

## User Story
As a T-Lisp user
I want errors to show the exact file, line, column, failing form, call stack, and likely fix
So that I can debug editor configuration, modules, plugins, and REPL experiments without guessing where a failure came from.

As a T-Lisp package author
I want diagnostics to distinguish public module API failures, private binding access, arity errors, type errors, and parse errors
So that users can report actionable package bugs and I can reproduce them quickly.

As a tmax maintainer
I want a structured diagnostic model instead of raw `Error` strings
So that CLI output, REPL output, `*Messages*`, diagnostics buffers, tests, and future tooling all consume the same error facts.

As an AI agent working through `tmaxclient` and the daemon
I want eval, command, keypress, module-load, and init-file failures to return structured diagnostics over JSON-RPC
So that I can inspect the exact error, repair the source, re-run the operation, and self-correct without screen scraping.

## Problem Statement
LD-1 identifies weak error messages and debugging as an immediate language-design pain point. T-Lisp currently has the same risk:

- `src/tlisp/tokenizer.ts` returns plain token strings and drops offsets, lines, and columns.
- `src/tlisp/parser.ts` builds plain `TLispValue` objects without source spans.
- `TLispInterpreterImpl.execute()` splits top-level forms by string slicing, which destroys original file offsets before parsing each form.
- Parser errors become short messages such as `Unmatched opening parenthesis`.
- Runtime failures often come from `throw new Error(...)` in stdlib/editor primitives and lose T-Lisp source context.
- `EvalError` has `type`, `variant`, `message`, and `details`, but no first-class diagnostic, primary span, related spans, help text, or stack frames.
- The standalone CLI and REPL print `Error: ${message}` only.
- Editor eval surfaces cannot jump to the failing T-Lisp form or list T-Lisp diagnostics.
- Debugging is mostly print/debug-by-reload; there is no T-Lisp backtrace buffer, trace facility, or structured `*e`.
- Daemon eval currently collapses T-Lisp failures into JSON-RPC internal errors, so agents lose diagnostic code, source span, stack, suggestions, and repair context.
- `tmaxclient --eval` prints a human error and exits nonzero; there is no `--json` error payload that an agent can parse for self-correction.
- Existing daemon observability has `recentErrors`, but those records are string messages rather than structured diagnostic events linked to request IDs, client IDs, frame IDs, buffers, modules, and source locations.

As T-Lisp becomes the editor logic layer and package/plugin language, opaque errors will slow every feature after modules, standalone T-Lisp, and package registry work.

## Solution Statement
Add a first-class diagnostic pipeline:

1. Introduce `SourceSpan`, `SourceFile`, `DiagnosticLabel`, `TLispDiagnostic`, and `TLispStackFrame` types.
2. Change tokenization/parsing to preserve source positions and attach metadata to parsed `TLispValue`s through a side metadata store, not enumerable fields. This avoids breaking value equality and serialization.
3. Replace top-level form string splitting with `parseProgram(source, sourceName)` so every form retains original offsets.
4. Extend `ConfigError` and `EvalError` with optional `diagnostic?: TLispDiagnostic`.
5. Add helpers that create diagnostic-backed parse/eval/module/type/arity errors.
6. Track logical T-Lisp call frames while evaluating functions, macros, modules, and loaded files.
7. Migrate parser/evaluator/module-loader/stdlib/editor primitive errors to return diagnostic-backed `Either.left` values instead of raw JavaScript errors where feasible.
8. Render diagnostics consistently in CLI, REPL, `*Messages*`, eval-buffer, eval-region, init-file loading, and daemon eval.
9. Add T-Lisp-visible debugging helpers: last error, backtrace formatting, trace/untrace, diagnostic listing, diagnostic-at-point, and jump-to-diagnostic.
10. Convert T-Lisp diagnostics to LSP-style `Diagnostic` records for `.tlisp` buffers using the existing LSP diagnostics infrastructure.
11. Emit JSON-safe diagnostic events for daemon-originated operations and return structured JSON-RPC error data for eval/command/key/module/init failures.
12. Add `tmaxclient --diagnostics --json`, `--last-error --json`, and `--backtrace --json` so agents can observe, repair, and retry from daemon state.

## AI Agent Observability Contract
Human-readable diagnostics are necessary but insufficient. AI agents should consume structured facts from daemon responses and observability endpoints.

### JSON-RPC Error Shape
When a daemon operation fails because of T-Lisp code, the JSON-RPC response must preserve the structured diagnostic in `error.data.diagnostic` and link it to request/client/frame context:

```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "error": {
    "code": -32010,
    "message": "T-Lisp evaluation failed: cursor-move expected a number for argument 1",
    "data": {
      "kind": "tlisp-diagnostic",
      "requestId": 42,
      "correlationId": "tmax-20260605-abc123",
      "clientId": "client-1749120000-ai",
      "frameId": "frame-1749120001-main",
      "operation": "eval",
      "diagnostic": {
        "severity": "error",
        "code": "TL1002",
        "source": {
          "kind": "buffer",
          "name": "scratch.tlisp",
          "uri": "buffer://scratch.tlisp"
        },
        "message": "cursor-move expected a number for argument 1",
        "primarySpan": {
          "start": { "line": 14, "column": 14, "offset": 276 },
          "end": { "line": 14, "column": 19, "offset": 281 }
        },
        "labels": [
          {
            "span": {
              "start": { "line": 14, "column": 14, "offset": 276 },
              "end": { "line": 14, "column": 19, "offset": 281 }
            },
            "style": "primary",
            "message": "expected number, got string"
          }
        ],
        "expected": "number",
        "actual": "string",
        "help": "Use 0 for the first line: (cursor-move 0 0)",
        "suggestions": [
          {
            "kind": "replacement",
            "message": "Replace string line name with numeric line index",
            "span": {
              "start": { "line": 14, "column": 14, "offset": 276 },
              "end": { "line": 14, "column": 19, "offset": 281 }
            },
            "replacement": "0"
          }
        ],
        "stack": [
          {
            "function": "cursor-move",
            "module": "editor/cursor",
            "source": { "kind": "primitive", "name": "editor/cursor" }
          },
          {
            "function": "jump-to-top",
            "module": "user/init",
            "source": {
              "kind": "file",
              "uri": "file:///Users/example/.config/tmax/init.tlisp"
            },
            "callSpan": {
              "start": { "line": 13, "column": 1, "offset": 240 },
              "end": { "line": 14, "column": 27, "offset": 289 }
            }
          }
        ],
        "reproduce": {
          "command": "tmaxclient --eval '(jump-to-top)' --json",
          "operation": "eval",
          "sourceKind": "daemon-eval"
        }
      }
    }
  }
}
```

### Diagnostic Event Shape
The daemon should also append a bounded event to its observability log whenever a structured diagnostic is created:

```json
{
  "event": "tlisp.diagnostic.created",
  "timestamp": "2026-06-05T08:00:00.000Z",
  "correlationId": "tmax-20260605-abc123",
  "requestId": 42,
  "clientId": "client-1749120000-ai",
  "frameId": "frame-1749120001-main",
  "operation": "eval",
  "bufferName": "scratch.tlisp",
  "moduleName": "user/init",
  "diagnostic": {
    "severity": "error",
    "code": "TL1002",
    "message": "cursor-move expected a number for argument 1",
    "source": { "kind": "buffer", "uri": "buffer://scratch.tlisp" },
    "primarySpan": {
      "start": { "line": 14, "column": 14, "offset": 276 },
      "end": { "line": 14, "column": 19, "offset": 281 }
    }
  }
}
```

### Required `tmaxclient` Agent Commands
These commands are additive and must preserve existing human workflows:

```bash
tmaxclient --eval '(jump-to-top)' --json
tmaxclient --diagnostics --json
tmaxclient --diagnostics --since-request 42 --json
tmaxclient --last-error --json
tmaxclient --backtrace --json
tmaxclient --status --json
```

Expected agent workflow:

1. Agent sends `tmaxclient --eval CODE --json`.
2. If the operation fails, the CLI exits nonzero and prints the JSON-RPC error object with `error.data.diagnostic`.
3. Agent reads `diagnostic.primarySpan`, `suggestions`, `stack`, and `source`.
4. Agent edits the relevant file or buffer.
5. Agent re-runs the same eval or asks `tmaxclient --diagnostics --since-request REQUEST --json` to confirm the diagnostic is gone.
6. Agent can use `--last-error --json` and `--backtrace --json` when it needs context after an interactive keypress or TUI-originated error.

Pretty terminal diagnostics remain available for humans, but agents must not need to scrape them.

## Relevant Files
Use these files to implement the feature:

- `docs/memos/elisp-pain-points.md` - LD-1 source problem and priority.
- `docs/srs.md` - Product requirements; update before implementation starts.
- `docs/specs/archive/prd.md` - Product roadmap; update before implementation starts.
- `src/error/types.ts` - Add optional diagnostic payloads to `ConfigError` and `EvalError`.
- `src/tlisp/types.ts` - Extend interpreter/parser interfaces for source-aware parsing and diagnostics.
- `src/tlisp/tokenizer.ts` - Preserve token spans and reject unknown characters with source-aware diagnostics.
- `src/tlisp/parser.ts` - Parse forms with spans, source names, and `parseProgram()`.
- `src/tlisp/values.ts` - Keep value constructors stable; add metadata helpers only if they do not make metadata enumerable.
- `src/tlisp/interpreter.ts` - Replace `splitTopLevelForms()` with source-aware program parsing and render diagnostics at boundaries.
- `src/tlisp/evaluator.ts` - Add stack-frame tracking and diagnostic-backed runtime errors.
- `src/tlisp/stdlib.ts` - Convert common arity/type failures into diagnostic-backed `EvalError`s.
- `src/tlisp/module-loader.ts` - Add module-not-found searched paths, source paths, cycle frames, and related locations.
- `src/tlisp/module-loader-standalone.ts` - Preserve file/module source names in standalone loading.
- `src/tlisp/repl.ts` - Render structured errors and store structured last error in `*e`.
- `src/tlisp/cli.ts` - Print pretty diagnostics for `-e` and script failures.
- `src/editor/editor.ts` - Surface T-Lisp diagnostics from init-file, eval-buffer, eval-region, command execution, and plugin loading.
- `src/editor/tlisp-api.ts` - Register diagnostic/debugging editor APIs.
- `src/editor/api/lsp-diagnostics.ts` - Reuse display state for `.tlisp` diagnostics.
- `src/frontend/render/status-line.ts` - Keep status-line summaries short while detailed diagnostics go elsewhere.
- `src/server/server.ts` - Preserve T-Lisp diagnostics in JSON-RPC error `data`, record daemon diagnostic events, and expose query endpoints for agents.
- `src/server/serialize.ts` - Serialize diagnostic records where daemon/client state needs them.
- `bin/tmaxclient` - Add `--diagnostics`, `--last-error`, `--backtrace`, and JSON-preserving eval failure output.
- `test/unit/tokenizer.test.ts` - Add token span and tokenization error tests.
- `test/unit/parser.test.ts` - Add parse location and source excerpt tests.
- `test/unit/evaluator.test.ts` - Add runtime diagnostic and stack-frame tests.
- `test/unit/interpreter.test.ts` - Add multi-form source preservation tests.
- `test/unit/repl.test.ts` - Add REPL structured error tests.
- `test/unit/server-observability.test.ts` - Extend daemon observability tests for structured diagnostic events and recent diagnostics.
- `test/unit/server-client.test.ts` - Verify JSON-RPC eval errors preserve diagnostic data.
- `test/integration/tlisp-cli.test.ts` - Add CLI script/eval diagnostic rendering tests.
- `test/integration/init-file-cli.test.ts` - Add init-file diagnostic tests.
- `test/integration/module-system.test.ts` - Add module diagnostic tests.
- `test/ui/tmax_harness/client.py` - Ensure daemon-mode test harness can query diagnostic JSON during failures.
- `test/ui/tests/13_modes.py` or focused new UI test - Verify editor diagnostic display only if renderer behavior changes.

### New Files
- `src/tlisp/source.ts` - `SourceFile`, `SourceSpan`, line/column lookup, source excerpt helpers.
- `src/tlisp/source-metadata.ts` - WeakMap-backed `TLispValue` span/source metadata.
- `src/tlisp/diagnostics.ts` - Diagnostic types, constructors, error-code registry, and LSP conversion.
- `src/tlisp/diagnostic-renderer.ts` - Plain terminal rendering for diagnostics and backtraces.
- `src/tlisp/debug-state.ts` - Last error, stack-frame capture, trace registry, and trace output helpers.
- `src/server/diagnostic-events.ts` - JSON-safe daemon diagnostic event model, bounded event log, filtering by request/client/frame/source, and status serialization helpers.
- `src/editor/api/tlisp-diagnostics-ops.ts` - Editor-visible operations such as `tlisp-last-error`, `tlisp-backtrace`, `diagnostic-list`, `diagnostic-at-point`, and `jump-to-diagnostic`.
- `test/unit/tlisp-diagnostics.test.ts` - Diagnostic model, renderer, LSP conversion, and source excerpt tests.
- `test/unit/tlisp-debugging.test.ts` - Backtrace, trace/untrace, and last-error tests.
- `test/unit/tlisp-agent-observability.test.ts` - JSON shape, correlation ID, request linkage, and agent self-correction contract tests.
- `test/integration/tlisp-diagnostics-editor.test.ts` - Editor eval/init/plugin diagnostic integration tests.

## Implementation Plan
### Phase 1: Foundation
Update SRS and PRD before implementation. Add source/diagnostic/debug data models, source-aware tokenization/parsing, and non-enumerable metadata for parsed values. Replace `splitTopLevelForms()` with `parseProgram()` so source offsets survive multi-form execution.

### Phase 2: Core Implementation
Thread diagnostics through parser, evaluator, module loader, stdlib, editor primitives, CLI, and REPL. Add stack-frame tracking, error codes, help/suggestion helpers, and pretty rendering. Convert the most common raw `throw new Error(...)` paths to `Either.left` diagnostics.

### Phase 3: Integration
Expose diagnostics and debugging in the editor, daemon/client, T-Lisp APIs, `*Messages*`, and `.tlisp` diagnostic display. Add daemon JSON observability so agents can self-correct through `tmaxclient` without scraping human output. Add focused tests, then run the full validation matrix.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Align Product Requirements
- Update `docs/srs.md` with LD-1 user stories and acceptance criteria.
- Update `docs/specs/archive/prd.md` with a Phase 0.9 LD-1 diagnostics/debugging milestone.
- Reference this spec from both documents.

### Step 2: Add Source Model
- Create `src/tlisp/source.ts`.
- Define `SourceFile`, `SourcePosition`, `SourceSpan`, and helpers for offset-to-line/column lookup.
- Support file paths, module names, `<eval>`, `<repl:N>`, and `<unknown>` source names.
- Add source excerpt helper output suitable for diagnostic rendering.
- Unit test single-line, multi-line, CRLF, EOF, and empty-source cases.

### Step 3: Add Diagnostic Model
- Create `src/tlisp/diagnostics.ts`.
- Define `TLispDiagnostic` with `severity`, `code`, `source`, `message`, `primarySpan`, `labels`, `notes`, `help`, `suggestions`, `relatedInformation`, and `stack`.
- Include JSON-safe optional fields for agent repair loops: `expected`, `actual`, `reproduce`, `correlationId`, and structured suggestions with `kind`, `span`, and `replacement`.
- Define stable error codes for MVP:
  - `TL0001` parse error
  - `TL0002` tokenize error
  - `TL1001` undefined symbol
  - `TL1002` type error
  - `TL1003` arity error
  - `TL1004` invalid special form
  - `TL2001` module not found
  - `TL2002` symbol not exported
  - `TL2003` circular module dependency
  - `TL3001` macro expansion error
  - `TL4001` host primitive error
- Add conversion to LSP-compatible diagnostic records.
- Add conversion to daemon/client JSON with no `Map`, `Set`, `Date`, function, `Error`, interpreter, or cyclic object values.
- Unit test diagnostic construction, LSP conversion, and JSON serialization.

### Step 4: Add Value Metadata Store
- Create `src/tlisp/source-metadata.ts`.
- Store parsed value metadata in a `WeakMap<TLispValue, SourceSpan>`.
- Expose `setSourceSpan(value, span)`, `getSourceSpan(value)`, and `copySourceSpan(from, to)`.
- Do not add enumerable metadata fields to `TLispValue` objects.
- Unit test that `expect(value).toEqual(createNumber(...))` remains unaffected by metadata.

### Step 5: Make Tokenizer Source-Aware
- Introduce a token object with text, kind, start/end offsets, line, and column.
- Either replace the parser's internal token stream with token objects or add `tokenizeWithSpans(source, sourceName)` and migrate parser to it.
- Keep any public string-token API only if tests or external call sites still require it.
- Stop silently skipping unknown characters; return a tokenize diagnostic with the offending span.
- Unit test spans for parentheses, symbols, strings, comments, numbers, quotes, quasiquotes, and invalid characters.

### Step 6: Make Parser Source-Aware
- Update `TLispParser` to parse source-aware tokens.
- Add `parseProgram(source, sourceName?)` returning all top-level forms with original spans.
- Preserve spans for desugared quote/quasiquote/unquote forms by assigning the wrapper form the full source span and preserving the inner expression span.
- Attach metadata to lists, symbols, strings, numbers, booleans, and nil values created from source.
- Produce diagnostic-backed parse errors for unmatched parens, unterminated strings, invalid strings, unexpected closing parens, and unexpected EOF.
- Unit test source spans and rendered messages for each parse failure.

### Step 7: Replace String-Based Multi-Form Execution
- Remove or stop using `TLispInterpreterImpl.splitTopLevelForms()`.
- Make `execute(source, env?, options?)` call `parseProgram(source, sourceName?)`.
- Evaluate parsed forms without trimming/reparsing strings.
- Add optional source name to eval entry points: CLI script path, `--eval`, REPL input number, init file path, module path, eval-buffer buffer name.
- Regression test that an error in the second or later top-level form reports the original file line/column.

### Step 8: Extend App Error Types
- Add optional `diagnostic?: TLispDiagnostic` to `ConfigError` and `EvalError` in `src/error/types.ts`.
- Add helper constructors for diagnostic-backed parse/eval errors.
- Ensure existing callers that inspect only `.message` still work.
- Unit test compatibility with old message-only errors.

### Step 9: Track T-Lisp Stack Frames
- Create `src/tlisp/debug-state.ts`.
- Track logical frames for function calls, macro expansion, module loading, init-file loading, eval-buffer/eval-region, and host primitives.
- Capture function name, module name, source span, call site span, and tail-call marker.
- Keep frame capture bounded to avoid unbounded memory on recursion.
- Ensure tail-call optimization still terminates tail-recursive functions and stack diagnostics stay useful.
- Unit test nested calls, module calls, macro calls, and tail recursion.

### Step 10: Upgrade Evaluator Errors
- Update `evalSymbol()` to return `TL1001` with source span and suggestions for near matches or qualified module names.
- Update special form validation to return `TL1004` with labels for malformed forms.
- Update `evalFunctionCallInternal()` and argument evaluation to wrap function/macro errors with current call frame.
- Update module-related errors to include module name and related locations when available.
- Unit test undefined symbols, invalid special forms, private module access, and macro expansion failures.

### Step 11: Migrate Stdlib and Host Primitive Errors
- Add helper wrappers for builtin arity/type checks.
- Convert common stdlib failures from raw `throw new Error(...)` to diagnostic-backed `Either.left`.
- Start with high-frequency primitives: arithmetic, comparison, list, hashmap, string, `funcall`, `apply`, `require-module`, file/sys primitives, and editor API commands used from init files.
- Preserve behavior and messages for successful calls.
- Unit test arity/type diagnostics with source labels on the bad argument.

### Step 12: Add Diagnostic Renderer
- Create `src/tlisp/diagnostic-renderer.ts`.
- Render compact terminal diagnostics:
  - severity and code
  - message
  - `--> source:line:column`
  - source line excerpt
  - primary/secondary caret labels
  - notes/help/suggestions
  - optional T-Lisp backtrace
- Keep output ASCII-only.
- Add a narrow-width fallback that stays readable in terminal status/log contexts.
- Unit test renderer snapshots with stable ASCII output.

### Step 13: Upgrade CLI and REPL
- Update `src/tlisp/cli.ts` to print rendered diagnostics for `-e` and script failures.
- Update `src/tlisp/repl.ts` to use `<repl:N>` source names.
- Store `*e` as a structured diagnostic value or a stable diagnostic hashmap, while preserving a string fallback if existing code expects a string.
- Add REPL commands for `last-error` or `backtrace` if they fit the existing command style.
- Integration test CLI script errors and one-shot eval errors.

### Step 14: Upgrade Editor Error Surfaces
- Add `src/editor/api/tlisp-diagnostics-ops.ts`.
- Register APIs in `src/editor/tlisp-api.ts`.
- Surface detailed diagnostics in `*Messages*` and/or `*T-Lisp Diagnostics*`; keep status line to one concise summary.
- Make init-file, plugin-loading, eval-buffer, eval-region, command execution, and daemon eval use diagnostic rendering.
- Add `diagnostic-list`, `diagnostic-at-point`, `jump-to-diagnostic`, `tlisp-last-error`, and `tlisp-backtrace` commands.
- Integration test editor eval failures and init-file failures.

### Step 15: Add Daemon and `tmaxclient` Agent Observability
- Create `src/server/diagnostic-events.ts`.
- Add bounded daemon diagnostic event history, separate from the existing string-only `recentErrors` list.
- Store `requestId`, `correlationId`, `clientId`, `frameId`, operation, source kind, buffer name, module name, and serialized diagnostic for every T-Lisp diagnostic that reaches the daemon.
- Update `src/server/server.ts` so T-Lisp eval/command/keypress failures return JSON-RPC errors with `error.data.kind = "tlisp-diagnostic"` and `error.data.diagnostic`.
- Use a stable JSON-RPC application error code such as `-32010` for T-Lisp diagnostics instead of collapsing them into generic `-32603` internal errors.
- Preserve structured diagnostic data in `status.recentDiagnostics` and keep `recentErrors` only for legacy string summaries.
- Add JSON-RPC methods or queries for `diagnostics`, `last-error`, and `backtrace`, with filters for `sinceRequest`, `clientId`, `frameId`, `buffer`, `module`, and `severity`.
- Update `bin/tmaxclient`:
  - `--eval CODE --json` prints the full JSON-RPC error object on T-Lisp failure and exits nonzero.
  - `--diagnostics --json` prints recent structured diagnostic events.
  - `--diagnostics --since-request ID --json` prints diagnostics created after a request.
  - `--last-error --json` prints the latest structured diagnostic.
  - `--backtrace --json` prints the latest T-Lisp stack frames.
- Ensure human-mode `tmaxclient --eval CODE` still prints a concise rendered diagnostic.
- Unit test JSON-RPC error data, status recent diagnostics, tmaxclient JSON output, and nonzero exit codes.
- Integration test an agent loop: failing eval returns diagnostic JSON, source is corrected, re-run succeeds, and `--diagnostics --since-request` no longer returns that active diagnostic.

### Step 16: Add Trace/Untrace Debugging
- Add T-Lisp-visible `trace`, `untrace`, and `trace-list` helpers.
- Trace output should include function name, arguments, result or error, nesting depth, and source location when known.
- Keep trace state in T-Lisp/debug runtime, not in renderer code.
- Unit test tracing normal functions, recursive functions, and erroring functions.

### Step 17: Integrate With LSP Diagnostics
- Convert T-Lisp diagnostics for `.tlisp` buffers into LSP-compatible records.
- Reuse `src/editor/api/lsp-diagnostics.ts` display/listing where practical.
- Ensure external LSP diagnostics and T-Lisp diagnostics remain distinguishable by `source`.
- Unit test conversion and diagnostic source separation.

### Step 18: Update Documentation
- Update README T-Lisp error examples if user-facing CLI output changes.
- Document agent workflow examples for `tmaxclient --eval --json`, `--diagnostics --json`, `--last-error --json`, and `--backtrace --json`.
- Update T-Lisp documentation to describe diagnostic fields, `*e`, backtrace, trace/untrace, and editor commands.
- Link back to `docs/memos/elisp-pain-points.md` LD-1 and this spec.

### Step 19: Run Validation Commands
- Run every command in the Validation Commands section.
- Fix every type error, test failure, and renderer regression.
- Do not report completion until the validation matrix is green or every blocker is documented with exact output.

## Testing Strategy
### Unit Tests
- Tokenizer span tracking and invalid-character diagnostics.
- Parser source spans, `parseProgram()`, quote/quasiquote spans, and parse error rendering.
- Diagnostic model, renderer, LSP conversion, and metadata non-enumerability.
- Evaluator undefined symbol, type, arity, special-form, macro, and module diagnostics.
- Stack-frame capture, tail-call preservation, trace/untrace, and last-error state.
- Stdlib and host primitive diagnostic helpers.

### Integration Tests
- `tlisp -e` and script failures render file/line/column and exit nonzero.
- `tmaxclient --eval CODE --json` returns JSON-RPC error data with a structured diagnostic and exits nonzero on T-Lisp failure.
- `tmaxclient --diagnostics --json`, `--last-error --json`, and `--backtrace --json` expose daemon diagnostics without screen scraping.
- REPL failures set `*e` and render `<repl:N>` locations.
- Init-file failures show path and source excerpt.
- Eval-buffer/eval-region failures map back to buffer locations.
- Module loading errors list searched paths and dependency/cycle context.
- Editor commands expose `diagnostic-list`, `diagnostic-at-point`, and backtrace content.
- Daemon status includes `recentDiagnostics` with JSON-safe diagnostic event records linked to request/client/frame IDs.

### Edge Cases
- Multiple top-level forms with an error after earlier successful forms.
- Multiline strings and multiline forms.
- Comments before errors.
- CRLF files.
- EOF after open paren or quote.
- Errors in macro-expanded code with both expansion and call-site context.
- Tail-recursive errors after many iterations.
- Module-not-found from editor profile versus standalone profile.
- Two modules exporting similar names for undefined-symbol suggestions.
- Diagnostics from daemon eval strings with no file path.
- T-Lisp failure from a TUI keypress, where the agent must discover the error later through `--last-error --json`.
- Multiple clients producing diagnostics concurrently; filters by client/frame/request must isolate the right error.
- JSON serialization of diagnostics containing related locations, suggestions, and stack frames without cycles or host objects.

## Acceptance Criteria
- Every parser/tokenizer error includes a diagnostic with source name, line, column, primary span, and rendered source excerpt.
- Every evaluator/module/stdlib error that reaches users includes a diagnostic code, severity, message, and either a source span or an explicit no-source reason.
- Undefined-symbol diagnostics suggest likely local, imported, or qualified names when a reasonable match exists.
- Arity/type diagnostics label the failing function call or argument position.
- Module diagnostics include module name, searched paths for not-found errors, and related locations for export/cycle failures when available.
- CLI, REPL, editor eval, init-file loading, plugin loading, daemon eval, and `*Messages*` all render the same diagnostic facts consistently.
- JSON-RPC eval/command/keypress failures include the diagnostic under `error.data.diagnostic`, with correlation/request/client/frame context sufficient for an agent to repair and retry.
- `tmaxclient --eval CODE --json` prints structured JSON on success and on failure; failure exits nonzero but does not discard diagnostic data.
- `tmaxclient --diagnostics --json`, `--diagnostics --since-request`, `--last-error --json`, and `--backtrace --json` expose daemon diagnostic state for agents.
- Daemon `status` includes bounded `recentDiagnostics` while retaining string `recentErrors` for backward compatibility.
- Agent-facing diagnostic JSON contains no unserializable values, no cyclic objects, no JavaScript stack-only context, and no terminal escape sequences.
- T-Lisp stack traces include logical function/module frames and omit noisy TypeScript host stack frames by default.
- `trace`, `untrace`, `trace-list`, `tlisp-last-error`, and `tlisp-backtrace` are available and covered by tests.
- `.tlisp` diagnostics can be represented as LSP-compatible diagnostics without losing severity, code, range, source, message, or related information.
- Existing successful T-Lisp programs continue to evaluate with the same values.
- Metadata attached to parsed values does not break existing value equality tests or serialization.
- Full validation commands pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun test test/unit/tokenizer.test.ts test/unit/parser.test.ts test/unit/tlisp-diagnostics.test.ts test/unit/tlisp-debugging.test.ts` - Run focused tokenizer/parser/diagnostic/debug tests.
- `bun test test/unit/evaluator.test.ts test/unit/interpreter.test.ts test/unit/repl.test.ts test/unit/module-system.test.ts test/unit/tlisp-agent-observability.test.ts` - Run focused evaluator/interpreter/REPL/module/agent observability tests.
- `bun test test/unit/server-observability.test.ts test/unit/server-client.test.ts` - Run daemon observability and JSON-RPC diagnostic contract tests.
- `bun test test/integration/tlisp-cli.test.ts test/integration/init-file-cli.test.ts test/integration/module-system.test.ts test/integration/tlisp-diagnostics-editor.test.ts` - Run focused integration tests.
- `bun test` - Run the full Bun test suite.
- `bun run typecheck:src` - Typecheck source files.
- `bun run typecheck:test` - Typecheck test files.
- `bun run typecheck` - Run the aggregate typecheck.
- `bun run build` - Verify production build still succeeds.
- `bun run test:daemon` - Verify daemon/client eval and diagnostics behavior.
- `bun run test:ui:renderer` - Verify real-key renderer behavior if editor diagnostic display changes.

## Notes
- No new external dependency is expected.
- The best implementation model is a Rust/Elm-style human renderer backed by LSP-compatible structured diagnostics and Racket-style stack/trace context.
- Rust references: diagnostic structure, primary spans, labels, notes, help, suggestions, and error codes in the Rust compiler development guide.
- Elm reference: compiler error UX emphasizing exact source excerpts and helpful hints.
- Racket references: `errortrace` and `racket/trace` show the value of stack traces, source context, and lightweight tracing for Lisp workflows.
- LSP reference: diagnostics use range, severity, code, source, message, related information, and optional code descriptions.
- DAP reference: stack frames, scopes, variables, and REPL are useful future shapes, but implementing a full debug adapter is out of scope for this feature.

## Research Sources
- Rust Compiler Development Guide, diagnostics: https://rustc-dev-guide.rust-lang.org/diagnostics.html
- Rust Compiler Development Guide, diagnostic structs: https://rustc-dev-guide.rust-lang.org/diagnostics/diagnostic-structs.html
- Elm compiler errors: https://elm-lang.org/news/compiler-errors-for-humans
- Racket Errortrace: https://docs.racket-lang.org/errortrace/index.html
- Racket Debugging: https://docs.racket-lang.org/reference/debugging.html
- Language Server Protocol 3.18 diagnostics: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/#diagnostic
- Debug Adapter Protocol overview: https://microsoft.github.io/debug-adapter-protocol/overview
