/**
 * @file embedded-save.tmax-use.ts
 * @description Black-box regression for BUG-58: `tmax file.md` → type → `:w`
 *   must write the buffer to disk.
 *
 * This is the test that BUG-58 escaped through. Every other save test drives
 * the daemon RPC path (`Editor.openFile`), which sets `bufferMetadata.filename`
 * correctly. BUG-58 lived in `src/main.ts`'s CLI bootstrap, which did NOT, so
 * the first `buffer-insert` wiped `currentFilename` and `:w` found no file. The
 * only faithful reproduction is to launch the REAL embedded editor with the file
 * as an argv argument and drive the TUI — which is what this does via
 * `EmbeddedEditor`.
 *
 * Loaded only by the tmax-use runner (the `.tmax-use.ts` suffix keeps Bun's test
 * discovery away). It ignores the daemon `frame` fixture and spawns its own
 * embedded editor in an isolated HOME + unique socket.
 *
 * Regression proof: this test FAILS on `7d3f0c8^` (the BUG-58 parent) — either
 * at launch (the cleanStart `*scratch*` reset makes `(buffer-filename)` nil) or
 * at the disk assertion (cause #2 wipes the filename on the first keystroke) —
 * and PASSES on HEAD.
 */
import { test } from '../test/index.ts';
import { EmbeddedEditor } from '../src/embedded-instance.ts';
import { promises as fs } from 'fs';
import { join } from 'path';

/** Poll until `file` exists with content containing `marker`, or time out. */
async function waitForDisk(file: string, timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = undefined;
  while (Date.now() < deadline) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      return content;
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error(`file ${file} not written within ${timeoutMs}ms (last error: ${String(lastErr)})`);
}

/** Drive insert→type→Esc→:w on an embedded editor. Mode-switch waits make it
 *  robust under runner load (fixed sleeps can race the async command-mode switch). */
async function typeAndSave(ed: EmbeddedEditor, text: string): Promise<void> {
  await ed.sendKey('i');          // enter insert mode
  await ed.send(text);
  await ed.sendKey('Escape');     // back to normal
  await ed.waitForMode('normal');
  await ed.send(':');
  await ed.waitForMode('command'); // ensure `:` switched before `w` arrives
  await ed.send('w');
  await ed.sendKey('Enter');      // :w
  await ed.waitForMode('normal');
}

test('embedded editor :w writes a NEW file to disk (BUG-58)', async ({ tmpDir }) => {
  const file = join(tmpDir, 'embedded-new.md'); // does NOT exist yet
  const ed = await EmbeddedEditor.launch({ file });
  try {
    await typeAndSave(ed, 'BUG-58-MARKER-new');
    const content = await waitForDisk(file);
    if (content !== 'BUG-58-MARKER-new') {
      throw new Error(`expected exact "BUG-58-MARKER-new", got ${JSON.stringify(content)}`);
    }
  } finally {
    await ed.close();
  }
});

test('embedded editor :w preserves an EXISTING file (BUG-58)', async ({ tmpDir }) => {
  const file = join(tmpDir, 'embedded-existing.md');
  await fs.writeFile(file, 'pre-existing-line\n', 'utf-8');

  const ed = await EmbeddedEditor.launch({ file });
  try {
    // Cursor starts at line 0 col 0; insert at the start of the line.
    await typeAndSave(ed, 'APPENDED');
    const content = await waitForDisk(file);
    // EXACT content (per spec): inserted text prefixed at col 0, rest intact.
    if (content !== 'APPENDEDpre-existing-line\n') {
      throw new Error(`expected exact "APPENDEDpre-existing-line\\n", got ${JSON.stringify(content)}`);
    }
  } finally {
    await ed.close();
  }
});
