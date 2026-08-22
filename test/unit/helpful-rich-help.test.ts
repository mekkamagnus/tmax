/**
 * @file helpful-rich-help.test.ts
 * @description SPEC-113 (#180) — helpful-style rich *Help* layout.
 *   describe-function renders Source (file:line + excerpt), Key bindings,
 *   References, Related, Examples sections; describe-variable renders value +
 *   Source + References. The section data comes from describe-function-data
 *   (keys/examples/related), help-source-location (file:line + excerpt), and
 *   help-symbol-references (a lightweight source-scan xref).
 *
 * Assertions use T-Lisp expressions that return simple values (string/number)
 * to avoid depending on the TLispValue container shape, plus the rendered
 * *Help* buffer text for the section checks.
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
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-helpful-'));
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

/** Run a describe command, switch to *Help*, return the rendered text. */
function helpText(editor: Editor, cmd: string): string {
  const r = editor.executeCommand(cmd);
  if (r && (r as any)._tag === 'Left') throw new Error(`${cmd} → ${(r as any).left.message}`);
  editor.executeCommand('(buffer-switch "*Help*")');
  const t = editor.getInterpreter().execute('(buffer-text)');
  if (t?._tag !== 'Right') throw new Error('buffer-text failed');
  return (t as any).right.value as string;
}

/** Evaluate a T-Lisp expr that returns a simple value (string/number/boolean). */
function ev(editor: Editor, expr: string): unknown {
  const r = editor.getInterpreter().execute(expr) as any;
  if (r?._tag !== 'Right') throw new Error(`${expr} → ${JSON.stringify(r?.left)}`);
  return r.right.value;
}

// ── primitives (simple-value T-Lisp checks) ──────────────────────────────

test('help-source-location returns the source file for a T-Lisp defun', async () => {
  const { editor, server } = await startedEditor();
  try {
    const file = ev(editor, '(hashmap-get (help-source-location "save-buffer") "file")');
    expect(file).toContain('save.tlisp');
    const line = ev(editor, '(hashmap-get (help-source-location "save-buffer") "line")');
    expect(Number(line)).toBeGreaterThan(0);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('help-source-location finds a module defvar (e.g. help-buffer-name)', async () => {
  const { editor, server } = await startedEditor();
  try {
    const file = ev(editor, '(hashmap-get (help-source-location "help-buffer-name") "file")');
    expect(file).toContain('describe.tlisp');
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('help-source-location is nil for a TS primitive (no .tlisp source)', async () => {
  const { editor, server } = await startedEditor();
  try {
    const found = ev(editor, '(if (nilp (help-source-location "cursor-move")) "nil" "found")');
    expect(found).toBe('nil');
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('help-symbol-references returns a non-empty list', async () => {
  const { editor, server } = await startedEditor();
  try {
    const n = ev(editor, '(length (help-symbol-references "save-buffer"))');
    expect(Number(n)).toBeGreaterThan(0);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

// ── describe-function rich sections ──────────────────────────────────────

test('describe-function shows Source + References for a T-Lisp defun', async () => {
  const { editor, server } = await startedEditor();
  try {
    const txt = helpText(editor, '(describe-function "save-buffer")');
    expect(txt).toContain('save-buffer');
    expect(txt).toContain('— Source —');
    expect(txt).toContain('save.tlisp');
    expect(txt).toContain('— References —');
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('describe-function shows Key bindings for a key-bound command', async () => {
  const { editor, server } = await startedEditor();
  try {
    // cursor-move is invoked by h/j/k/l (+ arrow keys).
    const txt = helpText(editor, '(describe-function "cursor-move")');
    expect(txt).toContain('— Key bindings —');
    expect(txt).toMatch(/\bh\b/);
    expect(txt).toMatch(/\bj\b/);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('describe-function reports an unknown name without error', async () => {
  const { editor, server } = await startedEditor();
  try {
    const txt = helpText(editor, '(describe-function "no-such-function-xyz")');
    expect(txt).toContain('not defined');
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

// ── describe-variable ────────────────────────────────────────────────────

test('describe-variable shows the value of a bound variable', async () => {
  const { editor, server } = await startedEditor();
  try {
    // There are no stock global variables (all are module-scoped), so define
    // one in the global env to exercise the value-render path.
    editor.getInterpreter().execute('(defvar test-helpful-var 42)');
    const txt = helpText(editor, '(describe-variable "test-helpful-var")');
    expect(txt).toContain('test-helpful-var');
    expect(txt).toMatch(/is .*42/);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('describe-variable reports an unbound variable without error', async () => {
  const { editor, server } = await startedEditor();
  try {
    const txt = helpText(editor, '(describe-variable "no-such-variable-xyz")');
    expect(txt).toContain('not defined');
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

// ── no regression ────────────────────────────────────────────────────────

test('describe-function still shows signature + docstring (no regression)', async () => {
  const { editor, server } = await startedEditor();
  try {
    const txt = helpText(editor, '(describe-function "save-buffer")');
    expect(txt).toContain('save-buffer');
    expect(txt).toContain('Save current buffer'); // docstring first line
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);
