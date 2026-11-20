/**
 * @file ledger-spotcheck.test.ts
 * @description RFC-036 / #325 — tests for the claim spot-checker: count
 *   extraction, claim comparison (match / mismatch / error), seeded
 *   sampling reproducibility, and the end-to-end fixture: a real temp git
 *   repo whose sampled landing reproduces green, plus the DOCTORED entry
 *   that must FAIL the comparison (the negative test is the point).
 */
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  extractCounts,
  compareClaim,
  mulberry32,
  sampleLandings,
  runSpotcheck,
} from '../../scripts/ledger-spotcheck.ts';
import { validateLedgerLine } from '../../scripts/ledger-schema.ts';

describe('extractCounts', () => {
  test('parses bun-style summary counts', () => {
    expect(extractCounts(' 23 pass\n 0 fail\nRan 23 tests across 1 file.')).toEqual({ pass: 23, fail: 0 });
  });

  test('takes the LAST counts when output repeats (summary is authoritative)', () => {
    expect(extractCounts(' 2 pass\n 2 pass\n 55 pass\n 1 fail')).toEqual({ pass: 55, fail: 1 });
  });

  test('unparseable output yields nulls — never a guess', () => {
    expect(extractCounts('all green')).toEqual({ pass: null, fail: null });
  });
});

describe('compareClaim', () => {
  test('equal counts match (an honest red compares fine)', () => {
    expect(compareClaim(' 2 pass\n 1 fail', ' 2 pass\n 1 fail').verdict).toBe('match');
  });

  test('doctored pasted counts mismatch', () => {
    const r = compareClaim(' 5 pass\n 0 fail', ' 2 pass\n 0 fail');
    expect(r.verdict).toBe('mismatch');
    expect(r.expected).toBe('5 pass / 0 fail');
    expect(r.actual).toBe('2 pass / 0 fail');
  });

  test('unparseable on either side is error, never a silent match', () => {
    expect(compareClaim('all green', ' 2 pass\n 0 fail').verdict).toBe('error');
    expect(compareClaim(' 2 pass\n 0 fail', 'Killed').verdict).toBe('error');
  });
});

describe('seeded sampling', () => {
  test('same seed → same selection, original order preserved', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const s1 = sampleLandings(items, 3, 42);
    const s2 = sampleLandings(items, 3, 42);
    expect(s1).toEqual(s2);
    expect(s1.length).toBe(3);
    // chronological order: indexes ascending
    const idx = s1.map((x) => items.indexOf(x));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  test('different seeds can differ; n >= length selects all', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(sampleLandings(items, 10, 1)).toEqual(items);
    expect(sampleLandings(items, 0, 1)).toEqual(items);
    const seeds = new Set<string>();
    for (const s of [1, 2, 3, 4, 5]) seeds.add(sampleLandings(items, 3, s).join(','));
    expect(seeds.size).toBeGreaterThan(1);
  });

  test('mulberry32 is deterministic', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: a real fixture repo + fixture ledger
// ---------------------------------------------------------------------------

const gitIn = (cwd: string, args: string[], env: Record<string, string> = {}): void => {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env } });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${new TextDecoder().decode(r.stderr)}`);
};

const TEST_FILE = `import { test, expect } from 'bun:test';
test('two and two', () => { expect(2 + 2).toBe(4); });
test('strings', () => { expect('a' + 'b').toBe('ab'); });
`;

/**
 * Fixture: a temp git repo with one commit containing a real passing test
 * file, plus a ledger with two landings at that sha — one honestly pasted,
 * one DOCTORED (claims 5 pass when the file has 2 tests).
 */
const makeFixture = (): { repo: string; ledger: string } => {
  const repo = mkdtempSync(join(tmpdir(), 'tmax-spotcheck-repo-'));
  gitIn(repo, ['init', '-q']);
  gitIn(repo, ['config', 'user.email', 't@e.com']);
  gitIn(repo, ['config', 'user.name', 'T']);
  writeFileSync(join(repo, 'sum.test.ts'), TEST_FILE);
  const env = { GIT_AUTHOR_DATE: '2026-11-20T10:00:00Z', GIT_COMMITTER_DATE: '2026-11-20T10:00:00Z' };
  gitIn(repo, ['add', '-A'], env);
  gitIn(repo, ['commit', '-q', '-m', 'feat: the test file'], env);
  const shaOut = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: repo, stdout: 'pipe' });
  const sha = new TextDecoder().decode(shaOut.stdout).trim();

  const ledger = join(repo, 'fixture-2026-11-20.jsonl');
  const lines = [
    { event: 'run-start', ts: '2026-11-20T09:00:00Z', label: 'fixture', goal: 'g', model: 'm', 'order-file-ref': 'o' },
    {
      event: 'landing', ts: '2026-11-20T10:05:00Z', unit: '#honest', shas: [sha], 'files-staged-count': 1,
      'tests-run': [{ name: 'bun test sum.test.ts', output: ' 2 pass\n 0 fail' }], 'adr-spec': [],
    },
    {
      event: 'landing', ts: '2026-11-20T10:06:00Z', unit: '#doctored', shas: [sha], 'files-staged-count': 1,
      'tests-run': [{ name: 'bun test sum.test.ts', output: ' 5 pass\n 0 fail' }], 'adr-spec': [],
    },
  ];
  writeFileSync(ledger, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { repo, ledger };
};

describe('runSpotcheck (fixture repo)', () => {
  test('honest landing reproduces; doctored landing MISMATCHES; events append + validate', () => {
    const { repo, ledger } = makeFixture();
    try {
      const r = runSpotcheck(ledger, { sample: 2, seed: 1, cwd: repo });
      if (!r.ok) throw new Error(r.error);
      expect(r.outcomes).toHaveLength(2);
      const honest = r.outcomes.find((o) => o.unit === '#honest');
      const doctored = r.outcomes.find((o) => o.unit === '#doctored');
      expect(honest?.verdict).toBe('match');
      expect(honest?.expected).toBe('2 pass / 0 fail');
      // THE negative test: the doctored claim must FAIL the comparison
      expect(doctored?.verdict).toBe('mismatch');
      expect(doctored?.expected).toBe('5 pass / 0 fail');
      expect(doctored?.actual).toBe('2 pass / 0 fail');
      expect(r.appended).toBe(2);

      // append-only write-back: re-read the ledger, everything validates
      const all = readFileSync(ledger, 'utf8').trim().split('\n');
      expect(all).toHaveLength(5); // 3 original + 2 spotcheck
      all.forEach((line, i) => {
        const v = validateLedgerLine(line);
        if (!v.ok) throw new Error(`line ${i + 1} invalid: ${v.errors.join('; ')}`);
      });
      const spotLines = all.slice(3).map((l) => JSON.parse(l));
      expect(spotLines.map((e) => e.verdict).sort()).toEqual(['match', 'mismatch']);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 120_000);

  test('a landing at an unknown sha reports error (unverified, not disproven)', () => {
    const { repo, ledger } = makeFixture();
    try {
      // overwrite with a landing claiming a sha that does not exist
      const lines = [
        { event: 'run-start', ts: '2026-11-20T09:00:00Z', label: 'fixture', goal: 'g', model: 'm', 'order-file-ref': 'o' },
        {
          event: 'landing', ts: '2026-11-20T10:05:00Z', unit: '#ghost', shas: ['0123456789012345678901234567890123456789'],
          'files-staged-count': 1,
          'tests-run': [{ name: 'bun test sum.test.ts', output: ' 2 pass\n 0 fail' }], 'adr-spec': [],
        },
      ];
      writeFileSync(ledger, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
      const r = runSpotcheck(ledger, { cwd: repo });
      if (!r.ok) throw new Error(r.error);
      expect(r.outcomes[0]?.verdict).toBe('error');
      expect(r.outcomes[0]?.actual).toContain('worktree add failed');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 120_000);

  test('no landings → in-band error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tmax-spotcheck-empty-'));
    try {
      const ledger = join(dir, 'x.jsonl');
      writeFileSync(ledger, JSON.stringify({ event: 'run-start', ts: '2026-11-20T09:00:00Z', label: 'l', goal: 'g', model: 'm', 'order-file-ref': 'o' }) + '\n');
      const r = runSpotcheck(ledger, { cwd: dir });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('no landing events');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
