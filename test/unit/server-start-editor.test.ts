/**
 * @file server-start-editor.test.ts
 * @description CHORE-69 Issue C / #78 — locks the BUG-58 server.ts fix:
 *   `startEditor()` with `cleanStart=true` must NOT discard a file the embedded
 *   editor was explicitly opened with. The cleanStart `(buffer-switch
 *   "*scratch*")` is guarded by `!currentFilename`, so it only fires for bare
 *   startup (no file).
 *
 *   Case 1: a preloaded file survives startEditor (currentFilename + buffer
 *           unchanged). This is the exact invariant BUG-58 broke.
 *   Case 2: with no file (currentFilename unset), cleanStart actively lands on
 *           *scratch* — the guard fires and switches.
 */
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { Editor } from '../../src/editor/editor.ts';
import { TerminalIOImpl } from '../../src/core/terminal.ts';
import { FileSystemImpl } from '../../src/core/filesystem.ts';
import { TmaxServer } from '../../src/server/server.ts';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Isolate HOME so initializeWorkspaces() never touches the user's real
// ~/.config/tmax workspace state.
let savedHome: string | undefined;
let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-cleanstart-home-'));
  savedHome = process.env.HOME;
  process.env.HOME = fakeHome;
});

afterEach(() => {
  process.env.HOME = savedHome;
  rmSync(fakeHome, { recursive: true, force: true });
});

/** Name of the editor's current buffer (via the public details API). */
function currentBufferName(editor: Editor): string | undefined {
  return editor.getBufferDetails().find((d) => d.current)?.name;
}

test('cleanStart=true preserves a preloaded file through startEditor (BUG-58 guard)', async () => {
  const editor = new Editor(new TerminalIOImpl(true), new FileSystemImpl());
  const file = join(fakeHome, 'preloaded.md');
  // *scratch* must exist (as it does in real startup) so that a regressed,
  // unconditional `(buffer-switch "*scratch*")` has somewhere to switch to —
  // otherwise the regression is invisible. Then load the file like main.ts.
  editor.createBuffer('*scratch*', '');
  editor.createBuffer(file, 'preloaded content');
  editor.applyUpdate({ type: 'SetCurrentFilename', filename: file });
  editor.associateBufferFilename(file);

  const server = new TmaxServer(undefined, true, editor, undefined, true); // cleanStart
  try {
    await server.startEditor();
    // The file must survive: filename preserved and buffer NOT switched to *scratch*.
    expect(editor.getState().currentFilename).toBe(file);
    expect(currentBufferName(editor)).not.toBe('*scratch*');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('cleanStart=true with no file lands on *scratch* (bare startup)', async () => {
  const editor = new Editor(new TerminalIOImpl(true), new FileSystemImpl());
  // Mirror main.ts bare flow: *scratch* exists, but a different buffer is
  // current (no associated filename). The cleanStart guard (currentFilename
  // unset) must switch current to *scratch*.
  editor.createBuffer('*scratch*', '');
  editor.createBuffer('somebuf', ''); // becomes current; no filename

  const server = new TmaxServer(undefined, true, editor, undefined, true); // cleanStart
  try {
    await server.startEditor();
    expect(editor.getState().currentFilename).toBeUndefined();
    expect(currentBufferName(editor)).toBe('*scratch*');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

// BUG-76: the bare-embedded path (main.ts → TmaxServer.startEditor) must seed
// the read-only splash into *scratch* so the Steep TUI has something to render
// on a fresh `tmax`. This pins the full server path (initializeWorkspaces →
// cleanStart buffer-switch → showSplashIfEmpty), not just showSplashIfEmpty in
// isolation (covered by show-splash.test.ts).
test('cleanStart bare startup seeds the read-only splash into *scratch* (BUG-76)', async () => {
  const editor = new Editor(new TerminalIOImpl(true), new FileSystemImpl());
  editor.createBuffer('*scratch*', ''); // bare startup: empty *scratch*, current

  const server = new TmaxServer(undefined, true, editor, undefined, true); // cleanStart
  try {
    await server.startEditor();
    expect(currentBufferName(editor)).toBe('*scratch*');
    // The current buffer (now *scratch*) must hold the splash text and be RO.
    const text = editor.getInterpreter().execute('(buffer-text)');
    expect(text._tag).toBe('Right');
    if (text._tag === 'Right') {
      expect(text.right.value).toContain('tmax — extensible terminal editor');
      expect(text.right.value).toContain('Press any key to continue');
    }
    const ro = editor.getInterpreter().execute('(buffer-read-only-p)');
    expect(ro._tag).toBe('Right');
    if (ro._tag === 'Right') {
      expect(ro.right.value).toBe(true);
    }
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);
