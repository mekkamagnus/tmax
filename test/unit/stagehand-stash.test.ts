import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file stagehand-stash.test.ts
 * @description #292 — Stagehand T1: the stash popup. Creation (each
 * flag + combination, nothing-to-stash, the new ref shown), apply /
 * pop (clean + CONFLICTED — the stash retained), drop + cancelled
 * drop, empty-list + no-selection refusals, unusual-message parsing
 * (the subject VERBATIM after the first separator), and the
 * commit-ID-anchored identity revalidation.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const git = (...args: string[]) => execFileSync("git", args, { cwd: process.cwd() }).toString().trim();
const file = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const st = (ed: Editor) => String(e(ed, "(editor-status)").value);
const rows = (ed: Editor) => e(ed, "(stagehand/stash/stagehand-stash-rows-get)").value as unknown[];

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i292-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module stagehand/status)");
  e(editor, "(require-module stagehand/stash)");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const commit = (msg: string) => {
  execFileSync("git", ["add", "."], { cwd: process.cwd() });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg], { cwd: process.cwd() });
};
/** Open the status buffer, then the stash popup via Z. */
const openStash = () => {
  e(editor, "(stagehand/status/stagehand-status)");
  e(editor, "(stagehand/stash/stagehand-stash)");
  return strip(bufferText(editor));
};
/** Cursor to the row whose REF is displayed (by its ACTUAL rendered
 * line — gate r1: placing by a guessed offset encoded the
 * implementation's own wrong constant and masked the off-by-one). */
const toRow = (ref: string) => {
  const ls = strip(bufferText(editor)).split("\n");
  const i = ls.findIndex((l) => l.startsWith(ref + "  "));
  if (i < 0) throw new Error(`row ${ref} not displayed`);
  e(editor, `(cursor-move ${i} 0)`);
};

describe("#292 — creation (the z prefix)", () => {
  test("z z creates (plain): the worktree clean, the new ref shown", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    openStash();
    e(editor, "(stagehand/stash/stagehand-stash-z)"); // arm
    e(editor, "(stagehand/stash/stagehand-stash-z)"); // z z → create
    expect(st(editor)).toContain("stashed stash@{0}");
    expect(file("f.txt")).toBe("v1\n"); // the change stashed away
    expect(git("stash", "list")).toContain("stash@{0}");
  });

  test("z u includes UNTRACKED files", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "untracked.txt"), "u\n");
    openStash();
    e(editor, "(stagehand/stash/stagehand-stash-z)");
    e(editor, "(stagehand/stash/stagehand-stash-u)"); // z u
    e(editor, "(stagehand/stash/stagehand-stash-z)");
    e(editor, "(stagehand/stash/stagehand-stash-z)"); // z z
    expect(st(editor)).toContain("stashed stash@{0}");
    expect(git("stash", "show", "--include-untracked", "stash@{0}")).toContain("untracked.txt");
    expect(git("status", "--porcelain")).toBe(""); // swept
  });

  test("z k KEEPS the staged change in the index", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    writeFileSync(join(process.cwd(), "g.txt"), "base\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "STAGED\n");
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "g.txt"), "worktree\n");
    openStash();
    e(editor, "(stagehand/stash/stagehand-stash-z)");
    e(editor, "(stagehand/stash/stagehand-stash-k)"); // z k
    e(editor, "(stagehand/stash/stagehand-stash-z)");
    e(editor, "(stagehand/stash/stagehand-stash-z)"); // z z
    expect(st(editor)).toContain("stashed stash@{0}");
    // The staged change SURVIVES (keep-index); g.txt is stashed.
    expect(git("diff", "--cached")).toContain("STAGED");
    expect(git("status", "--porcelain")).not.toContain("g.txt");
  });

  test("z u + z k COMBINE", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "STAGED\n");
    execFileSync("git", ["add", "f.txt"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "untracked.txt"), "u\n");
    openStash();
    e(editor, "(stagehand/stash/stagehand-stash-z)");
    e(editor, "(stagehand/stash/stagehand-stash-u)"); // z u
    e(editor, "(stagehand/stash/stagehand-stash-z)");
    e(editor, "(stagehand/stash/stagehand-stash-k)"); // z k
    e(editor, "(stagehand/stash/stagehand-stash-z)");
    e(editor, "(stagehand/stash/stagehand-stash-z)"); // z z → create -u -k
    expect(st(editor)).toContain("stashed stash@{0}");
    expect(git("diff", "--cached")).toContain("STAGED");
    expect(git("status", "--porcelain")).not.toContain("untracked.txt");
  });

  test("NOTHING to stash: the status says so, no ref", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base"); // clean tree
    openStash();
    e(editor, "(stagehand/stash/stagehand-stash-z)");
    e(editor, "(stagehand/stash/stagehand-stash-z)");
    expect(st(editor)).toContain("nothing to stash");
    expect(git("stash", "list")).toBe("");
  });

  test("an EMPTY list keeps its 'no stashes' line across a toggle rerender (gate r2)", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base"); // no stashes
    openStash();
    expect(strip(bufferText(editor))).toContain("no stashes");
    e(editor, "(stagehand/stash/stagehand-stash-z)");
    e(editor, "(stagehand/stash/stagehand-stash-u)");
    expect(strip(bufferText(editor))).toContain("no stashes");
  });

  test("KEY-DRIVEN: the keymap dispatches the z-prefix create (z u then z z via handleKey)", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "untracked.txt"), "u\n");
    openStash();
    await editor.handleKey("z");
    await editor.handleKey("u"); // z u via the REAL keymap
    await editor.handleKey("z");
    await editor.handleKey("z"); // z z
    expect(st(editor)).toContain("stashed stash@{0}");
    expect(git("status", "--porcelain")).not.toContain("untracked.txt");
  });

  test("KEY-DRIVEN: a bare Enter (the n-first default) cancels the drop via the real confirm", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    git("stash");
    openStash();
    toRow("stash@{0}");
    await editor.handleKey("D");
    await editor.handleKey("Enter"); // the n-first default cancels
    expect(st(editor)).toContain("cancelled");
    expect(git("stash", "list")).toContain("stash@{0}");
  });

  test("the toggle state RESETS on reopen; the header shows it", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    openStash();
    e(editor, "(stagehand/stash/stagehand-stash-z)");
    e(editor, "(stagehand/stash/stagehand-stash-u)");
    expect(strip(bufferText(editor))).toContain("[u]ntracked ON");
    expect(Boolean(e(editor, "(stagehand/stash/stagehand-stash-toggle-u-get)").value)).toBe(true);
    openStash(); // reopen: toggles reset
    expect(Boolean(e(editor, "(stagehand/stash/stagehand-stash-toggle-u-get)").value)).toBe(false);
    expect(strip(bufferText(editor))).toContain("[u]ntracked off");
  });
});

describe("#292 — apply / pop / drop", () => {
  test("a APPLIES: the worktree restored, the stash RETAINED", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "STASHED\n");
    git("stash");
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    openStash();
    toRow("stash@{0}");
    e(editor, "(stagehand/stash/stagehand-stash-apply)");
    e(editor, '(stagehand/stash/stagehand-stash-accept "y")');
    expect(st(editor)).toContain("stash apply stash@{0} done");
    expect(file("f.txt")).toBe("STASHED\n");
    expect(git("stash", "list")).toContain("stash@{0}"); // retained
  });

  test("p POPS clean: applied AND removed from the list", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "STASHED\n");
    git("stash");
    openStash();
    toRow("stash@{0}");
    e(editor, "(stagehand/stash/stagehand-stash-pop)");
    e(editor, '(stagehand/stash/stagehand-stash-accept "y")');
    expect(st(editor)).toContain("stash pop stash@{0} done");
    expect(file("f.txt")).toBe("STASHED\n");
    expect(git("stash", "list")).toBe("");
  });

  test("a CONFLICTED pop/apply names the exit + stderr + the resolve hint; the stash RETAINED", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\nv2\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "STASHED\nv2\n");
    git("stash");
    // Diverge the same line — the apply must conflict.
    writeFileSync(join(process.cwd(), "f.txt"), "CONFLICTING\nv2\n");
    openStash();
    toRow("stash@{0}");
    e(editor, "(stagehand/stash/stagehand-stash-pop)");
    e(editor, '(stagehand/stash/stagehand-stash-accept "y")');
    const s = st(editor);
    expect(s).toContain("stash pop failed");
    expect(s).toMatch(/failed \(\d+\)/);
    expect(s).toContain("resolve in the worktree");
    // git semantics surfaced: a conflicted pop does NOT drop.
    expect(git("stash", "list")).toContain("stash@{0}");
  });

  test("D DROPS behind the y/n (the ref echoed in the prompt)", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    git("stash");
    openStash();
    toRow("stash@{0}");
    e(editor, "(stagehand/stash/stagehand-stash-drop)");
    e(editor, '(stagehand/stash/stagehand-stash-accept "y")');
    expect(st(editor)).toContain("stash drop stash@{0} done");
    expect(git("stash", "list")).toBe("");
  });

  test("a BARE ENTER (the n-first default, delivered as n) cancels the drop", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    git("stash");
    openStash();
    toRow("stash@{0}");
    e(editor, "(stagehand/stash/stagehand-stash-drop)");
    e(editor, '(stagehand/stash/stagehand-stash-accept "n")');
    expect(st(editor)).toContain("cancelled");
    expect(git("stash", "list")).toContain("stash@{0}");
  });
});

describe("#292 — refusals + parsing", () => {
  test("EMPTY list renders 'no stashes'; actions no-op", () => {
    const view = openStash();
    expect(view).toContain("no stashes");
    e(editor, "(stagehand/stash/stagehand-stash-apply)");
    expect(st(editor)).toContain("no stashes");
    e(editor, "(stagehand/stash/stagehand-stash-drop)");
    expect(st(editor)).toContain("no stashes");
  });

  test("NO SELECTION (cursor on the header) → 'no stash selected'", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    git("stash");
    openStash();
    e(editor, "(cursor-move 0 0)"); // the header line
    e(editor, "(stagehand/stash/stagehand-stash-apply)");
    expect(st(editor)).toContain("no stash selected");
    expect(git("stash", "list")).toContain("stash@{0}");
  });

  test("UNUSUAL MESSAGES: embedded separator + unicode — the subject VERBATIM", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    const sep = String.fromCharCode(0x1f);
    const msg = `unit${sep}sep and ünïcødé ✓ trailing`;
    execFileSync("git", ["stash", "push", "-m", msg], { cwd: process.cwd() });
    openStash();
    // rows-get: ((ref id subject) ...) — the subject keeps
    // EVERYTHING after the field separators verbatim.
    const n = String(e(editor, "(length (stagehand/stash/stagehand-stash-rows-get))").value);
    expect(n).toBe("1");
    expect(String(e(editor, "(nth 0 (nth 0 (stagehand/stash/stagehand-stash-rows-get)))").value)).toBe("stash@{0}");
    // git prefixes "On <branch>: " to custom subjects; the subject
    // is verbatim after the two FIELD separators (the embedded
    // separator + unicode + trailing content all ride through).
    expect(String(e(editor, "(nth 2 (nth 0 (stagehand/stash/stagehand-stash-rows-get)))").value)).toBe(`On main: ${msg}`);
    expect(strip(bufferText(editor))).toContain(msg);
  });

  test("IDENTITY REVALIDATION (SHIFTED-PRESENT): a ref now resolving to a DIFFERENT commit refuses", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "A\n");
    execFileSync("git", ["stash", "push", "-m", "A"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "f.txt"), "B\n");
    execFileSync("git", ["stash", "push", "-m", "B"], { cwd: process.cwd() });
    openStash(); // rendered [stash@{0}=B, stash@{1}=A]
    toRow("stash@{1}"); // recorded (stash@{1}, A's id)
    // Push a NEW stash externally: every ref shifts — stash@{1} now
    // resolves to B's id (PRESENT but ≠ the recorded A).
    writeFileSync(join(process.cwd(), "f.txt"), "C\n");
    execFileSync("git", ["stash", "push", "-m", "C"], { cwd: process.cwd() });
    e(editor, "(stagehand/stash/stagehand-stash-drop)");
    expect(st(editor)).toContain("stash list changed — reselect");
    // NOTHING dropped: all three stashes survive.
    expect(git("stash", "list")).toContain("A");
    expect(git("stash", "list")).toContain("B");
    expect(git("stash", "list")).toContain("C");
  });

  test("the STALE-CONFIRM window: a shift between confirm-open and y refuses at the MUTATION point", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "A\n");
    execFileSync("git", ["stash", "push", "-m", "A"], { cwd: process.cwd() });
    openStash();
    toRow("stash@{0}"); // the confirm opens against (stash@{0}, A)
    e(editor, "(stagehand/stash/stagehand-stash-drop)");
    // A NEW stash lands BEFORE the y — refs shift.
    writeFileSync(join(process.cwd(), "f.txt"), "NEW\n");
    execFileSync("git", ["stash", "push", "-m", "NEW"], { cwd: process.cwd() });
    e(editor, '(stagehand/stash/stagehand-stash-accept "y")');
    expect(st(editor)).toContain("stash list changed — reselect");
    // The NEW, never-confirmed stash SURVIVES (gate r1's repro had
    // it destroyed with a 'done' status).
    expect(git("stash", "list")).toContain("NEW");
    expect(git("stash", "list")).toContain("A");
  });

  test("IDENTITY REVALIDATION: a gone ref refuses with 'reselect'", () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "A\n");
    execFileSync("git", ["stash", "push", "-m", "A"], { cwd: process.cwd() });
    writeFileSync(join(process.cwd(), "f.txt"), "B\n");
    execFileSync("git", ["stash", "push", "-m", "B"], { cwd: process.cwd() });
    openStash();
    toRow("stash@{1}"); // stash@{1} = A's recorded (ref id)
    // Drop stash@{0} EXTERNALLY — every ref shifts by one.
    execFileSync("git", ["stash", "drop", "stash@{0}"], { cwd: process.cwd() });
    e(editor, "(stagehand/stash/stagehand-stash-drop)");
    // The refusal fires BEFORE any confirm opens — no accept call.
    expect(st(editor)).toContain("stash list changed — reselect");
    expect(git("stash", "list")).toContain("stash@{0}"); // B untouched
    // The list RE-RENDERED: the row now reflects the shifted truth.
    expect(String(e(editor, "(length (stagehand/stash/stagehand-stash-rows-get))").value)).toBe("1");
    // B (the dropped stash@{0}) is GONE; the survivor A now holds
    // stash@{0} — the re-render reflects the shifted truth.
    expect(String(e(editor, "(nth 2 (nth 0 (stagehand/stash/stagehand-stash-rows-get)))").value)).toContain("A");
  });
});

describe("#292 — valve r2", () => {
  test("an INTERRUPTED prefix never creates: z, g, z re-arms (key-driven)", async () => {
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("base");
    writeFileSync(join(process.cwd(), "f.txt"), "v2\n");
    openStash();
    await editor.handleKey("z"); // arm
    await editor.handleKey("g"); // refresh — CONSUMES the prefix
    expect(st(editor)).toContain("refreshed"); // g really dispatched
    await editor.handleKey("z"); // re-arm, NOT a create
    expect(git("stash", "list")).toBe(""); // nothing created
    // A consecutive z z still creates.
    await editor.handleKey("z");
    await editor.handleKey("z");
    expect(st(editor)).toContain("stashed stash@{0}");
  });
});
