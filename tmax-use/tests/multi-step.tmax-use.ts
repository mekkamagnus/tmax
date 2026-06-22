/**
 * @file multi-step.tmax-use.ts
 * @description Multi-step integration scenario: open file, enter insert mode,
 *   type text, escape, save, verify buffer. Exercises the full Frame API
 *   chain against a real daemon.
 */
import { test, expect } from '../test/index.ts';
import { promises as fs } from 'fs';
import { join } from 'path';

test('open → insert → type → escape → verify buffer', async ({ frame, tmpDir }) => {
  const path = join(tmpDir, 'multi.txt');
  await fs.writeFile(path, 'AAA\nBBB\nCCC\n', 'utf-8');
  await frame.openFile(path);
  await frame.eval('(cursor-move 0 0)');

  // Move to end of first line, enter insert mode, type.
  await frame.keys('j');          // down a line
  await frame.keys('A');          // append at end of line
  await frame.keys(', inserted'); // type text
  await frame.keys('<Esc>');      // back to normal

  // Verify buffer now contains the inserted text.
  await expect(frame).toHaveBufferTextContaining(', inserted');
});

test('navigation across lines via hjkl', async ({ frame, tmpDir }) => {
  const path = join(tmpDir, 'nav.txt');
  await fs.writeFile(path, 'aaaa\nbbbb\ncccc\n', 'utf-8');
  await frame.openFile(path);
  await frame.eval('(cursor-move 0 0)');

  // j moves down.
  await frame.keys('j');
  let cursor = await frame.cursor();
  if (cursor.line !== 1) throw new Error(`expected line 1 after j, got ${cursor.line}`);

  // Another j moves down again.
  await frame.keys('j');
  cursor = await frame.cursor();
  if (cursor.line !== 2) throw new Error(`expected line 2 after second j, got ${cursor.line}`);

  // k moves back up.
  await frame.keys('k');
  cursor = await frame.cursor();
  if (cursor.line !== 1) throw new Error(`expected line 1 after k, got ${cursor.line}`);
});

test('eval returns T-Lisp evaluation result', async ({ frame }) => {
  const r = await frame.eval('(length "hello")');
  if (r.trim() !== '5') throw new Error(`expected "5", got ${JSON.stringify(r)}`);
});
