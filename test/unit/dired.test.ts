import { describe, test, expect, beforeEach } from "bun:test";
import { createDiredOps } from "../../src/editor/api/dired-ops.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import { createString, createList, createSymbol } from "../../src/tlisp/values.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("Dired Operations", () => {
  let buffer: FunctionalTextBufferImpl;
  let cursorLine = 0;
  const buffers = new Map<string, FunctionalTextBufferImpl>();

  beforeEach(() => {
    buffer = FunctionalTextBufferImpl.create("");
    cursorLine = 0;
    buffers.clear();
  });

  function getOps() {
    return createDiredOps(
      () => buffer,
      (b) => { buffer = b as FunctionalTextBufferImpl; },
      () => cursorLine,
      buffers
    );
  }

  test("dired-format-listing formats entries", () => {
    const ops = getOps();
    const fn = ops.get("dired-format-listing")!;
    // Entries are plist-style: alternating symbol/value
    const entries = createList([
      createList([createSymbol("name"), createString("file1.ts"), createSymbol("size"), createString("128")]),
      createList([createSymbol("name"), createString("file2.py"), createSymbol("size"), createString("256")]),
    ]);
    const result = fn([createString("/tmp"), entries]);
    expect(Either.isRight(result)).toBe(true);
    const text = (result.right as any).value as string;
    expect(text).toContain("/tmp");
  });

  test("dired-format-listing validates args", () => {
    const ops = getOps();
    const fn = ops.get("dired-format-listing")!;
    const result = fn([]);
    expect(Either.isLeft(result)).toBe(true);
  });

  test("dired-parse-current-entry extracts last token from line", () => {
    buffer = FunctionalTextBufferImpl.create("  -rw-r--r--  128  /tmp/file1.ts\n  -rw-r--r--  256  /tmp/file2.py");
    cursorLine = 0;
    const ops = getOps();
    const fn = ops.get("dired-parse-current-entry")!;
    const result = fn([]);
    expect(Either.isRight(result)).toBe(true);
    const val = (result.right as any).value as string;
    expect(val).toContain("file1.ts");
  });

  test("dired-is-directory-p detects directories", () => {
    const ops = getOps();
    const fn = ops.get("dired-is-directory-p")!;
    const result = fn([createString("src/")]);
    expect(Either.isRight(result)).toBe(true);
    expect((result.right as any).value).toBe(true);
  });

  test("dired-is-directory-p returns false for files", () => {
    const ops = getOps();
    const fn = ops.get("dired-is-directory-p")!;
    const result = fn([createString("file.ts")]);
    expect(Either.isRight(result)).toBe(true);
    expect((result.right as any).value).toBe(false);
  });

  test("dired-toggle-mark takes mark argument", () => {
    buffer = FunctionalTextBufferImpl.create("/tmp\n  file1.ts    128\n  file2.py    256");
    cursorLine = 1;
    const ops = getOps();
    const fn = ops.get("dired-toggle-mark")!;
    const result = fn([createString("D")]);
    expect(Either.isRight(result)).toBe(true);
  });

  test("dired-toggle-mark validates args", () => {
    const ops = getOps();
    const fn = ops.get("dired-toggle-mark")!;
    const result = fn([]);
    expect(Either.isLeft(result)).toBe(true);
  });
});
