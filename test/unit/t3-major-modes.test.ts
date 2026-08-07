/**
 * @file t3-major-modes.test.ts
 * @description #154 / SPEC-091 — xml/c/cpp/java/sql major modes are registered,
 * load at startup, auto-detect by extension, and activate without error.
 * c/cpp additionally set a real syntax language (tokenizer-supported).
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

describe("#154 — T3 major modes (xml, c, cpp, java, sql)", () => {
  test("all five modes are in (major-mode-list) at startup", async () => {
    const editor = await createStartedEditor("");
    const modes = asStringList(evalRight(editor, "(major-mode-list)"));
    for (const name of ["xml", "c", "cpp", "java", "sql"]) {
      expect(modes).toContain(name);
    }
  });

  test("xml-mode auto-detects .xml/.xsd/.xsl/.svg/.plist", async () => {
    const editor = await createStartedEditor("");
    for (const f of ["doc.xml", "schema.xsd", "transform.xsl", "logo.svg", "app.plist"]) {
      expect(evalRight(editor, `(auto-mode-detect "${f}")`)).toBe("xml");
    }
  });

  test("c-mode auto-detects .c/.h", async () => {
    const editor = await createStartedEditor("");
    expect(evalRight(editor, '(auto-mode-detect "main.c")')).toBe("c");
    expect(evalRight(editor, '(auto-mode-detect "util.h")')).toBe("c");
  });

  test("cpp-mode auto-detects .cpp/.cc/.cxx/.hpp/.hh/.hxx", async () => {
    const editor = await createStartedEditor("");
    for (const f of ["main.cpp", "src.cc", "src.cxx", "hdr.hpp", "hdr.hh", "hdr.hxx"]) {
      expect(evalRight(editor, `(auto-mode-detect "${f}")`)).toBe("cpp");
    }
  });

  test("java-mode auto-detects .java; sql-mode auto-detects .sql/.psql", async () => {
    const editor = await createStartedEditor("");
    expect(evalRight(editor, '(auto-mode-detect "App.java")')).toBe("java");
    expect(evalRight(editor, '(auto-mode-detect "schema.sql")')).toBe("sql");
    expect(evalRight(editor, '(auto-mode-detect "db.psql")')).toBe("sql");
  });

  test("each mode activates via (major-mode-set) without error", async () => {
    for (const name of ["xml", "c", "cpp", "java", "sql"]) {
      const editor = await createStartedEditor("");
      expect(evalRight(editor, `(major-mode-set "${name}")`)).toBe(name);
      expect(evalRight(editor, "(major-mode-get)")).toBe(name);
    }
  });

  test("c-mode and cpp-mode set the syntax language on activate (real font-lock)", async () => {
    const cEditor = await createStartedEditor("");
    evalRight(cEditor, '(major-mode-set "c")');
    expect(evalRight(cEditor, "(syntax-get-language)")).toBe("c");

    const cppEditor = await createStartedEditor("");
    evalRight(cppEditor, '(major-mode-set "cpp")');
    expect(evalRight(cppEditor, "(syntax-get-language)")).toBe("cpp");
  });

  test("unknown extension still falls back to fundamental", async () => {
    const editor = await createStartedEditor("");
    expect(evalRight(editor, '(auto-mode-detect "data.weirdext")')).toBe("fundamental");
  });
});
