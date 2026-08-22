/**
 * @file default-major-mode.test.ts
 * @description SPEC-104 (#171) — the configurable no-match fallback. When no
 *   detection rule (filename, magic) matches, `major-mode-auto-detect` activates
 *   `default-major-mode` (default "fundamental"). An unregistered configured
 *   default falls back to fundamental + warns.
 */
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { Editor } from '../../src/editor/editor.ts';
import { createEditorFixture } from '../helpers/editor-fixture.ts';
import { TmaxServer } from '../../src/server/server.ts';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let savedHome: string | undefined;
let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-defaultmode-home-'));
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

/** Evaluate a T-Lisp expression and return its unwrapped value (fails on Left). */
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

/** Create a fresh, extension-less buffer (no detection rule matches) and make it current. */
function undetectedBuffer(editor: Editor): void {
  editor.executeCommand('(buffer-create "work")');
  editor.executeCommand('(buffer-switch "work")');
  // No-extension name → no auto-mode rule matches → falls to the default.
  editor.executeCommand('(set-buffer-filename "scratchbuffer-noext")');
}

test('default fallback is fundamental-mode (SPEC-104)', async () => {
  const { editor, server } = await startedEditor();
  try {
    undetectedBuffer(editor);
    expect(evalStr(editor, '(default-major-mode-get)')).toBe('fundamental');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('fundamental');
    expect(currentMajorMode(editor)).toBe('fundamental');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('(set-default-major-mode "markdown") is used for undetected buffers (SPEC-104)', async () => {
  const { editor, server } = await startedEditor();
  try {
    undetectedBuffer(editor);
    expect(evalStr(editor, '(set-default-major-mode "markdown")')).toBe('markdown');
    expect(evalStr(editor, '(default-major-mode-get)')).toBe('markdown');
    // The extension-less buffer now resolves to the configured default.
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('markdown');
    expect(currentMajorMode(editor)).toBe('markdown');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('(setq default-major-mode ...) errors cleanly + non-corrupting (T-Lisp Lisp-1, SPEC-104)', async () => {
  // tmax exposes the Emacs `default-major-mode` equivalent via setter/getter
  // primitives, NOT a setq-able variable. There is intentionally no
  // `(defvar default-major-mode …)` (T-Lisp is Lisp-1: a setq-able var named
  // `default-major-mode` would collide with / shadow a same-named function).
  // T-Lisp's setq requires a prior defvar, so the Emacs-style setq idiom
  // errors cleanly ("variable not defined") instead of corrupting the session.
  const { editor, server } = await startedEditor();
  try {
    undetectedBuffer(editor);
    expect(evalStr(editor, '(set-default-major-mode "markdown")')).toBe('markdown');
    const setqResult = editor.getInterpreter().execute('(setq default-major-mode "text")');
    expect(setqResult?._tag).toBe('Left'); // clean error, no shadow/corruption
    // Pin the wording the spec claims (T-Lisp setq requires a prior defvar).
    expect((setqResult as any)?.left?.message ?? '').toContain('not defined');
    // The configured default is unaffected; detection still works.
    expect(evalStr(editor, '(default-major-mode-get)')).toBe('markdown');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('markdown');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('set to "fundamental" explicitly is idempotent (SPEC-104 edge case)', async () => {
  const { editor, server } = await startedEditor();
  try {
    undetectedBuffer(editor);
    expect(evalStr(editor, '(set-default-major-mode "fundamental")')).toBe('fundamental');
    expect(evalStr(editor, '(default-major-mode-get)')).toBe('fundamental');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('fundamental');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('changing the default is forward-only — already-detected buffers keep their mode (SPEC-104)', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(set-default-major-mode "markdown")');
    // Buffer A: detected while default is markdown → markdown.
    editor.executeCommand('(buffer-create "a")');
    editor.executeCommand('(buffer-switch "a")');
    editor.executeCommand('(set-buffer-filename "a-noext")');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('markdown');

    // Switch the default; buffer A's mode must NOT change retroactively.
    editor.executeCommand('(set-default-major-mode "text")');
    editor.executeCommand('(buffer-switch "a")');
    expect(currentMajorMode(editor)).toBe('markdown');

    // A NEW undetected buffer picks up the new default (forward-only).
    editor.executeCommand('(buffer-create "b")');
    editor.executeCommand('(buffer-switch "b")');
    editor.executeCommand('(set-buffer-filename "b-noext")');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('text');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('filename detection still beats the default (SPEC-104 precedence)', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(set-default-major-mode "markdown")');
    // A .md filename matches auto-mode-alist → markdown wins regardless of default.
    editor.executeCommand('(buffer-create "md")');
    editor.executeCommand('(buffer-switch "md")');
    editor.executeCommand('(set-buffer-filename "note.md")');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('markdown');
    // And a different extension still wins over the default:
    editor.executeCommand('(buffer-create "tls")');
    editor.executeCommand('(buffer-switch "tls")');
    editor.executeCommand('(set-buffer-filename "script.tlisp")');
    // tlisp-mode (if registered) or fundamental — but NOT forced to markdown by the default.
    const detected = evalStr(editor, '(major-mode-auto-detect)');
    expect(detected).not.toBe('markdown');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('unregistered default-major-mode falls back to fundamental + warns (SPEC-104)', async () => {
  const { editor, server } = await startedEditor();
  try {
    undetectedBuffer(editor);
    expect(evalStr(editor, '(set-default-major-mode "nosuchmode")')).toBe('nosuchmode');
    expect(evalStr(editor, '(major-mode-auto-detect)')).toBe('fundamental');
    expect(currentMajorMode(editor)).toBe('fundamental');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);
