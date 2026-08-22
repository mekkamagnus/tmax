/**
 * @file major-mode-docs.test.ts
 * @description SPEC-108 (#175) — major-mode documentation: every registered
 *   major mode carries a purpose description; describe-mode shows it.
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
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-mode-docs-home-'));
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

test('every registered major mode has a non-empty description', async () => {
  const { editor, server } = await startedEditor();
  try {
    const modes = (evalStr(editor, '(major-mode-list)') as any[]).map((m) => m.value);
    expect(modes.length).toBeGreaterThanOrEqual(22);
    const missing: string[] = [];
    for (const m of modes) {
      const desc = evalStr(editor, `(major-mode-description "${m}")`);
      if (!desc || desc === '') missing.push(m);
    }
    expect(missing).toEqual([]);
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('specific mode descriptions are correct', async () => {
  const { editor, server } = await startedEditor();
  try {
    expect(evalStr(editor, '(major-mode-description "c")')).toBe('C source code editing');
    expect(evalStr(editor, '(major-mode-description "markdown")')).toBe('Markdown rich-text editing');
    expect(evalStr(editor, '(major-mode-description "fundamental")')).toBe('Default mode with no language-specific behavior');
    expect(evalStr(editor, '(major-mode-description "typescript")')).toBe('TypeScript and JavaScript editing');
    expect(evalStr(editor, '(major-mode-description "nosuchmode")')).toBe('');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('describe-mode shows the description', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(major-mode-set "markdown")');
    editor.executeCommand('(describe-mode)');
    editor.executeCommand('(buffer-switch "*Help*")');
    const text = evalStr(editor, '(buffer-text)');
    expect(text).toContain('markdown');
    expect(text).toContain('Markdown rich-text editing');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);
