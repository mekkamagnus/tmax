/**
 * @file playbook.ts
 * @description YAML playbook parser + Validation-based linter.
 *
 * Schema:
 *   name: string
 *   description?: string
 *   mode?: string  (major mode to verify after setup file opens)
 *   terminal?: { width?: number, height?: number }  (capture dimensions)
 *   setup?: { action: 'setup_file', var?: string, name: string, content: string }[]
 *   steps: PlaybookStep[]
 *   cleanup?: boolean (default true)
 *
 * (Back-compat: top-level `width` and `height` are still accepted as a
 * deprecated alias of `terminal.width` / `terminal.height`.)
 *
 * Step:
 *   name?: string
 *   open?: string        (open a file at this step; alternative to setup_file)
 *   keys?: string
 *   eval?: string        (mutually exclusive with keys/open)
 *   setup_cursor?: [line, col]
 *   wait?: number (ms)
 *   headed?: boolean
 *   expect?: PlaybookAssert
 *
 * PlaybookAssert:
 *   cursor_line, cursor_column, line_text, line_text_matches, mode,
 *   buffer_contains, status_message, result_contains,
 *   screen_contains, screen_not_contains
 *
 * Supported YAML subset: mappings, sequences, strings, numbers, booleans, null.
 * No anchors, custom tags, or multi-document streams.
 */

import { Validation } from '../../src/utils/validation.ts';
import { Either } from '../../src/utils/task-either.ts';
import { TmaxUseError } from '../src/errors.ts';

export type PlaybookAssert = {
  readonly cursor_line?: number;
  readonly cursor_column?: number;
  readonly line_text?: string;
  readonly line_text_matches?: string;
  readonly mode?: string;
  readonly buffer_contains?: string;
  readonly status_message?: string;
  readonly result_contains?: string;
  readonly screen_contains?: string;
  readonly screen_not_contains?: string;
};

export interface PlaybookStep {
  readonly name?: string;
  readonly open?: string;
  readonly keys?: string;
  readonly eval?: string;
  readonly setup_cursor?: readonly [number, number];
  readonly wait?: number;
  readonly headed?: boolean;
  readonly expect?: PlaybookAssert;
}

export interface PlaybookSetup {
  readonly action: 'setup_file';
  readonly var?: string;
  readonly name: string;
  readonly content: string;
}

export interface PlaybookTerminal {
  readonly width?: number;
  readonly height?: number;
}

export interface Playbook {
  readonly name: string;
  readonly description?: string;
  readonly mode?: string;
  readonly terminal?: PlaybookTerminal;
  readonly setup?: readonly PlaybookSetup[];
  readonly steps: readonly PlaybookStep[];
  readonly cleanup?: boolean;
}

const ASSERT_KEYS = new Set<keyof PlaybookAssert>([
  'cursor_line', 'cursor_column', 'line_text', 'line_text_matches',
  'mode', 'buffer_contains', 'status_message', 'result_contains',
  'screen_contains', 'screen_not_contains',
]);

const STEP_KEYS = new Set<string>(['name', 'open', 'keys', 'eval', 'setup_cursor', 'wait', 'headed', 'expect']);

const SETUP_KEYS = new Set<string>(['action', 'var', 'name', 'content']);

const TERMINAL_KEYS = new Set<string>(['width', 'height']);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function unexpectedKeys(obj: Record<string, unknown>, allowed: Set<string>): string[] {
  return Object.keys(obj).filter((k) => !allowed.has(k));
}

/** Validate a single setup_file action. */
function validateSetup(raw: unknown, index: number): Validation<string, PlaybookSetup> {
  if (!isObject(raw)) {
    return Validation.failure(`setup[${index}]: must be a mapping`);
  }
  const unexpected = unexpectedKeys(raw, SETUP_KEYS);
  const errors: string[] = [];
  if (unexpected.length > 0) errors.push(`setup[${index}]: unknown keys: ${unexpected.join(', ')}`);
  if (raw.action !== 'setup_file') errors.push(`setup[${index}]: action must be 'setup_file' (got ${JSON.stringify(raw.action)})`);
  if (raw.var !== undefined && !isString(raw.var)) errors.push(`setup[${index}]: var must be a string`);
  if (!isString(raw.name)) errors.push(`setup[${index}]: name must be a string`);
  if (!isString(raw.content)) errors.push(`setup[${index}]: content must be a string`);
  if (errors.length > 0) return Validation.failure(errors);
  return Validation.success({
    action: 'setup_file',
    var: isString(raw.var) ? raw.var : undefined,
    name: raw.name as string,
    content: raw.content as string,
  });
}

/** Validate the `expect` block of a step. */
function validateAssert(raw: unknown, label: string): Validation<string, PlaybookAssert> {
  if (!isObject(raw)) {
    return Validation.failure(`${label}: expect must be a mapping`);
  }
  const unexpected = Object.keys(raw).filter((k) => !ASSERT_KEYS.has(k as keyof PlaybookAssert));
  const errors: string[] = [];
  if (unexpected.length > 0) errors.push(`${label}: unknown expect keys: ${unexpected.join(', ')}`);
  // Type-check each known field.
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'cursor_line' || k === 'cursor_column') {
      if (!isNumber(v)) errors.push(`${label}: ${k} must be a number`);
    } else if (ASSERT_KEYS.has(k as keyof PlaybookAssert)) {
      if (!isString(v)) errors.push(`${label}: ${k} must be a string`);
    }
  }
  if (errors.length > 0) return Validation.failure(errors);
  return Validation.success(raw as PlaybookAssert);
}

/** Validate a single step. */
function validateStep(raw: unknown, index: number): Validation<string, PlaybookStep> {
  if (!isObject(raw)) {
    return Validation.failure(`step[${index}]: must be a mapping`);
  }
  const label = `step[${index}]${isString(raw.name) ? ` (${raw.name})` : ''}`;
  const unexpected = unexpectedKeys(raw, STEP_KEYS);
  const errors: string[] = [];
  if (unexpected.length > 0) errors.push(`${label}: unknown keys: ${unexpected.join(', ')}`);
  if (raw.name !== undefined && !isString(raw.name)) errors.push(`${label}: name must be a string`);
  if (raw.open !== undefined && !isString(raw.open)) errors.push(`${label}: open must be a string (file path)`);
  if (raw.keys !== undefined && !isString(raw.keys)) errors.push(`${label}: keys must be a string`);
  if (raw.eval !== undefined) {
    if (!isString(raw.eval)) {
      errors.push(`${label}: eval must be a string`);
    } else if (raw.eval.includes('\\')) {
      // Lint guard: backslash in eval is corrupted by the JSON-RPC eval path.
      errors.push(`${label}: eval contains a backslash — drive this feature via keys instead (JSON-RPC eval mangles backslashes)`);
    }
  }
  // open/keys/eval are mutually exclusive action fields.
  const actionFields = ['open', 'keys', 'eval'].filter((k) => raw[k] !== undefined);
  if (actionFields.length > 1) {
    errors.push(`${label}: ${actionFields.join(', ')} are mutually exclusive (pick one action per step)`);
  }
  if (raw.wait !== undefined && !isNumber(raw.wait)) errors.push(`${label}: wait must be a number`);
  if (raw.headed !== undefined && !isBool(raw.headed)) errors.push(`${label}: headed must be a boolean`);
  if (raw.setup_cursor !== undefined) {
    if (!Array.isArray(raw.setup_cursor) || raw.setup_cursor.length !== 2 || !isNumber(raw.setup_cursor[0]) || !isNumber(raw.setup_cursor[1])) {
      errors.push(`${label}: setup_cursor must be [line, col] (two numbers)`);
    }
  }
  if (raw.expect !== undefined) {
    const e = validateAssert(raw.expect, label);
    if (e.isFailure()) errors.push(...e.getErrors());
  }
  if (errors.length > 0) return Validation.failure(errors);
  const result: PlaybookStep = {
    name: isString(raw.name) ? raw.name : undefined,
    open: isString(raw.open) ? raw.open : undefined,
    keys: isString(raw.keys) ? raw.keys : undefined,
    eval: isString(raw.eval) ? raw.eval : undefined,
    setup_cursor: Array.isArray(raw.setup_cursor) && raw.setup_cursor.length === 2
      ? [Number(raw.setup_cursor[0]), Number(raw.setup_cursor[1])]
      : undefined,
    wait: isNumber(raw.wait) ? raw.wait : undefined,
    headed: isBool(raw.headed) ? raw.headed : undefined,
    expect: isObject(raw.expect) ? (raw.expect as PlaybookAssert) : undefined,
  };
  return Validation.success(result);
}

/** Validate the `terminal` block. */
function validateTerminal(raw: unknown): Validation<string, PlaybookTerminal> {
  if (!isObject(raw)) {
    return Validation.failure(['playbook: terminal must be a mapping']);
  }
  const unexpected = unexpectedKeys(raw, TERMINAL_KEYS);
  const errors: string[] = [];
  if (unexpected.length > 0) errors.push(`playbook: unknown terminal keys: ${unexpected.join(', ')}`);
  if (raw.width !== undefined && !isNumber(raw.width)) errors.push('playbook: terminal.width must be a number');
  if (raw.height !== undefined && !isNumber(raw.height)) errors.push('playbook: terminal.height must be a number');
  if (errors.length > 0) return Validation.failure(errors);
  return Validation.success({
    width: isNumber(raw.width) ? raw.width : undefined,
    height: isNumber(raw.height) ? raw.height : undefined,
  });
}

/** Validate the whole playbook shape. */
export function validatePlaybook(raw: unknown): Validation<string, Playbook> {
  if (!isObject(raw)) {
    return Validation.failure(['playbook: must be a mapping at the top level']);
  }
  const errors: string[] = [];
  // Top-level allowed keys. `width`/`height` are accepted as a back-compat alias.
  const allowedTop = new Set(['name', 'description', 'mode', 'terminal', 'width', 'height', 'setup', 'steps', 'cleanup']);
  const unexpected = unexpectedKeys(raw, allowedTop);
  if (unexpected.length > 0) errors.push(`playbook: unknown top-level keys: ${unexpected.join(', ')}`);
  if (!isString(raw.name)) errors.push('playbook: name must be a string');
  if (raw.description !== undefined && !isString(raw.description)) errors.push('playbook: description must be a string');
  if (raw.mode !== undefined && !isString(raw.mode)) errors.push('playbook: mode must be a string');
  if (raw.width !== undefined && !isNumber(raw.width)) errors.push('playbook: width must be a number');
  if (raw.height !== undefined && !isNumber(raw.height)) errors.push('playbook: height must be a number');
  let terminal: PlaybookTerminal | undefined;
  if (raw.terminal !== undefined) {
    const t = validateTerminal(raw.terminal);
    if (t.isFailure()) errors.push(...t.getErrors());
    else terminal = t.getValue();
  }
  if (raw.cleanup !== undefined && !isBool(raw.cleanup)) errors.push('playbook: cleanup must be a boolean');
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    errors.push('playbook: steps must be a non-empty array');
  } else {
    const stepResults = Validation.traverse(
      Array.from((raw.steps as unknown[]).entries()),
      ([i, s]) => validateStep(s, i),
    );
    if (stepResults.isFailure()) errors.push(...stepResults.getErrors());
  }
  if (raw.setup !== undefined) {
    if (!Array.isArray(raw.setup)) {
      errors.push('playbook: setup must be an array');
    } else {
      const setupResults = Validation.traverse(
        Array.from((raw.setup as unknown[]).entries()),
        ([i, s]) => validateSetup(s, i),
      );
      if (setupResults.isFailure()) errors.push(...setupResults.getErrors());
    }
  }
  if (errors.length > 0) return Validation.failure(errors);
  // Back-compat: top-level width/height folds into terminal when terminal is absent.
  const resolvedTerminal: PlaybookTerminal | undefined = terminal
    ?? ((isNumber(raw.width) || isNumber(raw.height))
      ? { width: isNumber(raw.width) ? raw.width : undefined, height: isNumber(raw.height) ? raw.height : undefined }
      : undefined);
  const validated: Playbook = {
    name: raw.name as string,
    description: isString(raw.description) ? raw.description : undefined,
    mode: isString(raw.mode) ? raw.mode : undefined,
    terminal: resolvedTerminal,
    setup: Array.isArray(raw.setup) ? (raw.setup as PlaybookSetup[]) : undefined,
    steps: raw.steps as PlaybookStep[],
    cleanup: isBool(raw.cleanup) ? raw.cleanup : undefined,
  };
  return Validation.success(validated);
}

/** Parse a YAML string into a validated Playbook. */
export function parsePlaybook(content: string, source = '<inline>'): Either<TmaxUseError, Playbook> {
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(content);
  } catch (e) {
    return Either.left(TmaxUseError.playbookParseFailed(
      source,
      [`YAML parse error: ${e instanceof Error ? e.message : String(e)}`],
    ));
  }
  if (Array.isArray(raw) || typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' || raw === null) {
    return Either.left(TmaxUseError.playbookParseFailed(source, ['top-level YAML must be a mapping']));
  }
  const result = validatePlaybook(raw);
  if (result.isFailure()) {
    return Either.left(TmaxUseError.playbookParseFailed(source, result.getErrors()));
  }
  return Either.right(result.getValue());
}
