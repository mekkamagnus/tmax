import { describe, expect, test } from "bun:test";
import { splitInputForTlisp } from "../../src/frontend/input.ts";

describe("splitInputForTlisp", () => {
  test("splits batched text into single key events", () => {
    expect(splitInputForTlisp("iHello")).toEqual(["i", "H", "e", "l", "l", "o"]);
  });

  test("preserves unicode characters", () => {
    expect(splitInputForTlisp("a🙂b")).toEqual(["a", "🙂", "b"]);
  });
});
