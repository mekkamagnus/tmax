/**
 * @file stop-sequence.ts
 * @description #276 — the `--stop` sequence. `tmax --stop` used to remotely
 * kill EMBEDDED sessions: the shutdown RPC was sent to whatever held the
 * standard socket, and the SIGTERM fallback signaled lsof's first pid with
 * no verification. The design: the shutdown RPC is REFUSED unless the
 * server was started with `--daemon` (the identity RPC answers
 * {mode, pid}); `--stop` never signals an embedded process.
 *
 * Connection outcomes resolve FIRST (the issue's normative ordering); the
 * PID-reuse race between verification and signal is an ACCEPTED RISK —
 * the verification triple (identity + single-pid lsof + cmdline match)
 * executed immediately before signaling narrows the window to
 * single-digit milliseconds (ADR-0305).
 *
 * All effects are INJECTED (the #251 SweepDeps pattern): the sequence is
 * a pure decision machine the tests drive row by row.
 */

export interface StopDeps {
  socketExists(): boolean;
  /** Connect + ask `server-identity` (1s timeout). Throws/refuses when
   *  the socket is stale; returns null when connected but unresponsive. */
  identity(): Promise<{ mode: "daemon" | "embedded"; pid: number } | null>;
  /** The graceful shutdown RPC (1s timeout). */
  requestShutdown(): Promise<void>;
  close(): void;
  sleep(ms: number): Promise<void>;
  /** Returns true when the socket was removed; false on failure. */
  unlinkSocket(): boolean;
  /** The 250ms recheck: "refused" (ECONNREFUSED again — stale), a
   *  thrown error (a DIFFERENT failure — timeouts/permissions never
   *  confirm staleness), or "accepted". */
  recheckRefusal(): Promise<"refused" | "accepted">;
  socketGone(): boolean;
  /** lsof -t -U on the socket: the pids, or null when lsof is unusable. */
  pidsOnSocket(): string[] | null;
  /** ps -p <pid> -o command= — null when the pid is gone. */
  cmdline(pid: string): string | null;
  signal(pid: string, sig: "SIGTERM"): void;
  pidAlive(pid: string): boolean;
  /** The daemon-path predicate for cmdline verification. */
  isDaemonCmdline(cmd: string): boolean;
}

export interface StopRow {
  stream: "stdout" | "stderr";
  line: string;
}

export interface StopOutcome {
  rows: StopRow[];
  exitCode: number;
}

/** The 8-row output matrix (the issue's table, verbatim lines). */
export const STOP_LINES = {
  notRunning: "Daemon not running",
  staleRemoved: "Stale socket removed",
  stopped: "Daemon stopped",
  stoppedSigterm: "Daemon stopped (SIGTERM)",
  survived: "Warning: daemon did not stop",
  embedded: "embedded tmax session running (not stopped) — --stop targets daemons only",
  unresponsive: "server unresponsive — not signaling, socket left in place",
  ownerChanged: "socket owner changed or pid reused — not signaling",
} as const;

/**
 * The sequence (steps 0–5 per the issue). Returns the rows + exit code;
 * the caller prints (stdout informational, stderr failures).
 */
export async function runStopSequence(deps: StopDeps): Promise<StopOutcome> {
  const out = (stream: StopRow["stream"], line: string): StopOutcome => {
    deps.close(); // every terminal row releases the held connection
    return { rows: [{ stream, line }], exitCode: stream === "stdout" ? 0 : 1 };
  };

  // 0) Socket file ABSENT → not running. STOP.
  if (!deps.socketExists()) return out("stdout", STOP_LINES.notRunning);

  // 1+2) ONE identity ask distinguishes the outcomes: a THROW means the
  // connect was REFUSED (recheck once — a daemon may be mid-start; still
  // refused → stale socket → unlink); NULL means connected-but-silent
  // (unresponsive — the socket is LEFT in place); an object proceeds.
  let identity: Awaited<ReturnType<typeof deps.identity>>;
  try {
    identity = await deps.identity();
  } catch (err) {
    // Only a CONFIRMED refusal unlinks (codex r2 c2: timeouts and
    // permission errors must NOT reach the stale-socket path — they
    // report without removing).
    if (!isRefusal(err)) return out("stderr", STOP_LINES.unresponsive);
    await deps.sleep(250);
    // The recheck must ALSO be a confirmed refusal (codex r3 c1: a
    // refused-then-timeout/permission sequence must NOT unlink — only
    // two ECONNREFUSED confirm staleness; a DIFFERENT error on the
    // recheck is the unresponsive row).
    let recheckErr: "refused" | "accepted";
    try {
      recheckErr = await deps.recheckRefusal();
    } catch {
      return out("stderr", STOP_LINES.unresponsive);
    }
    if (recheckErr === "refused") {
      // The unlink can FAIL (permissions) — report it, never claim
      // success on a live socket (codex r2 c3).
      if (!deps.unlinkSocket()) return out("stderr", STOP_LINES.ownerChanged);
      return out("stdout", STOP_LINES.staleRemoved);
    }
    // Accepted on recheck: ask identity again for the real answer.
    identity = await safeIdentity(deps);
  }
  // FAIL CLOSED (codex r2 c1): only a VALID daemon/embedded identity
  // proceeds — anything malformed is unresponsive, and ONLY an explicit
  // "daemon" ever receives the shutdown RPC.
  if (!isValidIdentity(identity)) return out("stderr", STOP_LINES.unresponsive);

  // 3) Embedded → the row. STOP (never signaled — the original repro).
  //    NOTE the matrix's ONE exception: an INFORMATIONAL stdout line with
  //    exit 1 (--stop did not do what was asked).
  if (identity.mode === "embedded") {
    return { rows: [{ stream: "stdout", line: STOP_LINES.embedded }], exitCode: 1 };
  }

  // 4) Daemon → graceful shutdown RPC; wait 1s; socket gone → success.
  try {
    await deps.requestShutdown();
  } catch { /* surfaced by the socket re-check below */ }
  deps.close();
  await deps.sleep(1000);
  if (deps.socketGone()) return out("stdout", STOP_LINES.stopped);

  // 5) Survives → revalidate: identity + exactly-one lsof pid + cmdline
  //    contains the daemon path. All pass → SIGTERM the verified pid;
  //    wait 1s; dead → escalated. Any failure → not-signaling. STOP.
  const reidentified = await safeIdentity(deps);
  deps.close();
  if (!reidentified || reidentified.mode !== "daemon") return out("stderr", STOP_LINES.ownerChanged);
  // The SAME daemon we identified (a replacement on the socket is
  // owner-changed — never signaled; codex r1 c2).
  if (reidentified.pid !== identity.pid) return out("stderr", STOP_LINES.ownerChanged);
  const pids = deps.pidsOnSocket();
  if (pids === null || pids.length !== 1) return out("stderr", STOP_LINES.ownerChanged);
  const pid = pids[0]!;
  if (String(reidentified.pid) !== pid) return out("stderr", STOP_LINES.ownerChanged);
  const cmd = deps.cmdline(pid);
  if (cmd === null || !deps.isDaemonCmdline(cmd)) return out("stderr", STOP_LINES.ownerChanged);
  try {
    deps.signal(pid, "SIGTERM");
  } catch {
    // The daemon exited between verification and the signal, or a
    // permission failure — a matrix outcome, never an escape (codex
    // r3 c2). Re-derive from liveness: gone IS success here.
    return deps.pidAlive(pid)
      ? out("stderr", STOP_LINES.survived)
      : out("stdout", STOP_LINES.stoppedSigterm);
  }
  await deps.sleep(1000);
  return deps.pidAlive(pid)
    ? out("stderr", STOP_LINES.survived)
    : out("stdout", STOP_LINES.stoppedSigterm);
}

function isRefusal(err: unknown): boolean {
  // CODE-ONLY (codex r3 c1): the message heuristic admitted foreign
  // errors — only the errno confirms a refusal.
  return (err as { code?: string })?.code === "ECONNREFUSED";
}

function isValidIdentity(v: unknown): v is { mode: "daemon" | "embedded"; pid: number } {
  if (!v || typeof v !== "object") return false;
  const o = v as { mode?: unknown; pid?: unknown };
  if (o.mode !== "daemon" && o.mode !== "embedded") return false;
  return typeof o.pid === "number" && Number.isInteger(o.pid) && o.pid > 0;
}

async function safeIdentity(deps: StopDeps): Promise<{ mode: "daemon" | "embedded"; pid: number } | null> {
  try {
    return await deps.identity();
  } catch {
    return null;
  }
}
