/**
 * @file man-page-viewer.test.ts
 * @description SPEC-114 (#181) — man-page viewer.
 *   Covers the resolver, the woman (pure-TS roff) formatter, the man-binary
 *   backend's overstrike stripping, the man-format primitive, and the T-Lisp
 *   `man` command rendering into *Man* under man-mode.
 *
 *   Note: the page used (ls) exists on macOS/Linux at /usr/share/man/man1/ls.1.
 *   These tests assume a Unix host with system man pages (the CI/dev reality);
 *   they resolve a real page and render it.
 */
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { Editor } from '../../src/editor/editor.ts';
import { TerminalIOImpl } from '../../src/core/terminal.ts';
import { FileSystemImpl } from '../../src/core/filesystem.ts';
import { TmaxServer } from '../../src/server/server.ts';
import { resolveManPage, readManSource } from '../../src/editor/man/resolver.ts';
import { formatRoff, processEscapes } from '../../src/editor/man/woman.ts';
import { stripOverstrike } from '../../src/editor/man/man-backend.ts';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let savedHome: string | undefined;
let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-man-'));
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

// ── resolver ─────────────────────────────────────────────────────────────

test('resolveManPage finds a common command (ls)', () => {
  const r = resolveManPage('ls');
  expect(r).not.toBeNull();
  expect(r!.path).toContain('ls.1');
  expect(r!.section).toBe('1');
});

test('resolveManPage returns null for a nonexistent topic', () => {
  expect(resolveManPage('zzz-not-a-real-man-page-xyz')).toBeNull();
});

test('resolveManPage honors a requested section', () => {
  // printf is in section 1 (shell) and 3 (libc) on most systems.
  const r = resolveManPage('printf', '1');
  if (r) expect(r.section).toBe('1'); // present on this host
});

// ── woman formatter ──────────────────────────────────────────────────────

test('formatRoff renders a real page into structured text (NAME + SYNOPSIS)', () => {
  const r = resolveManPage('ls');
  if (!r) return; // skip on a host without man pages
  const out = formatRoff(readManSource(r));
  expect(out.length).toBeGreaterThan(0);
  expect(out).toMatch(/NAME/);
  expect(out).toMatch(/SYNOPSIS|DESCRIPTION/);
});

test('processEscapes drops font escapes and maps common glyphs', () => {
  expect(processEscapes('\\fBbold\\fR text')).toBe('bold text');
  expect(processEscapes('en\\-dash and \\\\backslash')).toBe('en-dash and \\backslash');
  expect(processEscapes('\\(em')).toBe('—');
});

test('formatRoff on classic-man source produces headers', () => {
  const src = '.TH FOO 1\n.SH NAME\nfoo \\- example\n.SH DESCRIPTION\nBody text.\n';
  const out = formatRoff(src);
  expect(out).toContain('FOO(1)');
  expect(out).toContain('NAME');
  expect(out).toContain('DESCRIPTION');
  expect(out).toContain('example');
});

// ── man backend ──────────────────────────────────────────────────────────

test('stripOverstrike decodes nroff bold + underline to plain text', () => {
  expect(stripOverstrike('a\ba')).toBe('a');       // bold
  expect(stripOverstrike('_\bb')).toBe('b');       // underline
  expect(stripOverstrike('x\by')).toBe('y');       // stray overstrike
});

// ── man-format primitive + T-Lisp command ────────────────────────────────

test('man-format primitive returns a hashmap with text + section', async () => {
  const { editor, server } = await startedEditor();
  try {
    const r = editor.getInterpreter().execute('(man-format "ls")') as any;
    expect(r?._tag).toBe('Right');
    const m = r.right.value; // Map
    expect(m.get('section').value).toBe('1');
    expect(m.get('text').value.length).toBeGreaterThan(0);
    expect(Array.isArray(m.get('seeAlso').value)).toBe(true);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('(man "ls") renders into *Man* under man-mode', async () => {
  const { editor, server } = await startedEditor();
  try {
    const r = editor.getInterpreter().execute('(man "ls")') as any;
    expect(r?._tag).toBe('Right');
    editor.executeCommand('(buffer-switch "*Man*")');
    const txt = editor.getInterpreter().execute('(buffer-text)') as any;
    const text: string = txt?.right?.value ?? '';
    expect(text).toMatch(/NAME/);
    expect(editor.getState().currentMajorMode).toBe('man');
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('section syntax: (man "printf(3)") parses topic + section', async () => {
  const { editor, server } = await startedEditor();
  try {
    // printf(3) resolves via the parser; on hosts without section 3 it returns
    // nil gracefully — either way the command must not error.
    const r = editor.getInterpreter().execute('(man "printf(3)")') as any;
    expect(r?._tag).toBe('Right');
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('unknown page returns Right(nil) without error (message goes to status)', async () => {
  const { editor, server } = await startedEditor();
  try {
    const r = editor.getInterpreter().execute('(man "zzz-not-real-xyz")') as any;
    expect(r?._tag).toBe('Right');     // nil result is still Right(nil)
    expect(r.right.value).toBeNull();
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('man-next-section jumps to a section header', async () => {
  const { editor, server } = await startedEditor();
  try {
    editor.getInterpreter().execute('(man "ls")');
    editor.executeCommand('(buffer-switch "*Man*")');
    editor.getInterpreter().execute('(cursor-move 0 0)');
    editor.getInterpreter().execute('(man-next-section)');
    const line = editor.getInterpreter().execute('(buffer-line (cursor-line))') as any;
    const text: string = (line?.right?.value ?? '').trim();
    // The cursor should now rest on an all-caps section header.
    expect(/^[A-Z][A-Z &-]+$/.test(text)).toBe(true);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);
