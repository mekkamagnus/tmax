# Feature: adw tmux launcher — run adw pipelines in the 'tmax' tmux session

## Feature Description

A TypeScript module (`adws/adws-modules/tmux-launcher.ts`) plus a thin CLI entry point (`adws/adw-launch.ts`) that runs adw pipeline scripts inside the existing `tmax` tmux session, each in its own window. This solves the 10-minute task-ceiling problem (background tools are SIGTERM'd) and the orphaned-process problem (killing the orchestrator orphans the claude subprocess) by running pipelines in a detached tmux window that persists independently of any agent session or terminal.

The module provides:
1. **`ensureTmux()`** — confirms tmux is installed; returns a clear error if not.
2. **`ensureSession(name)`** — checks `tmux has-session -t <name>`; creates the session if missing.
3. **`launchInWindow(opts)`** — spawns the given adw script in a new tmux window within the session, returning the window name + attach instructions.

The CLI entry point (`adws/adw-launch.ts`) wires these together, defaulting to `adw-plan-review-build-patch.ts` as the target script.

## User Story

As an adw pipeline user
I want to launch a pipeline in a tmux window that survives my agent session
So that long-running pipelines (30–90 min) complete without being killed by tool-call timeouts

## Problem Statement

The adw orchestrators (`adw-plan-reviewspec-build.ts`, `adw-plan-review-build-patch.ts`) chain multiple long-running LLM calls (plan ~8 min, review ~5–10 min, build ~15–30 min, patch-review ~10 min). When launched via an agent's background-task tool, they're killed at ~10 minutes. When launched in a foreground terminal, they block that terminal for the full duration. Neither is workable for a 30–90 min pipeline run.

tmux solves this: a detached window persists independently of the launching process, survives SSH disconnects and agent session timeouts, and allows the user to attach and watch progress live (`tmux attach -t tmax`). But there's no launcher that wires the adw scripts into tmux — today the user must manually run `tmux new-window -t tmax 'bun adws/adw-*.ts ...'` each time.

## Solution Statement

Create two new files:

1. **`adws/adws-modules/tmux-launcher.ts`** — a TypeScript module (matching the `adws-modules/` convention: `agent.ts`, `reviewer.ts`, `builder.ts`, `workspace.ts`) with the tmux session/window management logic. Pure functions, injectable subprocess deps, unit-testable. No `main()`, no argv — purely the callable API.

2. **`adws/adw-launch.ts`** — a thin CLI entry point (matching the dispatcher convention: `parseArgs` → `main()` → `import.meta.main` guard) that imports the module, parses CLI args, and launches the target script in tmux.

```
bun adws/adw-launch.ts "<description>"                    # full pipeline in a new tmux window
bun adws/adw-launch.ts docs/specs/SPEC-056.md             # review→build→patch on existing spec
bun adws/adw-launch.ts --resume 01KVFS25X8                # alias for passing --id 01KVFS25X8
bun adws/adw-launch.ts --session dev "<description>"      # use a different session
bun adws/adw-launch.ts --window review "<description>"    # name the window
bun adws/adw-launch.ts --foreground "<description>"       # don't use tmux; run in current terminal
bun adws/adw-launch.ts --script adw-spec-review.ts <spec> # run a specific stage
bun adws/adw-launch.ts --chore "logging cleanup"          # pass target-script flags through
```

## Relevant Files

### New Files

- **`adws/adws-modules/tmux-launcher.ts`** — The tmux management module. Exports `ensureTmux`, `ensureSession`, `launchInWindow`, `TmuxLauncherDeps`, `LaunchOptions`, `LaunchResult`. Imports `TaskEither`/`Either` from `../../src/utils/task-either.ts`. Injectable subprocess deps (same pattern as `BuilderDeps`/`AgentDeps`) so the logic is unit-testable with mocked `tmux` calls. No `main()`, no argv.
- **`adws/adw-launch.ts`** — The CLI entry point. `parseArgs` → `main()` → `import.meta.main` guard (matches every other `adw-*.ts` dispatcher). Imports `ensureTmux`/`ensureSession`/`launchInWindow` from `./adws-modules/tmux-launcher.ts`. Default target script: `adw-plan-review-build-patch.ts`.
- **`test/unit/tmux-launcher.test.ts`** — Unit tests for the module (mocked tmux deps, temp dirs for session name isolation).
- **`test/unit/adw-launch.test.ts`** — Automated CLI/parser tests for launcher argument handling and script resolution.
- **`test/fixtures/adw-launch-smoke.ts`** — Harmless smoke fixture used only by the live tmux smoke test so validation does not consume LLM/runtime resources. It writes a marker file, signals `tmux wait-for`, then sleeps long enough for the validation step to observe the tmux window before it exits.

### Existing Files to Read (reference, not modify)

- **`adws/adws-modules/builder.ts`** — The template for the module's structure: JSDoc header, `BuilderDeps` interface (injectable `run`/`runCapture`), exported functions, no `main()`. The `TmuxLauncherDeps` interface mirrors this.
- **`adws/adws-modules/workspace.ts`** — Another module example: pure, synchronous, no subprocess deps. Shows the simplest module pattern.
- **`adws/adw-build.ts`** — The template for the CLI entry point: `parseArgs` → `main()` → `import.meta.main` guard → `USAGE` constant. The `adw-launch.ts` entry matches this structure.
- **`src/utils/task-either.ts`** — Canonical `Either`/`TaskEither`. The module uses `TaskEither` for the tmux subprocess calls (same as `run()`/`runCapture()` in the dispatchers).

### Existing Files to Modify

- **`docs/specs/index.md`** — Add SPEC-060 entry.

## Implementation Plan

### Phase 1: Foundation — the tmux-launcher module

The module wraps three tmux operations as injectable, typed functions:

```typescript
export interface TmuxLauncherDeps {
  run: (cmd: string, args: string[], opts?: { cwd?: string }) => TaskEither<string, string>;
}

export function ensureTmux(deps: TmuxLauncherDeps): TaskEither<string, void> {
  // tmux -V — confirms tmux is installed and runnable.
  return deps.run("tmux", ["-V"], {}).mapLeft(() =>
    "tmux is not installed. Install it first (brew install tmux)."
  ).map(() => undefined);
}

export function ensureSession(deps: TmuxLauncherDeps, session: string): TaskEither<string, void> {
  // tmux has-session -t <name> → if it fails, create the session.
  return TaskEither.from<string, void>(() =>
    deps.run("tmux", ["has-session", "-t", session], {}).run().then((existing) => {
      if (Either.isRight(existing)) {
        return Either.right(undefined);
      }

      return deps.run("tmux", ["new-session", "-d", "-s", session], {}).run().then((created) => {
        if (Either.isLeft(created)) {
          return Either.left(`failed to create tmux session '${session}': ${created.left}`);
        }
        return Either.right(undefined);
      });
    })
  );
}

export interface LaunchOptions {
  session: string;
  windowName: string;
  command: string;  // the full shell command to run in the window
}

export interface LaunchResult {
  session: string;
  window: string;
}

export function launchInWindow(deps: TmuxLauncherDeps, opts: LaunchOptions): TaskEither<string, LaunchResult> {
  return deps.run("tmux", ["new-window", "-t", opts.session, "-n", opts.windowName, opts.command], {})
    .map(() => ({ session: opts.session, window: opts.windowName }));
}
```

Note: `TaskEither.flatMap` only accepts an `onRight` callback in `src/utils/task-either.ts`; it does not support `(onRight, onLeft)`. Branch on `has-session` by wrapping a `run().then(...)` check in `TaskEither.from(...)`, as shown above. If the session is missing, `ensureSession` creates it with `tmux new-session -d -s <session>`. This intentionally leaves tmux's initial shell window in a newly created session; `launchInWindow` then creates the pipeline window. Do not add cleanup for that initial shell window in this feature.

### Phase 2: Core — the CLI entry point

`adws/adw-launch.ts` parses launcher-specific flags, resolves the target script, builds the command string, and calls the module:

```typescript
import { ensureTmux, ensureSession, launchInWindow } from "./adws-modules/tmux-launcher.ts";

const DEFAULT_SESSION = "tmax";
const DEFAULT_SCRIPT = "adw-plan-review-build-patch.ts";

export interface ParsedArgs {
  session: string;
  script: string;
  window?: string;
  foreground: boolean;
  resume?: string;
  scriptArgs: string[];  // pass-through args for the target adw script
}

// parseArgs: consume only recognized launcher flags (-s/--session, -w/--window,
// -t/--script, -f/--foreground, --resume) before pass-through starts. Pass-through
// starts at the first non-flag positional, the first unknown flag, or --.
// Examples:
//   --chore "x"            -> scriptArgs ["--chore", "x"]
//   --model gpt-5 "x"      -> scriptArgs ["--model", "gpt-5", "x"]
//   --session dev --bug x  -> session "dev", scriptArgs ["--bug", "x"]
//   --resume 01KV          -> scriptArgs ["--id", "01KV"]

function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (Either.isLeft(parsed)) { /* handle help/usage */ }

  const { session, script, window: windowName, foreground, scriptArgs } = parsed.right;
  const scriptPath = resolveScriptPath(script);
  if (!existsSync(scriptPath)) { /* error: list available scripts */ }

  const window = windowName ?? `adw-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
  const targetArgv = [scriptPath, ...scriptArgs];
  const cmd = `cd ${shellQuote(PROJECT_ROOT)} && exec ${["bun", ...targetArgv].map(shellQuote).join(" ")}`;

  if (foreground) {
    // Direct spawn with argv — no shell, no tmux.
    const child = Bun.spawn(["bun", ...targetArgv], { cwd: PROJECT_ROOT, stdio: ["inherit", "inherit", "inherit"] });
    // ... wait for exit, return code
  }

  // tmux path: ensureTmux → ensureSession → launchInWindow
  const deps = { run: /* the existing run() helper from the dispatchers */ };
  const program = ensureTmux(deps)
    .flatMap(() => ensureSession(deps, session))
    .flatMap(() => launchInWindow(deps, { session, windowName: window, command: cmd }));

  return program.run().then((result) => {
    if (Either.isRight(result)) {
      // Print attach instructions.
      process.stderr.write(`Launched in tmux session '${session}', window '${window}'.\n`);
      process.stderr.write(`  Attach:  tmux attach -t ${session}\n`);
      return 0;
    }
    process.stderr.write(`Error: ${result.left}\n`);
    return 1;
  });
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
```

### Phase 3: Integration — tests + smoke test

Unit tests for the module (mocked `run` dep returning canned tmux outputs). The CLI entry point has automated parser/path/argv tests plus `--help` and exit-code checks. A live smoke test launches a harmless fixture in tmux, waits for a marker signal while the fixture sleeps, and verifies the window was created before the fixture exits.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Task 1 — Create `adws/adws-modules/tmux-launcher.ts`

Model it on `builder.ts`'s structure: JSDoc header, `TmuxLauncherDeps` interface, exported functions, no `main()`.

```typescript
/**
 * tmux-launcher.ts — run adw pipeline scripts in a detached tmux window.
 *
 * Provides session/window management so long-running pipelines (30-90 min)
 * survive terminal disconnects and agent session timeouts. Injectable
 * subprocess deps (TmuxLauncherDeps) make the logic unit-testable with
 * mocked tmux calls.
 *
 * No CLI, no argv — the caller (adw-launch.ts) handles arg parsing.
 */
import { Either, TaskEither } from "../../src/utils/task-either.ts";

/** Injectable subprocess helper (shape matches run() in the dispatchers). */
export interface TmuxLauncherDeps {
  run: (cmd: string, args: string[], opts?: { cwd?: string }) => TaskEither<string, string>;
}

/** Confirm tmux is installed and runnable. */
export function ensureTmux(deps: TmuxLauncherDeps): TaskEither<string, void> {
  return deps.run("tmux", ["-V"], {})
    .mapLeft(() => "tmux is not installed. Install it first (brew install tmux).")
    .map(() => undefined);
}

/**
 * Ensure a tmux session exists. If `tmux has-session` fails, create it.
 * Returns Right<undefined> on success (session exists or was created).
 */
export function ensureSession(deps: TmuxLauncherDeps, session: string): TaskEither<string, void> {
  return TaskEither.from<string, void>(() =>
    deps.run("tmux", ["has-session", "-t", session], {}).run().then((existing) => {
      if (Either.isRight(existing)) {
        return Either.right(undefined);
      }

      return deps.run("tmux", ["new-session", "-d", "-s", session], {}).run().then((created) => {
        if (Either.isLeft(created)) {
          return Either.left(`failed to create tmux session '${session}': ${created.left}`);
        }
        return Either.right(undefined);
      });
    })
  );
}

export interface LaunchOptions {
  session: string;
  windowName: string;
  command: string;
}

export interface LaunchResult {
  session: string;
  window: string;
}

/** Create a new window in the session running the given command. */
export function launchInWindow(deps: TmuxLauncherDeps, opts: LaunchOptions): TaskEither<string, LaunchResult> {
  return deps.run("tmux", ["new-window", "-t", opts.session, "-n", opts.windowName, opts.command], {})
    .map(() => ({ session: opts.session, window: opts.windowName }));
}
```

Note: `TaskEither.flatMap` only accepts an `onRight` callback in this codebase. Do not write `flatMap(onRight, onLeft)` or use `.fold()` as if it returned `TaskEither`. The implementation above uses `run().then(...)` inside `TaskEither.from(...)` to branch on `has-session` success vs failure while preserving the `TaskEither<string, void>` return type.

- Verify: `bun -e 'import "./adws/adws-modules/tmux-launcher.ts"'` resolves without error.
- Verify: `if rg -n 'main\(\)|process\.argv' adws/adws-modules/tmux-launcher.ts; then echo "tmux-launcher module must not contain CLI entrypoint code" >&2; exit 1; fi` — exits 0 only when the module has zero CLI matches.

### Task 2 — Create `adws/adw-launch.ts` (CLI entry point)

Model it on `adw-build.ts`'s structure: `USAGE`, `parseArgs`, `main()`, `import.meta.main` guard.

**`USAGE`** — document all flags + examples (see the Solution Statement CLI shape above).

**`parseArgs`** — launcher flags (`-s/--session`, `-w/--window`, `-t/--script`, `-f/--foreground`, `--resume`) are consumed only before pass-through starts. Pass-through starts at the first non-flag positional, the first unknown flag, or anything after `--`; from that point, preserve all remaining argv values exactly as target-script args. Default session = `tmax`, default script = `adw-plan-review-build-patch.ts`.

`--resume <workspace>` is a launcher convenience alias. It must append `--id <workspace>` to `scriptArgs` and must not pass `--resume` to the target script. Existing adw orchestrators resume with `--id`, so `bun adws/adw-launch.ts --resume 01KVFS25X8` launches the default script with `["--id", "01KVFS25X8"]`.

Unknown flags are not launcher errors; they begin pass-through. For example, `bun adws/adw-launch.ts --chore "logging cleanup"` must pass `["--chore", "logging cleanup"]` to the default target script. Known launcher flags with missing required values are still parse errors.

**`run()` helper** — copy the `run()` helper from `adw-build.ts` (the `spawn` + `TaskEither` wrapper). Used as the `TmuxLauncherDeps.run` injection.

**`main()`** — resolve the script path (error + list available if not found), build the target argv, branch on foreground vs tmux. `resolveScriptPath(script)` must keep the default shorthand ergonomic: a bare script name such as `adw-spec-review.ts` resolves under `adws/`, while a script containing `/` or an absolute path resolves relative to `PROJECT_ROOT` or as the absolute path. That allows the smoke fixture `test/fixtures/adw-launch-smoke.ts` without adding a fake adw pipeline.

Foreground mode must spawn with argv directly (`Bun.spawn(["bun", scriptPath, ...scriptArgs], { cwd: PROJECT_ROOT, stdio: ["inherit", "inherit", "inherit"] })`) so spaces and quotes are preserved without shell parsing. Tmux mode must pass one shell command string to `tmux new-window`; construct it with a small `shellQuote(value: string)` helper and quote `PROJECT_ROOT`, `bun`, `scriptPath`, and every `scriptArgs` value. Do not use `scriptArgs.join(" ")`.

In tmux mode: `ensureTmux → ensureSession → launchInWindow`, then print attach instructions on success.

- Verify: `bun adws/adw-launch.ts --help` prints usage, exit 0.
- Verify: `bun adws/adw-launch.ts -t nonexistent.ts "x"` → error listing available scripts, exit 1.

### Task 3 — Create `test/unit/tmux-launcher.test.ts`

Unit tests for the module using mocked `TmuxLauncherDeps`:

```typescript
function fakeDeps(opts: {
  runResults?: Map<string, Either<string, string>>;  // keyed by "cmd args.join(' ')"
} = {}): TmuxLauncherDeps {
  return {
    run: (cmd, args) => TaskEither.from(async () => {
      const key = `${cmd} ${args.join(" ")}`;
      const preset = opts.runResults?.get(key);
      if (preset) return preset;
      // Default: tmux -V succeeds, has-session succeeds (exists).
      if (key.startsWith("tmux -V")) return Either.right("tmux 3.5a");
      if (key.startsWith("tmux has-session")) return Either.right("");
      if (key.startsWith("tmux new-session")) return Either.right("");
      if (key.startsWith("tmux new-window")) return Either.right("");
      return Either.left(`unexpected command: ${key}`);
    }),
  };
}
```

Tests:
- `ensureTmux` returns Right when `tmux -V` succeeds.
- `ensureTmux` returns Left with install message when `tmux -V` fails.
- `ensureSession` returns Right when `has-session` succeeds (session exists).
- `ensureSession` creates the session when `has-session` fails (asserts `new-session` was called).
- `ensureSession` returns Left when both `has-session` and `new-session` fail.
- `launchInWindow` calls `new-window` with the right args and returns `{ session, window }`.
- `launchInWindow` returns Left when `new-window` fails.

### Task 4 — Create `test/unit/adw-launch.test.ts`

Automated CLI/parser tests for the complex `adw-launch.ts` behavior. Export the smallest testable surface needed from `adw-launch.ts` (at minimum `parseArgs`, `resolveScriptPath`, and command/argv construction helpers if they are split out) while preserving the `import.meta.main` guard for runtime behavior.

Tests:
- Unknown flags start pass-through and are forwarded unchanged, e.g. `--chore "logging cleanup"` becomes `scriptArgs ["--chore", "logging cleanup"]`.
- `--` starts pass-through and preserves everything after it exactly.
- `--resume <workspace>` translates to `scriptArgs ["--id", "<workspace>"]` and does not forward `--resume`.
- Known launcher flags with missing values (`--session`, `--window`, `--script`, `--resume`, and short aliases that require values) return parse errors.
- Foreground mode preserves argv as an array for `Bun.spawn(["bun", scriptPath, ...scriptArgs], ...)`; arguments with spaces are not shell-joined.
- Script path resolution handles a bare adw script name under `adws/`, a relative path such as `test/fixtures/adw-launch-smoke.ts` from `PROJECT_ROOT`, and absolute paths; nonexistent paths still produce the user-facing script-not-found error path.

### Task 5 — Create `test/fixtures/adw-launch-smoke.ts`

Create a harmless fixture for the live tmux smoke test. It must not launch any real adw pipeline or call any LLM tooling.

Behavior:
- Parse fixture-only flags `--marker <path>` and `--signal <name>` before the remaining payload args.
- Write the marker file with JSON containing at least the received payload args and a timestamp.
- Run `tmux wait-for -S <signal>` after the marker file is written so the validation command can wait until the script is actually running inside the tmux window.
- Sleep for at least 30 seconds after signaling. This keeps the tmux window visible long enough for `tmux list-windows -t tmax` to observe `adw-smoke` even when tmux closes windows whose commands exit.
- Exit 0 after the sleep.

### Task 6 — Live smoke test

```bash
# Verify tmux detection + session management + window creation.
tmux list-sessions || true
marker="$(mktemp -t adw-launch-smoke.XXXXXX)"
signal="adw-launch-smoke-$(date +%s)"
bun adws/adw-launch.ts --script test/fixtures/adw-launch-smoke.ts --window adw-smoke -- --marker "$marker" --signal "$signal" "hello world" "path with spaces.md"
tmux wait-for "$signal"
tmux has-session -t tmax
tmux list-windows -t tmax | rg 'adw-smoke'
test -s "$marker"
rg '"hello world"|"path with spaces.md"' "$marker"
```

- Verify: `tmux list-windows -t tmax` shows the new `adw-smoke` window after launch.
- Verify: the window ran `bun test/fixtures/adw-launch-smoke.ts --marker "$marker" --signal "$signal" "hello world" "path with spaces.md"` and exited without launching any real adw pipeline.

### Task 7 — Update `docs/specs/index.md`

Add SPEC-060 entry.

### Task 8 — Run `Validation Commands`

Run every command in the Validation Commands section. All must pass with zero errors.

## Testing Strategy

### Unit Tests

The module (`tmux-launcher.ts`) is fully unit-testable via mocked `TmuxLauncherDeps`. All three functions (`ensureTmux`, `ensureSession`, `launchInWindow`) are tested with canned tmux responses — no real tmux invocation needed.

### Integration Tests

The live smoke test (Task 6) verifies the full flow: real tmux, real session management, real window creation, real script launch. The fixture signals readiness and sleeps before exiting so the tmux window is observable even when tmux is configured to close windows after commands complete.

### Edge Cases

- **tmux not installed** → `ensureTmux` returns Left with install instructions.
- **Session doesn't exist** → `ensureSession` creates it via `new-session -d`.
- **Newly created session has an initial shell window** → accepted behavior for this feature; the pipeline still runs in its own new window.
- **Script not found** → CLI entry point errors listing available scripts.
- **bun not on PATH** → the `bun` in the command string fails inside the tmux window (visible when attaching). A future enhancement could pre-check bun availability.
- **`--` separator** → launcher flags before, script args after.
- **Target-script flags before a positional** → unknown launcher flags such as `--feature`, `--bug`, `--chore`, `--model`, `--max-retries`, `--id`, and `--from-stage` start pass-through and are forwarded unchanged.
- **Spec path with spaces** → must be preserved. Foreground mode preserves it by spawning with argv directly. Tmux mode preserves it by shell-quoting every command component and every target-script arg before building the `tmux new-window` shell command.

## Acceptance Criteria

1. `bun adws/adw-launch.ts "<description>"` launches `adw-plan-review-build-patch.ts` in a new window in the `tmax` tmux session.
2. `bun adws/adw-launch.ts <spec-path>` launches the pipeline on an existing spec.
3. `bun adws/adw-launch.ts --resume <workspace>` resumes an interrupted run by translating to target-script args `--id <workspace>`.
4. `bun adws/adw-launch.ts --script adw-spec-review.ts <spec>` runs a specific stage.
5. `bun adws/adw-launch.ts --session <name>` uses a different tmux session (creates it if missing).
6. `bun adws/adw-launch.ts --foreground` runs in the current terminal without tmux.
7. `bun adws/adw-launch.ts --help` prints clear usage with examples.
8. If tmux is not installed, `ensureTmux` errors with install instructions.
9. If the `tmax` session doesn't exist, `ensureSession` creates it.
10. If the specified script doesn't exist, the CLI errors listing available scripts.
11. The launched window survives the launching terminal closing (detached tmux).
12. `bun run typecheck:src`, `bun run typecheck:test`, and `bun run typecheck` pass with zero errors.
13. All unit tests in `test/unit/tmux-launcher.test.ts` and `test/unit/adw-launch.test.ts` pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

### Static checks
- `bun run typecheck:src` — zero TypeScript errors in source files.
- `bun run typecheck:test` — zero TypeScript errors in test files.
- `bun run typecheck` — zero TypeScript errors.
- `if rg -n 'main\(\)|process\.argv' adws/adws-modules/tmux-launcher.ts; then echo "tmux-launcher module must not contain CLI entrypoint code" >&2; exit 1; fi` — exits 0 only when the module has no CLI.
- `rg -n 'ensureTmux|ensureSession|launchInWindow' adws/adw-launch.ts | awk 'BEGIN{e=1;s=1;l=1} /ensureTmux/{e=0} /ensureSession/{s=0} /launchInWindow/{l=0} END{exit e||s||l}'` — exits 0 only when the CLI imports/uses all three module functions.

### CLI behavior
- `bun adws/adw-launch.ts --help` — prints usage, exit 0.
- `if bun adws/adw-launch.ts -t nonexistent.ts "x" >/tmp/adw-launch-missing.out 2>&1; then echo "expected nonexistent script launch to fail" >&2; exit 1; fi; rg -n 'available|Available|not found|No such' /tmp/adw-launch-missing.out` — exits 0 only when the missing-script path fails and prints a useful error.

### Unit tests
- `bun test test/unit/tmux-launcher.test.ts` — all module tests pass (mocked tmux, no real subprocess).
- `bun test test/unit/adw-launch.test.ts` — all parser/path/argv behavior tests pass.

### Live integration
- `tmux list-sessions || true` — records existing tmux sessions without requiring `tmax` to exist yet.
- `tmux list-windows -t tmax || true` — records existing windows before launch.
- `marker="$(mktemp -t adw-launch-smoke.XXXXXX)"; signal="adw-launch-smoke-$(date +%s)"; bun adws/adw-launch.ts --script test/fixtures/adw-launch-smoke.ts --window adw-smoke -- --marker "$marker" --signal "$signal" "hello world" "path with spaces.md" && tmux wait-for "$signal" && tmux list-windows -t tmax | rg 'adw-smoke' && test -s "$marker" && rg '"hello world"|"path with spaces.md"' "$marker"` — launches a harmless smoke fixture, waits until it is running, confirms the window exists while the fixture sleeps, and confirms quoted args were preserved.
- `tmux has-session -t tmax` — confirms the launcher created or reused the `tmax` session.

## Notes

**Why an `adws-modules/` module + CLI entry point, not `bin/` bash.** The adw pipeline scripts are all TypeScript. A TS module can share types, use the project's `TaskEither`/`Either` patterns, and be unit-tested with mocked deps. A bash launcher would duplicate project-root resolution, arg parsing, and tmux interaction as untestable strings. The `adws-modules/` directory is exactly where shared adw infrastructure lives (`agent.ts`, `reviewer.ts`, `builder.ts`, `workspace.ts`) — `tmux-launcher.ts` is a natural peer. The CLI entry point (`adw-launch.ts`) matches the `adw-*.ts` dispatcher convention.

**Why the default script is `adw-plan-review-build-patch.ts`.** The user's request: "adw-plan-review-build-patch.ts would be run in that session unless otherwise stated." The `--script` flag overrides for running individual stages.

**The 10-minute ceiling is solved, not worked around.** Previous attempts (resume loops, checkpoint fixes) were workarounds for the ceiling. Running in tmux eliminates the ceiling entirely: the tmux window is a separate process tree that the agent's tool-call timeout cannot reach. The pipeline runs to completion (or fails on its own merits), and the user attaches to watch or checks the workspace state afterward.

**`TaskEither.flatMap` overload note.** The `ensureSession` function needs to branch on `has-session` success vs failure, but `TaskEither.flatMap` in `src/utils/task-either.ts` only accepts an `onRight` callback. Use the `TaskEither.from(() => deps.run(...).run().then(...))` pattern shown in Task 1: `has-session` succeeds → Right; fails → run `new-session`; `new-session` failure → Left with context.

**Not in scope:**
- **Output capture/tee** — the pipeline already writes to `agents/<id>/`. tmux's `capture-pane` can grab terminal output if needed (future enhancement).
- **Status/monitoring** — a future `adw --status` command reading `agents/*/adw-state.json`.
- **Window auto-naming from the description** — currently `adw-<timestamp>`. Future enhancement.
- **Automatic reattach / window auto-close** — the window stays open showing final output. User closes manually.
- **A `bin/adw` thin wrapper** — could be added later (`exec bun adws/adw-launch.ts "$@"`) for PATH convenience, but the primary entry point is the TS file.
