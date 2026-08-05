import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveLastWorkspaceFile } from '../../src/core/workspace.ts';
import { TmaxServer } from '../../src/server/server.ts';

// BUG-73: the last-workspace marker must derive from the same root as the
// workspace dir (honoring TMAX_WORKSPACE_DIR), not the real HOME. Covers path
// derivation (both branches) and the write path (updateLastWorkspace writes the
// marker under the sandbox, never the real home).

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_WS_DIR = process.env.TMAX_WORKSPACE_DIR;

function uniqueSocket(): string {
  return `/tmp/tmax-lw-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
}

afterEach(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
  if (ORIGINAL_WS_DIR === undefined) delete process.env.TMAX_WORKSPACE_DIR;
  else process.env.TMAX_WORKSPACE_DIR = ORIGINAL_WS_DIR;
});

describe('BUG-73 last-workspace marker honors TMAX_WORKSPACE_DIR', () => {
  test('sandbox: marker resolves under TMAX_WORKSPACE_DIR, not HOME', () => {
    const wsDir = mkdtempSync(join(tmpdir(), 'tmax-lw-ws-'));
    const home = mkdtempSync(join(tmpdir(), 'tmax-lw-home-'));
    process.env.TMAX_WORKSPACE_DIR = wsDir;
    process.env.HOME = home;
    try {
      expect(resolveLastWorkspaceFile()).toBe(join(wsDir, 'last-workspace'));
    } finally {
      rmSync(wsDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('production (TMAX_WORKSPACE_DIR unset): marker is still ~/.config/tmax/last-workspace', () => {
    const home = mkdtempSync(join(tmpdir(), 'tmax-lw-home-'));
    process.env.HOME = home;
    delete process.env.TMAX_WORKSPACE_DIR;
    try {
      expect(resolveLastWorkspaceFile()).toBe(join(home, '.config', 'tmax', 'last-workspace'));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('write path: updateLastWorkspace writes under the sandbox, not the real HOME', async () => {
    const wsDir = mkdtempSync(join(tmpdir(), 'tmax-lw-ws-'));
    const home = mkdtempSync(join(tmpdir(), 'tmax-lw-home-'));
    process.env.TMAX_WORKSPACE_DIR = wsDir;
    process.env.HOME = home;
    const server = new TmaxServer(uniqueSocket(), true);
    try {
      // updateLastWorkspace is private; invoke it for this white-box test of
      // the dormant write path (server.ts:494 — writes this.lastWorkspaceFile).
      await (server as unknown as { updateLastWorkspace: (name: string) => Promise<void> }).updateLastWorkspace('my-workspace');

      const marker = join(wsDir, 'last-workspace');
      expect(existsSync(marker)).toBe(true);
      expect(readFileSync(marker, 'utf-8')).toBe('my-workspace');
      // The real HOME config path is never touched.
      expect(existsSync(join(home, '.config', 'tmax', 'last-workspace'))).toBe(false);
    } finally {
      try { await server.shutdown(); } catch { /* not started — best effort */ }
      rmSync(wsDir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
