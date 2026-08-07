/**
 * @file t1-major-modes.test.ts
 * @description #150 / SPEC-089 — json/yaml/shell/toml major modes are registered,
 * load at startup, auto-detect by extension, and activate without error.
 */

import { describe, test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { createStartedEditor } from "../helpers/editor-fixture.ts";

function evalRight(editor: Editor, expr: string): any {
  const result = editor.getInterpreter().execute(expr) as any;
  if (result?._tag !== "Right") {
    throw new Error(`${expr} failed: ${result?.left?.message ?? result}`);
  }
  return result.right.value;
}

function asStringList(value: any): string[] {
  return value.map((v: any) => v.value as string);
}

describe("#150 — T1 major modes (json, yaml, shell, toml)", () => {
  test("all four modes are in (major-mode-list) at startup", async () => {
    const editor = await createStartedEditor("");
    const modes = asStringList(evalRight(editor, "(major-mode-list)"));
    for (const name of ["json", "yaml", "shell", "toml"]) {
      expect(modes).toContain(name);
    }
  });

  test("json auto-detects .json and .jsonc", async () => {
    const editor = await createStartedEditor("");
    expect(evalRight(editor, '(auto-mode-detect "config.json")')).toBe("json");
    expect(evalRight(editor, '(auto-mode-detect "tsconfig.jsonc")')).toBe("json");
  });

  test("yaml auto-detects .yaml and .yml", async () => {
    const editor = await createStartedEditor("");
    expect(evalRight(editor, '(auto-mode-detect "ci.yaml")')).toBe("yaml");
    expect(evalRight(editor, '(auto-mode-detect "k8s.yml")')).toBe("yaml");
  });

  test("shell auto-detects .sh, .bash, .zsh", async () => {
    const editor = await createStartedEditor("");
    expect(evalRight(editor, '(auto-mode-detect "deploy.sh")')).toBe("shell");
    expect(evalRight(editor, '(auto-mode-detect "init.bash")')).toBe("shell");
    expect(evalRight(editor, '(auto-mode-detect "envrc.zsh")')).toBe("shell");
  });

  test("toml auto-detects .toml", async () => {
    const editor = await createStartedEditor("");
    expect(evalRight(editor, '(auto-mode-detect "Cargo.toml")')).toBe("toml");
  });

  test("each mode activates via (major-mode-set) without error", async () => {
    for (const name of ["json", "yaml", "shell", "toml"]) {
      const editor = await createStartedEditor("");
      expect(evalRight(editor, `(major-mode-set "${name}")`)).toBe(name);
      expect(evalRight(editor, "(major-mode-get)")).toBe(name);
    }
  });

  test("unknown extension falls back to fundamental", async () => {
    const editor = await createStartedEditor("");
    expect(evalRight(editor, '(auto-mode-detect "readme.xyz")')).toBe("fundamental");
  });
});
