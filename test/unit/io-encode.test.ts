import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEditorAPI } from "../../src/editor/tlisp-api.ts";
import { Either } from "../../src/utils/task-either.ts";
import { createTestAPIContext, expectDefined, expectRight } from "../helpers/editor-fixture.ts";
import { TextBufferImpl } from "../../src/core/buffer.ts";
import type { TLispValue } from "../../src/tlisp/types.ts";

// #209 (RFC-018 Tier 1 / RFC-027 §D2) — json-encode + append-file:
// the persistence pair for FAEP's append-only JSONL event logs.

const str = (v: string): TLispValue => ({ type: "string", value: v } as TLispValue);

function makeApi() {
  const buf = TextBufferImpl.create("");
  return createEditorAPI(createTestAPIContext({
    currentBuffer: buf,
    buffers: new Map([["default", buf]]),
  }));
}

describe("#209 json-encode (via started editor)", () => {
  test("encodes alist-of-pairs as a JSON object and round-trips", async () => {
    const { createStartedEditor, executeTlisp } = await import("../helpers/editor-fixture.ts");
    const editor = await createStartedEditor();
    const encoded = String(executeTlisp(editor, `(json-encode '(("kind" "text-delta") ("n" 3)))`).value);
    expect(JSON.parse(encoded)).toEqual({ kind: "text-delta", n: 3 });
    // Round-trip through json-read-from-string
    const back = executeTlisp(editor, `(json-read-from-string ${JSON.stringify(encoded)})`);
    expect(back.value).toBeDefined();
    const reEncoded = String(executeTlisp(editor, `(json-encode (json-read-from-string ${JSON.stringify(encoded)}))`).value);
    expect(JSON.parse(reEncoded)).toEqual({ kind: "text-delta", n: 3 });
  });

  test("encodes plain lists as arrays; nested structures compose", async () => {
    const { createStartedEditor, executeTlisp } = await import("../helpers/editor-fixture.ts");
    const editor = await createStartedEditor();
    const encoded = String(executeTlisp(editor, `(json-encode '(1 2 3))`).value);
    expect(JSON.parse(encoded)).toEqual([1, 2, 3]);

    const nested = String(executeTlisp(editor, `(json-encode '(("events" (1 2)) ("ok" t) ("err" nil)))`).value);
    expect(JSON.parse(nested)).toEqual({ events: [1, 2], ok: true, err: null });
  });

  test("encodes hashmaps with string keys as objects", async () => {
    const { createStartedEditor, executeTlisp } = await import("../helpers/editor-fixture.ts");
    const editor = await createStartedEditor();
    const encoded = String(executeTlisp(editor, `(json-encode (hashmap "type" "turn-start" "turn" 4))`).value);
    expect(JSON.parse(encoded)).toEqual({ type: "turn-start", turn: 4 });
  });

  test("scalars: strings, numbers, booleans, nil, symbols", async () => {
    const { createStartedEditor, executeTlisp } = await import("../helpers/editor-fixture.ts");
    const editor = await createStartedEditor();
    expect(JSON.parse(String(executeTlisp(editor, `(json-encode "hi")`).value))).toBe("hi");
    expect(JSON.parse(String(executeTlisp(editor, `(json-encode 42)`).value))).toBe(42);
    expect(JSON.parse(String(executeTlisp(editor, `(json-encode t)`).value))).toBe(true);
    expect(JSON.parse(String(executeTlisp(editor, `(json-encode nil)`).value))).toBe(null);
    expect(JSON.parse(String(executeTlisp(editor, `(json-encode 'idle)`).value))).toBe("idle");
  });

  test("FAEP-shaped event encodes losslessly", async () => {
    const { createStartedEditor, executeTlisp } = await import("../helpers/editor-fixture.ts");
    const editor = await createStartedEditor();
    const event = `(json-encode '(("kind" "tool-call") ("id" "tc-7") ("tool" "Bash") ("summary" "bun test") ("ok" t) ("args" ("--dots" 2))))`;
    const parsed = JSON.parse(String(executeTlisp(editor, event).value));
    expect(parsed).toEqual({
      kind: "tool-call", id: "tc-7", tool: "Bash", summary: "bun test",
      ok: true, args: ["--dots", 2],
    });
  });

  test("arity validation", async () => {
    const { createStartedEditor, executeTlisp } = await import("../helpers/editor-fixture.ts");
    const editor = await createStartedEditor();
    let threw = false;
    try { executeTlisp(editor, `(json-encode)`); } catch { threw = true; }
    expect(threw).toBe(true);
  });
});

describe("#209 append-file", () => {
  const api = makeApi();
  let dir = "";
  const path = () => join(dir, "events.jsonl");

  test("creates the file when absent, appends in order across calls", () => {
    dir = mkdtempSync(join(tmpdir(), "tmax-append-"));
    const append = expectDefined(api.get("append-file"));
    expectRight(append([str(path()), str('{"n":1}\n')]));
    expectRight(append([str(path()), str('{"n":2}\n')]));
    expectRight(append([str(path()), str('{"n":3}\n')]));
    expect(readFileSync(path(), "utf-8")).toBe('{"n":1}\n{"n":2}\n{"n":3}\n');
  });

  test("appends after write-file-content without truncation", () => {
    const write = expectDefined(api.get("write-file-content"));
    const append = expectDefined(api.get("append-file"));
    expectRight(write([str(path()), str("seed\n")]));
    expectRight(append([str(path()), str("tail\n")]));
    expect(readFileSync(path(), "utf-8")).toBe("seed\ntail\n");
  });

  test("validation: arity and types", () => {
    const append = expectDefined(api.get("append-file"));
    expect(Either.isLeft(append([str("/tmp/x")]))).toBe(true);
    expect(Either.isLeft(append([str("/tmp/x"), { type: "number", value: 1 } as TLispValue]))).toBe(true);
  });

  test("cleanup fixture", () => {
    rmSync(dir, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});
