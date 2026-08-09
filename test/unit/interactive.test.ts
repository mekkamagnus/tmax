/**
 * @file interactive.test.ts
 * @description SPEC-115 (#183) — `(interactive)` declaration for T-Lisp commands.
 *   Covers: parser sets the flag (bare + spec forms), the form is not evaluated
 *   as a body expression, callable-command-details filters M-x to commands
 *   (interactive OR key-bound) with the all-callables fallback, and
 *   describe-function (SPC h f) stays unfiltered.
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
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-interactive-'));
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
  if (r?._tag !== 'Right') throw new Error(`${expr} failed: ${(r as any)?.left?.message ?? JSON.stringify(r)}`);
  return (r as any).right.value;
}

/** Truthy iff NAME appears in the interactive-only command table. */
function inFiltered(editor: Editor, name: string): boolean {
  return !!evalStr(editor, `(member ${JSON.stringify(name)} (mapcar (lambda (d) (hashmap-get d "name")) (callable-command-details t)))`);
}

/** Truthy iff NAME appears in the full (unfiltered) callable table. */
function inFull(editor: Editor, name: string): boolean {
  return !!evalStr(editor, `(member ${JSON.stringify(name)} (mapcar (lambda (d) (hashmap-get d "name")) (callable-command-details)))`);
}

// ── Phase 1: parser ──────────────────────────────────────────────────────

test('(interactive) bare form marks a defun as a command candidate', async () => {
  const { editor, server } = await startedEditor();
  try {
    evalStr(editor, '(defun tst-interactive-bare () "doc" (interactive) (message "hi"))');
    expect(inFiltered(editor, 'tst-interactive-bare')).toBe(true);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('(interactive "spec") form also marks a defun as a command candidate', async () => {
  const { editor, server } = await startedEditor();
  try {
    evalStr(editor, '(defun tst-interactive-spec (arg) "doc" (interactive "P") (message "hi"))');
    expect(inFiltered(editor, 'tst-interactive-spec')).toBe(true);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('defun without (interactive) is NOT a command candidate (when not key-bound)', async () => {
  const { editor, server } = await startedEditor();
  try {
    evalStr(editor, '(defun tst-plain-helper () "doc" (message "hi"))');
    expect(inFull(editor, 'tst-plain-helper')).toBe(true);   // visible globally
    expect(inFiltered(editor, 'tst-plain-helper')).toBe(false); // but not a command
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('(interactive) is stripped from the body — not evaluated as a body form', async () => {
  const { editor, server } = await startedEditor();
  try {
    // If (interactive) were evaluated as a body form, calling an unknown
    // `interactive` symbol would error. The body must run and return its value.
    evalStr(editor, '(defun tst-returns-42 () "doc" (interactive) 42)');
    expect(evalStr(editor, '(tst-returns-42)')).toBe(42);
    // Body with multiple forms after (interactive) — progn wrapping still works.
    evalStr(editor, '(defun tst-multi () "doc" (interactive) (message "a") 7)');
    expect(evalStr(editor, '(tst-multi)')).toBe(7);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('(interactive) with no following body is a syntax error', async () => {
  const { editor, server } = await startedEditor();
  try {
    const r = editor.getInterpreter().execute('(defun tst-no-body () (interactive))');
    expect(r?._tag).toBe('Left');
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

// ── Phase 2: completion filtering ─────────────────────────────────────────

test('callable-command-details with no arg returns ALL callables (describe-function parity)', async () => {
  const { editor, server } = await startedEditor();
  try {
    const full = evalStr(editor, '(length (callable-command-details))');
    expect(full).toBeGreaterThan(500); // ~1,164 today
    // Stdlib is present in the full table (describe-function must show it).
    expect(inFull(editor, 'car')).toBe(true);
    expect(inFull(editor, 'string-join')).toBe(true);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('callable-command-details with interactive-only excludes stdlib + internal helpers', async () => {
  const { editor, server } = await startedEditor();
  try {
    const filtered = evalStr(editor, '(length (callable-command-details t))');
    const full = evalStr(editor, '(length (callable-command-details))');
    expect(filtered).toBeLessThan(full);
    expect(filtered).toBeLessThan(200); // ~146 today (was ~1,164)
    // Stdlib and internal helpers are excluded.
    for (const name of ['car', 'cdr', 'string-join', 'mapcar', '+']) {
      expect(inFiltered(editor, name)).toBe(false);
    }
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('interactive-only retains key-bound + declared-interactive commands', async () => {
  const { editor, server } = await startedEditor();
  try {
    // Key-bound commands are retained.
    expect(inFiltered(editor, 'find-file')).toBe(true);
    expect(inFiltered(editor, 'editor-quit')).toBe(true);
    // Declared-(interactive) non-key-bound commands are retained (migration).
    expect(inFiltered(editor, 'save-buffer')).toBe(true);
    expect(inFiltered(editor, 'query-replace')).toBe(true);
    expect(inFiltered(editor, 'occur')).toBe(true);
    expect(inFiltered(editor, 'dired')).toBe(true);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('interactive-only fallback never returns an empty list', async () => {
  const { editor, server } = await startedEditor();
  try {
    // In a real session there are always key-bound commands, so the filtered
    // list is non-empty (the fallback returns the full table only when zero
    // commands qualify). The invariant: filtered is never empty.
    const filtered = evalStr(editor, '(length (callable-command-details t))');
    expect(filtered).toBeGreaterThan(0);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);
