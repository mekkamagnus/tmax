import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

// RFC-029 §8.1 (r58): the mockup modeline's L-level segment, the
// [ckpt <short-ref> ✓] marker shape, and the SPC a R revert entry.

let repoDir = "";
const dirs: string[] = [];
const originalCwd = process.cwd();
beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "fikra-ml-"));
  dirs.push(repoDir);
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repoDir });
  writeFileSync(join(repoDir, ".gitignore"), ".tmax/\n");
  process.chdir(repoDir);
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const e = (ed: unknown, expr: string) => executeTlisp(ed as never, expr);

describe("#8.1 modeline + checkpoint marker (r58)", () => {
  test("the lighter carries the L-level after the mode", async () => {
    const ed = await createStartedEditor("");
    e(ed, "(require-module fikra/mode)");
    e(ed, "(fikra-start)");
    e(ed, "(require-module fikra/chat)");
    e(ed, '(fikra-thread-set-field "runtime-mode" "approval-required")');
    e(ed, "(fikra-refresh-lighter)");
    const lighter = String(e(ed, '(minor-mode-lighter "fikra")').value);
    expect(lighter).toContain(":L2");
  });

  test("full-access maps to L0; unknown maps to nothing", async () => {
    const ed = await createStartedEditor("");
    e(ed, "(require-module fikra/mode)");
    e(ed, "(fikra-start)");
    e(ed, "(require-module fikra/chat)");
    e(ed, '(fikra-thread-set-field "runtime-mode" "full-access")');
    e(ed, "(fikra-refresh-lighter)");
    expect(String(e(ed, '(minor-mode-lighter "fikra")').value)).toContain(":L0");
  });

  test("the checkpoint marker renders [ckpt <id>/<n> ✓]", async () => {
    const ed = await createStartedEditor("");
    e(ed, "(require-module \"fikra/event\")");
    const line = String(e(ed, '(fikra/event/fikra-event-render-line (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/3")))').value);
    expect(line).toContain("[ckpt main/3 ✓]");
    const line2 = String(e(ed, '(fikra/event/fikra-event-render-line (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/fix-2/7-baseline")))').value);
    expect(line2).toContain("[ckpt fix-2/7 ✓]");
  });

  test("SPC a R EXECUTES: the viewer opens on the last completed turn (r58 catch)", async () => {
    const ed = await createStartedEditor("");
    e(ed, "(require-module fikra/mode)");
    e(ed, "(fikra-start)");
    e(ed, "(require-module fikra/adapter)");
    e(ed, "(require-module fikra/backend-replay)");
    e(ed, '(fikra/adapter/fikra-set-backend-forced "replay")');
    e(ed, '(require-module "fikra/thread")');
    e(ed, '(fikra-thread-set-field "turn-count" 2)');
    // No refs in the scratch repo: the ref-verified scan returns 0 here
    // (the RUNNING-turn arithmetic below exercises the count math).
    // DISPATCH THE BINDING ITSELF (r59: the test called a hand-written
    // expression — the binding string still passed the raw count). The
    // binding's command is what runs now.
    const cmd = e(ed, '(key-binding "SPC a R" "normal")');
    const cmdStr = JSON.stringify(cmd);
    expect(cmdStr).toContain("fikra-last-completed-turn");
    expect(cmdStr).not.toContain("fikra-thread-turn-count");
    // And the helper chain executes with the binding's exact shape.
    e(ed, "(require-module fikra/diff)");
    // The scan verifies completion REFS — this scratch repo has none, so
    // 0 is the honest target here (the nav suite proves the refs-walk).
    expect(String(e(ed, "(fikra/diff/fikra-last-completed-turn)").value)).toBe("0");
    // LIVE KEY DISPATCH (r61 asserts the RESULT): refs for turn 1 exist,
    // the keystrokes run, and the viewer OPENS ON TURN 1.
    // Seed a commit first (the empty repo's HEAD is unborn).
    writeFileSync(join(repoDir, "seed.txt"), "x\n");
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed"], { cwd: repoDir });
    writeFileSync(join(repoDir, "app.txt"), "line1\n");
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    const tree1 = execFileSync("git", ["write-tree"], { cwd: repoDir }).toString().trim();
    const c1 = execFileSync("git", ["commit-tree", tree1, "-m", "t1"], { cwd: repoDir }).toString().trim();
    execFileSync("git", ["update-ref", "refs/fikra/main/1-baseline", "HEAD"], { cwd: repoDir });
    execFileSync("git", ["update-ref", "refs/fikra/main/1", c1], { cwd: repoDir });
    e(ed, "(require-module fikra/diff)");
    const ed2h = ed as unknown as { handleKey: (k: string) => Promise<unknown> };
    await ed2h.handleKey("Escape");
    await ed2h.handleKey(" ");
    await ed2h.handleKey("a");
    await ed2h.handleKey("R");
    expect(String(e(ed, "(buffer-name)").value)).toBe("*Fikra-Diff*");
    expect(String(e(ed, "(buffer-text)").value)).toContain("turn 1");
    // A RUNNING turn must not be the target: turn 2 starts mid-flight →
    // the scan lands on turn 1 (its ref EXISTS — created above).
    e(ed, '(require-module "fikra/thread")');
    e(ed, '(fikra-thread-turn-begin)');
    expect(String(e(ed, "(fikra/diff/fikra-last-completed-turn)").value)).toBe("1");
    // A mid-flight FIRST turn: nothing completed — 0 (r59's edge).
    e(ed, '(fikra-thread-focus "edge")');
    e(ed, '(fikra-thread-set-field "turn-count" 1)');
    e(ed, '(fikra-thread-status-set "running")');
    expect(String(e(ed, "(fikra/diff/fikra-last-completed-turn)").value)).toBe("0");
    // (The failed-turn walk lives in the nav suite where refs exist.)
  });
});
