#!/usr/bin/env bun
/**
 * adw-launch.ts — run an adw pipeline script inside the `tmax` tmux session.
 *
 * Solves the 10-minute task ceiling and orphaned-process problems: tmux windows
 * persist independently of the launching agent session, so long-running
 * pipelines (30–90 min) complete without being killed, and killing the
 * orchestrator does not orphan the subprocess.
 *
 *   bun adws/adw-launch.ts "<description>"                       # full pipeline, default script
 *   bun adws/adw-launch.ts docs/specs/SPEC-056.md                # review→build→patch on existing spec
 *   bun adws/adw-launch.ts --resume 01KVFS25X8                   # alias for --id 01KVFS25X8
 *   bun adws/adw-launch.ts --session dev "<description>"         # use a different session
 *   bun adws/adw-launch.ts --window review "<description>"       # name the window
 *   bun adws/adw-launch.ts --foreground "<description>"          # don't use tmux; run in this terminal
 *   bun adws/adw-launch.ts --script adw-spec-review.ts <spec>    # run a specific stage
 *   bun adws/adw-launch.ts --chore "logging cleanup"             # pass-through to target script
 *
 * Launcher flags (`-s/--session`, `-w/--window`, `-t/--script`, `-f/--foreground`,
 * `--resume`) are consumed only before pass-through begins. Pass-through starts
 * at the first non-flag positional, the first unknown flag, or anything after
 * `--`; from that point, every remaining argv value is preserved exactly as
 * target-script args. `--resume <id>` translates to `--id <id>` (it never
 * reaches the target script).
 *
 * Default target script: adw-plan-review-build-patch.ts. Override with -t/--script.
 * The tmux logic lives in ./adws-modules/tmux-launcher.ts.
 *
 * Exit codes: 0 = launched (tmux mode) or subprocess exited 0 (foreground mode);
 * 1 = usage error / missing script / tmux failure; foreground preserves the
 * child's exit code otherwise.
 */
import { spawn } from "child_process";
import { existsSync, readdirSync, realpathSync } from "fs";
import { isAbsolute, join } from "path";
import { Either, TaskEither } from "../src/utils/task-either.ts";
import {
  ensureSession,
  ensureTmux,
  launchInWindow,
  type TmuxLauncherDeps,
} from "./adws-modules/tmux-launcher.ts";

const PROJECT_ROOT = realpathSync(join(import.meta.dir, ".."));
const ADWS_DIR = join(PROJECT_ROOT, "adws");

const DEFAULT_SESSION = "tmax";
const DEFAULT_SCRIPT = "adw-plan-review-build-patch.ts";

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

const USAGE = `Usage: bun adws/adw-launch.ts [launcher-flags] [--] [target-script-args...]

Launches an adw pipeline script in a new tmux window inside the \`tmax\` session
(created if missing). The window survives terminal disconnects and agent session
timeouts — long-running pipelines (30–90 min) complete without being killed.

By default the launcher ALSO starts or reuses a long-lived watchdog window
(\`adw-watchdog\`) in the same session that monitors all adw workspaces for
silent stalls/crashes (SPEC-066).

Launcher flags (consumed before pass-through starts):

  -s, --session <name>    tmux session name (default: tmax). Created if missing.
  -w, --window <name>     tmux window name (default: adw-<HHMMSS>).
  -t, --script <path>     target script (default: ${DEFAULT_SCRIPT}).
                            Bare name → adws/<name>; path with "/" → PROJECT_ROOT-relative;
                            absolute path → as-is.
  -f, --foreground        run in the current terminal (no tmux).
      --resume <id>       convenience alias: append \`--id <id>\` to target args
                          (the orchestrators resume with --id; --resume is not forwarded).
      --no-watchdog       skip launching/reusing the adw-watchdog window.
      --dry-run           print the orchestrator command and watchdog plan, then exit.

Pass-through: from the first non-flag positional, the first unknown flag, or
anything after \`--\`, every remaining argv value is forwarded to the target
script unchanged. So \`--chore "x"\`, \`--model gpt-5 "x"\`, \`--bug x\` are all
forwarded as-is.

Examples:

  bun adws/adw-launch.ts "add a URL bar to the status line"
  bun adws/adw-launch.ts docs/specs/SPEC-056.md
  bun adws/adw-launch.ts --resume 01KVFS25X8
  bun adws/adw-launch.ts --session dev "<description>"
  bun adws/adw-launch.ts --window review "<description>"
  bun adws/adw-launch.ts --foreground "<description>"
  bun adws/adw-launch.ts --script adw-spec-review.ts <spec>
  bun adws/adw-launch.ts --chore "logging cleanup"
  bun adws/adw-launch.ts --no-watchdog "<description>"
  bun adws/adw-launch.ts --dry-run "<description>"
  bun adws/adw-launch.ts -- --marker /tmp/x --signal ready "hello world"`;

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  session: string;
  script: string;
  window?: string;
  foreground: boolean;
  resume?: string;
  /** Skip launching/reusing the adw-watchdog tmux window (default: watchdog
   * OFF — the watchdog auto-resumes ALL stale workspaces including old/abandoned
   * ones, which causes unintended pipeline runs. Enable explicitly with
   * --watchdog once SPEC-066's resume-allowlist lands. */
  noWatchdog: boolean;
  /** Dry-run mode: print the orchestrator command + watchdog plan, then exit. */
  dryRun: boolean;
  /** Forwarded verbatim to the target script. */
  scriptArgs: string[];
}

/**
 * Launcher flag parser. Consumes only recognized launcher flags before
 * pass-through starts. Pass-through begins at the first unknown flag, the first
 * positional, or the first `--`. `--resume <id>` is translated to
 * `["--id", <id>]` and prepended to scriptArgs after parsing.
 */
export function parseArgs(argv: string[]): Either<string, ParsedArgs> {
  let session = DEFAULT_SESSION;
  let script = DEFAULT_SCRIPT;
  let windowName: string | undefined;
  let foreground = false;
  let resume: string | undefined;
  let noWatchdog = true;
  let dryRun = false;
  const scriptArgs: string[] = [];
  let passthrough = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (passthrough) {
      scriptArgs.push(a);
      continue;
    }

    if (a === "-h" || a === "--help") return Either.left(`__help__:${USAGE}`);
    if (a === "--") {
      passthrough = true;
      continue;
    }

    if (a === "-s" || a === "--session") {
      const val = argv[++i];
      if (val === undefined) return Either.left(`--session requires a value.`);
      session = val;
    } else if (a === "-w" || a === "--window") {
      const val = argv[++i];
      if (val === undefined) return Either.left(`--window requires a value.`);
      windowName = val;
    } else if (a === "-t" || a === "--script") {
      const val = argv[++i];
      if (val === undefined) return Either.left(`--script requires a value.`);
      script = val;
    } else if (a === "-f" || a === "--foreground") {
      foreground = true;
    } else if (a === "--resume") {
      const val = argv[++i];
      if (val === undefined) return Either.left(`--resume requires a value.`);
      resume = val;
    } else if (a === "--no-watchdog") {
      noWatchdog = true;
    } else if (a === "--watchdog") {
      noWatchdog = false;
    } else if (a === "--dry-run") {
      dryRun = true;
    } else {
      // Unknown flag OR positional → start pass-through from this arg.
      passthrough = true;
      scriptArgs.push(a);
    }
  }

  if (resume !== undefined) {
    scriptArgs.unshift("--id", resume);
  }

  // No target args, no resume → nothing to launch.
  if (scriptArgs.length === 0) {
    return Either.left(`__usage__:${USAGE}`);
  }

  return Either.right({
    session,
    script,
    window: windowName,
    foreground,
    resume,
    noWatchdog,
    dryRun,
    scriptArgs,
  });
}

// ---------------------------------------------------------------------------
// Script path resolution + available-script listing
// ---------------------------------------------------------------------------

/**
 * Resolve a script name to an absolute path.
 *
 * - Bare name (no "/") → ${PROJECT_ROOT}/adws/<name>
 * - Path with "/" → ${PROJECT_ROOT}/<path>
 * - Absolute path → as-is
 *
 * Pure path construction — does NOT check existence. main() handles the
 * not-found error path with `listAvailableScripts`.
 */
export function resolveScriptPath(script: string): string {
  if (isAbsolute(script)) return script;
  if (script.includes("/")) return join(PROJECT_ROOT, script);
  return join(ADWS_DIR, script);
}

/** List adws/adw-*.ts scripts, sorted. Empty on read failure. */
export function listAvailableScripts(): string[] {
  try {
    return readdirSync(ADWS_DIR)
      .filter((f) => f.startsWith("adw-") && f.endsWith(".ts"))
      .sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Shell construction helpers (pure, unit-testable)
// ---------------------------------------------------------------------------

/**
 * POSIX single-quote. Every char between two single quotes is literal; a single
 * quote itself is escaped by closing the quote, escaping the single quote, and
 * reopening the quote. Safe to interpolate into a shell command string.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Build the argv for foreground mode: ["bun", scriptPath, ...scriptArgs]. */
export function buildForegroundArgv(scriptPath: string, scriptArgs: string[]): string[] {
  return ["bun", scriptPath, ...scriptArgs];
}

/**
 * Build the shell command string passed to `tmux new-window`. cd into
 * PROJECT_ROOT, then exec bun with the script + args. Each component is
 * shell-quoted so spaces and special chars survive tmux's shell parsing.
 */
export function buildTmuxCommand(projectRoot: string, scriptPath: string, scriptArgs: string[]): string {
  const target = ["bun", scriptPath, ...scriptArgs].map(shellQuote).join(" ");
  return `cd ${shellQuote(projectRoot)} && exec ${target}`;
}

// ---------------------------------------------------------------------------
// Subprocess helper (used as TmuxLauncherDeps.run)
// ---------------------------------------------------------------------------

interface RunOpts {
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Spawn, capture stdout/stderr. Returns TaskEither (lazy, composable).
 * Left = non-zero exit (error = stderr||stdout); Right = trimmed stdout.
 * Copied from adw-build.ts — the canonical run() helper for adws dispatchers.
 */
function run(cmd: string, args: string[], opts: RunOpts = {}): TaskEither<string, string> {
  return TaskEither.from(async () => {
    return await new Promise<Either<string, string>>((resolve) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.on("error", (e) => resolve(Either.left(`failed to spawn ${cmd}: ${e.message}`)));
      child.on("close", (code) => {
        if (code === 0) resolve(Either.right(stdout.trim()));
        else resolve(Either.left((stderr || stdout).trim() || `${cmd} exited with code ${code}`));
      });
    });
  });
}

// ---------------------------------------------------------------------------
// main()
// ---------------------------------------------------------------------------

function defaultWindowName(): string {
  // HHMMSS from ISO — collision-free within a second.
  return `adw-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
}

async function runForeground(scriptPath: string, scriptArgs: string[]): Promise<number> {
  const argv = buildForegroundArgv(scriptPath, scriptArgs);
  try {
    const child = Bun.spawn(argv, {
      cwd: PROJECT_ROOT,
      stdio: ["inherit", "inherit", "inherit"],
    });
    return await child.exited;
  } catch (e) {
    process.stderr.write(`Error: failed to spawn foreground subprocess: ${(e as Error).message}\n`);
    return 1;
  }
}

function runTmux(
  deps: TmuxLauncherDeps,
  session: string,
  window: string,
  scriptPath: string,
  scriptArgs: string[],
): Promise<number> {
  const cmd = buildTmuxCommand(PROJECT_ROOT, scriptPath, scriptArgs);
  const program = ensureTmux(deps)
    .flatMap(() => ensureSession(deps, session))
    .flatMap(() => launchInWindow(deps, { session, windowName: window, command: cmd }));

  return program.run().then((result) => {
    if (Either.isRight(result)) {
      process.stderr.write(`Launched in tmux session '${session}', window '${window}'.\n`);
      process.stderr.write(`  Attach:  tmux attach -t ${session}\n`);
      return 0;
    }
    process.stderr.write(`Error: ${result.left}\n`);
    return 1;
  });
}

// ---------------------------------------------------------------------------
// Watchdog launch/reuse (SPEC-066 Layer 2)
// ---------------------------------------------------------------------------

const WATCHDOG_WINDOW = "adw-watchdog";
const WATCHDOG_SCRIPT = "adw-watchdog.ts";

/**
 * Detect whether a watchdog is already running for the given tmux session.
 * Returns "running" if `tmux has-window` finds `adw-watchdog`, "process" if a
 * stray `bun adws/adw-watchdog.ts` process is alive (e.g. session was renamed),
 * or null if neither. Pure over the injected probe functions; production uses
 * real tmux + real pgrep.
 *
 * pgrep fallback: `tmux list-windows` could miss a watchdog in another session
 * (e.g. the user renamed the session); a stray watchdog process is still useful
 * and should not be duplicated.
 */
export function detectWatchdog(
  tmuxHasWindow: (session: string, window: string) => boolean,
  isWatchdogProcessAlive: () => boolean,
  session: string,
): "window" | "process" | null {
  if (tmuxHasWindow(session, WATCHDOG_WINDOW)) return "window";
  if (isWatchdogProcessAlive()) return "process";
  return null;
}

function tmuxHasWindowProduction(session: string, window: string): boolean {
  // `tmux list-windows -t <session> -F '#{window_name}'` exits 0 with the
  // window list, including the target window if present.
  try {
    const result = Bun.spawnSync({
      cmd: ["tmux", "list-windows", "-t", session, "-F", "#{window_name}"],
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.exitCode !== 0) return false;
    const stdout = result.stdout?.toString("utf8") ?? "";
    return stdout.split("\n").includes(window);
  } catch {
    return false;
  }
}

function isWatchdogProcessAliveProduction(): boolean {
  // `pgrep -f adw-watchdog.ts` exits 0 if any matching process is running.
  try {
    const result = Bun.spawnSync({
      cmd: ["pgrep", "-f", "adws/adw-watchdog.ts"],
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function launchWatchdog(
  deps: TmuxLauncherDeps,
  session: string,
): Promise<{ ok: boolean; error?: string }> {
  const scriptPath = resolveScriptPath(WATCHDOG_SCRIPT);
  const cmd = buildTmuxCommand(PROJECT_ROOT, scriptPath, ["--poll-ms", "60000", "--stale-ms", "600000"]);
  return launchInWindow(deps, { session, windowName: WATCHDOG_WINDOW, command: cmd })
    .run()
    .then((result) =>
      Either.isRight(result)
        ? { ok: true }
        : { ok: false, error: result.left },
    );
}

async function ensureWatchdog(
  deps: TmuxLauncherDeps,
  session: string,
  dryRun: boolean,
): Promise<number> {
  // Dry-run: report what would happen, no side effects.
  if (dryRun) {
    const existing = detectWatchdog(tmuxHasWindowProduction, isWatchdogProcessAliveProduction, session);
    if (existing) {
      process.stderr.write(
        `[dry-run] Watchdog already running (${existing}) in window \`${WATCHDOG_WINDOW}\` — would reuse.\n`,
      );
    } else {
      process.stderr.write(
        `[dry-run] Watchdog launched in window \`${WATCHDOG_WINDOW}\` (planned; not started in dry-run)\n`,
      );
    }
    return 0;
  }

  const existing = detectWatchdog(tmuxHasWindowProduction, isWatchdogProcessAliveProduction, session);
  if (existing) {
    process.stderr.write(`Watchdog already running in window \`${WATCHDOG_WINDOW}\` (${existing}).\n`);
    return 0;
  }

  const r = await launchWatchdog(deps, session);
  if (!r.ok) {
    process.stderr.write(`Warning: failed to launch watchdog: ${r.error}\n`);
    return 1;
  }
  process.stderr.write(`Watchdog launched in window \`${WATCHDOG_WINDOW}\`.\n`);
  return 0;
}

function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));

  if (Either.isLeft(parsed)) {
    if (parsed.left.startsWith("__help__:")) {
      process.stdout.write(parsed.left.slice("__help__:".length) + "\n");
      return Promise.resolve(0);
    }
    if (parsed.left.startsWith("__usage__:")) {
      process.stderr.write(parsed.left.slice("__usage__:".length) + "\n");
      return Promise.resolve(1);
    }
    process.stderr.write(`Error: ${parsed.left}\n`);
    return Promise.resolve(1);
  }

  const {
    session,
    script,
    window: windowName,
    foreground,
    noWatchdog,
    dryRun,
    scriptArgs,
  } = parsed.right;
  const scriptPath = resolveScriptPath(script);
  if (!existsSync(scriptPath)) {
    const available = listAvailableScripts();
    const listing = available.length > 0
      ? `Available scripts under adws/:\n${available.map((s) => `  - ${s}`).join("\n")}`
      : `No scripts found under adws/.`;
    process.stderr.write(`Error: script not found: ${script}\n(resolved to ${scriptPath})\n${listing}\n`);
    return Promise.resolve(1);
  }

  const window = windowName ?? defaultWindowName();

  // Dry-run: print orchestrator command + watchdog plan, then exit.
  if (dryRun) {
    const cmd = foreground
      ? buildForegroundArgv(scriptPath, scriptArgs).join(" ")
      : `tmux new-window -t ${session}: -n ${window} -- ${buildTmuxCommand(PROJECT_ROOT, scriptPath, scriptArgs)}`;
    process.stderr.write(`[dry-run] Orchestrator command:\n  ${cmd}\n`);
    if (!noWatchdog && !foreground) {
      return ensureWatchdog({ run }, session, true);
    }
    if (noWatchdog) process.stderr.write(`[dry-run] Watchdog: skipped (--no-watchdog)\n`);
    if (foreground) process.stderr.write(`[dry-run] Watchdog: skipped (--foreground)\n`);
    return Promise.resolve(0);
  }

  if (foreground) {
    return runForeground(scriptPath, scriptArgs);
  }

  const deps: TmuxLauncherDeps = { run };
  return runTmux(deps, session, window, scriptPath, scriptArgs).then(async (orchestratorExit) => {
    if (orchestratorExit !== 0) return orchestratorExit;
    if (noWatchdog) return orchestratorExit;
    // Long-lived watchdog — best-effort launch; failures don't fail the launcher.
    await ensureWatchdog(deps, session, false);
    return orchestratorExit;
  });
}

// Only auto-run when invoked directly (not when imported by a test).
if (import.meta.main) {
  main().then((code) => process.exit(code));
}
