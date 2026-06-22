/**
 * @file reporter-junit.ts
 * @description JUnit XML reporter — writes `junit.xml` in the de-facto JUnit
 *   schema that CI systems (GitHub Actions, Jenkins, CircleCI) consume.
 *
 * Each TestResult (a playbook or `*.tmax-use.ts` file) becomes a `<testsuite>`,
 * and each StepResult (a step inside that playbook, or an individual `test()`
 * inside a `*.tmax-use.ts` file) becomes a `<testcase>`. This matches the
 * JUnit expectation that suites group related cases.
 *
 * Schema reference: https://llg.cubic.org/docs/junit/ (compatible subset).
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { TaskEither } from '../../src/utils/task-either.ts';
import { TmaxUseError } from '../src/errors.ts';
import { SuiteResult, TestResult, StepResult } from './runner.ts';

/** Render a single `<testcase>` element from a step. */
function renderStepTestCase(step: StepResult, classname: string): string {
  const name = escapeXml(step.name || 'step');
  const time = (step.durationMs / 1000).toFixed(3);
  if (step.passed) {
    return `      <testcase classname="${escapeXml(classname)}" name="${name}" time="${time}"/>`;
  }
  const failureMsg = step.details.length > 0 ? step.details.join('\n') : '(no detail)';
  const firstLine = failureMsg.split('\n')[0] ?? 'step failed';
  return `      <testcase classname="${escapeXml(classname)}" name="${name}" time="${time}">
        <failure message="${escapeXml(firstLine)}">${escapeXml(failureMsg)}</failure>
      </testcase>`;
}

/** Render a single `<testsuite>` from a test result (playbook or .tmax-use.ts). */
function renderTestSuite(test: TestResult): string {
  const classname = test.source.replace(/[^a-zA-Z0-9._-]/g, '.');
  const steps = test.steps.length > 0
    ? test.steps
    : [{ name: test.name, passed: test.passed, details: test.failureMessage ? [test.failureMessage] : [], durationMs: test.durationMs }];
  const failures = steps.filter((s) => !s.passed).length;
  const time = (test.durationMs / 1000).toFixed(3);
  const cases = steps.map((s) => renderStepTestCase(s, classname)).join('\n');
  return `    <testsuite name="${escapeXml(test.name || test.source)}" tests="${steps.length}" failures="${failures}" errors="0" skipped="0" time="${time}">
${cases}
    </testsuite>`;
}

/** Render the full suite as a JUnit XML document. */
export function renderJUnit(suite: SuiteResult, suiteName = 'tmax-use'): string {
  const total = suite.results.reduce((acc, t) => acc + Math.max(t.steps.length, 1), 0);
  const failures = suite.failed;
  const time = (suite.durationMs / 1000).toFixed(3);
  const suites = suite.results.map(renderTestSuite).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="${escapeXml(suiteName)}" tests="${total}" failures="${failures}" errors="0" skipped="0" time="${time}">
${suites}
</testsuites>
`;
}

/** Write the JUnit XML to `outputDir/junit.xml`. */
export function writeJUnitReport(suite: SuiteResult, outputDir: string, suiteName?: string): TaskEither<TmaxUseError, string> {
  const xml = renderJUnit(suite, suiteName);
  const path = join(outputDir, 'junit.xml');
  return TaskEither.tryCatch(
    async () => {
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(path, xml, 'utf-8');
      return path;
    },
    (err): TmaxUseError => TmaxUseError.subprocessFailed(
      `failed to write JUnit report: ${err instanceof Error ? err.message : String(err)}`,
    ),
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Test-only exports.
export const __junitReporterInternals = { renderStepTestCase, renderTestSuite, renderJUnit, escapeXml };
