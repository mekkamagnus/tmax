/**
 * @file orderless-bulk-filter.test.ts
 * @description BUG-79 — the orderless-filter-candidates builtin (the bulk M-x
 *   filter) must produce results identical to the orderless.tlisp semantics
 *   for every component style: default regexp (smart-case), `=` literal,
 *   `^` prefix, `~` flex, `,` initialism, `&` annotation, `!` negation, and
 *   space-separated multi-component input. Expectations are hand-computed
 *   fixtures; they lock the semantics regardless of which layer computes them.
 */
import { test, expect } from 'bun:test';
import { TLispInterpreterImpl } from '../../src/tlisp/interpreter.ts';

const interp = new TLispInterpreterImpl();

/** Fixture candidates (display + annotation + value), the completion shape. */
const CANDS = `(list
  (hashmap "value" "save-buffer" "display" "save-buffer" "annotation" "")
  (hashmap "value" "switch-to-buffer" "display" "switch-to-buffer" "annotation" "")
  (hashmap "value" "mx" "display" "execute-extended-command" "annotation" "M-x"))`;

/** Values surviving the filter for INPUT. */
function filteredValues(input: string): string[] {
  const r = interp.execute(`(mapcar (lambda (c) (hashmap-get c "value")) (orderless-filter-candidates ${JSON.stringify(input)} ${CANDS}))`) as any;
  if (r?._tag !== 'Right') throw new Error(r?.left?.message);
  return r.right.value.map((v: any) => v.value as string);
}

/** The spans recorded on the FIRST surviving candidate. */
function firstSpans(input: string): [number, number][] {
  const r = interp.execute(`(hashmap-get (nth 0 (orderless-filter-candidates ${JSON.stringify(input)} ${CANDS})) "spans")`) as any;
  if (r?._tag !== 'Right') throw new Error(r?.left?.message);
  return r.right.value.map((pair: any) => pair.value.map((n: any) => n.value as number));
}

test('default style is smart-case regexp over the display', () => {
  expect(filteredValues('s')).toEqual(['save-buffer', 'switch-to-buffer']); // 's' at 0; C has no 's'
  expect(filteredValues('x')).toEqual(['mx']);                               // 'x' at 1 of execute-
  expect(filteredValues('save')).toEqual(['save-buffer']);
  expect(filteredValues('S')).toEqual([]);                                    // uppercase → case-sensitive
});

test('multi-component input: every component must match (order-independent)', () => {
  expect(filteredValues('s b')).toEqual(['save-buffer', 'switch-to-buffer']);
  expect(filteredValues('b s')).toEqual(['save-buffer', 'switch-to-buffer']);
  expect(filteredValues('save buffer')).toEqual(['save-buffer']);
});

test('`=` literal spans', () => {
  expect(filteredValues('=save')).toEqual(['save-buffer']);
  expect(filteredValues('=e.e')).toEqual([]);    // literal dot: no contiguous "e.e" anywhere
  expect(filteredValues('e.e')).toEqual(['mx']); // regex dot: "exe" at 1 in execute-
});

test('`^` prefix requires the match at position 0', () => {
  expect(filteredValues('^save')).toEqual(['save-buffer']);
  expect(filteredValues('^buffer')).toEqual([]);  // appears, but not at 0
});

test('`~` flex matches scattered characters in order', () => {
  expect(filteredValues('~svbf')).toEqual(['save-buffer']); // s..v..b..f
  expect(firstSpans('~svbf')).toEqual([[0, 1], [2, 3], [5, 6], [7, 8]]); // f at 7 in save-buFfer
  expect(filteredValues('~svt')).toEqual([]);               // no 'v' in switch-to-buffer at all
});

test('`,` initialism matches word-start characters', () => {
  expect(filteredValues(',stb')).toEqual(['switch-to-buffer']); // s(0) t(7) b(10)
  expect(filteredValues(',sb')).toEqual(['save-buffer', 'switch-to-buffer']); // save: s(0) b(5); switch: s(0) b(10)
  expect(filteredValues(',sx')).toEqual([]);                    // no word starts s then x anywhere
});

test('`&` matches against the annotation', () => {
  expect(filteredValues('&M-x')).toEqual(['mx']);
  expect(filteredValues('&execute')).toEqual([]); // annotation is "M-x", not the display
});

test('`!` negation: rejects display matches, passes the rest', () => {
  expect(filteredValues('save !buffer')).toEqual([]);        // A contains "buffer" → rejected
  expect(filteredValues('save !zzz')).toEqual(['save-buffer']); // nothing contains zzz
});

test('empty input passes every candidate with empty spans', () => {
  expect(filteredValues('')).toEqual(['save-buffer', 'switch-to-buffer', 'mx']);
  expect(firstSpans('')).toEqual([]);
});

test('repeated/extra spaces are collapsed into components', () => {
  expect(filteredValues('  save   buffer  ')).toEqual(['save-buffer']);
  expect(filteredValues('   ')).toEqual(['save-buffer', 'switch-to-buffer', 'mx']);
});

test('spans are attached to surviving candidates', () => {
  // 's b' over save-buffer: 's' at 0, 'b' at 5.
  expect(firstSpans('s b')).toEqual([[0, 1], [5, 6]]);
});

test('the span builtins and the bulk filter share one implementation', () => {
  // literal-match-spans must agree with the spans the bulk filter records for `=`.
  const r = interp.execute('(literal-match-spans "save" "save-buffer" t)') as any;
  const spans = r.right.value.map((pair: any) => pair.value.map((n: any) => n.value as number));
  expect(spans).toEqual([[0, 4]]);
  expect(firstSpans('=save')).toEqual(spans);
});

// SPEC-121: hostile characters in a completion component ("(2026" is an
// INVALID JS RegExp) must degrade to a LITERAL match, not drop every
// candidate — the live bug where typing a paren made the [[ finder show
// "No match".
test('invalid-regex components degrade to literal matching (SPEC-121)', () => {
  const spans = (pattern: string, target: string): number => {
    const r = interp.execute(`(length (string-match-spans ${JSON.stringify(pattern)} ${JSON.stringify(target)} nil))`) as any;
    return r.right.value as number;
  };
  expect(spans('(2026', '+ Create: Fresh Idea (2026')).toBe(1);
  expect(spans('[x', 'a [x] b')).toBe(1);
  expect(spans('zzz', 'abc')).toBe(0);
  // Through the BULK filter an invalid-regex component no longer ERRORS or
  // wipes the pool — it literal-matches (no fixture display contains "(",
  // so the correct result is none; before the fix this same call also
  // returned [], but any component MIXED with "(" killed all matches).
  expect(filteredValues('(')).toEqual([]);
});
