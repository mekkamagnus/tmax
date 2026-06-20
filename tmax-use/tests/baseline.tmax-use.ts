/**
 * @file baseline.tmax-use.ts
 * @description Integration test for the baseline auto-generation and
 *   comparison flow.
 */
import { test } from '../test/index.ts';
import { promises as fs } from 'fs';
import { join } from 'path';
import { matchBaseline } from '../assert/baseline.ts';

test('baseline auto-creates on first local run', async ({ frame, tmpDir, artifactsDir }) => {
  const path = join(tmpDir, 'fixture.txt');
  await fs.writeFile(path, 'hello\n', 'utf-8');
  await frame.openFile(path).run();
  const cap = await frame.captureHtml().run();
  if ('left' in cap) throw new Error(`capture failed: ${cap.left.message}`);
  const baselinePath = join(artifactsDir, 'auto-created.html');
  const r = await matchBaseline(cap.right.html, baselinePath, { failOnMissing: false }).run();
  if ('left' in r) throw new Error(`baseline create failed: ${r.left.message}`);
  if (!r.right.created) throw new Error(`expected baseline to be created; got: ${JSON.stringify(r.right)}`);
});

test('baseline comparison passes on second run with identical HTML', async ({ frame, tmpDir, artifactsDir }) => {
  const path = join(tmpDir, 'fixture2.txt');
  await fs.writeFile(path, 'hello\n', 'utf-8');
  await frame.openFile(path).run();
  const cap1 = await frame.captureHtml().run();
  if ('left' in cap1) throw new Error(`first capture failed: ${cap1.left.message}`);
  const baselinePath = join(artifactsDir, 'compared.html');
  // First run creates.
  await matchBaseline(cap1.right.html, baselinePath, { failOnMissing: false }).run();
  // Second identical run should match.
  const cap2 = await frame.captureHtml().run();
  if ('left' in cap2) throw new Error(`second capture failed: ${cap2.left.message}`);
  const r2 = await matchBaseline(cap2.right.html, baselinePath, { failOnMissing: false }).run();
  if ('left' in r2) throw new Error(`baseline compare failed: ${r2.left.message}`);
  if (!r2.right.passed) {
    throw new Error(`baseline comparison should pass on identical HTML; diff: ${r2.right.diff}`);
  }
});
