import { describe, expect, test } from "bun:test";
import { discoverModeFiles, loadTlispFile } from "../../src/editor/mode-loader.ts";
import { Either } from "../../src/utils/task-either.ts";
import { createNil } from "../../src/tlisp/values.ts";

describe("mode loader", () => {
  test("discovers built-in mode files deterministically", () => {
    const files = discoverModeFiles("src/tlisp/core/modes");
    expect(files[0]).toEndWith("fundamental.tlisp");
    expect(files).toContain("src/tlisp/core/modes/python-mode.tlisp");
    expect(files).toContain("src/tlisp/core/modes/line-numbers-mode.tlisp");
  });

  test("loads an existing T-Lisp file through evaluator callback", () => {
    let evaluated = "";
    const result = loadTlispFile("src/tlisp/core/modes/fundamental.tlisp", (source) => {
      evaluated = source;
      return Either.right(createNil());
    });

    expect(Either.isRight(result)).toBe(true);
    expect(evaluated).toContain('defmodule editor/modes/fundamental');
  });

  test("returns an error for missing files", () => {
    const result = loadTlispFile("src/tlisp/core/modes/no-such-mode.tlisp", () => Either.right(createNil()));
    expect(Either.isLeft(result)).toBe(true);
  });
});
