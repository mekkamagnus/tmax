/**
 * @file reporter-term.ts
 * @description Terminal reporter — writes a concise pass/fail summary to
 *   stdout, one line per test plus a footer.
 *
 * Output format:
 *   PASS  path/to/foo.yaml (120ms)
 *   FAIL  path/to/bar.tmax-use.ts (450ms)
 *     step "opens file": expected mode "insert", got "normal"
 *
 *   2 passed, 1 failed (570ms)
 */

import { SuiteResult, TestResult, StepResult } from './runner.ts';

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
} as const;

const USE_COLOR = process.stdout.isTTY && process.env.NO_COLOR === undefined;

function colorize(c: keyof typeof COLORS, text: string): string {
  return USE_COLOR ? `${COLORS[c]}${text}${COLORS.reset}` : text;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Render a captured frame as a bordered box (for failure output). */
function renderFrameBox(frame: { lines: readonly string[]; width: number; height: number }, indent = ''): string[] {
  const inner = frame.lines.filter((l) => l.length > 0);
  if (inner.length === 0) return [];
  const maxLen = Math.min(Math.max(...inner.map((l) => stripAnsi(l).length), 0) + 2, 120);
  const top = `${indent}┌${'─'.repeat(maxLen)}┐`;
  const bot = `${indent}└${'─'.repeat(maxLen)}┘`;
  const mid = inner.map((l) => `${indent}│ ${l.padEnd(maxLen - 2).slice(0, maxLen - 2)} │`);
  return [colorize('dim', top), ...mid, colorize('dim', bot)];
}

/** Strip ANSI escape sequences for length measurement. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Render a single test result. */
export function renderTest(result: TestResult, indent = ''): string[] {
  const lines: string[] = [];
  const status = result.passed
    ? colorize('green', 'PASS')
    : colorize('red', 'FAIL');
  lines.push(`${indent}${status}  ${result.source} ${colorize('dim', `(${formatDuration(result.durationMs)})`)}`);

  for (const step of result.steps) {
    if (step.passed) continue;
    const detail = step.details.length > 0 ? step.details[0] : '(no detail)';
    lines.push(`${indent}  ${colorize('red', '✗')} ${step.name}: ${detail}`);
    if (step.frame) {
      lines.push(...renderFrameBox(step.frame, `${indent}    `));
    }
  }

  if (result.failureMessage && result.steps.length === 0) {
    lines.push(`${indent}  ${colorize('red', result.failureMessage)}`);
  }
  return lines;
}

/** Render the full suite summary. */
export function renderSuite(suite: SuiteResult): string {
  const lines: string[] = [];
  for (const t of suite.results) {
    lines.push(...renderTest(t));
  }
  lines.push('');
  const summary = suite.failed === 0
    ? colorize('green', `${suite.passed} passed`)
    : `${colorize('green', `${suite.passed} passed`)}, ${colorize('red', `${suite.failed} failed`)}`;
  lines.push(`${summary} ${colorize('dim', `(${formatDuration(suite.durationMs)})`)}`);
  return lines.join('\n');
}

/** Print the suite to stdout. */
export function printTermReporter(suite: SuiteResult): void {
  process.stdout.write(renderSuite(suite) + '\n');
}

// Test-only exports.
export const __termReporterInternals = { renderTest, renderSuite, formatDuration, colorize, renderFrameBox, stripAnsi };
