/**
 * @file reporter-html.ts
 * @description HTML reporter — writes a self-contained `report.html` to the
 *   output directory. The report shows one row per test with status, timing,
 *   per-step details, and the captured frame (rendered HTML) for inspection.
 *
 * The report is a single file with inline CSS, no JavaScript, no external
 * resources — safe to open in any browser or attach to a CI artifact bundle.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { TaskEither } from '../../src/utils/task-either.ts';
import { TmaxUseError, rightT } from '../src/errors.ts';
import { SuiteResult, TestResult, StepResult } from './runner.ts';
import { CaptureResult } from '../src/frame.ts';

const CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; padding: 24px; color: #222; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  .summary { font-size: 14px; color: #666; margin-bottom: 24px; }
  .test { border: 1px solid #ddd; border-radius: 6px; margin-bottom: 16px; overflow: hidden; }
  .test.pass { border-left: 4px solid #4caf50; }
  .test.fail { border-left: 4px solid #f44336; }
  .test-header { padding: 12px 16px; background: #f8f8f8; display: flex; justify-content: space-between; align-items: center; }
  .test-name { font-weight: 600; font-size: 14px; word-break: break-all; }
  .test-meta { font-size: 12px; color: #888; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 600; }
  .badge.pass { background: #4caf50; color: white; }
  .badge.fail { background: #f44336; color: white; }
  .steps { padding: 8px 16px; font-size: 13px; }
  .step { padding: 4px 0; display: flex; align-items: flex-start; gap: 8px; }
  .step-icon { width: 16px; text-align: center; font-weight: 600; }
  .step-icon.pass { color: #4caf50; }
  .step-icon.fail { color: #f44336; }
  .step-name { font-weight: 500; }
  .step-details { color: #666; font-family: 'SF Mono', Menlo, monospace; font-size: 12px; padding-left: 24px; }
  .frame { padding: 8px 16px 16px; }
  .frame-label { font-size: 12px; color: #888; margin-bottom: 4px; }
  .frame-render { background: #1e1e1e; color: #f8f8f2; padding: 8px; font-family: 'SF Mono', Menlo, monospace; font-size: 12px; line-height: 1.4; overflow-x: auto; }
  .frame-render pre { margin: 0; white-space: pre-wrap; }
  .failure { padding: 8px 16px 12px; color: #b71c1c; font-family: 'SF Mono', Menlo, monospace; font-size: 12px; white-space: pre-wrap; }
`;

/** Render a single step as HTML. */
function renderStep(step: StepResult, frameIndex: number): string {
  const icon = step.passed ? '✓' : '✗';
  const klass = step.passed ? 'pass' : 'fail';
  const details = step.details.length > 0
    ? `<div class="step-details">${escapeHtml(step.details.join('\n'))}</div>`
    : '';
  const frame = step.frame
    ? `<div class="frame"><div class="frame-label">Captured frame after step:</div><div class="frame-render"><pre>${renderFrameLines(step.frame)}</pre></div></div>`
    : '';
  return `<div class="step"><span class="step-icon ${klass}">${icon}</span><div style="flex:1;"><div class="step-name">${escapeHtml(step.name)}</div>${details}${frame}</div></div>`;
}

/** Render captured ANSI lines as plain monospaced text. */
function renderFrameLines(frame: CaptureResult): string {
  return escapeHtml(frame.lines.join('\n'));
}

/** Render one test as HTML. */
function renderTest(test: TestResult): string {
  const klass = test.passed ? 'pass' : 'fail';
  const badge = test.passed ? '<span class="badge pass">PASS</span>' : '<span class="badge fail">FAIL</span>';
  const steps = test.steps.length > 0
    ? `<div class="steps">${test.steps.map((s, i) => renderStep(s, i)).join('')}</div>`
    : '';
  const failure = test.failureMessage && test.steps.length === 0
    ? `<div class="failure">${escapeHtml(test.failureMessage)}</div>`
    : '';
  return `<div class="test ${klass}">
  <div class="test-header">
    <div class="test-name">${badge} ${escapeHtml(test.source)}</div>
    <div class="test-meta">${test.durationMs}ms</div>
  </div>
  ${steps}${failure}
</div>`;
}

/** Render the entire suite as a single HTML document. */
export function renderHtmlReport(suite: SuiteResult, title = 'tmax-use report'): string {
  const total = suite.results.length;
  const passedPct = total === 0 ? 0 : Math.round((suite.passed / total) * 100);
  const summary = `${suite.passed} passed, ${suite.failed} failed (${passedPct}%) — ${suite.durationMs}ms total`;
  const tests = suite.results.map(renderTest).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="summary">${escapeHtml(summary)}</div>
${tests}
</body>
</html>`;
}

/** Write the HTML report to `outputDir/report.html`. */
export function writeHtmlReport(suite: SuiteResult, outputDir: string, title?: string): TaskEither<TmaxUseError, string> {
  const html = renderHtmlReport(suite, title);
  const path = join(outputDir, 'report.html');
  return TaskEither.tryCatch(
    async () => {
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(path, html, 'utf-8');
      return path;
    },
    (err): TmaxUseError => TmaxUseError.subprocessFailed(
      `failed to write HTML report: ${err instanceof Error ? err.message : String(err)}`,
    ),
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Test-only exports.
export const __htmlReporterInternals = { renderStep, renderTest, renderHtmlReport, escapeHtml };
