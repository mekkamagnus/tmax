import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStandaloneInterpreter } from "../../src/tlisp/profiles/standalone.ts";

describe("standalone T-Lisp profile", () => {
  test("registers standalone primitives without editor primitives", () => {
    const output: string[] = [];
    const interpreter = createStandaloneInterpreter({
      stdout: { write: (chunk: string | Uint8Array) => { output.push(String(chunk)); return true; } },
      allowShell: false,
    });

    expect(interpreter.globalEnv.lookup("print")).toBeDefined();
    expect(interpreter.globalEnv.lookup("read-file")).toBeDefined();
    expect(interpreter.globalEnv.lookup("getenv")).toBeDefined();
    expect(interpreter.globalEnv.lookup("doc")).toBeDefined();
    expect(interpreter.globalEnv.lookup("buffer-insert")).toBeUndefined();

    const result = interpreter.execute('(print "hello")');
    expect(result._tag).toBe("Right");
    expect(output.join("")).toContain('"hello"');
  });

  test("supports string and type conversion helpers", () => {
    const interpreter = createStandaloneInterpreter();

    expect(interpreter.execute('(string-join "," (list "a" "b"))')).toEqual({
      _tag: "Right",
      right: { type: "string", value: "a,b" },
    });
    expect(interpreter.execute('(number-to-string 42)')).toEqual({
      _tag: "Right",
      right: { type: "string", value: "42" },
    });
    expect(interpreter.execute('(string-to-number "42")')).toEqual({
      _tag: "Right",
      right: { type: "number", value: 42 },
    });
    expect(interpreter.execute('(nilp nil)')).toEqual({
      _tag: "Right",
      right: { type: "boolean", value: true },
    });
  });

  test("reads and writes files", () => {
    const dir = mkdtempSync(join(tmpdir(), "tlisp-profile-"));
    const file = join(dir, "sample.txt");
    const interpreter = createStandaloneInterpreter();

    expect(interpreter.execute(`(write-file "${file}" "hello")`)._tag).toBe("Right");
    expect(readFileSync(file, "utf8")).toBe("hello");
    expect(interpreter.execute(`(read-file "${file}")`)).toEqual({
      _tag: "Right",
      right: { type: "string", value: "hello" },
    });

    rmSync(dir, { recursive: true, force: true });
  });
});
