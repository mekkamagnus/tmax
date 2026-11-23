/**
 * @file ledger-scrape.test.ts
 * @description RFC-036 / #326 — tests for the herdr footer-scraper: the
 *   footer parser runs against REAL captured pane text (working spinner,
 *   idle /clear hint, ❯-only border case), the poller is exercised with an
 *   injected pane reader + clock (interval + unit-boundary triggers, run-end
 *   exit), and once against a LIVE pane (non-destructive reads), plus the
 *   report's self-vs-scrape mismatch alarm on a doctored fixture.
 */
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseFooter, resolvePaneForTab, scrapeOnce, runPoller } from '../../scripts/ledger-scrape.ts';
import { validateLedgerLine } from '../../scripts/ledger-schema.ts';
import { computeScorecard, type LedgerEvent } from '../../scripts/ledger-report.ts';

// ---------------------------------------------------------------------------
// REAL captured footers (herdr pane read --source visible, live panes)
// ---------------------------------------------------------------------------

/** live capture: working pane (spinner + status line), 2026-11-20 */
const WORKING_PANE = `✶ Sprouting… (1h 1m 52s · ↓ 105.8k tokens)
  ⎿  Tip: Use /clear to start fresh when switching topics and free up context

────────────────────────────────────────────────────────────── resume-fikra-iteration-loop ──
❯
─────────────────────────────────────────────────────────────────────────────────────────────
  tmax (mekkamagnus/tmax) -> glm-5.3[1m] | ctx:24%
  -- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents`;

/** live capture: idle pane (no spinner; /clear hint carries cumulative tokens) */
const IDLE_PANE = `  boards: animation boundary notes just landed on issues 318/319 and in the verification RFC.
  Next: commit the uncommitted RFCs, index, and docs.
                                                        new task? /clear to save 599k tokens
──────────────────────────────────────────────────────────────────────────────── stagehand ──
❯
─────────────────────────────────────────────────────────────────────────────────────────────
  tmax (mekkamagnus/tmax) -> glm-5.3[1m] | ctx:60%
  -- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents`;

/** border case: done/cleared pane — the bare ❯ prompt, no footer at all */
const PROMPT_ONLY_PANE = `some earlier transcript text
────────────────────────────────── tab ──
❯`;

describe('parseFooter (real captured footers)', () => {
  test('working pane: ctx %, turn token delta, turn elapsed', () => {
    const f = parseFooter(WORKING_PANE);
    expect(f.ctxPct).toBe(24);
    expect(f.turnTokens).toBe(105_800);
    expect(f.turnElapsed).toBe('1h 1m 52s');
    expect(f.cumulativeTokens).toBeNull(); // no /clear hint while working
  });

  test('idle pane: cumulative tokens from the /clear hint', () => {
    const f = parseFooter(IDLE_PANE);
    expect(f.ctxPct).toBe(60);
    expect(f.cumulativeTokens).toBe(599_000);
  });

  test('❯-only border case: everything null — never estimated', () => {
    const f = parseFooter(PROMPT_ONLY_PANE);
    expect(f).toEqual({ ctxPct: null, cumulativeTokens: null, turnTokens: null, turnElapsed: null });
  });

  test('token suffixes parse: plain, k, m', () => {
    expect(parseFooter('↓ 42 tokens').turnTokens).toBe(42);
    expect(parseFooter('↓ 23.7k tokens').turnTokens).toBe(23_700);
    expect(parseFooter('/clear to save 1.2m tokens').cumulativeTokens).toBe(1_200_000);
  });

  test('a redraw with two ctx readings takes the LAST (current frame)', () => {
    expect(parseFooter('ctx:80%\n…redraw…\nctx:24%').ctxPct).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// scrapeOnce + poller (injected pane reader + clock)
// ---------------------------------------------------------------------------

const ledgerWith = (lines: Record<string, unknown>[]): string => {
  const dir = mkdtempSync(join(tmpdir(), 'tmax-ledger-scrape-'));
  const p = join(dir, 'run-2026-11-20.jsonl');
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
};

describe('scrapeOnce', () => {
  test('working pane scrape appends a validating telemetry event with source scraped', () => {
    const ledger = ledgerWith([
      { event: 'run-start', ts: '2026-11-20T08:38:00Z', label: 'l', goal: 'g', model: 'm', 'order-file-ref': 'o' },
    ]);
    try {
      const r = scrapeOnce('w2:pX', ledger, {
        readPane: () => WORKING_PANE,
        now: () => '2026-11-20T09:38:00Z', // exactly 60 min after run-start
      });
      expect(r.readOk).toBe(true);
      const lines = readFileSync(ledger, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(validateLedgerLine(lines[1] as string).ok).toBe(true);
      const e = JSON.parse(lines[1] as string);
      expect(e['source']).toBe('scraped');
      expect(e['ctx-remaining-pct']).toBe(24);
      expect(e['wall-minutes']).toBe(60); // exact from run-start, not scraped
      expect(e['in-tokens']).toBeNull(); // ↓ is a turn delta, NEVER claimed cumulative
      expect(e['out-tokens']).toBeNull();
      expect(e['active-minutes']).toBeNull();
    } finally {
      rmSync(join(ledger, '..'), { recursive: true, force: true });
    }
  });

  test('idle pane scrape picks up the cumulative token figure', () => {
    const ledger = ledgerWith([
      { event: 'run-start', ts: '2026-11-20T08:38:00Z', label: 'l', goal: 'g', model: 'm', 'order-file-ref': 'o' },
    ]);
    try {
      scrapeOnce('w2:pX', ledger, { readPane: () => IDLE_PANE, now: () => '2026-11-20T09:38:00Z' });
      const e = JSON.parse(readFileSync(ledger, 'utf8').trim().split('\n')[1] as string);
      expect(e['in-tokens']).toBe(599_000);
      expect(e['ctx-remaining-pct']).toBe(60);
    } finally {
      rmSync(join(ledger, '..'), { recursive: true, force: true });
    }
  });

  test('failed pane read logs graceful absence with nulls', () => {
    const ledger = ledgerWith([
      { event: 'run-start', ts: '2026-11-20T08:38:00Z', label: 'l', goal: 'g', model: 'm', 'order-file-ref': 'o' },
    ]);
    try {
      const r = scrapeOnce('w2:pX', ledger, { readPane: () => null, now: () => '2026-11-20T09:38:00Z' });
      expect(r.readOk).toBe(false);
      const e = JSON.parse(readFileSync(ledger, 'utf8').trim().split('\n')[1] as string);
      expect(e['ctx-remaining-pct']).toBeNull();
      expect(e['in-tokens']).toBeNull();
      expect(e['note']).toContain('pane read failed');
      expect(validateLedgerLine(JSON.stringify(e)).ok).toBe(true);
    } finally {
      rmSync(join(ledger, '..'), { recursive: true, force: true });
    }
  });
});

describe('runPoller (injected clock + reader)', () => {
  test('scrapes at t0 and again each interval; exits on run-end; boundary triggers extra scrape', () => {
    const ledger = ledgerWith([
      { event: 'run-start', ts: '2026-11-20T08:38:00Z', label: 'l', goal: 'g', model: 'm', 'order-file-ref': 'o' },
    ]);
    try {
      let t = 1_000_000; // fake clock ms
      const reads: number[] = [];
      const scrapes = runPoller('w2:pX', ledger, {
        intervalMs: 30 * 60_000,
        checkMs: 15_000,
        maxMinutes: 65, // fake-time cap: t0 + interval scrapes, then exit
        readPane: () => { reads.push(t); return WORKING_PANE; },
        now: () => new Date(t).toISOString(),
        nowMs: () => t,
        sleep: (ms) => { t += ms; },
        maxIterations: 10_000,
      });
      // t0 scrape + at least one 30m-interval scrape inside the 65m window
      expect(scrapes).toBeGreaterThanOrEqual(2);
      expect(reads.length).toBe(scrapes);
      const beforeBoundary = readFileSync(ledger, 'utf8').trim().split('\n').length;

      // second poller: mid-window, a unit boundary (new ledger line) triggers
      // a scrape before the 30m interval is due, and run-end terminates it
      const t2start = t;
      let boundaryFired = false;
      let runEnded = false;
      const scrapes2 = runPoller('w2:pX', ledger, {
        intervalMs: 30 * 60_000,
        checkMs: 15_000,
        readPane: () => WORKING_PANE,
        now: () => new Date(t).toISOString(),
        nowMs: () => t,
        sleep: (ms) => {
          t += ms;
          if (!boundaryFired && t >= t2start + 5 * 60_000) {
            boundaryFired = true;
            writeFileSync(ledger, readFileSync(ledger, 'utf8') + JSON.stringify({ event: 'unit-start', ts: new Date(t).toISOString(), unit: '#x' }) + '\n');
          }
          if (!runEnded && t >= t2start + 10 * 60_000) {
            runEnded = true;
            writeFileSync(ledger, readFileSync(ledger, 'utf8') + JSON.stringify({ event: 'run-end', ts: new Date(t).toISOString(), 'units-accepted': 1, 'units-blocked': 0, totals: {} }) + '\n');
          }
        },
        maxIterations: 10_000,
      });
      expect(boundaryFired).toBe(true);
      expect(runEnded).toBe(true);
      expect(scrapes2).toBeGreaterThanOrEqual(2); // t0 + the boundary scrape
      const after = readFileSync(ledger, 'utf8').trim().split('\n').length;
      expect(after).toBeGreaterThan(beforeBoundary);
    } finally {
      rmSync(join(ledger, '..'), { recursive: true, force: true });
    }
  });

  test('maxMinutes cap terminates the loop', () => {
    const ledger = ledgerWith([
      { event: 'run-start', ts: '2026-11-20T08:38:00Z', label: 'l', goal: 'g', model: 'm', 'order-file-ref': 'o' },
    ]);
    try {
      let t = 0;
      const scrapes = runPoller('w2:pX', ledger, {
        intervalMs: 60_000,
        checkMs: 10_000,
        maxMinutes: 1,
        readPane: () => WORKING_PANE,
        now: () => new Date(t).toISOString(),
        nowMs: () => t,
        sleep: (ms) => { t += ms; },
        maxIterations: 10_000,
      });
      expect(scrapes).toBeGreaterThanOrEqual(1); // t0 + up-to-60s interval scrapes
    } finally {
      rmSync(join(ledger, '..'), { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// The mismatch alarm (report side) — doctored self-report fixture
// ---------------------------------------------------------------------------

describe('runPoller with a tab-label resolver (survives pane-id compaction)', () => {
  test('with resolvePane: every scrape reads the CURRENTLY resolved pane, never the launch id', () => {
    const ledger = ledgerWith([
      { event: 'run-start', ts: '2026-11-20T08:38:00Z', label: 'l', goal: 'g', model: 'm', 'order-file-ref': 'o' },
    ]);
    try {
      let t = 1_000_000;
      let current: string | null = 'w2:p1';
      const seen: string[] = [];
      const scrapes = runPoller('w2:pSTALE', ledger, {
        intervalMs: 60_000,
        checkMs: 15_000,
        maxMinutes: 10,
        maxIterations: 1_000,
        resolvePane: () => current,
        // the id compacts right after the first scrape (a tab closed elsewhere)
        readPane: (pane) => { seen.push(pane); current = 'w2:p7'; return WORKING_PANE; },
        now: () => new Date(t).toISOString(),
        nowMs: () => t,
        sleep: (ms) => { t += ms; },
      });
      expect(scrapes).toBeGreaterThanOrEqual(2);
      expect(seen[0]).toBe('w2:p1');
      expect(seen.slice(1).length).toBeGreaterThan(0);
      expect(seen.slice(1).every((p) => p === 'w2:p7')).toBe(true);
    } finally {
      rmSync(join(ledger, '..'), { recursive: true, force: true });
    }
  });

  test('a transient unresolved tab is retried on the next check, not fatal', () => {
    const ledger = ledgerWith([
      { event: 'run-start', ts: '2026-11-20T08:38:00Z', label: 'l', goal: 'g', model: 'm', 'order-file-ref': 'o' },
    ]);
    try {
      let t = 1_000_000;
      const t0 = t;
      const seen: string[] = [];
      const scrapes = runPoller('w2:pSTALE', ledger, {
        intervalMs: 60_000,
        checkMs: 15_000,
        maxMinutes: 5,
        maxIterations: 1_000,
        resolvePane: () => (t < t0 + 15_000 ? null : 'w2:p5'), // herdr unreachable for one check
        readPane: (pane) => { seen.push(pane); return WORKING_PANE; },
        now: () => new Date(t).toISOString(),
        nowMs: () => t,
        sleep: (ms) => { t += ms; },
      });
      expect(scrapes).toBeGreaterThanOrEqual(1);
      expect(seen.length).toBe(scrapes);
      expect(seen.every((p) => p === 'w2:p5')).toBe(true);
    } finally {
      rmSync(join(ledger, '..'), { recursive: true, force: true });
    }
  });

  test('tab gone: retries without scraping, then records ONE absence event and stops', () => {
    const ledger = ledgerWith([
      { event: 'run-start', ts: '2026-11-20T08:38:00Z', label: 'l', goal: 'g', model: 'm', 'order-file-ref': 'o' },
    ]);
    try {
      let t = 1_000_000;
      let reads = 0;
      const scrapes = runPoller('w2:p1', ledger, {
        intervalMs: 60_000,
        checkMs: 15_000,
        maxIterations: 1_000,
        resolvePane: () => null,
        tabLabel: 'issue-burn-down',
        readPane: () => { reads++; return null; },
        now: () => new Date(t).toISOString(),
        nowMs: () => t,
        sleep: (ms) => { t += ms; },
      });
      expect(scrapes).toBe(0);
      expect(reads).toBe(1); // the single read attempt that records the absence
      const lines = readFileSync(ledger, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2); // run-start + the one absence event
      const e = JSON.parse(lines[1] as string);
      expect(e['source']).toBe('scraped');
      expect(e['pane']).toBe('tab-not-found:issue-burn-down');
      expect(e['ctx-remaining-pct']).toBeNull();
      expect(validateLedgerLine(lines[1] as string).ok).toBe(true);
    } finally {
      rmSync(join(ledger, '..'), { recursive: true, force: true });
    }
  });
});

describe('resolvePaneForTab (tab label → pane, safe across id compaction)', () => {
  const herdr =
    (tabs: unknown[], panes: unknown[]) =>
    (cmd: string[]): { exitCode: number | null; stdout: string } => ({
      exitCode: 0,
      stdout: JSON.stringify({ result: cmd[1] === 'tab' ? { tabs } : { panes } }),
    });
  const TABS = [{ tab_id: 'w2:tA', label: 'issue-burn-down' }, { tab_id: 'w2:tB', label: 'task: fikra' }];
  const PANES = [{ pane_id: 'w2:p9', tab_id: 'w2:tB' }, { pane_id: 'w2:p4', tab_id: 'w2:tA' }];

  test('finds the pane showing the labelled tab', () => {
    expect(resolvePaneForTab('w2', 'issue-burn-down', herdr(TABS, PANES))).toBe('w2:p4');
    expect(resolvePaneForTab('w2', 'task: fikra', herdr(TABS, PANES))).toBe('w2:p9');
  });

  test('the same label resolves to the NEW id after a compaction', () => {
    const compacted = [{ pane_id: 'w2:p2', tab_id: 'w2:tA' }, { pane_id: 'w2:p3', tab_id: 'w2:tB' }];
    expect(resolvePaneForTab('w2', 'issue-burn-down', herdr(TABS, compacted))).toBe('w2:p2');
  });

  test('null when the tab is gone, its pane is gone, or herdr fails', () => {
    expect(resolvePaneForTab('w2', 'no-such-tab', herdr(TABS, PANES))).toBeNull();
    expect(resolvePaneForTab('w2', 'issue-burn-down', herdr(TABS, [PANES[0]]))).toBeNull();
    expect(resolvePaneForTab('w2', 'issue-burn-down', () => ({ exitCode: 1, stdout: '' }))).toBeNull();
    expect(resolvePaneForTab('w2', 'issue-burn-down', () => ({ exitCode: 0, stdout: 'not json' }))).toBeNull();
  });
});

describe('telemetry cross-check alarm', () => {
  const ev = (event: string, ts: string, fields: Record<string, unknown>): LedgerEvent =>
    ({ event, ts, ...fields }) as LedgerEvent;

  test('doctored self-report vs scrape beyond tolerance raises alarms', () => {
    const s = computeScorecard([
      ev('run-start', '2026-11-20T08:38:00Z', { label: 'l', goal: 'g', model: 'm', 'order-file-ref': 'o' }),
      // the self report claims ctx 60% and 500k in-tokens…
      ev('telemetry', '2026-11-20T09:30:00Z', { 'wall-minutes': 52, 'active-minutes': 40, 'in-tokens': 500_000, 'out-tokens': 10_000, 'ctx-remaining-pct': 60 }),
      // …the scrape 2 minutes later sees ctx 40% and 599k — BOTH beyond tolerance
      ev('telemetry', '2026-11-20T09:32:00Z', { 'wall-minutes': 54, 'active-minutes': null, 'in-tokens': 599_000, 'out-tokens': null, 'ctx-remaining-pct': 40, source: 'scraped' }),
    ]);
    expect(s.telemetryCrossCheck.scraped).toBe(1);
    expect(s.telemetryCrossCheck.paired).toBe(1);
    expect(s.telemetryCrossCheck.mismatches).toHaveLength(1);
    expect(s.telemetryCrossCheck.mismatches[0]?.fields.join('; ')).toContain('ctx 60% vs 40%');
    expect(s.telemetryCrossCheck.mismatches[0]?.fields.join('; ')).toContain('in-tokens 500,000 vs 599,000');
    const alarmText = s.alarms.map((a) => a.detail).join('\n');
    expect(alarmText).toContain('self-report vs scrape mismatch');
  });

  test('agreement within tolerance is silent; unpairable scrapes are skipped, not excused', () => {
    const s = computeScorecard([
      ev('run-start', '2026-11-20T08:38:00Z', { label: 'l', goal: 'g', model: 'm', 'order-file-ref': 'o' }),
      ev('telemetry', '2026-11-20T09:30:00Z', { 'wall-minutes': 52, 'active-minutes': 40, 'in-tokens': 590_000, 'out-tokens': 10_000, 'ctx-remaining-pct': 41 }),
      ev('telemetry', '2026-11-20T09:32:00Z', { 'wall-minutes': 54, 'active-minutes': null, 'in-tokens': 599_000, 'out-tokens': null, 'ctx-remaining-pct': 40, source: 'scraped' }),
      // a scrape with NO self report inside ±5 min — skipped
      ev('telemetry', '2026-11-20T12:00:00Z', { 'wall-minutes': 200, 'active-minutes': null, 'in-tokens': null, 'out-tokens': null, 'ctx-remaining-pct': 30, source: 'scraped' }),
    ]);
    expect(s.telemetryCrossCheck.mismatches).toHaveLength(0);
    expect(s.telemetryCrossCheck.paired).toBe(1);
    expect(s.telemetryCrossCheck.scraped).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// LIVE pane poller (non-destructive read verification)
// ---------------------------------------------------------------------------

describe('runPoller against a live herdr pane', () => {
  test('two scrapes from a real pane; pane still readable afterwards', () => {
    const list = Bun.spawnSync(['herdr', 'pane', 'list'], { stdout: 'pipe', stderr: 'pipe' });
    if (list.exitCode !== 0) return; // no herdr here — skip silently in CI-like environments
    const panes = JSON.parse(new TextDecoder().decode(list.stdout)) as {
      result: { panes: { pane_id: string }[] };
    };
    const pane = panes.result.panes[0]?.pane_id;
    if (!pane) return;
    const before = Bun.spawnSync(['herdr', 'pane', 'read', pane, '--source', 'visible', '--lines', '3', '--format', 'text'], { stdout: 'pipe' });
    const ledger = ledgerWith([
      { event: 'run-start', ts: '2026-11-20T08:38:00Z', label: 'l', goal: 'g', model: 'm', 'order-file-ref': 'o' },
    ]);
    try {
      let t = Date.now();
      const scrapes = runPoller(pane, ledger, {
        intervalMs: 500, // fast interval: two scrapes inside the test
        checkMs: 100,
        now: () => new Date(t).toISOString(),
        nowMs: () => t,
        sleep: (ms) => { t += ms; Bun.sleepSync(Math.min(ms, 120)); },
        maxIterations: 40,
      });
      expect(scrapes).toBeGreaterThanOrEqual(2);
      const appended = readFileSync(ledger, 'utf8').trim().split('\n');
      for (const line of appended) expect(validateLedgerLine(line).ok).toBe(true);
      // non-destructive: the pane is still readable and unchanged in shape
      const after = Bun.spawnSync(['herdr', 'pane', 'read', pane, '--source', 'visible', '--lines', '3', '--format', 'text'], { stdout: 'pipe' });
      expect(after.exitCode).toBe(0);
      expect(new TextDecoder().decode(after.stdout).length).toBeGreaterThan(0);
      expect(before.exitCode).toBe(0);
    } finally {
      rmSync(join(ledger, '..'), { recursive: true, force: true });
    }
  }, 30_000);
});
