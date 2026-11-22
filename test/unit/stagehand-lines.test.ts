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

  test("LEADING dropped '-' converts to context in place (the old start never moves)", () => {
    // A hunk whose body BEGINS with deletions (change at the top of
    // the context window): dropping the FIRST '-' converts it to
    // context AT its old position — the @@ old start stays put.
    writeFileSync(join(process.cwd(), "f.txt"), "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\n");
    commit("base");
    // Changes at the very top (lines 1-2) and lower (line 8): the
    // first hunk starts with '-' lines.
    writeFileSync(join(process.cwd(), "f.txt"), "A\nB\nc\nd\ne\nf\ng\nH\ni\nj\nk\nl\nm\n");
    openDiff("f.txt");
    // ONE hunk (the clusters merged): body "-a","-b","+A","+B",
    // " c".." g","-h","+H"," i".." k". Select ONLY body k=1,3 (the
    // b→B pair); the leading "-a" converts IN PLACE.
    const patch = applyPartial("nil t nil t nil nil nil nil nil nil nil nil nil nil");
    expect(patch).toBeTruthy();
    expect(patch).toMatch(/@@ -1,11 \+1,11 @@/); // old start UNMOVED
    expect(git("show", ":f.txt")).toBe("a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm"); // only b→B
  });

  test("COALESCED replacement matrix (valve r1): EACH slot unstages to the correct order (byte-exact)", () => {
    // The block '-b -c +B +C' = two replacement slots. Unstaging
    // c→C must leave B BEFORE c (the raw stream order yields c,B —
    // the valve's reproduced misordering).
    writeFileSync(join(process.cwd(), "f.txt"), "a\nb\nc\nd\ne\nf\ng\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "a\nB\nC\nd\ne\nf\ng\n");
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    openDiff("f.txt");
    // Swapped+slot-paired body: " a","-B","+b","-C","+c"," d"...
    // Select c→C = keep body k=3,4 ("-C","+c").
    let patch = String(e(editor, "(stagehand/diff/stagehand-diff-partial-patch-cached 0 (list nil nil t nil t nil nil nil nil nil))").value);
    expect(patch).toBeTruthy();
    execFileSync("git", ["apply", "--cached", "-"], { cwd: process.cwd(), input: patch + "\n" });
    expect(new TextDecoder().decode(execFileSync("git", ["show", ":f.txt"], { cwd: process.cwd() })))
      .toBe("a\nB\nc\nd\ne\nf\ng\n"); // B before c
    // The OTHER slot: reset the index to all-staged, unstage b→B.
    execFileSync("git", ["restore", "--staged", "f.txt"], { cwd: process.cwd() });
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    // Select b→B = keep body k=1,2 ("-B","+b").
    patch = String(e(editor, "(stagehand/diff/stagehand-diff-partial-patch-cached 0 (list nil t nil t nil nil nil nil nil nil))").value);
    expect(patch).toBeTruthy();
    execFileSync("git", ["apply", "--cached", "-"], { cwd: process.cwd(), input: patch + "\n" });
    expect(new TextDecoder().decode(execFileSync("git", ["show", ":f.txt"], { cwd: process.cwd() })))
      .toBe("a\nb\nC\nd\ne\nf\ng\n"); // b before C
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
    // BYTE-exact (no trim): the index ends 'B' with NO trailing
    // newline — the property this feature exists to protect.
    const bytes = execFileSync("git", ["show", ":f.txt"], { cwd: process.cwd() });
    expect(new TextDecoder().decode(bytes)).toBe("a\nB");
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

/** The literal no-newline marker line (plain TS — no reader involved). */
function hexBs(): string {
  return "\\ No newline";
}

/** Wait for the async apply sentinel. */
const waitApply = async (ed: Editor, ms = 6000) => {
  for (let i = 0; i < ms / 25; i++) {
    const st = String(e(ed, "(editor-status)").value);
    if (st.includes("hunk applied") || st.includes("apply failed") || st.includes("refused") || st.includes("stay selected") || st.includes("nothing selected") || st.includes("no-newline")) return st;
    await new Promise((r) => setTimeout(r, 25));
  }
  return "TIMEOUT:" + String(e(ed, "(editor-status)").value);
};

describe("#331 — the mark-based selection UI (end-to-end)", () => {
  test("m + s: only the mark..cursor lines reach the index; the mark clears", async () => {
    // Changes SEPARATED by context (b→B, e→E — NOT coalesced): a
    // contiguous mark..cursor range selects exactly one change's
    // rows. (Coalesced adjacent changes are inherently un selectable
    // by a contiguous range — the same constraint git add -p solves
    // with hunk splitting.)
    writeFileSync(join(process.cwd(), "f.txt"), "a\nb\nc\nd\ne\nf\ng\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "a\nB\nc\nd\nE\nf\ng\n");
    openDiff("f.txt");
    const hdr = Number(e(editor, "(nth 0 (stagehand/diff/stagehand-diff-hunk-lines))").value);
    // Body: " a","-b","+B"," c"," d","-e","+E"," f"," g" — "-b"/"+B"
    // are body k=1,2 → view hdr+2..hdr+3.
    e(editor, `(cursor-move ${hdr + 2} 0)`);        // "-b"
    e(editor, "(stagehand/diff/stagehand-diff-toggle-mark)");
    e(editor, `(cursor-move ${hdr + 3} 0)`);        // "+B"
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied");
    expect(git("show", ":f.txt")).toBe("a\nB\nc\nd\ne\nf\ng"); // only b→B
    expect(file("f.txt")).toBe("a\nB\nc\nd\nE\nf\ng\n");      // worktree intact
    expect(String(e(editor, "(stagehand/diff/stagehand-diff-mark-get)").value)).toContain("null"); // cleared
  });

  test("m + u (cached view): only the selected lines leave the index", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "a\nb\nc\nd\ne\nf\ng\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "a\nB\nC\nd\nE\nf\ng\n");
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    openDiff("f.txt");
    const hdr = Number(e(editor, "(nth 0 (stagehand/diff/stagehand-diff-hunk-lines))").value);
    e(editor, `(cursor-move ${hdr + 7} 0)`);        // "-e" (body k=6)
    e(editor, "(stagehand/diff/stagehand-diff-toggle-mark)");
    e(editor, `(cursor-move ${hdr + 8} 0)`);        // "+E" (body k=7)
    e(editor, "(stagehand/diff/stagehand-diff-unstage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied");
    expect(git("show", ":f.txt")).toBe("a\nB\nC\nd\ne\nf\ng"); // e→E unstaged only
  });

  test("a mark OUTSIDE the cursor's hunk falls back to whole-hunk", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "a\nb\nc\nd\ne\nf\ng\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "a\nB\nc\nd\ne\nf\ng\n");
    openDiff("f.txt");
    // Mark on the FILE HEADER line (outside any hunk), cursor in the hunk.
    e(editor, "(cursor-move 0 0)");
    e(editor, "(stagehand/diff/stagehand-diff-toggle-mark)");
    e(editor, "(cursor-move 6 0)");
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("hunk applied");
    expect(git("show", ":f.txt")).toBe("a\nB\nc\nd\ne\nf\ng"); // the WHOLE hunk
  });

  test("REGRESSION (gate probe): kept '+' jumping over held context REFUSES (marker re-attachment corruption)", async () => {
    // old 'x\n' → new 'B' (no trailing newline): body '-x','+B',
    // marker. Keeping ONLY '+B' would flush the converted ' x'
    // between +B and its marker — the marker re-attached to x and
    // the index silently became 'B\nx' with x's newline EATEN.
    // Must refuse by name; nothing applied.
    writeFileSync(join(process.cwd(), "f.txt"), "x\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "B");
    openDiff("f.txt");
    const hdr = Number(e(editor, "(nth 0 (stagehand/diff/stagehand-diff-hunk-lines))").value);
    e(editor, `(cursor-move ${hdr + 2} 0)`); // "+B"
    e(editor, "(stagehand/diff/stagehand-diff-toggle-mark)");
    e(editor, `(cursor-move ${hdr + 2} 0)`);
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("no-newline");
    expect(git("diff", "--cached")).toBe("");
  });

  test("REGRESSION (r2): the mark RESETS on the EMPTY refresh too", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "a\nb\nc\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "a\nB\nc\n");
    openDiff("f.txt");
    const hdr = Number(e(editor, "(nth 0 (stagehand/diff/stagehand-diff-hunk-lines))").value);
    e(editor, `(cursor-move ${hdr + 1} 0)`);
    e(editor, "(stagehand/diff/stagehand-diff-toggle-mark)");
    // Stage the whole file change, then refresh → the side empties.
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    e(editor, "(stagehand/diff/stagehand-diff-refresh-view)");
    expect(String(e(editor, "(stagehand/diff/stagehand-diff-mark-get)").value)).toContain("null");
    expect(strip(bufferText(editor))).toContain("no changes on this side");
  });

  test("REGRESSION (gate probe): the mark RESETS on refresh (stale-mark misselection)", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "a\nb\nc\nd\ne\nf\ng\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "a\nB\nc\nd\ne\nf\ng\n");
    openDiff("f.txt");
    const hdr = Number(e(editor, "(nth 0 (stagehand/diff/stagehand-diff-hunk-lines))").value);
    e(editor, `(cursor-move ${hdr + 1} 0)`);
    e(editor, "(stagehand/diff/stagehand-diff-toggle-mark)");
    expect(String(e(editor, "(stagehand/diff/stagehand-diff-mark-get)").value)).not.toContain("null");
    e(editor, "(stagehand/diff/stagehand-diff-refresh-view)");
    expect(String(e(editor, "(stagehand/diff/stagehand-diff-mark-get)").value)).toContain("null");
  });

  test("selecting around a no-newline final line refuses through the UI", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "a\nb");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "a\nB");
    openDiff("f.txt");
    const hdr = Number(e(editor, "(nth 0 (stagehand/diff/stagehand-diff-hunk-lines))").value);
    // Mark+cursor on the CONTEXT " a" only — the b→B change (with
    // its marker) is excluded → refusal, nothing applied.
    e(editor, `(cursor-move ${hdr + 1} 0)`);
    e(editor, "(stagehand/diff/stagehand-diff-toggle-mark)");
    e(editor, `(cursor-move ${hdr + 1} 0)`);
    e(editor, "(stagehand/diff/stagehand-diff-stage-hunk)");
    const st = await waitApply(editor);
    expect(st).toContain("no-newline");
    expect(git("diff", "--cached")).toBe("");
  });
});
