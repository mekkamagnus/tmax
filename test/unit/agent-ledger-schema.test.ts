/**
 * @file agent-ledger-schema.test.ts
 * @description RFC-036 / #322 — validates the normative event schema in
 *   docs/agent-ledger.md. Every example event in the doc is extracted and
 *   checked: valid examples must validate, invalid examples must fail, and
 *   each event kind must carry at least one of each (so the doc can never
 *   drift from the canonical validator in scripts/ledger-schema.ts).
 *   Also exercises the validator directly on hand-built edge cases.
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  validateLedgerEvent,
  validateLedgerLine,
  LEDGER_EVENT_KINDS,
  type LedgerEventKind,
} from '../../scripts/ledger-schema.ts';

// ---------------------------------------------------------------------------
// Doc-example extraction
// ---------------------------------------------------------------------------

type DocExample = {
  kind: LedgerEventKind | null; // null = a common-field violation, not kind-attributed
  valid: boolean;
  label: string;
  json: unknown;
};

function extractDocExamples(doc: string): DocExample[] {
  const examples: DocExample[] = [];
  const lines = doc.split('\n');
  let currentKind: LedgerEventKind | null = null;
  let pending: { valid: boolean; label: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const heading = line.match(/^###\s+`([a-z-]+)`/);
    if (heading) {
      const name = heading[1] as string;
      currentKind = (LEDGER_EVENT_KINDS as readonly string[]).includes(name)
        ? (name as LedgerEventKind)
        : null;
      continue;
    }
    const marker = line.match(/^\*\*(Valid|Invalid)\b(.*):\*\*\s*$/);
    if (marker) {
      pending = { valid: marker[1] === 'Valid', label: line.trim() };
      continue;
    }
    if (line.trim() === '```json' && pending) {
      const body: string[] = [];
      i++;
      while (i < lines.length && (lines[i] ?? '') !== '```') {
        body.push(lines[i] ?? '');
        i++;
      }
      if ((lines[i] ?? '') !== '```') throw new Error(`unclosed json fence after: ${pending.label}`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.join('\n'));
      } catch (e) {
        throw new Error(`example after "${pending.label}" is not valid JSON: ${(e as Error).message}`);
      }
      examples.push({ kind: currentKind, valid: pending.valid, label: pending.label, json: parsed });
      pending = null;
    }
  }
  return examples;
}

const DOC_PATH = join(import.meta.dir, '..', '..', 'docs', 'agent-ledger.md');
const examples = extractDocExamples(readFileSync(DOC_PATH, 'utf8'));

// ---------------------------------------------------------------------------
// Doc coverage: every example in docs/agent-ledger.md is exercised
// ---------------------------------------------------------------------------

describe('docs/agent-ledger.md examples', () => {
  test('doc yields at least one valid and one invalid example per event kind', () => {
    for (const kind of LEDGER_EVENT_KINDS) {
      const valid = examples.filter((e) => e.kind === kind && e.valid);
      const invalid = examples.filter((e) => e.kind === kind && !e.valid);
      expect(valid.length).toBeGreaterThanOrEqual(1);
      expect(invalid.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('all valid examples validate', () => {
    for (const e of examples.filter((e) => e.valid)) {
      const result = validateLedgerEvent(e.json);
      expect([e.label, result.ok]).toEqual([e.label, true]);
    }
  });

  test('all invalid examples (incl. common-field violations) fail validation', () => {
    const invalid = examples.filter((e) => !e.valid);
    expect(invalid.length).toBeGreaterThanOrEqual(
      LEDGER_EVENT_KINDS.length + 1, // per-kind minimums plus the common-field section
    );
    for (const e of invalid) {
      const result = validateLedgerEvent(e.json);
      if (result.ok) throw new Error(`doc marks this invalid but it validates: ${e.label}`);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Direct validator coverage (hand-built events, exact error expectations)
// ---------------------------------------------------------------------------

const good = {
  'run-start': {
    event: 'run-start', ts: '2026-11-20T09:03:11Z', label: 'agent-infra',
    goal: 'land RFC-036 issues', model: 'claude-sonnet-5-5', 'order-file-ref': 'docs/burn-down-order.md',
  },
  'unit-start': { event: 'unit-start', ts: '2026-11-20T09:05:00Z', unit: '#322' },
  telemetry: {
    event: 'telemetry', ts: '2026-11-20T09:35:00Z', 'wall-minutes': 42, 'active-minutes': 31,
    'in-tokens': 23700, 'out-tokens': 5120, 'ctx-remaining-pct': 62,
  },
  gate: {
    event: 'gate', ts: '2026-11-20T10:12:44Z', kind: 'verify-gate', verdict: 'PASS',
    rounds: 1, 'reviewed-sha': 'f308bd1', 'findings-count': 0,
  },
  landing: {
    event: 'landing', ts: '2026-11-20T10:20:00Z', unit: '#322', shas: ['a1b2c3d'],
    'files-staged-count': 2, 'tests-run': [{ name: 'bun test x.test.ts', output: '1 pass\n0 fail' }],
    'adr-spec': ['docs/adrs/ADR-0001-x.md'],
  },
  escalation: {
    event: 'escalation', ts: '2026-11-20T11:02:00Z', reason: 'stalled', action: 'posted handoff',
  },
  'run-end': {
    event: 'run-end', ts: '2026-11-20T18:40:00Z', 'units-accepted': 5, 'units-blocked': 0,
    totals: { 'wall-minutes': 577 },
  },
  spotcheck: {
    event: 'spotcheck', ts: '2026-11-20T12:00:00Z', unit: '#322', sha: '2b37dcd',
    command: 'bun test test/unit/agent-ledger-schema.test.ts', verdict: 'match',
    expected: '23 pass / 0 fail', actual: '23 pass / 0 fail',
  },
} as const;

const errorsOf = (raw: unknown): string => {
  const r = validateLedgerEvent(raw);
  if (r.ok) throw new Error(`expected validation failure, got ok for ${JSON.stringify(raw)}`);
  return r.errors.join('; ');
};

describe('ledger schema validator', () => {
  test('a well-formed event of every kind validates', () => {
    for (const kind of LEDGER_EVENT_KINDS) {
      expect([kind, validateLedgerEvent(good[kind]).ok]).toEqual([kind, true]);
    }
  });

  test('telemetry with all-null (unreadable) fields is honest and valid', () => {
    const r = validateLedgerEvent({
      event: 'telemetry', ts: '2026-11-20T09:35:00Z', 'wall-minutes': null,
      'active-minutes': null, 'in-tokens': null, 'out-tokens': null, 'ctx-remaining-pct': null,
    });
    expect(r.ok).toBe(true);
  });

  test('telemetry rejects string estimates', () => {
    expect(errorsOf({ ...good.telemetry, 'wall-minutes': 'about 40' })).toContain('never an estimate');
    expect(errorsOf({ ...good.telemetry, 'out-tokens': '23k' })).toContain('never an estimate');
  });

  test('telemetry rejects out-of-range ctx-remaining-pct', () => {
    expect(errorsOf({ ...good.telemetry, 'ctx-remaining-pct': 101 })).toContain('0-100');
  });

  test('gate constrains kind to the standard gate kinds', () => {
    expect(errorsOf({ ...good.gate, kind: 'ci' })).toContain("must be one of a gate kind");
  });

  test('gate rounds must be >= 1', () => {
    expect(errorsOf({ ...good.gate, rounds: 0 })).toContain('>= 1');
  });

  test('landing without pasted test output is unverified by definition', () => {
    expect(errorsOf({ ...good.landing, 'tests-run': [] })).toContain('unverified by definition');
    expect(errorsOf({ ...good.landing, 'tests-run': [{ name: 'unit tests', output: '' }] }))
      .toContain('pasted output');
  });

  test('landing requires at least one sha', () => {
    expect(errorsOf({ ...good.landing, shas: [] })).toContain('at least one entry');
  });

  test('escalation reason must be a known escalation class', () => {
    expect(errorsOf({ ...good.escalation, reason: 'tired' })).toContain('escalation reason');
  });

  test('run-end totals values must be counts or null', () => {
    expect(errorsOf({ ...good['run-end'], totals: { 'wall-minutes': '9ish hours' } }))
      .toContain("field 'wall-minutes'");
  });

  test('missing required fields are named per kind', () => {
    const { goal, ...noGoal } = good['run-start'];
    expect(goal).toBeDefined();
    expect(errorsOf(noGoal)).toContain("run-start: missing required field 'goal'");
  });

  test('unknown event kinds are rejected', () => {
    expect(errorsOf({ event: 'nap', ts: '2026-11-20T12:00:00Z' })).toContain("'event' must be one of");
  });

  test('ts must be an ISO-8601 date-time with timezone', () => {
    expect(errorsOf({ ...good['unit-start'], ts: 'earlier today' })).toContain('ISO-8601');
    expect(errorsOf({ ...good['unit-start'], ts: '2026-11-20' })).toContain('ISO-8601');
    expect(errorsOf({ ...good['unit-start'], ts: '2026-11-20T09:00:00' })).toContain('ISO-8601');
    expect(errorsOf({ ...good['unit-start'], ts: '2026-13-40T09:00:00Z' })).toContain('real date-time');
  });

  test('extra fields beyond the minimum schema are allowed', () => {
    expect(validateLedgerEvent({ ...good['unit-start'], note: 'resumed after compaction' }).ok).toBe(true);
  });

  test('non-object events are rejected', () => {
    expect(errorsOf('run-start')).toContain('JSON object');
    expect(errorsOf([good['unit-start']])).toContain('JSON object');
  });

  test('all violations are collected, not just the first', () => {
    const r = validateLedgerEvent({ ...good.gate, ts: 'nope', kind: 'ci' });
    if (r.ok) throw new Error('expected failure');
    expect(r.errors.length).toBe(2);
    expect(r.errors.join('; ')).toContain('ISO-8601');
    expect(r.errors.join('; ')).toContain('gate kind');
  });
});

describe('validateLedgerLine', () => {
  test('a valid JSONL line validates', () => {
    expect(validateLedgerLine(JSON.stringify(good['unit-start'])).ok).toBe(true);
  });

  test('a line that is not JSON fails with a parse error', () => {
    const r = validateLedgerLine('{not json');
    if (r.ok) throw new Error('expected parse failure');
    expect(r.errors[0]).toContain('not valid JSON');
  });

  test('an empty line fails', () => {
    expect(validateLedgerLine('').ok).toBe(false);
  });

  test('a parseable line with a schema violation reports the violation', () => {
    const r = validateLedgerLine(JSON.stringify({ event: 'telemetry', ts: '2026-11-20T09:35:00Z' }));
    if (r.ok) throw new Error('expected schema failure');
    expect(r.errors.join('; ')).toContain('missing required field');
  });
});
