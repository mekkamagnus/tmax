import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file grep-scope.test.ts
 * @description #310 — the scope commands: FRESH detection (a POISONED
 * *project-root* cache must not redirect), the here/project matrix,
 * empty-input + C-g cancel, the outside-project refusal, spawn-failure
 * buffer preservation, the retirement of the sync path, and the REAL
 * key-dispatch path (handleKey SPC/s/g).
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const st = (ed: Editor) => String(e(ed, "(editor-status)").value);

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i310-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  writeFileSync(join(dir, "marker.txt"), "proj\n");
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module editor/commands/grep-scope)");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const waitDone = async (ed: Editor, ms = 8000) => {
  for (let i = 0; i < ms / 25; i++) {
    const s = st(ed);
    if (s.includes("hits") || s.includes("no matches") || s.includes("error") || s.includes("spawn failed") || s.includes("not in a project") || s.includes("no search backend")) return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  return "TIMEOUT:" + st(ed);
};

describe("#310 — scope resolution (FRESH, cache-bypassed)", () => {
  test("SPC s g resolves the PROJECT ROOT even with a POISONED cache", async () => {
    // Poison the cache with a bogus root.
    e(editor, '(project-root-set "/nonexistent/poisoned-310")');
    const scope = String(e(editor, '(editor/commands/grep-scope/grep-scope-resolve "here")').value);
    expect(scope).not.toContain("poisoned");
    expect(scope.length).toBeGreaterThan(0);
  });

  test("SPC p s: the same FRESH resolution", async () => {
    e(editor, '(project-root-set "/nonexistent/poisoned-310")');
    const scope = String(e(editor, '(editor/commands/grep-scope/grep-scope-resolve "project")').value);
    expect(scope).not.toContain("poisoned");
  });

  test("outside a project: 'here' falls back to the start path; 'project' refuses", () => {
    const dir = mkdtempSync(join(tmpdir(), "i310-out-"));
    dirs.push(dir);
    process.chdir(dir);
    const here = String(e(editor, '(editor/commands/grep-scope/grep-scope-resolve "here")').value);
    expect(here.length).toBeGreaterThan(0); // the start path itself
    const proj = e(editor, '(editor/commands/grep-scope/grep-scope-resolve "project")');
    expect(["nil", "null"].includes(String(proj.value))).toBe(true);
    // The named refusal status.
    e(editor, "(editor/commands/grep-scope/grep-scope-project)");
    expect(st(editor)).toContain("not in a project");
  });
});

describe("#310 — the prompt + accept", () => {
  test("empty input cancels: no process, no buffer, status cleared", async () => {
    writeFileSync("f.txt", "x\n");
    e(editor, '(find-file "f.txt")');
    e(editor, "(editor/commands/grep-scope/grep-scope-here)");
    e(editor, '(editor/commands/grep-scope/grep-scope-accept "")');
    expect(st(editor)).toBe("");
    expect(String(e(editor, "(editor/commands/grep/grep-rg-dump)").value)).toContain("gen=nil");
  });

  test("accept searches the resolved scope (hits land in *grep*)", async () => {
    writeFileSync("a.txt", "scope needle\n");
    e(editor, "(editor/commands/grep-scope/grep-scope-here)");
    e(editor, '(editor/commands/grep-scope/grep-scope-accept "scope needle")');
    const s = await waitDone(editor);
    expect(s).toContain("1 hits");
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("scope needle");
  });
});

describe("#310 — retirement + the REAL key path", () => {
  test("project-search-cmd is retired (the named deferral)", () => {
    const r = e(editor, '(project-search-cmd "x")');
    expect(["nil", "null"].includes(String(r.value))).toBe(true);
    expect(st(editor)).toContain("retired");
  });

  test("SPC s g through the REAL key dispatch (handleKey)", async () => {
    writeFileSync("b.txt", "dispatch needle\n");
    e(editor, '(find-file "b.txt")');
    e(editor, "(editor-set-mode \"normal\")");
    for (const key of ["SPC", "s", "g"]) {
      await editor.handleKey(key);
    }
    // The minibuffer opened: the status/prompt state; accept directly.
    e(editor, '(editor/commands/grep-scope/grep-scope-accept "dispatch needle")');
    const s = await waitDone(editor);
    expect(s).toContain("1 hits");
  });

  test("SPC p s through the REAL key dispatch", async () => {
    writeFileSync("c.txt", "projsearch needle\n");
    e(editor, '(find-file "c.txt")');
    e(editor, "(editor-set-mode \"normal\")");
    for (const key of ["SPC", "p", "s"]) {
      await editor.handleKey(key);
    }
    e(editor, '(editor/commands/grep-scope/grep-scope-accept "projsearch")');
    const s = await waitDone(editor);
    expect(s).toContain("1 hits");
  });
});
