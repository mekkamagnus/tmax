import { describe, expect, test } from "bun:test";
import { TextBufferImpl } from "../../src/core/buffer.ts";
import { createEditorAPI } from "../../src/editor/tlisp-api.ts";
import { createBufferOps } from "../../src/editor/api/buffer-ops.ts";
import { Either } from "../../src/utils/task-either.ts";
import { createTestAPIContext, expectDefined, expectRight } from "../helpers/editor-fixture.ts";
import type { TLispValue } from "../../src/tlisp/types.ts";
import type { TextBuffer } from "../../src/core/contracts/buffer.ts";

// #207 (RFC-027 §UI) — buffer-append: append-at-end primitive for streaming
// consumers. Correctness invariants per the repo's perf-test convention
// (buffer-perf-invariants.test.ts): assert the invariants the primitive must
// uphold — cursor never moves, content accumulates in order, read-only and
// argument validation hold — not wall-clock timings.

function makeState(initial = "") {
  const currentBuffer = TextBufferImpl.create(initial);
  return createTestAPIContext({
    currentBuffer,
    buffers: new Map([["default", currentBuffer]]),
  });
}

function makeStateWithBuffer(buffer: TextBuffer) {
  return createTestAPIContext({
    currentBuffer: buffer,
    buffers: new Map([["default", buffer]]),
  });
}

const str = (v: string): TLispValue => ({ type: "string", value: v } as TLispValue);

function content(api: ReturnType<typeof createEditorAPI>): string {
  const buf = expectDefined(api.get("buffer-text"));
  return (expectRight(buf([])) as TLispValue).value as string;
}

describe("#207 buffer-append", () => {
  test("appends to an empty buffer", () => {
    const api = createEditorAPI(makeState());
    const append = expectDefined(api.get("buffer-append"));
    expectRight(append([str("hello")]));
    expect(content(api)).toBe("hello");
  });

  test("appends to a non-empty single-line buffer", () => {
    const api = createEditorAPI(makeState("existing"));
    const append = expectDefined(api.get("buffer-append"));
    expectRight(append([str(" tail")]));
    expect(content(api)).toBe("existing tail");
  });

  test("multi-line append lands after the last line", () => {
    const api = createEditorAPI(makeState("one\ntwo"));
    const append = expectDefined(api.get("buffer-append"));
    expectRight(append([str("\nthree\nfour")]));
    expect(content(api)).toBe("one\ntwo\nthree\nfour");
  });

  test("append to a buffer ending with a trailing newline lands on the empty last line", () => {
    // getLineCount-1 targets the empty final line — appending must not
    // duplicate the newline or prepend to the previous line.
    const api = createEditorAPI(makeState("one\ntwo\n"));
    const append = expectDefined(api.get("buffer-append"));
    expectRight(append([str("three")]));
    expect(content(api)).toBe("one\ntwo\nthree");
    expectRight(append([str("\nfour\n")]));
    expect(content(api)).toBe("one\ntwo\nthree\nfour\n");
  });

  test("repeated appends accumulate in order (streaming shape)", () => {
    const api = createEditorAPI(makeState());
    const append = expectDefined(api.get("buffer-append"));
    for (const chunk of ["a", "b", "c", "\n", "d"]) {
      expectRight(append([str(chunk)]));
    }
    expect(content(api)).toBe("abc\nd");
  });

  test("cursor never moves — the O(buffer)-per-token motivation", () => {
    const api = createEditorAPI(makeState("line 0\nline 1\nline 2"));
    // Park the cursor somewhere away from the end, like a chat buffer whose
    // cursor sits at the top while tokens stream in.
    const move = expectDefined(api.get("cursor-move"));
    expectRight(move([{ type: "number", value: 0 } as TLispValue, { type: "number", value: 3 } as TLispValue]));
    const before = expectRight(expectDefined(api.get("cursor-position"))([])) as TLispValue;

    const append = expectDefined(api.get("buffer-append"));
    for (let i = 0; i < 20; i++) expectRight(append([str(`chunk${i} `)]));

    const after = expectRight(expectDefined(api.get("cursor-position"))([])) as TLispValue;
    expect(JSON.stringify(after.value)).toBe(JSON.stringify(before.value));
    expect(content(api)).toMatch(/chunk19 $/);
    expect(content(api).startsWith("line 0\nline 1\nline 2chunk0")).toBe(true);
  });

  test("read-only buffer rejects the append", () => {
    // The fixture does not expose the production readonly-buffer set (it is
    // wired by createEditorAPI with the fixed special-buffer names), so pin
    // the readonly path at the ops level with our own set.
    const currentBuffer = TextBufferImpl.create("ro");
    const buffers = new Map([["default", currentBuffer]]);
    const ops = createBufferOps(
      createTestAPIContext({ currentBuffer, buffers }).access,
      buffers,
      () => {},
      () => {},
      () => {},
      undefined,
      undefined,
      new Set(["default"]),
    );
    const result = ops.get("buffer-append")!([{ type: "string", value: "x" } as TLispValue]);
    expect(Either.isLeft(result)).toBe(true);
  });

  test("argument validation: non-string and wrong arity", () => {
    const api = createEditorAPI(makeState());
    const append = expectDefined(api.get("buffer-append"));
    expect(Either.isLeft(append([{ type: "number", value: 1 } as TLispValue]))).toBe(true);
    expect(Either.isLeft(append([]))).toBe(true);
    expect(Either.isLeft(append([str("a"), str("b")]))).toBe(true);
  });

  test("large-buffer smoke: 2k appends into a 10k-line buffer stay correct", () => {
    // Invariant-level perf smoke (not a timing): the incremental insert path
    // must keep content exact while streaming into a large buffer.
    const big = Array.from({ length: 10_000 }, (_, i) => `line ${i}`).join("\n");
    const api = createEditorAPI(makeStateWithBuffer(TextBufferImpl.create(big)));
    const append = expectDefined(api.get("buffer-append"));
    for (let i = 0; i < 2_000; i++) {
      const r = append([str(i % 40 === 39 ? "x\n" : "x")]);
      if (Either.isLeft(r)) throw new Error(`append ${i} failed`);
    }
    const finalContent = content(api);
    expect(finalContent.length).toBe(big.length + 2_000 + 50); // 2050 chars appended, 50 newlines
    expect(finalContent.startsWith("line 0\nline 1\n")).toBe(true);
  });
});
