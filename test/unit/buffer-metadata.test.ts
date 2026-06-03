/**
 * @file buffer-metadata.test.ts
 * @description Tests for buffer metadata functions (SPEC-035 Phase 0a)
 */

import { describe, test, expect } from "bun:test";
import { createBufferOps } from "../../src/editor/api/buffer-ops.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import { Either } from "../../src/utils/task-either.ts";
import { createString, createNumber, createBoolean } from "../../src/tlisp/values.ts";

describe("Buffer Metadata Operations", () => {
  // Shared mutable state simulating editor state
  const buffers = new Map();
  let currentBuffer: FunctionalTextBufferImpl | null = null;
  let currentFilename: string | undefined;
  let bufferModified: boolean;

  function setupBuffer(content: string) {
    buffers.clear();
    currentBuffer = FunctionalTextBufferImpl.create(content);
    buffers.set("test", currentBuffer);
    currentFilename = undefined;
    bufferModified = false;
  }

  function getOps() {
    return createBufferOps(
      buffers,
      () => currentBuffer,
      (buf) => { currentBuffer = buf as FunctionalTextBufferImpl; },
      () => 0,
      (_l) => {},
      () => 0,
      (_c) => {},
      () => currentFilename,
      (f) => { currentFilename = f; },
      () => bufferModified,
      (flag) => { bufferModified = flag; }
    );
  }

  // Helper: call an API function and return the Right value
  function call(name: string, args: any[] = []) {
    const ops = getOps();
    const fn = ops.get(name);
    if (!fn) throw new Error(`Function ${name} not found`);
    const result = fn(args);
    if (Either.isLeft(result)) throw new Error(`Function ${name} returned Left: ${JSON.stringify(result.left)}`);
    return result.right;
  }

  // Helper: call an API function and return the raw Either
  function callEither(name: string, args: any[] = []) {
    const ops = getOps();
    const fn = ops.get(name);
    if (!fn) throw new Error(`Function ${name} not found`);
    return fn(args);
  }

  // --- buffer-filename ---

  describe("buffer-filename", () => {
    test("returns nil when no filename has been set", () => {
      setupBuffer("hello");
      const result = call("buffer-filename");
      expect(result.type).toBe("nil");
    });

    test("returns the filename after set-buffer-filename", () => {
      setupBuffer("hello");
      call("set-buffer-filename", [createString("/tmp/test.txt")]);
      const result = call("buffer-filename");
      expect(result.type).toBe("string");
      expect(result.value).toBe("/tmp/test.txt");
    });
  });

  // --- set-buffer-filename ---

  describe("set-buffer-filename", () => {
    test("sets the filename and returns it", () => {
      setupBuffer("hello");
      const result = call("set-buffer-filename", [createString("/path/to/file.ts")]);
      expect(result.type).toBe("string");
      expect(result.value).toBe("/path/to/file.ts");
      expect(currentFilename).toBe("/path/to/file.ts");
    });

    test("rejects non-string argument", () => {
      setupBuffer("hello");
      const result = callEither("set-buffer-filename", [createNumber(42)]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("rejects wrong argument count", () => {
      setupBuffer("hello");
      const result = callEither("set-buffer-filename", []);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // --- buffer-modified-p ---

  describe("buffer-modified-p", () => {
    test("returns false initially", () => {
      setupBuffer("hello");
      const result = call("buffer-modified-p");
      expect(result.type).toBe("boolean");
      expect(result.value).toBe(false);
    });

    test("returns true after set-buffer-modified-p is called with true", () => {
      setupBuffer("hello");
      call("set-buffer-modified-p", [createBoolean(true)]);
      const result = call("buffer-modified-p");
      expect(result.type).toBe("boolean");
      expect(result.value).toBe(true);
    });

    test("returns false after set-buffer-modified-p is called with false", () => {
      setupBuffer("hello");
      call("set-buffer-modified-p", [createBoolean(true)]);
      call("set-buffer-modified-p", [createBoolean(false)]);
      const result = call("buffer-modified-p");
      expect(result.type).toBe("boolean");
      expect(result.value).toBe(false);
    });
  });

  // --- set-buffer-modified-p ---

  describe("set-buffer-modified-p", () => {
    test("sets modified flag to true and returns nil", () => {
      setupBuffer("hello");
      const result = call("set-buffer-modified-p", [createBoolean(true)]);
      expect(result.type).toBe("nil");
      expect(bufferModified).toBe(true);
    });

    test("sets modified flag to false", () => {
      setupBuffer("hello");
      bufferModified = true;
      const result = call("set-buffer-modified-p", [createBoolean(false)]);
      expect(result.type).toBe("nil");
      expect(bufferModified).toBe(false);
    });

    test("rejects non-boolean argument", () => {
      setupBuffer("hello");
      const result = callEither("set-buffer-modified-p", [createString("true")]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("rejects wrong argument count", () => {
      setupBuffer("hello");
      const result = callEither("set-buffer-modified-p", []);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // --- buffer-get-line-indent ---

  describe("buffer-get-line-indent", () => {
    test("returns 0 for line with no leading whitespace", () => {
      setupBuffer("hello world");
      const result = call("buffer-get-line-indent", [createNumber(0)]);
      expect(result.type).toBe("number");
      expect(result.value).toBe(0);
    });

    test("returns indent count for line with leading spaces", () => {
      setupBuffer("    indented code");
      const result = call("buffer-get-line-indent", [createNumber(0)]);
      expect(result.type).toBe("number");
      expect(result.value).toBe(4);
    });

    test("returns 0 for empty line", () => {
      setupBuffer("first\n\nthird");
      const result = call("buffer-get-line-indent", [createNumber(1)]);
      expect(result.type).toBe("number");
      expect(result.value).toBe(0);
    });

    test("returns indent for multiple lines", () => {
      setupBuffer("no indent\n  two spaces\n    four spaces");
      expect(call("buffer-get-line-indent", [createNumber(0)]).value).toBe(0);
      expect(call("buffer-get-line-indent", [createNumber(1)]).value).toBe(2);
      expect(call("buffer-get-line-indent", [createNumber(2)]).value).toBe(4);
    });

    test("returns 0 for line starting with non-space character", () => {
      setupBuffer("x");
      const result = call("buffer-get-line-indent", [createNumber(0)]);
      expect(result.value).toBe(0);
    });

    test("returns error for out-of-bounds line number", () => {
      setupBuffer("only one line");
      const result = callEither("buffer-get-line-indent", [createNumber(99)]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("rejects non-number argument", () => {
      setupBuffer("hello");
      const result = callEither("buffer-get-line-indent", [createString("0")]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error when no buffer exists", () => {
      buffers.clear();
      currentBuffer = null;
      const result = callEither("buffer-get-line-indent", [createNumber(0)]);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // --- buffer-set-line-indent ---

  describe("buffer-set-line-indent", () => {
    test("adds indentation to a line with no existing indent", () => {
      setupBuffer("hello");
      call("buffer-set-line-indent", [createNumber(0), createNumber(4)]);
      // Verify the line content changed by reading via getLine
      const lineResult = currentBuffer!.getLine(0);
      if (Either.isRight(lineResult)) {
        expect(lineResult.right).toBe("    hello");
      }
    });

    test("removes indentation from an indented line", () => {
      setupBuffer("    hello");
      call("buffer-set-line-indent", [createNumber(0), createNumber(0)]);
      const lineResult = currentBuffer!.getLine(0);
      if (Either.isRight(lineResult)) {
        expect(lineResult.right).toBe("hello");
      }
    });

    test("changes indentation from 2 to 4 spaces", () => {
      setupBuffer("  hello");
      call("buffer-set-line-indent", [createNumber(0), createNumber(4)]);
      const lineResult = currentBuffer!.getLine(0);
      if (Either.isRight(lineResult)) {
        expect(lineResult.right).toBe("    hello");
      }
    });

    test("no-op when target indent equals current indent", () => {
      setupBuffer("  hello");
      call("buffer-set-line-indent", [createNumber(0), createNumber(2)]);
      const lineResult = currentBuffer!.getLine(0);
      if (Either.isRight(lineResult)) {
        expect(lineResult.right).toBe("  hello");
      }
    });

    test("returns nil on success", () => {
      setupBuffer("hello");
      const result = call("buffer-set-line-indent", [createNumber(0), createNumber(2)]);
      expect(result.type).toBe("nil");
    });

    test("rejects wrong argument count", () => {
      setupBuffer("hello");
      const result = callEither("buffer-set-line-indent", [createNumber(0)]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("rejects non-number arguments", () => {
      setupBuffer("hello");
      const result = callEither("buffer-set-line-indent", [createString("0"), createNumber(4)]);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // --- buffer-previous-non-blank-line ---

  describe("buffer-previous-non-blank-line", () => {
    test("returns -1 when no non-blank line exists above", () => {
      setupBuffer("\n\n\nlast");
      // Starting from line 3 ("last"), all lines above are blank
      const result = call("buffer-previous-non-blank-line", [createNumber(3)]);
      expect(result.type).toBe("number");
      expect(result.value).toBe(-1);
    });

    test("finds the previous non-blank line", () => {
      setupBuffer("code here\n\nmore code");
      const result = call("buffer-previous-non-blank-line", [createNumber(2)]);
      expect(result.type).toBe("number");
      expect(result.value).toBe(0);
    });

    test("skips blank lines to find non-blank", () => {
      setupBuffer("a\n\n\nb");
      // Line 3 is "b", previous non-blank should be line 0 ("a")
      const result = call("buffer-previous-non-blank-line", [createNumber(3)]);
      expect(result.value).toBe(0);
    });

    test("returns -1 when starting from line 0", () => {
      setupBuffer("only line");
      const result = call("buffer-previous-non-blank-line", [createNumber(0)]);
      expect(result.value).toBe(-1);
    });

    test("finds immediately previous non-blank line", () => {
      setupBuffer("line0\nline1\nline2");
      const result = call("buffer-previous-non-blank-line", [createNumber(2)]);
      expect(result.value).toBe(1);
    });

    test("treats whitespace-only lines as blank", () => {
      setupBuffer("code\n   \nmore");
      const result = call("buffer-previous-non-blank-line", [createNumber(2)]);
      expect(result.value).toBe(0);
    });

    test("rejects non-number argument", () => {
      setupBuffer("hello");
      const result = callEither("buffer-previous-non-blank-line", [createString("0")]);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  // --- buffer-line-matches ---

  describe("buffer-line-matches", () => {
    test("returns true when pattern matches", () => {
      setupBuffer("hello world");
      const result = call("buffer-line-matches", [createNumber(0), createString("hello")]);
      expect(result.type).toBe("boolean");
      expect(result.value).toBe(true);
    });

    test("returns false when pattern does not match", () => {
      setupBuffer("hello world");
      const result = call("buffer-line-matches", [createNumber(0), createString("goodbye")]);
      expect(result.type).toBe("boolean");
      expect(result.value).toBe(false);
    });

    test("supports regex patterns", () => {
      setupBuffer("foo123bar");
      const result = call("buffer-line-matches", [createNumber(0), createString("[0-9]+")]);
      expect(result.value).toBe(true);
    });

    test("supports anchor patterns", () => {
      setupBuffer("  indented");
      const result = call("buffer-line-matches", [createNumber(0), createString("^  ")]);
      expect(result.value).toBe(true);
    });

    test("returns false for empty line with non-empty pattern", () => {
      setupBuffer("first\n\nthird");
      const result = call("buffer-line-matches", [createNumber(1), createString("\\S")]);
      expect(result.value).toBe(false);
    });

    test("returns error for invalid regex", () => {
      setupBuffer("hello");
      const result = callEither("buffer-line-matches", [createNumber(0), createString("[invalid")]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("returns error for out-of-bounds line", () => {
      setupBuffer("hello");
      const result = callEither("buffer-line-matches", [createNumber(99), createString("hello")]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("rejects wrong argument count", () => {
      setupBuffer("hello");
      const result = callEither("buffer-line-matches", [createNumber(0)]);
      expect(Either.isLeft(result)).toBe(true);
    });

    test("rejects wrong argument types", () => {
      setupBuffer("hello");
      const result = callEither("buffer-line-matches", [createString("0"), createNumber(0)]);
      expect(Either.isLeft(result)).toBe(true);
    });
  });
});
