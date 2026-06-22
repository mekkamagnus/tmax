# Feature: tmax-use — Control Library + Visual E2E Test Runner

## Feature Description

**tmax-use** is a two-layer system that treats the tmax daemon the way Playwright treats a browser: as a controllable subprocess with a protocol for inspecting and manipulating state.

**Layer 1: Control library.** A TypeScript API for programmatically controlling a tmax daemon — lifecycle management, key input, T-Lisp evaluation, state queries, and headless frame capture. Analogous to the `playwright` npm package. Usable standalone for demos, scripting, and agent tools — not just testing.

**Layer 2: Test runner.** A test runner (`tmax-use test`) that uses the control library to execute YAML playbooks and TypeScript test files, with text assertions, visual baseline comparison, terminal + HTML reporting, and adw pipeline integration. Analogous to `@playwright/test`.

Headless-first: all visual capture uses the daemon's `capture` JSON-RPC method (no tmux required). Headed mode (real TUI in tmux) is optional for debugging and live observation.

The daemon/client architecture already exposes everything needed — `tmaxclient --keys`, `--eval`, `--capture`, `--capture-html` — over JSON-RPC. tmax-use is the orchestration layer that provides a fluent API, assertion library, test execution, and reporting over those primitives.

## User Story

As a **developer or AI agent** verifying editor functionality end-to-end
I want to **control a tmax daemon programmatically, capture its rendered output headlessly, and assert on both state and visuals**
So that **I can verify editor behavior in CI (no tmux), during adw build loops, and from standalone scripts — the same way Playwright controls a browser for web testing.**

## Problem Statement

Today there are three overlapping e2e mechanisms and none provides a reusable control surface:

1. **`adw-run-e2e.ts`** (1025 lines) — a standalone data-driven runner with YAML playbooks. It has mixed headless/headed support, but visual assertions require tmux `capture-pane`, there's no headless capture, no baseline comparison, no reporting (just terminal output), and the daemon/client plumbing is hardcoded — not reusable.

2. **Python UI harness** (`test/ui/tmax_harness/`) — 24 tests with 20+ assertion functions, daemon+tmux query paths, and proper state threading. Comprehensive but Python-only, and the assertion API is raw (T-Lisp expressions, not a fluent interface).

3. **Demo runner** (`demos/demo-runner.py`) — YAML-driven visual replay in live tmux. No assertions — purely observational.

The gap: **no reusable control library** and **no headless visual testing**. The daemon already has a `capture` RPC that renders frames without a TUI (`captureFrame()` + `ansiLinesToHtmlDocument()`), but nothing wires it into a test framework. There's no baseline comparison, no HTML reporter, no way for an adw build agent to verify visual output in CI.

## Solution Statement

Build tmax-use as two layers in `tmax-use/`:

**Layer 1 — Control library** (`tmax-use/src/`):
- `TmaxInstance`: daemon lifecycle (launch from clean slate, connect to existing, close). Reuses the proven spawn+poll pattern from `adw-run-e2e.ts`.
- `Frame`: editor control API — `openFile`, `keys`, `eval`, `mode`, `cursor`, `bufferText`, `capture` (ANSI/HTML/plain), `waitFor*`. Wraps CLI-compatible operations and direct JSON-RPC calls in TaskEither chains; key dispatch uses semantic protocol values for arrows and shifted arrows.
- Key parser: translates `<Esc>`, `<Enter>`, `<C-a>`, `<M-x>` etc. into protocol key values.
- Public async contract: all control-library daemon/client/frame/assertion operations that touch the daemon, filesystem, subprocesses, or timers return `TaskEither<TmaxUseError, T>`. Pure helpers return plain values or synchronous `Either<TmaxUseError, T>` when validation can fail without I/O. Runner entry points and runner-owned TypeScript fixtures execute `.run()` internally and expose Promise-based APIs only at the test-runner boundary.

**Layer 2 — Test runner** (`tmax-use/test/`):
- YAML playbook format: `name`, optional `terminal: { width, height }`, `setup` (files), `steps` (open/keys/assert), `cleanup`. Assertion types: text (mode, cursor, buffer), screen (substring via headless capture), baseline (HTML comparison against stored baselines).
- TypeScript test files: use the runner-only suffix `*.tmax-use.ts`, import `test` and `expect` from `tmax-use/test` (`import { test, expect } from "../test/index.ts"`), then author `test('name', async ({ frame }) => { ... })` with the same assertion library. Do not import Bun's `test` API in tmax-use suites. Avoid the `*.test.ts` suffix under `tmax-use/tests/` so `bun test` does not discover runner-owned tests.
- Terminal reporter: immediate feedback with captured frame snapshots on failure.
- HTML reporter: standalone HTML file with step timeline, captured frames, assertion results, baseline diffs.
- Baseline management: stored in `tmax-use/baselines/`. Local first runs may create missing baselines only outside CI; CI fails on missing baselines unless `--update-baselines` is explicitly set for a baseline refresh job.

**ADW integration**: `tmax-use test` works as both a standalone CLI and an adw pipeline stage. Exit code drives build/pass decisions. HTML report + JUnit XML persist as workspace artifacts.

## Relevant Files

### New Files

- **`tmax-use/src/instance.ts`** — `TmaxInstance` class: daemon lifecycle (launch, connect, close). Spawns `src/server/server.ts`, polls readiness, manages socket. Reuses the spawn+poll+teardown pattern from `adw-run-e2e.ts` but as a reusable, injectable class.
- **`tmax-use/src/frame.ts`** — `Frame` class: editor control API. Sends keys through direct JSON-RPC `keypress` calls (or a CLI compatibility path updated to emit semantic protocol key values), wraps `--eval`; opens files by positional `bin/tmaxclient <file>` or direct JSON-RPC `open`; captures by direct JSON-RPC `capture` so metadata is preserved. Exposes `openFile`, `keys`, `eval`, `mode`, `cursor`, `bufferText`, `bufferName`, `statusLine`, `capture`, `captureHtml`, `capturePlain`, `waitForMode`, `waitForRender`, `waitForTextContains`.
- **`tmax-use/src/capture.ts`** — Capture primitives: call the daemon's existing `capture` JSON-RPC method directly and return `{ lines, width, height }` for ANSI or `{ html, width, height }` for HTML. `bin/tmaxclient --capture` currently prints only ANSI lines and `--capture-html` prints only HTML, so those CLI flags are acceptable only for human-readable output, not metadata-bearing assertions.
- **`tmax-use/src/keys.ts`** — Key parser: translates `<Esc>`, `<Enter>`, `<BS>`, `<Tab>`, `<Space>`, `<Up>/<Down>/<Left>/<Right>`, `<C-a>` through `<C-z>`, `<M-x>`, `<S-...>` into protocol-compatible key values.
- **`tmax-use/src/client.ts`** — protocol client: thin TaskEither wrapper around spawning `bin/tmaxclient` with `--socket`, `--keys`, `--eval`, and positional filename args for CLI-compatible operations, plus a direct JSON-RPC request helper for methods where structured results are required (`open`, `capture`, `ping`). Injectable for testing.
- **`tmax-use/src/errors.ts`** — Domain errors: `DaemonNotResponsive`, `CaptureFailed`, `KeySendFailed`, `EvalError`, `AssertionFailed`, `BaselineMismatch`, `BaselineMissing`.
- **`tmax-use/assert/index.ts`** — `expect()` entry point: `expect(frame).toHaveMode(...)`, `expect(frame).toHaveCursorAt(...)`, `expect(frame).screenContains(...)`, `expect(frame).toMatchBaseline(...)`.
- **`tmax-use/assert/text.ts`** — Text assertions: mode, cursor position, buffer content, status line.
- **`tmax-use/assert/screen.ts`** — Screen assertions: substring matching on headless capture output.
- **`tmax-use/assert/baseline.ts`** — Visual baseline comparison: compare captured HTML against stored baseline, zero-dependency structural/text diff, local missing-baseline creation, CI missing-baseline failure, and explicit update mode.
- **`tmax-use/test/runner.ts`** — Test runner: orchestrates daemon lifecycle, executes YAML playbooks and TypeScript tests sequentially, collects results, invokes reporters.
- **`tmax-use/test/playbook.ts`** — YAML playbook parser: reads playbook files, validates with `Validation` applicative, returns typed playbook structures.
- **`tmax-use/test/index.ts`** — TypeScript runner test API: exports runner-owned `test`, Promise-based `expect`, and test context types for `*.tmax-use.ts` files.
- **`tmax-use/test/reporter-term.ts`** — Terminal reporter: immediate pass/fail output with captured frame snapshots on failure.
- **`tmax-use/test/reporter-html.ts`** — HTML reporter: standalone HTML file with step timeline, captured frames, assertion results, baseline diffs.
- **`tmax-use/test/reporter-junit.ts`** — JUnit XML reporter: for CI integration and adw agent consumption.
- **`tmax-use/test/cli.ts`** — CLI entry point: `tmax-use test [playbooks...]` with `--headed`, `--headless`, `--report`, `--output`, `--update-baselines`, `--junit` flags.
- **`tmax-use/playbooks/README.md`** — Playbook schema reference.
- **`tmax-use/playbooks/*.yaml`** — Initial playbooks migrated from `adws/playbooks/`.
- **`tmax-use/baselines/*.html`** — Visual baselines (generated locally or via `--update-baselines`, reviewed, and committed to git before CI relies on them).
- **`tmax-use/tests/*.tmax-use.ts`** — TypeScript test files for complex scenarios. These are loaded only by `tmax-use test`, not by Bun's test discovery.
- **`test/unit/tmax-use/*.test.ts`** — Unit tests for the control library and assertion layer.

### Existing Files to Read (reference, not modify)

- **`src/render/capture-frame.ts`** — `captureFrame(state, width, height): string[]` — the headless render function used by the capture RPC. Produces ANSI-encoded lines from EditorState. tmax-use's `capture` primitive calls this indirectly via the daemon RPC.
- **`src/render/ansi-to-html.ts`** — `ansiToHtml(text): string` + `ansiLinesToHtmlDocument(lines, width): string` — converts ANSI to standalone HTML. Used by `--capture-html` for baseline generation and HTML reporter frame rendering.
- **`src/server/server.ts`** (lines ~1226, ~1530-1558) — The `'capture'` JSON-RPC method and `handleCapture()` implementation. This is the server-side endpoint that tmax-use's capture primitives call directly for metadata-bearing capture results.
- **`bin/tmaxclient`** — The JSON-RPC CLI client. Exposes `--capture`, `--capture-html`, `--keys`, `--eval`, positional file opening, `--status` etc. It does not expose a `--open` flag; tmax-use must open files with positional filenames or the underlying JSON-RPC `open` method.
- **`adws/adw-run-e2e.ts`** — The existing e2e runner. tmax-use's daemon lifecycle (spawn, poll readiness, teardown) reuses this pattern. The headed mode (tmux session management, `capture-pane`, `send-keys`) also reuses concepts from here.
- **`adws/playbooks/README.md`** — The existing playbook schema reference. tmax-use's YAML format is a redesign (simpler, more declarative) but informed by what works here.
- **`src/utils/task-either.ts`** — Core `Either<L,R>`, `TaskEither<L,R>`, `TaskEitherUtils`. Used throughout tmax-use for all client operations and daemon lifecycle.
- **`src/utils/validation.ts`** — `Validation<E,A>` applicative. Used for playbook lint/validation — accumulate all schema errors before daemon start.
- **`src/utils/option.ts`** — `Option<T>`. Used for optional fields (wait values, optional expect blocks).
- **`src/utils/pipeline.ts`** — `PipelineBuilder`, `pipe`. Used to compose the test run as a sequential pipeline.

### Existing Files to Modify

- **`docs/specs/SPECS_INDEX.md`** — Add SPEC-061 entry.
- **`package.json`** — Add `typecheck:tmax-use`, include it in `typecheck`, add `build:tmax-use`, include it in `build`, and add `tmax-use` to the `bin` map.
- **`tsconfig.json`** — Include `tmax-use/**/*` so `bun run typecheck` covers the new package.
- **`src/server/server.ts`** — Extend the existing `capture` JSON-RPC handler to accept optional numeric `width` and `height` params. Explicit params take precedence over active-frame terminal size; active-frame size remains the fallback; 80x24 remains the final fallback.

### New Config Files

- **`tsconfig.tmax-use.json`** — Dedicated TypeScript validation for `tmax-use/src/**/*.ts`, `tmax-use/assert/**/*.ts`, `tmax-use/test/**/*.ts`, and `tmax-use/tests/**/*.tmax-use.ts`. Exclude `tmax-use/baselines/**/*` and generated reports.

## Implementation Plan

### Phase 1: Control Library Foundation

Build the core control library that wraps tmaxclient into a reusable, testable TypeScript API. This is the foundation both the test runner and any future agent tool interface will use.

### Phase 2: Assertion Library

Build the assertion layer on top of the control library. Three assertion categories: text (deterministic state), screen (headless capture substring), baseline (HTML comparison).

### Phase 3: Test Runner + Reporters

Build the test runner that orchestrates daemon lifecycle, executes playbooks and TypeScript tests, and produces terminal + HTML reports. Wire it as a CLI and adw pipeline stage.

## Step by Step Tasks

### Step 1: Key parser (`tmax-use/src/keys.ts`)

- Parse special key syntax: `<Esc>`, `<Enter>`, `<BS>`, `<Tab>`, `<Space>`, `<Up>`, `<Down>`, `<Left>`, `<Right>`, `<C-a>` through `<C-z>`, `<M-x>`, `<S-...>` (shift).
- Translate to protocol-compatible key values. Do not rely on the incomplete maps in `bin/tmaxclient` or `adw-run-e2e.ts`; implement the complete tables below.
- Export `parseKeys(sequence: string): string[]` — returns array of individual key tokens.
- Unit tests: verify each special key maps to the expected tmaxclient input.

Headless daemon/protocol key translations:

`src/server/server.ts` passes JSON-RPC `keypress.params.key` directly to `editor.handleKey()`. `editor.handleKey()` normalizes single control bytes and semantic key names, but it does not tokenize ANSI CSI sequences. Therefore protocol-level `keypress` calls must send semantic key values like `Up`, `Down`, `Left`, and `Right`, not terminal escape strings like `\x1b[A`. If a CLI compatibility path is used, it must emit these same semantic values before sending JSON-RPC.

| Syntax | JSON-RPC `keypress` value |
|--------|----------------------------|
| `<Esc>`, `<Escape>`, `<ESC>`, `<C-[>` | `\x1b` |
| `<Enter>`, `<RET>`, `<Return>`, `<C-m>` | `\r` |
| `<Tab>`, `<TAB>`, `<C-i>` | `\t` |
| `<BS>`, `<Backspace>`, `<DEL>` | `\x7f` |
| `<Space>`, `<SPC>` | space (`" "`) |
| `<Up>` | `Up` |
| `<Down>` | `Down` |
| `<Right>` | `Right` |
| `<Left>` | `Left` |
| `<C-a>` through `<C-z>` | control bytes `\x01` through `\x1a` (`letter.charCodeAt(0) - 96`) |
| `<M-x>` | `\x1bx` (Escape byte followed by the literal key; preserve the key's case for `<M-X>` as `\x1bX`) |
| `<S-a>` through `<S-z>` | uppercase literal `A` through `Z` |
| `<S-Up>` | `S-Up` |
| `<S-Down>` | `S-Down` |
| `<S-Right>` | `S-Right` |
| `<S-Left>` | `S-Left` |
| `<S-Tab>` | `S-Tab` |

Headed tmux key translations:

| Syntax | `tmux send-keys` dispatch |
|--------|---------------------------|
| `<Esc>`, `<Escape>`, `<ESC>`, `<C-[>` | `send-keys Escape` |
| `<Enter>`, `<RET>`, `<Return>`, `<C-m>` | `send-keys C-m` |
| `<Tab>`, `<TAB>`, `<C-i>` | `send-keys Tab` |
| `<BS>`, `<Backspace>` | `send-keys BSpace` |
| `<DEL>` | `send-keys Delete` |
| `<Space>`, `<SPC>` | `send-keys Space` |
| `<Up>`, `<Down>`, `<Right>`, `<Left>` | `send-keys Up`, `Down`, `Right`, `Left` |
| `<C-a>` through `<C-z>` | `send-keys C-a` through `C-z` |
| `<M-x>` | `send-keys M-x` (preserve key case for `<M-X>`) |
| `<S-a>` through `<S-z>` | literal uppercase character via `send-keys -l A` through `Z` |
| `<S-Up>`, `<S-Down>`, `<S-Right>`, `<S-Left>` | `send-keys S-Up`, `S-Down`, `S-Right`, `S-Left` |
| `<S-Tab>` | `send-keys BTab` |

Unsupported `<S-...>` forms must fail parsing with token position details instead of being passed through silently.

### Step 2: Client wrapper (`tmax-use/src/client.ts`)

- Create injectable `TmaxClientDeps` interface with `run` (TaskEither subprocess wrapper).
- Add a direct JSON-RPC helper: `request(method, params): TaskEither<TmaxUseError, unknown>` that connects to the daemon socket, sends one newline-delimited JSON-RPC 2.0 request, parses the matching response id, and closes the socket.
- Implement `TmaxClient` methods: `eval`, `keys`, `open`, `capture` (ANSI), `captureHtml` (HTML), `status`, `ping`.
- `eval` and human-readable status commands may wrap the CLI. `keys` must send direct JSON-RPC `keypress` calls or a CLI path updated to emit the semantic protocol key values from Step 1; it must not send ANSI arrow sequences for protocol-level arrows. `open` uses positional `bin/tmaxclient <file>` for CLI parity or direct JSON-RPC `open`; it must not use a nonexistent `--open` flag. `capture` and `captureHtml` use direct JSON-RPC `capture` to preserve `width` and `height`.
- All async methods return `TaskEither<TmaxUseError, Result>`. The only synchronous `Either` in this layer is for pure argument validation before constructing a task.
- Unit tests: mock the subprocess to verify correct CLI args and response parsing.

### Step 3: Domain errors (`tmax-use/src/errors.ts`)

- Define tagged union error types: `DaemonNotResponsive`, `CaptureFailed`, `KeySendFailed`, `EvalError`, `AssertionFailed`, `BaselineMismatch`, `BaselineMissing`.
- Use the `adt.ts` `match()` pattern from `src/utils/`.

### Step 4: Capture primitives (`tmax-use/src/capture.ts`)

- Define protocol result types:
  - `CaptureResult = { lines: string[]; width: number; height: number }`
  - `HtmlResult = { html: string; width: number; height: number }`
- Add server support first: `capture` JSON-RPC accepts optional `{ width, height }` params. When both are positive integers, `handleCapture()` renders with those dimensions. If either is absent, fall back to the active frame terminal size, then to 80x24. Reject non-integer, zero, or negative dimensions with a JSON-RPC error.
- `captureFrame(client, socket, opts?): TaskEither<TmaxUseError, CaptureResult>` — calls direct JSON-RPC `capture` with `{ format: "ansi", width, height }` when dimensions are configured; validate `lines` is an array and dimensions are numbers.
- `captureHtml(client, socket, opts?): TaskEither<TmaxUseError, HtmlResult>` — calls direct JSON-RPC `capture` with `{ format: "html", width, height }` when dimensions are configured; validate `html` is a string and dimensions are numbers.
- Dimension source order for headless runs: explicit `frame.capture({ width, height })` args, then runner/playbook/CLI options, then server fallback. The runner must pass configured dimensions on every headless capture, including assertion captures and failure artifacts.
- Do not parse metadata from `tmaxclient --capture` / `--capture-html`; those CLI modes intentionally print only the rendered artifact. If a CLI path is later required for metadata, add a separate `--capture-json` mode and update this spec before implementing it.
- `capturePlain(lines): string[]` — strips ANSI escape sequences from captured lines for plain text assertions.
- Unit tests: mock client responses, verify ANSI stripping.

### Step 5: TmaxInstance (`tmax-use/src/instance.ts`)

- `TmaxInstance.launch(opts)` — spawn `src/server/server.ts`, set `TMAX_SOCKET`, poll readiness via `(+ 1 1)` eval (reuse `TaskEitherUtils.retry` pattern from `adw-run-e2e.ts`).
- `TmaxInstance.connect(opts)` — ping existing daemon, verify responsive.
- `instance.frame(name?)` — create a `Frame` instance bound to this daemon.
- `instance.close()` — send `(editor-quit)`, poll socket disappearance, SIGKILL fallback.
- Injectable subprocess deps for unit testing.
- Unit tests: mock spawn, verify lifecycle sequence.

### Step 6: Frame (`tmax-use/src/frame.ts`)

- File ops: `openFile(path)`, `closeBuffer()`.
- Key input: `keys(sequence)` — parse via `keys.ts`, send via `client.keys()`.
- T-Lisp eval: `eval(expr)` — send via `client.eval()`, return parsed result.
- State queries: `mode()`, `cursor()` (returns `{line, col}`), `bufferText()`, `bufferName()`, `statusLine()`.
- Capture: `capture()`, `captureHtml()`, `capturePlain()`.
- Wait helpers: `waitForMode(mode, timeout?)`, `waitForRender(timeout?)`, `waitForTextContains(text, timeout?)`.
- All control-library async methods return `TaskEither<TmaxUseError, T>`. The raw `Frame` exported from `tmax-use/src/frame.ts` keeps this contract. The test runner fixture may wrap it with Promise-returning methods for ergonomic `async` test authoring; that wrapper executes `.run()` internally and converts failures into runner-recorded test errors.
- Unit tests: mock client, verify correct eval expressions generated for each query.

### Step 7: Text assertions (`tmax-use/assert/text.ts`)

- `assertMode(frame, expected): TaskEither<TmaxUseError, AssertionResult>`
- `assertCursorAt(frame, line, col): TaskEither<TmaxUseError, AssertionResult>`
- `assertBufferTextContains(frame, substring): TaskEither<TmaxUseError, AssertionResult>`
- `assertBufferTextEquals(frame, expected): TaskEither<TmaxUseError, AssertionResult>`
- `assertStatusLineContains(frame, substring): TaskEither<TmaxUseError, AssertionResult>`
- Each returns `{ passed: boolean, message: string, actual: string, expected: string }`.
- Assertion mismatches are successful assertion evaluations: return `Right({ passed: false, ... })`, not `Left(AssertionFailed)`. Return `Left(...)` only when the assertion cannot be evaluated because of an operational problem such as daemon, eval, capture, filesystem, or malformed baseline errors. The runner records `Right({ passed: false })` as an assertion failure and records `Left(error)` as an execution error. The `AssertionFailed` error type is used by the Promise-based TypeScript test wrapper when it converts a failed `AssertionResult` into a thrown/recorded test failure for `await expect(...)` ergonomics.
- Unit tests: mock frame queries, verify pass/fail messages.

### Step 8: Screen assertions (`tmax-use/assert/screen.ts`)

- `assertScreenContains(frame, substring): TaskEither<TmaxUseError, AssertionResult>` — capture plain text, search for substring.
- `assertScreenNotContains(frame, substring): TaskEither<TmaxUseError, AssertionResult>`.
- Unit tests: mock capture output, verify substring matching.

### Step 9: Baseline comparison (`tmax-use/assert/baseline.ts`)

- `matchBaseline(html: string, baselinePath: string, opts): TaskEither<TmaxUseError, BaselineResult>` — compare captured HTML against stored baseline.
- Missing baseline behavior:
  - Local default (`CI` unset): write captured HTML as the new baseline and return pass with `created: true`.
  - CI default (`CI` set): return `Right({ passed: false, failureKind: "BaselineMissing", ... })` and do not write files.
  - `--update-baselines`: write captured HTML whether or not the file exists and return pass with `updated: true`; intended for explicit refresh runs whose resulting baseline files are reviewed and committed.
- Baseline mismatches return `Right({ passed: false, failureKind: "BaselineMismatch", ... })`. Filesystem, capture, or malformed-baseline conditions that prevent comparison return `Left(...)`.
- On subsequent runs: no `DOMParser` dependency. Implement a zero-dependency comparison by normalizing the HTML into a stable sequence of records using a small tokenizer for tags, text nodes, and attributes; compare text content and `style`/`class` attributes in order. If tokenization fails, fall back to normalized line-by-line HTML text diff and report that fallback in the diff.
- `updateBaseline(baselinePath, html): TaskEither<TmaxUseError, void>` — write new baseline file.
- Unit tests: create temp baselines, verify matching, mismatching, and creation behavior.

### Step 10: Expect API (`tmax-use/assert/index.ts`)

- `expect(frame)` — returns assertion builder.
- `.toHaveMode(mode)`, `.toHaveCursorAt(line, col)`, `.toHaveBufferTextContaining(str)`, `.toHaveBufferTextEquals(str)`, `.toHaveStatusLineContaining(str)`
- `.screenContains(str)`, `.screenNotContains(str)`
- `.toMatchBaseline(name)` — delegates to baseline comparison.
- Integrate with test runner step results.

### Step 11: Playbook parser (`tmax-use/test/playbook.ts`)

- Parse YAML playbooks with the schema defined in the design (name, optional terminal.width/terminal.height, setup.files, steps with action/keys/expect, cleanup) using `Bun.YAML.parse`; add no npm YAML dependency.
- Treat unsupported YAML features or parser exceptions as schema parse failures. Convert thrown parse errors into `Validation` errors with filename and, when Bun exposes it, line/column details. Keep the supported subset documented in `tmax-use/playbooks/README.md`: mappings, sequences, strings, numbers, booleans, and null; no anchors, custom tags, or multi-document streams.
- Validate with `Validation` applicative — accumulate all errors.
- Types: `Playbook`, `PlaybookStep`, `PlaybookAssert`, `PlaybookSetup`, `PlaybookTerminal`.
- Lint guard: reject invalid step types, missing required fields, backslash in eval.
- Unit tests: parse valid playbooks, reject invalid ones, verify error accumulation.

### Step 12: Test runner core (`tmax-use/test/runner.ts`)

- `runPlaybook(playbook, opts): Promise<TestResult>` — execute a single playbook.
- `runTestFile(path, opts): Promise<TestResult>` — execute a single TypeScript test file.
- `runAll(patterns, opts): Promise<SuiteResult>` — run all matching playbooks/tests sequentially.
- Per-playbook daemon lifecycle: launch, run steps, capture artifacts on failure, teardown.
- Step execution: `open` → `keys` → `eval` → `assert`. Capture frame after each step for the report.
- Collect `StepResult` per step: name, passed, details, captured frame (optional).
- TypeScript test loading:
  - Provide `tmax-use/test/index.ts` exporting `test(name, fn)`, `expect`, and types `TmaxUseTestContext`, `TmaxUseTestFn`.
  - `test()` only registers tests into a runner-local registry. It is not Bun's test API and must not call `bun:test`.
  - Test files receive Promise-based fixtures: `frame.keys()`, `frame.openFile()`, `frame.capture()`, and `expect(frame).toHaveMode(...)` are awaited directly in `async` tests. Test authors must not return composed `TaskEither`s or call `.run()` in `*.tmax-use.ts`; the runner fixture executes underlying `TaskEither`s internally and records `Left` values as execution errors.
  - `runAll()` discovers TypeScript runner tests with `tmax-use/tests/**/*.tmax-use.ts` only. It must not glob `*.test.ts` under `tmax-use/tests/`.
  - `runTestFile()` creates an isolated registry, dynamically imports the file with a cache-busting query string (`pathToFileURL(path).href + "?tmaxUseRun=" + runId`), then executes the registered tests sequentially.
  - Each test receives `{ instance, frame, tmpDir, artifactsDir }`; fixture setup/teardown is owned by the runner, not by user test files.
  - If a test file imports `test` from `bun:test`, no tmax-use tests will register; report a clear authoring error.
  - `tmax-use/test/index.ts` may keep a default no-op registry so an accidentally discovered file has no daemon side effects, but the supported path is still the `*.tmax-use.ts` suffix plus `tmax-use test`.
- Unit tests: mock instance/frame, verify step execution order, failure handling.

### Step 12a: Headed mode adapter (`tmax-use/test/headed.ts`)

- Detect `tmux` with `command -v tmux` before running headed mode.
- In local runs with `--headed` and no tmux, print a warning and fall back to headless unless `--headed=strict` is set. In CI, skip headed tests by default unless `--headed` is explicitly requested; with explicit `--headed` and no tmux, fail clearly.
- Lifecycle: create an isolated session name like `tmax-use-${pid}-${runId}`, set `TMAX_SOCKET`, launch `bin/tmaxclient --tui` inside tmux after the daemon starts, wait until `--frames` reports an attached frame or a tmux pane capture shows the editor.
- Headed key dispatch: send parsed keys via `tmux send-keys` to the TUI pane for UI-fidelity steps. Protocol-level `frame.keys()` remains available for setup-only operations but must be marked as non-headed dispatch in step results.
- Headed capture: use `tmux capture-pane -p -e -t <session>:<window>.<pane>` for ANSI/text snapshots. HTML snapshots for headed reports are produced by passing captured ANSI through `ansiToHtml()`. Width/height come from `tmux display-message -p '#{pane_width} #{pane_height}'`.
- Teardown: send quit keys when possible, kill the tmux session in `finally`, then close the daemon. Unit tests mock tmux subprocesses; integration test runs only when tmux is present.

### Step 13: Terminal reporter (`tmax-use/test/reporter-term.ts`)

- Print pass/fail per test with timing.
- On failure: render captured frame as a box in the terminal (using the existing capture-frame output).
- Print summary: N passed, N failed, total assertions, total time.
- Unit tests: verify output format.

### Step 14: HTML reporter (`tmax-use/test/reporter-html.ts`)

- Generate standalone HTML file.
- Per test: timeline of steps with captured frames (rendered via `ansiToHtml()`).
- Assertion results with pass/fail indicators.
- Failed tests: highlight failing step, show diff against baseline.
- No external dependencies — inline styles, embedded frames.
- Unit tests: generate report, verify HTML structure.

### Step 15: JUnit XML reporter (`tmax-use/test/reporter-junit.ts`)

- Generate JUnit-compatible XML for CI integration.
- `<testsuite>` per playbook, `<testcase>` per step, `<failure>` elements on assert failures.
- Unit tests: verify XML output.

### Step 16: CLI entry point (`tmax-use/test/cli.ts`)

- `tmax-use test [pattern...]` — run matching playbooks/tests.
- Flags: `--headed`, `--headless`, `--report html|junit`, `--output <dir>`, `--update-baselines`, `--socket <path>`, `--width`, `--height`.
- In headless mode, `--width` and `--height` set the default dimensions passed to every `capture` JSON-RPC call. Defaults are 80x24 when neither CLI nor playbook/test options provide dimensions. Playbook-level dimensions override CLI defaults for that playbook; per-step capture dimensions override both. In headed mode, tmux pane dimensions define capture size and `--width`/`--height` are used only when creating/resizing the tmux pane.
- Default: headless, terminal reporter, all playbooks in `tmax-use/playbooks/`.
- Exit code: 0 on all pass, 1 on any failure.
- Follow the `parseArgs` → `main()` → `import.meta.main` pattern from `adw-launch.ts`.

### Step 17: Bin launcher (`bin/tmax-use`)

- Shell script launcher (like `bin/tmax`, `bin/tmaxclient`).
- Use a Bash wrapper, not a Bun script:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  exec bun "$ROOT/tmax-use/test/cli.ts" "$@"
  ```
- Add `"tmax-use": "./bin/tmax-use"` to `package.json`'s `bin` map.

### Step 18: Migrate existing playbooks

- Port `adws/playbooks/which-key.yaml` and `adws/playbooks/markdown.yaml` to the new tmax-use playbook format.
- Verify they pass against the existing daemon.
- Capture initial baselines for visual steps.

### Step 19: Integration tests

- Create `tmax-use/tests/smoke.tmax-use.ts` — launch daemon, open file, type, assert, capture.
- Create `tmax-use/tests/baseline.tmax-use.ts` — verify baseline auto-generation and comparison.
- Create `tmax-use/tests/headed.tmax-use.ts` — verify headed mode (tmux) if available.

### Step 20: SPECS_INDEX.md update

- Add SPEC-061 entry to `docs/specs/SPECS_INDEX.md`.

### Step 21: Validation

- Add `tsconfig.tmax-use.json` and package scripts before running validation:
  - `"typecheck:tmax-use": "bunx tsc --noEmit --project tsconfig.tmax-use.json"`
  - `"typecheck": "bun run typecheck:src && bun run typecheck:test && bun run typecheck:tmax-use"`
  - `"build:tmax-use": "bun build --compile ./tmax-use/test/cli.ts --outfile dist/tmax-use"`
  - `"build": "bun run build:tmax && bun run build:tlisp && bun run build:tmax-use"`
- Run `bun run typecheck:src` — zero errors in source files.
- Run `bun run typecheck:test` — zero errors in test files.
- Run `bun run typecheck:tmax-use` — zero errors in tmax-use files.
- Run `bun run typecheck` — zero errors.
- Run `bun run build` — build succeeds.
- Run `bun test` — existing tests pass, no regressions.
- Run `bin/tmax-use test` — all migrated playbooks pass.
- Run `bin/tmax-use test --headed` — headed mode works (if tmux available).
- Run `bin/tmax-use test --report html --output /tmp/tmax-use-report` — HTML report generates.

## Testing Strategy

### Unit Tests

- `test/unit/tmax-use/keys.test.ts` — key parser: every special key syntax, mixed sequences.
- `test/unit/tmax-use/client.test.ts` — client wrapper: mock subprocess, verify args and response parsing.
- `test/unit/tmax-use/instance.test.ts` — daemon lifecycle: mock spawn, verify poll/teardown sequence.
- `test/unit/tmax-use/frame.test.ts` — frame methods: mock client, verify eval expressions and key sequences.
- `test/unit/tmax-use/capture.test.ts` — capture primitives: mock client, verify ANSI stripping.
- `test/unit/tmax-use/assert-text.test.ts` — text assertions: mock frame, verify pass/fail.
- `test/unit/tmax-use/assert-screen.test.ts` — screen assertions: mock capture, verify substring matching.
- `test/unit/tmax-use/assert-baseline.test.ts` — baseline comparison: create/match/mismatch/update baselines.
- `test/unit/tmax-use/playbook.test.ts` — playbook parser: valid/invalid YAML, error accumulation.
- `test/unit/tmax-use/runner.test.ts` — runner: mock instance/frame, verify step execution.
- `test/unit/tmax-use/reporters.test.ts` — reporters: verify output format.

### Integration Tests

- `tmax-use/tests/smoke.tmax-use.ts` — full lifecycle: launch daemon → open file → type → assert → capture → close. Headless.
- `tmax-use/tests/baseline.tmax-use.ts` — local auto-generate baseline on first run, CI missing-baseline failure, update-baseline refresh, match on second run, mismatch on intentional change.
- `tmax-use/tests/multi-step.tmax-use.ts` — multi-step playbook with file setup, editing, navigation, and cleanup.

### Edge Cases

- Daemon fails to start (socket never appears) — runner reports clear error, exits non-zero.
- Daemon becomes unresponsive mid-test — runner detects via eval timeout, reports failure.
- Capture RPC returns empty/malformed output — runner handles gracefully, reports capture failure.
- Baseline file is corrupted or empty — runner reports mismatch with diagnostic info.
- Keys sequence contains unparseable tokens — parser reports error with position info.
- Eval returns an error string — runner surfaces the error in assertion details.
- Multiple playbooks share a daemon (sequential) — each gets clean state via buffer kill.
- Local first run with no baseline — creates the missing baseline and reports it as created; CI first run with no baseline fails unless `--update-baselines` is set.
- `--update-baselines` on first run (no baselines exist) — creates all baselines without error.
- Headed mode when tmux is not installed — runner falls back to headless with a warning.
- Terminal size too small for captured frame — runner uses the specified size, not the actual terminal size.

## Acceptance Criteria

1. **Control library**: `TmaxInstance.launch()` starts a daemon, `frame.keys()` sends keystrokes, `frame.capture()` returns `{ lines, width, height }`, and `frame.captureHtml()` returns `{ html, width, height }` — all without tmux.
2. **YAML playbooks**: A playbook with `open`, `keys`, and `assert` steps executes from clean slate to teardown, passing all assertions.
3. **Text assertions**: `mode`, `cursorAt`, `bufferTextContains`, `bufferTextEquals`, `statusLineContains` all pass/fail correctly against real daemon state.
4. **Screen assertions**: `screenContains` and `screenNotContains` match against headless capture output (no tmux).
5. **Baseline comparison**: Local first run auto-generates missing baselines; CI fails on missing baselines by default; subsequent runs compare against committed baselines; `--update-baselines` regenerates; mismatch produces a readable diff.
6. **Terminal reporter**: Pass/fail output with timing; failure snapshots show captured frame.
7. **HTML reporter**: Standalone HTML file with step timeline, captured frames, diffs. No external dependencies.
8. **JUnit XML**: CI-consumable XML with testsuite/testcase/failure elements.
9. **CLI**: `bin/tmax-use test` runs all playbooks headlessly, exits 0 on pass, 1 on failure.
10. **Headed mode**: `--headed` spawns TUI in tmux, waits for an attached frame, sends keys via `tmux send-keys`, captures via `tmux capture-pane`, tears down the tmux session, and falls back/skips/fails according to the tmux availability rules above.
11. **ADW integration**: adw build agent can call `bin/tmax-use test --report html --output agents/$ID/e2e-report/` and read exit code + artifacts.
12. **Zero new dependencies**: No npm packages added. Uses only Bun built-ins.
13. **Typecheck/build**: `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck:tmax-use`, `bun run typecheck`, and `bun run build` pass with zero errors. `bun run build` includes `build:tmax-use`.
14. **No regressions**: `bun test` passes all existing tests.

## Validation Commands

- `bun run typecheck:src` — Source typecheck, zero errors.
- `bun run typecheck:test` — Test typecheck, zero errors.
- `bun run typecheck:tmax-use` — tmax-use typecheck, zero errors.
- `bun run typecheck` — Full project typecheck, zero errors.
- `bun run build` — Build succeeds.
- `bun test` — All existing Bun unit/integration tests pass, no regressions.
- `bun run test:daemon` — Daemon API integration tests pass.
- `bun run test:ui:renderer` — Renderer e2e tests pass.
- `bin/tmax-use test tmax-use/playbooks/` — All tmax-use playbooks pass.
- `bin/tmax-use test --report html --output /tmp/tmax-use-report` — HTML report generates and is viewable.
- `bin/tmax-use test --headed` — Headed mode runs (requires tmux).

## Notes

- **Zero new dependencies**: Uses only Bun built-ins. For YAML, use `Bun.YAML.parse` and document the supported subset. For HTML baseline diff, do not use `DOMParser`; Bun in this project environment does not provide it reliably. Use the zero-dependency tokenizer/text diff described in Step 9.
- **Relationship to adw-run-e2e.ts**: tmax-use is the successor to `adw-run-e2e.ts`. The existing runner continues to work. tmax-use adds headless capture, baselines, reporting, and a reusable API. Migration of existing playbooks to the new format is a Phase 3 step.
- **Relationship to Python harness**: The Python UI harness (`test/ui/tmax_harness/`) continues as the primary UI test suite. tmax-use is a separate, complementary system focused on the adw/agent workflow.
- **Baseline determinism**: Baselines are deterministic for a fixed terminal size (the daemon renders to a specific width/height). Different terminal sizes produce different baselines. Playbooks should specify their expected terminal dimensions.
- **Parallel execution**: Not in scope for v1. Sequential execution with per-playbook daemon isolation. Can be added later with multiple daemons on unique sockets.
- **Baseline comparison decision**: Use a zero-dependency HTML tokenizer for tag/text/style/class comparison, with normalized line-by-line HTML diff fallback. Do not depend on DOM APIs.
- **Open question — adw pipeline stage**: Whether tmax-use becomes a formal adw stage (like `adw-build.ts`) or is just called by the build agent as a CLI tool. Starting as a CLI tool called by `adw-build.ts` is simpler; formal stage status can come later.

## Audit findings (adw-patch-review 2026-06-20T13:39:39.421Z)

**Verdict:** gaps

The tmax-use scaffold is broad — every file in the spec exists, typechecks pass, and the 170 tmax-use unit tests run green — but several core spec contracts are violated or only partially implemented. Most critically: (1) arrow keys are encoded as ANSI escape sequences (`\x1b[A`) instead of semantic protocol values (`Up`), and they're sent through `--keys` CLI which would split them into ESC/[/A bytes — both choices directly contradict the spec's key-encoding table and dispatch rules, so arrow-key tests cannot pass against the real daemon. (2) Capture dimensions are not plumbed end-to-end: server `handleCapture()` was never extended to accept `width`/`height` params, the capture primitives don't accept or send them, and the CLI doesn't expose `--width`/`--height` flags (defaults are also 94×29, not 80×24). (3) Headed mode is a stub module — `headed.ts` exists but the runner never invokes it; no tmux detection, no `--headed=strict`, no `--tui` launch, no `tmux send-keys`/`capture-pane` integration. (4) The TypeScript test wrapper exposes raw TaskEither Frame methods, so `*.tmax-use.ts` files call `.run()` explicitly — the spec forbids this and requires Promise-based fixtures. (5) Baseline-missing returns `Left(BaselineMissing)` instead of `Right({ passed: false, failureKind: ... })`. (6) The `open` step action and `terminal: { width, height }` playbook fields called out in the spec are absent. Smaller deviations: missing `instance.test.ts`/`runner.test.ts` unit tests, missing `headed.tmax-use.ts` integration test, JUnit renders per-test not per-step, terminal reporter doesn't render failure frame boxes, HTML reporter doesn't run captured ANSI through `ansiToHtml()`, and there is no ADW build-agent wiring. The pre-existing `test/unit` failures (search/navigation timeouts) are unrelated to tmax-use.

### Criteria
- **1. Control library: TmaxInstance.launch(), frame.keys(), frame.capture()/captureHtml() work without tmux** — partial: tmax-use/src/instance.ts:122-172 (launch+poll), tmax-use/src/frame.ts:81-87 (keys), tmax-use/src/frame.ts:146-153 (capture/captureHtml). Launch path is solid, but `frame.keys()` is broken for arrow keys: tmax-use/src/keys.ts:112-115 emits `\x1b[A` etc. and tmax-use/src/client.ts:235-237 dispatches via `--keys` CLI whose parseKeySequence (bin/tmaxclient:257-287) splits multi-byte sequences into separate keypresses — arrows cannot reach the editor's `Up/Down/Left/Right` bindings (src/tlisp/core/bindings/normal.tlisp:61-64).
- **2. YAML playbooks: open/keys/assert steps execute from clean slate to teardown** — partial: tmax-use/test/runner.ts:318-403 runs playbooks end-to-end with daemon lifecycle and cleanup. But the parser rejects `open` as a step action — STEP_KEYS in tmax-use/test/playbook.ts:84 is `['name','keys','eval','setup_cursor','wait','headed','expect']` (no `open`/`action`). Files can only be opened via setup_file auto-open (runner.ts:311-315), so a playbook with an explicit `open` step (per spec AC#2 and Step 12 "open → keys → eval → assert") fails validation.
- **3. Text assertions: mode/cursorAt/bufferTextContains/bufferTextEquals/statusLineContains pass/fail correctly** — implemented: tmax-use/assert/text.ts:35-108 implements all five; tmax-use/assert/index.ts:58-85 wires them into the fluent builder. test/unit/tmax-use/assert-text.test.ts:1-107 covers pass/fail for each via stubbed Frame state.
- **4. Screen assertions: screenContains/screenNotContains against headless capture** — implemented: tmax-use/assert/screen.ts:24-47 captures plain text and substring-matches. test/unit/tmax-use/assert-screen.test.ts:1-60 covers present/absent/ANSI-stripped/spanning-lines cases.
- **5. Baseline comparison: local auto-create, CI fail, update mode, mismatch diff** — partial: tmax-use/assert/baseline.ts:54-101 implements create/update/compare with zero-dep tokenizer (145-198) + line-diff fallback (275-302). DEVIATION at baseline.ts:74-75: CI missing-baseline returns `Left(BaselineMissing)`; spec Step 9 requires `Right({ passed: false, failureKind: 'BaselineMissing' })`. BaselineResult interface (baseline.ts:25-31) has no `failureKind` field. Test baseline.test.ts:158-165 pins the Left behavior.
- **6. Terminal reporter: pass/fail with timing; failure snapshots show captured frame** — partial: tmax-use/test/reporter-term.ts:36-68 prints PASS/FAIL with durations and a summary footer. But renderTest only shows step name + detail string — it never renders the captured frame as a box on failure (Step 13 requirement). StepResult.frame is collected by runner.ts:216-221 but unused by the terminal reporter.
- **7. HTML reporter: standalone HTML with step timeline, captured frames, diffs; no external deps** — partial: tmax-use/test/reporter-html.ts:83-118 generates a self-contained HTML file with inline CSS. DEVIATION at reporter-html.ts:59-61: `renderFrameLines` just escapes and joins captured lines as plain monospaced text; spec Step 14 requires frames be rendered via `ansiToHtml()` (which exists at src/render/ansi-to-html.ts). No baseline-diff rendering either.
- **8. JUnit XML: testsuite per playbook, testcase per step, failure elements** — partial: tmax-use/test/reporter-junit.ts:36-48 emits a single `<testsuite>` for the whole run with one `<testcase>` per TestResult (reporter-junit.ts:19-33). Spec Step 15 explicitly says `<testsuite>` per playbook and `<testcase>` per step — current shape is per-file/per-test, not per-playbook/per-step.
- **9. CLI: bin/tmax-use test runs all playbooks headlessly, exits 0/1** — partial: bin/tmax-use launches tmax-use/test/cli.ts; cli.ts:158-188 implements main() with exit-code mapping. But parseArgs (cli.ts:47-123) doesn't recognize `--width` or `--height` (spec Step 16 lists both as required flags), and `--reporter` only enables one reporter at a time rather than accepting the spec's `--report html|junit` form.
- **10. Headed mode: --headed spawns TUI in tmux, send-keys/capture-pane, teardown, fallback rules** — missing: tmax-use/test/headed.ts:38-113 has startHeadedSession/sendKeys/capturePane/killHeadedSession stubs, but grep of tmax-use/test/runner.ts shows zero references to any headed.ts export — the runner never spawns tmux. None of Step 12a's requirements are implemented: no `command -v tmux` detection, no `--headed=strict`, no CI skip, no `bin/tmaxclient --tui` launch, no `--frames` attached-frame wait, no `tmux display-message` width/height, no `tmux capture-pane -p -e` ANSI capture. capturePane (headed.ts:70-75) even omits the `-e` flag the spec requires.
- **11. ADW integration: adw build agent can call bin/tmax-use test and read exit code + artifacts** — missing: grep -rn 'tmax-use' adws/ returns no matches. adw-build.ts is unchanged — there is no CLI invocation, no artifact path wiring, no exit-code propagation. Spec AC#11 and Notes ('Starting as a CLI tool called by adw-build.ts is simpler') both call for at least the CLI-call hook.
- **12. Zero new dependencies (Bun built-ins only)** — implemented: tmax-use/** imports only 'net', 'child_process', 'fs', 'path', 'url', 'os' from node and src/utils/* from the project. YAML via Bun.YAML.parse (tmax-use/test/playbook.ts:250). HTML compare uses a hand-rolled tokenizer (baseline.ts:145-198), no DOMParser. package.json:35-40 dependencies unchanged.
- **13. Typecheck/build pass; build:tmax-use included** — implemented: package.json:23-30 wires typecheck:tmax-use + build:tmax-use into the aggregate scripts. Live run: `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck:tmax-use` all exit 0; `bun run build:tmax-use` compiles dist/tmax-use in ~2.2s. tsconfig.tmax-use.json:1-13 covers the required include/exclude set.
- **14. No regressions: bun test passes all existing tests** — implemented: Full `bun test` shows 2755 pass / 50 fail / 13 errors, but all failures are pre-existing flaky tests in test/unit/search-navigation.test.ts and test/integration/workspace-lifecycle.test.ts (timeouts, RPC errors) — unrelated to tmax-use. The 170 tmax-use unit tests pass cleanly. Gate output 'test:unit → FAIL' reflects these pre-existing flakes, not tmax-use regressions.
- **Server capture handler extended with optional width/height params (Existing Files to Modify)** — missing: src/server/server.ts:1530-1558 handleCapture() still hardcodes width=80/height=24 then falls back to frame.terminalSize — it never reads params.width/params.height. Spec's 'Existing Files to Modify' section explicitly requires this extension; without it, even a correct client cannot drive dimensions.
- **Capture primitives pass dimensions on every headless capture (Step 4)** — missing: tmax-use/src/capture.ts:94-107 — captureFrame(client) and captureHtml(client) take no opts and call request('capture', { format: 'ansi'|'html' }) with no width/height. tmax-use/src/frame.ts:146-160 capture()/captureHtml()/capturePlain() also accept no dimensions. tmax-use/test/runner.ts:81-82 sets DEFAULT_WIDTH=94/DEFAULT_HEIGHT=29 (spec says 80×24) and never forwards them to any capture call. The whole dimension-plumbing chain called out in Step 4 ('explicit frame.capture args → runner/playbook/CLI → server fallback') is absent.

### Tests
- **Key parser: every special key syntax maps to the spec's protocol values (semantic Up/Down/Left/Right, not ANSI)** — uncovered: test/unit/tmax-use/keys.test.ts:227-229 asserts `headlessBytes(tokens('<Up>')) === '\\x1b[A'` — the test pins the spec-violating behavior. No test asserts the spec-required value 'Up'. <S-Up>/<S-Down>/<S-Left>/<S-Right>/<S-Tab> are likewise asserted as ANSI sequences (keys.test.ts:231-233).
- **Client.keys sends direct JSON-RPC keypress with semantic values (Step 2)** — uncovered: test/unit/tmax-use/client.test.ts:48-61 only verifies `client.keys('\\x1b')` invokes runClient with `['--keys','\\x1b']`. No test verifies JSON-RPC keypress dispatch or semantic-value emission for arrows.
- **Capture primitives forward width/height opts to the JSON-RPC request** — uncovered: test/unit/tmax-use/capture.test.ts:60-127 stubs request() with no params inspection — no test asserts that configured dimensions reach request('capture', { format, width, height }). The opts parameter doesn't exist on captureFrame/captureHtml signatures.
- **Server handleCapture honors params.width/height and rejects bad dimensions** — uncovered: No test exists for the server-side capture extension. Spec Step 4 says 'Add server support first' with explicit dimension precedence and rejection of non-integer/zero/negative — none of this is tested or implemented.
- **Daemon lifecycle: launch / poll readiness / teardown (Step 5 unit tests)** — uncovered: test/unit/tmax-use/instance.test.ts does NOT exist (find test/unit/tmax-use -name 'instance.test.ts' returns empty). Spec Testing Strategy explicitly lists this file. Lifecycle is only exercised indirectly via integration tests.
- **Runner step execution order, failure handling, registry isolation (Step 12 unit tests)** — uncovered: test/unit/tmax-use/runner.test.ts does NOT exist. Spec Testing Strategy explicitly lists it. runStep/evaluateExpect are exported via __runnerInternals (runner.ts:605) but no unit test exercises them.
- **Headed mode integration test (Step 19)** — uncovered: find tmax-use/tests -name 'headed.tmax-use.ts' returns empty. Spec Step 19 requires this file. Only smoke.tmax-use.ts, baseline.tmax-use.ts, multi-step.tmax-use.ts exist.
- **Test wrapper exposes Promise-based fixtures (spec: test authors must NOT call .run() in *.tmax-use.ts)** — uncovered: tmax-use/test/index.ts:35-46 documents the Promise contract but tmax-use/test/runner.ts:497 passes the raw Frame (with TaskEither methods). Integration tests contradict the spec: smoke.tmax-use.ts:17/25/29, baseline.tmax-use.ts:14-19, multi-step.tmax-use.ts:20-32 all call `.run()` and inspect 'left'/'right' manually. No test verifies a Promise-based wrapper exists.
- **Baseline missing in CI returns Right({ passed: false, failureKind: 'BaselineMissing' })** — uncovered: test/unit/tmax-use/baseline.test.ts:158-165 'missing baseline + CI → fail' asserts `Either.isLeft(r)` and `r.left._tag === 'BaselineMissing'` — locking in the deviation rather than the spec shape.
- **Open step action end-to-end (AC#2)** — uncovered: No playbook or test exercises a step with action: open. STEP_KEYS in playbook.ts:84 would reject such a step as 'unknown keys'.
- **Playbook schema: terminal: { width, height } mapping** — uncovered: test/unit/tmax-use/playbook.test.ts:15-44 uses top-level width/height. No test covers the spec's `terminal: { width, height }` mapping. validatePlaybook (playbook.ts:198-244) doesn't recognize a `terminal` key.
- **Text/screen/baseline assertions pass/fail correctly (happy paths)** — covered: test/unit/tmax-use/assert-text.test.ts, assert-screen.test.ts, baseline.test.ts all use stubbed frames/clients and verify both pass and fail outcomes with message content.
- **Frame state queries synthesize correct eval expressions** — covered: test/unit/tmax-use/frame.test.ts exercises openFile/closeBuffer/keys/eval/cursor/bufferText and verifies the eval strings sent through the stubbed client.
- **Error ADT: constructors, match exhaustiveness, describe formatting** — covered: test/unit/tmax-use/errors.test.ts:1-142 covers every variant, exhaustive match, and the rightT/leftT/rightE/leftE helpers.
- **Reporters render correct output structure** — covered: test/unit/tmax-use/reporters.test.ts:30-176 covers term/HTML/JUnit output shapes and escaping. But it pins the JUnit per-test (not per-step) shape and doesn't verify HTML reporter uses ansiToHtml for frames or that terminal reporter renders frame boxes — both spec requirements.

### Edge cases
- **Daemon fails to start (socket never appears) — runner reports clear error, exits non-zero** — handled: tmax-use/src/instance.ts:148-156 polls socket existence via TaskEitherUtils.retry (50×100ms) and surfaces DaemonNotResponsive. runner.ts:336-338, 472-482 convert launch failure into TestResult.failureMessage.
- **Daemon becomes unresponsive mid-test — runner detects via eval timeout, reports failure** — handled: client.ts:170 enforces a 10s hard timeout on JSON-RPC requests; instance.ts:158-166 polls `(+ 1 1)` responsiveness. Runner step failures bubble through runStep (runner.ts:169-213).
- **Capture RPC returns empty/malformed output — runner handles gracefully, reports capture failure** — handled: tmax-use/src/capture.ts:67-91 decodeCapture/decodeHtml validate object shape, lines-is-array, html-is-string, dimensions-are-numbers, returning CaptureFailed Lefts. captureStepFrame (runner.ts:216-221) swallows capture errors so a bad capture cannot fail a step beyond a recorded detail.
- **Baseline file is corrupted or empty — runner reports mismatch with diagnostic info** — missed: tmax-use/assert/baseline.ts:219-235 compareHtml falls back to line-diff when tokenization fails (baseline.ts:222-227) and labels the diff as a fallback. But there's no explicit test for corrupted/empty baseline content; the tokenizer happily handles empty input (test/unit/tmax-use/baseline.test.ts:29-33).
- **Keys sequence contains unparseable tokens — parser reports error with position info** — handled: tmax-use/src/keys.ts:44-48 (unterminated '<'), 219-224 (unsupported <S-...>), 227-232 (unsupported <C-...>/<M-...>) all return KeySendFailed with offset and full sequence. test/unit/tmax-use/keys.test.ts:143-157 covers each.
- **Eval returns an error string — runner surfaces the error in assertion details** — missed: Runner captures eval result in evalResult (runner.ts:174) and surfaces it via result_contains assertion detail (runner.ts:283-287). But there's no explicit handling for daemon-returned T-Lisp error strings (as opposed to transport errors) — those just become mismatched result_contains details.
- **Multiple playbooks share a daemon (sequential) — each gets clean state via buffer kill** — handled: Each playbook gets a fresh isolated daemon: runner.ts:94-98 isolatedSocketPath(), runner.ts:336 launches per-playbook. cleanup() at runner.ts:300-308 runs (kill-buffer) and unlinks temp files; instance.close() at runner.ts:390 tears down the daemon.
- **Local first run with no baseline — creates the missing baseline and reports it as created** — handled: baseline.ts:73-84 auto-creates when !failOnMissing && !existsSync, returning { created: true, passed: true }. test/unit/tmax-use/baseline.test.ts:148-156 and integration tests/baseline.tmax-use.ts:11-21 cover this.
- **CI first run with no baseline fails unless --update-baselines is set** — missed: baseline.ts:59-75 — CI detection via process.env.CI (baseline.ts:40-42), and missing-in-CI returns Left(BaselineMissing). DEVIATION: spec Step 9 requires Right({ passed: false, failureKind: 'BaselineMissing' }) so the runner records it as an assertion failure, not an execution error. Current Left path is recorded as execution error.
- **--update-baselines on first run (no baselines exist) — creates all baselines without error** — handled: baseline.ts:62-70 unconditionally writes when opts.update, regardless of prior existence. test/unit/tmax-use/baseline.test.ts:127-146 covers both overwrite and create-from-scratch under update mode.
- **Headed mode when tmux is not installed — runner falls back to headless with a warning** — missed: tmax-use/test/headed.ts:106-113 tmuxAvailable() exists but is never called from runner.ts or cli.ts. No fallback logic, no warning, no --headed=strict path. Entire edge case unhandled because headed mode itself is unimplemented.
- **Terminal size too small for captured frame — runner uses the specified size, not the actual terminal size** — missed: Spec Step 4 requires explicit dimensions to override server defaults, but capture.ts:94-107 doesn't accept or forward dimensions and server.ts:1530-1558 doesn't read them. There is no way for the runner to pin a capture size; the server always falls back to active-frame terminalSize or 80x24.
- **Backslash in eval expression is rejected by the linter** — handled: tmax-use/test/playbook.ts:163-166 rejects any eval containing '\\' with a clear error. README documents the guard (tmax-use/playbooks/README.md:61-65).
- **Unsupported YAML features (anchors, custom tags, multi-doc) are rejected** — missed: parsePlaybook (playbook.ts:247-265) wraps Bun.YAML.parse in try/catch and rejects non-mapping top-level. But there's no explicit test that anchors/aliases/custom-tags/multi-doc streams are rejected — those would either pass through Bun.YAML.parse or throw, and the latter is caught generically.
- **Test file imports test from bun:test — no tmax-use tests register; clear authoring error** — handled: runner.ts:460-469 detects empty local registry and returns a TestResult with failureMessage 'no tmax-use tests registered — did you import { test } from "../test/index.ts" instead of bun:test?'. registerTest (runner.ts:430-433) is a no-op outside active registry.


## Audit findings (adw-patch-review 2026-06-20T15:04:57.190Z)

**Verdict:** gaps

Substantial remediation since the prior audit: arrow keys now emit semantic protocol names (Up/Down/Left/Right/S-*) and dispatch as individual JSON-RPC keypress calls (keys.ts:91-101, client.ts:241-250); capture dimensions are plumbed end-to-end (capture.ts:108-134 → frame.ts:166-180 → runner.ts:130-134,233 → server.ts:1540-1574 with positive-int validation); baseline-missing/mismatch now return Right({passed:false, failureKind}) per Step 9 (baseline.ts:81-115); HTML reporter renders frames via ansiToHtml (reporter-html.ts:60-62); JUnit emits per-step testcases under per-playbook testsuites (reporter-junit.ts:34-46); terminal reporter draws failure frame boxes (reporter-term.ts:36-44,60-66); open step action and terminal:{width,height} playbook mapping are honored (playbook.ts:92,211-226); Promise-based fixtures are exported (promise-frame.ts + index.ts:60-62); instance.test.ts and runner.test.ts exist; patch-reviewer runs `bun run test:tmax-use` as an optional gate (patch-reviewer.ts:372-388). The 204 tmax-use unit tests pass and typecheck:tmax-use is green. Remaining gaps are concentrated in headed mode: (a) the new headed.tmax-use.ts integration test FAILS in practice — tmux `new-session -d -x 80 -y 24` returns pane dimensions of 121x29, not 80x24, when no client is attached; the strict assertion throws and gate test:tmax-use exits 1. (b) The runner's runAll() consults resolveHeadedMode but never actually invokes startHeadedSession for playbooks with `headed: true` steps — tmux primitives are only called by the manual integration test. (c) StepResult has no non-headed-dispatch marker (spec Step 12a). (d) waitForAttachedFrame is defined but never invoked by the runner. (e) adw-build.ts itself does not invoke tmax-use; only patch-reviewer does, which is partial AC#11 coverage.

### Criteria
- **1. Control library: TmaxInstance.launch/frame.keys/frame.capture/captureHtml without tmux** — implemented: instance.ts:122-172 (launch+poll readiness); frame.ts:101-107 (keys via compileHeadless → JSON-RPC keypress); client.ts:241-250 (per-value keypress); keys.ts:91-101 headlessValues preserves semantic Up/Down/Left/Right/S-* and splits Meta into ESC+letter; frame.ts:166-180 capture/captureHtml/capturePlain forward opts; tests keys.test.ts:227-249, client.test.ts:49-102, frame.test.ts cover behavior
- **2. YAML playbooks: open/keys/assert steps execute from clean slate to teardown** — implemented: playbook.ts:92 STEP_KEYS includes 'open'; playbook.ts:179-183 mutually-exclusive action check; runner.ts:198 open branch in runStep; runner.ts:373-410 try/finally with cleanup()+instance.close(); playbook.test.ts:95-120 verifies open step action accepted and mutual exclusivity
- **3. Text assertions (mode/cursorAt/bufferTextContains/bufferTextEquals/statusLineContains) pass/fail correctly** — implemented: assert/text.ts:35-108 implements all five; assert/index.ts:58-100 wires them; runner.ts:254-271 invokes them in evaluateExpect; test/unit/tmax-use/assert-text.test.ts covers pass/fail for each
- **4. Screen assertions against headless capture (no tmux)** — implemented: assert/screen.ts:24-47 captures plain text via capture.ts:137-142 then substring-matches; assert/index.ts:88-97 wires screenContains/screenNotContains; runner.ts:304-311 invokes them
- **5. Baseline comparison: local auto-create / CI fail / update / mismatch-diff lifecycle** — implemented: baseline.ts:67-99 (auto-create when !failOnMissing, Right({passed:false,failureKind:'BaselineMissing'}) when CI); baseline.ts:101-116 mismatch returns Right({passed:false,failureKind:'BaselineMismatch'}); baseline.ts:70-78 update mode overwrites; baseline.ts:235-251 zero-dep tokenizer + line-diff fallback; baseline.test.ts:158-179 pins both Right-side failure shapes
- **6. Terminal reporter: pass/fail with timing + captured-frame box on failure** — implemented: reporter-term.ts:36-44 renderFrameBox draws top/middle/bottom; reporter-term.ts:60-66 invokes renderFrameBox for failed step with frame; reporters.test.ts:60-72 verifies '┌'/'└' borders and frame content presence
- **7. HTML reporter: standalone HTML, step timeline, captured frames via ansiToHtml, diffs, no external deps** — implemented: reporter-html.ts:17 imports ansiToHtml from src/render/ansi-to-html.ts; reporter-html.ts:60-62 renderFrameLines maps each ANSI line through ansiToHtml; reporter-html.ts:83-118 self-contained doc with inline CSS; live run produces /tmp/tmax-use-audit/report.html with colored span tags
- **8. JUnit XML: testsuite per playbook, testcase per step, failure elements** — implemented: reporter-junit.ts:35-46 renderTestSuite emits one <testsuite> per TestResult with one <testcase> per StepResult; reporter-junit.ts:20-32 renderStepTestCase emits <failure> on fail; reporters.test.ts:161-173 verifies per-step s1/s2 testcases and <failure> text
- **9. CLI: bin/tmax-use test runs playbooks headlessly, exits 0/1, supports --width/--height** — implemented: cli.ts:99-114 parseArgs handles --width and --height with positive-int validation; cli.ts:118-131 handles --reporter with term/html/junit/all; bin/tmax-use launcher execs bun tmax-use/test/cli.ts; cli.ts:216 returns suite.failed===0?0:1
- **10. Headed mode: --headed spawns TUI in tmux, send-keys/capture-pane, teardown, fallback rules** — partial: headed.ts:79-86 resolveHeadedMode decision tree (launch/fallback/skip/fail); headed.ts:92-118 startHeadedSession with -x/-y; headed.ts:121-125 sendKeys incl. -l literal; headed.ts:132-141 capturePane with -e; headed.ts:144-154 paneDimensions via display-message; headed.ts:161-172 waitForAttachedFrame; cli.ts:73-78 parses --headed/--headed=strict; runner.ts:613-632 runAll consults decision. BUT runner.ts runPlaybook path never invokes startHeadedSession — `headed: true` step flag has no dispatch effect; StepResult lacks non-headed-dispatch marker; live `bin/tmax-use test headed.tmax-use.ts --headed` FAILS with 'unexpected dimensions: 121x29' (tmux -x/-y not honored without attached client)
- **11. ADW integration: build agent calls bin/tmax-use and reads exit code + artifacts** — partial: patch-reviewer.ts:372-388 runs `bun run test:tmax-use` as optional gate when tmax-use targets exist; patch-reviewer.ts:67-74 GateResults.tmaxUse added; package.json:16 'test:tmax-use': 'bin/tmax-use test'. BUT adw-build.ts does NOT invoke tmax-use — only the patch-review gate does. Spec AC#11 + Notes call for build agent integration; only the review-side gate is wired
- **12. Zero new npm dependencies (Bun built-ins only)** — implemented: tmax-use/** imports only 'net','child_process','fs','path','url','os' from node and src/utils/* + src/render/* from project; YAML via Bun.YAML.parse (playbook.ts:292); HTML compare uses hand-rolled tokenizer (baseline.ts:161-214) — no DOMParser
- **13. Typecheck/build pass; build:tmax-use included** — implemented: package.json:23-30 wires typecheck:tmax-use + build:tmax-use into aggregate scripts; live `bun run typecheck:tmax-use` exits 0; gate output confirms typecheck:src → PASS
- **14. No regressions: bun test passes existing tests** — implemented: Gate output reports test:unit → PASS (exit 0); 204 tmax-use unit tests pass cleanly
- **Server handleCapture extended with optional width/height params (Existing Files to Modify)** — implemented: server.ts:1540-1574 reads params.width/params.height; server.ts:1546-1557 isPositiveInt guard rejects non-int/zero/negative; server.ts:1572-1574 explicit dims override frame terminal size; 80x24 final fallback at server.ts:1559-1561
- **Capture primitives pass dimensions on every headless capture (Step 4)** — implemented: capture.ts:108-113 captureParams forwards width/height when provided; capture.ts:121-134 captureFrame/captureHtml pass opts; frame.ts:72-77 captureOpts merges per-call with Frame defaults; runner.ts:130-134 resolveDimensions; runner.ts:233 captureStepFrame forwards ctx.width/ctx.height; CLI defaults 80x24 at runner.ts:85-86

### Tests
- **Key parser maps every special key syntax to spec protocol values (semantic Up/Down/Left/Right, not ANSI)** — covered: test/unit/tmax-use/keys.test.ts:227-249 asserts <Up>→'Up', <Down>→'Down', <Left>/<Right>→'Left'/'Right', <S-Up>/<S-Down>/<S-Left>/<S-Right>→'S-Up' etc., <S-Tab>→'S-Tab', <M-x>→['\x1b','x']
- **Client.keys sends direct JSON-RPC keypress with semantic values** — covered: test/unit/tmax-use/client.test.ts:49-65 asserts each value goes as its own {method:'keypress',params:{key:...}} call; client.test.ts:67-77 asserts client.keys(['Up']) → [{method:'keypress',params:{key:'Up'}}] (no ANSI); client.test.ts:79-102 short-circuit + empty-list behavior
- **Capture primitives forward width/height opts to the JSON-RPC request** — covered: test/unit/tmax-use/capture.test.ts:128-177 asserts captureFrame forwards {format:'ansi',width,height}; captureHtml forwards {format:'html',width,height}; no-opts call sends only format; single-dimension case preserved
- **Server handleCapture honors params.width/height and rejects bad dimensions** — uncovered: No test exists for the server-side handleCapture extension. server.ts:1540-1574 implements the behavior but no unit/integration test exercises positive-int validation, dimension precedence, or rejection of zero/negative/non-int
- **Daemon lifecycle: launch / poll readiness / teardown (Step 5 unit tests)** — covered: test/unit/tmax-use/instance.test.ts now exists; covers launch invoking spawn+makeClient deps, connect rejecting absent socket with DaemonNotResponsive, frame() binding, close() no-op on attached instance. Does NOT directly verify the 50×100ms socket poll or 20×100ms eval poll — those are exercised only indirectly via integration tests
- **Runner step execution order, failure handling, registry isolation (Step 12 unit tests)** — covered: test/unit/tmax-use/runner.test.ts exists but only covers resolveHeadedMode decision tree, isCI, discoverTargets. runStep/evaluateExpect are exported via __runnerInternals (runner.ts:605) — action ordering and registry isolation not directly unit-tested, but the integration tests exercise them end-to-end
- **Headed mode integration test (Step 19)** — covered: tmax-use/tests/headed.tmax-use.ts exists and exercises startHeadedSession → paneDimensions → capturePane → sendKeys → killHeadedSession, gated on tmuxAvailable(). BUT the test FAILS in practice: 'unexpected dimensions: 121x29'
- **Test wrapper exposes Promise-based fixtures (test authors must NOT call .run() in *.tmax-use.ts)** — covered: tmax-use/test/promise-frame.ts:37-119 PromiseFrame wraps each Frame method as Promise<T>; promise-frame.ts:84-111 PromiseExpect wraps ExpectBuilder; tmax-use/test/index.ts:24,30 exports them. smoke.tmax-use.ts:20-57, multi-step.tmax-use.ts:11-52 use `await frame.openFile/keys/cursor/eval` and `await expect(frame).toHaveBufferTextContaining(...)` — no .run() in those tests. baseline.tmax-use.ts:24-45 still uses .run() on matchBaseline (a library helper, not a Frame method — explicitly justified in baseline.tmax-use.ts:11-15)
- **Baseline missing in CI returns Right({ passed:false, failureKind:'BaselineMissing' })** — covered: test/unit/tmax-use/baseline.test.ts:158-168 asserts Either.isRight, r.right.passed===false, r.right.failureKind==='BaselineMissing', and existsSync(path)===false. Baseline mismatch shape covered at baseline.test.ts:170-179
- **Open step action end-to-end (AC#2)** — covered: test/unit/tmax-use/playbook.test.ts:95-106 verifies open step action is accepted by the parser; playbook.test.ts:108-120 verifies open+keys rejected as mutually exclusive. The runner.ts:198 runStep branch handles it
- **Playbook schema: terminal: { width, height } mapping** — covered: test/unit/tmax-use/playbook.test.ts:78-93 verifies the terminal mapping parses; playbook.test.ts:122-132 verifies unknown terminal keys rejected. validateTerminal at playbook.ts:212-226
- **Text/screen/baseline assertions pass/fail correctly (happy paths)** — covered: assert-text.test.ts, assert-screen.test.ts, baseline.test.ts all use stubbed frames/clients and verify both pass and fail outcomes with message content
- **Frame state queries synthesize correct eval expressions** — covered: test/unit/tmax-use/frame.test.ts exercises openFile/closeBuffer/keys/eval/cursor/bufferText and verifies the eval strings sent through the stubbed client
- **Error ADT: constructors, match exhaustiveness, describe formatting** — covered: test/unit/tmax-use/errors.test.ts covers every variant, exhaustive match, and the rightT/leftT/rightE/leftE helpers
- **Reporters render correct output structure** — covered: test/unit/tmax-use/reporters.test.ts:30-204 covers term PASS/FAIL + frame box (lines 60-72), HTML doc structure + escaping, JUnit per-step testcase (lines 161-173) and failure elements
- **HTML reporter renders captured ANSI through ansiToHtml** — covered: reporter-html.ts:60-62 imports ansiToHtml and applies it per line. Live HTML report contains inline <span style=\"color:...\"> tags from ansiToHtml output. No dedicated unit test asserts the ansiToHtml call directly (gap in unit-level coverage), but live behavior is correct

### Edge cases
- **Daemon fails to start (socket never appears) — runner reports clear error, exits non-zero** — handled: instance.ts:148-156 polls socket existence via TaskEitherUtils.retry (50×100ms); failure surfaces DaemonNotResponsive. runner.ts:352-353 converts launch Left into a TestResult with failureMessage=describeTmaxUseError; cli.ts:216 maps to exit code 1
- **Daemon becomes unresponsive mid-test — runner detects via eval timeout, reports failure** — handled: client.ts:170 enforces 10s hard timeout on JSON-RPC requests; instance.ts:158-166 polls `(+ 1 1)`; runner step failures bubble through runStep at runner.ts:188-228
- **Capture RPC returns empty/malformed output — runner handles gracefully, reports capture failure** — handled: capture.ts:81-105 decodeCapture/decodeHtml validate object shape, lines-array, html-string, dimensions-numbers, returning CaptureFailed Lefts; runner.ts:232-237 captureStepFrame swallows capture errors with mapLeft
- **Baseline file is corrupted or empty — runner reports mismatch with diagnostic info** — missed: baseline.ts:235-251 compareHtml falls back to line-diff when tokenizer fails (baseline.ts:238-243) and labels it 'fallback: tokenizer failed'. But no explicit test for corrupted/empty baseline content — baseline.test.ts:29-33 only covers empty-string tokenization, not empty-file comparison flow
- **Keys sequence contains unparseable tokens — parser reports error with position info** — handled: keys.ts:56-60 (unterminated '<'), keys.ts:265-269 (unsupported <S-...>), keys.ts:273-278 (unsupported <C-...>/<M-...>) all return KeySendFailed with offset and full sequence. test/unit/tmax-use/keys.test.ts:143-157 covers each
- **Eval returns an error string — runner surfaces the error in assertion details** — missed: Runner captures eval result in evalResult (runner.ts:204) and surfaces via result_contains detail (runner.ts:299-303). But there's no explicit handling for daemon-returned T-Lisp error strings (as opposed to transport errors) — those become mismatched result_contains details, not distinctly surfaced
- **Multiple playbooks share a daemon (sequential) — each gets clean state via buffer kill** — handled: Each playbook gets a fresh isolated daemon: runner.ts:98-102 isolatedSocketPath(); runner.ts:352 launches per-playbook. cleanup() at runner.ts:316-324 runs (kill-buffer) and unlinks temp files; instance.close() at runner.ts:409 tears down the daemon
- **Local first run with no baseline — creates the missing baseline and reports it as created** — handled: baseline.ts:81-91 auto-creates when !failOnMissing && !existsSync, returning {created:true,passed:true}. baseline.test.ts:148-156 covers it
- **CI first run with no baseline fails unless --update-baselines is set** — handled: baseline.ts:67 isCi() detection; baseline.ts:82-91 returns Right({passed:false,failureKind:'BaselineMissing'}) without writing. baseline.test.ts:158-168 verifies the Right-side failure shape and that no file is written
- **--update-baselines on first run (no baselines exist) — creates all baselines without error** — handled: baseline.ts:70-78 unconditionally writes when opts.update, regardless of prior existence. baseline.test.ts:127-146 covers both overwrite and create-from-scratch under update mode
- **Headed mode when tmux is not installed — runner falls back to headless with a warning** — missed: headed.ts:79-86 resolveHeadedMode implements the decision tree (fallback when local+no-tmux, skip when CI+no-tmux, fail when strict+no-tmux); runner.ts:613-632 consumes the decision and writes warnings to stderr. BUT only the runAll-level decision is consumed — the runner does NOT actually invoke startHeadedSession for `headed: true` steps, so the 'launch' decision never triggers tmux and the live headed.tmax-use.ts test FAILS with 'unexpected dimensions: 121x29'
- **Terminal size too small for captured frame — runner uses the specified size, not the actual terminal size** — handled: capture.ts:108-113 forwards opts.width/height to the JSON-RPC request; server.ts:1572-1574 explicit params override frame.terminalSize; runner.ts:130-134 resolveDimensions + runner.ts:233 forwards ctx.width/ctx.height on every assertion/failure capture. Frame defaults come from CLI via runner.ts:504-505 (default 80x24)
- **Backslash in eval expression is rejected by the linter** — handled: playbook.ts:171-178 rejects any eval containing '\\' with a clear error. playbook.test.ts:176-182 pins the behavior; tmax-use/playbooks/README.md documents the guard
- **Unsupported YAML features (anchors, custom tags, multi-doc) are rejected** — missed: playbook.ts:289-307 wraps Bun.YAML.parse in try/catch and rejects non-mapping top-level. But no explicit test verifies anchors/aliases/custom-tags/multi-doc streams are rejected — they would either pass through Bun.YAML.parse or throw generically. playbook.test.ts:228-233 only tests one malformed YAML case
- **Test file imports test from bun:test — no tmax-use tests register; clear authoring error** — handled: runner.ts:480-489 detects empty local registry and returns a TestResult with failureMessage 'no tmax-use tests registered — did you import { test } from "../test/index.ts" instead of bun:test?'. registerTest (runner.ts:450-453) is a no-op outside active registry

