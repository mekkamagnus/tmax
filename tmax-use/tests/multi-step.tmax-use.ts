/**
 * @file multi-step.tmax-use.ts
 * @description Multi-step integration scenario: open file, enter insert mode,
 *   type text, escape, save, verify buffer. Exercises the full Frame API
 *   chain against a real daemon.
 */
import { test } from '../test/index.ts';
import { expect } from '../assert/index.ts';
import { promises as fs } from 'fs';
import { join } from 'path';

/** Reset cursor to (0,0) on the current buffer so navigation tests start clean. */
function resetCursor(frame: import('../src/frame.ts').Frame): Promise<void> {
  return frame.eval('(cursor-move 0 0)').run().then(() => undefined);
}

test('open → insert → type → escape → verify buffer', async ({ frame, tmpDir }) => {
  const path = join(tmpDir, 'multi.txt');
  await fs.writeFile(path, 'AAA\nBBB\nCCC\n', 'utf-8');
  const open = await frame.openFile(path).run();
  if ('left' in open) throw new Error(`open failed: ${open.left.message}`);
  await resetCursor(frame);

  // Move to end of first line, enter insert mode, type.
  await frame.keys('j').run();          // down a line
  await frame.keys('A').run();          // append at end of line
  await frame.keys(', inserted').run(); // type text
  await frame.keys('<Esc>').run();      // back to normal

  // Verify buffer now contains the inserted text.
  const r = await expect(frame).toHaveBufferTextContaining(', inserted').runNow();
  if ('left' in r) throw new Error(`assertion failed: ${r.left.message}`);
});

test('navigation across lines via hjkl', async ({ frame, tmpDir }) => {
  const path = join(tmpDir, 'nav.txt');
  await fs.writeFile(path, 'aaaa\nbbbb\ncccc\n', 'utf-8');
  await frame.openFile(path).run();
  await resetCursor(frame);

  // j moves down.
  await frame.keys('j').run();
  let cursor = await frame.cursor().run();
  if ('left' in cursor) throw new Error(`cursor failed: ${cursor.left.message}`);
  if (cursor.right.line !== 1) {
    throw new Error(`expected line 1 after j, got ${cursor.right.line}`);
  }

  // Another j moves down again.
  await frame.keys('j').run();
  cursor = await frame.cursor().run();
  if ('left' in cursor) throw new Error(`cursor failed: ${cursor.left.message}`);
  if (cursor.right.line !== 2) {
    throw new Error(`expected line 2 after second j, got ${cursor.right.line}`);
  }

  // k moves back up.
  await frame.keys('k').run();
  cursor = await frame.cursor().run();
  if ('left' in cursor) throw new Error(`cursor failed: ${cursor.left.message}`);
  if (cursor.right.line !== 1) {
    throw new Error(`expected line 1 after k, got ${cursor.right.line}`);
  }
});

test('eval returns T-Lisp evaluation result', async ({ frame }) => {
  const r = await frame.eval('(length "hello")').run();
  if ('left' in r) throw new Error(`eval failed: ${r.left.message}`);
  if (r.right.trim() !== '5') {
    throw new Error(`expected "5", got ${JSON.stringify(r.right)}`);
  }
});
