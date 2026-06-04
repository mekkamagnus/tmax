import { describe, expect, test } from "bun:test";
import { tokenizeSteepInput } from "../../src/frontend/frontends/steep/input.ts";

describe("Steep input tokenizer", () => {
  test("normalizes controls mixed with printable text", () => {
    const result = tokenizeSteepInput("a\rb\x7fc\t");

    expect(result.keys).toEqual(["a", "\n", "b", "\x7f", "c", "\t"]);
    expect(result.messages[1]).toMatchObject({ key: "\n", return: true });
    expect(result.messages[3]).toMatchObject({ key: "\x7f", backspace: true });
  });

  test("normalizes multiple escape sequences in one chunk", () => {
    const result = tokenizeSteepInput("\x1b[A\x1b[B\x1b[3~");

    expect(result.keys).toEqual(["k", "j", "\x7f"]);
    expect(result.pending).toBe("");
  });

  test("retains and completes a partial escape sequence", () => {
    const first = tokenizeSteepInput("\x1b[");
    const second = tokenizeSteepInput("A", first.pending);

    expect(first.keys).toEqual([]);
    expect(first.pending).toBe("\x1b[");
    expect(second.keys).toEqual(["k"]);
    expect(second.pending).toBe("");
  });

  test("preserves standalone escape, ctrl keys, and unicode", () => {
    const result = tokenizeSteepInput("\x1b\x03🙂");

    expect(result.keys).toEqual(["\x1b", "\x03", "🙂"]);
    expect(result.messages[0]).toMatchObject({ escape: true });
    expect(result.messages[1]).toMatchObject({ ctrl: true });
  });
});
