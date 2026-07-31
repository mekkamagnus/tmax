/**
 * @file src/server/sweep.ts
 * @description BUG-29 — PID-reviewed sweep of orphaned tmax daemons + stale
 *   socket/lock files. Fills ADR-0117's deferred pre-existing-orphan cleanup.
 *
 *   tmax --sweep              dry-run: list candidates (pid, kind, socket)
 *   tmax --sweep --apply      reap orphans (SIGTERM→grace→SIGKILL) + remove stale
 *   tmax --sweep --force      also include the canonical daemon (off by default)
 *
 * Discovery is PROCESS-driven + PID-reviewed: the process table is scanned for
 * tmax daemons by inspecting each pid's command line (no name-based
 * `pkill`/`killall`). A daemon is canonical if it owns /tmp/tmax-<uid>/server
 * (via lsof) → kept unless --force. A non-canonical live daemon whose parent is
 * gone (reparented to init) is an orphan → reap candidate. Separately, stale
 * lock files (pid dead, or pid alive but no longer a tmax daemon) are removed
 * along with their socket files. The pure classifiers are exported for unit tests.
 */
import { spawnSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'fs';
import { readLockRaw } from './lock-file.ts';
import { userInfo } from 'os';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PsEntry {
  pid: number;
  ppid: number;
  command: string;
}

export type DaemonKind =
  | 'canonical-live' // owns /tmp/tmax-<uid>/server → KEEP (unless --force)
  | 'owned' // live, non-canonical, parent alive (running test/tool) → KEEP
  | 'orphan' // live, non-canonical, reparented to init → reap
  | 'stale-dead' // lock pid is not alive → remove lock + socket
  | 'stale-recycled'; // lock pid is alive but no longer a tmax daemon → remove lock + socket

export interface LockEntry {
  lockFile: string;
  socketPath: string;
  pid: number | undefined;
}

export interface DaemonCandidate {
  pid: number | undefined;
  ppid: number | undefined;
  command: string | undefined;
  socketPath: string | undefined; // from the pid's lock, if any (lockless daemons have none)
  lockFile: string | undefined;
  kind: DaemonKind;
  ageMs: number | undefined;
}

export interface SweepDeps {
  ps: () => PsEntry[];
  canonicalPids: () => Set<number>; // pids owning /tmp/tmax-<uid>/server (lsof)
  kill: (pid: number, sig: string) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  graceMs: number;
}

export interface SweepOptions {
  apply: boolean;
  force: boolean;
  uid: number;
  scanRoot?: string; // default /tmp (injectable for tests)
  deps?: Partial<SweepDeps>;
}

export interface SweepReport {
  candidates: DaemonCandidate[];
  reaped: number[];
  removedLocks: string[];
  removedSockets: string[];
  kept: number;
}

// ---------------------------------------------------------------------------
// PID-reviewed identity
// ---------------------------------------------------------------------------

/**
 * Matches a tmax *daemon* command line: source form `bun …/src/server/server.ts`
 * or installed-binary form `bun …/bin/tmax`. Excludes `tmaxclient`
 * (`bin/tmaxclient` has no word boundary after `tmax`) and the bash launcher
 * (not run under `bun`). This is the only place process identity is decided.
 */
const TMAX_DAEMON_RE = /\bbun\b.*(?:src\/server\/server\.ts|bin\/tmax\b)/;

export function isTmaxDaemonCommand(command: string | undefined): boolean {
  return !!command && TMAX_DAEMON_RE.test(command);
}

export function canonicalSocket(uid: number): string {
  return `/tmp/tmax-${uid}/server`;
}

// ---------------------------------------------------------------------------
// Lock discovery + parsing (for stale-lock cleanup + socket lookup)
// ---------------------------------------------------------------------------

export function findLocks(scanRoot = '/tmp'): string[] {
  const locks: string[] = [];
  let top: string[];
  try {
    top = readdirSync(scanRoot);
  } catch {
    return locks;
  }
  for (const name of top) {
    if (!name.startsWith('tmax')) continue;
    const full = path.join(scanRoot, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isFile()) {
      if (name.endsWith('.lock')) locks.push(full);
    } else if (st.isDirectory()) {
      collectLocksRecursive(full, locks, 0, 3);
    }
  }
  return locks;
}

function collectLocksRecursive(dir: string, out: string[], depth: number, maxDepth: number): void {
  if (depth > maxDepth) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isFile()) {
      if (name.endsWith('.lock')) out.push(full);
    } else if (st.isDirectory()) {
      collectLocksRecursive(full, out, depth + 1, maxDepth);
    }
  }
}

export function readLock(lockFile: string): LockEntry {
  const inferred = lockFile.endsWith('.lock') ? lockFile.slice(0, -'.lock'.length) : lockFile;
  const raw = readLockRaw(lockFile);
  if (!raw) return { lockFile, socketPath: inferred, pid: undefined };
  const pid = typeof raw.pid === 'number' ? raw.pid : undefined;
  const socketPath = typeof raw.socketPath === 'string' ? raw.socketPath : inferred;
  return { lockFile, socketPath, pid };
}

// ---------------------------------------------------------------------------
// Classification (pure — unit-tested with mock ps + canonical sets)
// ---------------------------------------------------------------------------

/** Classify a LIVE tmax daemon (caller has already confirmed isTmaxDaemonCommand). */
export function classifyLiveDaemon(entry: PsEntry, psMap: Map<number, PsEntry>, canonicalPids: Set<number>): DaemonKind {
  if (canonicalPids.has(entry.pid)) return 'canonical-live';
  if (entry.ppid <= 1) return 'orphan'; // reparented to init
  return psMap.has(entry.ppid) ? 'owned' : 'orphan';
}

/** Classify a LOCK whose pid is NOT a tracked live daemon. */
export function classifyStaleLock(lock: LockEntry, psMap: Map<number, PsEntry>): DaemonKind {
  const pid = lock.pid;
  if (pid === undefined || !Number.isFinite(pid)) return 'stale-dead';
  return psMap.has(pid) ? 'stale-recycled' : 'stale-dead';
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export function discover(opts: { uid: number; scanRoot?: string; deps?: Partial<SweepDeps> }): DaemonCandidate[] {
  const deps = withDefaults(opts.deps, opts.uid);
  const canonical = deps.canonicalPids();
  const psList = deps.ps();
  const psMap = new Map(psList.map((e) => [e.pid, e]));
  const now = deps.now();

  // pid → lock, for socket/lock lookup when reaping live daemons.
  const lockByPid = new Map<number, LockEntry>();
  const allLocks: { entry: LockEntry; mtime: number }[] = [];
  for (const lockFile of findLocks(opts.scanRoot ?? '/tmp')) {
    const entry = readLock(lockFile);
    if (entry.pid !== undefined) lockByPid.set(entry.pid, entry);
    let mtime = now;
    try {
      mtime = statSync(lockFile).mtimeMs;
    } catch {
      /* leave at now */
    }
    allLocks.push({ entry, mtime });
  }

  const out: DaemonCandidate[] = [];
  const livePids = new Set<number>();

  // 1. Live tmax daemons (process-driven, PID-reviewed).
  for (const entry of psList) {
    if (!isTmaxDaemonCommand(entry.command)) continue;
    livePids.add(entry.pid);
    const kind = classifyLiveDaemon(entry, psMap, canonical);
    const lock = lockByPid.get(entry.pid);
    out.push({
      pid: entry.pid,
      ppid: entry.ppid,
      command: entry.command,
      socketPath: lock?.socketPath,
      lockFile: lock?.lockFile,
      kind,
      ageMs: undefined,
    });
  }

  // 2. Stale locks whose pid is not a tracked live daemon.
  for (const { entry, mtime } of allLocks) {
    if (entry.pid !== undefined && livePids.has(entry.pid)) continue; // covered by a live daemon
    const kind = classifyStaleLock(entry, psMap);
    out.push({
      pid: entry.pid,
      ppid: undefined,
      command: undefined,
      socketPath: entry.socketPath,
      lockFile: entry.lockFile,
      kind,
      ageMs: now - mtime,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Reap
// ---------------------------------------------------------------------------

async function reapPid(pid: number, deps: SweepDeps): Promise<boolean> {
  const alive = (): boolean => {
    try {
      deps.kill(pid, '0');
      return true;
    } catch {
      return false;
    }
  };
  if (!alive()) return true;
  try {
    deps.kill(pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  const deadline = deps.now() + deps.graceMs;
  while (deps.now() < deadline) {
    if (!alive()) return true;
    await deps.sleep(50);
  }
  if (alive()) {
    try {
      deps.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
    await deps.sleep(50);
  }
  return !alive();
}

function removeFile(p: string | undefined, bucket: string[]): void {
  if (!p) return;
  try {
    if (existsSync(p)) {
      unlinkSync(p);
      bucket.push(p);
    }
  } catch {
    /* best-effort */
  }
}

async function reapCandidate(c: DaemonCandidate, deps: SweepDeps, report: SweepReport): Promise<void> {
  // Signal only a LIVE tmax daemon that should be reaped: an orphan, or a
  // canonical daemon when runSweep passed --force (the only path that calls us
  // for canonical-live). stale-recycled pids are NOT signalled — they belong to
  // an unrelated recycled process; only their stale lock/socket files go.
  if ((c.kind === 'orphan' || c.kind === 'canonical-live') && c.pid !== undefined) {
    if (await reapPid(c.pid, deps)) report.reaped.push(c.pid);
  }
  removeFile(c.socketPath, report.removedSockets);
  removeFile(c.lockFile, report.removedLocks);
}

export async function runSweep(opts: SweepOptions): Promise<SweepReport> {
  const deps = withDefaults(opts.deps, opts.uid);
  const candidates = discover({ uid: opts.uid, scanRoot: opts.scanRoot, deps: opts.deps });
  const report: SweepReport = {
    candidates,
    reaped: [],
    removedLocks: [],
    removedSockets: [],
    kept: 0,
  };
  for (const c of candidates) {
    if (c.kind === 'canonical-live') {
      if (opts.force) await reapCandidate(c, deps, report);
      else report.kept++;
      continue;
    }
    if (c.kind === 'owned') {
      report.kept++;
      continue;
    }
    if (opts.apply) await reapCandidate(c, deps, report);
  }
  return report;
}

// ---------------------------------------------------------------------------
// Deps defaults (real ps / lsof / process.kill)
// ---------------------------------------------------------------------------

function realPs(): PsEntry[] {
  const res = spawnSync('ps', ['-Ao', 'pid=,ppid=,command='], { encoding: 'utf8' });
  if (res.error || res.status !== 0 || !res.stdout) return [];
  const out: PsEntry[] = [];
  for (const line of res.stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] ?? '' });
  }
  return out;
}

function realCanonicalPids(uid: number): Set<number> {
  const res = spawnSync('lsof', ['-t', '-U', canonicalSocket(uid)], { encoding: 'utf8' });
  if (res.error || res.status !== 0 || !res.stdout?.trim()) return new Set();
  return new Set(
    res.stdout
      .split('\n')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
}

function withDefaults(d: Partial<SweepDeps> | undefined, uid: number): SweepDeps {
  return {
    ps: d?.ps ?? realPs,
    canonicalPids: d?.canonicalPids ?? (() => realCanonicalPids(uid)),
    kill: d?.kill ?? ((pid, sig) => process.kill(pid, sig as NodeJS.Signals)),
    now: d?.now ?? Date.now,
    sleep: d?.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))),
    graceMs: d?.graceMs ?? 3000,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function formatAge(ms: number | undefined): string {
  if (ms === undefined) return '?';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

function printReport(report: SweepReport, opts: SweepOptions): void {
  if (report.candidates.length === 0) {
    console.log('tmax --sweep: no tmax daemons or stale locks found.');
    return;
  }
  for (const c of report.candidates) {
    const pid = c.pid ?? '-';
    const sock = c.socketPath ?? '(no lock)';
    const flag = c.kind === 'canonical-live' ? ' (canonical)' : c.kind === 'owned' ? ' (owned)' : '';
    console.log(`pid ${pid}\tkind=${c.kind}${flag}\tage=${formatAge(c.ageMs)}\tsocket=${sock}`);
  }
  if (opts.apply) {
    console.log(
      `--apply: reaped ${report.reaped.length} orphan(s), ` +
        `removed ${report.removedLocks.length} lock(s) + ${report.removedSockets.length} socket(s), ` +
        `kept ${report.kept} (canonical/owned).`,
    );
  } else {
    const targets = report.candidates.filter(
      (c) => c.kind === 'orphan' || c.kind === 'stale-dead' || c.kind === 'stale-recycled',
    ).length;
    console.log(`dry-run: ${targets} candidate(s) would be swept. Run with --apply to reap.`);
  }
}

function printUsage(): void {
  console.log(
    'Usage: tmax --sweep [--apply] [--force]\n' +
      '  --apply   Reap orphaned daemons and remove stale lock/socket files.\n' +
      '  --force   Also include the canonical daemon on /tmp/tmax-<uid>/server.\n' +
      'PID-reviewed: only confirmed tmax daemons are signalled; the canonical\n' +
      'daemon is never touched without --force.',
  );
}

export async function main(argv: string[]): Promise<number> {
  const uid = userInfo().uid;
  const opts: SweepOptions = { apply: false, force: false, uid };
  for (const a of argv) {
    if (a === '--apply') opts.apply = true;
    else if (a === '--force') opts.force = true;
    else if (a === '-h' || a === '--help') {
      printUsage();
      return 0;
    }
  }
  const report = await runSweep(opts);
  printReport(report, opts);
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
