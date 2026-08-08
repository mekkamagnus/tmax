/** snippet-mode.test.ts — #167 / SPEC-101 */
import { describe, test, expect } from "bun:test";
import { SnippetManager } from "../../src/editor/api/snippet-ops.ts";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("SnippetManager — parsing + loading", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "tmax-snip-"));

  test("parse a yasnippet-format file", () => {
    const modeDir = join(tmpRoot, "typescript-mode");
    mkdirSync(modeDir, { recursive: true });
    writeFileSync(join(modeDir, "fun"), "# key: fun\n# name: function declaration\n# --\nfunction ${1:name}() {\n  $0\n}\n");

    const mgr = new SnippetManager(tmpRoot);
    const snippets = mgr.loadMode("typescript-mode");
    expect(snippets).toHaveLength(1);
    expect(snippets[0]!.key).toBe("fun");
    expect(snippets[0]!.name).toBe("function declaration");
    expect(snippets[0]!.body).toContain("function");
    expect(snippets[0]!.body).toContain("${1:name}");
    expect(snippets[0]!.body).toContain("$0");
  });

  test("lookup by key finds snippet", () => {
    const modeDir = join(tmpRoot, "python-mode");
    mkdirSync(modeDir, { recursive: true });
    writeFileSync(join(modeDir, "def"), "# key: def\n# name: function def\n# --\ndef ${1:name}():\n    $0\n");

    const mgr = new SnippetManager(tmpRoot);
    const found = mgr.lookup("def", "python-mode");
    expect(found).not.toBeNull();
    expect(found!.key).toBe("def");
  });

  test("lookup falls back to text-mode (global)", () => {
    const modeDir = join(tmpRoot, "text-mode");
    mkdirSync(modeDir, { recursive: true });
    writeFileSync(join(modeDir, "lorem"), "# key: lorem\n# name: lorem ipsum\n# --\nLorem ipsum dolor sit amet.\n");

    const mgr = new SnippetManager(tmpRoot);
    const found = mgr.lookup("lorem", "typescript-mode");  // not in ts, should fall back
    expect(found).not.toBeNull();
    expect(found!.key).toBe("lorem");
  });

  test("lookup returns null when not found", () => {
    const mgr = new SnippetManager(tmpRoot);
    expect(mgr.lookup("nonexistent", "typescript-mode")).toBeNull();
  });

  test("file without # -- treats entire content as body (filename as key)", () => {
    const modeDir = join(tmpRoot, "lisp-mode");
    mkdirSync(modeDir, { recursive: true });
    writeFileSync(join(modeDir, "defun"), "(defun ${1:name} ()\n  ${0:body})\n");

    const mgr = new SnippetManager(tmpRoot);
    const snippets = mgr.loadMode("lisp-mode");
    expect(snippets).toHaveLength(1);
    expect(snippets[0]!.key).toBe("defun");
    expect(snippets[0]!.body).toContain("(defun");
  });

  test("reload clears cache", () => {
    const modeDir = join(tmpRoot, "rust-mode");
    mkdirSync(modeDir, { recursive: true });
    writeFileSync(join(modeDir, "fn"), "# key: fn\n# --\nfn ${1:name}() {\n  $0\n}\n");

    const mgr = new SnippetManager(tmpRoot);
    expect(mgr.loadMode("rust-mode")).toHaveLength(1);

    // Add a new snippet
    writeFileSync(join(modeDir, "struct"), "# key: struct\n# --\nstruct ${1:Name} {\n  $0\n}\n");

    // Before reload: cached (still 1)
    expect(mgr.loadMode("rust-mode")).toHaveLength(1);

    // After reload: fresh (2)
    mgr.reload();
    expect(mgr.loadMode("rust-mode")).toHaveLength(2);
  });

  test("list returns mode snippets + global fallback", () => {
    const mgr = new SnippetManager(tmpRoot);
    const list = mgr.list("typescript-mode");
    // Should include typescript-mode snippets + text-mode fallback
    expect(list.some(s => s.key === "fun")).toBe(true);
    expect(list.some(s => s.key === "lorem")).toBe(true); // from text-mode
  });

  test("parsePlaceholders extracts fields with defaults", () => {
    const mgr = new SnippetManager(tmpRoot);
    const { expandedBody, fields } = mgr.parsePlaceholders("function ${1:name}(${2:args}) {\n  $0\n}");
    expect(expandedBody).toContain("name"); // default filled in
    expect(expandedBody).toContain("args");
    expect(fields.length).toBeGreaterThanOrEqual(2); // $1 and $2 (+ $0)
    const field1 = fields.find(f => f.id === 1);
    expect(field1).toBeDefined();
    expect(field1!.defaultText).toBe("name");
    const field0 = fields.find(f => f.id === 0);
    expect(field0).toBeDefined(); // $0 final position
  });

  test("parsePlaceholders handles mirror fields", () => {
    const mgr = new SnippetManager(tmpRoot);
    const { fields } = mgr.parsePlaceholders("${1:x} = ${1:x} + 1");
    const field1 = fields.find(f => f.id === 1);
    expect(field1).toBeDefined();
    expect(field1!.positions.length).toBe(2); // two occurrences of $1
  });
});

describe("#167 — snippet-mode T-Lisp integration", () => {
  test("snippet-mode registered as minor mode", async () => {
    const editor = await createStartedEditor("");
    const result = editor.getInterpreter().execute('(minor-mode-list-all)') as any;
    const names = result?.right?.value?.map((v: any) => v.value) ?? [];
    expect(names).toContain("snippet");
  });

  test("snippet-field-active-p returns false initially", async () => {
    const editor = await createStartedEditor("");
    const result = editor.getInterpreter().execute("(snippet-field-active-p)") as any;
    expect(result?.right?.value).toBe(false);
  });

  test("snippet-reload doesn't error", async () => {
    const editor = await createStartedEditor("");
    const result = editor.getInterpreter().execute("(snippet-reload)") as any;
    expect(result?._tag).toBe("Right");
  });

  test("snippet-list returns a list", async () => {
    const editor = await createStartedEditor("");
    const result = editor.getInterpreter().execute("(snippet-list)") as any;
    expect(result?._tag).toBe("Right");
    expect(result?.right?.type).toBe("list");
  });
});
