/**
 * @file help-mode.test.ts
 * @description SPEC-110 (#177) — help-mode: cross-references + history in *Help*.
 *   *Help* is read-only in major-mode "help"; RET follows [name] symbols; TAB
 *   cycles references; l/r navigate history; q buries.
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
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-helpmode-home-'));
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
  if (r?._tag !== 'Right') throw new Error(`${expr} failed: ${(r as any)?.left?.message ?? r}`);
  return (r as any).right.value;
}

test('*Help* is read-only in major-mode "help" after describe-function', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(describe-function "save-buffer")');
    expect(evalStr(editor, '(buffer-read-only-p "*Help*")')).toBe(true);
    expect(editor.getState().currentMajorMode ?? '').toBe('help');
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('apropos output has [name] references detected by help-scan-references', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(apropos-run "save")');
    editor.executeCommand('(buffer-switch "*Help*")');
    const refs = editor.getInterpreter().execute('(help-scan-references)');
    const refList = ((refs as any)?.right?.value ?? []) as any[];
    expect(refList.length).toBeGreaterThan(0);
    const names = refList.map((r) => r.value?.[1]?.value);
    expect(names.some((n: string) => /save/i.test(n))).toBe(true);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('help-follow describes the symbol at point', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(apropos-run "save")');
    editor.executeCommand('(buffer-switch "*Help*")');
    const refs = editor.getInterpreter().execute('(help-scan-references)');
    const refList = ((refs as any)?.right?.value ?? []) as any[];
    if (refList.length > 0) {
      const line = refList[0].value[0].value as number;
      editor.executeCommand(`(cursor-move ${line} 1)`);
      editor.executeCommand('(help-follow)');
      expect(evalStr(editor, '(buffer-text)')).toContain('Function:');
    }
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('TAB→RET navigation loop works (help-next-ref → help-follow)', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(apropos-run "save")');
    editor.executeCommand('(buffer-switch "*Help*")');
    // TAB to the first reference — cursor lands at col 1 inside [name].
    editor.executeCommand('(help-next-ref)');
    // RET follows the symbol at point.
    editor.executeCommand('(help-follow)');
    // *Help* should now show a Function page (not the apropos list).
    expect(evalStr(editor, '(buffer-text)')).toContain('Function:');
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('help-back navigates to the previous page', async () => {
  const { editor, server } = await startedEditor();
  try {
    // Page 1: describe save-buffer
    editor.executeCommand('(describe-function "save-buffer")');
    // Page 2: follow a link (help-follow pushes a new page via describe-function)
    editor.executeCommand('(cursor-move 2 0)');
    editor.executeCommand('(help-follow)');
    // help-back should go back to page 1
    editor.executeCommand('(help-back)');
    const text = evalStr(editor, '(buffer-text)');
    // Should contain something from the first page (save-buffer's describe output)
    expect(text).toContain('save-buffer');
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('help-mode bindings are scoped to major-mode "help"', async () => {
  const src = await Bun.file('src/tlisp/core/commands/describe.tlisp').text();
  expect(src).toContain('(key-bind "RET" "(help-follow)" "normal" "help")');
  expect(src).toContain('(key-bind "TAB" "(help-next-ref)" "normal" "help")');
  expect(src).toContain('(key-bind "l" "(help-back)" "normal" "help")');
  expect(src).toContain('(key-bind "r" "(help-forward)" "normal" "help")');
  expect(src).toContain('(key-bind "q" "(help-bury)" "normal" "help")');
  expect(src).toContain('(key-bind "S-TAB" "(help-prev-ref)" "normal" "help")');
});

test('describe-function output contains [name] cross-references', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(describe-function "save-buffer")');
    editor.executeCommand('(buffer-switch "*Help*")');
    const refs = editor.getInterpreter().execute('(help-scan-references)');
    const refList = ((refs as any)?.right?.value ?? []) as any[];
    // Should find at least one [name] reference (save-buffer itself + any
    // callable mentioned in its docstring).
    expect(refList.length).toBeGreaterThan(0);
    const names = refList.map((r) => r.value?.[1]?.value);
    expect(names).toContain('save-buffer');
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);
