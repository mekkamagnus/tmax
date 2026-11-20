/**
 * @file ledger-report.test.ts
 * @description RFC-036 / #324 — tests for the run-ledger reader: every
 *   benchmark is checked against a hand-computed fixture ledger covering
 *   every event type (including honest-null telemetry), the alarm rows are
 *   asserted, and the CLI is smoked end-to-end (fixture ledger in a temp git
 *   repo for a deterministic trailer audit) plus against the real
 *   agent-infra ledger.
 */
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  computeScorecard,
  renderHuman,
  readLedgerFile,
  type LedgerEvent,
  type InvalidLine,
} from '../../scripts/ledger-report.ts';

// ---------------------------------------------------------------------------
// The canonical fixture: every event type, null telemetry, all alarm paths
// ---------------------------------------------------------------------------

const ev = (event: string, ts: string, fields: Record<string, unknown>): LedgerEvent =>
  ({ event, ts, ...fields }) as LedgerEvent;

const FIXTURE: LedgerEvent[] = [
  ev('run-start', '2026-11-20T09:00:00Z', { label: 'test-run', goal: 'prove the benchmarks', model: 'test-model', 'order-file-ref': 'docs/x.md' }),
  ev('unit-start', '2026-11-20T09:05:00Z', { unit: '#A' }),
  ev('telemetry', '2026-11-20T09:30:00Z', { 'wall-minutes': 30, 'active-minutes': 20, 'in-tokens': 1000, 'out-tokens': 200, 'ctx-remaining-pct': 80 }),
  ev('telemetry', '2026-11-20T10:00:00Z', { 'wall-minutes': 60, 'active-minutes': null, 'in-tokens': null, 'out-tokens': null, 'ctx-remaining-pct': 70 }),
  ev('gate', '2026-11-20T10:10:00Z', { kind: 'verify-gate', verdict: 'GAPS', rounds: 1, 'reviewed-sha': 'aaaa111', 'findings-count': 2 }),
  ev('gate', '2026-11-20T10:30:00Z', { kind: 'verify-gate', verdict: 'GAPS', rounds: 2, 'reviewed-sha': 'bbbb222', 'findings-count': 1 }),
  ev('landing', '2026-11-20T10:40:00Z', { unit: '#A', shas: ['aaaa111'], 'files-staged-count': 3, 'tests-run': [{ name: 't', output: '2 pass\n0 fail' }], 'adr-spec': [] }),
  ev('unit-start', '2026-11-20T10:45:00Z', { unit: '#B' }),
  ev('telemetry', '2026-11-20T11:00:00Z', { 'wall-minutes': 120, 'active-minutes': 90, 'in-tokens': 5000, 'out-tokens': 800, 'ctx-remaining-pct': 40 }),
  ev('escalation', '2026-11-20T11:10:00Z', { reason: 'stalled', action: 'posted handoff' }),
  ev('gate', '2026-11-20T11:20:00Z', { kind: 'codex-grade', verdict: '7/10', rounds: 1, 'reviewed-sha': 'cccc333', 'findings-count': 4 }),
  ev('gate', '2026-11-20T11:40:00Z', { kind: 'codex-grade', verdict: 'FAIL', rounds: 2, 'reviewed-sha': 'dddd444', 'findings-count': 3 }),
  ev('gate', '2026-11-20T12:00:00Z', { kind: 'verify-gate', verdict: 'GAPS', rounds: 3, 'reviewed-sha': 'eeee555', 'findings-count': 2 }),
  ev('gate', '2026-11-20T12:20:00Z', { kind: 'verify-gate', verdict: 'GAPS', rounds: 4, 'reviewed-sha': 'ffff666', 'findings-count': 1 }),
  ev('landing', '2026-11-20T12:30:00Z', { unit: '#B', shas: ['eeee555'], 'files-staged-count': 5, 'tests-run': [{ name: 't', output: '9 pass\n0 fail' }], 'adr-spec': [] }),
  ev('unit-start', '2026-11-20T12:35:00Z', { unit: '#C' }),
  ev('telemetry', '2026-11-20T13:00:00Z', { 'wall-minutes': 240, 'active-minutes': 180, 'in-tokens': 9000, 'out-tokens': 1500, 'ctx-remaining-pct': 18 }),
  ev('landing', '2026-11-20T13:10:00Z', { unit: '#C', shas: ['dddd444'], 'files-staged-count': 1, 'tests-run': [{ name: 't', output: '1 pass\n0 fail' }], 'adr-spec': [] }),
  ev('run-end', '2026-11-20T13:20:00Z', { 'units-accepted': 3, 'units-blocked': 0, totals: { 'wall-minutes': 240, 'in-tokens': 9000, 'out-tokens': 1500 } }),
];

describe('computeScorecard — the five benchmarks (hand-computed fixture)', () => {
  const s = computeScorecard(FIXTURE, { ledgerId: 'test-run-2026-11-20' });

  test('run identity comes from run-start / run-end', () => {
    expect(s.label).toBe('test-run');
    expect(s.goal).toBe('prove the benchmarks');
    expect(s.runStartTs).toBe('2026-11-20T09:00:00Z');
    expect(s.runEndTs).toBe('2026-11-20T13:20:00Z');
    expect(s.totalEvents).toBe(19);
  });

  test('1. cost per accepted outcome: (9000 in + 1500 out) ÷ 3 landed = 3500/unit, coverage 75%', () => {
    expect(s.cost.landedUnits).toBe(3);
    expect(s.cost.inTokens).toBe(9000); // run-end.totals override
    expect(s.cost.outTokens).toBe(1500);
    expect(s.cost.tokensPerUnit).toBe(3500);
    // 3 of 4 telemetry events carried real token numbers (one honest-null)
    expect(s.cost.coveragePct).toBe(75);
  });

  test('2. rework ratio: 6 rounds ÷ 2 gated units = 3.0; #B flagged at round 4', () => {
    expect(s.rework.totalRounds).toBe(6);
    expect(s.rework.gatedUnits).toBe(2);
    expect(s.rework.roundsPerUnit).toBe(3);
    expect(s.rework.flagged).toEqual([{ unit: '#B', rounds: 4 }]);
  });

  test('3. claim verification prints N/A pending the #325 spot-checker', () => {
    expect(s.claimVerification.rate).toBeNull();
    expect(s.claimVerification.status).toBe('pending');
    expect(s.claimVerification.note).toContain('#325');
  });

  test('4. escalation latency: first GAPS gate 10:10 → escalation 11:10 = 60 min', () => {
    expect(s.escalationLatency.state).toBe('measured');
    expect(s.escalationLatency.firstSignalTs).toBe('2026-11-20T10:10:00Z');
    expect(s.escalationLatency.minutes).toBe(60);
  });

  test('5. headroom: escalation at ctx 40 = disciplined; ctx 18 dip unescalated = observed', () => {
    expect(s.headroom.disciplined).toBe(1);
    expect(s.headroom.late).toBe(0);
    expect(s.headroom.ctxBelow25Observed).toBe(true);
  });

  test('alarm rows: rework flag + unescalated ctx dip', () => {
    const details = s.alarms.map((a) => a.detail).join('\n');
    expect(details).toContain('#B reached gate round 4');
    expect(details).toContain('ctx fell below 25% with no escalation');
  });
});

describe('computeScorecard — degenerate and edge fixtures', () => {
  test('all-pass gates → no stall signal, no latency', () => {
    const s = computeScorecard([
      ev('run-start', '2026-11-20T09:00:00Z', { label: 'x', goal: 'g', model: 'm', 'order-file-ref': 'o' }),
      ev('unit-start', '2026-11-20T09:05:00Z', { unit: '#A' }),
      ev('gate', '2026-11-20T10:00:00Z', { kind: 'verify-gate', verdict: 'PASS', rounds: 1, 'reviewed-sha': 'a', 'findings-count': 0 }),
    ]);
    expect(s.escalationLatency.state).toBe('no-stall-signal');
  });

  test('stall signal never escalated → alarm row', () => {
    const s = computeScorecard([
      ev('run-start', '2026-11-20T09:00:00Z', { label: 'x', goal: 'g', model: 'm', 'order-file-ref': 'o' }),
      ev('unit-start', '2026-11-20T09:05:00Z', { unit: '#A' }),
      ev('gate', '2026-11-20T10:00:00Z', { kind: 'verify-gate', verdict: 'FAIL', rounds: 3, 'reviewed-sha': 'a', 'findings-count': 5 }),
    ]);
    expect(s.escalationLatency.state).toBe('never-escalated');
    expect(s.alarms.map((a) => a.detail).join('\n')).toContain('no escalation followed');
  });

  test('escalation before any stall signal is pre-emptive (no latency)', () => {
    const s = computeScorecard([
      ev('run-start', '2026-11-20T09:00:00Z', { label: 'x', goal: 'g', model: 'm', 'order-file-ref': 'o' }),
      ev('escalation', '2026-11-20T09:30:00Z', { reason: 'blocked', action: 'moved on' }),
      ev('unit-start', '2026-11-20T10:00:00Z', { unit: '#A' }),
      ev('gate', '2026-11-20T10:10:00Z', { kind: 'verify-gate', verdict: 'GAPS', rounds: 1, 'reviewed-sha': 'a', 'findings-count': 1 }),
    ]);
    expect(s.escalationLatency.state).toBe('escalated-pre-signal');
    expect(s.escalationLatency.minutes).toBeNull();
  });

  test('escalation when ctx already <= 25 counts as late', () => {
    const s = computeScorecard([
      ev('run-start', '2026-11-20T09:00:00Z', { label: 'x', goal: 'g', model: 'm', 'order-file-ref': 'o' }),
      ev('telemetry', '2026-11-20T09:30:00Z', { 'wall-minutes': 30, 'active-minutes': 20, 'in-tokens': 1, 'out-tokens': 1, 'ctx-remaining-pct': 20 }),
      ev('escalation', '2026-11-20T09:40:00Z', { reason: 'ctx<25%', action: 'too late' }),
    ]);
    expect(s.headroom.late).toBe(1);
    expect(s.headroom.disciplined).toBe(0);
    expect(s.alarms.map((a) => a.detail).join('\n')).not.toContain('no escalation logged');
  });

  test('escalation with no telemetry ever read counts unknown, not late', () => {
    const s = computeScorecard([
      ev('run-start', '2026-11-20T09:00:00Z', { label: 'x', goal: 'g', model: 'm', 'order-file-ref': 'o' }),
      ev('escalation', '2026-11-20T09:40:00Z', { reason: 'stalled', action: 'a' }),
    ]);
    expect(s.headroom.unknown).toBe(1);
  });

  test('no telemetry at all → null cost with an alarm row', () => {
    const s = computeScorecard([
      ev('run-start', '2026-11-20T09:00:00Z', { label: 'x', goal: 'g', model: 'm', 'order-file-ref': 'o' }),
      ev('unit-start', '2026-11-20T09:05:00Z', { unit: '#A' }),
      ev('landing', '2026-11-20T10:00:00Z', { unit: '#A', shas: ['a'], 'files-staged-count': 1, 'tests-run': [{ name: 't', output: '1 pass' }], 'adr-spec': [] }),
    ]);
    expect(s.cost.tokensPerUnit).toBeNull();
    expect(s.cost.coveragePct).toBeNull();
    expect(s.alarms.map((a) => a.detail).join('\n')).toContain('no telemetry events');
  });

  test('invalid lines surface as schema alarms', () => {
    const invalid: InvalidLine[] = [{ lineNo: 7, errors: ["telemetry: field 'wall-minutes' must be a number"] }];
    const s = computeScorecard([ev('run-start', '2026-11-20T09:00:00Z', { label: 'x', goal: 'g', model: 'm', 'order-file-ref': 'o' })], { invalidLines: invalid });
    expect(s.alarms.find((a) => a.benchmark === 'schema')?.detail).toContain('line 7');
  });

  test('telemetry-only token totals used when run-end.totals absent', () => {
    const s = computeScorecard([
      ev('run-start', '2026-11-20T09:00:00Z', { label: 'x', goal: 'g', model: 'm', 'order-file-ref': 'o' }),
      ev('telemetry', '2026-11-20T09:30:00Z', { 'wall-minutes': 30, 'active-minutes': 20, 'in-tokens': 400, 'out-tokens': 100, 'ctx-remaining-pct': 90 }),
      ev('landing', '2026-11-20T10:00:00Z', { unit: '#A', shas: ['a'], 'files-staged-count': 1, 'tests-run': [{ name: 't', output: '1 pass' }], 'adr-spec': [] }),
    ]);
    expect(s.cost.inTokens).toBe(400);
    expect(s.cost.tokensPerUnit).toBe(500);
  });
});

describe('renderHuman', () => {
  test('renders every benchmark section and the alarm rows', () => {
    const out = renderHuman(computeScorecard(FIXTURE, { ledgerId: 'test-run-2026-11-20' }));
    expect(out).toContain('# Run scorecard: test-run-2026-11-20');
    expect(out).toContain('1. Cost per accepted outcome');
    expect(out).toContain('3,500 tokens/unit');
    expect(out).toContain('2. Rework ratio');
    expect(out).toContain('3 rounds/unit');
    expect(out).toContain('#B=4 ⚠');
    expect(out).toContain('N/A — spot-checker lands in #325');
    expect(out).toContain('(60 min)');
    expect(out).toContain('1 disciplined, 0 late');
    expect(out).toContain('⚠ [rework]');
    expect(out).toContain('⚠ [headroom]');
  });
});

// ---------------------------------------------------------------------------
// CLI end-to-end: fixture ledger in a temp git repo (deterministic trailer
// audit), then --json, then the REAL agent-infra ledger smoke.
// ---------------------------------------------------------------------------

const gitIn = (cwd: string, args: string[], env: Record<string, string> = {}): void => {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env } });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${new TextDecoder().decode(r.stderr)}`);
};

const fixtureJsonl = FIXTURE.map((e) => JSON.stringify(e)).join('\n') + '\n';

const repoRoot = join(import.meta.dir, '..', '..');
const scriptPath = join(repoRoot, 'scripts', 'ledger-report.ts');

const runCli = (
  args: string[],
  cwd: string,
): { exitCode: number; stdout: string } => {
  const r = Bun.spawnSync(['bun', scriptPath, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exitCode: r.exitCode, stdout: new TextDecoder().decode(r.stdout) };
};

describe('ledger-report CLI', () => {
  test('renders the fixture ledger end-to-end with trailer audit from a temp repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tmax-ledger-report-'));
    try {
      // a git repo whose window contains one attributed + one unattributed commit
      gitIn(dir, ['init', '-q']);
      gitIn(dir, ['config', 'user.email', 't@e.com']);
      gitIn(dir, ['config', 'user.name', 'T']);
      const env = { GIT_AUTHOR_DATE: '2026-11-20T10:50:00Z', GIT_COMMITTER_DATE: '2026-11-20T10:50:00Z' };
      gitIn(dir, ['commit', '-q', '--allow-empty', '-m', 'feat: attributed\n\nAgent-Run: test-run-2026-11-20'], env);
      gitIn(dir, ['commit', '-q', '--allow-empty', '-m', 'fix: no trailer'], env);
      writeFileSync(join(dir, 'test-run-2026-11-20.jsonl'), fixtureJsonl);

      const { exitCode, stdout } = runCli(['test-run-2026-11-20.jsonl'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('# Run scorecard: test-run-2026-11-20');
      expect(stdout).toContain('3,500 tokens/unit');
      expect(stdout).toContain('1 commit(s) attributed to this ledger');
      expect(stdout).toContain('fix: no trailer');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test('--json emits a machine-readable scorecard', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tmax-ledger-report-json-'));
    try {
      gitIn(dir, ['init', '-q']);
      gitIn(dir, ['config', 'user.email', 't@e.com']);
      gitIn(dir, ['config', 'user.name', 'T']);
      writeFileSync(join(dir, 'test-run-2026-11-20.jsonl'), fixtureJsonl);
      const { exitCode, stdout } = runCli(['test-run-2026-11-20.jsonl', '--json'], dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { escalationLatency: { minutes: number }; cost: { tokensPerUnit: number } };
      expect(parsed.escalationLatency.minutes).toBe(60);
      expect(parsed.cost.tokensPerUnit).toBe(3500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test('missing file exits 1 with an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tmax-ledger-report-missing-'));
    try {
      const { exitCode } = runCli(['nope.jsonl'], dir);
      expect(exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test('readLedgerFile reports invalid lines with line numbers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tmax-ledger-report-invalid-'));
    try {
      writeFileSync(
        join(dir, 'bad.jsonl'),
        JSON.stringify(FIXTURE[0]) + '\n{"event":"telemetry","ts":"2026-11-20T09:30:00Z"}\n',
      );
      const read = readLedgerFile(join(dir, 'bad.jsonl'));
      if (!read.ok) throw new Error('expected ok read');
      expect(read.events).toHaveLength(1);
      expect(read.invalidLines).toHaveLength(1);
      expect(read.invalidLines[0]?.lineNo).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('smoke: runs on the REAL agent-infra ledger', () => {
    const { exitCode, stdout } = runCli(['agents/ledger/agent-infra-2026-11-20.jsonl'], repoRoot);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('# Run scorecard: agent-infra-2026-11-20');
    expect(stdout).toContain('1. Cost per accepted outcome');
  }, 60_000);
});
