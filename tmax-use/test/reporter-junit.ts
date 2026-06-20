/**
 * @file reporter-junit.ts
 * @description JUnit XML reporter — writes `junit.xml` in the de-facto JUnit
 *   schema that CI systems (GitHub Actions, Jenkins, CircleCI) consume.
 *
 * Each `TestResult` becomes a `<testcase>` under a single `<testsuite>`.
 * Per-step failures are folded into the testcase's `<failure>` body.
 *
 * Schema reference: https://llg.cubic.org/docs/junit/ (compatible subset).
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { TaskEither } from '../../src/utils/task-either.ts';
import { TmaxUseError } from '../src/errors.ts';
import { SuiteResult, TestResult } from './runner.ts';

/** Render a single testcase element. */
function renderTestCase(test: TestResult): string {
  const classname = test.source.replace(/[^a-zA-Z0-9._-]/g, '.');
  const name = escapeXml(test.name || test.source);
  const time = (test.durationMs / 1000).toFixed(3);
  if (test.passed) {
    return `    <testcase classname="${escapeXml(classname)}" name="${name}" time="${time}"/>`;
  }
  const failedSteps = test.steps.filter((s) => !s.passed);
  const failureMsg = test.failureMessage
    ?? failedSteps.map((s) => `${s.name}: ${s.details.join('; ')}`).join('\n')
    ?? '(unknown failure)';
  return `    <testcase classname="${escapeXml(classname)}" name="${name}" time="${time}">
      <failure message="${escapeXml(failureMsg.split('\n')[0] ?? 'test failed')}">${escapeXml(failureMsg)}</failure>
    </testcase>`;
}

/** Render the full suite as a JUnit XML document. */
export function renderJUnit(suite: SuiteResult, suiteName = 'tmax-use'): string {
  const total = suite.results.length;
  const failures = suite.failed;
  const time = (suite.durationMs / 1000).toFixed(3);
  const cases = suite.results.map(renderTestCase).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="${escapeXml(suiteName)}" tests="${total}" failures="${failures}" errors="0" skipped="0" time="${time}">
${cases}
  </testsuite>
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
export const __junitReporterInternals = { renderTestCase, renderJUnit, escapeXml };
