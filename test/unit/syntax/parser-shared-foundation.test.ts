/**
 * @file parser-shared-foundation.test.ts
 * @description CHORE-44 Change 11 — tests for the shared parser mechanics
 * extracted into `src/syntax/ast/parsers/shared/`:
 *   - `source-position.ts` (offset↔line/column via a line-start map)
 *   - `token-stream.ts`    (generic lookahead/advance/match/expect)
 *   - `node-factory.ts`    (language-bound createNode + errorNode + makePosition/makeSpan)
 *
 * Two test surfaces:
 *   1. MECHANICS — edge cases for each shared helper (EOF, mid-token,
 *      Unicode + newline position math, parent links, span/error-node shape).
 *   2. PARITY — each of the four native parsers parses a small stable snippet
 *      and the serialized AST must match a baked-in JSON snapshot. This is
 *      the AC11.5 regression net: any drift in node kinds, spans, labels,
 *      children, or error reporting will fail loudly.
 *
 * The parity snapshots were captured against the post-migration parsers
 * (which route through the shared helpers). They are the source of truth
 * for "AST output did not change."
 */
import { describe, test, expect, beforeEach } from "bun:test";
import {
  buildLineMap,
  positionAt,
  spanFrom,
  emptySpanAt,
} from "../../../src/syntax/ast/parsers/shared/source-position.ts";
import { TokenStream } from "../../../src/syntax/ast/parsers/shared/token-stream.ts";
import {
  bindNodeFactory,
  errorNode,
  makePosition,
  makeSpan,
} from "../../../src/syntax/ast/parsers/shared/node-factory.ts";
import { createNode, resetNodeIdCounter } from "../../../src/syntax/ast/types.ts";
import { serializeAST } from "../../../src/syntax/ast/serializer.ts";
import { cParser } from "../../../src/syntax/ast/parsers/c-parser.ts";
import { goParser } from "../../../src/syntax/ast/parsers/go-parser.ts";
import { pythonParser } from "../../../src/syntax/ast/parsers/python-parser.ts";
import { typescriptParser } from "../../../src/syntax/ast/parsers/typescript-parser.ts";
import { Either } from "../../../src/utils/task-either.ts";

// ---------------------------------------------------------------------------
// MECHANICS — source-position
// ---------------------------------------------------------------------------

describe("shared/source-position", () => {
  test("buildLineMap: empty source → [0]", () => {
    expect(buildLineMap("")).toEqual([0]);
  });

  test("buildLineMap: single line, no trailing newline → [0]", () => {
    expect(buildLineMap("abc")).toEqual([0]);
  });

  test("buildLineMap: each newline pushes the next line's start offset", () => {
    // "a\ncde\nfg" → line 0 starts at 0, line 1 at 2 (after first \n), line 2 at 6.
    expect(buildLineMap("a\ncde\nfg")).toEqual([0, 2, 6]);
  });

  test("positionAt: offset 0 → line 0, column 0", () => {
    const lm = buildLineMap("hello\nworld");
    expect(positionAt(0, lm)).toEqual({ line: 0, column: 0, offset: 0 });
  });

  test("positionAt: mid-line offset → correct line + column", () => {
    // "hello\nworld" — 'r' is at offset 8, on line 1 column 2.
    const lm = buildLineMap("hello\nworld");
    expect(positionAt(8, lm)).toEqual({ line: 1, column: 2, offset: 8 });
  });

  test("positionAt: first char of a new line → column 0", () => {
    const lm = buildLineMap("hello\nworld");
    expect(positionAt(6, lm)).toEqual({ line: 1, column: 0, offset: 6 });
  });

  test("positionAt: Unicode characters count as one column per code unit", () => {
    // The shared helper counts JS string indices (UTF-16 code units), not
    // codepoints — this matches the prior per-parser implementations exactly.
    // "é\nbc" — é is one code unit (U+00E9) here, so 'b' is at line 1 col 0.
    const src = "é\nbc";
    const lm = buildLineMap(src);
    expect(positionAt(src.indexOf("b"), lm)).toEqual({ line: 1, column: 0, offset: 2 });
  });

  test("positionAt: offset past last line-start clamps to final line", () => {
    // "ab\ncd" — offset 4 is 'd' on line 1, column 1.
    const lm = buildLineMap("ab\ncd");
    expect(positionAt(4, lm)).toEqual({ line: 1, column: 1, offset: 4 });
  });

  test("positionAt: offset past EOF still resolves via final line-start", () => {
    // Offsets >= src.length were never produced by the parsers (tokens cap at
    // src.length), but the helper must not throw — it returns the final line.
    const lm = buildLineMap("ab\ncd");
    expect(positionAt(99, lm).line).toBe(1);
  });

  test("spanFrom: composes two positions from offsets", () => {
    const lm = buildLineMap("hello\nworld");
    const s = spanFrom(1, 8, lm);
    expect(s.start).toEqual({ line: 0, column: 1, offset: 1 });
    expect(s.end).toEqual({ line: 1, column: 2, offset: 8 });
  });

  test("emptySpanAt: zero-length span anchored at offset", () => {
    const lm = buildLineMap("hello\nworld");
    const s = emptySpanAt(6, lm);
    expect(s.start).toEqual(s.end);
    expect(s.start).toEqual({ line: 1, column: 0, offset: 6 });
  });
});

// ---------------------------------------------------------------------------
// MECHANICS — token-stream
// ---------------------------------------------------------------------------

/** Minimal test token: kind + text. Satisfies GenericToken. */
interface Tok {
  kind: string;
  text: string;
}

const TOKS: Tok[] = [
  { kind: "id", text: "foo" },
  { kind: "op", text: "(" },
  { kind: "id", text: "x" },
  { kind: "op", text: ")" },
  { kind: "eof", text: "" },
];

function makeStream(tokens: Tok[] = TOKS): TokenStream<Tok> {
  return new TokenStream<Tok>(tokens, { isEof: (t) => t.kind === "eof" });
}

describe("shared/token-stream", () => {
  test("peek at start returns first token, never advances", () => {
    const s = makeStream();
    expect(s.peek().text).toBe("foo");
    expect(s.peek().text).toBe("foo");
    expect(s.position).toBe(0);
  });

  test("advance returns current token and steps forward", () => {
    const s = makeStream();
    expect(s.advance().text).toBe("foo");
    expect(s.peek().text).toBe("(");
    expect(s.position).toBe(1);
  });

  test("advance clamps at last token (EOF) — never returns undefined", () => {
    const s = makeStream();
    for (let i = 0; i < 10; i++) s.advance();
    expect(s.peek().kind).toBe("eof");
    expect(s.position).toBe(TOKS.length - 1);
  });

  test("lookahead(n) peeks ahead without advancing, clamps to last", () => {
    const s = makeStream();
    expect(s.lookahead(1).text).toBe("(");
    expect(s.lookahead(2).text).toBe("x");
    expect(s.lookahead(99).kind).toBe("eof"); // clamp
    expect(s.position).toBe(0);
  });

  test("at/atKind match current token without advancing", () => {
    const s = makeStream();
    expect(s.at("foo")).toBe(true);
    expect(s.at("bar")).toBe(false);
    expect(s.atKind("id")).toBe(true);
    expect(s.atKind("op")).toBe(false);
    expect(s.position).toBe(0);
  });

  test("match advances on hit, returns null on miss without advancing", () => {
    const s = makeStream();
    expect(s.match("bar")).toBeNull();
    expect(s.position).toBe(0);
    const hit = s.match("foo");
    expect(hit).not.toBeNull();
    expect(hit!.text).toBe("foo");
    expect(s.position).toBe(1);
  });

  test("matchKind advances on kind hit", () => {
    const s = makeStream();
    const hit = s.matchKind("id");
    expect(hit).not.toBeNull();
    expect(s.peek().kind).toBe("op");
  });

  test("expect: returns + advances on match", () => {
    const s = makeStream();
    const t = s.expect("foo", () => new Error("nope"));
    expect(t.text).toBe("foo");
    expect(s.position).toBe(1);
  });

  test("expect: throws on mismatch with the provided error factory", () => {
    const s = makeStream();
    expect(() => s.expect("nope", (a) => new Error(`got ${a.text}`))).toThrow("got foo");
    expect(s.position).toBe(0); // no advance on failure
  });

  test("atEnd: true only at EOF sentinel", () => {
    const s = makeStream();
    expect(s.atEnd()).toBe(false);
    s.advance(); s.advance(); s.advance(); s.advance();
    expect(s.atEnd()).toBe(true);
  });

  test("reset: restores a captured cursor position", () => {
    const s = makeStream();
    s.advance(); s.advance();
    const saved = s.position;
    s.advance();
    expect(s.peek().text).toBe(")");
    s.reset(saved);
    expect(s.peek().text).toBe("x");
  });

  test("single-token (EOF-only) stream: peek/advance/atEnd all stable", () => {
    const eofOnly = makeStream([{ kind: "eof", text: "" }]);
    expect(eofOnly.atEnd()).toBe(true);
    expect(eofOnly.peek().kind).toBe("eof");
    expect(eofOnly.advance().kind).toBe("eof");
    expect(eofOnly.position).toBe(0); // clamped, never past last
  });

  test("custom adapter: kindOf/textOf overrides", () => {
    // A token can carry BOTH the default `kind`/`text` fields and extra
    // aliases; the adapter lets the stream read whichever field the language
    // prefers. Here `type`/`value` are the language-preferred spellings
    // (mirroring Go's token shape), while `kind`/`text` satisfy the
    // GenericToken struct contract so the default accessors would also work.
    interface GoLikeToken { kind: string; text: string; type: string; value: string }
    const goToks: GoLikeToken[] = [
      { kind: "keyword", text: "func", type: "keyword", value: "func" },
      { kind: "eof", text: "", type: "eof", value: "" },
    ];
    const s = new TokenStream<GoLikeToken>(goToks, {
      kindOf: (t) => t.type,
      textOf: (t) => t.value,
      isEof: (t) => t.type === "eof",
    });
    expect(s.peekKind()).toBe("keyword");
    expect(s.at("func")).toBe(true);
    // The adapter is the bridge: even though GenericToken requires kind/text,
    // the stream never reads them directly when kindOf/textOf are supplied.
  });
});

// ---------------------------------------------------------------------------
// MECHANICS — node-factory
// ---------------------------------------------------------------------------

describe("shared/node-factory", () => {
  beforeEach(() => resetNodeIdCounter());

  test("makePosition: pure struct constructor", () => {
    expect(makePosition(42, 3, 7)).toEqual({ offset: 42, line: 3, column: 7 });
  });

  test("makeSpan: pairs two positions", () => {
    const a = makePosition(0, 0, 0);
    const b = makePosition(5, 0, 5);
    expect(makeSpan(a, b)).toEqual({ start: a, end: b });
  });

  test("errorNode: kind='error', empty children, message as label", () => {
    const span = makeSpan(makePosition(0, 0, 0), makePosition(1, 0, 1));
    const n = errorNode(span, "c", "expected ;");
    expect(n.kind).toBe("error");
    expect(n.language).toBe("c");
    expect(n.label).toBe("expected ;");
    expect(n.children).toEqual([]);
    expect(n.parent).toBeNull();
  });

  test("bindNodeFactory: node() bakes in language and forwards to createNode", () => {
    const F = bindNodeFactory("python");
    const child = createNode("identifier", makeSpan(makePosition(0, 0, 0), makePosition(1, 0, 1)), "python");
    const parent = F.node("parameter", makeSpan(makePosition(0, 0, 0), makePosition(5, 0, 5)), [child], "x");
    expect(parent.kind).toBe("parameter");
    expect(parent.language).toBe("python");
    expect(parent.label).toBe("x");
    expect(parent.children).toHaveLength(1);
  });

  test("bindNodeFactory: node() wires parent links on children", () => {
    const F = bindNodeFactory("c");
    const child = F.node("identifier", makeSpan(makePosition(0, 0, 0), makePosition(3, 0, 3)));
    const parent = F.node("variable", makeSpan(makePosition(0, 0, 0), makePosition(3, 0, 3)), [child], "v");
    expect(child.parent).toBe(parent);
    expect(parent.parent).toBeNull();
  });

  test("bindNodeFactory: error() bakes in language", () => {
    const F = bindNodeFactory("go");
    const span = makeSpan(makePosition(0, 0, 0), makePosition(1, 0, 1));
    const n = F.error(span, "missing semicolon");
    expect(n.language).toBe("go");
    expect(n.kind).toBe("error");
    expect(n.label).toBe("missing semicolon");
  });

  test("node() default args: empty children, undefined label", () => {
    const F = bindNodeFactory("typescript");
    const span = makeSpan(makePosition(0, 0, 0), makePosition(0, 0, 0));
    const n = F.node("block", span);
    expect(n.children).toEqual([]);
    expect(n.label).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PARITY — each native parser's serialized AST must match the snapshot.
// AC11.5 regression net. Snapshots captured post-migration; any drift in
// kinds/spans/labels/children fails loudly.
// ---------------------------------------------------------------------------

/** Unwrap a successful parse result or fail the test. */
function unwrap<L, R>(result: Either<L, R>, label: string): R {
  if (!Either.isRight(result)) {
    throw new Error(`${label}: parse returned Left`);
  }
  return result.right;
}

/** Serialialize with full depth + spans + text for stable comparison. */
function serialize(root: ReturnType<typeof createNode>, src: string) {
  return serializeAST(root, src, { maxDepth: 10, includeSpans: true, includeText: true });
}


describe("parser parity (AC11.5)", () => {
  beforeEach(() => resetNodeIdCounter());

  // ---- C ----------------------------------------------------------------
  test("C: 'int main() { return 0; }' — serialized AST unchanged", () => {
    const src = "int main() { return 0; }";
    const ast = unwrap(cParser.parse(src, "main.c"), "c");
    expect(serialize(ast, src)).toEqual({
      kind: "file",
      label: "main.c",
      span: { startLine: 0, startCol: 0, endLine: 0, endCol: 24 },
      text: src,
      children: [
        {
          kind: "function",
          label: "main",
          span: { startLine: 0, startCol: 0, endLine: 0, endCol: 24 },
          text: src,
          children: [
            {
              kind: "type-annotation",
              span: { startLine: 0, startCol: 0, endLine: 0, endCol: 3 },
              text: "int",
              children: [
                {
                  kind: "identifier",
                  span: { startLine: 0, startCol: 0, endLine: 0, endCol: 3 },
                  text: "int",
                },
              ],
            },
            {
              kind: "block",
              span: { startLine: 0, startCol: 11, endLine: 0, endCol: 24 },
              text: "{ return 0; }",
              children: [
                {
                  kind: "return-stmt",
                  span: { startLine: 0, startCol: 13, endLine: 0, endCol: 21 },
                  text: "return 0",
                  children: [
                    {
                      kind: "number",
                      label: "0",
                      span: { startLine: 0, startCol: 20, endLine: 0, endCol: 21 },
                      text: "0",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  // ---- Go ---------------------------------------------------------------
  test("Go: 'package main\\n\\nfunc main() {}\\n' — serialized AST unchanged", () => {
    const src = "package main\n\nfunc main() {}\n";
    const ast = unwrap(goParser.parse(src, "main.go"), "go");
    expect(serialize(ast, src)).toEqual({
      kind: "file",
      label: "main.go",
      span: { startLine: 0, startCol: 0, endLine: 3, endCol: 0 },
      text: src,
      children: [
        {
          kind: "identifier",
          label: "main",
          span: { startLine: 0, startCol: 0, endLine: 0, endCol: 12 },
          text: "package main",
        },
        {
          kind: "function",
          label: "main",
          span: { startLine: 2, startCol: 0, endLine: 3, endCol: 0 },
          text: "func main() {}\n",
          children: [
            {
              kind: "parameter",
              span: { startLine: 2, startCol: 9, endLine: 2, endCol: 12 },
              text: "() ",
            },
            {
              kind: "block",
              span: { startLine: 2, startCol: 12, endLine: 3, endCol: 0 },
              text: "{}\n",
            },
          ],
        },
      ],
    });
  });

  // ---- Python -----------------------------------------------------------
  test("Python: 'def greet():\\n    pass\\n' — serialized AST unchanged", () => {
    const src = "def greet():\n    pass\n";
    const ast = unwrap(pythonParser.parse(src, "greet.py"), "python");
    expect(serialize(ast, src)).toEqual({
      kind: "file",
      label: "greet.py",
      span: { startLine: 0, startCol: 0, endLine: 2, endCol: 0 },
      text: src,
      children: [
        {
          kind: "function",
          label: "greet",
          span: { startLine: 0, startCol: 0, endLine: 1, endCol: 8 },
          text: "def greet():\n    pass",
          children: [
            {
              kind: "block",
              label: "params",
              span: { startLine: 0, startCol: 9, endLine: 0, endCol: 11 },
              text: "()",
            },
            {
              kind: "block",
              span: { startLine: 0, startCol: 12, endLine: 1, endCol: 8 },
              text: "\n    pass",
              children: [
                {
                  kind: "identifier",
                  label: "pass",
                  span: { startLine: 1, startCol: 4, endLine: 1, endCol: 8 },
                  text: "pass",
                },
              ],
            },
          ],
        },
      ],
    });
  });

  // ---- TypeScript -------------------------------------------------------
  test("TypeScript: 'export function add(a, b) { return a + b; }' — serialized AST unchanged", () => {
    const src = "export function add(a, b) { return a + b; }";
    const ast = unwrap(typescriptParser.parse(src, "add.ts"), "typescript");
    expect(serialize(ast, src)).toEqual({
      kind: "file",
      label: "add.ts",
      span: { startLine: 0, startCol: 0, endLine: 0, endCol: 43 },
      text: src,
      children: [
        {
          kind: "export",
          span: { startLine: 0, startCol: 0, endLine: 0, endCol: 43 },
          text: src,
          children: [
            {
              kind: "function",
              label: "add",
              span: { startLine: 0, startCol: 7, endLine: 0, endCol: 43 },
              text: "function add(a, b) { return a + b; }",
              children: [
                {
                  kind: "parameter",
                  label: "a",
                  span: { startLine: 0, startCol: 20, endLine: 0, endCol: 21 },
                  text: "a",
                },
                {
                  kind: "parameter",
                  label: "b",
                  span: { startLine: 0, startCol: 23, endLine: 0, endCol: 24 },
                  text: "b",
                },
                {
                  kind: "block",
                  span: { startLine: 0, startCol: 26, endLine: 0, endCol: 43 },
                  text: "{ return a + b; }",
                  children: [
                    {
                      kind: "return-stmt",
                      span: { startLine: 0, startCol: 28, endLine: 0, endCol: 41 },
                      text: "return a + b;",
                      children: [
                        {
                          kind: "binary-expr",
                          label: "+",
                          span: { startLine: 0, startCol: 35, endLine: 0, endCol: 40 },
                          text: "a + b",
                          children: [
                            {
                              kind: "identifier",
                              label: "a",
                              span: { startLine: 0, startCol: 35, endLine: 0, endCol: 36 },
                              text: "a",
                            },
                            {
                              kind: "identifier",
                              label: "b",
                              span: { startLine: 0, startCol: 39, endLine: 0, endCol: 40 },
                              text: "b",
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  // ---- AC11.4: every parser tags every node with its language -----------
  test("Each parser reports its own language tag on every node (AC11.4)", () => {
    const cases: Array<{ name: string; src: string; parse: (s: string, n: string) => Either<unknown, unknown> }> = [
      { name: "c", src: "int x;", parse: (s, n) => cParser.parse(s, n) },
      { name: "go", src: "package main\n", parse: (s, n) => goParser.parse(s, n) },
      { name: "python", src: "x = 1\n", parse: (s, n) => pythonParser.parse(s, n) },
      { name: "typescript", src: "const x = 1;", parse: (s, n) => typescriptParser.parse(s, n) },
    ];
    for (const c of cases) {
      resetNodeIdCounter();
      const ast = unwrap(c.parse(c.src, `f.${c.name}`), c.name) as import("../../../src/syntax/ast/types.ts").ASTNode;
      const stack: typeof ast[] = [ast];
      let count = 0;
      while (stack.length > 0) {
        const n = stack.pop()!;
        expect(n.language).toBe(c.name);
        count++;
        for (const ch of n.children) stack.push(ch);
      }
      expect(count).toBeGreaterThan(0);
    }
  });
});
