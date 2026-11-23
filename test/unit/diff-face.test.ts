import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/** #313 — the shared diff-grammar face source + the parity test. */
type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i313-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module editor/fikra/diff-face)");
  e(editor, "(require-module fikra/diff)");
});

afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const LOGICAL_DIFF = [
  "diff --git a/f.ts b/f.ts",
  "@@ -1,2 +1,3 @@",
  " unchanged",
  "-removed line",
  "+added line",
  "+второй added ünïcode",
];

const normalize = (s: string) => strip(s);

const pairsOf = (lines: string[]): string[] =>
  lines.map((l) => {
    const cls = String(e(editor, `(editor/fikra/diff-face/diff-classify-line "${l}")`).value);
    return `${cls}|${normalize(l)}`;
  });

describe("#313 — the shared face source", () => {
  test("the unit matrix: each class × text incl. unicode, empty context", async () => {
    const f = (cls: string, text: string) =>
      JSON.stringify(String(e(editor, `(editor/fikra/diff-face/diff-face-line "${cls}" "${text}")`).value));
    expect(f("add", "+ x")).toContain("\\u001b[32m");
    expect(f("remove", "- x")).toContain("\\u001b[31m");
    expect(f("hunk-header", "@@ -1,2 +1,3 @@")).toContain("\\u001b[36m");
    expect(f("file-header", "diff --git a/x b/x")).toContain("\\u001b[1m");
    expect(f("meta", "…+NL")).toContain("\\u001b[2m");
    expect(f("context", " plain")).toBe('" plain"');
    // empty context line:
    expect(f("context", "")).toBe('""');
    // unicode passes through unharmed:
    expect(f("add", "+ ünïcode")).toContain("ünïcode");
  });

  test("the classifier: git-shape recognition", () => {
    const c = (t: string) => String(e(editor, `(editor/fikra/diff-face/diff-classify-line "${t}")`).value);
    expect(c("+added")).toBe("add");
    expect(c("-removed")).toBe("remove");
    expect(c(" ctx")).toBe("context"); // gate r1: leading space IS the context class
    expect(c("  ctx")).toBe("context");
    expect(c("--- a/f.ts")).toBe("file-header"); // not a remove row
    expect(c("+++ b/f.ts")).toBe("file-header"); // not an add row
    expect(c("@@ -1,2 @@")).toBe("hunk-header");
    expect(c("diff --git a/x b/x")).toBe("file-header");
    expect(c("diff --git")).toBe("file-header"); // exact-10 boundary
    expect(c("index abc..def")).toBe("meta");
    expect(c("other")).toBe("meta");
    expect(c("")).toBe("context");
  });

  test("diff-face-strip drops git's own colored output", () => {
    const r = String(e(editor, '(editor/fikra/diff-face/diff-face-strip "\\e[32madded\\e[0m plain\\e[31mremoved\\e[0m")').value);
    expect(r).toBe("added plainremoved");
  });
});

describe("#313 — PARITY: (class, normalized-text) sequences on identical logical diffs", () => {
  test("chat preview path vs viewer face path produce the same normalized sequence", async () => {
    // The CHAT grammar is sign-prefixed rows (fikra-tool-preview's
    // shape: "+ body" / "- body"); the VIEWER grammar is raw git
    // lines. The parity comparison normalizes each line to
    // (class, stripped text) — prefixes legitimately differ.
    e(editor, "(require-module fikra/chat)");
    const rows = [ ["add", "+ added line"], ["remove", "- removed line"], ["add", "+ второй added ünïcode"] ];
    const preview = rows.map(([, s]) => s).join("\\n");
    const rendered = String(e(editor, `(condition-case nil (fikra/event/fikra-event-render-line (list (list "kind" "tool-call") (list "tool" "buffer-edit") (list "summary" "edited f.ts") (list "preview" "${preview}"))) (error (m) (concat "THREW:" m)))`).value);
    expect(rendered).not.toContain("THREW");
    const norm = (cls: string, s: string) => `${cls}|${s.replace(/^[\s+-]+/, "")}`;
    const chatPairs: string[] = [];
    for (const l of strip(rendered).split("\n")) {
      const t = l.replace(/^ {4}/, "");
      if (t.startsWith("+")) chatPairs.push(norm("add", t));
      else if (t.startsWith("-")) chatPairs.push(norm("remove", t));
    }
    const viewer = String(e(editor, `(condition-case nil (fikra/diff/fikra-diff-facelines "${preview}") (error (m) (concat "THREW:" m)))`).value);
    expect(viewer).not.toContain("THREW");
    const viewerPairs: string[] = [];
    for (const l of strip(viewer).split("\n")) {
      if (l.startsWith("+")) viewerPairs.push(norm("add", l));
      else if (l.startsWith("-")) viewerPairs.push(norm("remove", l));
    }
    expect(chatPairs).toEqual(["add|added line", "remove|removed line", "add|второй added ünïcode"]);
    expect(viewerPairs).toEqual(chatPairs);
  });

  test("the viewer renders git content THROUGH the helper (keymap regression)", async () => {
    const content = ["diff --git a/f.ts b/f.ts", "@@ -1,2 +1,3 @@", " unchanged", "-removed line", "+added line", "+второй added ünïcode"].join("\n");
    e(editor, '(buffer-create "*Fikra-Diff*")');
    e(editor, `(condition-case nil (fikra/diff/fikra-diff-render "${content}") (error (m) (concat "THREW:" m)))`);
    e(editor, '(buffer-switch "*Fikra-Diff*")');
    const buf = strip(String(bufferText(editor)));
    expect(buf).toContain("diff --git a/f.ts b/f.ts");
    expect(buf).toContain("+второй added ünïcode");
    const kmap = e(editor, '(editor/keymaps/buffer-keymap "*Fikra-Diff*")');
    expect(String(kmap.value)).not.toBe("nil");
    // gate r1: pin the actual bindings (n/N/r/[/]), not just non-nil.
    for (const k of ["n", "N", "r", "]", "["]) {
      const cmd = String(e(editor, `(hashmap-get (hashmap-get (editor/keymaps/buffer-keymap "*Fikra-Diff*") "bindings") "${k}")`).value);
      expect(cmd).toContain("fikra/diff/");
    }
  });

  test("facelines JOIN semantics: no doubled trailing newline; empty renders empty", async () => {
    const r = e(editor, '(condition-case nil (fikra/diff/fikra-diff-facelines "+a\n-b") (error (m) (concat "THREW:" m)))');
    expect(JSON.stringify(String(r.value))).toBe('"\\u001b[32m+a\\u001b[0m\\n\\u001b[31m-b\\u001b[0m"');
    const empty = e(editor, '(condition-case nil (fikra/diff/fikra-diff-facelines "") (error (m) (concat "THREW:" m)))');
    expect(JSON.stringify(String(empty.value))).toBe('""');
  });

  test("render-parts: the summary/footer pass VERBATIM; only the patch faces", async () => {
    e(editor, "(require-module fikra/diff)");
    // Evaluate render-parts to a STRING first (no buffer interaction),
    // then append into a scratch buffer — avoids the render path's
    // read-only lifecycle entirely.
    const hdr = Buffer.from("\u001b[1;36mmy header\u001b[0m\n", "utf8").toString("hex");
    e(editor, `(condition-case nil (fikra/diff/fikra-diff-render-parts (hex-decode "${hdr}") "+added" "") (error (m) (concat "THREW:" m)))`);
    e(editor, '(buffer-switch "*Fikra-Diff*")');
    const txt = String(bufferText(editor));
    expect(txt).toContain("my header\u001b[0m"); // the summary's OWN face survived
    expect(txt).toContain("\u001b[32m+added"); // the patch faced
  });
});