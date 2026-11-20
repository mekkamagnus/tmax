/**
 * @file ledger-schema.ts
 * @description RFC-036 / issue #322 — the normative agent run-ledger event
 *   schema and its validator. One JSON object per line, appended by the
 *   running agent as a protocol duty (see docs/agent-ledger.md and
 *   agents/ledger/README.md). Zero dependencies; shared by the doc-example
 *   test (test/unit/agent-ledger-schema.test.ts) and the ledger readers
 *   (scripts/ledger-report.ts, scripts/ledger-spotcheck.ts).
 */

/** The minimum-viable event set (RFC-036 §3.1). */
export const LEDGER_EVENT_KINDS = [
  'run-start',
  'unit-start',
  'telemetry',
  'gate',
  'landing',
  'escalation',
  'run-end',
] as const;
export type LedgerEventKind = (typeof LEDGER_EVENT_KINDS)[number];

/** `gate.kind` — who graded (RFC-036 §6: any external grader is a standard kind). */
export const GATE_KINDS = ['verify-gate', 'codex-grade', 'self-check'] as const;
export type GateKind = (typeof GATE_KINDS)[number];

/** `escalation.reason` — the four escalation classes (RFC-036 §3.1). */
export const ESCALATION_REASONS = ['stalled', 'valve-fired', 'ctx<25%', 'blocked'] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

export type ValidationOk = { ok: true };
export type ValidationErr = { ok: false; errors: string[] };
export type Validation = ValidationOk | ValidationErr;

/** A single-field check: returns the error fragment, or null when the value passes. */
type Check = (v: unknown) => string | null;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyStr: Check = (v) =>
  typeof v === 'string' && v.trim().length > 0 ? null : 'must be a non-empty string';

/** Non-negative finite number, or honest null — never a string estimate. */
const isCountOrNull: Check = (v) =>
  v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)
    ? null
    : 'must be a non-negative finite number, or null when unreadable (never an estimate)';

const isNonNegInt: Check = (v) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0
    ? null
    : 'must be a non-negative integer';

const isPosInt: Check = (v) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1
    ? null
    : 'must be an integer >= 1';

/** ISO-8601 date-time with an explicit timezone (escalation-latency math needs it). */
const ISO_TS_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const isIsoTs: Check = (v) => {
  if (typeof v !== 'string' || !ISO_TS_RE.test(v)) {
    return "must be an ISO-8601 date-time with timezone (e.g. 2026-11-20T09:03:11Z)";
  }
  return Number.isNaN(Date.parse(v)) ? 'is not a real date-time' : null;
};

const oneOf = (allowed: readonly string[], what: string): Check => (v) =>
  typeof v === 'string' && allowed.includes(v)
    ? null
    : `must be one of ${what} (${allowed.join(', ')}) — got ${JSON.stringify(v)}`;

const nonEmptyStrArray = (min: number): Check => (v) => {
  if (!Array.isArray(v) || v.length < min || !v.every((e) => isNonEmptyStr(e) === null)) {
    return min === 1
      ? 'must be an array of non-empty strings with at least one entry'
      : 'must be an array of non-empty strings (may be empty)';
  }
  return null;
};

/**
 * `landing.tests-run` — the pasted-output rule made mechanical (RFC-036 §3.3
 * rule 4): each entry is {name, output} with non-empty pasted runner output.
 * A landing without pasted output is unverified by definition.
 */
const checkTestsRun: Check = (v) => {
  if (!Array.isArray(v) || v.length === 0) {
    return 'must be a non-empty array — a landing without pasted test output is unverified by definition';
  }
  for (const entry of v) {
    if (!isObj(entry) || isNonEmptyStr(entry['name']) !== null || isNonEmptyStr(entry['output']) !== null) {
      return 'entries must be {name, output} objects with non-empty name and pasted output (claims like "all green" are not output)';
    }
  }
  return null;
};

/** `run-end.totals` — every present value is a count or honest null. */
const checkTotals: Check = (v) => {
  if (!isObj(v)) return 'must be an object of cumulative counts';
  for (const [k, val] of Object.entries(v)) {
    const e = isCountOrNull(val);
    if (e) return `field '${k}' ${e}`;
  }
  return null;
};

/** Per-event-kind required fields beyond the common {event, ts} (RFC-036 §3.1). */
const KIND_FIELDS: Record<LedgerEventKind, Record<string, Check>> = {
  'run-start': {
    label: isNonEmptyStr,
    goal: isNonEmptyStr,
    model: isNonEmptyStr,
    'order-file-ref': isNonEmptyStr,
  },
  'unit-start': {
    unit: isNonEmptyStr,
  },
  telemetry: {
    'wall-minutes': isCountOrNull,
    'active-minutes': isCountOrNull,
    'in-tokens': isCountOrNull,
    'out-tokens': isCountOrNull,
    'ctx-remaining-pct': (v) =>
      v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100)
        ? null
        : 'must be an integer 0-100, or null when unreadable',
  },
  gate: {
    kind: oneOf(GATE_KINDS, 'a gate kind'),
    verdict: isNonEmptyStr,
    rounds: isPosInt,
    'reviewed-sha': isNonEmptyStr,
    'findings-count': isNonNegInt,
  },
  landing: {
    unit: isNonEmptyStr,
    shas: nonEmptyStrArray(1),
    'files-staged-count': isPosInt,
    'tests-run': checkTestsRun,
    'adr-spec': nonEmptyStrArray(0),
  },
  escalation: {
    reason: oneOf(ESCALATION_REASONS, 'an escalation reason'),
    action: isNonEmptyStr,
  },
  'run-end': {
    'units-accepted': isNonNegInt,
    'units-blocked': isNonNegInt,
    totals: checkTotals,
  },
};

const err = (errors: string[]): Validation => ({ ok: false, errors });

/**
 * Validate one decoded ledger event against the RFC-036 §3.1 schema.
 * Unknown extra fields are allowed (the schema is the minimum viable set);
 * every violation is collected, not just the first.
 */
export const validateLedgerEvent = (raw: unknown): Validation => {
  if (!isObj(raw)) return err([`event must be a JSON object, got ${typeof raw}`]);
  const event = raw['event'];
  if (isNonEmptyStr(event) !== null) return err(["'event' must be a non-empty string"]);
  if (!(LEDGER_EVENT_KINDS as readonly string[]).includes(event as string)) {
    return err([
      `'event' must be one of ${LEDGER_EVENT_KINDS.join(', ')} — got ${JSON.stringify(event)}`,
    ]);
  }
  const kind = event as LedgerEventKind;
  const errors: string[] = [];
  const requireField = (name: string, check: Check): void => {
    if (!(name in raw)) {
      errors.push(`${kind}: missing required field '${name}'`);
      return;
    }
    const e = check(raw[name]);
    if (e) errors.push(`${kind}: field '${name}' ${e}`);
  };
  requireField('ts', isIsoTs);
  for (const [name, check] of Object.entries(KIND_FIELDS[kind])) requireField(name, check);
  return errors.length > 0 ? err(errors) : { ok: true };
};

/**
 * Validate one physical JSONL line: parses, then validates. The form the
 * readers consume ledgers in.
 */
export const validateLedgerLine = (line: string): Validation => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch (e) {
    return err([`line is not valid JSON: ${(e as Error).message}`]);
  }
  return validateLedgerEvent(decoded);
};
