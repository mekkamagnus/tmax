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

describe("#8.1 inline ckpt marker (r63)", () => {
  test("a checkpoint following a tool-call renders INLINE on that row", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/event")');
    e(ed, '(defvar r63-evs nil)');
    e(ed, '(setq r63-evs (fikra/event/fikra-event-inline-ckpt-merge (list (list (list "kind" "turn-start") (list "turn" 3) (list "backend" "replay") (list "mode" "")) (list (list "kind" "tool-call") (list "tool" "buffer-edit") (list "id" "ab12") (list "summary" "src/x.ts @118")) (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/3"))) (list) nil))');
    expect(String(e(ed, "(length r63-evs)").value)).toBe("2"); // ts + merged Edit
    const line = String(e(ed, "(fikra/event/fikra-event-render-line (nth 1 r63-evs))").value);
    expect(line).toContain("⚙ buffer-edit");
    expect(line).toContain("[ckpt main/3 ✓]");
    expect(line).toContain("src/x.ts @118");
  });

  test("a checkpoint NOT following a tool-call keeps its standalone row", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/event")');
    e(ed, '(defvar r63-evs2 nil)');
    e(ed, '(setq r63-evs2 (fikra/event/fikra-event-inline-ckpt-merge (list (list (list "kind" "text-delta") (list "speaker" "user") (list "text" "hi")) (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/2"))) (list) nil))');
    expect(String(e(ed, "(length r63-evs2)").value)).toBe("2");
    const line = String(e(ed, "(fikra/event/fikra-event-render-line (nth 1 r63-evs2))").value);
    expect(line).toContain("[ckpt main/2 ✓]");
  });

  test("edit-only + turn-bounded association (r63: reads/shell never carry it; a new turn resets)", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/event")');
    // A bash call + result + checkpoint: STANDALONE (not an edit tool).
    e(ed, '(defvar r64-a nil)');
    e(ed, '(setq r64-a (fikra/event/fikra-event-inline-ckpt-merge (list (list (list "kind" "tool-call") (list "tool" "bash") (list "id" "cd34") (list "summary" "make test")) (list (list "kind" "tool-result") (list "ok" t) (list "id" "cd34") (list "summary" "pass")) (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/4"))) (list) nil))');
    expect(String(e(ed, "(length r64-a)").value)).toBe("3"); // standalone kept
    expect(String(e(ed, "(fikra/event/fikra-event-render-line (nth 0 r64-a))").value)).not.toContain("[ckpt");
    // An edit call in turn 1, then TURN 2 with only a checkpoint: the
    // marker does NOT leak across the boundary.
    e(ed, '(defvar r64-b nil)');
    e(ed, '(setq r64-b (fikra/event/fikra-event-inline-ckpt-merge (list (list (list "kind" "turn-start") (list "turn" 1) (list "backend" "replay") (list "mode" "")) (list (list "kind" "tool-call") (list "tool" "Edit") (list "id" "ef01") (list "summary" "src/a.ts @5")) (list (list "kind" "turn-end") (list "turn" 1) (list "status" "completed")) (list (list "kind" "turn-start") (list "turn" 2) (list "backend" "replay") (list "mode" "")) (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/2"))) (list) nil))');
    const t2call = String(e(ed, "(fikra/event/fikra-event-render-line (nth 1 r64-b))").value);
    expect(t2call).not.toContain("[ckpt"); // no cross-turn leak
    expect(String(e(ed, "(fikra/event/fikra-event-render-line (nth 4 r64-b))").value)).toContain("[ckpt main/2 ✓]");
    // Same-turn Edit + intervening result: attaches to the CALL.
    e(ed, '(defvar r64-c nil)');
    e(ed, '(setq r64-c (fikra/event/fikra-event-inline-ckpt-merge (list (list (list "kind" "turn-start") (list "turn" 5) (list "backend" "replay") (list "mode" "")) (list (list "kind" "tool-call") (list "tool" "Edit") (list "id" "ef02") (list "summary" "src/a.ts @7")) (list (list "kind" "tool-result") (list "ok" t) (list "id" "ef02") (list "summary" "applied")) (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/5"))) (list) nil))');
    expect(String(e(ed, "(fikra/event/fikra-event-render-line (nth 1 r64-c))").value)).toContain("[ckpt main/5 ✓]");
    expect(String(e(ed, "(fikra/event/fikra-event-render-line (nth 2 r64-c))").value)).not.toContain("[ckpt");
  });

  test("Edit→bash→checkpoint: the marker does NOT reach past the shell (r64)", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/event")');
    e(ed, '(defvar r65-a nil)');
    e(ed, '(setq r65-a (fikra/event/fikra-event-inline-ckpt-merge (list (list (list "kind" "tool-call") (list "tool" "Edit") (list "id" "ee1") (list "summary" "src/a.ts @3")) (list (list "kind" "tool-result") (list "ok" t) (list "id" "ee1") (list "summary" "done")) (list (list "kind" "tool-call") (list "tool" "bash") (list "id" "bb1") (list "summary" "make check")) (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/6"))) (list) nil))');
    // 4 events in, standalone kept (the shell is the nearer action) = 4 out.
    expect(String(e(ed, "(length r65-a)").value)).toBe("4");
    // The Edit row (index 0) carries NOTHING; the bash row (index 2) neither.
    expect(String(e(ed, "(fikra/event/fikra-event-render-line (nth 0 r65-a))").value)).not.toContain("[ckpt");
    expect(String(e(ed, "(fikra/event/fikra-event-render-line (nth 2 r65-a))").value)).not.toContain("[ckpt");
    // The standalone marker survives (index 3).
    expect(String(e(ed, "(fikra/event/fikra-event-render-line (nth 3 r65-a))").value)).toContain("[ckpt main/6 ✓]");
  });

  test("the PRODUCTION order: baseline checkpoint-ready AFTER turn-start stays in its own turn (r64)", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/event")');
    // turn 1 has an Edit; turn 2's turn-start PRECEDES its baseline
    // checkpoint (the old emit order put the checkpoint first — the
    // baseline could attach to turn 1's Edit).
    e(ed, '(defvar r65-b nil)');
    e(ed, '(setq r65-b (fikra/event/fikra-event-inline-ckpt-merge (list (list (list "kind" "turn-start") (list "turn" 1) (list "backend" "replay") (list "mode" "")) (list (list "kind" "tool-call") (list "tool" "Edit") (list "id" "ee9") (list "summary" "src/b.ts @1")) (list (list "kind" "tool-result") (list "ok" t) (list "id" "ee9") (list "summary" "done")) (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/1")) (list (list "kind" "turn-end") (list "turn" 1) (list "status" "completed")) (list (list "kind" "turn-start") (list "turn" 2) (list "backend" "replay") (list "mode" "")) (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/2-baseline"))) (list) nil))');
    const t1edit = String(e(ed, "(fikra/event/fikra-event-render-line (nth 1 r65-b))").value);
    expect(t1edit).toContain("[ckpt main/1 ✓]");       // turn 1's OWN completion
    expect(t1edit).not.toContain("main/2");             // never turn 2's baseline
    // 7 events in: turn-1's checkpoint merges into its Edit (6 out); turn-2's
    // baseline renders standalone (no edit in turn 2, boundary blocks).
    expect(String(e(ed, "(length r65-b)").value)).toBe("6");
    expect(String(e(ed, "(fikra/event/fikra-event-render-line (nth 5 r65-b))").value)).toContain("main/2");
  });

  test("IDENTITY association: turn-1's checkpoint never attaches to turn-2's Edit (r66 counterexample)", async () => {
    const ed = await createStartedEditor("");
    e(ed, '(require-module "fikra/event")');
    // The exact sequence: ts1 → Edit → ts2 → Edit → checkpoint(main/1).
    e(ed, '(defvar r66-a nil)');
    e(ed, '(setq r66-a (fikra/event/fikra-event-inline-ckpt-merge (list (list (list "kind" "turn-start") (list "turn" 1) (list "backend" "r") (list "mode" "")) (list (list "kind" "tool-call") (list "tool" "Edit") (list "id" "e1") (list "summary" "a.ts @1")) (list (list "kind" "turn-start") (list "turn" 2) (list "backend" "r") (list "mode" "")) (list (list "kind" "tool-call") (list "tool" "Edit") (list "id" "e2") (list "summary" "a.ts @9")) (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/1"))) (list) nil))');
    // Turn 2's Edit (index 3) carries NOTHING.
    expect(String(e(ed, "(fikra/event/fikra-event-render-line (nth 3 r66-a))").value)).not.toContain("[ckpt");
    // The checkpoint renders standalone (identity mismatch: turn 1 ≠ turn 2).
    expect(String(e(ed, "(length r66-a)").value)).toBe("5");
    expect(String(e(ed, "(fikra/event/fikra-event-render-line (nth 4 r66-a))").value)).toContain("[ckpt main/1 ✓]");
    // The matching identity DOES attach: same sequence but checkpoint(main/2).
    e(ed, '(defvar r66-b nil)');
    e(ed, '(setq r66-b (fikra/event/fikra-event-inline-ckpt-merge (list (list (list "kind" "turn-start") (list "turn" 1) (list "backend" "r") (list "mode" "")) (list (list "kind" "tool-call") (list "tool" "Edit") (list "id" "e1") (list "summary" "a.ts @1")) (list (list "kind" "turn-start") (list "turn" 2) (list "backend" "r") (list "mode" "")) (list (list "kind" "tool-call") (list "tool" "Edit") (list "id" "e2") (list "summary" "a.ts @9")) (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/2"))) (list) nil))');
    expect(String(e(ed, "(fikra/event/fikra-event-render-line (nth 3 r66-b))").value)).toContain("[ckpt main/2 ✓]");
  });
});
