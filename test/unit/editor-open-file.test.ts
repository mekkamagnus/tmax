/**
 * @file editor-open-file.test.ts
 * @description CHORE-69 Issue B / #80 — the unified file-open path
 *   (`Editor.openOrCreateFile` / `attachFileBuffer`) preserves the buffer's
 *   filename through a `buffer-insert`, and saves both existing and new files.
 *   This is the exact BUG-58 invariant, now pinned at the shared primitive both
 *   the CLI bootstrap and the daemon `open` RPC route through.
 */
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { Editor } from '../../src/editor/editor.ts';
import { TerminalIOImpl } from '../../src/core/terminal.ts';
import { FileSystemImpl } from '../../src/core/filesystem.ts';
import { TmaxServer } from '../../src/server/server.ts';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let savedHome: string | undefined;
let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-openfile-home-'));
  savedHome = process.env.HOME;
  process.env.HOME = fakeHome;
});

afterEach(() => {
  process.env.HOME = savedHome;
  rmSync(fakeHome, { recursive: true, force: true });
});

/** Editor + started clean server (core bindings loaded) for T-Lisp primitives. */
async function startedEditor(): Promise<{ editor: Editor; server: TmaxServer }> {
  const editor = new Editor(new TerminalIOImpl(true), new FileSystemImpl());
  const server = new TmaxServer(undefined, true, editor, undefined, true);
  await server.startEditor();
  return { editor, server };
}

test('openOrCreateFile loads an EXISTING file and its filename survives buffer-insert', async () => {
  const { editor, server } = await startedEditor();
  try {
    const file = join(fakeHome, 'existing.txt');
    writeFileSync(file, 'original\n', 'utf-8');

    const { isNew } = await editor.openOrCreateFile(file);
    expect(isNew).toBe(false);
    expect(editor.getState().currentFilename).toBe(file);
    // The existing content was loaded into the buffer.
    expect(editor.getBufferDetails().find((d) => d.current)?.content).toContain('original');

    // The BUG-58 invariant: buffer-insert must NOT wipe the filename.
    // (Cursor starts at col 0, so the insert prefixes the first line.)
    editor.executeCommand('(buffer-insert "EDITED")');
    expect(editor.getState().currentFilename).toBe(file);

    // Save writes the combined content to disk.
    editor.executeCommand('(save-buffer)');
    expect(readFileSync(file, 'utf-8')).toBe('EDITEDoriginal\n');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('openOrCreateFile creates a buffer for a NEW (missing) file and saves it', async () => {
  const { editor, server } = await startedEditor();
  try {
    const file = join(fakeHome, 'brand-new.txt');
    expect(existsSync(file)).toBe(false);

    const { isNew } = await editor.openOrCreateFile(file);
    expect(isNew).toBe(true);
    expect(editor.getState().currentFilename).toBe(file);

    editor.executeCommand('(buffer-insert "fresh content")');
    // Filename still intact after insert (BUG-58 invariant via the shared path).
    expect(editor.getState().currentFilename).toBe(file);

    editor.executeCommand('(save-buffer)');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf-8')).toBe('fresh content');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);
