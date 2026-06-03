import { describe, test, expect, beforeEach } from "bun:test";
import { createIndentOps } from "../../src/editor/api/indent-ops.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import { createString, createNumber, createList, createNil } from "../../src/tlisp/values.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("Auto Indent", () => {
  let buffer: FunctionalTextBufferImpl;
  let cursorLine: number;

  beforeEach(() => {
    buffer = FunctionalTextBufferImpl.create("function foo() {\n  return 1;\n}\n\nconst x = 2;");
    cursorLine = 0;
  });

  function getOps() {
    return createIndentOps(
      () => buffer,
      (b) => { buffer = b as FunctionalTextBufferImpl; },
      () => cursorLine,
      (l) => { cursorLine = l; },
      () => 4 // tabSize
    );
  }

  // --- indent-calculate-column ---

  describe("indent-calculate-column", () => {
    test("returns 0 for the first line with no previous context", () => {
      const ops = getOps();
      const fn = ops.get("indent-calculate-column")!;
      // Line 0: "function foo() {"
      const result = fn([createNumber(0), createList([]), createList([])]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.value).toBe(0);
    });

    test("indents after a line ending with opening brace", () => {
      const ops = getOps();
      const fn = ops.get("indent-calculate-column")!;
      // Line 0: "function foo() {" ends with {
      // Line 1: "  return 1;" - previous line matches increase pattern, expect indent from prev + tabSize
      // Line 1 currently has indent 2, prev line has indent 0, prev matches "\\{$"
      const result = fn([
        createNumber(1),
        createList([createString("\\{$")]),
        createList([])
      ]);
      expect(Either.isRight(result)).toBe(true);
      // Previous line (0) has indent 0, matches "\{$" -> add 4 => column = 4
      expect((result as any).right.value).toBe(4);
    });

    test("outdents a line starting with closing brace", () => {
      const ops = getOps();
      const fn = ops.get("indent-calculate-column")!;
      // Line 2: "}" starts with }
      // Previous non-blank line is line 1: "  return 1;" with indent 2
      // Decrease pattern "^\\s*}" matches current line -> subtract tabSize
      const result = fn([
        createNumber(2),
        createList([]),
        createList([createString("^\\s*}")])
      ]);
      expect(Either.isRight(result)).toBe(true);
      // Prev indent = 2, no increase patterns, current matches decrease -> 2 - 4 = -2, clamped to 0
      expect((result as any).right.value).toBe(0);
    });

    test("handles empty line between indented lines", () => {
      const ops = getOps();
      const fn = ops.get("indent-calculate-column")!;
      // Line 3 is empty ""
      // Previous non-blank line is line 2: "}" with indent 0
      const result = fn([
        createNumber(3),
        createList([]),
        createList([])
      ]);
      expect(Either.isRight(result)).toBe(true);
      // Prev non-blank is line 2 with indent 0, no patterns -> column = 0
      expect((result as any).right.value).toBe(0);
    });

    test("returns error for out-of-bounds line number", () => {
      const ops = getOps();
      const fn = ops.get("indent-calculate-column")!;
      const result = fn([createNumber(99), createList([]), createList([])]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for wrong argument count", () => {
      const ops = getOps();
      const fn = ops.get("indent-calculate-column")!;
      const result = fn([createNumber(0)]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for wrong argument type", () => {
      const ops = getOps();
      const fn = ops.get("indent-calculate-column")!;
      const result = fn([createString("not-a-number"), createList([]), createList([])]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for non-list pattern arguments", () => {
      const ops = getOps();
      const fn = ops.get("indent-calculate-column")!;
      const result = fn([createNumber(0), createString("not-a-list"), createList([])]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for non-string items in pattern list", () => {
      const ops = getOps();
      const fn = ops.get("indent-calculate-column")!;
      const result = fn([createNumber(0), createList([createNumber(1)]), createList([])]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for invalid regex pattern", () => {
      const ops = getOps();
      const fn = ops.get("indent-calculate-column")!;
      // Line 1: "  return 1;" -- prev line 0 "function foo() {" would trigger the bad regex
      const result = fn([
        createNumber(1),
        createList([createString("[invalid")]),
        createList([])
      ]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("combines increase and decrease patterns correctly", () => {
      // Create a buffer with nested braces for a realistic test
      const nestedBuffer = FunctionalTextBufferImpl.create("{\n  {\n    x\n  }\n}");
      buffer = nestedBuffer;

      const ops = getOps();
      const fn = ops.get("indent-calculate-column")!;
      // Line 1: "  {" -- prev line 0 "{" with indent 0, matches "\{$" -> +4 => 4
      const result1 = fn([
        createNumber(1),
        createList([createString("\\{$")]),
        createList([createString("^\\s*}")])
      ]);
      expect(Either.isRight(result1)).toBe(true);
      expect((result1 as any).right.value).toBe(4);

      // Line 2: "    x" -- prev line 1 "  {" with indent 2, matches "\{$" -> 2+4=6
      const result2 = fn([
        createNumber(2),
        createList([createString("\\{$")]),
        createList([createString("^\\s*}")])
      ]);
      expect(Either.isRight(result2)).toBe(true);
      expect((result2 as any).right.value).toBe(6);

      // Line 3: "  }" -- prev line 2 "    x" indent 4, no increase. Current matches "^\\s*}" -> 4-4=0
      const result3 = fn([
        createNumber(3),
        createList([createString("\\{$")]),
        createList([createString("^\\s*}")])
      ]);
      expect(Either.isRight(result3)).toBe(true);
      expect((result3 as any).right.value).toBe(0);
    });
  });

  // --- indent-set-rules ---

  describe("indent-set-rules", () => {
    test("stores rules for the current buffer and returns nil", () => {
      const ops = getOps();
      const fn = ops.get("indent-set-rules")!;
      const result = fn([
        createList([createString("\\{$")]),
        createList([createString("^\\s*}")])
      ]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.type).toBe("nil");
    });

    test("returns error for wrong argument count", () => {
      const ops = getOps();
      const fn = ops.get("indent-set-rules")!;
      const result = fn([createList([])]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for non-list arguments", () => {
      const ops = getOps();
      const fn = ops.get("indent-set-rules")!;
      const result = fn([createString("not-a-list"), createList([])]);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // --- indent-get-rules ---

  describe("indent-get-rules", () => {
    test("returns nil when no rules are set", () => {
      const ops = getOps();
      const fn = ops.get("indent-get-rules")!;
      const result = fn([]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.type).toBe("nil");
    });

    test("returns stored rules as list of two lists", () => {
      const ops = getOps();

      // Set rules first
      const setFn = ops.get("indent-set-rules")!;
      setFn([
        createList([createString("\\{$")]),
        createList([createString("^\\s*}")])
      ]);

      // Get rules
      const getFn = ops.get("indent-get-rules")!;
      const result = getFn([]);
      expect(Either.isRight(result)).toBe(true);
      // Should be a list of two lists: [increase-list, decrease-list]
      const outerList = (result as any).right;
      expect(outerList.type).toBe("list");
      expect(outerList.value.length).toBe(2);
      expect(outerList.value[0].type).toBe("list");
      expect(outerList.value[1].type).toBe("list");
    });
  });

  // --- indent-apply-line ---

  describe("indent-apply-line", () => {
    test("calculates indent for a line using stored rules", () => {
      const ops = getOps();

      // Set rules first
      const setFn = ops.get("indent-set-rules")!;
      setFn([
        createList([createString("\\{$")]),
        createList([createString("^\\s*}")])
      ]);

      // Apply to line 1 ("  return 1;") -- prev line 0 matches increase pattern
      const applyFn = ops.get("indent-apply-line")!;
      const result = applyFn([createNumber(1)]);
      expect(Either.isRight(result)).toBe(true);
      // Prev indent 0, matches "\{$" -> +4 => 4
      expect((result as any).right.value).toBe(4);
    });

    test("applies decrease rule for closing brace line", () => {
      const ops = getOps();

      // Set rules
      const setFn = ops.get("indent-set-rules")!;
      setFn([
        createList([createString("\\{$")]),
        createList([createString("^\\s*}")])
      ]);

      // Apply to line 2 ("}") -- prev line 1 "  return 1;" indent 2, current matches decrease
      const applyFn = ops.get("indent-apply-line")!;
      const result = applyFn([createNumber(2)]);
      expect(Either.isRight(result)).toBe(true);
      // Prev indent 2, no increase, current matches "^\\s*}" -> 2-4=-2 clamped to 0
      expect((result as any).right.value).toBe(0);
    });

    test("returns error when no rules are set for the buffer", () => {
      const ops = getOps();
      const applyFn = ops.get("indent-apply-line")!;
      const result = applyFn([createNumber(0)]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for wrong argument count", () => {
      const ops = getOps();
      const applyFn = ops.get("indent-apply-line")!;
      const result = applyFn([]);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // --- indent-apply-region ---

  describe("indent-apply-region", () => {
    test("returns nil after processing a region with stored rules", () => {
      const ops = getOps();

      // Set rules
      const setFn = ops.get("indent-set-rules")!;
      setFn([
        createList([createString("\\{$")]),
        createList([createString("^\\s*}")])
      ]);

      const regionFn = ops.get("indent-apply-region")!;
      const result = regionFn([createNumber(0), createNumber(4)]);
      expect(Either.isRight(result)).toBe(true);
      expect((result as any).right.type).toBe("nil");
    });

    test("returns error when no rules are set", () => {
      const ops = getOps();
      const regionFn = ops.get("indent-apply-region")!;
      const result = regionFn([createNumber(0), createNumber(2)]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for wrong argument count", () => {
      const ops = getOps();
      const regionFn = ops.get("indent-apply-region")!;
      const result = regionFn([createNumber(0)]);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // --- WeakMap key behavior ---

  describe("WeakMap key behavior with buffer references", () => {
    test("rules persist across setCurrentBuffer calls as long as original reference lives", () => {
      const originalBuffer = buffer;
      const ops = getOps();

      // Set rules on original buffer
      const setFn = ops.get("indent-set-rules")!;
      setFn([
        createList([createString("\\{$")]),
        createList([createString("^\\s*}")])
      ]);

      // Swap to a different buffer
      const otherBuffer = FunctionalTextBufferImpl.create("// other");
      buffer = otherBuffer;

      // Swap back to original
      buffer = originalBuffer;

      // Rules should still be accessible since originalBuffer reference still exists
      const getFn = ops.get("indent-get-rules")!;
      const result = getFn([]);
      expect(Either.isRight(result)).toBe(true);
      // Should still return the rules (not nil)
      expect((result as any).right.type).toBe("list");
    });

    test("new buffer has no rules even after another buffer had rules", () => {
      const ops = getOps();

      // Set rules on current buffer
      const setFn = ops.get("indent-set-rules")!;
      setFn([
        createList([createString("\\{$")]),
        createList([createString("^\\s*}")])
      ]);

      // Switch to a brand new buffer
      buffer = FunctionalTextBufferImpl.create("// new file");

      // New buffer should have no rules
      const applyFn = ops.get("indent-apply-line")!;
      const result = applyFn([createNumber(0)]);
      expect(Either.isLeft(result)).toBe(true);
    });
  });
});
