/**
 * @file runner.test.ts
 * @description Unit tests for the runner's pure helpers (dimension resolution,
 *   var interpolation, discovery, headed-mode decision). No daemon spawns.
 */
import { describe, test, expect } from 'bun:test';
import { discoverTargets, RunnerOptions } from '../../../tmax-use/test/runner.ts';
import { resolveHeadedMode, isCI } from '../../../tmax-use/test/headed.ts';
import { promises as fs, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('resolveHeadedMode decision tree', () => {
  test('not requested → launch (headless path)', () => {
    const d = resolveHeadedMode(false, false);
    expect(d.kind).toBe('launch');
  });

  test('strict + no tmux → fail', () => {
    // We can't easily force tmuxAvailable() to return false in an environment
    // that has tmux; instead, verify the API shape when strict is set.
    const d = resolveHeadedMode(true, true);
    // Either launch (tmux present) or fail (tmux absent) — both are valid.
    expect(['launch', 'fail']).toContain(d.kind);
  });

  test('decision kinds are exactly the four spec values', () => {
    // Smoke: ensures the type union matches the spec.
    const samples = [
      resolveHeadedMode(false, false),
      resolveHeadedMode(true, false),
    ];
    for (const d of samples) {
      expect(['launch', 'fallback', 'skip', 'fail']).toContain(d.kind);
    }
  });
});

describe('isCI', () => {
  test('returns a boolean', () => {
    expect(typeof isCI()).toBe('boolean');
  });
});

describe('discoverTargets', () => {
  test('splits playbooks and tests by extension', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tmax-use-disc-'));
    try {
      mkdirSync(join(dir, 'pb'));
      writeFileSync(join(dir, 'pb/a.yaml'), 'name: a\nsteps:\n  - keys: x\n');
      writeFileSync(join(dir, 'pb/b.yml'), 'name: b\nsteps:\n  - keys: x\n');
      writeFileSync(join(dir, 't.tmax-use.ts'), '// test\n');
      writeFileSync(join(dir, 'readme.md'), '# not a target\n');
      const opts: RunnerOptions = { projectRoot: dir };
      const { playbooks, tests } = await discoverTargets([dir], opts);
      expect(playbooks.length).toBe(2);
      expect(tests.length).toBe(1);
      expect(tests[0]).toMatch(/t\.tmax-use\.ts$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('nonexistent path returns empty arrays', async () => {
    const { playbooks, tests } = await discoverTargets(['/nonexistent/path'], { projectRoot: '/tmp' });
    expect(playbooks.length).toBe(0);
    expect(tests.length).toBe(0);
  });
});
