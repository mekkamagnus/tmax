import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStandaloneInterpreter } from "../../src/tlisp/profiles/standalone.ts";

describe("standalone T-Lisp module loader", () => {
  test("loads embedded stdlib modules", () => {
    const interpreter = createStandaloneInterpreter();
    const result = interpreter.execute('(require-module std/strings :as s)');

    expect(result._tag).toBe("Right");
    expect(interpreter.execute('(s/join "," (list "a" "b"))')).toEqual({
      _tag: "Right",
      right: { type: "string", value: "a,b" },
    });
  });

  test("loads modules from TLISP_PATH", () => {
    const dir = mkdtempSync(join(tmpdir(), "tlisp-path-"));
    const moduleDir = join(dir, "mekael");
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(join(moduleDir, "strings.tlisp"), `
(defmodule mekael/strings
  (export shout)

  (defun shout (value)
    (string-join "" (list value "!"))))
`);

    const interpreter = createStandaloneInterpreter({ cwd: "/tmp", tlispPath: dir });
    expect(interpreter.execute('(require-module mekael/strings :as ms)')._tag).toBe("Right");
    expect(interpreter.execute('(ms/shout "hi")')).toEqual({
      _tag: "Right",
      right: { type: "string", value: "hi!" },
    });

    rmSync(dir, { recursive: true, force: true });
  });

  test("rejects traversal module names", () => {
    const interpreter = createStandaloneInterpreter();
    const result = interpreter.execute('(require-module ../secret)');
    expect(result._tag).toBe("Left");
  });
});
