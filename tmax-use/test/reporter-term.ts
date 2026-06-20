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

/** Render a single test result. */
export function renderTest(result: TestResult, indent = ''): string[] {
  const lines: string[] = [];
  const status = result.passed
    ? colorize('green', 'PASS')
    : colorize('red', 'FAIL');
  lines.push(`${indent}${status}  ${result.source} ${colorize('dim', `(${formatDuration(result.durationMs)})`)}`);

  for (const step of result.steps) {
    if (step.passed) continue;
    const stepStatus = colorize('red', '  ');
    const detail = step.details.length > 0 ? step.details[0] : '(no detail)';
    lines.push(`${indent}${stepStatus}${step.name}: ${detail}`);
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
export const __termReporterInternals = { renderTest, renderSuite, formatDuration, colorize };
