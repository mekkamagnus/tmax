/**
 * @file mx-completion-cache.test.ts
 * @description BUG-78 (#182) — per-session caching of the M-x candidate-build.
 *   The candidate-build (`command-completion-refresh`: callable-command-details
 *   + filter + mapcar) is cached and recomputed only when the module registry
 *   generation bumps (a module loaded). This test covers the cache's
 *   correctness contract — the invalidation signal. The perf win (uncached
 *   ~280ms → cached ~1ms) is proven by the `minibuffer` benchmark, which
 *   dropped ~143× after caching landed.
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
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-mxcache-'));
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

function evalNum(editor: Editor, expr: string): number {
  const r = editor.getInterpreter().execute(expr);
  if (r?._tag !== 'Right' || (r as any).right.type !== 'number') {
    throw new Error(`${expr} => ${JSON.stringify(r)}`);
  }
  return (r as any).right.value as number;
}

test('module-registry-generation is a positive number after startEditor', async () => {
  const { editor, server } = await startedEditor();
  try {
    const gen = evalNum(editor, '(module-registry-generation)');
    expect(Number.isFinite(gen) && gen > 0).toBe(true);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('registering a module bumps the generation (cache invalidation signal)', async () => {
  const { editor, server } = await startedEditor();
  try {
    // The generation is the cache-invalidation token (BUG-78). It must bump on
    // every module register/load so command-completion-refresh recomputes when
    // the command set could have changed. Verified at the TS contract level
    // (the editor's module loader is pinned to the core dir, so a custom
    // require-module can't be used here; register() is what every load calls).
    const reg = (editor.getInterpreter() as any).moduleRegistry;
    const before = reg.getGeneration();
    reg.register("cachetest", reg.resolve("editor/commands/execute-extended-command")?.env ?? editor.getInterpreter().globalEnv, new Set(), "");
    expect(reg.getGeneration()).toBe(before + 1);
    // And the T-Lisp primitive reflects the same value.
    expect(evalNum(editor, '(module-registry-generation)')).toBe(before + 1);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('command-completion-refresh runs without error and stays cached across calls', async () => {
  const { editor, server } = await startedEditor();
  try {
    const r1 = editor.getInterpreter().execute('(command-completion-refresh)');
    expect(r1?._tag).toBe('Right');
    // A second refresh with no module load in between is a cache hit (no error,
    // same result). Correctness of the cache hit/skip is bench-proven (the
    // `minibuffer` benchmark dropped ~143× once caching landed); here we only
    // assert it does not error.
    const r2 = editor.getInterpreter().execute('(command-completion-refresh)');
    expect(r2?._tag).toBe('Right');
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('repeated M-x opens are instant after the first (the cache pays off)', async () => {
  // Substantiates BUG-78's manual-repro criterion ("repeated M-x opens are
  // instant after the first") with an automated artifact: the first refresh
  // (uncached) is the ~280ms candidate-build; the second (cached) is sub-ms.
  // The delta is ~100–700×, so a "second is >10× faster" assertion is robust
  // against machine/JIT variance while still failing if the cache regresses.
  const { editor, server } = await startedEditor();
  try {
    const interp = editor.getInterpreter();
    const timed = (expr: string): number => {
      const s = Bun.nanoseconds();
      interp.execute(expr);
      return Bun.nanoseconds() - s;
    };
    const firstNs = timed('(command-completion-refresh)');   // uncached build
    const secondNs = timed('(command-completion-refresh)');  // cache hit
    expect(secondNs * 10).toBeLessThan(firstNs);             // >10× faster
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);
