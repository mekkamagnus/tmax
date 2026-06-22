/**
 * @file baseline.tmax-use.ts
 * @description Integration test for the baseline auto-generation and
 *   comparison flow.
 */
import { test } from '../test/index.ts';
import { promises as fs } from 'fs';
import { join } from 'path';
import { matchBaseline } from '../assert/baseline.ts';

/**
 * Run the baseline matcher and throw on Left or on a non-passing result.
 * `matchBaseline` is a library helper (not a Frame method), so we drive its
 * TaskEither explicitly here — the Promise-frame wrapper only covers Frame.
 */
async function expectBaselinePass(html: string, baselinePath: string, opts: { failOnMissing?: boolean }): Promise<void> {
  const r = await matchBaseline(html, baselinePath, opts).run();
  if ('left' in r) throw new Error(`baseline failed: ${r.left.message}`);
  if (!r.right.passed) {
    throw new Error(`baseline did not pass: ${JSON.stringify(r.right)}`);
  }
}

test('baseline auto-creates on first local run', async ({ frame, tmpDir, artifactsDir }) => {
  const path = join(tmpDir, 'fixture.txt');
  await fs.writeFile(path, 'hello\n', 'utf-8');
  await frame.openFile(path);
  const cap = await frame.captureHtml();
  const baselinePath = join(artifactsDir, 'auto-created.html');
  const r = await matchBaseline(cap.html, baselinePath, { failOnMissing: false }).run();
  if ('left' in r) throw new Error(`baseline create failed: ${r.left.message}`);
  if (!r.right.created) throw new Error(`expected baseline to be created; got: ${JSON.stringify(r.right)}`);
});

test('baseline comparison passes on second run with identical HTML', async ({ frame, tmpDir, artifactsDir }) => {
  const path = join(tmpDir, 'fixture2.txt');
  await fs.writeFile(path, 'hello\n', 'utf-8');
  await frame.openFile(path);
  const cap1 = await frame.captureHtml();
  const baselinePath = join(artifactsDir, 'compared.html');
  // First run creates the baseline; second identical run should match.
  await expectBaselinePass(cap1.html, baselinePath, { failOnMissing: false });
  const cap2 = await frame.captureHtml();
  await expectBaselinePass(cap2.html, baselinePath, { failOnMissing: false });
});
