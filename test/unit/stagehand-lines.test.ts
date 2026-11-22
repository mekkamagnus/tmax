import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file stagehand-lines.test.ts
 * @description #331 — selected-line staging: the PARTIAL-PATCH
 * constructor (header arithmetic + the '-'→context conversion rule)
 * round-tripped against REAL git (`git apply --cached` on the built
 * patch, asserted on actual index + worktree contents), the
 * no-newline matrix, whole-hunk equivalence, and the view-line
 * flag mapping.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const git = (...args: string[]) => execFileSync("git", args, { cwd: process.cwd() }).toString().trim();
const file = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i331-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module stagehand/status)");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const commit = (msg: string) => {
  execFileSync("git", ["add", "."], { cwd: process.cwd() });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg], { cwd: process.cwd() });
};

const openDiff = (path: string) => {
  e(editor, "(stagehand/status/stagehand-status)");
  const lines = strip(bufferText(editor)).split("\n");
  const row = lines.findIndex((l) => l.includes(path));
  e(editor, `(cursor-move ${row} 0)`);
  e(editor, "(stagehand/status/stagehand-status-diff)");
};

/** Build hunk 0's partial patch with FLAGS and apply it --cached. */
const applyPartial = (flags: string) => {
  const patch = String(e(editor, `(stagehand/diff/stagehand-diff-partial-patch 0 (list ${flags}))`).value);
  if (patch === "null" || patch === "nil") return null;
  execFileSync("git", ["apply", "--cached", "-"], { cwd: process.cwd(), input: patch + "\n" });
  return patch;
};

describe("#331 — partial-patch construction (round-trips vs REAL git)", () => {
  test("INTERIOR drop: only the SELECTED change reaches the index (the conversion rule)", () => {
    // One hunk, three separate changes (b→B, c→C, e→E) bridged by
    // context. Select ONLY b→B: dropping c→C and e→E must CONVERT
    // their '-' lines to context (dropping them outright mismatches
    // the surrounding context — the classic pitfall).
    writeFileSync(join(process.cwd(), "f.txt"), "a\nb\nc\nd\ne\nf\ng\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "a\nB\nC\nd\nE\nf\ng\n");
    openDiff("f.txt");
    // Body: " a" "-b" "+B" "-c" "+C" " d" "-e" "+E" " f" " g"
    // Flags: keep only the b→B change (lines 1,2).
    const patch = applyPartial("nil t nil t nil nil nil nil nil nil");
    expect(patch).toBeTruthy();
    expect(patch).toContain("-b");
    expect(patch).toContain("+B");
    expect(patch).not.toContain("+C");
    expect(patch).not.toContain("+E");
    expect(patch).toContain(" c"); // converted context
    expect(patch).toContain(" e"); // converted context
    expect(patch).toMatch(/@@ -1,7 \+1,7 @@/); // counts preserved
    // The INDEX holds exactly the selected change; the worktree is
    // untouched (still all three).
    expect(git("show", ":f.txt")).toBe("a\nB\nc\nd\ne\nf\ng"); // git() trims
    expect(file("f.txt")).toBe("a\nB\nC\nd\nE\nf\ng\n");
  });

  test("the mirrored side: partial UNSTAGE removes only the selected change from the index", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "a\nb\nc\nd\ne\nf\ng\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "a\nB\nC\nd\nE\nf\ng\n");
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    // Cached view (Staged section row).
    openDiff("f.txt");
    // Select only e→E for unstage (body lines 6,7).
    const patch = String(e(editor, "(stagehand/diff/stagehand-diff-partial-patch-cached 0 (list nil nil nil nil nil nil t t nil nil))").value);
    expect(patch).toBeTruthy();
    execFileSync("git", ["apply", "--cached", "-"], { cwd: process.cwd(), input: patch + "\n" }); // cached variant: NO -R
    // The index now holds b→B and c→C but NOT e→E.
    expect(git("show", ":f.txt")).toBe("a\nB\nC\nd\ne\nf\ng"); // git() trims
  });

  test("LEADING dropped '+': the new start shifts (pure-insertion head subset)", () => {
    // A file-start insertion block: @@ -0,0 +1,3 @@ with three '+'
    // lines. Select only the last two — the first dropped insertion
    // must shift the new start by one.
    writeFileSync(join(process.cwd(), "base.txt"), "x\n");
    commit("base");
    writeFileSync(join(process.cwd(), "new.txt"), "A1\nA2\nA3\n");
    execFileSync("git", ["add", "-N", "new.txt"], { cwd: process.cwd() });
    openDiff("new.txt");
    const patch = applyPartial("nil t t");
    expect(patch).toBeTruthy();
    expect(patch).toMatch(/@@ -0,0 \+2,2 @@/);
    expect(git("show", ":new.txt")).toBe("A2\nA3"); // git() trims
  });

  test("WHOLE-HUNK equivalence: all-flags output applies the identical index", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "a\nb\nc\nd\ne\nf\ng\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "a\nB\nC\nd\nE\nf\ng\n");
    openDiff("f.txt");
    applyPartial("t t t t t t t t t t");
    expect(git("show", ":f.txt")).toBe("a\nB\nC\nd\nE\nf\ng"); // git() trims
    expect(file("f.txt")).toBe("a\nB\nC\nd\nE\nf\ng\n");
  });

  test("NOTHING selected refuses with the named reason (nothing applied)", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "a\nb\nc\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "a\nB\nc\n");
    openDiff("f.txt");
    const r = e(editor, "(stagehand/diff/stagehand-diff-partial-patch 0 (list nil nil nil nil))");
    expect(String(r.value)).toContain("null"); // nil prints as null
    expect(String(e(editor, "(stagehand/diff/stagehand-diff-partial-refusal-get)").value)).toContain("nothing selected");
    expect(git("diff", "--cached")).toBe(""); // nothing applied
  });

  test("NO-NEWLINE matrix: selected → round-trips; dropped → refusal", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "a\nb");
    commit("base"); // no trailing newline in HEAD
    writeFileSync(join(process.cwd(), "f.txt"), "a\nB"); // still none
    openDiff("f.txt");
    // Body: " a" "-b" "+B" "\ No newline at end of file" (the
    // marker follows +B; both sides no-newline). Drop the b→B
    // change → the marker's line is dropped → REFUSE.
    const r = e(editor, "(stagehand/diff/stagehand-diff-partial-patch 0 (list nil nil nil nil))");
    expect(String(r.value)).toContain("null"); // nil prints as null
    expect(String(e(editor, "(stagehand/diff/stagehand-diff-partial-refusal-get)").value)).toContain("no-newline");
    // Selected → applies.
    const patch = applyPartial("t t t t");
    expect(patch).toContain(hexBs());
    expect(git("show", ":f.txt")).toBe("a\nB"); // git() trims
  });

  test("the heading TAIL survives the rebuild (real C function context)", () => {
    // git's C funcname heuristic emits "@@ ... @@ int main(void)" —
    // the rebuild must carry the tail verbatim.
    writeFileSync(join(process.cwd(), ".gitattributes"), "*.c diff=cpp\n");
    // The change sits BELOW the function head (a hunk starting at
    // line 1 has no line above it to name — no tail is emitted).
    writeFileSync(join(process.cwd(), "f.c"),
      "int main(void)\n{\n  p1;\n  p2;\n  p3;\n  p4;\n  a;\n  q1;\n  q2;\n  q3;\n}\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.c"),
      "int main(void)\n{\n  p1;\n  p2;\n  p3;\n  p4;\n  b;\n  q1;\n  q2;\n  q3;\n}\n");
    openDiff("f.c");
    const patch = applyPartial("t t t t t t t t t t");
    expect(patch).toContain("@@ int main(void)");
    expect(git("show", ":f.c")).toContain("b;");
  });

});

describe("#331 — the view-line flag mapping", () => {
  test("flags-for-lines maps view rows to body positions", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "a\nb\nc\nd\ne\nf\ng\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "a\nB\nC\nd\nE\nf\ng\n");
    openDiff("f.txt");
    // Hunk 0's header view line:
    const hdr = Number(e(editor, "(nth 0 (stagehand/diff/stagehand-diff-hunk-lines))").value);
    // Select view rows hdr+1..hdr+2 (the b→B change).
    const at = (k: number) => String(e(editor, `(if (nth ${k} (stagehand/diff/stagehand-diff-flags-for-lines 0 ${hdr + 1} ${hdr + 2})) "t" "nil")`).value);
    expect(at(0)).toBe("t"); // body0 = view hdr+1 (selected)
    expect(at(1)).toBe("t");
    expect(at(2)).toBe("nil");
    expect(at(9)).toBe("nil");
  });
});

/** The literal "\ No newline" prefix (reader-safe via Buffer). */
function hexBs(): string {
  return "\\ No newline";
}
