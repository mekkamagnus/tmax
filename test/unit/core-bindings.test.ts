import { describe, test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { TLispParser } from "../../src/tlisp/parser.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("Core Bindings T-Lisp File", () => {
  test("exists and remains parseable T-Lisp", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");
    expect(typeof content).toBe("string");
    expect(content.length > 0).toBe(true);

    const result = new TLispParser().parse(content);
    expect(Either.isRight(result)).toBe(true);
  });

  test("should not contain TypeScript string escaping", async () => {
    const content = await readFile("src/tlisp/core-bindings.tlisp", "utf-8");

    expect(content.includes('\\\\"')).toBe(false);
    expect(content.includes('\\\\n')).toBe(false);
  });
});
