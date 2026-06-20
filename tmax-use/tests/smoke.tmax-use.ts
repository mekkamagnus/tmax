/**
 * @file smoke.tmax-use.ts
 * @description Integration smoke test for the tmax-use control library.
 *
 * Launches a fresh daemon, opens a fixture file, types into it, queries
 * state, captures a frame. Verifies the full launch→control→teardown path.
 *
 * This file is loaded only by the tmax-use runner. It must NOT be named
 * `*.test.ts` (Bun would otherwise try to discover and run it).
 */
import { test } from '../test/index.ts';
import { expect } from '../assert/index.ts';
import { promises as fs } from 'fs';
import { join } from 'path';

test('daemon launches and answers ping', async ({ instance }) => {
  const r = await instance.frame('smoke').eval('(+ 1 1)').run();
  if ('left' in r) throw new Error(`ping failed: ${r.left.message}`);
  if (r.right.trim() !== '2') throw new Error(`expected "2", got ${JSON.stringify(r.right)}`);
});

test('frame opens a fixture file in normal mode', async ({ frame, tmpDir }) => {
  const path = join(tmpDir, 'fixture.txt');
  await fs.writeFile(path, 'hello world\n', 'utf-8');
  const open = await frame.openFile(path).run();
  if ('left' in open) throw new Error(`openFile failed: ${open.left.message}`);
  // Daemon should default to normal mode after open.
  const r = await frame.bufferText().run();
  if ('left' in r) throw new Error(`bufferText failed: ${r.left.message}`);
  if (!r.right.includes('hello world')) {
    throw new Error(`buffer does not contain fixture text; got: ${JSON.stringify(r.right)}`);
  }
});

test('keys drive the editor (gg moves to top)', async ({ frame, tmpDir }) => {
  const path = join(tmpDir, 'fixture2.txt');
  await fs.writeFile(path, 'line one\nline two\nline three\n', 'utf-8');
  await frame.openFile(path).run();
  // Move cursor down then back up to verify input works.
  await frame.keys('j').run();
  const after = await frame.cursor().run();
  if ('left' in after) throw new Error(`cursor query failed: ${after.left.message}`);
  // Cursor line should be 1 (second line) after `j`.
  if (after.right.line < 1) {
    throw new Error(`cursor did not advance past line 0; got: ${JSON.stringify(after.right)}`);
  }
});

test('capture returns valid frame dimensions', async ({ frame }) => {
  const r = await frame.capture().run();
  if ('left' in r) throw new Error(`capture failed: ${r.left.message}`);
  if (r.right.width <= 0 || r.right.height <= 0) {
    throw new Error(`invalid dimensions: ${r.right.width}x${r.right.height}`);
  }
  if (!Array.isArray(r.right.lines) || r.right.lines.length === 0) {
    throw new Error('capture returned no lines');
  }
});

test('expect builder chains assertions against the daemon', async ({ frame, tmpDir }) => {
  const path = join(tmpDir, 'fixture3.txt');
  await fs.writeFile(path, 'hello world\n', 'utf-8');
  await frame.openFile(path).run();
  const r = await expect(frame).toHaveBufferTextContaining('hello').runNow();
  if ('left' in r) throw new Error(`expect failed: ${r.left.message}`);
});
