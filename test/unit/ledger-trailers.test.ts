/**
 * @file ledger-trailers.test.ts
 * @description RFC-036 / #323 — tests for the Agent-Run commit-trailer
 *   reader-side check: trailer parsing, window auditing (fixture commits
 *   with/without trailers), and the real-git window reader against a
 *   throwaway fixture repo with dated commits.
 */
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  parseAgentRunTrailers,
  auditCommitTrailers,
  readCommitsSince,
  auditLedgerRunWindow,
  runStartTsOf,
  type CommitInfo,
} from '../../scripts/ledger-trailers.ts';
import { validateLedgerLine, type Validation } from '../../scripts/ledger-schema.ts';

const commit = (over: Partial<CommitInfo>): CommitInfo => ({
  sha: 'deadbee',
  authorDate: '2026-11-20T10:00:00Z',
  subject: 'fix: something',
  body: '',
  ...over,
});

describe('parseAgentRunTrailers', () => {
  test('extracts the trailer from a conventional trailer block', () => {
    const msg = 'feat(x): land it\n\nSome body prose.\n\nAgent-Run: agent-infra-2026-11-20\nCo-Authored-By: Someone <x@y>';
    expect(parseAgentRunTrailers(msg)).toEqual(['agent-infra-2026-11-20']);
  });

  test('no trailer yields an empty list', () => {
    expect(parseAgentRunTrailers('fix: no trailer here\n\njust body')).toEqual([]);
  });

  test('collects multiple Agent-Run trailers', () => {
    const msg = 'chore: joint landing\n\nAgent-Run: tab-a-2026-11-20\nAgent-Run: tab-b-2026-11-20';
    expect(parseAgentRunTrailers(msg)).toEqual(['tab-a-2026-11-20', 'tab-b-2026-11-20']);
  });

  test('malformed trailer lines (trailing prose) are not attributed — they surface as unattributed', () => {
    expect(parseAgentRunTrailers('m\n\nAgent-Run: id-with trailing prose')).toEqual([]);
  });

  test('does not match prose mentions inside a line', () => {
    expect(parseAgentRunTrailers('docs: the Agent-Run: convention explained')).toEqual([]);
  });
});

describe('auditCommitTrailers', () => {
  test('partitions fixture commits: attributed, foreign, unattributed', () => {
    const commits = [
      commit({ sha: 'a1', subject: 'feat: mine', body: 'Agent-Run: agent-infra-2026-11-20' }),
      commit({ sha: 'b2', subject: 'feat: other tab', body: 'Agent-Run: fikra-2026-11-18' }),
      commit({ sha: 'c3', subject: 'fix: forgot the trailer', body: 'oops' }),
      commit({ sha: 'd4', subject: 'merge: main into issue-298' }),
    ];
    const audit = auditCommitTrailers(commits);
    expect(audit.attributed.get('agent-infra-2026-11-20')).toEqual(['a1']);
    expect(audit.attributed.get('fikra-2026-11-18')).toEqual(['b2']);
    expect(audit.unattributed.map((c) => c.sha)).toEqual(['c3', 'd4']);
    expect(audit.window).toHaveLength(4);
  });

  test('a commit naming two ledgers attributes to both', () => {
    const commits = [
      commit({ sha: 'e5', body: 'Agent-Run: a-2026-11-20\nAgent-Run: b-2026-11-20' }),
    ];
    const audit = auditCommitTrailers(commits);
    expect(audit.attributed.get('a-2026-11-20')).toEqual(['e5']);
    expect(audit.attributed.get('b-2026-11-20')).toEqual(['e5']);
    expect(audit.unattributed).toEqual([]);
  });
});

describe('readCommitsSince (real git fixture)', () => {
  const repoFiles: string[] = [];

  const gitIn = (cwd: string, args: string[], env: Record<string, string> = {}): void => {
    const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env } });
    if (r.exitCode !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${new TextDecoder().decode(r.stderr)}`);
    }
  };

  const makeRepo = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'tmax-ledger-trailers-'));
    repoFiles.push(dir);
    gitIn(dir, ['init', '-q']);
    gitIn(dir, ['config', 'user.email', 'ledger-test@example.com']);
    gitIn(dir, ['config', 'user.name', 'Ledger Test']);
    const mk = (name: string, text: string): void => writeFileSync(join(dir, name), text);
    const commitAt = (date: string, msg: string): void => {
      const env = { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
      gitIn(dir, ['add', '-A'], env);
      gitIn(dir, ['commit', '-q', '--allow-empty', '-m', msg], env);
    };
    mk('a.txt', 'before window\n');
    commitAt('2026-11-19T09:00:00Z', 'chore: before the run started');
    mk('b.txt', 'with trailer\n');
    commitAt(
      '2026-11-20T10:00:00Z',
      'feat: landed with attribution\n\nAgent-Run: agent-infra-2026-11-20',
    );
    mk('c.txt', 'without trailer\n');
    commitAt('2026-11-20T11:00:00Z', 'fix: no trailer on this one');
    return dir;
  };

  test('returns only in-window commits, oldest first, bodies intact', () => {
    const repo = makeRepo();
    try {
      const read = readCommitsSince('2026-11-20T00:00:00Z', { cwd: repo });
      if (!read.ok) throw new Error(read.error);
      expect(read.commits).toHaveLength(2);
      expect(read.commits.map((c) => c.subject)).toEqual([
        'feat: landed with attribution',
        'fix: no trailer on this one',
      ]);
      expect(read.commits[0]?.body).toContain('Agent-Run: agent-infra-2026-11-20');
      const audit = auditCommitTrailers(read.commits);
      expect(audit.unattributed.map((c) => c.subject)).toEqual(['fix: no trailer on this one']);
    } finally {
      for (const d of repoFiles) rmSync(d, { recursive: true, force: true });
    }
  }, 30_000);

  test('reports git errors in-band instead of throwing', () => {
    const read = readCommitsSince('2026-11-20T00:00:00Z', { cwd: '/definitely/not/a/repo' });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error).toContain('git log failed');
  });
});

describe('auditLedgerRunWindow', () => {
  const line = (json: string): { line: string; validation: Validation } => ({
    line: json,
    validation: validateLedgerLine(json),
  });

  test('no run-start event is reported in-band', () => {
    const w = auditLedgerRunWindow([line('{"event":"unit-start","ts":"2026-11-20T09:05:00Z","unit":"#322"}')]);
    expect(w.runStartTs).toBeNull();
    expect(w.gitError).toContain('no run-start');
  });

  test('runStartTsOf finds the run-start timestamp', () => {
    expect(runStartTsOf([{ event: 'run-start', ts: '2026-11-20T08:38:00Z' }])).toBe('2026-11-20T08:38:00Z');
    expect(runStartTsOf([{ event: 'landing', ts: '2026-11-20T09:00:00Z' }])).toBeNull();
    expect(runStartTsOf([])).toBeNull();
  });
});
