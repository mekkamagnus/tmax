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
});
