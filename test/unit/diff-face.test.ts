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
    // valve r2: derive each line's class from the RENDERED ANSI SPAN
    // (the face actually applied), not by re-classifying stripped
    // text — a wrong face class now FAILS the comparison.
    const codeToCls: Record<string, string> = { "\u001b[32m": "add", "\u001b[31m": "remove", "\u001b[36m": "hunk-header", "\u001b[1m": "file-header", "\u001b[2m": "meta" };
    const spanCls = (l: string): string | null => {
      for (const [code, c] of Object.entries(codeToCls)) {
        if (l.startsWith(code)) return c;
      }
      return null; // plain (context) or non-row line
    };
    const norm = (c: string, s: string) => `${c}|${s.replace(/^[\s+-]+/, "")}`;
    const pairs = (renderedText: string, indent: boolean): string[] => {
      const out: string[] = [];
      for (const l of renderedText.split("\n")) {
        const c = spanCls(l);
        if (c === null) continue;
        const stripped = strip(l);
        const t = indent ? stripped.replace(/^ {4}/, "") : stripped;
        if (t.startsWith("+") || t.startsWith("-")) out.push(norm(c, t));
      }
      return out;
    };
    const chatPairs = pairs(rendered, true);
    const viewer = String(e(editor, `(condition-case nil (fikra/diff/fikra-diff-facelines "${preview}") (error (m) (concat "THREW:" m)))`).value);
    expect(viewer).not.toContain("THREW");
    const viewerPairs = pairs(viewer, false);
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
    const expected: Record<string, string> = {
      n: "(fikra/diff/fikra-diff-next)",
      N: "(fikra/diff/fikra-diff-prev)",
      r: "(fikra/diff/fikra-diff-revert-turn)",
      "]": "(fikra/diff/fikra-diff-turn-next)",
      "[": "(fikra/diff/fikra-diff-turn-prev)",
    };
    for (const [k, want] of Object.entries(expected)) {
      const cmd = String(e(editor, `(hashmap-get (hashmap-get (editor/keymaps/buffer-keymap "*Fikra-Diff*") "bindings") "${k}")`).value);
      expect(cmd).toBe(want); // exact — swapped bindings fail (valve r1)
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
    // Drive render-parts END-TO-END (it renders into *Fikra-Diff*)
    // and assert on the BUFFER (the palette bytes must survive).
    const hdr = Buffer.from("\u001b[1;36mmy header\u001b[0m\n", "utf8").toString("hex");
    e(editor, `(condition-case nil (fikra/diff/fikra-diff-render-parts (hex-decode "${hdr}") (fikra/diff/fikra-diff-facelines "+added") "") (error (m) (concat "THREW:" m)))`);
    e(editor, '(buffer-switch "*Fikra-Diff*")');
    const txt = String(bufferText(editor));
    // gate r2: pin the PALETTE BYTES (the face-agnostic pin passed
    // under the re-face defect).
    expect(txt).toContain("\u001b[1;36mmy header"); // the summary's OWN face — not dimmed
    expect(txt).toContain("\u001b[32m+added"); // the patch faced
  });
});
describe("#313 valve r1", () => {
  test("join PRESERVES leading empty lines (valve r1's probe: '\\n+a' keeps the blank)", async () => {
    e(editor, "(require-module fikra/diff)");
    const r = e(editor, '(condition-case nil (fikra/diff/fikra-diff-facelines "\\n+a") (error (m) (concat "THREW:" m)))');
    const v = String(r.value);
    expect(v.startsWith("\n")).toBe(true); // the leading blank survives
    expect(v).toContain("+a");
  });
});
