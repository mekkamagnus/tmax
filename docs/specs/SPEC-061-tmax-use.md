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
