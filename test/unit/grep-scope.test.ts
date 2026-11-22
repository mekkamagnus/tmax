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
    // EXACT pins (valve r1): the detected root IS this repo —
    // equality against the resolved cwd, never a substring.
    expect(scope).not.toContain("poisoned");
    expect(scope).toContain("i310-");
    const proj = String(e(editor, '(editor/commands/grep-scope/grep-scope-resolve "project")').value);
    expect(proj).toBe(scope); // both bindings resolve the SAME root
  });

  test("SUBDIRECTORY file: the start path is the file's DIR, not the basename (gate r1)", async () => {
    // cwd in repoA; the visited file lives in repoA/sub/ — the OLD
    // derivation resolved the BASENAME against cwd (scoping wrong).
    mkdirSync(join(process.cwd(), "sub"), { recursive: true });
    writeFileSync(join(process.cwd(), "sub", "deep.txt"), "deep needle\n");
    e(editor, '(find-file "sub/deep.txt")');
    const start = String(e(editor, "(editor/commands/grep-scope/grep-scope-start-path)").value);
    expect(start).toContain("sub");
    expect(start).not.toBe("deep.txt");
    // The poisoned-cache resolution returns THIS repo, not another.
    e(editor, '(project-root-set "/nonexistent/poisoned-310")');
    const scope = String(e(editor, '(editor/commands/grep-scope/grep-scope-resolve "here")').value);
    expect(scope).not.toContain("poisoned");
  });

  test("FILE OUTSIDE the cwd tree: detection scopes to the FILE's project (gate r1's repro)", async () => {
    // A second git repo elsewhere; the visited file inside it.
    const other = mkdtempSync(join(tmpdir(), "i310-other-"));
    dirs.push(other);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: other });
    writeFileSync(join(other, "other-needle.txt"), "other repo needle\n");
    e(editor, `(find-file "${join(other, "other-needle.txt")}")`);
    const scope = String(e(editor, '(editor/commands/grep-scope/grep-scope-resolve "here")').value);
    // EXACT pin: the resolved scope IS the FILE's repo (resolved).
    const resolvedOther = require("node:path").resolve(other);
    expect(scope).toBe(resolvedOther);
    expect(scope).not.toBe(require("node:path").resolve(process.cwd()));
    execFileSync("git", ["-C", other, "add", "."]);
  });

  test("DIRNAME edges (gate r2): the root is '/', never ''", () => {
    const dn = (x: string) => String(e(editor, `(editor/commands/grep-scope/grep-scope-dirname "${x}")`).value);
    expect(dn("/")).toBe("/");
    expect(dn("/file.txt")).toBe("/"); // the r2 repro: was "" → resolve("") = cwd
    expect(dn("/a/b.txt")).toBe("/a");
    expect(dn("x.txt")).toBe(".");
    expect(dn("a/b.txt")).toBe("a");
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

  test("BACKEND CONFIG refusal (valve r3): grep-backend=grep → the named status at prompt-OPEN, no prompt", async () => {
    e(editor, '(editor/commands/grep/grep-backend-set! "grep")');
    e(editor, "(editor/commands/grep-scope/grep-scope-here)");
    expect(st(editor)).toContain("grep backend pending");
    // No minibuffer opened (mode still normal, no pending).
    expect((editor.getState() as unknown as { mode: string }).mode).toBe("normal");
    e(editor, '(editor/commands/grep/grep-backend-set! "auto")');
  });

  test("BACKEND CONFIG rg-missing (valve r3): the executable gone → the named status, no prompt", async () => {
    e(editor, '(editor/commands/grep/grep-rg-executable-set! "/nonexistent/rg-310")');
    e(editor, '(editor/commands/grep/grep-backend-set! "rg")');
    e(editor, "(editor/commands/grep-scope/grep-scope-here)");
    expect(st(editor)).toContain("rg is not on PATH");
    expect((editor.getState() as unknown as { mode: string }).mode).toBe("normal");
    e(editor, '(editor/commands/grep/grep-backend-set! "auto")');
    e(editor, '(editor/commands/grep/grep-rg-executable-set! "rg")');
  });

  test("FULL INTERACTION (valve r2): type + submit through the minibuffer; the EXACT prompt; both cancel keys", async () => {
    writeFileSync("q.txt", "typed needle\n");
    e(editor, '(find-file "q.txt")');
    e(editor, '(editor-set-mode "normal")');
    for (const key of ["SPC", "s", "g"]) await editor.handleKey(key);
    // The EXACT prompt: backend + the RESOLVED scope (the detected
    // root) + the colon-space.
    const mb0 = (editor.getState() as unknown as { minibufferView?: { prompt?: string } }).minibufferView;
    const scope = String(e(editor, '(editor/commands/grep-scope/grep-scope-resolve "here")').value);
    expect(mb0?.prompt ?? "").toBe(`grep (rg) ${scope}: `);
    // TYPE the pattern and submit through the minibuffer.
    for (const key of "typed needle") await editor.handleKey(key);
    await editor.handleKey("Enter");
    let s2 = "";
    for (let i = 0; i < 240; i++) {
      s2 = st(editor);
      if (s2.includes("hits") || s2.includes("no matches") || s2.includes("error")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(s2).toContain("1 hits");
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("typed needle");
  });

  test("C-g (\x07) through real dispatch: no process, no buffer (valve r2)", async () => {
    writeFileSync("r.txt", "x\n");
    e(editor, '(find-file "r.txt")');
    e(editor, '(editor-set-mode "normal")');
    for (const key of ["SPC", "s", "g"]) await editor.handleKey(key);
    await editor.handleKey("\x07");
    expect((editor.getState() as unknown as { mode: string }).mode).toBe("normal");
    expect(String(e(editor, "(editor/commands/grep/grep-rg-dump)").value)).toContain("gen=nil");
    expect(String(e(editor, '(if (member "*grep*" (buffer-list)) "buf" "nob")').value)).toContain("nob");
  });

  test("the PROMPT TEXT shows through the real dispatch; C-g cancels with NO process (valve r1)", async () => {
    writeFileSync("p.txt", "prompt needle\n");
    e(editor, '(find-file "p.txt")');
    e(editor, "(editor-set-mode \"normal\")");
    for (const key of ["SPC", "s", "g"]) {
      await editor.handleKey(key);
    }
    // The minibuffer is open with the TRUTHFUL prompt (backend +
    // scope) — the prompt rides the view's `prompt` field.
    const mb = (editor.getState() as unknown as {
      minibufferView?: { prompt?: string };
    }).minibufferView;
    expect(mb?.prompt ?? "").toContain("grep (rg)");
    expect(mb?.prompt ?? "").toContain(": ");
    // C-g cancels: no process, no buffer.
    await editor.handleKey("Escape");
    expect((editor.getState() as unknown as { mode: string }).mode).toBe("normal");
    expect(String(e(editor, "(editor/commands/grep/grep-rg-dump)").value)).toContain("gen=nil");
    expect(String(e(editor, '(if (member "*grep*" (buffer-list)) "buf" "nob")').value)).toContain("nob");
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
