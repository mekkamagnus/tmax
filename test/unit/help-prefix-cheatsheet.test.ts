/**
 * @file help-prefix-cheatsheet.test.ts
 * @description SPEC-109 (#176) — C-h real prefix dispatch + cheatsheet command.
 *   Verifies: C-h f/m/v/k/A bindings exist (mirroring SPC h); C-h is NOT
 *   intercepted as a single-key binding; SPC h c opens a cheatsheet; the
 *   cheatsheet buffer is read-only with expected content.
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
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-cheatsheet-home-'));
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

function evalStr(editor: Editor, expr: string): any {
  const r = editor.getInterpreter().execute(expr);
  if (r?._tag !== 'Right') throw new Error(`${expr} failed: ${(r as any)?.left?.message ?? r}`);
  return (r as any).right.value;
}

test('C-h subcommand bindings mirror SPC h (f/m/v/k/A)', async () => {
  const src = await Bun.file('src/tlisp/core/commands/describe.tlisp').text();
  expect(src).toContain('(key-bind "C-h f"');
  expect(src).toContain('(key-bind "C-h m"');
  expect(src).toContain('(key-bind "C-h v"');
  expect(src).toContain('(key-bind "C-h k"');
  expect(src).toContain('(key-bind "C-h A"');
});

test('C-h is NOT intercepted as a single-key binding', async () => {
  const src = await Bun.file('src/tlisp/core/bindings/normal.tlisp').text();
  expect(src).not.toContain('(key-bind "C-h" "(editor-handle-help-prefix)"');
});

test('SPC h c opens a read-only cheatsheet buffer', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.executeCommand('(cheatsheet)');
    // The *Cheatsheet* buffer should exist and be read-only.
    expect(evalStr(editor, '(if (member "*Cheatsheet*" (buffer-list)) t nil)')).toBe(true);
    editor.executeCommand('(buffer-switch "*Cheatsheet*")');
    const text = evalStr(editor, '(buffer-text)');
    expect(text).toContain('tmax Cheatsheet');
    expect(text).toContain('SPC h f');
    expect(text).toContain('C-h f/m/v/k');
    expect(evalStr(editor, '(buffer-read-only-p)')).toBe(true);
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}, 30_000);
