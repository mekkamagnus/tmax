# Feature: T-Lisp adw-portability primitives (`append-file`, `json-encode`, `command-line-args`)

## Feature Description

Add the three remaining Tier 1 primitives from RFC-018 (`docs/rfcs/RFC-018-tlisp-scripting-primitives.md`, Steps 1.1–1.3) so that orchestration scripts equivalent to the TypeScript `adws/adw-plan-reviewspec-build.ts` pipeline become writable in T-Lisp. These are the three hard blockers identified in the RFC's gap analysis: each is a thin primitive (~10–40 lines of TypeScript) where T-Lisp literally cannot reach the runtime, mirroring an existing neighbor primitive.

- **`append-file`** — append content to a file without truncating. The adw orchestrator's defining pattern is crash-survivable event streaming via `appendFileSync(events.jsonl, line)`. T-Lisp has `write-file` (full overwrite) but nothing that appends; without this, every event/state write clobbers the previous one.
- **`json-encode` / `json-stringify`** — the inverse of the existing `json-read-from-string`. The orchestrator emits `JSON.stringify(state, null, 2)` for state files and `JSON.stringify({ts,…})` per event line. T-Lisp can parse JSON but cannot produce it.
- **`command-line-args`** (+ CLI forwarding) — expose a script's own arguments. The orchestrator's entire CLI surface (`--feature`/`--bug`/`--chore`/`--model`/`--id`/`-h`/`<description>`) is read via `parseArgs(process.argv.slice(2))`, but the standalone CLI consumes `process.argv` at the TS layer and never forwards the rest to the running script.

Together with the already-shipped `make-promise` + `core/monads` (CHORE-31), these complete RFC-018 Tier 1 and make a T-Lisp port of the orchestrator's *structure* feasible.

## User Story
As a tmax developer / T-Lisp script author
I want `append-file`, `json-encode`, and `command-line-args` primitives
So that I can write orchestration scripts (event logs, JSON state files, flag-parsing CLIs) in T-Lisp instead of TypeScript

## Problem Statement

The `adws/` directory is TypeScript today, but it is pure orchestration logic — arg parsing, id minting, append-only event logs, JSON state files. Per the project's Lisp-first architecture (`AGENTS.md`, `src/tlisp/Claude.md`), all higher-level editor logic belongs in T-Lisp. The RFC-018 gap analysis established that three small primitives are the entire difference between "cannot port at all" and "feasible port" — not deep language-design gaps, but missing thin builtins where T-Lisp cannot reach the runtime.

## Solution Statement

Add three builtins, each mirroring an existing neighbor's shape, plus a small `cli.ts` forwarding change:
- `append-file` next to `write-file` (`src/tlisp/io-ops.ts:87`) and `write-file-content` (`src/editor/api/file-ops.ts:60`).
- `json-encode` / `json-stringify` next to `json-read-from-string` (`src/editor/tlisp-api.ts:1488`) — the strict inverse of its decoder.
- `command-line-args` in `src/tlisp/sys-ops.ts` (mirrors how `getenv`/`exit` are injectable) + `src/tlisp/cli.ts` forwarding of post-script args.

All three return `Either<AppError, TLispValue>`, honor capability gating (`allowFilesystem`), and are available in both the standalone interpreter and the editor API where meaningful.

## Relevant Files
Use these files to implement the feature:

- `src/tlisp/io-ops.ts` — add `append-file` next to `write-file` (line 87). Mirror its path/content validation and `ensureFilesystem` gating. Do NOT auto-create parent directories (match `write-file`).
- `src/editor/api/file-ops.ts` — expose `append-file-content` next to `write-file-content` (line 60), so the editor API has the append primitive too (mirrors the existing read/write split across the two files).
- `src/editor/tlisp-api.ts` — add `json-encode` (alias `json-stringify`) next to `json-read-from-string` (line 1488). The encoder is the strict inverse of that decoder's `toTlisp` mapping.
- `src/tlisp/sys-ops.ts` — add `command-line-args` builtin, reading from an `argv?: string[]` injected into the standalone interpreter constructor (mirror `getenv`/`exit` injectability). Returns `nil` in the editor/daemon runtime (no meaningful script args).
- `src/tlisp/cli.ts` — forward everything after the script path (or after `-e <expr>`) into the interpreter's `command-line-args`. Today only `[first, second]` is destructured and the rest is silently dropped (~line 79).
- `src/tlisp/profiles/standalone.ts` — thread the optional `argv` through `StandaloneProfileOptions` into the interpreter.

### New Files
- `test/unit/tlisp-append-file.test.ts` — two-call append, create-on-absent, gating.
- `test/unit/tlisp-json-encode.test.ts` — round-trip with `json-read-from-string`, string escaping, unsupported-type rejection.
- `test/tlisp/command-line-args.test.tlisp` (or a unit test invoking the CLI) — script receives its trailing args.

## Implementation Plan
### Phase 1: Foundation
Land `append-file` first — it's the smallest and unblocks the event-log pattern that all three `adws/*.ts` files depend on. Mirror `write-file` exactly except for `fs.appendFileSync` (no truncate). No new value type, no evaluator change.

### Phase 2: Core Implementation
Land `json-encode`/`json-stringify` as the strict inverse of `json-read-from-string`. Mapping: `nil`→`null`, booleans→`true`/`false`, number→number, string→string (JSON-escaped), list→array, alist/hashmap→object. Unsupported types (functions, non-`t`/`nil` symbols) return `Either.left` `TypeError`, not a thrown exception. Add a `:pretty`/second-arg indentation knob only if cheap; otherwise defer and document.

Then land `command-line-args` + the `cli.ts` forwarding. The standalone interpreter constructor takes `argv?: string[]`; the builtin returns it as a list of strings; `cli.ts` passes `process.argv.slice(n)` where `n` is the index after the script path (or after `-e <expr>`). Flag parsing is the script's job — the primitive only hands over raw tokens.

### Phase 3: Integration
Confirm each primitive is reachable from both runtimes (standalone CLI + editor/daemon) where meaningful, and that `command-line-args` returns `nil` (not the daemon's own argv) in the daemon. Register any new tests in the existing discovery paths (`bun test`, `bin/trt`).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Add `append-file` (standalone)
- In `src/tlisp/io-ops.ts`, copy the `write-file` builtin shape (line 87) and swap the body for `fs.appendFileSync(path, content, "utf8")`.
- Reuse `ensureFilesystem("append-file", allowFilesystem)`, `expectString` for path + content.
- Return `nil` on success; return `Either.left` `EvalError` on failure (same shape as `write-file`).
- MUST NOT truncate. MUST NOT auto-create parent dirs (match `write-file`).

### Add `append-file-content` (editor API)
- In `src/editor/api/file-ops.ts`, mirror `write-file-content` (line 60) with `fs.appendFileSync`.
- Same validation chain (`validateArgsCount`, `validateArgType`).

### Add `json-encode` / `json-stringify`
- In `src/editor/tlisp-api.ts` next to `json-read-from-string` (line 1488), add a recursive encoder.
- Implement the inverse of the existing decoder's `toTlisp`: alist-of-`(key value)` pairs OR hashmap → object. Document precedence (alist takes precedence if ambiguous — confirm against RFC-018 Q2).
- Strings must be JSON-escaped (`"`, `\`, control chars). Round-trip must hold: `(json-read-from-string (json-encode v))` recovers an equivalent structure.
- Reject functions / non-`t`/`nil` symbols with `Either.left` `TypeError`.

### Add `command-line-args` builtin
- In `src/tlisp/sys-ops.ts`, register `command-line-args` returning the injected argv as a list of strings (or `nil` if unset).
- In `src/tlisp/profiles/standalone.ts`, add `argv?: string[]` to `StandaloneProfileOptions` and store it where the builtin can read it (mirror `getenv`/`exit` injection).
- In the editor runtime, the builtin returns `nil`.

### Forward args in `cli.ts`
- In `src/tlisp/cli.ts`, capture everything after the script path (script-file mode) or after `-e <expr>` (`-e` mode) and pass it as `argv` to `createStandaloneInterpreter`.
- Do NOT parse flags — raw token list only.
- Do NOT disturb existing `-e`/`-h`/`--version` handling.

### Write tests
- `test/unit/tlisp-append-file.test.ts`: two consecutive appends both present; append to non-existent path creates it; `allowFilesystem: false` rejects.
- `test/unit/tlisp-json-encode.test.ts`: hashmap → object; alist → object; round-trip with `json-read-from-string`; string escaping (quote, backslash, newline); unsupported type → `TypeError`.
- `test/unit/tlisp-command-line-args.test.ts` (or `.test.tlisp`): invoke the CLI with trailing args and assert the script sees them; `-e` mode trailing args; daemon returns `nil`.

## Testing Strategy
### Unit Tests
- Each primitive gets its own unit test file asserting the MUST behaviors above. Use the `createStartedEditor` / `expectRight` fixture pattern from `test/unit/tlisp-async.test.ts` and `test/unit/tlisp-make-promise.test.ts`.

### Integration Tests
- A combined T-Lisp script that exercises all three together: parse `(command-line-args)`, encode state with `json-encode`, append an event line with `append-file`, then read it back. This mirrors the adw orchestrator's core loop in miniature.

### Edge Cases
- `append-file` to a path whose parent dir doesn't exist → error (no auto-mkdir).
- `json-encode` on a nested mix of hashmaps + lists + strings.
- `command-line-args` with zero args → empty list; with `-`-prefixed args preserved verbatim (no flag parsing).
- `command-line-args` in the daemon → `nil`.

## Acceptance Criteria
- [ ] `(append-file p "a\n")` then `(append-file p "b\n")` leaves both lines in `p`; first append to a non-existent path creates it.
- [ ] `(json-encode (hashmap "a" 1 "b" "x"))` produces valid JSON `{"a":1,"b":"x"}`; round-trips with `json-read-from-string`.
- [ ] `(json-encode (list (list "k" "v\"x")))` escapes the embedded quote.
- [ ] `tlisp script.tlisp --feature "add foo"` makes `(command-line-args)` return `("--feature" "add foo")` inside the script.
- [ ] `tlisp -e '(length (command-line-args))' x y` → `2`.
- [ ] `(command-line-args)` returns `nil` under the daemon.
- [ ] `bun run typecheck:src` and `bun run typecheck:test` both clean.
- [ ] All three new test files pass with zero regressions to existing tests.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run typecheck:src` — TypeScript clean for src (exit 0).
- `bun run typecheck:test` — TypeScript clean for test (exit 0).
- `bun run typecheck` — Full typecheck (exit 0).
- `bun test test/unit/tlisp-append-file.test.ts --timeout 30000` — append-file unit tests pass.
- `bun test test/unit/tlisp-json-encode.test.ts --timeout 30000` — json-encode unit tests pass.
- `bun test test/unit/tlisp-command-line-args.test.ts --timeout 30000` — command-line-args unit tests pass.
- `bun test test/unit/module-system.test.ts --timeout 30000` — no loader regressions.
- `bun run src/tlisp/cli.ts -e "(progn (require-module std/monads) (print (append-file "/tmp/tlisp-append-smoke" "ok\n")))"` then verify `/tmp/tlisp-append-smoke` contains `ok` — end-to-end smoke from the standalone CLI.

## Notes

- **Scope discipline:** these are the three RFC-018 Tier 1 primitives *not* covered by CHORE-31. Do NOT also implement Tier 2 (`await-process`, `:env`, `format-time-string`, `file-realpath`) or Step 1.4b (promise-as-value evaluator change) — those remain RFC-only.
- **Follow the learnings** in `docs/learnings.md` "T-Lisp language gotchas" when writing any test `.tlisp` (no multi-line strings, `equal` not `eq` for symbols, `nil`≠empty-list, etc.).
- **No new value types, no evaluator changes** — all three are pure builtins returning `Either<AppError, TLispValue>`, matching `io-ops.ts`/`sys-ops.ts`/`file-ops.ts`/`tlisp-api.ts` conventions.
- **Capability gating:** `append-file` honors `allowFilesystem`; the others don't touch the filesystem. No new global capability bypasses.
- **RFC-018 is the design authority.** Resolve any ambiguity (alist-vs-hashmap for `json-encode`, `--` separator for args) against RFC-018 Open Questions Q2/Q3 rather than inventing here.
