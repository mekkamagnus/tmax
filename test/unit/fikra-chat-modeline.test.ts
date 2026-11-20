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
    // The fn the binding calls — EXECUTED, not inspected.
    e(ed, "(require-module fikra/diff)");
    // No captured refs in the scratch repo: the CALL resolves (the r58
    // catch) and the no-captured-diff status is the honest outcome; the
    // running-turn arithmetic is asserted directly.
    e(ed, "(fikra/diff/fikra-turn-diff-for (fikra/diff/fikra-last-completed-turn))");
    expect(String(e(ed, "(fikra/diff/fikra-last-completed-turn)").value)).toBe("2");
    // A RUNNING turn must not be the target: count 3 mid-flight → 2.
    e(ed, '(require-module "fikra/thread")');
    e(ed, '(fikra-thread-turn-begin)');
    expect(String(e(ed, "(fikra/diff/fikra-last-completed-turn)").value)).toBe("2");
  });
});
