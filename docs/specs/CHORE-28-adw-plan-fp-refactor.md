# Chore: refactor `adw-plan.ts` + `agent.ts` to stricter functional paradigm

## Chore Description

Refactor `adws/adw-plan.ts` and `adws/adws-modules/agent.ts` to follow the functional programming conventions established in `rules/functional-programming.md` and the FP utility library in `src/utils/`.

The current code uses `Either` for return types but the rest is imperative: `Promise`-returning functions, `async/await` with manual `if Either.isLeft` branching, interleaved `logState()` side effects, bare `try/catch` blocks, and manual `_tag` checks on discriminated unions.

This chore introduces a new FP utility module (`adt.ts`) and migrates both files to use:

1. **`TaskEither`** instead of `Promise<Either<...>>` — lazy, composable, chainable
2. **`flatMap` chain** instead of the early-return cascade in `main()` — single composed pipeline with automatic error short-circuiting
3. **Inline event accumulation** — lifecycle events accumulated in a `PipelineInput.events[]` array carried through the pipeline, flushed to disk once at the end via `writeLog()`
4. **ADT pattern matching** (`match`) — exhaustive, type-safe handling of `DispatchOutcome`
5. **`Either.tryCatch`** — explicit error wrapping for JSON parse and sync I/O

> **Architectural pivot (from plan):** The original plan specified `Writer` monad / `WriterTaskEither` for event logging and `PipelineBuilder` for the pipeline. During implementation, WriterT was abandoned in favor of carrying `events[]` inline in the pipeline context — simpler, type-safe, and avoids the id-recovery problem (the pipeline discarded the id via `.map(() => undefined)`). `PipelineBuilder` was replaced by direct `TaskEither.flatMap()` chaining for the same reason: the pipeline is a single linear chain, not a branching workflow, so the builder adds indirection without benefit. `writer.ts` was still created as a general-purpose utility.

### Paradigm exclusions (per analysis)

The following paradigms were analyzed and explicitly excluded as "not worth it" or "overkill":

- **Free Monad** — `AgentDeps` DI already achieves testability; a free monad adds indirection without practical benefit
- **IO Monad** — redundant with `TaskEither` in a JS runtime where effects can't be prevented at the type level
- **CPS / `callCC`** — `TaskEither.flatMap` short-circuiting already handles early exit; `callCC` is too confusing in TS
- **Generic Traversable** — the `map → sequence` pattern appears once; a generic traverse is overkill
- **Semigroupoid** — abstract type-level composition primitives have no concrete use in this codebase

### Performance impact

**Runtime: immeasurably small.** `TaskEither` wraps each step in an extra closure + `Promise`. For 5-6 pipeline steps this is <1μs of overhead. The real work is spawning `claude` subprocesses (25s–4min). `PipelineBuilder` creates an intermediate object per `.step()` — a handful of allocations, <1KB total.

**Memory: negligible.** Lifecycle events are buffered in a `PipelineInput.events[]` array carried through the pipeline (~5 events × ~200 bytes = 1KB) and written to disk once at the end. This is a net reduction in I/O (one write instead of five).

**Composability: significantly improved.** Every pipeline step is independently testable by providing mock `AgentDeps`. The imperative version requires monkeypatching `process`, `fs`, or `spawn`.

## Relevant Files

Use these files to resolve the chore:

### New Files

- **`src/utils/writer.ts`** — `Writer<W, A>` monad: accumulates log entries of type `W` alongside a value `A`. Provides `tell`, `pure`, `flatMap`, `map`, `listen` (extract value + log), and a `WriterT` variant that stacks on top of `TaskEither` for async effectful writers.

- **`src/utils/adt.ts`** — ADT pattern matching helper: a generic `match` function that takes a discriminated union and an exhaustive cases object, guaranteeing all tags are handled at compile time (via `never` return on unhandled keys). Also includes `bimap` for `Either` (map both sides simultaneously).

### Existing Files to Modify

- **`adws/adw-plan.ts`** — Major refactor:
  - `run()` / `runCapture()`: return `TaskEither<string, string>` instead of `Promise<Either<string, string>>` (lazy, composable)
  - `logState()`: return `TaskEither<string, void>` wrapping sync `fs` calls in `tryCatch` (was bare `try/catch` + `void` return)
  - `parseArgs()`: return `Either<string, ParsedArgs>` → then lift to `TaskEither` at pipeline entry (already correct, just need consistent usage)
  - `ensureClaude()`: become a `TaskEither` composition (`.map`/`.mapLeft` on the `run` result, no `async/await`)
  - `main()`: replace the early-return cascade with a `PipelineBuilder` chain. The pipeline carries `{ id, description, forcedType? }` and chains through ensureClaude → classify → dispatch → result formatting. Writer events are accumulated alongside the pipeline via `WriterT TaskEither`.
  - Replace `if/outcome.kind === "noop"` branching with `match(outcome, { created, modified, noop })`.

- **`adws/adws-modules/agent.ts`** — Moderate refactor:
  - `classify()`: return `TaskEither<string, ClassifyResult>` instead of `Promise<Either<...>>`. Wrap JSON.parse in `Either.tryCatch`.
  - `dispatch()`: return `TaskEither<string, DispatchOutcome>` instead of `Promise<Either<...>>`. Wrap `parseSkillResult` in `Either.tryCatch`. Use `Option` for `diffSpecsDir` return instead of `null`.
  - `snapshotSpecsDir()`: wrap inner `statSync` in `Either.tryCatch` (replacing bare `catch { /* skip */ }`).
  - `parseSkillResult()`: wrap in `Either.tryCatch` (replacing bare `try/catch` returning `null`).

### Existing Files to Read (reference, not modify)

- **`src/utils/task-either.ts`** — canonical `Either`, `Task`, `TaskEither` definitions
- **`src/utils/pipeline.ts`** — `PipelineBuilder`, `pipe.start`, `pipe.from`
- **`src/utils/effect.ts`** — `Effect<R, E, A>` (reference for dependency injection patterns)
- **`src/utils/option.ts`** — `Option<T>` (to use for nullable returns)
- **`rules/functional-programming.md`** — the FP conventions this chore enforces
- **`docs/specs/CHORE-25-adw-plan-dispatcher.md`** — original spec; behavior contract must be preserved exactly
- **`docs/specs/CHORE-26-adw-agent-module.md`** — extraction spec; the DI contract (`AgentDeps`) must be preserved

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Task 1 — Create `src/utils/writer.ts`

Create a `Writer<W, A>` monad and a `WriterTaskEither<W, E, A>` variant.

The pure `Writer`:
- `tell(entry: W): Writer<W, void>` — append a log entry
- `pure(value: A): Writer<W, A>` — succeed with a value and empty log
- `flatMap(fn: (a: A) => Writer<W, B>): Writer<W, B>` — chain, concatenating logs
- `map(fn: (a: A) => B): Writer<W, B>` — transform value, preserving log
- `listen(): [A, W[]]` — extract both value and accumulated log

The `WriterTaskEither<W, E, A>` (Writer stacked on TaskEither):
- `tellW(entry: W): WriterTaskEither<W, E, void>` — append a log entry inside a TaskEither context
- `fromTaskEither(te: TaskEither<E, A>): WriterTaskEither<W, E, A>` — lift a TaskEither (empty log)
- `liftWriter(w: Writer<W, A>): WriterTaskEither<W, E, A>` — lift a pure Writer into the effectful context
- `flatMap`, `map`, `mapLeft`, `tap`, `tapError` — standard TaskEither operations that preserve the log
- `listen(): TaskEither<E, [A, W[]]>` — extract value + log
- Static helpers: `succeed`, `fail`, `tryCatch`

This is the core utility the pipeline will use to accumulate `logState` events without doing I/O mid-flow.

- Verify: `bunx tsc --noEmit src/utils/writer.ts` passes clean.

### Task 2 — Create `src/utils/adt.ts`

Create ADT pattern matching and `bimap` utilities:

- `match<D extends { _tag: string }, R>(value: D, cases: MatchCases<D, R>): R` — exhaustive match on `_tag` discriminant. The `cases` type requires a handler for every variant of `D` (enforced by `& { [K in Exclude<keyof Cases, _tag>]: never }`). Missing a case is a compile-time error.
- `matchPartial<D extends { _tag: string }, R>(value: D, cases: Partial<Cases>): Option<R>` — non-exhaustive match returning `Option`.
- `bimap<L, R, L2, R2>(f: (l: L) => L2, g: (r: R) => R2, e: Either<L, R>): Either<L2, R2>` — map both sides of an Either.

- Verify: `bunx tsc --noEmit src/utils/adt.ts` passes clean.

### Task 3 — Refactor `adws/adws-modules/agent.ts`

Migrate agent.ts to stricter FP:

1. **`classify()`**: change return type from `Promise<Either<string, ClassifyResult>>` to `TaskEither<string, ClassifyResult>`. Wrap `JSON.parse(res.right)` in `Either.tryCatch`. Remove `async/await` — return `TaskEither` directly.

2. **`snapshotSpecsDir()`**: wrap inner `statSync` call in `Either.tryCatch`. Return `Either<string, Map<string, number>>` or keep the current `Map` return but make the inner `statSync` explicit about skipping failures via `Either.isLeft`.

3. **`diffSpecsDir()`**: change return type from `{ created: string | null; modified: string | null }` to use explicit `Option` or keep the current shape but eliminate the nested `try/catch`.

4. **`parseSkillResult()`**: wrap in `Either.tryCatch` instead of bare `try/catch`. Return `Either<string, SkillResult>` instead of `SkillResult | null`.

5. **`dispatch()`**: change return type from `Promise<Either<string, DispatchOutcome>>` to `TaskEither<string, DispatchOutcome>`. Chain `parseSkillResult` via `flatMap`. Remove `async/await`.

6. **`AgentDeps.run` and `AgentDeps.runCapture`**: update the interface types to accept `TaskEither` returns (the caller will pass `run`/`runCapture` that now return `TaskEither`).

- Verify: `bunx tsc --noEmit adws/adws-modules/agent.ts` passes clean.
- Verify: `rg -n 'Promise<Either' adws/adws-modules/agent.ts` returns zero matches.
- Verify: `rg -n 'async ' adws/adws-modules/agent.ts` returns zero matches.

### Task 4 — Refactor `adws/adw-plan.ts` — `run()`, `runCapture()`, `ensureClaude()`

1. **`run()`**: return `TaskEither<string, string>` instead of `Promise<Either<string, string>>`. Wrap the `spawn` + Promise constructor in `TaskEither.from()`. This makes it lazy and composable.

2. **`runCapture()`**: same treatment — return `TaskEither<string, string>`. Uses sync `appendFileSync` for the tee-to-file (intentional: incremental writes must survive crashes, sync is fine for line-at-a-time). The try/catch around `appendFileSync` is intentional — protecting a non-critical I/O side-effect.

3. **`logState()`**: **removed entirely.** Replaced by `writeLog(id, events)` that takes the accumulated events array and writes once at the end of the pipeline.

4. **`ensureClaude()`**: become a `TaskEither` composition: `run("command", ["-v", "claude"]).map(() => undefined).mapLeft(() => "The claude CLI was not found...")`.

- Verify: `bunx tsc --noEmit adws/adw-plan.ts` passes clean.
- Verify: `rg -n 'Promise<Either' adws/adw-plan.ts` — matches only inside `TaskEither.from(async () => ...)` wrappers (expected).

### Task 5 — Refactor `adws/adw-plan.ts` — `main()` to TaskEither pipeline

Replace the early-return cascade in `main()` with a composed `TaskEither.flatMap` chain:

```typescript
const program = TaskEither
  .right({ id: adwId(), description, forcedType, events: [...] })
  .flatMap((ctx) => ensureClaude().map(() => ctx))
  .flatMap((ctx) => /* classify or use forcedType */)
  .flatMap((ctx) => /* dispatch → match outcome */)
  .flatMap((ctx) => /* writeLog + format output */);

return program.run().then(/* fold result → exit code */);
```

The pipeline carries `PipelineInput` (with `events[]` array) through each step. Events are accumulated in memory (pure data) and flushed to disk once at the end via `writeLog()`.

Replace `if/outcome.kind === "noop"` branching with `match(outcome, { created: ..., modified: ..., noop: ... })`.

> **Note:** `logState()` was removed entirely — replaced by the single `writeLog(id, events)` call at the end of the pipeline.

- Verify: `rg -n 'async function main' adws/adw-plan.ts` returns zero matches (main is no longer async — it calls `program.run().then(...)`).
- Verify: the pipeline compiles with the correct types flowing through each step.

### Task 6 — Run `Validation Commands`

Run every command in the Validation Commands section. All must pass with zero errors.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `bun run typecheck` — zero TypeScript errors across the project (includes `src/utils/writer.ts`, `src/utils/adt.ts`, `adws/`).
- `bun adws/adw-plan.ts --help` — prints usage to stdout, exit 0.
- `bun adws/adw-plan.ts` — prints usage to stderr, exit 1.
- `bun adws/adw-plan.ts --feature "test" --bug "test"` — prints "Pass at most one" error to stderr, exit 1.
- `PATH=/usr/bin:/bin bun adws/adw-plan.ts "x"` — prints claude dependency error to stderr, exit 1, no `agents/` dir.
- `rg -n 'Promise<Either' adws/adw-plan.ts adws/adws-modules/agent.ts` — zero matches in agent.ts; adw-plan.ts may have matches inside `TaskEither.from(async () => ...)` wrappers (this is expected — the inner Promise is the effect that TaskEither wraps).
- `rg -n 'async function' adws/adws-modules/agent.ts` — zero matches (no async/await in agent.ts).
- `rg -n 'try \{' adws/adw-plan.ts adws/adws-modules/agent.ts` — zero matches in agent.ts; adw-plan.ts may have matches in `runCapture` for best-effort tee-to-file (intentional — protecting non-critical I/O, not wrapping logic).
- `rg -n 'logState' adws/adws-modules/agent.ts` — zero matches (agent.ts never logs state).
- `rg -n 'import.*task-either' adws/adw-plan.ts adws/adws-modules/agent.ts` — at least one match per file.
- `rg -n 'import.*adt' adws/adw-plan.ts` — at least one match (DispatchOutcome matched via match()).

## Notes

**Why inline event accumulation instead of Writer monad.** The original plan used `WriterT TaskEither` for event logging. During implementation, this was abandoned in favor of carrying an `events[]` array in the pipeline context object (`PipelineInput`). Reasons: (a) WriterT wraps the value type in `[A, W[]]`, making every `.flatMap` unwrap/re-wrap tedious; (b) the pipeline's final step discards the id via `.map(() => undefined)`, creating an id-recovery problem for the log write; (c) the inline approach is simpler, equally type-safe, and produces the same outcome (one batch write at the end). The `writer.ts` utility was still created as a general-purpose module for future use.

**Why direct flatMap chain instead of PipelineBuilder.** The pipeline eliminates the 5 sequential `if (Either.isLeft(...)) return` blocks in `main()`. Errors short-circuit automatically through `flatMap`. The `main()` pipeline is a single linear chain (ensureClaude → classify → dispatch → result), so direct `.flatMap()` chaining reads top-to-bottom and types flow naturally. `PipelineBuilder` would add value for branching/parallel workflows, but for a straight chain it's indirection without benefit.

**Why TaskEither instead of Promise<Either>.** `TaskEither` is lazy — the wrapped function doesn't execute until `.run()` is called. This makes every step composable: you can `map`, `flatMap`, `zip` without `await`. It also means the pipeline builds a *description* of the computation that can be inspected, tested (by providing mock deps), or restructured — all before execution.

**Why PipelineBuilder instead of manual flatMap chaining.** The pipeline eliminates the 5 sequential `if (Either.isLeft(...)) return` blocks in `main()`. Errors short-circuit automatically through `flatMap`. The builder reads top-to-bottom like a spec: step 1, step 2, step 3. A nested `flatMap` chain reads inside-out and requires tracking indentation.

**Performance summary.** The refactoring adds ~0.1ms of total overhead (closure allocation + Promise wrapping for 5-6 pipeline steps) against a program that takes 25s–4min per run (waiting for `claude` subprocesses). Memory overhead is ~1KB (Writer event buffer). There are no N+1 patterns, no additional subprocess calls, and no new I/O paths. The I/O count actually *decreases*: one state-file write at the end instead of five writes during execution.

**Behavior contract preserved.** Exit codes (0/1/2), stdout shape (`<adw-id> <spec-path>` or `<adw-id> -`), stderr diagnostics, `agents/{adw-id}/adw-state.json` format, `planner/raw-output.jsonl` capture — all unchanged per CHORE-25. This is a pure structural refactor.
