#!/usr/bin/env bun
/**
 * @file ledger-report.ts
 * @description RFC-036 / issue #324 — the run-ledger reader: renders any
 *   agents/ledger/*.jsonl as a per-run scorecard computing the five derived
 *   benchmarks (RFC-036 §3.2). Plain TS, zero dependencies.
 *
 *   Usage: bun scripts/ledger-report.ts <ledger.jsonl> [--json]
 *
 *   computeScorecard() is pure (no fs, no git) so the benchmarks are
 *   unit-testable against hand-computed fixtures; the CLI skin reads the
 *   file, validates lines against scripts/ledger-schema.ts, and merges the
 *   #323 trailer audit (scripts/ledger-trailers.ts).
 */
import { readFileSync } from 'fs';
import { validateLedgerLine, type Validation } from './ledger-schema.ts';
import { auditLedgerRunWindow, type RunWindow } from './ledger-trailers.ts';

/** A decoded, schema-valid ledger event. */
export type LedgerEvent = Record<string, unknown> & { event: string; ts: string };

export type InvalidLine = { lineNo: number; errors: string[] };

export type Alarm = { benchmark: string; detail: string };

export type Scorecard = {
  ledgerId: string;
  label: string | null;
  goal: string | null;
  model: string | null;
  runStartTs: string | null;
  runEndTs: string | null;
  totalEvents: number;
  invalidLines: InvalidLine[];
  /** 1. tokens ÷ landed units (null when token telemetry is missing) */
  cost: {
    landedUnits: number;
    blockedUnits: number;
    inTokens: number | null;
    outTokens: number | null;
    tokensPerUnit: number | null;
    /** % of telemetry events that carried real (non-null) token numbers */
    coveragePct: number | null;
  };
  /** 2. gate-rounds ÷ units; units at round >= 4 are flagged (valve pages at 5) */
  rework: {
    totalRounds: number;
    gatedUnits: number;
    roundsPerUnit: number | null;
    perUnit: { unit: string; rounds: number }[];
    flagged: { unit: string; rounds: number }[];
  };
  /** 3. landings whose pasted output reproduced under spot-check ÷ spot-checked landings */
  claimVerification: {
    rate: number | null;
    status: 'pending' | 'measured';
    checkedLandings: number;
    verifiedLandings: number;
    note: string;
  };
  /** 4. first stall signal → first escalation after it */
  escalationLatency: {
    state: 'no-stall-signal' | 'never-escalated' | 'escalated-pre-signal' | 'measured';
    firstSignalTs: string | null;
    firstEscalationTs: string | null;
    minutes: number | null;
  };
  /** 5. escalations logged before ctx<25% (disciplined) vs after (late) */
  headroom: {
    disciplined: number;
    late: number;
    unknown: number; // escalated with no telemetry ever read
    ctxBelow25Observed: boolean;
  };
  trailerAudit: {
    runStartTs: string | null;
    ledgerCommits: number;
    unattributed: { sha: string; subject: string }[];
    gitError: string | null;
  };
  alarms: Alarm[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const num = (e: LedgerEvent, key: string): number | null => {
  const v = e[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
const str = (e: LedgerEvent, key: string): string | null => {
  const v = e[key];
  return typeof v === 'string' ? v : null;
};

/** Chronological order is the ledger's structure (append-only, ts-ordered). */
const tsMs = (e: LedgerEvent): number => Date.parse(e.ts);

/**
 * A stall signal is a gate verdict that is not pass-like. Pass-like means the
 * verdict starts with "pass" (case-insensitive): "PASS", "passed with notes".
 * Everything else — "GAPS", "FAIL", "7/10" — says the unit is not landing
 * clean, which is what escalation latency measures.
 */
const isPassLike = (verdict: string): boolean => verdict.trim().toLowerCase().startsWith('pass');

const round1 = (n: number): number => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// Pure scorecard computation
// ---------------------------------------------------------------------------

/**
 * Compute the full scorecard from decoded ledger events (chronological,
 * append order). Every benchmark's formula is documented at its block.
 */
export const computeScorecard = (
  events: LedgerEvent[],
  opts?: { ledgerId?: string; invalidLines?: InvalidLine[]; trailerAudit?: RunWindow | null },
): Scorecard => {
  const alarms: Alarm[] = [];
  const invalidLines = opts?.invalidLines ?? [];
  for (const bad of invalidLines) {
    alarms.push({ benchmark: 'schema', detail: `line ${bad.lineNo}: ${bad.errors.join('; ')}` });
  }

  const runStart = events.find((e) => e['event'] === 'run-start');
  const runEnd = events.find((e) => e['event'] === 'run-end');
  const telemetry = events.filter((e) => e['event'] === 'telemetry');
  const gates = events.filter((e) => e['event'] === 'gate');
  const landings = events.filter((e) => e['event'] === 'landing');
  const escalations = events.filter((e) => e['event'] === 'escalation');
  const unitStarts = events.filter((e) => e['event'] === 'unit-start');

  // --- 1. Cost per accepted outcome ---------------------------------------
  // formula: tokens ÷ landed units, tokens = the most recent non-null
  // cumulative telemetry values (run-end.totals override when present).
  // Null-safe: any missing token total → null cost, and coverage reports
  // how much of the telemetry actually carried numbers.
  const landedUnitSet = new Set(landings.map((e) => str(e, 'unit')).filter((u): u is string => !!u));
  const blockedUnits =
    runEnd && typeof runEnd['units-blocked'] === 'number' ? (runEnd['units-blocked'] as number) : 0;
  let inTokens: number | null = null;
  let outTokens: number | null = null;
  if (runEnd && runEnd['totals'] && typeof runEnd['totals'] === 'object') {
    const totals = runEnd['totals'] as Record<string, unknown>;
    inTokens = typeof totals['in-tokens'] === 'number' ? totals['in-tokens'] : null;
    outTokens = typeof totals['out-tokens'] === 'number' ? totals['out-tokens'] : null;
  }
  if (inTokens === null) {
    for (let i = telemetry.length - 1; i >= 0; i--) {
      const v = num(telemetry[i] as LedgerEvent, 'in-tokens');
      if (v !== null) { inTokens = v; break; }
    }
  }
  if (outTokens === null) {
    for (let i = telemetry.length - 1; i >= 0; i--) {
      const v = num(telemetry[i] as LedgerEvent, 'out-tokens');
      if (v !== null) { outTokens = v; break; }
    }
  }
  const coveragePct =
    telemetry.length === 0
      ? null
      : round1(
          (100 *
            telemetry.filter(
              (e) => num(e as LedgerEvent, 'in-tokens') !== null && num(e as LedgerEvent, 'out-tokens') !== null,
            ).length) /
            telemetry.length,
        );
  const landedUnits = landedUnitSet.size;
  const tokensPerUnit =
    landedUnits > 0 && inTokens !== null && outTokens !== null
      ? round1((inTokens + outTokens) / landedUnits)
      : null;
  if (telemetry.length === 0) {
    alarms.push({ benchmark: 'cost', detail: 'no telemetry events — token cost unmeasurable' });
  }

  // --- 2. Rework ratio -----------------------------------------------------
  // formula: gate-rounds ÷ gated units. Each gate event names the round of
  // that invocation; a unit's round count is the deepest round it reached
  // (max), attributed via the enclosing unit-start. Units at round >= 4 are
  // flagged (the valve pages at 5).
  const perUnit = new Map<string, number>();
  let currentUnit: string | null = null;
  for (const e of events) {
    if (e['event'] === 'unit-start') {
      currentUnit = str(e, 'unit');
    } else if (e['event'] === 'gate') {
      const unit = currentUnit ?? '(pre-unit)';
      const rounds = num(e, 'rounds') ?? 0;
      perUnit.set(unit, Math.max(perUnit.get(unit) ?? 0, rounds));
    }
  }
  const perUnitList = [...perUnit.entries()]
    .map(([unit, rounds]) => ({ unit, rounds }))
    .sort((a, b) => b.rounds - a.rounds);
  const flagged = perUnitList.filter((u) => u.rounds >= 4);
  const totalRounds = perUnitList.reduce((acc, u) => acc + u.rounds, 0);
  const gatedUnits = perUnitList.length;
  for (const f of flagged) {
    alarms.push({
      benchmark: 'rework',
      detail: `unit ${f.unit} reached gate round ${f.rounds} (valve threshold is 5)`,
    });
  }

  // --- 3. Claim verification rate ------------------------------------------
  // formula: landings whose pasted tests-run output REPRODUCED under
  // spot-check ÷ landings spot-checked. The spot-checker (issue #325,
  // scripts/ledger-spotcheck.ts) appends `spotcheck` events; a landing is
  // verified when all its spotchecks matched. No spotchecks → pending, never
  // a self-claimed rate. Mismatches and errors are alarm rows.
  const spotchecks = events.filter((e) => e['event'] === 'spotcheck');
  const checkedUnits = new Set<string>();
  const mismatchUnits = new Set<string>();
  for (const sc of spotchecks) {
    const unit = str(sc as LedgerEvent, 'unit');
    if (!unit) continue;
    checkedUnits.add(unit);
    if (str(sc as LedgerEvent, 'verdict') === 'mismatch') mismatchUnits.add(unit);
  }
  const verifiedLandings = [...checkedUnits].filter((u) => !mismatchUnits.has(u)).length;
  const claimVerification = {
    rate: checkedUnits.size > 0 ? round1((100 * verifiedLandings) / checkedUnits.size) : null,
    status: (checkedUnits.size > 0 ? 'measured' : 'pending') as 'pending' | 'measured',
    checkedLandings: checkedUnits.size,
    verifiedLandings,
    note:
      checkedUnits.size > 0
        ? `${verifiedLandings}/${checkedUnits.size} spot-checked landings reproduced`
        : 'N/A — no spotcheck events yet (run scripts/ledger-spotcheck.ts)',
  };
  for (const sc of spotchecks) {
    const v = str(sc as LedgerEvent, 'verdict');
    if (v === 'mismatch') {
      alarms.push({
        benchmark: 'claims',
        detail: `unit ${str(sc as LedgerEvent, 'unit')} @ ${str(sc as LedgerEvent, 'sha')}: pasted "${str(sc as LedgerEvent, 'expected')}" but re-run gave "${str(sc as LedgerEvent, 'actual')}" (${str(sc as LedgerEvent, 'command')})`,
      });
    } else if (v === 'error') {
      alarms.push({
        benchmark: 'claims',
        detail: `unit ${str(sc as LedgerEvent, 'unit')} @ ${str(sc as LedgerEvent, 'sha')}: spot-check could not verify (${str(sc as LedgerEvent, 'actual')})`,
      });
    }
  }

  // --- 4. Escalation latency -----------------------------------------------
  // formula: first escalation ts − first stall-signal ts, in minutes.
  const firstSignal = gates.find((e) => {
    const v = str(e, 'verdict') ?? '';
    return !isPassLike(v);
  });
  const firstSignalTs = firstSignal ? (firstSignal as LedgerEvent).ts : null;
  let latency: Scorecard['escalationLatency'];
  if (!firstSignal) {
    latency = { state: 'no-stall-signal', firstSignalTs: null, firstEscalationTs: null, minutes: null };
  } else {
    const sigMs = tsMs(firstSignal as LedgerEvent);
    // an escalation before any stall signal means the run escalated
    // pre-emptively — there is no signal→escalation gap to measure
    const pre = escalations.find((e) => tsMs(e as LedgerEvent) < sigMs);
    const after = escalations.find((e) => tsMs(e as LedgerEvent) >= sigMs);
    if (pre) {
      latency = {
        state: 'escalated-pre-signal',
        firstSignalTs,
        firstEscalationTs: (pre as LedgerEvent).ts,
        minutes: null,
      };
    } else if (!after) {
      latency = { state: 'never-escalated', firstSignalTs, firstEscalationTs: null, minutes: null };
      alarms.push({
        benchmark: 'escalation-latency',
        detail: `stall signal at ${firstSignalTs} but no escalation followed`,
      });
    } else {
      const mins = round1((tsMs(after as LedgerEvent) - sigMs) / 60_000);
      latency = {
        state: 'measured',
        firstSignalTs,
        firstEscalationTs: (after as LedgerEvent).ts,
        minutes: mins,
      };
    }
  }

  // --- 5. Context headroom discipline --------------------------------------
  // formula: an escalation is disciplined when the most recent telemetry
  // before it still showed ctx > 25%; late when ctx was already <= 25%;
  // unknown when no telemetry had been read. If ctx ever dipped below 25%
  // and no escalation followed, that is an alarm.
  let disciplined = 0;
  let late = 0;
  let unknown = 0;
  let lastCtx: number | null = null;
  let ctxBelow25Observed = false;
  let escalatedAfterDip = false;
  let dipSeen = false;
  for (const e of events) {
    if (e['event'] === 'telemetry') {
      const ctx = num(e as LedgerEvent, 'ctx-remaining-pct');
      if (ctx !== null) {
        lastCtx = ctx;
        if (ctx < 25) {
          dipSeen = true;
          ctxBelow25Observed = true;
        }
      }
    } else if (e['event'] === 'escalation') {
      if (lastCtx === null) unknown++;
      else if (lastCtx > 25) disciplined++;
      else late++;
      if (dipSeen) escalatedAfterDip = true;
    }
  }
  if (dipSeen && !escalatedAfterDip) {
    alarms.push({
      benchmark: 'headroom',
      detail: 'ctx fell below 25% with no escalation logged',
    });
  }

  // --- Trailer audit (#323) ------------------------------------------------
  const audit = opts?.trailerAudit ?? null;
  const trailerAudit = {
    runStartTs: audit?.runStartTs ?? null,
    ledgerCommits: audit?.audit ? (audit.audit.attributed.get(opts?.ledgerId ?? '') ?? []).length : 0,
    unattributed: audit?.audit
      ? audit.audit.unattributed.map((c) => ({ sha: c.sha.slice(0, 7), subject: c.subject }))
      : [],
    gitError: audit?.gitError ?? null,
  };
  if (trailerAudit.gitError) {
    alarms.push({ benchmark: 'attribution', detail: trailerAudit.gitError });
  }
  for (const c of trailerAudit.unattributed) {
    alarms.push({
      benchmark: 'attribution',
      detail: `unattributed commit in run window: ${c.sha} ${c.subject} (flag, not accusation)`,
    });
  }

  return {
    ledgerId: opts?.ledgerId ?? '(unnamed)',
    label: runStart ? str(runStart as LedgerEvent, 'label') : null,
    goal: runStart ? str(runStart as LedgerEvent, 'goal') : null,
    model: runStart ? str(runStart as LedgerEvent, 'model') : null,
    runStartTs: runStart ? (runStart as LedgerEvent).ts : null,
    runEndTs: runEnd ? (runEnd as LedgerEvent).ts : null,
    totalEvents: events.length,
    invalidLines,
    cost: { landedUnits, blockedUnits, inTokens, outTokens, tokensPerUnit, coveragePct },
    rework: {
      totalRounds,
      gatedUnits,
      roundsPerUnit: gatedUnits > 0 ? round1(totalRounds / gatedUnits) : null,
      perUnit: perUnitList,
      flagged,
    },
    claimVerification,
    escalationLatency: latency,
    headroom: { disciplined, late, unknown, ctxBelow25Observed },
    trailerAudit,
    alarms,
  };
};

// ---------------------------------------------------------------------------
// Human rendering
// ---------------------------------------------------------------------------

const fmtNum = (n: number | null): string => (n === null ? '—' : n.toLocaleString('en-US'));

/** Render the scorecard as the human table (stdout). */
export const renderHuman = (s: Scorecard): string => {
  const L: string[] = [];
  L.push(`# Run scorecard: ${s.ledgerId}`);
  if (s.goal) L.push(`  goal: ${s.goal}${s.model ? ` (${s.model})` : ''}`);
  L.push(
    `  run: ${s.runStartTs ?? '?'} → ${s.runEndTs ?? '(open)'} | ${s.totalEvents} events, ${s.invalidLines.length} invalid`,
  );
  L.push('');
  L.push('1. Cost per accepted outcome');
  L.push(
    `   ${fmtNum(s.cost.inTokens ?? null)} in + ${fmtNum(s.cost.outTokens ?? null)} out ÷ ${s.cost.landedUnits} landed units = ${
      s.cost.tokensPerUnit === null ? '— (token telemetry incomplete)' : `${s.cost.tokensPerUnit.toLocaleString('en-US')} tokens/unit`
    }${s.cost.coveragePct === null ? '' : ` | telemetry coverage ${s.cost.coveragePct}%`}`,
  );
  L.push('2. Rework ratio');
  L.push(
    `   ${s.rework.totalRounds} gate-rounds ÷ ${s.rework.gatedUnits} gated units = ${s.rework.roundsPerUnit ?? '—'} rounds/unit | landed ${s.cost.landedUnits}, blocked ${s.cost.blockedUnits}`,
  );
  if (s.rework.perUnit.length > 0) {
    L.push(`   per-unit: ${s.rework.perUnit.map((u) => `${u.unit}=${u.rounds}${u.rounds >= 4 ? ' ⚠' : ''}`).join(', ')}`);
  }
  L.push('3. Claim verification rate');
  L.push(`   ${s.claimVerification.note}${s.claimVerification.rate === null ? '' : ` = ${s.claimVerification.rate}%`}`);
  L.push('4. Escalation latency');
  if (s.escalationLatency.state === 'measured') {
    L.push(`   first stall signal ${s.escalationLatency.firstSignalTs} → escalated ${s.escalationLatency.firstEscalationTs} (${s.escalationLatency.minutes} min)`);
  } else if (s.escalationLatency.state === 'no-stall-signal') {
    L.push('   no stall signals (all gate verdicts pass-like)');
  } else if (s.escalationLatency.state === 'never-escalated') {
    L.push(`   stall signal ${s.escalationLatency.firstSignalTs} — never escalated ⚠`);
  } else {
    L.push(`   escalated at ${s.escalationLatency.firstEscalationTs} before any stall signal (pre-emptive)`);
  }
  L.push('5. Context headroom discipline');
  L.push(
    `   escalations: ${s.headroom.disciplined} disciplined, ${s.headroom.late} late, ${s.headroom.unknown} unknown | ctx<25% observed: ${s.headroom.ctxBelow25Observed ? 'yes' : 'no'}`,
  );
  L.push('');
  if (s.alarms.length === 0) {
    L.push('Alarms: none');
  } else {
    L.push(`Alarms (${s.alarms.length}):`);
    for (const a of s.alarms) L.push(`  ⚠ [${a.benchmark}] ${a.detail}`);
  }
  L.push('');
  L.push('Attribution (commits since run-start)');
  if (s.trailerAudit.gitError) {
    L.push(`  audit unavailable: ${s.trailerAudit.gitError}`);
  } else if (!s.trailerAudit.runStartTs) {
    L.push('  no run-start event — window undefined');
  } else {
    L.push(
      `  ${s.trailerAudit.ledgerCommits} commit(s) attributed to this ledger; ${s.trailerAudit.unattributed.length} unattributed (flag, not accusation)`,
    );
    for (const c of s.trailerAudit.unattributed) L.push(`    ${c.sha} ${c.subject}`);
  }
  return L.join('\n');
};

// ---------------------------------------------------------------------------
// CLI skin
// ---------------------------------------------------------------------------

/** Read + validate a ledger file into the computeScorecard inputs. */
export const readLedgerFile = (
  path: string,
): {
  ok: true;
  events: LedgerEvent[];
  invalidLines: InvalidLine[];
  /** per-line validated pairs, for the #323 run-window audit */
  validated: { line: string; validation: Validation }[];
} | { ok: false; error: string } => {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    return { ok: false, error: `cannot read ${path}: ${(e as Error).message}` };
  }
  const events: LedgerEvent[] = [];
  const invalidLines: InvalidLine[] = [];
  const validated: { line: string; validation: Validation }[] = [];
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  lines.forEach((line, i) => {
    const v = validateLedgerLine(line);
    validated.push({ line, validation: v });
    if (v.ok) {
      events.push(JSON.parse(line) as LedgerEvent);
    } else {
      invalidLines.push({ lineNo: i + 1, errors: v.errors });
    }
  });
  return { ok: true, events, invalidLines, validated };
};

const basename = (p: string): string => p.split('/').pop() ?? p;

const main = (): void => {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) {
    console.error('usage: bun scripts/ledger-report.ts <ledger.jsonl> [--json]');
    process.exit(1);
  }
  const read = readLedgerFile(path);
  if (!read.ok) {
    console.error(read.error);
    process.exit(1);
  }
  const ledgerId = basename(path).replace(/\.jsonl$/, '');
  const audit = auditLedgerRunWindow(read.validated);
  const scorecard = computeScorecard(read.events, {
    ledgerId,
    invalidLines: read.invalidLines,
    trailerAudit: audit,
  });
  if (json) console.log(JSON.stringify(scorecard, null, 2));
  else console.log(renderHuman(scorecard));
};

if (import.meta.main) main();
