import { describe, test, expect, beforeEach } from "bun:test";
import { expectRight } from "../helpers/editor-fixture.ts";
import { createReplaceOps } from "../../src/editor/api/replace-ops.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import { createString, createNumber, createList } from "../../src/tlisp/values.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("Query Replace Operations", () => {
  let buffer: FunctionalTextBufferImpl;
  let cursorLine = 0;

  beforeEach(() => {
    buffer = FunctionalTextBufferImpl.create("hello world\nhello there\nhello goodbye");
    cursorLine = 0;
  });

  function getOps() {
    return createReplaceOps(
      () => buffer,
      (b) => { buffer = b as FunctionalTextBufferImpl; },
      () => cursorLine,
      (l) => { cursorLine = l; }
    );
  }

  test("replace-find-matches finds all occurrences", () => {
    const ops = getOps();
    const fn = ops.get("replace-find-matches")!;
    const result = fn([createString("hello")]);
    expect(Either.isRight(result)).toBe(true);
    const matches = (expectRight(result) as any).value as any[];
    expect(matches.length).toBe(3);
    // Each match is (line startCol endCol)
    const first = matches[0].value as any[];
    expect(first[0].value).toBe(0);
    expect(first[1].value).toBe(0);
    expect(first[2].value).toBe(5);
  });

  test("replace-find-matches returns empty for no match", () => {
    const ops = getOps();
    const fn = ops.get("replace-find-matches")!;
    const result = fn([createString("xyz")]);
    expect(Either.isRight(result)).toBe(true);
    const matches = (expectRight(result) as any).value as any[];
    expect(matches.length).toBe(0);
  });

  test("buffer-replace-range replaces text in line (5 args)", () => {
    const ops = getOps();
    const fn = ops.get("buffer-replace-range")!;
    // args: startLine, startCol, endLine, endCol, newText
    const result = fn([
      createNumber(0), createNumber(0),
      createNumber(0), createNumber(5),
      createString("HELLO")
    ]);
    expect(Either.isRight(result)).toBe(true);
    const content = buffer.getContent();
    if (Either.isRight(content)) {
      expect(expectRight(content)).toContain("HELLO world");
    }
  });

  test("replace-apply-all replaces all matches end-to-end", () => {
    const ops = getOps();
    // Step 1: find matches
    const findResult = ops.get("replace-find-matches")!([createString("hello")]);
    expect(Either.isRight(findResult)).toBe(true);
    const matches = expectRight(findResult);

    // Step 2: init state with find, replace, matches
    const initResult = ops.get("replace-state-init")!([createString("hello"), createString("HI"), matches]);
    expect(Either.isRight(initResult)).toBe(true);

    // Step 3: apply all
    const result = ops.get("replace-apply-all")!([]);
    expect(Either.isRight(result)).toBe(true);
    const content = buffer.getContent();
    if (Either.isRight(content)) {
      expect(expectRight(content)).toContain("HI world");
      expect(expectRight(content)).toContain("HI there");
      expect(expectRight(content)).toContain("HI goodbye");
      expect(expectRight(content)).not.toContain("hello");
    }
  });

  test("replace-exit clears state", () => {
    const ops = getOps();
    const findResult = ops.get("replace-find-matches")!([createString("hello")]);
    ops.get("replace-state-init")!([createString("hello"), createString("HI"), expectRight(findResult)]);
    const result = ops.get("replace-exit")!([]);
    expect(Either.isRight(result)).toBe(true);
  });

  test("replace-find-matches validates args", () => {
    const ops = getOps();
    const fn = ops.get("replace-find-matches")!;
    const result = fn([]);
    expect(Either.isLeft(result)).toBe(true);
  });

  test("buffer-replace-range validates 5 args required", () => {
    const ops = getOps();
    const fn = ops.get("buffer-replace-range")!;
    const result = fn([createNumber(0)]);
    expect(Either.isLeft(result)).toBe(true);
  });
});
