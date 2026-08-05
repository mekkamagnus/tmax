# Bug: `loadCoreBindings` swallows required-binding load failures → cryptic `Undefined symbol` instead of a clear daemon-start error

> ## ⚠️ ROOT-CAUSE CORRECTION (verify-gate finding, 2026-08-03) — supersedes the original async-race framing
>
> The **async-race premise of the original spec is DISPROVEN.** `server.ts start()` is sequential —
> `await startEditor()` (which synchronously runs `loadCoreBindings` → the `(require-module …)`
> chain via synchronous `interpreter.execute`; `loadModuleFromDisk` returns `Either`, not a
> `Promise`) runs **before** `await startSocket()` (`server.ts:1055-1059`). The socket file
> therefore **cannot appear until `find-file` is already registered** — there is no race between
> `evalReady` and module load on the spawned-daemon path.
>
> The **real root cause** of the observed `Undefined symbol: find-file` is `loadCoreBindings`
> **swallowing module-load errors** (`src/editor/runtime/binding-runtime.ts:148-159`: on a required-
> binding load failure it `console.warn`s + `loadFallbackBindings()` + sets `coreBindingsLoaded(true)`
> regardless). A parse error in a required `.tlisp` left `find-file` undefined while the daemon
> started normally. The specific observed instance was the **`find-file.tlisp` stray-paren parse
> error during SPEC-071..085 work, fixed in `a448b70`** — so *that* flake is already gone.
>
> A `moduleReady`-gate approach (`instance.ts` poll for `find-file`) was implemented on branch
> `issue-109` + **rejected by the verify-gate** as wrong-target: it would mask the symptom
> (timeout vs `Undefined symbol`) for the `find-file` case but does not fix the swallowed-error
> root cause, and the race it targets does not exist (the gate succeeds on the first poll for any
> correctly-started daemon). Branch discarded; nothing landed.
>
> **Re-scoped fix (the actual remaining work):** make `loadCoreBindings` **fail loud** when a
> **required command module** fails to load — instead of silent fallback — so a future `.tlisp`
> parse error produces a clear start failure, not a cryptic `Undefined symbol` later. Plus a
> regression test. Keep the keymap fallback (intentional resilience); only **required command
> modules** should fail-loud. (Original title "tmax-use `evalReady` gate does not wait for
> T-Lisp module load → intermittent Undefined symbol under load" retained here for search; the
> fix no longer touches `evalReady`.)

## Goals

- A `.tlisp` parse/load error in a **required command module** (`normal/insert/visual/command.tlisp`, plus the `require-module` chain they pull in — e.g. `editor/commands/find-file.tlisp`) produces a **clear, immediate daemon-start failure** naming the offending file + error — not a healthy-looking daemon that later returns `Undefined symbol: find-file` to the first eval client.
- Preserve the **keymap** fallback (`FALLBACK_BINDINGS` in `binding-runtime.ts`) as intentional resilience for a degraded-but-usable editor — only **required command module** load failures fail loud.
- Stop the silent `coreBindingsLoaded(true)` lie: the flag must only be set true when the required command modules actually loaded.
- A regression test that injects a syntax error into a required binding and asserts the daemon start surfaces the error (not `Undefined symbol`).

## Completion Criteria (Definition of Done)

- [ ] A required-command-module load failure (e.g. a `.tlisp` syntax error, a missing `require-module` target) causes `loadCoreBindings` to **return/throw** the error instead of `console.warn` + `loadFallbackBindings` + `setCoreBindingsLoaded(true)`.
- [ ] `server.ts start()` (`startEditor` → `ensureCoreBindingsLoadedPublic`) propagates that failure so the daemon **does not reach `await startSocket()`** — i.e. the socket file never appears for a broken core binding, and the process exits non-zero with a message naming the file + parse error.
- [ ] `coreBindingsLoaded` stays `false` after a failed required-module load (the lazy-load retry path can attempt again on the next keypress; it must not be marked satisfied).
- [ ] The **keymap fallback** (`FALLBACK_BINDINGS`) is unchanged and still applies for the non-required / keymap-only degradation path (the `loadFallbackBindings` method and its `FALLBACK_BINDINGS` string are NOT removed).
- [ ] Regression test: a required `.tlisp` with a deliberate syntax error → daemon start fails clearly with a message referencing the file (assertion: error message contains the file name and/or `parse`/`Syntax` — NOT `Undefined symbol`). Mirrors the existing `loadCoreBindings` test pattern in `test/unit/editor-runtime-delegation.test.ts:382`.
- [ ] Existing `loadCoreBindings loads keymaps + 4 required files in order, then toggles line-numbers` test (`editor-runtime-delegation.test.ts:367`) still passes — the happy path is unchanged.
- [ ] `bun run typecheck:src`, `bun run typecheck:test`, and `bun run typecheck` are clean.
- [ ] `bun run test:tmax-use` passes (no new flakiness introduced — the keymap fallback path still works for the `--clean` / degraded cases the suite exercises).

## Root Cause (investigated 2026-08-03, re-scoped 2026-08-06)

The original framing ("`evalReady` races module load") was **misdiagnosed**. The verify-gate
disproved the race and identified the real cause.

**Real root cause — `loadCoreBindings` swallows required-binding errors.**
`src/editor/runtime/binding-runtime.ts:139-165`:

```ts
async loadCoreBindings(coreBindingsDir: string, keymapsPath: string): Promise<void> {
  try { await this.loadBindingsFromFile(keymapsPath); } catch {}        // ← keymap: ok to swallow

  let allLoaded = true;
  let lastError = "";
  for (const file of REQUIRED_BINDING_FILES) {                          // ← normal/insert/visual/command
    const path = `${coreBindingsDir}/${file}`;
    const loaded = await this.loadBindingsFromFile(path);               // ← returns false on parse/IO error
    if (!loaded) { allLoaded = false; lastError = `Failed to load from ${path}`; }
  }

  if (!allLoaded) {
    console.warn(`Failed to load some core bindings. Last error: ${lastError}`);
    console.warn("Loading minimal fallback key bindings...");
    this.loadFallbackBindings();                                        // ← keymap only: NO commands defined
  }

  this.deps.setCoreBindingsLoaded(true);                                // ← LIE: commands are NOT loaded
  this.deps.onCoreBindingsLoaded();
}
```

Three compounding problems:

1. **`loadBindingsFromFile` (`binding-runtime.ts:89-131`) returns `false` and `console.warn`s on any error** — a T-Lisp parse error in e.g. `find-file.tlisp` (pulled in via `normal.tlisp`'s `(require-module editor/commands/find-file)`) is downgraded to a warn. The actual parse error message (from `Either.isLeft(result)` at line 92-103) is discarded into `lastError = "Failed to load from <path>"` — the *real* `result.left.message` is never captured.
2. **`loadFallbackBindings` only defines keymaps** (`FALLBACK_BINDINGS`, lines 56-79) — it does NOT define `find-file`, `save-buffer`, `replace-string`, etc. So after a required-module failure the editor has working keys but **undefined commands**.
3. **`setCoreBindingsLoaded(true)` runs unconditionally** (line 163) regardless of `allLoaded` — so the lazy-load guard (`ensureCoreBindingsLoaded`, 168-172) never retries, and `server.ts` proceeds to `startSocket()` thinking core bindings are up.

Result: the daemon **starts normally** (socket appears, `(+ 1 1)` evals fine), then the first
real playbook eval hits `Undefined symbol: find-file` from `src/tlisp/evaluator.ts:541`. The
specific observed instance (`find-file.tlisp` stray paren) was fixed in `a448b70`, but the
**swallow-on-failure mechanism is still live** — the next required-binding parse error will
reproduce the same cryptic symptom.

**Why `evalReady` is NOT the fix:** `server.ts:1055-1059` runs `startEditor()` (synchronous
`loadCoreBindings` via `interpreter.execute`) **before** `startSocket()`. There is no window
where the socket is up but modules are not — so polling `find-file` in `evalReady` adds no
correctness; it only converts the failure mode from `Undefined symbol` to a timeout, while
leaving the swallowed-error root cause in place.

## Implementation Plan

**Pattern to mirror:** `loadBindingsFromFile` already distinguishes "loaded" (`true`) from
"failed" (`false`) and captures the error message at the throw site (lines 103, 118-122,
125-128). The fix extends `loadCoreBindings` to (a) preserve the real parse error message and
(b) treat a required-command-module failure as fatal, while leaving the keymap failure path
exactly as it is today.

### Step 1 — Capture the real error message from `loadBindingsFromFile`
**File:** `src/editor/runtime/binding-runtime.ts` (89-131, 139-165)

- Change `loadBindingsFromFile`'s failure return into a richer signal. Simplest surgical option matching the existing style: keep the `Promise<boolean>` signature for the keymap call, but add a sibling that returns the error string — OR change the required-file loop to read the last error from a captured variable. Concretely:
  - In the `for (const file of REQUIRED_BINDING_FILES)` loop, replace `const loaded = await this.loadBindingsFromFile(path)` with a path that captures the underlying `EvalError.message`. The cleanest minimal change: have `loadBindingsFromFile` stash the most recent failure message on the runtime (e.g. `private lastBindingError: string | undefined`), set it in each `catch`/`isLeft` branch (lines 103, 118-122, 125-128), and read it in the loop. Then `lastError` becomes the real message, not just `"Failed to load from <path>"`.
  - Do **not** change the `loadBindingsFromFile(path, silent)` boolean contract the keymap path and existing tests rely on (`editor-runtime-delegation.test.ts:417`).

### Step 2 — Make a required-command-module failure fail loud
**File:** `src/editor/runtime/binding-runtime.ts` (`loadCoreBindings`, 139-165)

- When `!allLoaded` after the required-files loop, **throw** an `Error` whose message names the offending file(s) and includes the captured parse error from Step 1 — e.g. `throw new Error("Failed to load required core bindings: " + failures.join("; "))`. Move the `setCoreBindingsLoaded(true)` + `onCoreBindingsLoaded()` calls to **only** run on the all-loaded path (after the loop, guarded by `if (allLoaded)`).
- **Keep `loadFallbackBindings()` for the keymap-degradation case only.** Decision point: the current `if (!allLoaded) { … loadFallbackBindings() }` block conflates "a required command module broke" (should fail) with "we want a usable-but-bare editor" (keymap fallback). Since a required-command-module failure now throws, the `loadFallbackBindings` call in this block is no longer reached for that case. Leave `loadFallbackBindings` (180-190) and its `FALLBACK_BINDINGS` string (56-79) **untouched** — it is still invoked from `Editor` construction (`editor.ts:295`) as the pre-load baseline keymap, which is the intentional resilience path.
- The keymap `try { await this.loadBindingsFromFile(keymapsPath); } catch {}` (line 141-143) stays as-is — a keymap failure is NOT fatal (consistent with the keymap-fallback intent).

### Step 3 — Propagate the failure through `Editor` → `TmaxServer.start()`
**Files:** `src/editor/editor.ts` (1689-1694, 1699-1704, 3143-3145), `src/server/server.ts` (915-944, 1055-1059)

- `BindingRuntime.loadCoreBindings` now throws on a required-module failure. The `Editor` facades (`loadCoreBindings` private at 1689, `ensureCoreBindingsLoaded` at 1699, `ensureCoreBindingsLoadedPublic` at 3143) are `async` and already propagate rejected promises — **no change needed in `editor.ts`** unless the existing facade swallows (verify: it does not — they are plain `await` facades).
- `server.ts startEditor()` (915-944) calls `await this.editor.ensureCoreBindingsLoadedPublic()` at line 929. A rejection propagates out of `startEditor()` → out of `start()` (1055-1059) → to the caller. Verify the daemon launcher (`bin/tmax` / `main.ts` daemon-branch) does not `.catch()` and suppress the rejection. The `console.log('Core bindings and init file loaded')` at line 1057 will simply not print on failure — the process should exit non-zero with the thrown error's stack/message.
- Confirm the eval path: with the socket never starting on a required-module failure, an eval client cannot connect — so there is no `Undefined symbol` to surface. (No change needed in `src/server/rpc/handlers/editing.ts:137-183`; it remains the path for *runtime* eval errors, which are unaffected.)

### Step 4 — Surface the failure clearly on the daemon CLI
**Files:** `bin/tmax`, `src/main.ts` (daemon-spawn branch)

- Trace where `TmaxServer.start()` is awaited on the daemon path and ensure an unhandled rejection prints a readable message (Bun's default unhandled-rejection output is acceptable; if the launcher wraps it in a generic "daemon failed to start", add the cause). If the existing path already logs the rejection verbatim, this step is a no-op — verify, don't change.
- If `--clean` / embedded path also calls `ensureCoreBindingsLoadedPublic`, it gets the same fail-loud behavior for free.

### Step 5 — Regression test (the load-bearing deliverable)
**File:** `test/unit/editor-runtime-delegation.test.ts` (extend the `BindingRuntime` `describe` block near line 382)

- Add a test: seed the fake filesystem with a `normal.tlisp` whose content is invalid T-Lisp (e.g. `"(defun broken ("` — unbalanced paren), the other three required files valid, and assert `rt.loadCoreBindings(...)` **rejects** with an error whose message references `normal.tlisp` (and ideally the parse error). Mirror the `makeBinding` helper at line ~345 (it already lets each file's content drive `evalCode`; to force a parse failure, point `evalCode` at a real `Interpreter` OR have the fake `evalCode` return `Either.left` for the broken file's content — match the existing harness style).
- Add a second assertion in the same test: `isCoreLoaded()` is `false` after the rejection (the flag must not be set on failure) — this proves the lazy-load guard can retry.
- Keep the existing `loadCoreBindings falls back when a required file is missing` test (382-391) **green only if** its intent was "keymap fallback for missing file". Re-scope it: under the new contract, a *missing required* file fails loud (throws). If that test's expectation (`loadFallbackBindings` evaluated) conflicts with the new fail-loud contract, update the test to assert a **throw** instead, and add a separate test confirming `loadFallbackBindings` is still exercised by the **non-required** degradation path (e.g. a corrupt `keymaps.tlisp` only). Document the contract change in the test comment.

### Verification (post-implementation)
1. `bun run typecheck:src && bun run typecheck:test && bun run typecheck` — clean.
2. `bun test test/unit/editor-runtime-delegation.test.ts` — new + existing `loadCoreBindings` tests pass.
3. Manual regression: temporarily inject a stray `)` into `src/tlisp/core/bindings/normal.tlisp`, run `tmax` (or `bun src/main.ts`), confirm the daemon **fails to start** with a message naming `normal.tlisp`; revert.
4. `bun run test:tmax-use` — green (the keymap fallback path the suite relies on is unchanged).

## Test Plan

| Test | File | Assertion |
|---|---|---|
| Required-command-module parse error fails loud (new) | `test/unit/editor-runtime-delegation.test.ts` | `await expect(rt.loadCoreBindings(...)).rejects.toThrow(/normal\.tlisp/)`; `isCoreLoaded() === false` |
| Real error message preserved (new) | same | rejection message contains the underlying parse error text, not just `"Failed to load from"` |
| Happy path unchanged | `editor-runtime-delegation.test.ts:367` | keymap + 4 files evaluated in order; `isCoreLoaded() === true`; line-numbers toggled |
| Keymap-fallback / missing-file contract (updated) | `editor-runtime-delegation.test.ts:382` | assert the NEW contract: missing required → throws; (optional) corrupt keymap-only → fallback keymap evaluated |
| E2E regression (manual / tmax-use) | inject stray `)` in `normal.tlisp`, start daemon | daemon start fails with file-named message; no `Undefined symbol`; revert after |

## Relevant Files

Read these first — the implementation plan is grounded in them:

- `src/editor/runtime/binding-runtime.ts` — the bug site. `loadCoreBindings` (139-165) swallows; `loadBindingsFromFile` (89-131) discards the real error; `loadFallbackBindings` (180-190) + `FALLBACK_BINDINGS` (56-79) are the **kept** keymap fallback; `REQUIRED_BINDING_FILES` (44-49) is the required-command-module list.
- `src/editor/editor.ts` — facades that propagate the rejection: `loadCoreBindings` (1689-1694), `ensureCoreBindingsLoaded` (1699-1704), `ensureCoreBindingsLoadedPublic` (3143-3145); `BindingRuntime` wiring (276-283); constructor-time `loadFallbackBindings()` baseline (295).
- `src/server/server.ts` — `startEditor()` (915-944, calls `ensureCoreBindingsLoadedPublic` at 929), `start()` (1055-1059, sequential `startEditor` → `startSocket`).
- `src/server/rpc/handlers/editing.ts` — `evalHandler` (137-183): the surface where `Undefined symbol` previously escaped; unchanged by this fix (no socket to connect to once start fails).
- `src/tlisp/evaluator.ts:541` — origin of `Undefined symbol: <name>` (TL1001) that this fix prevents from reaching eval clients.
- `test/unit/editor-runtime-delegation.test.ts` — existing `loadCoreBindings` tests (367-391) + `makeBinding` harness (~345-365): the pattern to mirror for the new regression test.
- `tmax-use/src/instance.ts` — `evalReady` (~159-165): **NOT modified** by this fix (the race was disproven; left as-is).

## Severity / Notes

- **Priority:** low (downgraded from medium-high after re-scope). The observed flake (`find-file.tlisp` stray paren) is already fixed in `a448b70`; this is now a **diagnostic-enhancement / regression-prevention** chore, not a flakiness fix. It prevents the next required-binding parse error from manifesting as a cryptic `Undefined symbol` and converts it to a clear, immediate daemon-start failure.
- **Contract change:** a missing/corrupt required command-module file now **fails daemon start** instead of degrading to a keymap-only editor. This is the intended behavior (a daemon with no `find-file`/`save-buffer` is not usable for any playbook) but is a behavior change — flag in the commit message.
- **Not in scope:** the `moduleReady` gate / `evalReady` polling (original framing) — explicitly rejected by the verify-gate; do not re-add. The keymap fallback (`FALLBACK_BINDINGS`) is **kept** as the resilience path for keymap-only degradation.
