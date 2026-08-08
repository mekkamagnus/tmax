/**
 * @file apropos.test.ts
 * @description SPEC-107 (#174) — in-editor apropos. `apropos` searches
 *   command/function NAMES; `apropos-documentation` searches docstring BODIES.
 *   Both render to *Help* and are bound under SPC h. Pins the TS primitives
 *   (apropos-command, apropos-documentation), the T-Lisp wrappers, the *Help*
 *   rendering, and the SPC h a binding.
 */
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { Editor } from '../../src/editor/editor.ts';
import { TerminalIOImpl } from '../../src/core/terminal.ts';
import { FileSystemImpl } from '../../src/core/filesystem.ts';
import { TmaxServer } from '../../src/server/server.ts';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let savedHome: string | undefined;
let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-apropos-home-'));
  savedHome = process.env.HOME;
  process.env.HOME = fakeHome;
});

afterEach(() => {
  process.env.HOME = savedHome;
  rmSync(fakeHome, { recursive: true, force: true });
});

async function startedEditor(): Promise<{ editor: Editor; server: TmaxServer }> {
  const editor = new Editor(new TerminalIOImpl(true), new FileSystemImpl());
  const server = new TmaxServer(undefined, true, editor, undefined, true);
  await server.startEditor();
  return { editor, server };
}

/** Evaluate and return the Right TLispValue (throws on Left). */
function evalRaw(editor: Editor, expr: string): any {
  const r = editor.getInterpreter().execute(expr);
  if (r?._tag !== 'Right') throw new Error(`${expr} failed: ${(r as any)?.left?.message ?? r}`);
  return (r as any).right;
}

test('apropos-command searches command/function names', async () => {
  const { editor, server } = await startedEditor();
  try {
    const result = evalRaw(editor, '(apropos-command "save")');
    expect(result.type).toBe('list');
    const names = (result.value as any[]).map((row) => row.value[0]?.value);
    expect(names.length).toBeGreaterThan(0);
    expect(names.some((n: string) => /save/i.test(n))).toBe(true);
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('apropos-documentation searches docstring BODIES (not names)', async () => {
  const { editor, server } = await startedEditor();
  try {
    // describe-function's docstring contains "docstring"; it's not matched by
    // the NAME pattern "docstring", so a hit proves body search.
    const result = evalRaw(editor, '(apropos-documentation "docstring")');
    expect(result.type).toBe('list');
    const names = (result.value as any[]).map((row) => row.value[0]?.value);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('describe-function');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('apropos-run renders results to *Help*', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(apropos-run "save")');
    editor.executeCommand('(buffer-switch "*Help*")');
    const text = evalRaw(editor, '(buffer-text)').value as string;
    expect(text).toContain('Apropos: save');
    // a save command name should appear in the rendered body
    expect(text.toLowerCase()).toMatch(/save/);
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('apropos-run with no matches renders a no-matches page', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(apropos-run "zzzz-no-such-symbol-xyz")');
    editor.executeCommand('(buffer-switch "*Help*")');
    const text = evalRaw(editor, '(buffer-text)').value as string;
    expect(text).toContain('No matches.');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('apropos-command also searches VARIABLE names (not just functions)', async () => {
  const { editor, server } = await startedEditor();
  try {
    // normal-keymap / insert-keymap etc. are defvars (variables, not functions).
    const result = evalRaw(editor, '(apropos-command "keymap")');
    expect(result.type).toBe('list');
    const rows = (result.value as any[]).map((row) => ({
      name: row.value[0]?.value,
      doc: row.value[2]?.value,
    }));
    expect(rows.length).toBeGreaterThan(0);
    // At least one result is a variable (docstring === "(variable)").
    expect(rows.some((r: any) => r.doc === '(variable)')).toBe(true);
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('apropos + apropos-documentation are bound under SPC h (a / A)', async () => {
  const src = await Bun.file('src/tlisp/core/commands/describe.tlisp').text();
  expect(src).toContain('(key-bind "SPC h a" "(apropos)"');
  expect(src).toContain('(key-bind "SPC h A" "(apropos-documentation)"');
});
