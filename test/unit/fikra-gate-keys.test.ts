import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

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
  '{"type":"permission","tool":"Edit","scope":"src/**"}',
  '{"type":"assistant","text":"allowed continuation"}',
  '{"type":"denied","text":"action rejected"}',
  '{"type":"end"}',
].join("\n") + "\n";

async function started(): Promise<Editor> {
  const dir = mkdtempSync(join(tmpdir(), "gate-keys-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(join(dir, "fixture.jsonl"), SCRIPT);
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
    expect(paused).toContain("[y] allow");
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

  test("a (real keystroke): persists — the NEXT matching pause is skipped entirely", async () => {
    const editor = await started();
    e(editor, '(fikra/adapter/fikra-backend-start-turn "do it")');
    await editor.handleKey("a");
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

  test("y with nothing pending: an honest status, no crash", async () => {
    const editor = await started();
    await editor.handleKey("y");
    expect(String(e(editor, "(editor-status)").value)).toContain("no pending approval");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
  });
});
