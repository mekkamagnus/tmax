import { describe, expect, test } from "bun:test";
import { dispatchSerialized, tokenizeSteepInput } from "../../src/steep/input.ts";
import type { KeyMsg } from "../../src/frontend/frontends/types.ts";

describe("Steep input tokenizer", () => {
  test("normalizes controls mixed with printable text", () => {
    const result = tokenizeSteepInput("a\rb\x7fc\t");

    expect(result.keys).toEqual(["a", "\n", "b", "\x7f", "c", "\t"]);
    expect(result.messages[1]).toMatchObject({ key: "\n", return: true });
    expect(result.messages[3]).toMatchObject({ key: "\x7f", backspace: true });
  });

  test("normalizes multiple escape sequences in one chunk", () => {
    const result = tokenizeSteepInput("\x1b[A\x1b[B\x1b[3~");

    expect(result.keys).toEqual(["Up", "Down", "\x7f"]);
    expect(result.pending).toBe("");
  });

  test("retains and completes a partial escape sequence", () => {
    const first = tokenizeSteepInput("\x1b[");
    const second = tokenizeSteepInput("A", first.pending);

    expect(first.keys).toEqual([]);
    expect(first.pending).toBe("\x1b[");
    expect(second.keys).toEqual(["Up"]);
    expect(second.pending).toBe("");
  });

  test("preserves standalone escape, ctrl keys, and unicode", () => {
    const result = tokenizeSteepInput("\x1b\x03🙂");

    expect(result.keys).toEqual(["\x1b", "\x03", "🙂"]);
    expect(result.messages[0]).toMatchObject({ escape: true });
    expect(result.messages[1]).toMatchObject({ ctrl: true });
  });
});

describe("Steep input dispatch serialization (#195 / BUG-81)", () => {
  // The live root cause: tmux/terminals coalesce "SPC ;" into one stdin
  // chunk; the old fire-and-forget loop dispatched both keys concurrently,
  // so ";" read spacePressed before " "'s async handleKey had set it.
  test("keys in one chunk dispatch sequentially — no start/end interleaving", async () => {
    const events: string[] = [];
    const handler = async (msg: KeyMsg) => {
      events.push(`start:${msg.key}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      events.push(`end:${msg.key}`);
    };

    const tail = dispatchSerialized(
      tokenizeSteepInput(" ;").messages,
      handler,
      Promise.resolve(),
    );
    await tail;

    expect(events).toEqual(["start: ", "end: ", "start:;", "end:;"]);
  });

  test("second key observes leader state set asynchronously by the first (BUG-81 regression)", async () => {
    let spacePressed = false;
    const observed: boolean[] = [];

    const handler = async (msg: KeyMsg) => {
      if (msg.key === " ") {
        await new Promise((resolve) => setTimeout(resolve, 1));
        spacePressed = true; // set late, like the async handleKey path
      } else if (msg.key === ";") {
        observed.push(spacePressed);
      }
    };

    await dispatchSerialized(
      tokenizeSteepInput(" ;").messages,
      handler,
      Promise.resolve(),
    );

    expect(observed).toEqual([true]);
  });

  test("overlapping chunks serialize via the returned tail", async () => {
    const events: string[] = [];
    const handler = async (msg: KeyMsg) => {
      events.push(`start:${msg.key}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      events.push(`end:${msg.key}`);
    };

    const chunkA = dispatchSerialized(
      tokenizeSteepInput(" ").messages,
      handler,
      Promise.resolve(),
    );
    const chunkB = dispatchSerialized(
      tokenizeSteepInput(";").messages,
      handler,
      chunkA,
    );
    await chunkB;

    expect(events).toEqual(["start: ", "end: ", "start:;", "end:;"]);
  });

  test("chain survives a rejecting handler (error surfaced, later keys still dispatch)", async () => {
    const events: string[] = [];
    const handler = async (msg: KeyMsg) => {
      if (msg.key === "a") throw new Error("boom");
      events.push(msg.key);
    };

    const tail = dispatchSerialized(
      tokenizeSteepInput("ab").messages,
      handler,
      Promise.resolve(),
    );
    await tail;

    expect(events).toEqual(["b"]);
  });
});
