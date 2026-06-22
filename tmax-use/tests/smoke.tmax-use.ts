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
import { test, expect } from '../test/index.ts';
import { promises as fs } from 'fs';
import { join } from 'path';

test('daemon launches and answers ping', async ({ frame }) => {
  const r = await frame.eval('(+ 1 1)');
  if (r.trim() !== '2') throw new Error(`expected "2", got ${JSON.stringify(r)}`);
});

test('frame opens a fixture file in normal mode', async ({ frame, tmpDir }) => {
  const path = join(tmpDir, 'fixture.txt');
  await fs.writeFile(path, 'hello world\n', 'utf-8');
  await frame.openFile(path);
  const text = await frame.bufferText();
  if (!text.includes('hello world')) {
    throw new Error(`buffer does not contain fixture text; got: ${JSON.stringify(text)}`);
  }
});

test('keys drive the editor (j moves cursor down)', async ({ frame, tmpDir }) => {
  const path = join(tmpDir, 'fixture2.txt');
  await fs.writeFile(path, 'line one\nline two\nline three\n', 'utf-8');
  await frame.openFile(path);
  await frame.eval('(cursor-move 0 0)');
  await frame.keys('j');
  const cursor = await frame.cursor();
  if (cursor.line < 1) {
    throw new Error(`cursor did not advance past line 0; got: ${JSON.stringify(cursor)}`);
  }
});

test('capture returns valid frame dimensions', async ({ frame }) => {
  const r = await frame.capture();
  if (r.width <= 0 || r.height <= 0) {
    throw new Error(`invalid dimensions: ${r.width}x${r.height}`);
  }
  if (!Array.isArray(r.lines) || r.lines.length === 0) {
    throw new Error('capture returned no lines');
  }
});

test('expect builder chains assertions against the daemon', async ({ frame, tmpDir }) => {
  const path = join(tmpDir, 'fixture3.txt');
  await fs.writeFile(path, 'hello world\n', 'utf-8');
  await frame.openFile(path);
  await expect(frame).toHaveBufferTextContaining('hello');
});
