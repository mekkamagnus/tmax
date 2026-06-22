# Chore: Performance Benchmark Harness (RFC-019 Phase 0)

## Chore Description

Build a benchmark harness that measures tmax's per-keystroke hot-path performance so that every subsequent RFC-019 performance fix can show a real before/after number. This is **Phase 0** of [RFC-019](../rfcs/RFC-019-performance-audit.md) — the prerequisite that unblocks measurement-driven optimization.

**Why this is a build, not an optimization:** The codebase currently has zero throughput benchmarks. The only perf-shaped test (`test/unit/tail-call-performance.test.ts`) is a stack-overflow check, not a throughput measurement. Every claim in RFC-019 is static analysis. Before touching `src/core/buffer.ts` or any other hot path, we need a reproducible harness that can be run before-and-after each fix.

**Scope:**
- Three isolated microbenchmarks that exercise the three hottest code paths identified in RFC-019:
  1. **Buffer edit throughput** — `FunctionalTextBufferImpl.insert` / `delete` on large files (exercises Tier 1.1–1.3: incremental lines, offset cache, array clone).
  2. **T-Lisp eval throughput** — `interpreter.execute` of repeated small commands (exercises Tier 2.3: parse cache, Tier 2.6: tokenizer regexes).
  3. **End-to-end keystroke throughput** — `tmaxclient --keys` through a live daemon (exercises the full keystroke path: RPC serialize, buffer edit, viewport re-tokenize, repaint).
- A small `bench` runner script with a stable output format (ops/sec + estimated bytes/op + wall time) that can be diffed across runs. Do not claim real heap allocation unless the implementation adds a concrete Bun-compatible allocation measurement; for this chore, `bytesPerOp` is an input/response-size estimate.
- Three fixture files of representative sizes (small/medium/large) for the buffer and end-to-end benchmarks.
- Registration of `bun run bench` in `package.json`.
- The harness must be deterministic (fixed seed, fixed input order, no GC noise from warmup) and self-validating (each microbenchmark asserts a sane floor — e.g. buffer insert on a 10k-line file completes in under N ms — so silent regressions fail loudly).

**Non-goals:**
- No benchmarking of cold-path subsystems (file IO, search, syntax highlighting in isolation) — those get their own microbenchmarks in later CHOREs once Tier 1 lands.
- No browser/Ink/Steep frontend benchmarks — TUI path only.
- No external benchmarking library (mitata, tinybench, etc.) — tmax is zero-deps by project principle. Use `Bun.nanoseconds()` / `performance.now()` directly.

## Relevant Files
Use these files to resolve the chore:

**Existing code — reuse these patterns:**
- `test/unit/tail-call-performance.test.ts` — Existing perf-shaped test using `bun:test`. Demonstrates the project's convention for perf tests (it asserts behavior, not throughput — this chore extends the pattern to measure throughput). Use as the style template.
- `src/core/buffer.ts:242-416` — `FunctionalTextBufferImpl`. The class under test for Microbenchmark 1. The `insert` (`:284`) and `delete` (`:307`) methods are the targets.
- `src/tlisp/interpreter.ts:149-198` — `TLispInterpreterImpl.execute` / `executeAsync`. The function under test for Microbenchmark 2.
- `tmax-use/src/client.ts` + `tmax-use/src/instance.ts` — Existing daemon-control layer that starts/stops a tmax daemon and drives it over the socket. **Reuse for Microbenchmark 3** rather than reinventing daemon lifecycle.
- `bin/tmax` + `bin/tmaxclient` — The daemon and client launchers Microbenchmark 3 will exercise end-to-end.

**Existing tests — verify they still pass after the harness lands (no production code changes expected):**
- `test/unit/buffer.test.ts` — Buffer correctness suite; must still pass unchanged.
- `test/unit/editor.test.ts` — Editor correctness suite; must still pass.

### New Files
- `bench/bench.ts` — The runner. Reads a benchmark name from `argv`, dispatches to the matching microbenchmark module, prints results in a stable text format, exits non-zero if any floor assertion fails. Lives under a new top-level `bench/` directory (mirrors how `tmax-use/` and `adws/` live at the repo root as standalone harnesses).
- `bench/micro-buffer.ts` — Microbenchmark 1: buffer edit throughput. Loads each fixture file, performs N inserts/deletes at a moving cursor position, measures wall time + ops/sec. Three sizes.
- `bench/micro-tlisp.ts` — Microbenchmark 2: T-Lisp eval throughput. Evaluates the same small command (`(vim-reset-pending)` style) N times and measures evals/sec.
- `bench/micro-e2e.ts` — Microbenchmark 3: end-to-end daemon keystroke throughput. Starts a daemon via `tmax-use/src/instance.ts`, opens a fixture, sends N keys via `tmax-use/src/client.ts`, measures keystrokes/sec and estimated bytes-per-keystroke over the socket.
- `bench/fixtures/small.txt`, `bench/fixtures/medium.txt`, `bench/fixtures/large.txt` — Three fixture files. Small: ~500 lines / ~20 KB. Medium: ~5k lines / ~200 KB. Large: ~10k lines / ~1 MB. Generated at chore time, deterministic content (numbered, fixed-width ASCII lines padded to the target line length) so the fixtures are reproducible from a generator script rather than committed as opaque blobs.
- `bench/fixtures/generate.ts` — The generator script for the three fixtures. Idempotent; safe to re-run.
- `bench/output.ts` — Small shared module: result type + stable text output formatter (one row per benchmark-size combination: `name | size | ops/sec | bytes/op | wall_ms | floor | pass/fail`).
- `test/unit/bench-harness.test.ts` — Unit test that imports the pure harness modules and asserts (a) buffer and T-Lisp microbenchmarks return well-formed result objects, (b) the floor assertion helper triggers correctly when given an injected slow result. Do not start a real daemon in this unit test; live end-to-end validation belongs to `bun run bench`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Create the `bench/` directory and shared output module
- Create `bench/output.ts` exporting a `BenchResult` type: `{ name: string; size: "small" | "medium" | "large"; opsPerSec: number; bytesPerOp: number; wallMs: number; floorMs: number; passed: boolean }`. `bytesPerOp` means estimated input/response bytes per operation, not measured heap allocation.
- Export a `formatResults(results: BenchResult[]): string` that renders the table described above with fixed-width columns, a `summarize(results: BenchResult[]): { passed: number; failed: number }` helper, and an `assertFloor(result: Omit<BenchResult, "passed">): BenchResult` helper that sets `passed` from `wallMs <= floorMs`. Tests can exercise floor failures by passing a deliberately slow injected result to `assertFloor`; they should not slow down real workloads.
- Keep it dependency-free: only `Bun.nanoseconds()` for timing.

### Build the fixture generator
- Create `bench/fixtures/generate.ts`. It writes `small.txt` (500 lines × ~40 bytes/line), `medium.txt` (5000 lines × ~40 bytes/line), and `large.txt` (10000 lines × ~100 bytes/line) into `bench/fixtures/`, producing approximately 20 KB / 200 KB / 1 MB respectively. Each line is deterministic, plain ASCII, and fixed-width, e.g. `"Line " + zeroPadded(i) + " " + repeated filler + "\n"`; avoid escapes that complicate the tokenizer.
- Make it idempotent: if a fixture's line count already matches, leave it untouched.
- Run it once to materialize the fixtures; commit them.

### Build Microbenchmark 1: buffer edit throughput (`bench/micro-buffer.ts`)
- Export `runBufferBench(size: "small" | "medium" | "large"): BenchResult`.
- Load the fixture text, construct `FunctionalTextBufferImpl.create(content)`.
- Perform N=1000 edits: alternate insert (`"X"` at end of line i % lineCount) and delete (the same range just inserted). This is the workload the RFC-019 Tier 1 fixes target — each edit currently triggers `toString()` + `splitLines()` over the whole buffer.
- Measure wall time with `Bun.nanoseconds()`; compute ops/sec and estimated bytes/op via `content.length`.
- Set `floorMs` per size based on a baseline measurement taken **during this chore** (the baseline becomes the regression floor — see Notes). For the initial commit, the floor is whatever the current code measures at, rounded up by ~20% to allow for CI variance. Document the baseline in `bench/README.md`.
- Assert `wallMs <= floorMs` and set `passed` accordingly.

### Build Microbenchmark 2: T-Lisp eval throughput (`bench/micro-tlisp.ts`)
- Export `runTLispBench(_size: "small" | "medium" | "large"): BenchResult` (size is ignored for the eval benchmark; same command set regardless — keep the parameter for uniform dispatch).
- Construct `new TLispInterpreterImpl()` (the editor runtime).
- Evaluate the same command 10,000 times: `(progn (setq "x" (+ 1 1)) x)` — representative of the kind of small repeated command the keystroke path fires (cf. `src/editor/handlers/normal-handler.ts:48`). Use the quoted variable name because `setq` is an eager builtin in the current interpreter.
- Measure evals/sec. Set the floor based on the baseline measured during this chore.
- Note: this benchmark will improve when RFC-019 Tier 2.3 (parse cache) lands. It exists now to give Tier 2 work a measurable target.

### Build Microbenchmark 3: end-to-end daemon keystroke throughput (`bench/micro-e2e.ts`)
- Export `runE2EBench(size: "small" | "medium" | "large"): BenchResult`.
- Use `tmax-use/src/instance.ts` to start a fresh daemon in a temp dir, and `tmax-use/src/client.ts` to open the fixture file and send N=200 keystrokes (a mix of cursor moves and character inserts).
- Measure wall time, keystrokes/sec, and estimated bytes-per-keystroke (capture bytes sent over the socket if exposed by the client, else estimate via the serialized response size).
- Clean up the launched daemon in a `finally` block by calling `TmaxInstance.close()` on the instance returned by `TmaxInstance.launch()`. Do not rely on `bin/tmax --stop`: the benchmark may use a custom temp socket, while the launcher stop command defaults to `TMAX_SOCKET` or `/tmp/tmax-uid/server`.
- Set the floor based on the baseline measured during this chore.

### Build the runner (`bench/bench.ts`)
- Parse CLI usage as `bench <name> [small|medium|large]`, where `<name>` is `"buffer"`, `"tlisp"`, `"e2e"`, `"all"` (default), or `"--help"`. `process.argv[2]` is the benchmark name and `process.argv[3]` is the optional size.
- For `"all"` without a size, run all three microbenchmarks across all three sizes and print the combined table. For `"all" [size]`, run all three microbenchmarks for that size only. For a single benchmark without a size, run it across all three sizes. For a single benchmark with a size, run exactly that row (e.g. `bun run bench buffer medium`).
- On an unknown benchmark name or invalid size, print usage to stderr and exit non-zero. `--help` prints usage to stdout and exits zero.
- Exit non-zero if any result has `passed === false`.
- Exit zero on success and print the table to stdout.
- Keep the runner minimal — no fancy CLI framework, just `process.argv` parsing.

### Register the `bench` npm script
- Add `"bench": "bun run bench/bench.ts"` and `"bench:all": "bun run bench/bench.ts all"` to `package.json` `scripts`. Place them near the existing `test:*` scripts.
- Add `"typecheck:bench": "bunx tsc --noEmit --project tsconfig.bench.json"` to `package.json` and include it in the top-level `"typecheck"` script.
- Add `tsconfig.bench.json` extending `tsconfig.json` with `include: ["bench/**/*.ts"]`. This must typecheck `bench/bench.ts` and `bench/fixtures/generate.ts` directly; relying on imports from `test/unit/bench-harness.test.ts` is not sufficient.

### Write the harness unit test
- Create `test/unit/bench-harness.test.ts`.
- Import `runBufferBench`, `runTLispBench`, `formatResults`, `summarize`, and `assertFloor`. Do not import or run `runE2EBench` from this unit test unless its daemon/socket dependencies are mocked or stubbed; the live daemon path is covered by `bun run bench`.
- Assert buffer and T-Lisp microbenchmarks return a `BenchResult` with all required fields populated and `opsPerSec > 0`.
- Assert `formatResults` returns a non-empty string containing the benchmark name and size.
- Assert `summarize` correctly counts pass/fail when given a mixed result set.
- Assert `assertFloor` sets `passed: false` when given an injected result with `wallMs > floorMs` and `passed: true` when `wallMs <= floorMs`.
- Do NOT assert absolute timings here — those vary by machine and belong in the harness floors, not the unit test.

### Document the harness in `bench/README.md`
- New file. Explain: what each microbenchmark measures, how to run (`bun run bench`), how to interpret the output table, the floor concept (regression detection), and how to update floors when an optimization intentionally raises throughput (re-run, set new floor, commit).
- Record the initial baseline numbers measured during this chore for each microbenchmark × size.

### Run the Validation Commands
- Execute every command in the Validation Commands section, top to bottom, and confirm each passes with zero errors before declaring the chore complete.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run typecheck:src` — Confirm no TypeScript errors after the harness files are added.
- `bun run typecheck:test` — Confirm `test/unit/bench-harness.test.ts` typechecks alongside the rest of the test suite.
- `bun run typecheck:bench` — Confirm every new `bench/**/*.ts` entrypoint typechecks directly, including `bench/bench.ts` and `bench/fixtures/generate.ts`.
- `bun run typecheck` — Full typecheck (src + test + tmax-use + bench).
- `bun test test/unit/bench-harness.test.ts` — The harness unit test passes; all shape assertions succeed.
- `bun test test/unit/buffer.test.ts` — Existing buffer correctness tests still pass unchanged (no production code changes in this chore).
- `bun run bench` — The harness runs end to end without errors, prints the result table, and exits 0. Verify all 9 rows (3 microbenchmarks × 3 sizes) are present and each shows `passed`.
- `bun run bench buffer medium` — Single-benchmark single-size invocation works and exits 0.
- `bun run bench tlisp` — T-Lisp microbenchmark runs in isolation.
- `bun run bench --help` — Prints usage and exits 0.

## Notes

- **This chore makes NO production code changes.** Every file under `src/` stays untouched. The harness measures the current state; it does not optimize anything. Optimization is CHORE-34 and the subsequent Tier 1b/2/3 CHOREs.
- **Floor setting is the trickiest part.** Take the baseline measurement on the development machine during this chore, then round the floor *up* by ~20% to absorb CI/machine variance. Document the baseline in `bench/README.md` so future contributors can re-baseline on faster hardware. A floor that's too tight will flap; too loose will miss regressions.
- **Determinism matters more than absolute numbers.** Use a fixed edit pattern, fixed seed (if any randomness), and skip the first ~50 ops as warmup before measuring. The harness should produce roughly the same `ops/sec` on consecutive runs (±5%) on the same machine.
- **The end-to-end microbenchmark (Microbenchmark 3) is the most valuable.** It exercises the full keystroke path and will show the biggest movement when the RFC-019 Tier 1 fixes land. The isolated buffer and T-Lisp microbenchmarks exist to attribute that movement to specific subsystems.
- **Reuse `tmax-use/` for daemon control.** `tmax-use/src/instance.ts` and `tmax-use/src/client.ts` already manage daemon lifecycle and socket RPC. Do not reinvent this in `bench/micro-e2e.ts` — import and reuse.
- **No external benchmarking libraries.** tmax is zero-deps by project principle (`AGENTS.md` Project Overview). Use `Bun.nanoseconds()` for timing and write the result formatting in `bench/output.ts` by hand. This keeps the harness consistent with the rest of the codebase and avoids a new dependency in `package.json`.
- **Why `bench/` at the repo root.** Mirrors the layout of `tmax-use/` (e2e test runner) and `adws/` (adw pipeline) — standalone harnesses that aren't part of the shipped editor. Keeps `test/` reserved for correctness tests.
