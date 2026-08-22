/**
 * @file vertico-bulk-rows.test.ts
 * @description BUG-80 (#187) — the vertico-rows-bulk builtin must produce
 *   rows identical to the T-Lisp per-row reference (vertico-row →
 *   vertico-candidate-segments → segments-from-spans). Hand-computed fixtures
 *   pin the segment faces (candidate / completion-match / annotation), span
 *   ordering, the selected flag, and the annotation separator.
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
  fakeHome = mkdtempSync(join(tmpdir(), 'tmax-vbulk-'));
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

interface Seg { text: string; face: string }
interface Row { selected: boolean; segments: Seg[] }

/** Build rows via the bulk builtin for a T-Lisp candidate-list expression. */
function bulkRows(editor: Editor, candsExpr: string, selected: string): Row[] {
  const r = editor.getInterpreter().execute(`(vertico-rows-bulk ${candsExpr} ${JSON.stringify(selected)})`) as any;
  if (r?._tag !== 'Right') throw new Error(r?.left?.message);
  return (r.right.value as any[]).map((row) => {
    const m = row.value as Map<string, any>;
    const sel = m.get('selected')!.value as boolean;
    const segments = (m.get('segments')!.value as any[]).map((s) => {
      const sm = s.value as Map<string, any>;
      return { text: sm.get('text')!.value as string, face: sm.get('face')!.value as string };
    });
    return { selected: sel, segments };
  });
}

/** And via the T-Lisp per-row reference, for byte-parity. */
function refRow(editor: Editor, candExpr: string, selected: string): Row {
  const r = editor.getInterpreter().execute(`(vertico-row ${candExpr} ${JSON.stringify(selected)})`) as any;
  if (r?._tag !== 'Right') throw new Error(r?.left?.message);
  const m = r.right.value as Map<string, any>;
  return {
    selected: m.get('selected')!.value as boolean,
    segments: (m.get('segments')!.value as any[]).map((s) => {
      const sm = s.value as Map<string, any>;
      return { text: sm.get('text')!.value as string, face: sm.get('face')!.value as string };
    }),
  };
}

const CAND_A = `(hashmap "value" "v1" "display" "save-buffer"
  "annotation" "  [SPC x s] doc"
  "spans" (list (list 5 11) (list 0 4))
  "annotation-spans" (list (list 3 6)))`;

test('display spans become candidate/completion-match segments in order', async () => {
  const { editor, server } = await startedEditor();
  try {
    // spans sorted by start: [0,4] "save", then [5,11] "buffer"; "-" plain between.
    const row = bulkRows(editor, `(list ${CAND_A})`, 'v1')[0]!;
    expect(row.selected).toBe(true);
    expect(row.segments.slice(0, 3)).toEqual([
      { text: 'save', face: 'completion-match' },
      { text: '-', face: 'candidate' },
      { text: 'buffer', face: 'completion-match' },
    ]);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('annotation is appended with separator and its own spans', async () => {
  const { editor, server } = await startedEditor();
  try {
    const row = bulkRows(editor, `(list ${CAND_A})`, 'other')[0]!;
    expect(row.selected).toBe(false);
    // "  [SPC x s] doc": span [3,6] = "SPC" highlighted; rest annotation face.
    expect(row.segments.slice(3)).toEqual([
      { text: '  ', face: 'annotation' },
      { text: '  [', face: 'annotation' },
      { text: 'SPC', face: 'completion-match' },
      { text: ' x s] doc', face: 'annotation' },
    ]);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('empty spans → one plain candidate segment; empty annotation → omitted', async () => {
  const { editor, server } = await startedEditor();
  try {
    const plain = `(hashmap "value" "v2" "display" "plain text" "annotation" "" "spans" (list) "annotation-spans" (list))`;
    const row = bulkRows(editor, `(list ${plain})`, 'v2')[0]!;
    expect(row.segments).toEqual([{ text: 'plain text', face: 'candidate' }]);
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);

test('bulk output is identical to the T-Lisp per-row reference', async () => {
  const { editor, server } = await startedEditor();
  try {
    for (const sel of ['v1', 'other']) {
      expect(bulkRows(editor, `(list ${CAND_A})`, sel)[0]).toEqual(refRow(editor, CAND_A, sel));
    }
  } finally { try { await server.shutdown(); } catch {} }
}, 30_000);
