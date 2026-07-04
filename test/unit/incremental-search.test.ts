/**
 * @file incremental-search.test.ts
 * @description Tests for incremental search primitives in search-ops API
 *
 * Note: search-ops.ts uses module-level state for isearch. Each test must
 * clean up by calling search-incremental-cancel or search-incremental-finish
 * to avoid state leakage between tests.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createSearchOps } from "../../src/editor/api/search-ops.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import { Either } from "../../src/utils/task-either.ts";
import { createString, createNil } from "../../src/tlisp/values.ts";
import { initialModel } from "../../src/editor/functional/model.ts";

describe("Incremental Search", () => {
  let buffer: FunctionalTextBufferImpl;
  let cursorLine: number;
  let cursorColumn: number;
  let statusMessage: string;
  let searchMatches: unknown[];
  let ops: ReturnType<typeof createSearchOps>;

  beforeEach(() => {
    // Buffer content:
    //   line 0: "hello world"
    //   line 1: "foo hello bar"
    //   line 2: "hello"
    buffer = FunctionalTextBufferImpl.create("hello world\nfoo hello bar\nhello");
    cursorLine = 0;
    cursorColumn = 0;
    statusMessage = "";
    searchMatches = [];

    ops = createSearchOps(
      {
        getModel: () => ({ ...initialModel(), currentBuffer: buffer, cursorPosition: { line: cursorLine, column: cursorColumn } }),
        applyModel: (m) => {
          if (m.currentBuffer) buffer = m.currentBuffer as FunctionalTextBufferImpl;
          cursorLine = m.cursorPosition.line;
          cursorColumn = m.cursorPosition.column;
        },
      },
      (l: number) => { cursorLine = l; },
      (c: number) => { cursorColumn = c; },
      (m: string) => { statusMessage = m; },
      (ranges: unknown[]) => { searchMatches = ranges; }
    );
  });

  afterEach(() => {
    // Reset module-level isearch state to prevent leakage between tests
    ops.get("search-incremental-cancel")!([]);
  });

  // ---------------------------------------------------------------------------
  // search-find-all-matches
  // ---------------------------------------------------------------------------
  describe("search-find-all-matches", () => {
    test("returns correct positions for all matches", () => {
      const fn = ops.get("search-find-all-matches")!;
      const result = fn([createString("hello")]);

      expect(Either.isRight(result)).toBe(true);
      const value = (result as { _tag: "Right"; right: unknown }).right as {
        type: string;
        value: unknown[];
      };
      expect(value.type).toBe("list");

      const matches = value.value as Array<{ type: string; value: unknown[] }>;
      // "hello" appears at: line 0 col 0, line 1 col 4, line 2 col 0
      expect(matches.length).toBe(3);

      const first = matches[0]!.value as Array<{ type: string; value: number }>;
      expect(first[0]!.value).toBe(0);
      expect(first[1]!.value).toBe(0);

      const second = matches[1]!.value as Array<{ type: string; value: number }>;
      expect(second[0]!.value).toBe(1);
      expect(second[1]!.value).toBe(4);

      const third = matches[2]!.value as Array<{ type: string; value: number }>;
      expect(third[0]!.value).toBe(2);
      expect(third[1]!.value).toBe(0);
    });

    test("returns empty list when pattern has no matches", () => {
      const fn = ops.get("search-find-all-matches")!;
      const result = fn([createString("xyz")]);

      expect(Either.isRight(result)).toBe(true);
      const value = (result as { _tag: "Right"; right: unknown }).right as {
        type: string;
        value: unknown[];
      };
      expect(value.value).toEqual([]);
    });

    test("returns empty list for empty pattern", () => {
      const fn = ops.get("search-find-all-matches")!;
      const result = fn([createString("")]);

      expect(Either.isRight(result)).toBe(true);
      const value = (result as { _tag: "Right"; right: unknown }).right as {
        type: string;
        value: unknown[];
      };
      expect(value.value).toEqual([]);
    });

    test("returns error when no buffer is available", () => {
      const noBufOps = createSearchOps(
        {
          getModel: () => ({ ...initialModel(), currentBuffer: undefined, cursorPosition: { line: cursorLine, column: cursorColumn } }),
          applyModel: () => { /* no-op for read-only no-buffer case */ },
        },
        (l: number) => { cursorLine = l; },
        (c: number) => { cursorColumn = c; },
        (m: string) => { statusMessage = m; },
        (ranges: unknown[]) => { searchMatches = ranges; }
      );
      const fn = noBufOps.get("search-find-all-matches")!;
      const result = fn([createString("hello")]);

      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for non-string argument", () => {
      const fn = ops.get("search-find-all-matches")!;
      const result = fn([{ type: "number", value: 42 }]);

      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // search-incremental-start
  // ---------------------------------------------------------------------------
  describe("search-incremental-start", () => {
    test("initializes isearch state and sets status message", () => {
      cursorLine = 1;
      cursorColumn = 5;

      const fn = ops.get("search-incremental-start")!;
      const result = fn([createString("forward")]);

      expect(Either.isRight(result)).toBe(true);
      expect(statusMessage).toContain("I-search:");
    });

    test("defaults to forward direction", () => {
      const fn = ops.get("search-incremental-start")!;
      fn([]);

      expect(statusMessage).toBe("I-search: ");
    });

    test("supports backward direction", () => {
      const fn = ops.get("search-incremental-start")!;
      fn([createString("backward")]);

      expect(statusMessage).toContain("backward");
    });

    test("clears search matches at start", () => {
      searchMatches = [{ some: "old" }];
      const fn = ops.get("search-incremental-start")!;
      fn([createString("forward")]);

      expect(searchMatches).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // search-incremental-update
  // ---------------------------------------------------------------------------
  describe("search-incremental-update", () => {
    test("moves cursor to match when pattern is found", () => {
      // findNextMatch searches from originColumn + 1. Starting at (0, 0),
      // it skips col 0 in line 0, finds "h" at line 1 col 4 ("foo hello bar")
      ops.get("search-incremental-start")!([createString("forward")]);

      const result = ops.get("search-incremental-update")!([createString("h")]);

      expect(Either.isRight(result)).toBe(true);
      expect(cursorLine).toBe(1);
      expect(cursorColumn).toBe(4);
      expect(statusMessage).toContain("h");
    });

    test("returns boolean true when match found", () => {
      ops.get("search-incremental-start")!([createString("forward")]);

      const result = ops.get("search-incremental-update")!([createString("h")]);
      expect(Either.isRight(result)).toBe(true);

      const value = (result as { _tag: "Right"; right: unknown }).right as {
        type: string;
        value: boolean;
      };
      expect(value.type).toBe("boolean");
      expect(value.value).toBe(true);
    });

    test("narrows match as pattern grows", () => {
      // Start at (0,0). "h" matches at (1,4). Adding "e" gives "he" --
      // still matches "hello" at (1,4) since "he" is a prefix of "hello"
      ops.get("search-incremental-start")!([createString("forward")]);

      ops.get("search-incremental-update")!([createString("h")]);
      expect(cursorLine).toBe(1);
      expect(cursorColumn).toBe(4);

      ops.get("search-incremental-update")!([createString("e")]);
      // Pattern is now "he" -- "hello" at line 1 col 4 starts with "he"
      expect(cursorLine).toBe(1);
      expect(cursorColumn).toBe(4);
    });

    test("reports failing search when pattern does not match", () => {
      ops.get("search-incremental-start")!([createString("forward")]);

      const result = ops.get("search-incremental-update")!([createString("z")]);
      expect(Either.isRight(result)).toBe(true);

      const value = (result as { _tag: "Right"; right: unknown }).right as {
        type: string;
        value: boolean;
      };
      expect(value.value).toBe(false);
      expect(statusMessage).toContain("Failing");
    });

    test("returns error when no active search", () => {
      // State was cleaned up by afterEach from previous test, but the
      // module-level isearchActive may still be true. Explicitly cancel first.
      ops.get("search-incremental-cancel")!([]);

      const result = ops.get("search-incremental-update")!([createString("h")]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("updates search matches with highlight ranges", () => {
      ops.get("search-incremental-start")!([createString("forward")]);
      ops.get("search-incremental-update")!([createString("hello")]);

      expect(searchMatches.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // search-incremental-backspace
  // ---------------------------------------------------------------------------
  describe("search-incremental-backspace", () => {
    test("removes last character from pattern", () => {
      ops.get("search-incremental-start")!([createString("forward")]);

      // Build pattern "he" then backspace to "h"
      ops.get("search-incremental-update")!([createString("h")]);
      ops.get("search-incremental-update")!([createString("e")]);
      expect(statusMessage).toContain("he");

      const result = ops.get("search-incremental-backspace")!([]);
      expect(Either.isRight(result)).toBe(true);
      expect(statusMessage).toContain("h");
      expect(statusMessage).not.toContain("he");
    });

    test("returns to origin when pattern becomes empty", () => {
      cursorLine = 1;
      cursorColumn = 5;

      ops.get("search-incremental-start")!([createString("forward")]);
      ops.get("search-incremental-update")!([createString("h")]);

      // Backspace removes the only char -- pattern is empty, restores origin
      ops.get("search-incremental-backspace")!([]);
      expect(cursorLine).toBe(1);
      expect(cursorColumn).toBe(5);
    });

    test("returns empty string when pattern is already empty", () => {
      ops.get("search-incremental-start")!([createString("forward")]);

      const result = ops.get("search-incremental-backspace")!([]);
      expect(Either.isRight(result)).toBe(true);
      const value = (result as { _tag: "Right"; right: unknown }).right as {
        type: string;
        value: string;
      };
      expect(value.value).toBe("");
    });

    test("returns error when no active search", () => {
      ops.get("search-incremental-cancel")!([]);

      const result = ops.get("search-incremental-backspace")!([]);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // search-incremental-cancel
  // ---------------------------------------------------------------------------
  describe("search-incremental-cancel", () => {
    test("restores original cursor position", () => {
      cursorLine = 1;
      cursorColumn = 5;

      ops.get("search-incremental-start")!([createString("forward")]);
      ops.get("search-incremental-update")!([createString("h")]);

      // Cursor moved away from origin
      expect(cursorLine).not.toBe(1);

      // Cancel should restore to line 1, col 5
      const result = ops.get("search-incremental-cancel")!([]);
      expect(Either.isRight(result)).toBe(true);
      expect(cursorLine).toBe(1);
      expect(cursorColumn).toBe(5);
    });

    test("sets status message to Quit", () => {
      ops.get("search-incremental-start")!([createString("forward")]);

      ops.get("search-incremental-cancel")!([]);
      expect(statusMessage).toBe("Quit");
    });

    test("clears search matches on cancel", () => {
      ops.get("search-incremental-start")!([createString("forward")]);
      ops.get("search-incremental-update")!([createString("hello")]);

      ops.get("search-incremental-cancel")!([]);
      expect(searchMatches).toEqual([]);
    });

    test("is safe to call when no search is active", () => {
      // Double-cancel: once from this test, afterEach will cancel again
      ops.get("search-incremental-cancel")!([]);
      const result = ops.get("search-incremental-cancel")!([]);
      expect(Either.isRight(result)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // search-incremental-finish
  // ---------------------------------------------------------------------------
  describe("search-incremental-finish", () => {
    test("preserves final cursor position", () => {
      ops.get("search-incremental-start")!([createString("forward")]);
      ops.get("search-incremental-update")!([createString("hello")]);

      const finishLine = cursorLine;
      const finishCol = cursorColumn;

      const result = ops.get("search-incremental-finish")!([]);
      expect(Either.isRight(result)).toBe(true);
      expect(cursorLine).toBe(finishLine);
      expect(cursorColumn).toBe(finishCol);
    });

    test("sets status message to found pattern", () => {
      ops.get("search-incremental-start")!([createString("forward")]);
      ops.get("search-incremental-update")!([createString("hello")]);

      ops.get("search-incremental-finish")!([]);
      expect(statusMessage).toContain("hello");
    });

    test("clears search matches on finish", () => {
      ops.get("search-incremental-start")!([createString("forward")]);
      ops.get("search-incremental-update")!([createString("hello")]);

      ops.get("search-incremental-finish")!([]);
      expect(searchMatches).toEqual([]);
    });

    test("is safe to call when no search is active", () => {
      // cancel first to ensure no active search
      ops.get("search-incremental-cancel")!([]);
      const result = ops.get("search-incremental-finish")!([]);
      expect(Either.isRight(result)).toBe(true);
    });

    test("preserves last search pattern for search-pattern-get", () => {
      ops.get("search-incremental-start")!([createString("forward")]);
      ops.get("search-incremental-update")!([createString("hello")]);
      ops.get("search-incremental-finish")!([]);

      const patternResult = ops.get("search-pattern-get")!([]);
      expect(Either.isRight(patternResult)).toBe(true);
      const pattern = (patternResult as { _tag: "Right"; right: unknown }).right as {
        type: string;
        value: string;
      };
      expect(pattern.value).toBe("hello");
    });
  });

  // ---------------------------------------------------------------------------
  // Full isearch workflow
  // ---------------------------------------------------------------------------
  describe("full isearch workflow", () => {
    test("start -> update -> update -> backspace -> finish", () => {
      cursorLine = 0;
      cursorColumn = 0;

      // Start search
      ops.get("search-incremental-start")!([createString("forward")]);

      // Type "he"
      ops.get("search-incremental-update")!([createString("h")]);
      ops.get("search-incremental-update")!([createString("e")]);

      // Backspace once -- pattern back to "h"
      ops.get("search-incremental-backspace")!([]);

      // Type "ello" to complete "hello"
      ops.get("search-incremental-update")!([createString("e")]);
      ops.get("search-incremental-update")!([createString("l")]);
      ops.get("search-incremental-update")!([createString("l")]);
      ops.get("search-incremental-update")!([createString("o")]);

      // Finish -- cursor should be on a "hello" match
      const result = ops.get("search-incremental-finish")!([]);
      expect(Either.isRight(result)).toBe(true);
      // From origin (0,0), findNextMatch skips to (1,4) for "h" initially,
      // but after building "hello", the search finds it wherever the
      // incremental pattern settled.
      expect(cursorColumn).toBe(4); // col 4 in line 1 where "hello" starts
      expect(statusMessage).toContain("hello");
    });

    test("start -> update -> cancel restores original position", () => {
      cursorLine = 2;
      cursorColumn = 3;

      ops.get("search-incremental-start")!([createString("forward")]);
      ops.get("search-incremental-update")!([createString("hello")]);

      // Cancel
      ops.get("search-incremental-cancel")!([]);
      expect(cursorLine).toBe(2);
      expect(cursorColumn).toBe(3);
    });
  });
});
