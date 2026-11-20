import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";
import { confirmationService } from "../../src/editor/api/confirmation-service.ts";

// The P1 interactive gate loop (mockup 8.3): a backend pause parks the
// turn at a permission — the gate panel renders in *Fikra* — and the
// USER'S y/n/a KEYS (real keystrokes through handleKey, not out-of-band
// function calls) decide it and the turn resumes. `a` persists per-thread
// and suppresses the next matching pause.

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);
const strip = (s: string) => s.replace(/\[[0-9;]*m/g, "");

const dirs: string[] = [];
const originalCwd = process.cwd();

const SCRIPT = [
  '{"type":"assistant","text":"before the gate"}',
  '{"type":"permission","tool":"Edit","scope":"lib/"}',
  '{"type":"assistant","text":"allowed continuation"}',
  '{"type":"denied","text":"action rejected"}',
  '{"type":"end"}',
].join("\n") + "\n";

async function started(): Promise<Editor> {
  const dir = mkdtempSync(join(tmpdir(), "gate-keys-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(join(dir, "fixture.jsonl"), SCRIPT);
  // A REAL directory target (2 files) — the panel's target row carries
  // the mockup's blast-radius context: "lib/  (2 files, <size>)".
  mkdirSync(join(dir, "lib"), { recursive: true });
  writeFileSync(join(dir, "lib", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "lib", "b.ts"), "export const b = 2;\n");
  process.chdir(dir);
  const editor = await createStartedEditor("");
  e(editor, "(require-module fikra/backend-pausing)");
  e(editor, "(require-module fikra/adapter)");
  e(editor, `(fikra/backend-pausing/fikra-backend-pausing-load "${join(dir, "fixture.jsonl")}")`);
  e(editor, '(fikra/adapter/fikra-set-backend-forced "pausing")');
  e(editor, "(require-module fikra/chat)");
  e(editor, "(require-module fikra/approvals)");
  // chat-open (the SPC a a entry): attaches the buffer-local keymap the
  // gate keys live in — thread-open alone leaves it keyless by contract.
  e(editor, "(fikra/chat/fikra-chat-open)");
  return editor;
}

afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("P1 interactive gate — pause → USER KEY → resume", () => {
  test("y (real keystroke): the gate panel renders, the key allows, the turn completes", async () => {
    const editor = await started();
    expect(String(e(editor, '(fikra/adapter/fikra-backend-start-turn "do it")').value)).toBe("paused");
    // The PAUSE is a PENDING approval the unified signal can see.
    expect(String(e(editor, "(fikra/approvals/fikra-approval-pending-p)").value)).toBe("true");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    // The gate panel renders in the chat buffer.
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    const paused = strip(bufferText(editor));
    expect(paused).toContain("APPROVE ACTION");
    // Mockup 8.3 key labels (r80) + the ckpt row's named-ref shape +
    // the target's blast-radius context.
    // Rows WRAP at the 40-char inner width (r73) — assert the head and
    // the wrapped tail, not the unwrapped string.
    expect(paused).toContain("a Allow  r Reject  A Always allow");
    expect(paused).toContain("C-g abort turn");
    expect(paused).toContain("ckpt    fikra/main/1");
    expect(paused).toContain("after execution");
    expect(paused).toContain("lib/  (2 files,");
    // THE KEYSTROKE: y in the chat buffer (normal mode, buffer keymap).
    await editor.handleKey("y");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    expect(String(e(editor, "(fikra/approvals/fikra-approval-pending-p)").value)).toBe("null");
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    const resumed = strip(bufferText(editor));
    expect(resumed).toContain("allowed continuation");
    expect(resumed).toContain("= allowed this request");
    expect(resumed).not.toContain("action rejected");
  });

  test("n (real keystroke): the denial branch renders and the turn ends", async () => {
    const editor = await started();
    e(editor, '(fikra/adapter/fikra-backend-start-turn "do it")');
    await editor.handleKey("n");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    const text = strip(bufferText(editor));
    expect(text).toContain("action rejected");
    expect(text).toContain("= denied");
    expect(text).not.toContain("allowed continuation");
  });

  test("a (real keystroke) now ALLOWS this request only (mockup r80: A is always)", async () => {
    const editor = await started();
    e(editor, '(fikra/adapter/fikra-backend-start-turn "do it")');
    await editor.handleKey("a");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    expect(strip(bufferText(editor))).toContain("= allowed this request");
    expect(strip(bufferText(editor))).not.toContain("always for this tool+scope");
  });

  test("A (real keystroke): persists — the NEXT matching pause is skipped entirely", async () => {
    const editor = await started();
    e(editor, '(fikra/adapter/fikra-backend-start-turn "do it")');
    await editor.handleKey("A");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    expect(strip(bufferText(editor))).toContain("allowed (always for this tool+scope)");
    // Reload the fixture (a fresh turn, SAME tool+scope) — the persisted
    // allow-list answers before the pause: no confirming, straight to done.
    e(editor, `(fikra/backend-pausing/fikra-backend-pausing-load "${join(process.cwd(), "fixture.jsonl")}")`);
    const second = e(editor, '(fikra/adapter/fikra-backend-start-turn "again")');
    expect(String(second.value)).toBe("done");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    expect(String(e(editor, "(fikra/approvals/fikra-approval-pending-p)").value)).toBe("null");
  });

  test("a HEADLESS eval cannot approve the pause (the L2 guard covers backend pauses too)", async () => {
    const editor = await started();
    e(editor, '(fikra/adapter/fikra-backend-start-turn "do it")');
    expect(String(e(editor, "(fikra/approvals/fikra-approval-pending-p)").value)).toBe("true");
    // THE THREAT: the agent eval-approves its own paused action. The daemon
    // stamps eval dispatches headless — here we stamp the same fact directly.
    confirmationService.resolverHint = "headless";
    expect(String(e(editor, "(fikra/approvals/fikra-approval-answer-allow)").value)).toBe("null");
    // Denied: the pause STAYS parked, the turn stays confirming.
    expect(String(e(editor, "(fikra/approvals/fikra-approval-pending-p)").value)).toBe("true");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    // The bypass probe (codex r78 catch 1): a headless eval calling the
    // ADAPTER seam directly must ALSO be denied — enforcement lives at
    // the service primitive, not one caller.
    expect(String(e(editor, '(fikra/adapter/fikra-backend-decide "y")').value)).toBe("null");
    expect(String(e(editor, "(fikra/approvals/fikra-approval-pending-p)").value)).toBe("true");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    // ... and the backend-side contract wrapper re-checks the same guard.
    expect(String(e(editor, '(fikra/backend-pausing/fikra-backend-pausing-decide "y")').value)).toBe("null");
    expect(String(e(editor, "(fikra/approvals/fikra-approval-pending-p)").value)).toBe("true");
    // An INTERACTIVE frame (keypress dispatch) then resolves it.
    confirmationService.resolverHint = "interactive";
    await editor.handleKey("y");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    confirmationService.resolverHint = "interactive";
  });

  test("C-g at the gate ABORTS the parked pause (turn ends interrupted)", async () => {
    const editor = await started();
    e(editor, '(fikra/adapter/fikra-backend-start-turn "do it")');
    expect(String(e(editor, "(fikra/approvals/fikra-approval-pending-p)").value)).toBe("true");
    await editor.handleKey("C-g");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("interrupted");
    expect(String(e(editor, "(fikra/approvals/fikra-approval-pending-p)").value)).toBe("null");
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    expect(strip(bufferText(editor))).toContain("= denied");
    // Nothing resumes afterwards: the script is exhausted.
    expect(String(e(editor, "(fikra/backend-pausing/fikra-pausing-pump)").value)).toBe("idle");
  });

  test("y with nothing pending: an honest status, no crash", async () => {
    const editor = await started();
    await editor.handleKey("y");
    expect(String(e(editor, "(editor-status)").value)).toContain("no pending approval");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
  });
});
