/**
 * @file buffer-perf-invariants.test.ts
 * @description Correctness guards for the CHORE-34 incremental-derivation
 *   layer in `TextBufferImpl` (RFC-019 §1.1–1.3). These tests do not
 *   measure performance — they assert the invariants the incremental layer
 *   must uphold so that the perf-critical `insert`/`delete` paths produce
 *   results identical to the source-of-truth `TextBufferImpl.create`.
 */

import { describe, test, expect } from "bun:test";
import { TextBufferImpl } from "../../src/core/buffer.ts";
import type { TextBuffer, Position, Range } from "../../src/core/types.ts";
import { Either } from "../../src/utils/task-either.ts";

/** Unwrap an Either.right or throw with the left payload. */
function unwrap<T>(result: { _tag: "Left" | "Right"; right?: T; left?: unknown }): T {
  if (result._tag === "Left") {
    throw new Error(`Either was Left: ${JSON.stringify(result.left)}`);
  }
  return result.right as T;
}

/**
 * Test-only typed accessor for the private `positionToOffset`. Used only to
 * validate the §1.2 cache against an independent reference computation; the
 * cast never escapes this file and the method signature is part of the
 * stable internal contract documented in the chore spec.
 */
type PositionToOffset = (position: Position) => { _tag: "Left" | "Right"; right?: number; left?: unknown };
function positionToOffset(buffer: TextBuffer, position: Position): number {
  return unwrap((buffer as unknown as { positionToOffset: PositionToOffset }).positionToOffset(position));
}

/** Reference offset computation — independent of the buffer's internal cache. */
function referenceOffset(lines: readonly string[], line: number, column: number): number {
  let offset = 0;
  for (let i = 0; i < line; i++) offset += lines[i]!.length + 1;
  offset += Math.min(column, lines[line]!.length);
  return offset;
}

/** Pull every observable public field of a buffer into a JSON-comparable snapshot. */
function snapshot(buffer: TextBuffer): {
  content: string;
  lineCount: number;
  lines: string[];
  stats: { lines: number; characters: number; words: number };
} {
  return {
    content: unwrap(buffer.getContent()),
    lineCount: unwrap(buffer.getLineCount()),
    lines: Array.from({ length: unwrap(buffer.getLineCount()) }, (_, i) => unwrap(buffer.getLine(i))),
    stats: unwrap(buffer.getStats()),
  };
}

describe("TextBuffer incremental-derivation invariants (CHORE-34)", () => {
  describe("equivalence with create(content) — single edits", () => {
    type Case = { name: string; initial: string; op: (b: TextBuffer) => TextBuffer };
    const cases: Case[] = [
      {
        name: "insert no-newline at EOF",
        initial: "hello",
        op: (b) => unwrap(b.insert({ line: 0, column: 5 }, " world")) as TextBuffer,
      },
      {
        name: "insert no-newline in middle",
        initial: "hello world",
        op: (b) => unwrap(b.insert({ line: 0, column: 5 }, "X")) as TextBuffer,
      },
      {
        name: "insert one newline mid-line",
        initial: "hello world",
        op: (b) => unwrap(b.insert({ line: 0, column: 5 }, "\n")) as TextBuffer,
      },
      {
        name: "insert multi-line text mid-line",
        initial: "abcXYZdef",
        op: (b) => unwrap(b.insert({ line: 0, column: 3 }, "1\n2\n3")) as TextBuffer,
      },
      {
        name: "insert text with leading and trailing newlines",
        initial: "middle",
        op: (b) => unwrap(b.insert({ line: 0, column: 0 }, "before\n")) as TextBuffer,
      },
      {
        name: "insert into empty buffer",
        initial: "",
        op: (b) => unwrap(b.insert({ line: 0, column: 0 }, "first")) as TextBuffer,
      },
      {
        name: "insert newline into empty buffer",
        initial: "",
        op: (b) => unwrap(b.insert({ line: 0, column: 0 }, "\n")) as TextBuffer,
      },
      {
        name: "insert at start of multi-line buffer",
        initial: "alpha\nbeta\ngamma",
        op: (b) => unwrap(b.insert({ line: 0, column: 0 }, "Z")) as TextBuffer,
      },
      {
        name: "insert column past end of line clamps",
        initial: "hello",
        op: (b) => unwrap(b.insert({ line: 0, column: 99 }, "!")) as TextBuffer,
      },
      {
        name: "delete single char on same line",
        initial: "hello world",
        op: (b) =>
          unwrap(
            b.delete({ start: { line: 0, column: 5 }, end: { line: 0, column: 6 } })
          ) as TextBuffer,
      },
      {
        name: "delete within single line",
        initial: "hello world",
        op: (b) =>
          unwrap(
            b.delete({ start: { line: 0, column: 0 }, end: { line: 0, column: 5 } })
          ) as TextBuffer,
      },
      {
        name: "delete across two lines collapses them",
        initial: "hello\nworld",
        op: (b) =>
          unwrap(
            b.delete({ start: { line: 0, column: 3 }, end: { line: 1, column: 2 } })
          ) as TextBuffer,
      },
      {
        name: "delete across three lines collapses them",
        initial: "aaa\nbbb\nccc",
        op: (b) =>
          unwrap(
            b.delete({ start: { line: 0, column: 1 }, end: { line: 2, column: 2 } })
          ) as TextBuffer,
      },
      {
        name: "delete to end of single line",
        initial: "hello world",
        op: (b) =>
          unwrap(
            b.delete({ start: { line: 0, column: 5 }, end: { line: 0, column: 11 } })
          ) as TextBuffer,
      },
      {
        name: "delete through trailing newline",
        initial: "hello\nworld",
        op: (b) =>
          unwrap(
            b.delete({ start: { line: 0, column: 5 }, end: { line: 1, column: 0 } })
          ) as TextBuffer,
      },
      {
        name: "zero-length delete is a no-op",
        initial: "hello world",
        op: (b) =>
          unwrap(
            b.delete({ start: { line: 0, column: 3 }, end: { line: 0, column: 3 } })
          ) as TextBuffer,
      },
      {
        name: "empty insert is a no-op",
        initial: "hello world",
        op: (b) => unwrap(b.insert({ line: 0, column: 5 }, "")) as TextBuffer,
      },
    ];

    for (const c of cases) {
      test(c.name, () => {
        const initial = TextBufferImpl.create(c.initial);
        const edited = c.op(initial);
        // Reconstruct from the resulting content via `create` — the source of truth.
        const rebuilt = TextBufferImpl.create(unwrap(edited.getContent()));
        expect(snapshot(edited)).toEqual(snapshot(rebuilt));
      });
    }
  });

  describe("prefix-sum behavior (§1.2)", () => {
    test("positionToOffset matches independent reference for every (L, C)", () => {
      const text = "alpha\nbeta\nlonger line here\ngamma\ndelta";
      const buffer = TextBufferImpl.create(text);
      const lines = text.split("\n");
      for (let line = 0; line < lines.length; line++) {
        for (let column = 0; column <= lines[line]!.length; column++) {
          const expected = referenceOffset(lines, line, column);
          const actual = positionToOffset(buffer, { line, column });
          expect(actual).toBe(expected);
        }
      }
    });

    test("columns past end-of-line clamp to line length", () => {
      const text = "alpha\nbeta\ngamma";
      const buffer = TextBufferImpl.create(text);
      const lines = text.split("\n");
      for (let line = 0; line < lines.length; line++) {
        const clamped = referenceOffset(lines, line, lines[line]!.length);
        // Columns far past the end must resolve to the same offset as the line end.
        expect(positionToOffset(buffer, { line, column: lines[line]!.length + 5 })).toBe(clamped);
        expect(positionToOffset(buffer, { line, column: lines[line]!.length })).toBe(clamped);
      }
    });

    test("offsets stay correct after a series of edits", () => {
      let buffer: TextBuffer = TextBufferImpl.create("a\nb\nc");
      buffer = unwrap(buffer.insert({ line: 1, column: 1 }, "XYZ"));
      buffer = unwrap(buffer.insert({ line: 0, column: 0 }, "HEADER\n"));
      buffer = unwrap(
        buffer.delete({ start: { line: 2, column: 0 }, end: { line: 3, column: 1 } })
      );
      // Re-derive the live lines from content (the source of truth) and check
      // every position resolves to the reference offset.
      const lines = unwrap(buffer.getContent()).split("\n");
      for (let line = 0; line < lines.length; line++) {
        for (let column = 0; column <= lines[line]!.length; column++) {
          expect(positionToOffset(buffer, { line, column })).toBe(referenceOffset(lines, line, column));
        }
      }
    });
  });

  describe("round-trip invariant (insert then delete = original)", () => {
    type Case = { name: string; initial: string; position: Position; text: string };
    const cases: Case[] = [
      { name: "single-line mid insert", initial: "hello world", position: { line: 0, column: 5 }, text: "X" },
      { name: "single-line at EOF", initial: "abc", position: { line: 0, column: 3 }, text: "def" },
      { name: "insert with one newline", initial: "abcdef", position: { line: 0, column: 3 }, text: "X\nY" },
      { name: "insert with two newlines", initial: "abcdef", position: { line: 0, column: 3 }, text: "X\nY\nZ" },
      {
        name: "insert into multi-line at start of line",
        initial: "alpha\nbeta\ngamma",
        position: { line: 1, column: 0 },
        text: "NEW\n",
      },
      {
        name: "insert into empty buffer",
        initial: "",
        position: { line: 0, column: 0 },
        text: "fresh content",
      },
    ];

    for (const c of cases) {
      test(c.name, () => {
        const original = TextBufferImpl.create(c.initial);
        const inserted = unwrap(original.insert(c.position, c.text));
        // Compute the delete range that exactly spans the inserted text.
        // The inserted text occupies [c.position, endPos) where endPos is
        // derived by counting newlines in c.text and walking forward.
        const segments = c.text.split("\n");
        const startLine = c.position.line;
        const startColumn = Math.min(c.position.column, unwrap(original.getLine(startLine)).length);
        const endLine = startLine + segments.length - 1;
        const endColumn =
          segments.length === 1
            ? startColumn + segments[0]!.length
            : segments[segments.length - 1]!.length;
        const range: Range = { start: { line: startLine, column: startColumn }, end: { line: endLine, column: endColumn } };
        const roundTripped = unwrap(inserted.delete(range));
        expect(unwrap(roundTripped.getContent())).toBe(c.initial);
      });
    }
  });

  describe("1000-random-edits stress test", () => {
    // Deterministic LCG (no Math.random) so the test is reproducible.
    function lcg(seed: number): () => number {
      let state = seed >>> 0;
      return () => {
        // Constants from Numerical Recipes LCG.
        state = (1664525 * state + 1013904223) >>> 0;
        return state / 0x100000000;
      };
    }

    test("every step stays equivalent to create(content)", () => {
      const initial = Array.from({ length: 50 }, (_, i) => `line ${i} has some text`).join("\n");
      let incremental: TextBuffer = TextBufferImpl.create(initial);
      const rng = lcg(0xC0FFEE);

      for (let i = 0; i < 1000; i++) {
        const lineCount = unwrap(incremental.getLineCount());
        const line = Math.floor(rng() * lineCount);
        const lineText = unwrap(incremental.getLine(line));
        const column = Math.floor(rng() * (lineText.length + 1));
        if (rng() < 0.5) {
          // Insert. Mix single-char and multi-line inserts.
          const text = rng() < 0.7 ? "X" : rng() < 0.5 ? "foo\nbar" : " ";
          incremental = unwrap(incremental.insert({ line, column }, text));
        } else {
          // Delete a 1-3 char range starting at (line, column).
          const len = 1 + Math.floor(rng() * 3);
          const endCol = Math.min(column + len, lineText.length);
          if (column < endCol) {
            incremental = unwrap(
              incremental.delete({ start: { line, column }, end: { line, column: endCol } })
            );
          }
        }
        // The source of truth: rebuild from content and compare snapshots.
        const rebuilt = TextBufferImpl.create(unwrap(incremental.getContent()));
        expect(snapshot(incremental)).toEqual(snapshot(rebuilt));
      }
    });
  });
});
