import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

// #223 (RFC-027 §Phase 5) — plan as a thread INTERACTION MODE: toggle +
// persisted thread property, READ-ONLY backend flags in plan turns, the
// y/e/n approval flow (approve spawns the implementation turn carrying
// the plan; edit round-trips the plan buffer; discard idles).

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

let repoDir = "";
const repoDirs: string[] = [];
const originalCwd = process.cwd();

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "fikra-pl-"));
  repoDirs.push(repoDir);
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repoDir });
  execFileSync("git", ["branch", "-M", "main"], { cwd: repoDir });
  writeFileSync(join(repoDir, ".gitignore"), ".tmax/\n");
  writeFileSync(join(repoDir, "f.txt"), "x\n");
  execFileSync("git", ["add", "-A"], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repoDir });
  process.chdir(repoDir);
});

afterAll(() => {
  process.chdir(originalCwd);
  for (const d of repoDirs) rmSync(d, { recursive: true, force: true });
});

const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);

async function planSetup(): Promise<Editor> {
  const editor = await createStartedEditor("");
  e(editor, "(require-module fikra/plan)");
  e(editor, "(require-module fikra/adapter)");
  e(editor, "(require-module fikra/chat)");
  e(editor, '(require-module fikra/backend-claude)');
  e(editor, "(fikra/thread/fikra-thread-init)");
  e(editor, '(fikra/adapter/fikra-set-backend-forced "replay")');
  e(editor, '(fikra/backend-claude/fikra-claude-set-approvals-override "off")');
  return editor;
}

/** Emit a completed plan-mode turn: user echo + the plan markdown. */
function planTurn(editor: Editor, plan: string): void {
  e(editor, '(fikra/event/fikra-event-emit (list (list "kind" "turn-start") (list "turn" 1) (list "backend" "replay")))');
  e(editor, `(fikra/event/fikra-event-emit (list (list "kind" "text-delta") (list "text" "You: make a plan")))`);
  e(editor, `(fikra/event/fikra-event-emit (list (list "kind" "text-delta") (list "text" ${JSON.stringify(plan)})))`);
  e(editor, '(fikra/event/fikra-event-emit (list (list "kind" "turn-end") (list "status" "completed")))');
}

describe("#223 interaction mode — toggle + persistence", () => {
  test("SPC a p toggles plan/default; the property persists in state.json", async () => {
    const editor = await planSetup();
    expect(String(e(editor, "(fikra/plan/fikra-plan-mode-p)").value)).toBe("null"); // default: unset
    expect(String(e(editor, "(fikra/plan/fikra-plan-toggle)").value)).toBe("plan");
    expect(String(e(editor, "(fikra/plan/fikra-plan-mode-p)").value)).toBe("true");
    const state = JSON.parse(readFileSync(join(repoDir, ".tmax/fikra/threads/main/state.json"), "utf8"));
    expect(state.interaction).toBe("plan");
    expect(String(e(editor, "(fikra/plan/fikra-plan-toggle)").value)).toBe("default");
    expect(String(e(editor, "(fikra/plan/fikra-plan-mode-p)").value)).toBe("false");
  });

  test("SPC a p is registered", async () => {
    const editor = await planSetup();
    e(editor, "(require-module fikra/mode)");
    expect(JSON.stringify(e(editor, '(key-binding "SPC a p" "normal")').value)).toContain("fikra-plan-toggle");
  });
});

describe("#223 plan turns run READ-ONLY", () => {
  test("claude args carry the native plan permission + edits disallowed", async () => {
    const editor = await planSetup();
    const defaultArgs = (e(editor, '(fikra/backend-claude/fikra-backend-claude-args "q" nil)').value as { value: string }[]).map((v) => String(v.value));
    expect(defaultArgs).toContain("--permission-mode");
    expect(defaultArgs).not.toContain("plan");
    e(editor, "(fikra/plan/fikra-plan-toggle)");
    const planArgs = (e(editor, '(fikra/backend-claude/fikra-backend-claude-args "q" nil)').value as { value: string }[]).map((v) => String(v.value));
    expect(planArgs).toContain("plan"); // --permission-mode plan
    const idx = planArgs.indexOf("--disallowedTools");
    expect(idx).toBeGreaterThan(-1);
    expect(planArgs[idx + 1]).toContain("Edit");
    expect(planArgs).not.toContain("bypassPermissions");
  });

  test("a plan-mode turn makes NO edits — the log holds no file-change events", async () => {
    const editor = await planSetup();
    e(editor, "(fikra/plan/fikra-plan-toggle)");
    planTurn(editor, "# Plan\n1. do things");
    const log = readFileSync(join(repoDir, ".tmax/fikra/threads/main/events.jsonl"), "utf8");
    const kinds = log.trimEnd().split("\n").map((l) => JSON.parse(l).kind);
    expect(kinds).not.toContain("file-change");
    expect(kinds).not.toContain("tool-call");
    expect(kinds).toContain("text-delta"); // the plan itself is ordinary content
  });
});

describe("#223 approval flow", () => {
  test("offer: the plan is captured (user echo excluded) and y/e/n offered", async () => {
    const editor = await planSetup();
    e(editor, "(fikra/plan/fikra-plan-toggle)");
    planTurn(editor, "STEP A THEN B");
    e(editor, "(fikra/thread/fikra-thread-open)"); // the chat buffer is current
    expect(String(e(editor, "(fikra/plan/fikra-plan-offer-approval)").value)).toBe("true");
    expect(String(e(editor, "(fikra/plan/fikra-plan-approval-pending-p)").value)).toBe("true");
    // The offer prompt renders in the chat buffer.
    expect(bufferText(editor)).toContain("plan review");
  });

  test("y approves: implementation turn carries the plan; interaction returns to default", async () => {
    const editor = await planSetup();
    e(editor, "(fikra/plan/fikra-plan-toggle)");
    planTurn(editor, "THE STEPS");
    e(editor, "(fikra/plan/fikra-plan-offer-approval)");
    expect(String(e(editor, "(fikra/plan/fikra-plan-approve)").value)).toBe("true");
    // The implementation turn's user message carries the plan text.
    const log = readFileSync(join(repoDir, ".tmax/fikra/threads/main/events.jsonl"), "utf8");
    expect(log).toContain("Implement this plan:");
    expect(log).toContain("THE STEPS");
    // Interaction reset + the decision recorded.
    expect(String(e(editor, "(fikra/plan/fikra-plan-mode-p)").value)).toBe("false");
    expect(String(e(editor, "(fikra/plan/fikra-plan-approval-pending-p)").value)).toBe("null");
    expect(log).toContain("plan-approved");
  });

  test("e round-trips the plan through an editable buffer; the EDITED plan is what approves", async () => {
    const editor = await planSetup();
    e(editor, "(fikra/plan/fikra-plan-toggle)");
    planTurn(editor, "ORIGINAL PLAN");
    e(editor, "(fikra/plan/fikra-plan-offer-approval)");
    expect(String(e(editor, "(fikra/plan/fikra-plan-edit)").value)).toBe("true");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Fikra-Plan*");
    expect(bufferText(editor)).toContain("ORIGINAL PLAN");
    // Edit it.
    e(editor, "(cursor-move 999999 999999)");
    e(editor, '(buffer-insert " REVISED")');
    // n returns the plan unchanged (still pending).
    expect(String(e(editor, "(fikra/plan/fikra-plan-edit-cancel)").value)).toBe("true");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Fikra*");
    expect(String(e(editor, "(fikra/plan/fikra-plan-approval-pending-p)").value)).toBe("true");
    // Re-edit and APPROVE the revised text.
    e(editor, "(fikra/plan/fikra-plan-edit)");
    e(editor, "(cursor-move 999999 999999)");
    e(editor, '(buffer-insert " FINAL")');
    expect(String(e(editor, "(fikra/plan/fikra-plan-edit-approve)").value)).toBe("true");
    const log = readFileSync(join(repoDir, ".tmax/fikra/threads/main/events.jsonl"), "utf8");
    expect(log).toContain("REVISED FINAL"); // the edited plan carried
  });

  test("n discards: thread idle, no implementation turn, plan mode stays", async () => {
    const editor = await planSetup();
    e(editor, "(fikra/plan/fikra-plan-toggle)");
    planTurn(editor, "DOOMED PLAN");
    e(editor, "(fikra/plan/fikra-plan-offer-approval)");
    expect(String(e(editor, "(fikra/plan/fikra-plan-discard)").value)).toBe("true");
    expect(String(e(editor, "(fikra/plan/fikra-plan-approval-pending-p)").value)).toBe("null");
    expect(String(e(editor, "(fikra/plan/fikra-plan-mode-p)").value)).toBe("true"); // stays plan
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    const log = readFileSync(join(repoDir, ".tmax/fikra/threads/main/events.jsonl"), "utf8");
    expect(log).toContain("plan-discarded");
    expect(log).not.toContain("Implement this plan:");
  });
});
