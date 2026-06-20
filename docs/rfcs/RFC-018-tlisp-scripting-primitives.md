# RFC-018: T-Lisp Scripting Primitives — Closing the adw-Orchestrator Gap

**Date:** 2026-06-19
**Status:** Proposed
**Author:** Mekael Turner

**Motivating artifact:** [`adws/adw-plan-reviewspec-build.ts`](../../adws/adw-plan-reviewspec-build.ts) and its subprocesses (`adw-plan.ts`, `adw-spec-review.ts`, `adw-build.ts`, `adws-modules/{agent,reviewer,builder}.ts`)
**Depends on:** [RFC-016](RFC-016-tlisp-common-lisp-parity.md) (shared scripting stance: no Roswell equivalent — this RFC extends T-Lisp's *existing* scripting surface, not a new distribution model)
**Aligned with:** `src/tlisp/Claude.md` (T-Lisp ownership), [technical-vision.md](../technical-vision.md), `rules/functional-programming.md` (error handling idiom)

## Table of Contents
- [Abstract](#abstract)
- [Motivation](#motivation)
- [The Reference Pipeline](#the-reference-pipeline)
- [What T-Lisp Has Today](#what-t-lisp-has-today)
- [Gap Tiers](#gap-tiers)
- [Phase 1: Tier 1 — Hard Blockers + FP Foundations](#phase-1-tier-1--hard-blockers--fp-foundations)
- [Phase 2: Tier 2 — Subprocess Fidelity](#phase-2-tier-2--subprocess-fidelity)
- [Phase 3: Tier 3 — Ergonomic Parity](#phase-3-tier-3--ergonomic-parity)
- [Explicitly Out of Scope (Tier 4)](#explicitly-out-of-scope-tier-4)
- [Architecture Constraints](#architecture-constraints)
- [Alternatives Considered](#alternatives-considered)
- [Open Questions](#open-questions)
- [Design Decisions](#design-decisions)

---

## Abstract

This RFC proposes a tiered set of small, well-scoped primitive additions to T-Lisp so that scripts equivalent to the TypeScript `adws/` orchestrator can be written in T-Lisp. It is **not** a general-purpose scripting overhaul. The guiding question for every inclusion is: **does a concrete, in-repository orchestration script need this?**

The reference artifact — `adw-plan-reviewspec-build.ts` — is a three-stage subprocess pipeline (plan → spec-review → build) with crash-survivable event logging, a workspace-state file, a stdout-contract protocol between stages, and dependency-injected subprocess execution for testability. Of its ~12 building blocks, T-Lisp already provides roughly half. **Three small missing primitives — `append-file`, `json-encode`, and `command-line-args` — are the entire difference between "cannot port at all" and "feasible port."** The remaining gaps are fidelity and ergonomics, addressed in later tiers.

The highest-priority work is three thin builtins, each ~10–40 lines of TypeScript, mirroring existing primitives' shapes. None requires a new value type, a new special form, or an evaluator change.

## Motivation

### Why this matters now

The `adws/` directory is TypeScript today, but it is pure orchestration logic — arg parsing, id minting, append-only event logs, subprocess spawning, stdout-contract parsing, monadic error threading. Per the project's Lisp-first architecture (`AGENTS.md` § Architecture, `src/tlisp/Claude.md`), **all higher-level editor logic belongs in T-Lisp**. The adw orchestrator is exactly the kind of logic that should eventually be T-Lisp, both for editor integration (M-x `adw-run`) and for user extensibility (custom pipeline stages, custom reviewers).

Today it cannot be ported. Not because of deep language-design gaps, but because three primitives are missing. This RFC scopes those primitives and the rest of the gap in tiers, so the work can be sequenced and the port (if/when desired) can be planned against concrete milestones.

### Why tier it

The same logic as [RFC-016](RFC-016-tlisp-common-lisp-parity.md): don't ship a scripting subsystem, ship the smallest set that closes a real gap, and defer everything speculative. A reviewer of each tier should be able to answer "does the adw orchestrator (or a realistic near-term orchestrator) need this?" with a yes.

## The Reference Pipeline

`adw-plan-reviewspec-build.ts` is a 378-line orchestrator. Its building blocks, recurring across all four `adws/*.ts` files:

| # | Building block | TS implementation |
|---|---|---|
| 1 | Arg parsing | `parseArgs(process.argv.slice(2))`, flag/value validation → `Either<string, Args>` |
| 2 | ULID-timestamp id | encode `Date.now()` → 10-char Crockford Base32 |
| 3 | Append-only event log | `mkdirSync(recursive)` + `appendFileSync(events.jsonl, JSON.stringify({ts,…})+"\n")` |
| 4 | State file | async `mkdir` + `writeFile(adw-state.json, JSON.stringify(state,null,2))` |
| 5 | Subprocess spawn | `spawn("bun",[script,…args],{env:{ADW_ORCHESTRATED:"1"}})`, capture stdout, inherit stderr |
| 6 | Streaming tee | `runCapture` writes child stdout line-by-line to a file as it arrives |
| 7 | Stdout-contract parsing | `tokensOf()` splits last non-empty line, validates token count |
| 8 | Monadic composition | `TaskEither.right().tap().flatMap().mapLeft()`, Left short-circuits |
| 9 | DI seam | `PipelineDeps`/`AgentDeps`/`CodexDeps` inject `run`/`runCapture` so tests mock without spawning |
| 10 | ADT dispatch | `match(outcome, {created/modified/noop})` |
| 11 | Project-root resolution | `realpathSync(join(import.meta.dir, ".."))` |
| 12 | Exit-code contract | `process.exit(0|1|2)`; stdout = machine-readable, stderr = human progress |

The three subprocess children (`adw-plan.ts`, `adw-spec-review.ts`, `adw-build.ts`) share the same skeleton — blocks 1–4, 6, 8, 12 — and each adds one LLM-interface module (`adws-modules/agent.ts`, `reviewer.ts`, `builder.ts`) that owns a `claude`/`codex` invocation and parses its stream-json result line.

## What T-Lisp Has Today

Verified against source (`src/tlisp/stdlib.ts`, `src/tlisp/io-ops.ts`, `src/tlisp/sys-ops.ts`, `src/editor/api/file-ops.ts`, `src/editor/tlisp-api.ts`, `src/tlisp/async.ts`):

| Capability | T-Lisp primitive | Source |
|---|---|---|
| Error recovery | `condition-case` | `evaluator.ts:3212` |
| Env vars | `getenv` | `sys-ops.ts:47` |
| Epoch ms | `current-time` → number | `sys-ops.ts:55` |
| Process exit | `exit` | `sys-ops.ts:60` |
| Sync shell (stdout only) | `shell-command` | `tlisp-api.ts:1159`, `sys-ops.ts:76` |
| Sync shell (structured) | `shell-exec` → `(stdout stderr exitCode)` | `tlisp-api.ts:1186` |
| Async streaming subprocess | `make-process` with `:filter`/`:sentinel` | `tlisp-api.ts:1285` |
| Process I/O / signaling | `process-write`, `signal` | `tlisp-api.ts:1383, 1401` |
| File read (sync) | `read-file` / `read-file-content` | `io-ops.ts:74`, `file-ops.ts:103` |
| File write (**overwrite**) | `write-file` / `write-file-content` | `io-ops.ts:87`, `file-ops.ts:60` |
| File exists | `file-exists-p` / `file-exists?` | `file-ops.ts:132`, `io-ops.ts:103` |
| Mkdir | `file-mkdir` | `file-ops.ts:311` |
| Stat / modtime | `file-stat`, `file-modtime` | `file-ops.ts:181, 154` |
| Dir listing | `read-dir`, `directory-files` | `file-ops.ts:340`, `io-ops.ts:112` |
| Glob | `file-glob` (Bun.Glob) | `tlisp-api.ts:1214` |
| **JSON parse** | `json-read-from-string` | `tlisp-api.ts:1488` |
| Strings / regex | `string-split/join/replace/match`, `format`, `string-append` | `stdlib.ts`, `evaluator.ts:4144` |
| Collections | `hashmap*`, `mapcar`, `filter`, `apply`, `stable-sort` | `stdlib.ts` |
| Async | promises + `async-let` + `promise-then` | `async.ts`, `evaluator.ts:731` |
| Stdout | `print`, `princ` | `io-ops.ts:53, 59` |

That covers pipeline blocks 2, 7, 10, and the data-layer halves of 3/4/5/6/8/12. What's missing is below.

## Gap Tiers

| Tier | What | Touches | Effort | Status in this RFC |
|---|---|---|---|---|
| **1** | `append-file`, `json-encode`/`json-stringify`, `command-line-args` (+ CLI arg forwarding), `make-promise`, `core/monads` module (`Option`/`Either`/`Result`/`Validation`/`State`/`Reader`/sync-`Task`) | 4 builtins + `cli.ts` change + one T-Lisp module | Small | **Phase 1 — unblock the port + FP foundations** |
| **2** | `process-wait`/`await-process`, `:env` kwarg on `make-process`/`shell-exec`, `format-time-string`, `file-realpath` | Builtins + process-table change | Small–medium | **Phase 2 — subprocess fidelity** |
| **3** | Async `Task`/`TaskEither` (built atop `make-promise`), tagged-record helpers, script-owned exit codes / stdout | Mostly T-Lisp modules | Medium | **Phase 3 — ergonomic parity** |
| **4** | Full static-typed `TaskEither` monad instance, typed records/ADTs, structured concurrency | Large | Large | **Out of scope** |

> **Why `make-promise` and `monads` are Tier 1, not Tier 3:** the gap analysis (see "FP constructs" finding) established that *every* monad/applicative in `rules/functional-programming.md` is constructible in pure T-Lisp today — `Option`/`Either`/`Result`/`Validation`/`State`/`Reader` need only closures + tagged lists. The **one** missing piece that prevents the async `Task`/`TaskEither` family from being constructible is a promise *creator* exposed to T-Lisp: promises exist as a value type and are consumable (`promise-then`, `async-let`, `await`), but nothing lets T-Lisp *produce* one from a thunk. That is the same flavor of gap as `append-file`/`json-encode`/`command-line-args` — a thin primitive where T-Lisp literally cannot reach the runtime — so it belongs in Tier 1, and shipping the `monads` module alongside it gives the port its error-threading substrate (the `Either` pipeline the adw orchestrator leans on) without waiting for Tier 3.

---

## Phase 1: Tier 1 — Hard Blockers + FP Foundations

**Motivation:** without the three hard blockers, no T-Lisp port is possible regardless of how much other capability exists. Each is small, mirrors an existing primitive, and has a one-line statement of why it's a blocker. Steps 1.4–1.5 add the one remaining primitive (`make-promise`) plus the T-Lisp-native monad/applicative module that gives the port its error-threading substrate — promoted from Tier 3 because, per the gap analysis, every sync FP construct is already constructible today and only the async half waits on this one primitive.

### Step 1.1: `append-file`

**Why it's a blocker (Tier 1):** the pipeline's *defining* pattern is crash-survivable event streaming: `appendFileSync(events.jsonl, JSON.stringify({ts,…})+"\n")` runs on every event across all four files. T-Lisp has `write-file` (full overwrite) but nothing that appends. Without `append-file`, every event/state write clobbers the previous one — the append-only log that survives crashes cannot exist.

**Where:** `src/tlisp/io-ops.ts` (mirrors `write-file` at line 87), and/or `src/editor/api/file-ops.ts` as `append-file-content`.

**Signature:** `(append-file path content)` → writes `content` to end of `path`, creating it if absent. Returns `nil`.

**MUST:**
- `(append-file "events.jsonl" "{\"ts\":1}\n")` then `(append-file "events.jsonl" "{\"ts\":2}\n")` produces a file containing both lines.
- Creates parent directories? **No** — match `write-file`'s contract (caller does `file-mkdir` first). Document this.
- Respects `allowFilesystem` / `allowShell` gating in `io-ops.ts` (mirrors `write-file`).
- Returns `Either` errors matching the existing `evalError` shape.

**MUST NOT:**
- Truncate the file. (This is the whole point.)
- Add a "mode" or encoding argument in Tier 1. UTF-8 only.

**Acceptance criteria:**
- [ ] Two consecutive `(append-file same-path …)` calls leave both writes present.
- [ ] Appending to a non-existent path creates it (no error on first call).
- [ ] `bun run typecheck:src` passes.
- [ ] A trt test in `test/tlisp/` covers the two-call case + the create case.

### Step 1.2: `json-encode` / `json-stringify`

**Why it's a blocker (Tier 1):** the pipeline builds `Record<string,unknown>` and emits `JSON.stringify(obj, null, 2)` for state files and `JSON.stringify({ts,…})` for every event line. T-Lisp has `json-read-from-string` (parse) but no inverse. **Without serialization, neither `events.jsonl` nor `adw-state.json` can be written** — the parser exists, the emitter does not.

**Where:** `src/editor/tlisp-api.ts` next to `json-read-from-string` (line 1488). The encoder is the strict inverse of the existing `toTlisp` decoder.

**Signature:** `(json-encode value)` → compact JSON string. `(json-stringify value)` is an alias; pretty-printing is a Tier 1 stretch (see below).

**Mapping (mirrors the existing parse decoder in reverse):**
| T-Lisp value | JSON |
|---|---|
| `nil` | `null` |
| `true` / `false` | `true` / `false` |
| number | number |
| string | string (JSON-escaped) |
| list | array |
| alist / hashmap | object |

**MUST:**
- `(json-encode '(("a" . 1) ("b" . "x")))` and `(json-encode (hashmap "a" 1 "b" "x"))` both produce valid JSON objects. (Pick the alist convention the existing decoder already uses: list of `(key value)` pairs.)
- Strings are properly escaped (`"`, `\`, control chars).
- Round-trips with `json-read-from-string`: `(json-read-from-string (json-encode v))` recovers an equivalent structure for the supported value set.
- Cycles / unsupported types (functions, symbols other than `t`/`nil`) return an `Either.left` with a clear message, not a thrown exception.

**MUST NOT:**
- Emit JS-specific forms (undefined, NaN, comments).
- Support a `:pretty` kwarg in the base form. **Tier 1 stretch:** if cheap, accept an optional second boolean/number arg for 2-space indentation to match the TS `JSON.stringify(state, null, 2)` state-file shape; otherwise defer to Tier 2 and document.

**Acceptance criteria:**
- [ ] `(json-encode (hashmap "adw_id" "01KV…" "status" "running"))` → `{"adw_id":"01KV…","status":"running"}`.
- [ ] Round-trip test against `json-read-from-string` for numbers, strings, bools, nil, nested lists, hashmaps.
- [ ] `bun run typecheck:src` passes.
- [ ] A trt test covers round-trip + string-escaping (quote, backslash, newline).

### Step 1.3: `command-line-args` (+ CLI forwarding)

**Why it's a blocker (Tier 1):** the orchestrator's entire CLI surface (`--feature`/`--bug`/`--chore`/`--model`/`--id`/`-h`/`<description>`) is read via `parseArgs(process.argv.slice(2))`. The standalone `src/tlisp/cli.ts` consumes `process.argv` at the TS layer (for `-e`, `-h`, script path) and **never exposes the remaining args to the running script**. There is no `(command-line-args)` / `(argv)` builtin, so a T-Lisp port of `parseArgs` cannot read its own invocation. The whole CLI contract is unreachable from T-Lisp.

**Where:** new builtin in `src/tlisp/sys-ops.ts`, plus a forwarding change in `src/tlisp/cli.ts`.

**Two-part change:**

1. **`command-line-args` builtin** (`sys-ops.ts`): returns a list of the script's own arguments as strings. Initially populated from a value the interpreter is constructed with (see part 2).
2. **`cli.ts` forwarding:** when running `tlisp script.tlisp arg1 arg2 …`, capture everything after the script path and inject it into the standalone interpreter's `command-line-args`. Today `cli.ts:79` only destructures `[first, second]` and silently drops the rest.

**Signature:** `(command-line-args)` → list of strings. `(command-line-args-count)` is optional sugar (Tier 2).

**MUST:**
- `tlisp script.tlisp --feature "add foo"` → inside the script, `(command-line-args)` returns `("--feature" "add foo")`.
- `tlisp -e '(print (command-line-args))' a b c` → prints `(a b c)` (the `-e` expression is the program; trailing tokens are its args). Document this choice.
- In the *editor* runtime (daemon), `(command-line-args)` returns `nil` (no meaningful script args) — don't error, don't return the daemon's own argv.
- The standalone interpreter constructor takes an optional `argv?: string[]` (mirrors how `env` and `exit` are already injectable in `sys-ops.ts`).

**MUST NOT:**
- Parse flags. Flag parsing is the script's job (block #1 in the table) — this primitive only hands over the raw token list.
- Overlap with `-e`/`-h`/`--version` handling in `cli.ts` — those remain TS-layer.

**Acceptance criteria:**
- [ ] A `.tlisp` script that does `(princ (string-join " " (command-line-args)))` and is invoked as `tlisp s.tlisp a b c` prints `a b c`.
- [ ] `tlisp -e '(length (command-line-args))' x y` → `2`.
- [ ] `bun run typecheck:src` + `bun run typecheck:test` pass.

### Step 1.4: `make-promise`

**Why it's in Tier 1:** promises exist as a T-Lisp value type (`values.ts:132`, self-evaluating at `evaluator.ts:289`) and are *consumable* via `promise-then` (`stdlib.ts:146`), `promise-value` (`stdlib.ts:124`), and `async-let` (`evaluator.ts:731`). But **nothing lets T-Lisp *produce* a promise from a thunk**. Without `make-promise`, user T-Lisp code has no way to introduce its own deferred/async computation — every async value must originate from a TypeScript builtin. `(make-promise (lambda () …))` closes that gap and is the same flavor of thin primitive as Steps 1.1–1.3.

**Where:** `src/tlisp/stdlib.ts`, immediately after `promise-then` (line ~184), mirroring the existing async-builtin registration shape.

**Signature:** `(make-promise thunk)` → registers a deferred computation; the thunk is a zero-arg function (lambda) returning either a plain value or another promise.

**⚠ Critical implementation finding (auto-unwrap):** the async evaluator auto-unwraps **every** function-call result via `awaitIfPromise` (`evaluator.ts:2419` and `:2426`). This means a promise returned by `make-promise` is resolved at the call boundary — it does **not** survive as a first-class, holdable value that a later `promise-value`/`promise-then` can consume. Verified: `(async-let () (make-promise (lambda () (+ 1 2))))` yields `3` (the resolution), but binding it and calling `promise-value` on the binding fails with "promise-value requires a promise" because the binding already holds the unwrapped `3`.

**What Step 1.4 ships (deferred async):** `make-promise` lets user code lift a thunk into the async context so its resolution becomes the enclosing expression's value. This is sufficient for *deferring* an async operation (e.g. wrapping `shell-exec` so it runs as part of an `async-let` body the user defines), and it is the foundation the async `Task`/`TaskEither` family (Tier 3) builds on.

**What Step 1.4 does NOT ship (promises as first-class values):** passing a `make-promise` result to `promise-then` in a *separate* step, or holding a promise in a variable for later chaining, requires an evaluator change to opt `make-promise` out of auto-unwrap. That is tracked as **Step 1.4b** below, not silently claimed.

**MUST (shipped):**
- `(async-let () (make-promise (lambda () (+ 1 2))))` → `3` (deferred resolution).
- `(async-let () (make-promise (lambda () (make-promise (lambda () 1)))))` → `1` (nested chaining within one expression).
- A thunk wrapping an async builtin defers it: `(make-promise (lambda () (shell-exec …)))` runs the builtin as part of the resolution.
- A thunk that calls `(error "boom")` surfaces as an `EvalError` (rejected promise → `normalizePromiseError` at `async.ts:45`).
- Registered via `defineAsyncBuiltin`; a non-async call returns the "requires async evaluation; use async-let" message (matching `promise-value`/`promise-then`).
- Non-callable `thunk` → `EvalError` variant `TypeError` ("thunk must be a function").

**MUST NOT:**
- Run the thunk eagerly at *definition* time. The thunk runs when the promise resolves (within the async-let evaluation).
- Accept non-callable `thunk` silently.
- Over-claim first-class-promise support until Step 1.4b lands (see below).

**Acceptance criteria (shipped — `test/unit/tlisp-make-promise.test.ts`, 5/5 passing):**
- [x] `(async-let () (make-promise (lambda () (+ 1 2))))` → `3`.
- [x] `(async-let () (make-promise (lambda () (shell-exec "echo hi"))))` → `("hi" "" 0)`.
- [x] `(make-promise 42)` → `TypeError` "thunk must be a function".
- [x] `(make-promise (lambda () 1))` outside async-let → "requires async evaluation".
- [x] `(make-promise (lambda () (error "boom")))` → `EvalError`.
- [x] `bun run typecheck:src` passes.

### Step 1.4b: Promises as first-class values (evaluator change — follow-up)

**Why deferred:** the async evaluator's call-result auto-unwrap (`evaluator.ts:2419`/`:2426`) makes promises transient by design. To let `make-promise` return a value that survives to be consumed by `promise-then`/`promise-value` in a later step — which the async `Task`/`TaskEither` monad family (Tier 3) needs — the evaluator must skip auto-unwrap for promises explicitly marked as "held."

**Proposal:** add a `held: true` flag to `TLispPromise` (`values.ts:132`) set by `make-promise`; in the two auto-unwrap sites, `awaitIfPromise` returns the promise as-is when `held` is set. This is a ~10-line, surgical evaluator change gated to `make-promise`-produced promises only — it does not change the auto-unwrap behavior for any existing async builtin, so `shell-exec`/`read-file-content`/etc. behave identically.

**MUST:** `(async-let () (let ((p (make-promise (lambda () 1)))) (promise-value p)))` → `1` (promise survives the binding). Existing async builtin tests (`test/unit/tlisp-async.test.ts`) remain green.

**Status:** not implemented in this pass. Tracked here so the Step 1.4 claim is honest. Blocks the Tier 3 async `Task`/`TaskEither` family.

### Step 1.5: `core/monads` module

**Why it's a blocker (Tier 1):** the adw orchestrator's readability comes from `TaskEither.right(…).tap().flatMap().mapLeft()` — monadic error threading with automatic Left short-circuit. Per the FP-constructs gap analysis, **every sync monad/applicative is constructible in pure T-Lisp today** (`Option`, `Either`, `Result`, `Validation`, `State`, `Reader`) using closures + tagged lists — they need no new primitives. Shipping them as a module in Tier 1 (rather than Tier 3) does two things: (a) it gives the port its error-threading substrate immediately, and (b) it removes the impression that T-Lisp lacks monadic capability. The async `Task`/`TaskEither` family composes on top once Step 1.4 lands.

**Where:** new `src/tlisp/core/monads.tlisp`, resolved as module `std/monads` via the filesystem module loader (the loader was extended to resolve `std/*` modules under `coreRoot` in addition to `editor/*`, so one physical file is the source of truth for both the editor and standalone profiles). Module name: `std/monads`.

**Representation:** all constructs are tagged lists over existing value types — no new value type, no evaluator change:
- `Option` — `(some v)` / `nil` (use `nil` as `None`; `option-some?` checks `consp`).
- `Either` — `(right v)` / `(left e)`; the monadic `bind` (`>>=`) is `(either-bind x f)`.
- `Result` — thin relabeling of `Either` (`ok`/`err`), kept separate for readability of code that uses both.
- `Validation` — `(ok v)` / `(err errs)` where `errs` is a list; the applicative `lift2`/`lift3` *accumulate* errors (list-append) rather than short-circuit, matching `rules/functional-programming.md` § Validation.
- `State` — `s -> (value, new-state)` represented as a closure `(lambda (s) (list value new-s))`; `state-bind` threads state through.
- `Reader` — `env -> value` represented as `(lambda (env) …)`; `reader-bind` threads the env.
- `Task` (sync) — a zero-arg thunk `(lambda () …)`; `task-map`/`task-bind` compose lazily. (Async `Task` is Tier 3, built atop `make-promise`.)

**Exported API (module `(export …)`):**
- Option: `some none option-some? option-map option-bind option-or option-default`
- Either: `either-right either-left either-left? either-right? either-map either-bind either-fold either-get-or-else`
- Result: `ok err ok? err? result-map result-bind` (delegates to either)
- Validation: `vsuccess vfailure vsuccess? vfailure? lift2 lift3 validation-validate`
- State: `state-get state-put state-modify state-pure state-bind state-run`
- Reader: `reader-ask reader-ask-with reader-pure reader-bind reader-run`
- Task (sync): `task-pure task-lift task-map task-bind task-run`

**MUST:**
- `(require-module std/monads)` succeeds in both the editor (file at `src/tlisp/core/monads.tlisp`) and the standalone interpreter (embedded string in `stdlib-assets.ts`).
- Monadic laws hold for `Either`/`Option`/`State`/`Reader`/sync-`Task`:
  - left identity: `(either-bind (either-right x) f)` ≡ `(funcall f x)`
  - right identity: `(either-bind (either-right x) #'either-right)` ≡ `(either-right x)`
  - associativity: `(either-bind (either-bind m f) g)` ≡ `(either-bind m (lambda (x) (either-bind (funcall f x) g)))`
- `Validation` accumulates: `(lift2 f (vfailure '("a")) (vfailure '("b")))` yields a failure carrying both `"a"` and `"b"`.
- `State` threads: `(state-run (state-bind state-get (lambda (_ ) (state-put 5))) 0)` → `(0 5)` (value, new-state).
- `Reader` threads: `(reader-run (reader-bind reader-ask (lambda (env) (reader-pure (car env)))) '(99))` → `99`.

**MUST NOT:**
- Introduce a new value type, a new special form, or any evaluator/TS change. This step is pure T-Lisp.
- Shadow existing builtins (`car`/`cdr`/`list`/`mapcar` etc. are used, not redefined).
- Re-implement what already exists — `condition-case` remains the throw/catch layer; `Either` is the pure, value-returning layer layered on top, not a replacement.

**Acceptance criteria:**
- [ ] The module loads in both editor and standalone runtimes without error.
- [ ] A trt suite `test/tlisp/monads.test.tlisp` covers monad laws for `Either`/`Option`/`State`/`Reader`, `Validation` accumulation, and `Task` laziness.
- [ ] `bun run typecheck:src` + `bun run typecheck:test` pass.

---

**Phase 1 outcome:** with Steps 1.1–1.5 landed, a T-Lisp port of the adw orchestrator's *structure* (blocks 1, 3, 4, 7, 8, 10, 11-via-shell-workaround) becomes writable. Stages can be invoked via `shell-exec` and their stdout parsed; errors thread through `(either-bind …)` instead of nested `condition-case`. The port is feasible. Phase 2 is what makes it *faithful*.

## Phase 2: Tier 2 — Subprocess Fidelity

**Motivation:** Phase 1 unblocks the port; Phase 2 removes the friction that would make a port meaningfully worse than the TS original.

### Step 2.1: `process-wait` / `await-process`

The orchestrator's `spawnStage` awaits a child and returns `{code, stdout, stderr}` as a value the caller binds and parses. T-Lisp's `make-process` returns a *pid* immediately and delivers output via a `:filter` symbol callback re-invoked as `(name pid text)`; the exit code arrives at a `:sentinel`. To emulate `runCapture` today you must hand-stash chunks into a global and poll — there is no `(await-process pid)` yielding the final result.

**Proposal:** `(await-process pid)` → a promise (usable via `async-let`) resolving to `(stdout stderr code)`. Internally: buffer the pid's stream (as `make-process` already does for its log tail) and resolve on the existing exit path.

**MUST:**
- `(async-let ((r (await-process pid))) …)` binds `r` to `(stdout stderr code)`.
- Works for pids from `make-process`. Returns `Either.left` for unknown pids.
- Does not change `:filter`/`:sentinel` semantics — it's an additional, awaitable view.

**MUST NOT:** replace `make-process`'s streaming model. Streaming stays for UI-facing processes; `await-process` is for orchestrator-style "spawn, capture, continue."

### Step 2.2: `:env` kwarg on `make-process` / `shell-exec` / `shell-command`

The orchestrator sets `env: { ADW_ORCHESTRATED: "1" }` so child stages skip writing their own state — a deliberate ownsState-vs-orchestrated switch. Today all three subprocess primitives inherit `process.env` with no override knob. That switch cannot be expressed.

**Proposal:** accept an optional `:env` kwarg whose value is a list of `(name value)` pairs (or a hashmap) merged over `process.env`. Mirrors the `:headers` convention already used by `http-request` (`tlisp-api.ts:1420`).

### Step 2.3: `format-time-string`

`(format-time-string "%FT%TZ" &optional epoch-ms)` → ISO-8601 (and a small subset of strftime). The pipeline stamps every event with `new Date().toISOString()`. T-Lisp has `current-time` (epoch ms) but no formatter. Workaround today is `(shell-command "date -u +%FT%TZ")` — a fork per timestamp.

**MUST:** support at least `%Y %m %d %H %M %S` and the ISO composite `%FT%TZ`. UTC only in Tier 2.

### Step 2.4: `file-realpath`

`(file-realpath path)` → `fs.realpathSync`. The pipeline resolves its project root via `realpathSync(join(import.meta.dir, ".."))`. T-Lisp has no realpath and no self-location. A `git rev-parse --show-toplevel` workaround exists but realpath is a ~5-line builtin worth having.

---

**Phase 2 outcome:** the port can stream-tee child output to a file (2.1), set per-child env (2.2), stamp events with ISO timestamps (2.3), and resolve project root (2.4) — matching the TS pipeline's fidelity without shell-command workarounds.

## Phase 3: Tier 3 — Ergonomic Parity

**Motivation:** Phases 1–2 make a correct port possible; Phase 3 makes it *readable* and as maintainable as the TS original. Optional; defer until a real port is attempted and the pain is concrete.

### Step 3.1: Async `Task` / `TaskEither`

The sync FP stack lands in Tier 1 (Step 1.5). What remains for Tier 3 is the **async** half — `Task` as a lazily-evaluated async computation and `TaskEither` as async error threading — built atop `make-promise` (Step 1.4) + `async-let`. The shape mirrors the sync `Task`/`Either` already shipped: `(task-async (lambda () (make-promise …)))` returns a lazy async task; `(task-either-bind te f)` chains across awaits with Left short-circuit.

**Why Tier 3, not Tier 1:** the sync stack is sufficient to *port the orchestrator's error-threading structure* (blocks 8, 10) because the adw pipeline's stages are sequentially awaited and the error short-circuit is what matters, not laziness-as-async. Async `Task`/`TaskEither` become necessary only when a port wants to *parallelize* or *compose awaiting* without blocking the runtime per stage — a fidelity concern (Phase 2's `await-process` is the concrete trigger), not a feasibility one.

**Open:** whether `task-either` needs its own value type or composes fine as `(task (lambda () (make-promise (lambda () (either-right …)))))`. Leaning **no new type** — the composition is awkward but workable; revisit when a real port exercises it. See Q5.

### Step 3.2: Tagged-record / ADT helpers

`match(outcome, {created, modified, noop})` over a discriminated union becomes tagged lists + `cond` today. Works, loses type safety. A small `defrecord`/`match` macro (already proposed in [RFC-015](RFC-015-pattern-matching-and-destructuring.md)) closes this; this RFC defers to that one rather than duplicating.

### Step 3.3: Script-owned exit codes and stdout

Today `runScript`→`runEval` (`cli.ts:46-62`) prints `valueToString(result)` for non-nil and maps any eval error to exit 1. The script doesn't fully own its stdout or its exit-code taxonomy (the TS contract is exit `0`/`1`/`2` distinguishing usage vs stage failure, with stdout = machine, stderr = human).

**Proposal:** a `(exit code)` that the script can call with 2 (today `exit` exists but `cli.ts` overrides the final code), and a convention/flag that suppresses `runEval`'s auto-printing of the result so the script's own `(princ …)` is the whole stdout. Small `cli.ts` change; defer exact UX to when a real port lands.

## Explicitly Out of Scope (Tier 4)

- **Full static-typed `TaskEither` monad instance.** The sync `Either`/`Task` (Tier 1, Step 1.5) + `async-let` + `make-promise` (Step 1.4) covers the orchestrator. A *type-level* lazy-async monad is a larger design not justified by one script.
- **Typed records / ADTs as first-class values.** Tagged lists suffice; RFC-015 owns pattern matching.
- **Structured concurrency** (parallel stages, cancellation, supervision trees). The adw pipeline is strictly sequential; no need.
- **A new condition/restart system.** `condition-case` is enough; see RFC-016 Tier 4.
- **CLI arg-parsing *library*.** `(command-line-args)` returns raw tokens; each script parses its own flags (as the TS files each have their own `parseArgs`). A shared `parse-opts` macro, if ever wanted, is a separate RFC.

## Architecture Constraints

1. **TS is thin, T-Lisp owns logic.** These primitives are low-level (filesystem, process, argv, serialization) — exactly the "TypeScript may expose only … primitives" line in `learnings.md` § Architecture. They belong as builtins, not as T-Lisp modules.
2. **Functional error handling stays.** Every new builtin returns `Either<AppError, TLispValue>`, matching `io-ops.ts`/`sys-ops.ts`/`file-ops.ts`. No thrown exceptions cross the T-Lisp boundary (except where existing primitives already throw, which is a known inconsistency to fix separately, not a pattern to extend).
3. **Standalone vs editor parity.** New primitives must be available in *both* the standalone interpreter (`createStandaloneInterpreter`) and the editor API, *except* where they're meaningless in one (e.g., `command-line-args` returns nil in the daemon). Mirror how `getenv`/`exit`/`shell-command` are already split.
4. **Gating respected.** `append-file` honors `allowFilesystem`; process primitives honor `allowProcess`/`allowShell`. No new global capability bypasses.

## Alternatives Considered

### Alternative 1: Port the orchestrator to T-Lisp *without* new primitives, using shell workarounds
**Rejected** for Tier 1 — the three blockers cannot be worked around:
- `append-file`: no way to append via `write-file` without reading the whole file first (racy, not crash-safe).
- `json-encode`: no inverse parser exists; building JSON via `string-append` + manual escaping is error-prone and exactly the kind of thing a builtin should be.
- `command-line-args`: the args literally never reach the script.

(Shell workarounds *are* acceptable for some Tier 2 gaps — `format-time-string` via `date`, `file-realpath` via `readlink` — but land the builtins anyway because they're cheap and remove forks.)

### Alternative 2: A general-purpose "scripting standard library" RFC
**Rejected.** Same reasoning as RFC-016's tiering: ship what one concrete artifact needs, defer the rest. A broader scripting stdlib, if justified by a *second* concrete artifact, is a follow-up RFC.

### Alternative 3: Leave the orchestrator in TypeScript permanently
**Defensible but not this RFC's call.** The Lisp-first architecture (`AGENTS.md`, `src/tlisp/Claude.md`) says editor logic belongs in T-Lisp. Whether/when to actually port is a separate decision; this RFC only ensures the *option* exists by closing the primitive gaps. If the project decides the orchestrator stays TS, Phase 1 is still worth landing because the three primitives have uses beyond adw (event logging, config/state serialization, any T-Lisp CLI tool).

## Open Questions

**Q1: Where does `append-file` live — `io-ops.ts` (standalone) only, or also `file-ops.ts` (editor API)?**
Both `read-file` and `write-file` exist in `io-ops.ts` but the editor equivalents are `read-file-content`/`write-file-content` in `file-ops.ts`. Lean: add to `io-ops.ts` as `append-file` AND expose via editor API as `append-file-content` (mirroring the existing read/write split). Confirm during implementation.

**Q2: Should `json-encode` accept alist input, hashmap input, or both?**
The existing decoder emits alists for objects (`tlisp-api.ts:1500`). For round-trip symmetry the encoder should accept alists. Hashmaps are a nicer object representation; accept both, alist-of-pairs takes precedence if ambiguous. Confirm against a real port's usage.

**Q3: Does `command-line-args` need an `--` separator convention (like `tlisp script.tlisp -- args`)?**
The TS `parseArgs` doesn't use `--`. Lean: no separator in Tier 1; everything after the script path (or after `-e <expr>`) is the script's args. Revisit if a real port needs to pass `-`-prefixed args unambiguously.

**Q4: Is `process-wait`/`await-process` (Step 2.1) a breaking change to `make-process`'s contract?**
No — it's additive. But it implies buffering every spawned process's stdout even when the caller only wants streaming. Confirm the buffering strategy (cap size? drop-oldest?) doesn't regress the existing `make-process` tests.

**Q5: Sync `Either`/`Option`/`State`/`Reader` — macro over tagged lists, or a new value type?**
**Resolved (shipped).** Step 1.5 ships tagged-list representations — no new value type, no evaluator change. 28/28 trt tests pass (`test/tlisp/monads.test.tlisp`). The open question now applies only to the **async** `Task`/`TaskEither` (Step 3.1), which is blocked on Step 1.4b (promise auto-unwrap), not on a representation choice.

**Q6: Where does `core/monads.tlisp` resolve from?**
**Resolved (shipped).** The module loader's `coreModulePaths` was extended to resolve `std/*` modules under `coreRoot` in addition to `editor/*`. So one physical file (`src/tlisp/core/monads.tlisp`) is the single source of truth for both the editor profile (coreRoot = `…/tlisp/core`) and the standalone profile (coreRoot defaults to `src/tlisp/core`). No `stdlib-assets.ts` duplication. **Open:** compiled-binary parity — `bun build --compile` bundles TS but the `.tlisp` is read from disk at runtime, so a compiled binary would need `std/monads` added to `STANDALONE_STDLIB_MODULES` (or `bun build` embedding). Tracked separately; running from source via `bun` (the project default per `package.json`) works today.

**Q7 (new, from implementation): promises are transient under the current evaluator — how should `make-promise` interact with auto-unwrap?**
Discovered while implementing Step 1.4: the async evaluator auto-unwraps every call result (`evaluator.ts:2419`/`:2426`), so a promise returned by `make-promise` is resolved at the call boundary and cannot survive as a first-class value. Step 1.4 ships the *deferred-async* behavior (which works); Step 1.4b proposes a surgical `held`-flag opt-out for the *first-class-value* behavior the async `Task`/`TaskEither` family needs. Open: is the `held`-flag approach acceptable, or should auto-unwrap be revisited globally? Lean surgical (flag), to avoid changing existing async-builtin semantics.

## Design Decisions

- **Tier 1 is four primitives + one T-Lisp module, not a subsystem.** Each primitive is ~10–40 lines, mirrors an existing neighbor, and has a one-line "why it blocks the port." The `monads` module is pure T-Lisp (no evaluator change) and ships the FP substrate the port needs for error threading. Together this is the minimum that makes the RFC's goal (a feasible port) true.
- **Monads are constructible, not gifted.** The gap analysis established that sync monads/applicatives are already expressible in T-Lisp via closures + tagged lists; Step 1.5 only *packages* what's already possible. The one genuinely missing runtime hook is `make-promise` (Step 1.4), which is why it — not the monad module — is the primitive gate.
- **No new value types in any tier.** Everything is built on the existing tag set (`nil`/`bool`/`number`/`string`/`list`/`hashmap`/`symbol`/`function`/`promise`). `Either` is tagged lists; records are tagged lists; JSON maps to hashmap/alist. This keeps the evaluator untouched and every change reviewable in isolation.
- **Standalone/editor parity is explicit, not accidental.** Documented per-primitive (Constraint 3) so a port running under `tlisp` CLI and one running under the daemon behave the same where it matters.
- **The port itself is out of scope.** This RFC closes primitive gaps. Whether to then rewrite `adw-plan-reviewspec-build.ts` in T-Lisp is a separate decision with its own spec. This keeps the RFC reviewable on primitive merits alone.
