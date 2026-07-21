/**
 * process-supervisor.ts — BUG-25: ownership-aware process-tree cleanup for ADW.
 *
 * Ported from the sibling `capoeirasport` repo's BUG-29 reference
 * (`adws/adw-modules/process-supervisor.ts`), adapted to tmax's layout. Every
 * process tree launched by one ADW invocation is owned by a single
 * `ProcessSupervisor` instance so that delegated agent/server descendants are
 * always reaped on completion, timeout, or signal — never stranded reparented
 * to PID 1.
 *
 * Design (preserved from capoeirasport):
 *   - Dependency-free: only `child_process`. POSIX children are process-group
 *     leaders (`detached: true` ⇒ PGID == PID), so `process.kill(-pgid)` reaches
 *     shells, agents, Bun servers, and watchers after their wrapper exits.
 *   - Per-invocation ownership (no global registry of PIDs): each entrypoint
 *     constructs one supervisor and registers signal handlers.
 *   - Single-path settlement: `terminate()` is idempotent and memoized per PID
 *     via the `terminating` map; `shutdown()` is single-flight via one
 *     memoized promise + `AbortController`.
 *   - Graceful escalation: `SIGTERM` → `waitForTreeExit(graceMs)` → `SIGKILL` →
 *     `waitForTreeExit(forceWaitMs)`, awaiting confirmed tree exit.
 *   - `adopt(pid)` resolves an externally-spawned daemon's real PGID via
 *     `ps -o pgid=` so cleanup reaches it whether or not it `setsid`'d.
 *
 * Functional-style note: this module is low-level OS plumbing. It uses
 * `try/catch` only as error boundaries around genuinely imperative OS calls
 * (`spawn`, `process.kill`, `spawnSync`); the public surface returns concrete
 * types that `dispatcher-runtime.ts` wraps in `Either`/`TaskEither` for the
 * functional pipeline. This is the same pattern as `TaskEither.tryCatch`.
 */
import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
} from "child_process";

export interface ShellOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface ManagedRunOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly stdinData?: string;
  readonly timeoutMs?: number;
  /** Keep an intentionally daemonized descendant alive after exit code 0. */
  readonly preserveDescendants?: boolean;
}

export interface ManagedProcess {
  readonly child: ChildProcess;
  readonly pid: number;
}

interface OwnedProcess extends ManagedProcess {
  readonly external: boolean;
  /** Process-group ID to signal. Equals pid for spawned leaders and on Windows. */
  readonly pgid: number;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isMissingProcessError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ESRCH";

/**
 * Resolve the real process-group ID of an externally adopted PID on POSIX.
 *
 * A daemon spawned by another tool (e.g. a future tmux/browser daemon) is not
 * necessarily a group leader: if it did not call `setsid()`, its PGID is its
 * (possibly dead) parent's group, not its own PID. Signalling `-pid` would then
 * ESRCH and miss it, leaking the daemon and its descendants. We ask the OS for
 * the actual PGID instead. `ps` exits non-zero with empty stdout when the PID is
 * already gone; in that case return the PID itself so terminate() observes a
 * dead tree. Windows has no process groups, so the PID is used directly.
 */
function resolvePgid(pid: number): number {
  if (process.platform === "win32") return pid;
  const result = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(`Unable to resolve PGID for PID ${pid}: ${result.error.message}`);
  }
  const pgid = parseInt(result.stdout.trim(), 10);
  if (Number.isInteger(pgid) && pgid > 0) return pgid;
  // ps exits non-zero with empty stdout when the PID no longer exists.
  if (result.status !== 0) return pid;
  throw new Error(
    `Unexpected ps output resolving PGID for PID ${pid}: status=${result.status} stdout=${JSON.stringify(result.stdout)}`
  );
}

/**
 * Owns every process tree launched by one ADW invocation.
 *
 * POSIX children are process-group leaders, which lets cleanup reach shells,
 * agents, Bun servers, and test watchers after their immediate wrapper exits.
 * Externally adopted daemon PIDs have their real process group resolved at
 * adopt time, so cleanup reaches them whether or not they detached into their
 * own session. Windows uses taskkill's exact /T tree targeting.
 */
export class ProcessSupervisor {
  private readonly owned = new Map<number, OwnedProcess>();
  private readonly terminating = new Map<number, Promise<void>>();
  private shutdownPromise: Promise<void> | undefined;
  private readonly controller = new AbortController();

  constructor(
    private readonly graceMs = 1_000,
    private readonly forceWaitMs = 1_000
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  spawn(
    command: string,
    args: readonly string[],
    options: SpawnOptions = {}
  ): ManagedProcess {
    if (this.controller.signal.aborted) {
      throw new Error("ADW process supervisor is shutting down");
    }

    const child = spawn(command, [...args], {
      ...options,
      detached: process.platform !== "win32",
    });
    // Bun can emit ENOENT immediately; keep it handled until run() attaches
    // the result-producing listener below.
    child.on("error", () => undefined);
    if (!child.pid) {
      child.kill("SIGKILL");
      throw new Error(`Unable to obtain PID for managed command: ${command}`);
    }

    // Spawned POSIX children are detached group leaders, so PGID == PID.
    const managed: OwnedProcess = {
      child,
      pid: child.pid,
      external: false,
      pgid: child.pid,
    };
    this.owned.set(managed.pid, managed);
    return managed;
  }

  /** Register an exact daemon PID discovered from output produced by this run.
   *  Resolves the daemon's real process group so cleanup reaches it whether or
   *  not it detached into its own session. */
  adopt(pid: number): ManagedProcess {
    if (!Number.isInteger(pid) || pid <= 1) {
      throw new Error(`Refusing to adopt invalid PID: ${pid}`);
    }
    const existing = this.owned.get(pid);
    if (existing) return existing;
    const managed: OwnedProcess = {
      pid,
      external: true,
      pgid: resolvePgid(pid),
      child: {
        pid,
        kill: (signal?: NodeJS.Signals | number) => process.kill(pid, signal),
      } as ChildProcess,
    };
    this.owned.set(pid, managed);
    return managed;
  }

  async run(
    command: string,
    args: readonly string[],
    options: ManagedRunOptions = {}
  ): Promise<ShellOutput> {
    if (this.controller.signal.aborted) {
      return { stdout: "", stderr: "aborted", exitCode: 1 };
    }

    let managed: ManagedProcess;
    try {
      managed = this.spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      return {
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      };
    }

    const { child } = managed;
    let stdout = "";
    let stderr = "";
    let terminalReason: "timeout" | "aborted" | undefined;
    let settled = false;

    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    if (options.stdinData !== undefined) child.stdin?.end(options.stdinData);
    else child.stdin?.end();

    return await new Promise<ShellOutput>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = async (code: number | null, error?: Error): Promise<void> => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.controller.signal.removeEventListener("abort", onAbort);
        const preserve = options.preserveDescendants && !terminalReason && !error && code === 0;
        if (preserve) this.owned.delete(managed.pid);
        else await this.terminate(managed);
        const reason = terminalReason;
        resolve({
          stdout,
          stderr: error?.message ?? (stderr || reason || ""),
          exitCode: reason || error ? 1 : (code ?? 1),
        });
      };

      const stop = (reason: "timeout" | "aborted"): void => {
        if (settled || terminalReason) return;
        terminalReason = reason;
        void this.terminate(managed).then(() => finish(null));
      };
      const onAbort = (): void => stop("aborted");

      child.once("close", (code) => { void finish(code); });
      child.once("error", (error) => { void finish(null, error); });
      this.controller.signal.addEventListener("abort", onAbort, { once: true });
      if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => stop("timeout"), options.timeoutMs);
      }
    });
  }

  /** Execute a bounded finalizer after the primary supervisor was aborted. */
  async runCleanup(
    command: string,
    args: readonly string[],
    options: ManagedRunOptions = {}
  ): Promise<ShellOutput> {
    const cleanupSupervisor = new ProcessSupervisor(this.graceMs, this.forceWaitMs);
    try {
      return await cleanupSupervisor.run(command, args, options);
    } finally {
      await cleanupSupervisor.shutdown();
    }
  }

  /**
   * Gracefully terminate one owned tree: SIGTERM → grace → SIGKILL → force-wait.
   * Idempotent and memoized per PID via the `terminating` map so concurrent
   * callers (timeout + shutdown + abort) share one termination.
   */
  async terminate(managed: ManagedProcess): Promise<void> {
    const inFlight = this.terminating.get(managed.pid);
    if (inFlight) return inFlight;
    const owned = this.owned.get(managed.pid);
    if (!owned) return;

    const termination = (async () => {
      if (this.treeAlive(owned.pgid)) {
        this.signalTree(owned.pgid, "SIGTERM", false);
        const graceful = await this.waitForTreeExit(owned.pgid, this.graceMs);
        if (!graceful) {
          this.signalTree(owned.pgid, "SIGKILL", true);
          await this.waitForTreeExit(owned.pgid, this.forceWaitMs);
        }
      }
      this.owned.delete(owned.pid);
    })().finally(() => this.terminating.delete(owned.pid));
    this.terminating.set(managed.pid, termination);
    return termination;
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.controller.abort();
    this.shutdownPromise = Promise.all(
      [...this.owned.values()].map((managed) => this.terminate(managed))
    ).then(() => undefined);
    return this.shutdownPromise;
  }

  /** True if any process in the group (POSIX) or the root PID (Windows) is alive. */
  treeAlive(pgid: number): boolean {
    try {
      process.kill(process.platform === "win32" ? pgid : -pgid, 0);
      return true;
    } catch (error) {
      return !isMissingProcessError(error);
    }
  }

  /** Signal the whole process group (POSIX) or the PID tree via taskkill /T (Windows). */
  private signalTree(pgid: number, signal: NodeJS.Signals, force: boolean): void {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pgid), "/T", ...(force ? ["/F"] : [])], {
        stdio: "ignore",
      });
      return;
    }
    try {
      process.kill(-pgid, signal);
    } catch (error) {
      if (!isMissingProcessError(error)) throw error;
    }
  }

  private async waitForTreeExit(pgid: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.treeAlive(pgid)) return true;
      await delay(20);
    }
    return !this.treeAlive(pgid);
  }
}

// ---------------------------------------------------------------------------
// Active supervisor — process-lifetime invocation ownership.
//
// Set once by `runAdwEntrypoint` before the runner's `main` runs, cleared in
// its `finally`. `dispatcher-runtime.ts` reads it so the shared `runRaw`/
// `spawnStage` helpers delegate spawn+cleanup to the invocation's supervisor
// without threading an argument through every call site. This is the single
// deliberate module-level resource (exactly what `process.env` already is), not
// a swappable service locator: one invocation owns one supervisor.
// ---------------------------------------------------------------------------
let activeSupervisor: ProcessSupervisor | undefined;

export function setActiveSupervisor(supervisor: ProcessSupervisor | undefined): void {
  activeSupervisor = supervisor;
}

export function getActiveSupervisor(): ProcessSupervisor | undefined {
  return activeSupervisor;
}

export interface EntrypointOptions {
  readonly label: string;
  /** The runner's main. Receives the invocation supervisor (may be ignored —
   *  the supervisor is also reachable via `getActiveSupervisor()`). */
  readonly main: (supervisor: ProcessSupervisor) => Promise<number>;
}

/**
 * Run an ADW executable with early signal handling and awaited final cleanup.
 *
 * Registers `SIGINT`/`SIGTERM` before `main`, awaits `shutdown()` of every
 * owned tree in `finally`, and preserves the conventional 130/143 exit codes.
 *
 * Force-exit backstop: the signal handler awaits `shutdown()` then calls
 * `process.exit(code)`. This is required because some runners' `main` never
 * resolves (e.g. `adw-watchdog` polls forever via `setInterval` and exits only
 * by signal) — for those, the `finally` below never runs, so the handler itself
 * must reap owned trees and exit. For one-shot runners the `finally` path sets
 * `process.exitCode` and the handler is removed before natural drain.
 */
export async function runAdwEntrypoint(options: EntrypointOptions): Promise<void> {
  const supervisor = new ProcessSupervisor();
  let signalExitCode: number | undefined;
  let mainDone = false;

  const handleSignal = (exitCode: number): void => {
    signalExitCode ??= exitCode;
    if (mainDone) return; // `finally` is already (about to) run(ning) cleanup.
    // main is still pending (interrupt mid-run, or a never-resolving main):
    // reap owned trees then force-exit with the conventional code.
    void supervisor.shutdown().finally(() => {
      process.exit(signalExitCode ?? exitCode);
    });
  };
  const onSigInt = (): void => handleSignal(130);
  const onSigTerm = (): void => handleSignal(143);
  process.once("SIGINT", onSigInt);
  process.once("SIGTERM", onSigTerm);

  let exitCode = 1;
  setActiveSupervisor(supervisor);
  try {
    const probeMode = process.env.ADW_PROCESS_CLEANUP_PROBE;
    exitCode = probeMode
      ? await runCleanupProbe(supervisor, options.label, probeMode)
      : await options.main(supervisor);
  } catch (error) {
    console.error(`[${options.label}]`, error instanceof Error ? error.message : error);
    exitCode = 1;
  } finally {
    mainDone = true;
    await supervisor.shutdown();
    setActiveSupervisor(undefined);
    process.removeListener("SIGINT", onSigInt);
    process.removeListener("SIGTERM", onSigTerm);
    process.exitCode = signalExitCode ?? exitCode;
  }
}

/**
 * Env-gated test-only probe (ADW_PROCESS_CLEANUP_PROBE=signal|success) so
 * lifecycle tests can exercise each runner's cleanup path without invoking real
 * Claude/Codex/GitHub. Emits `adw-process-cleanup-probe` in every spawned
 * process's argv so the validation grep (`ps … | rg adw-process-cleanup-probe`)
 * detects any survivor.
 */
async function runCleanupProbe(
  supervisor: ProcessSupervisor,
  label: string,
  mode: string
): Promise<number> {
  // The marker appears in every spawned process's argv so `ps … | rg <marker>`
  // detects any survivor. Defaults to the spec validation string; tests pass a
  // per-process-unique marker via ADW_PROCESS_CLEANUP_PROBE_MARKER so concurrent
  // test files don't observe each other's probe processes.
  const MARKER = process.env.ADW_PROCESS_CLEANUP_PROBE_MARKER || "adw-process-cleanup-probe";
  // Grandchild ignores SIGTERM (exercises force-escalation) and stays alive.
  const grandchildCode = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
  const childCode = [
    "const {spawn}=require('child_process')",
    `const child=spawn(process.execPath,['-e',${JSON.stringify(grandchildCode)},${JSON.stringify(MARKER + "-grandchild")}],{stdio:'ignore'})`,
    `process.stdout.write('[adw-cleanup-probe] ${label} parent='+process.pid+' child='+child.pid+'\\n')`,
    mode === "success" ? "process.exit(0)" : "setInterval(()=>{},1000)",
  ].join(";");

  if (mode === "success") {
    // Child spawns grandchild then exits 0; supervisor must reap the grandchild.
    const result = await supervisor.run(process.execPath, ["-e", childCode, MARKER], {
      timeoutMs: 5_000,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    return result.exitCode;
  }

  // Signal mode: child + grandchild both run forever until the runner receives
  // a signal, at which point runAdwEntrypoint's handler shuts the supervisor.
  const managed = supervisor.spawn(process.execPath, ["-e", childCode, MARKER], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  managed.child.stdout?.pipe(process.stdout);
  managed.child.stderr?.pipe(process.stderr);
  await new Promise<void>((resolve) => {
    if (supervisor.signal.aborted) return resolve();
    supervisor.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  return 0;
}
