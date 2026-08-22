/**
 * @file save-as-mode-detect.test.ts
 * @description BUG-77 — `:w <file>` (save-as) must re-detect the major mode
 *   from the new filename, like Emacs `write-file` runs `normal-mode`. Both
 *   save entry points are pinned: the TS path (`Editor.saveFile`, reached by
 *   `:w <file>` via editor-execute-command-line) and the T-Lisp path
 *   (`save-buffer` with a filename, reached by `write-file` / `save-file`).
 *   Previously save-as left the buffer in whatever mode it had at open time
 *   (e.g. *scratch*'s fundamental-mode), so `:w 2026-08-08.md` stayed
 *   fundamental instead of becoming markdown-mode.
 */
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { Editor } from '../../src/editor/editor.ts';
import { createEditorFixture } from '../helpers/editor-fixture.ts';
import { TmaxServer } from '../../src/server/server.ts';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let savedHome: string | undefined;
let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-saveas-home-'));
  savedHome = process.env.HOME;
  process.env.HOME = fakeHome;
});

afterEach(() => {
  process.env.HOME = savedHome;
  rmSync(fakeHome, { recursive: true, force: true });
});

/** Editor + started clean server (core bindings + modes loaded). */
async function startedEditor(): Promise<{ editor: Editor; server: TmaxServer }> {
  // #228: createEditorFixture (the Change-12 convention) instead of a
  // direct Editor construction; the fixture's teardown handles dispose.
  const fixture = await createEditorFixture();
  const server = new TmaxServer(undefined, true, fixture.editor, undefined, true);
  await server.startEditor();
  return { editor: fixture.editor, server };
}

function currentMajorMode(editor: Editor): string {
  return editor.getState().currentMajorMode ?? 'fundamental';
}

test('Editor.saveFile(<file>.md) re-detects markdown-mode — the `:w <file>` path (BUG-77)', async () => {
  const { editor, server } = await startedEditor();
  try {
    // Fresh buffer is fundamental-mode (avoid the read-only splash buffer).
    editor.executeCommand('(buffer-create "work")');
    editor.executeCommand('(buffer-switch "work")');
    expect(currentMajorMode(editor)).toBe('fundamental');
    editor.executeCommand('(buffer-insert "# heading")');

    const mdFile = join(fakeHome, '2026-08-08.md');
    await editor.saveFile(mdFile);

    expect(editor.getState().currentFilename).toBe(mdFile);
    expect(currentMajorMode(editor)).toBe('markdown');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('save-as filename survives buffer-insert (BUG-58 in the save path) — mode stays markdown', async () => {
  // buffer-insert re-derives currentFilename from bufferMetadata; saveFile must
  // call associateBufferFilename so the just-detected mode is not reset on the
  // first keystroke after `:w <file>`.
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(buffer-create "work")');
    editor.executeCommand('(buffer-switch "work")');
    editor.executeCommand('(buffer-insert "# hi")');
    const mdFile = join(fakeHome, 'note.md');
    await editor.saveFile(mdFile);
    expect(currentMajorMode(editor)).toBe('markdown');

    // The first edit after save-as must NOT wipe the filename / reset the mode.
    editor.executeCommand('(buffer-insert " more")');
    expect(editor.getState().currentFilename).toBe(mdFile);
    expect(currentMajorMode(editor)).toBe('markdown');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('plain save (no filename arg) does NOT re-detect — keeps the current mode', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(buffer-create "work")');
    editor.executeCommand('(buffer-switch "work")');
    editor.executeCommand('(buffer-insert "# hi")');
    // Establish markdown-mode via save-as (the BUG-77 path), then verify a
    // subsequent PLAIN save (no filename arg) does not reset the mode.
    const mdFile = join(fakeHome, 'note.md');
    await editor.saveFile(mdFile);
    expect(currentMajorMode(editor)).toBe('markdown');

    editor.executeCommand('(buffer-insert " more")');
    await editor.saveFile();
    expect(currentMajorMode(editor)).toBe('markdown');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

// SPEC-105 (#172): the T-Lisp save path (write-file / save-file / save-buffer)
// reaches parity with the TS `:w <file>` path: re-detect the mode on save-as,
// and the filename must persist in bufferMetadata so a subsequent buffer-insert
// (which re-derives currentFilename — BUG-58) does not wipe it / reset the mode.

test('save-buffer <file>.md (write-file / save-file path) re-detects markdown-mode (SPEC-105)', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(buffer-create "work")');
    editor.executeCommand('(buffer-switch "work")');
    editor.executeCommand('(buffer-insert "# heading")');

    const mdFile = join(fakeHome, 'tlisp-note.md');
    editor.executeCommand(`(save-buffer "${mdFile}")`);

    expect(editor.getState().currentFilename).toBe(mdFile);
    expect(currentMajorMode(editor)).toBe('markdown');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('set-buffer-filename persists in bufferMetadata — filename survives buffer-insert (SPEC-105 / BUG-58)', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(buffer-create "work")');
    editor.executeCommand('(buffer-switch "work")');
    editor.executeCommand('(buffer-insert "# hi")');
    const mdFile = join(fakeHome, 'persist.md');
    // T-Lisp save-as sets the filename via set-buffer-filename (now also
    // persists in bufferMetadata) + re-detects the mode.
    editor.executeCommand(`(save-buffer "${mdFile}")`);
    expect(currentMajorMode(editor)).toBe('markdown');

    // The first edit after save-as must NOT wipe the filename / reset the mode.
    editor.executeCommand('(buffer-insert " more")');
    expect(editor.getState().currentFilename).toBe(mdFile);
    expect(currentMajorMode(editor)).toBe('markdown');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);
