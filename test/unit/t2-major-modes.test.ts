/**
 * @file t2-major-modes.test.ts
 * @description #152 / SPEC-090 — text/conf/css/html/rust/dockerfile major modes
 * are registered, load at startup, auto-detect by extension (+ Dockerfile
 * filename), and activate without error.
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

describe("#152 — T2 major modes (text, conf, css, html, rust, dockerfile)", () => {
  test("all six modes are in (major-mode-list) at startup", async () => {
    const editor = await createStartedEditor("");
    const modes = asStringList(evalRight(editor, "(major-mode-list)"));
    for (const name of ["text", "conf", "css", "html", "rust", "dockerfile"]) {
      expect(modes).toContain(name);
    }
  });

  test("text-mode auto-detects .txt", async () => {
    const editor = await createStartedEditor("");
    expect(evalRight(editor, '(auto-mode-detect "notes.txt")')).toBe("text");
  });

  test("conf-mode auto-detects .conf/.ini/.cfg/.properties/.env", async () => {
    const editor = await createStartedEditor("");
    for (const f of ["app.conf", "config.ini", "settings.cfg", "app.properties", "secrets.env"]) {
      expect(evalRight(editor, `(auto-mode-detect "${f}")`)).toBe("conf");
    }
  });

  test("css-mode auto-detects .css/.scss/.less", async () => {
    const editor = await createStartedEditor("");
    for (const f of ["style.css", "theme.scss", "vars.less"]) {
      expect(evalRight(editor, `(auto-mode-detect "${f}")`)).toBe("css");
    }
  });

  test("html-mode auto-detects .html/.htm/.xhtml", async () => {
    const editor = await createStartedEditor("");
    for (const f of ["index.html", "page.htm", "doc.xhtml"]) {
      expect(evalRight(editor, `(auto-mode-detect "${f}")`)).toBe("html");
    }
  });

  test("rust-mode auto-detects .rs", async () => {
    const editor = await createStartedEditor("");
    expect(evalRight(editor, '(auto-mode-detect "main.rs")')).toBe("rust");
  });

  test("dockerfile-mode auto-detects .dockerfile AND the Dockerfile filename", async () => {
    const editor = await createStartedEditor("");
    expect(evalRight(editor, '(auto-mode-detect "image.dockerfile")')).toBe("dockerfile");
    expect(evalRight(editor, '(auto-mode-detect "Dockerfile")')).toBe("dockerfile");
    expect(evalRight(editor, '(auto-mode-detect "Dockerfile.dev")')).toBe("dockerfile");
  });

  test("each mode activates via (major-mode-set) without error", async () => {
    for (const name of ["text", "conf", "css", "html", "rust", "dockerfile"]) {
      const editor = await createStartedEditor("");
      expect(evalRight(editor, `(major-mode-set "${name}")`)).toBe(name);
      expect(evalRight(editor, "(major-mode-get)")).toBe(name);
    }
  });

  test("unknown extension still falls back to fundamental", async () => {
    const editor = await createStartedEditor("");
    expect(evalRight(editor, '(auto-mode-detect "data.binxyz")')).toBe("fundamental");
  });
});
