/**
 * @file helpgrep.test.ts
 * @description SPEC-111 (#178) — full-text search over the doc corpus.
 *   `:helpgrep <pattern>` / `M-x helpgrep` greps the Texinfo manuals → results
 *   in *Help* (occur-style file:line:match). Distinct from apropos (live
 *   symbols) — this searches the WRITTEN PROSE.
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
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-helpgrep-home-'));
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

function evalRaw(editor: Editor, expr: string): any {
  const r = editor.getInterpreter().execute(expr);
  if (r?._tag !== 'Right') throw new Error(`${expr} failed: ${(r as any)?.left?.message ?? r}`);
  return (r as any).right;
}

test('helpgrep-search finds matches in the Texinfo corpus', async () => {
  const { editor, server } = await startedEditor();
  try {
    // "Major Modes" is a chapter in tmax.texinfo (added by SPEC-106/#173).
    const result = evalRaw(editor, '(helpgrep-search "Major Modes")');
    expect(result.type).toBe('list');
    const matches = (result.value as any[]);
    expect(matches.length).toBeGreaterThan(0);
    // Each match is (file line text).
    const first = matches[0].value;
    expect(first[0].value).toContain('tmax.texinfo');
    expect(first[2].value.toLowerCase()).toContain('major modes');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('helpgrep-run renders results to *Help*', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(helpgrep-run "daemon")');
    editor.executeCommand('(buffer-switch "*Help*")');
    const text = evalRaw(editor, '(buffer-text)').value as string;
    expect(text).toContain('Helpgrep: daemon');
    // tmax.texinfo has a "Daemon/Client Architecture" chapter.
    expect(text.toLowerCase()).toContain('daemon');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test('helpgrep-run with no matches renders a no-matches page', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(helpgrep-run "zzzz-no-such-term-xyz")');
    editor.executeCommand('(buffer-switch "*Help*")');
    const text = evalRaw(editor, '(buffer-text)').value as string;
    expect(text).toContain('No matches');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);

test(':helpgrep is wired in command-line.tlisp', async () => {
  const src = await Bun.file('src/tlisp/core/commands/command-line.tlisp').text();
  expect(src).toContain('helpgrep');
});

test('helpgrep-jump opens the corpus file at the match line', async () => {
  const { editor, server } = await startedEditor();
  try {
    // Run helpgrep, then jump from a result line.
    editor.executeCommand('(helpgrep-run "Major Modes")');
    // The *Help* buffer has helpgrep results; cursor is at line 0.
    // Move to the first result line (past the title).
    editor.executeCommand('(cursor-move 2 0)');
    // helpgrep-jump parses the file:line: prefix + opens the corpus file.
    editor.executeCommand('(helpgrep-jump)');
    // The current buffer should now be the texinfo source.
    const bufName = evalRaw(editor, '(buffer-current)').value as string;
    expect(bufName).toContain('tmax.texinfo');
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);
