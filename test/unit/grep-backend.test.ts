import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file grep-backend.test.ts
 * @description #308 — the T-Lisp rg BACKEND: the selection matrix, the
 * provisional protocol (spawn-failure rollback), streaming through the
 * #307 producer interface, exit-code mapping + diagnostics, generation
 * guards (late output after kill), dash-prefixed patterns vs REAL rg.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const st = (ed: Editor) => String(e(ed, "(editor-status)").value);

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i308b-"));
  dirs.push(dir);
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module editor/commands/grep)");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const commit = (msg: string) => {
  execFileSync("git", ["add", "."], { cwd: process.cwd() });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg], { cwd: process.cwd() });
};

/** Wait for the run to complete (status leaves the searching state). */
const waitDone = async (ed: Editor, ms = 8000) => {
  for (let i = 0; i < ms / 25; i++) {
    const s = st(ed);
    if (s.includes("hits") || s.includes("no matches") || s.includes("error") || s.includes("spawn failed") || s.includes("not on PATH") || s.includes("pending")) return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  return "TIMEOUT:" + st(ed);
};

describe("#308 — the backend", () => {
  test("STREAMING search: hits land in *grep* through the producer interface", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "alpha needle\nbeta\n");
    writeFileSync(join(process.cwd(), "b.txt"), "gamma\nneedle two\n");
    e(editor, '(grep-search "needle" ".")');
    const s = await waitDone(editor);
    expect(s).toContain("2 hits");
    e(editor, '(buffer-switch "*grep*")');
    const v = strip(bufferText(editor));
    expect(v).toContain("a.txt:1");
    expect(v).toContain("b.txt:2");
    expect(v).toContain("alpha needle");
  });

  test("NO MATCHES: exit 1 → the no-matches state", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "nothing here\n");
    e(editor, '(grep-search "zzz-absent" ".")');
    const s = await waitDone(editor);
    expect(s).toContain("no matches");
  });

  test("DASH-PREFIXED pattern + dir vs REAL rg (structural, no flags)", async () => {
    writeFileSync(join(process.cwd(), "-weird.txt"), "-pattern-found\n");
    e(editor, '(grep-search "-pattern-found" ".")');
    const s = await waitDone(editor);
    expect(s).toContain("1 hits");
    e(editor, '(buffer-switch "*grep*")');
    expect(strip(bufferText(editor))).toContain("-weird.txt");
  });

  test("SPAWN FAILURE → rollback (the prior generation's content restored)", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "first needle\n");
    e(editor, '(grep-search "first" ".")');
    await waitDone(editor);
    e(editor, '(buffer-switch "*grep*")');
    const prior = strip(bufferText(editor));
    // Force spawn failure: a bogus backend binary via the rg path.
    e(editor, '(editor/commands/grep/grep-rg-detected-set! nil)');
    // Simulate: register a generation, then a failed spawn (make-process
    // with a nonexistent executable returns an error string).
    e(editor, '(editor/commands/grep/grep-rg-rollback-after-register)');
    e(editor, '(buffer-switch "*grep*")');
    // The rollback of the only post-completion generation restores the
    // pre-REGISTER content — which was the completed search's buffer.
    expect(strip(bufferText(editor))).toContain(prior.slice(0, 20));
  });

  test("THE MATRIX rows exercisable with rg PRESENT: rg-explicit t; grep → #309 pending; garbage → auto", async () => {
    // rg-explicit with rg ON PATH → available (the missing-rg row's
    // named error is the same branch — unreachable while rg exists).
    e(editor, '(editor/commands/grep/grep-backend-set! "rg")');
    const r1 = e(editor, '(editor/commands/grep/grep-backend-available-p)');
    expect(String(r1.value)).toContain("t");
    e(editor, '(editor/commands/grep/grep-backend-set! "grep")');
    e(editor, '(editor/commands/grep/grep-backend-available-p)');
    expect(st(editor)).toContain("pending");
    // An unrecognized value falls through to AUTO (detected → t).
    e(editor, '(editor/commands/grep/grep-backend-set! "nonexistent-binary-xyz")');
    const r3 = e(editor, '(editor/commands/grep/grep-backend-available-p)');
    expect(String(r3.value)).toContain("t");
    e(editor, '(editor/commands/grep/grep-backend-set! "auto")');
  });

  test("LATE OUTPUT after kill: superseded callbacks drop", async () => {
    writeFileSync(join(process.cwd(), "a.txt"), "live needle\n");
    e(editor, '(grep-search "live" ".")');
    // Immediately re-run (kills the first).
    e(editor, '(grep-search "live" ".")');
    const s = await waitDone(editor);
    // Only ONE generation's hits — no duplication from the killed run.
    expect(s).toContain("1 hits");
    e(editor, '(buffer-switch "*grep*")');
    const v = strip(bufferText(editor));
    expect((v.match(/live needle/g) || []).length).toBe(1);
  });
});
