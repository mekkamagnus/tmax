/**
 * @file test/unit/server-sweep.test.ts
 * @description BUG-29 — unit + integration tests for the tmax daemon sweep.
 *   - isTmaxDaemonCommand: PID-reviewed identity (source + installed-binary
 *     daemons; rejects tmaxclient / bash launcher / unrelated).
 *   - classifyLiveDaemon: canonical-live / owned / orphan (mock ps + canonical).
 *   - classifyStaleLock: stale-dead / stale-recycled.
 *   - runSweep: stale lock+socket removal, canonical-survives, dry-run, and a
 *     deterministic SIGTERM→SIGKILL reap (injectable kill/sleep).
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  isTmaxDaemonCommand,
  classifyLiveDaemon,
  classifyStaleLock,
  runSweep,
  canonicalSocket,
  type LockEntry,
  type PsEntry,
} from '../../src/server/sweep.ts';

const UID = 999999;
const CANONICAL = canonicalSocket(UID); // /tmp/tmax-999999/server — never created on disk

const daemon = (pid: number, ppid: number, cmd = 'bun /repo/src/server/server.ts'): PsEntry => ({
  pid,
  ppid,
  command: cmd,
});
const psMap = (entries: PsEntry[]): Map<number, PsEntry> => new Map(entries.map((e) => [e.pid, e]));

describe('sweep — isTmaxDaemonCommand (BUG-29)', () => {
  test('matches source + installed-binary daemons', () => {
    expect(isTmaxDaemonCommand('bun /repo/src/server/server.ts')).toBe(true);
    expect(isTmaxDaemonCommand('bun /home/u/.bun/bin/tmax')).toBe(true);
  });
  test('rejects tmaxclient, the bash launcher, the TUI client, and undefined', () => {
    expect(isTmaxDaemonCommand('bun /repo/bin/tmaxclient')).toBe(false); // no \b after tmax
    expect(isTmaxDaemonCommand('bash /repo/bin/tmax')).toBe(false); // not under bun
    expect(isTmaxDaemonCommand('bun /repo/src/client/tui-client.ts')).toBe(false);
    expect(isTmaxDaemonCommand('node /unrelated/server.ts')).toBe(false);
    expect(isTmaxDaemonCommand(undefined)).toBe(false);
  });
  test('#246: matches the embedded-Steep path and the compiled binary', () => {
    // bin/tmax <file> execs `bun src/main.ts <file>` — one process that binds
    // and serves the daemon socket.
    expect(isTmaxDaemonCommand('bun src/main.ts /tmp/tmax-play.md')).toBe(true);
    expect(isTmaxDaemonCommand('bun /repo/src/main.ts')).toBe(true);
    // #244 single binary: no `bun` in the command line at all.
    expect(isTmaxDaemonCommand('/repo/dist/tmax /tmp/f.md')).toBe(true);
    expect(isTmaxDaemonCommand('./dist/tmax')).toBe(true);
    // boundary: a hypothetical compiled client must not match
    expect(isTmaxDaemonCommand('/repo/dist/tmaxclient --eval 1')).toBe(false);
    // gate round 1: suffixed lookalikes must not match — `main.ts` is a stock
    // Bun entrypoint name and this regex decides process SIGNING; an
    // unrelated `bun src/main.tsx` service reparented to init would otherwise
    // be classified orphan and SIGKILLed by --apply.
    expect(isTmaxDaemonCommand('bun src/main.tsx')).toBe(false);
    expect(isTmaxDaemonCommand('bun run build --entry src/main.tsx')).toBe(false);
    expect(isTmaxDaemonCommand('bun --watch src/main.ts.bak')).toBe(false);
    expect(isTmaxDaemonCommand('bun src/server/server.tsx')).toBe(false);
    // …while a trailing flag/arg on the real entrypoints still matches.
    expect(isTmaxDaemonCommand('bun src/main.ts --init-file /tmp/i.tlisp')).toBe(true);
    expect(isTmaxDaemonCommand('bun src/server/server.ts --socket /tmp/s')).toBe(true);
  });
});

describe('sweep — classifyLiveDaemon (BUG-29)', () => {
  test('canonical-live: owns the canonical socket', () => {
    expect(classifyLiveDaemon(daemon(100, 1), psMap([daemon(100, 1)]), new Set([100]))).toBe('canonical-live');
  });
  test('owned: non-canonical daemon whose parent is alive', () => {
    const ps = [daemon(200, 50), daemon(50, 1)];
    expect(classifyLiveDaemon(daemon(200, 50), psMap(ps), new Set<number>())).toBe('owned');
  });
  test('orphan: non-canonical daemon reparented to init (ppid ≤ 1)', () => {
    expect(classifyLiveDaemon(daemon(300, 1), psMap([daemon(300, 1)]), new Set<number>())).toBe('orphan');
  });
  test('orphan: non-canonical daemon whose parent is dead', () => {
    expect(classifyLiveDaemon(daemon(301, 9999), psMap([daemon(301, 9999)]), new Set<number>())).toBe('orphan');
  });
});

describe('sweep — classifyStaleLock (BUG-29)', () => {
  const lock = (pid: number | undefined): LockEntry => ({ lockFile: 'x.lock', socketPath: '/tmp/other', pid });
  test('stale-dead: lock pid is not in the process table', () => {
    expect(classifyStaleLock(lock(400), psMap([]))).toBe('stale-dead');
  });
  test('stale-recycled: pid is alive but no longer a tmax daemon', () => {
    expect(classifyStaleLock(lock(500), psMap([{ pid: 500, ppid: 1, command: 'other' }]))).toBe('stale-recycled');
  });
  test('stale-dead: pid-less / unreadable lock', () => {
    expect(classifyStaleLock(lock(undefined), psMap([]))).toBe('stale-dead');
  });
});

describe('sweep — runSweep (BUG-29)', () => {
  let tmp: string;
  const spawned: ChildProcess[] = [];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tmax-sweep-test-'));
  });
  afterEach(() => {
    for (const c of spawned.splice(0)) {
      try { c.kill('SIGKILL'); } catch { /* gone */ }
    }
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* fine */ }
  });

  const plantLock = (rel: string, json: Record<string, unknown>): void => {
    const p = join(tmp, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(json));
  };
  const plantFile = (rel: string): string => {
    const p = join(tmp, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, '');
    return p;
  };

  test('--apply removes stale-dead lock + socket and keeps canonical-live', async () => {
    plantLock('tmax-canon/server.lock', { pid: 100, socketPath: CANONICAL, startedAt: 'x', cwd: 'x' });
    const staleSocket = plantFile('tmax-stale.sock');
    plantLock('tmax-stale.sock.lock', { pid: 400, socketPath: staleSocket, startedAt: 'x', cwd: 'x' });
    // pid 100 is a live tmax daemon owning the canonical socket → canonical-live.
    // pid 400 is absent → stale-dead.
    const deps = { ps: () => [daemon(100, 1)], canonicalPids: () => new Set<number>([100]) };

    const report = await runSweep({ apply: true, force: false, uid: UID, scanRoot: tmp, deps });

    expect(report.kept).toBe(1); // canonical-live
    expect(report.removedLocks).toEqual([join(tmp, 'tmax-stale.sock.lock')]);
    expect(report.removedSockets).toEqual([staleSocket]);
    expect(existsSync(join(tmp, 'tmax-canon/server.lock'))).toBe(true); // canonical kept
    expect(existsSync(staleSocket)).toBe(false);
  });

  test('dry-run removes nothing', async () => {
    const staleSocket = plantFile('tmax-d.sock');
    plantLock('tmax-d.sock.lock', { pid: 9999, socketPath: staleSocket, startedAt: 'x', cwd: 'x' });

    const report = await runSweep({
      apply: false,
      force: false,
      uid: UID,
      scanRoot: tmp,
      deps: { ps: () => [], canonicalPids: () => new Set<number>() },
    });

    expect(report.removedLocks).toEqual([]);
    expect(report.removedSockets).toEqual([]);
    expect(existsSync(join(tmp, 'tmax-d.sock.lock'))).toBe(true);
    expect(existsSync(staleSocket)).toBe(true);
  });

  test('--apply does NOT kill a stale-recycled pid (only removes its stale files)', async () => {
    // pid 600 is alive but is NOT a tmax daemon — must not be signalled.
    const other = spawn('sleep', ['30'], { stdio: 'ignore' });
    spawned.push(other);
    await new Promise((r) => setTimeout(r, 200));
    const pid = other.pid!;
    const staleSocket = plantFile('tmax-r.sock');
    plantLock('tmax-r.sock.lock', { pid, socketPath: staleSocket, startedAt: 'x', cwd: 'x' });
    const deps = { ps: () => [{ pid, ppid: 1, command: 'sleep 30' }], canonicalPids: () => new Set<number>() };

    const report = await runSweep({ apply: true, force: false, uid: UID, scanRoot: tmp, deps });

    expect(report.reaped).toEqual([]); // never signalled
    expect(report.removedLocks).toEqual([join(tmp, 'tmax-r.sock.lock')]); // stale files removed
    expect(() => process.kill(pid, 0)).not.toThrow(); // unrelated process still alive
  });

  test('--apply reaps an orphan via SIGTERM→SIGKILL escalation (deterministic)', async () => {
    // Deterministic: inject kill + sleep so reapPid's escalation is exercised
    // without a real (zombie-prone, test-parented) process. A real orphan has
    // ppid=1 and init reaps it instantly; here pid 777 is "alive until SIGKILL".
    let killed = false;
    const signals: string[] = [];
    plantFile('tmax-orphan/server');
    plantLock('tmax-orphan/server.lock', {
      pid: 777,
      socketPath: join(tmp, 'tmax-orphan/server'),
      startedAt: 'x',
      cwd: 'x',
    });
    const deps = {
      ps: () => [daemon(777, 1)], // reparented to init → orphan
      canonicalPids: () => new Set<number>(),
      kill: (_pid: number, sig: string) => {
        if (sig === '0') {
          if (killed) throw new Error('ESRCH'); // signal-0 liveness probe
          return;
        }
        signals.push(sig);
        if (sig === 'SIGKILL') killed = true; // SIGTERM ignored, SIGKILL ends it
      },
      now: () => Date.now(),
      sleep: async () => {
        /* fast-forward the grace window */
      },
      graceMs: 50,
    };

    const report = await runSweep({ apply: true, force: false, uid: UID, scanRoot: tmp, deps });

    expect(report.reaped).toContain(777);
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']); // ignored TERM → escalated to KILL
    expect(existsSync(join(tmp, 'tmax-orphan/server.lock'))).toBe(false); // files cleaned
  });

  test('--force reaps the canonical daemon too', async () => {
    const PID = 900000; // a non-existent pid (avoids touching any real process)
    plantLock('tmax-canon/server.lock', { pid: PID, socketPath: CANONICAL, startedAt: 'x', cwd: 'x' });
    const deps = { ps: () => [daemon(PID, 1)], canonicalPids: () => new Set([PID]) };

    const report = await runSweep({ apply: true, force: true, uid: UID, scanRoot: tmp, deps });

    // pid is not a real process → reapPid's signal-0 probe throws → dead immediately.
    expect(report.kept).toBe(0);
    expect(report.reaped).toContain(PID);
    expect(report.removedLocks).toEqual([join(tmp, 'tmax-canon/server.lock')]);
  });

  test('#246: live embedded-Steep session (bun src/main.ts) is canonical-live, not stale-recycled', async () => {
    // The live repro: `bin/tmax file` → `bun src/main.ts file` owning the
    // canonical socket. Pre-fix the RE missed it → livePids skipped it → its
    // lock classified stale-recycled → --apply unlinked the LIVE socket.
    plantLock('tmax-canon/server.lock', { pid: 200, socketPath: CANONICAL, startedAt: 'x', cwd: 'x' });
    const deps = { ps: () => [daemon(200, 1, 'bun src/main.ts /tmp/f.md')], canonicalPids: () => new Set([200]) };

    const report = await runSweep({ apply: true, force: false, uid: UID, scanRoot: tmp, deps });

    expect(report.kept).toBe(1); // canonical-live
    expect(report.removedLocks).toEqual([]);
    expect(report.removedSockets).toEqual([]);
    expect(existsSync(join(tmp, 'tmax-canon/server.lock'))).toBe(true);
  });

  test('#246: canonical-socket owner with an UNRECOGNIZED command is still canonical-live (structural guard)', async () => {
    // Any future launch path the RE has not learned: as long as the process
    // owns the canonical socket, it must never fall into the stale-lock path.
    plantLock('tmax-canon/server.lock', { pid: 300, socketPath: CANONICAL, startedAt: 'x', cwd: 'x' });
    const deps = { ps: () => [{ pid: 300, ppid: 1, command: '/some/future/entrypoint --serve' }], canonicalPids: () => new Set([300]) };

    const report = await runSweep({ apply: true, force: false, uid: UID, scanRoot: tmp, deps });

    expect(report.kept).toBe(1);
    expect(report.removedLocks).toEqual([]);
    expect(report.removedSockets).toEqual([]);
  });

  test('#246: non-canonical embedded session (custom socket) with live parent → owned → kept', async () => {
    // TMAX_SOCKET set: the embedded session does NOT own the canonical
    // socket, so identity must come from the RE (src/main.ts) — owned (parent
    // alive) → kept under --apply.
    const custom = plantFile('tmax-custom/server');
    plantLock('tmax-custom/server.lock', { pid: 310, socketPath: custom, startedAt: 'x', cwd: 'x' });
    const parent = { pid: 309, ppid: 1, command: 'zsh' };
    const deps = { ps: () => [parent, daemon(310, 309, 'bun src/main.ts /tmp/f.md')], canonicalPids: () => new Set<number>() };

    const report = await runSweep({ apply: true, force: false, uid: UID, scanRoot: tmp, deps });

    expect(report.kept).toBe(1); // owned
    expect(report.removedLocks).toEqual([]);
    expect(existsSync(join(tmp, 'tmax-custom/server.lock'))).toBe(true);
  });
});
