/**
 * @file file-local-mode.test.ts
 * @description SPEC-102 (#169) — file-local `mode:` variable detection. A file
 *   declares its own major mode via `-*- mode: X; -*-` (incl. embedded in a
 *   comment / bare shorthand) or a `Local Variables:` block, overriding
 *   filename detection. Pins the pure scanner + the detection wiring + the
 *   `enable-local-variables` gate.
 */
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { Editor } from '../../src/editor/editor.ts';
import { createEditorFixture } from '../helpers/editor-fixture.ts';
import { TmaxServer } from '../../src/server/server.ts';
import { findFileLocalMode } from '../../src/editor/local-variables.ts';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let savedHome: string | undefined;
let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-filelocal-home-'));
  savedHome = process.env.HOME;
  process.env.HOME = fakeHome;
});

afterEach(() => {
  process.env.HOME = savedHome;
  rmSync(fakeHome, { recursive: true, force: true });
});

async function startedEditor(): Promise<{ editor: Editor; server: TmaxServer }> {
  // #228: createEditorFixture (the Change-12 convention) instead of a
  // direct Editor construction; the fixture's teardown handles dispose.
  const fixture = await createEditorFixture();
  const server = new TmaxServer(undefined, true, fixture.editor, undefined, true);
  await server.startEditor();
  return { editor: fixture.editor, server };
}

function evalStr(editor: Editor, expr: string): any {
  const r = editor.getInterpreter().execute(expr);
  if (r?._tag !== 'Right') {
    throw new Error(`${expr} failed: ${(r as any)?.left?.message ?? r}`);
  }
  return (r as any).right.value;
}

function currentMajorMode(editor: Editor): string {
  return editor.getState().currentMajorMode ?? 'fundamental';
}

// ---- Pure scanner (Task 1) ----

test('scanner: first-line `-*- mode: X; -*-`', () => {
  expect(findFileLocalMode('# -*- mode: python; -*-\nbody')).toBe('python');
});

test('scanner: embedded in a comment (`<!-- -*- mode: markdown; -*- -->`)', () => {
  expect(findFileLocalMode('<!-- -*- mode: markdown; -*- -->\n# hi')).toBe('markdown');
});

test('scanner: bare shorthand `-*- X -*-`', () => {
  expect(findFileLocalMode('-*- python -*-\n')).toBe('python');
});

test('scanner: `Local Variables:` block mode:', () => {
  expect(findFileLocalMode('code\n\nLocal Variables:\nmode: ruby\nEnd:')).toBe('ruby');
});

test('scanner: no declaration → undefined', () => {
  expect(findFileLocalMode('just some\nplain text')).toBeUndefined();
});

test('scanner: malformed (`-*- mode: ; -*-`) → undefined', () => {
  expect(findFileLocalMode('# -*- mode: ; -*-\n')).toBeUndefined();
});

// ---- Detection wiring + precedence (Tasks 2 & 3) ----

test('file-local mode overrides the filename (SPEC-102)', async () => {
  const { editor, server } = await startedEditor();
  try {
    // Filename is .txt → would be text-mode; content declares markdown.
    editor.createBuffer('work', '# -*- mode: markdown; -*-\nbody');
    editor.executeCommand('(buffer-switch "work")');
    editor.executeCommand('(set-buffer-filename "notes.txt")');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('markdown');
    expect(currentMajorMode(editor)).toBe('markdown');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('file-local overrides even when the filename already matches a rule', async () => {
  const { editor, server } = await startedEditor();
  try {
    // .md → markdown by filename; content declares text-mode → text wins.
    editor.createBuffer('work', '<!-- -*- mode: text; -*- -->\n# hi');
    editor.executeCommand('(buffer-switch "work")');
    editor.executeCommand('(set-buffer-filename "README.md")');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('text');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('no file-local declaration → unchanged (filename detection)', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.createBuffer('work', '# plain markdown content, no magic comment\nbody');
    editor.executeCommand('(buffer-switch "work")');
    editor.executeCommand('(set-buffer-filename "note.md")');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('markdown');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('(set-enable-local-variables nil) disables file-local detection (SPEC-102 gate)', async () => {
  const { editor, server } = await startedEditor();
  try {
    expect(evalStr(editor, '(enable-local-variables-p)')).toBe(true);
    editor.createBuffer('work', '# -*- mode: markdown; -*-\nbody');
    editor.executeCommand('(buffer-switch "work")');
    editor.executeCommand('(set-buffer-filename "notes.txt")');
    expect(evalStr(editor, '(set-enable-local-variables nil)')).toBe(false);
    // Gate off → file-local ignored → filename detection (text-mode for .txt).
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('text');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('unregistered declared mode falls through to filename detection', async () => {
  const { editor, server } = await startedEditor();
  try {
    // "nosuchmode" is not registered → fall through to the .md filename rule.
    editor.createBuffer('work', '# -*- mode: nosuchmode; -*-\nbody');
    editor.executeCommand('(buffer-switch "work")');
    editor.executeCommand('(set-buffer-filename "note.md")');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('markdown');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);
