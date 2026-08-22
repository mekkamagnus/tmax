/**
 * @file magic-mode-detect.test.ts
 * @description SPEC-103 (#170) — content-based (magic) major-mode detection.
 *   When the filename matches no rule, the buffer head is sniffed: a shebang
 *   (interpreter → mode) then user/fallback magic regexps (`<!DOCTYPE html`).
 *   Pins the pure helpers + the detection wiring (precedence: filename > magic)
 *   + the user API.
 */
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { Editor } from '../../src/editor/editor.ts';
import { createEditorFixture } from '../helpers/editor-fixture.ts';
import { TmaxServer } from '../../src/server/server.ts';
import { detectMagicMode, parseShebang, detectShebang } from '../../src/editor/magic-mode.ts';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let savedHome: string | undefined;
let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-magic-home-'));
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

const REGISTERED = new Set(['shell', 'python', 'typescript', 'html', 'markdown', 'ruby', 'perl']);

// ---- detectMagicMode (Task 1) ----

test('detectMagicMode: registered regexp matches the buffer head', () => {
  expect(detectMagicMode('<?xml version="1.0"?>', [], [{ regexp: '^<\\?xml', mode: 'xml' }])).toBe('xml');
});

test('detectMagicMode: no rule matches → undefined', () => {
  expect(detectMagicMode('plain text', [], [{ regexp: '^<\\?xml', mode: 'xml' }])).toBeUndefined();
});

test('detectMagicMode: only the head is scanned', () => {
  // The `<?xml` appears past the 512-byte head → not matched.
  const text = 'x'.repeat(600) + '<?xml';
  expect(detectMagicMode(text, [], [{ regexp: '^<\\?xml', mode: 'xml' }])).toBeUndefined();
});

test('detectMagicMode: user rules beat fallback rules', () => {
  const user = [{ regexp: '^---', mode: 'markdown' }];
  const fallback = [{ regexp: '^---', mode: 'yaml' }];
  expect(detectMagicMode('---\ntitle', user, fallback)).toBe('markdown');
});

// ---- shebang (Task 2) ----

test('parseShebang / detectShebang: #!/bin/bash → shell', () => {
  expect(parseShebang('#!/bin/bash')).toBe('bash');
  expect(detectShebang('#!/bin/bash\necho hi', REGISTERED)).toBe('shell');
});

test('shebang: #!/usr/bin/env python3 → python', () => {
  expect(parseShebang('#!/usr/bin/env python3')).toBe('python3');
  expect(detectShebang('#!/usr/bin/env python3 -u\nprint(1)', REGISTERED)).toBe('python');
});

test('shebang: #!/usr/bin/env node → typescript (tmax JS mode)', () => {
  expect(detectShebang('#!/usr/bin/env node\nconsole.log(1)', REGISTERED)).toBe('typescript');
});

test('shebang: unknown interpreter → undefined (falls through)', () => {
  expect(detectShebang('#!/usr/bin/env frobnicate\ndo', REGISTERED)).toBeUndefined();
  expect(detectShebang('not a shebang at all', REGISTERED)).toBeUndefined();
});

// ---- detection wiring + precedence (Task 3) ----

test('extension-less shebang script detects by interpreter', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.createBuffer('work', '#!/usr/bin/env bash\nset -e\necho hi');
    editor.executeCommand('(buffer-switch "work")');
    editor.executeCommand('(set-buffer-filename "deploy")');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('shell');
    expect(currentMajorMode(editor)).toBe('shell');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('<!DOCTYPE html signature detects html (mode self-registration)', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.createBuffer('work', '<!DOCTYPE html>\n<html><body></body></html>');
    editor.executeCommand('(buffer-switch "work")');
    editor.executeCommand('(set-buffer-filename "page")');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('html');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('<?xml prolog detects xml (mode self-registration, backslash-free regexp)', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.createBuffer('work', '<?xml version="1.0" encoding="UTF-8"?>\n<root/>');
    editor.executeCommand('(buffer-switch "work")');
    editor.executeCommand('(set-buffer-filename "feed")');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('xml');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('filename detection beats magic (x.sh + html content → shell)', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.createBuffer('work', '<!DOCTYPE html>\n<html></html>');
    editor.executeCommand('(buffer-switch "work")');
    editor.executeCommand('(set-buffer-filename "script.sh")');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('shell');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

// ---- user API (Task 4) ----

test('(magic-mode-add REGEXP MODE) + magic-mode-rules (user rule works + lists)', async () => {
  const { editor, server } = await startedEditor();
  try {
    expect(evalStr(editor, '(magic-mode-add "^---" "markdown")')).toBe('markdown');
    editor.createBuffer('work', '---\ntitle: x\n---\nbody');
    editor.executeCommand('(buffer-switch "work")');
    editor.executeCommand('(set-buffer-filename "front-matter")');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('markdown');
    // magic-mode-rules lists user + fallback rules.
    const rules = evalStr(editor, '(magic-mode-rules)');
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.some((r: any) => r.value?.[0]?.value === '^---' && r.value?.[1]?.value === 'markdown')).toBe(true);
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('no filename match + no magic → default-major-mode / fundamental', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.createBuffer('work', 'just some\nplain text with no signature');
    editor.executeCommand('(buffer-switch "work")');
    editor.executeCommand('(set-buffer-filename "mystery-file")');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('fundamental');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);
