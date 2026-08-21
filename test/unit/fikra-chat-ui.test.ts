import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

// #216 (RFC-027 §UI) — the chat UI as a thin layer over Phase-1: threads
// own state, FAEP owns rendering, adapters own turns. Drives everything
// through the replay backend (#215) — keyless.

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

let repoDir = "";
const repoDirs: string[] = [];
const originalCwd = process.cwd();

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "fikra-chat-"));
  repoDirs.push(repoDir);
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  process.chdir(repoDir);
});

afterAll(() => {
  process.chdir(originalCwd);
  for (const dir of repoDirs) rmSync(dir, { recursive: true, force: true });
});

const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);

function setup(editor: Editor, fixtureLines: string[]) {
  e(editor, "(require-module fikra/chat)");
  e(editor, "(require-module fikra/backend-replay)");
  const fx = join(repoDir, "f.jsonl");
  writeFileSync(fx, fixtureLines.join("\n") + "\n");
  e(editor, `(fikra/backend-replay/fikra-backend-replay-load "${fx}")`);
  e(editor, '(fikra/adapter/fikra-set-backend "replay")');
}

describe("#216 chat open", () => {
  test("open creates *Fikra*, attaches keymap, starts mode, sets backend", async () => {
    const editor = await createStartedEditor("");
    setup(editor, []);
    e(editor, "(require-module fikra/mode)");
    e(editor, "(fikra/mode/fikra-start)");
    e(editor, '(fikra/adapter/fikra-set-backend "replay")'); // start picks claude
    expect(String(e(editor, "(fikra/chat/fikra-chat-open)").value)).toBe("*Fikra*");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Fikra*");
    // Buffer-local keymap has RET → follow-link (qualified).
    const ret = e(editor, '(keymap-ref (editor/keymaps/buffer-keymap "*Fikra*") "RET")');
    expect(String(ret.value)).toContain("fikra-follow-link");
    // Fikra minor mode active; a backend selected.
    expect(String(e(editor, '(minor-mode-active-p "fikra")').value)).toBe("true");
    expect(String(e(editor, "(fikra/adapter/fikra-current-backend)").value)).toBe("replay");
  });

  test("open replays thread history (daemon-restart path) — open twice is stable", async () => {
    const editor = await createStartedEditor("");
    setup(editor, ['{"type":"assistant","message":{"content":[{"type":"text","text":"kept"}]}}']);
    // First turn happens via replay before any chat-open (fixture pre-fed
    // through a direct start-turn to populate the log).
    e(editor, '(fikra/backend-replay/fikra-backend-replay-start-turn "q")');
    e(editor, "(fikra/chat/fikra-chat-open)");
    let buf = String(e(editor, "(buffer-text)").value);
    expect(buf).toContain("AI: kept");
    // Re-open: replay from disk, same content (idempotent).
    e(editor, "(fikra/chat/fikra-chat-open)");
    expect(String(e(editor, "(buffer-text)").value)).toBe(buf);
  });
});

describe("#216 turn-send through the replay backend", () => {
  test("send emits the user text to FAEP, drives a full replay turn", async () => {
    const editor = await createStartedEditor("");
    setup(editor, ['{"type":"assistant","message":{"content":[{"type":"text","text":"reply!"}]}}']);
    e(editor, "(fikra/chat/fikra-chat-open)");
    e(editor, '(fikra/chat/fikra-turn-send "hello agent")');
    const buf = String(e(editor, "(buffer-text)").value);
    expect(buf).toContain("You: hello agent");
    expect(buf).toContain("AI: reply!");
    // Thread settled.
    expect(String(e(editor, "(fikra/chat/fikra-turn-status)").value)).toBe("idle");
  });

  test("send with NO backend: nil + guidance status, no crash", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/chat)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    expect(String(e(editor, '(fikra/chat/fikra-turn-send "x")').value)).toBe("null");
  });
});

describe("#216 modeline via dynamic lighters (#211)", () => {
  test("lighter reflects backend + idle state; updates after a turn", async () => {
    const editor = await createStartedEditor("");
    setup(editor, ['{"type":"assistant","message":{"content":[{"type":"text","text":"r"}]}}']);
    e(editor, "(fikra/chat/fikra-chat-open)");
    expect(String(e(editor, '(minor-mode-lighter "fikra")').value)).toBe("fikra:replay●");
    // After a turn (send → replay completes synchronously) still idle.
    e(editor, '(fikra/chat/fikra-turn-send "q")');
    e(editor, "(fikra/chat/fikra-refresh-lighter)");
    expect(String(e(editor, '(minor-mode-lighter "fikra")').value)).toBe("fikra:replay●");
    // Running state shows ◉.
    e(editor, '(fikra/thread/fikra-thread-turn-begin)');
    e(editor, "(fikra/chat/fikra-refresh-lighter)");
    expect(String(e(editor, '(minor-mode-lighter "fikra")').value)).toBe("fikra:replay◉");
  });
});

describe("#216 capture regression (double-paren bug)", () => {
  test("capture open→type→submit→recreate cycle works (the ((member)) bug)", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/capture)");
    e(editor, "(require-module fikra/thread)");
    e(editor, "(fikra/thread/fikra-thread-open)"); // ensures *Fikra* exists
    // First open.
    e(editor, "(fikra/capture/fikra-capture)");
    e(editor, "(buffer-insert " + JSON.stringify("note text") + ")");
    e(editor, "(fikra/capture/fikra-capture-submit)");
    // SECOND open — recreates the buffer; the old ((member)) bug errored here.
    e(editor, "(fikra/capture/fikra-capture)");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Fikra-Capture*");
  });
});

describe("#216 old globals are gone", () => {
  test("no global message history / turn-status vars in chat.tlisp; status via thread", async () => {
    const editor = await createStartedEditor("");
    const src = await import("node:fs").then((m) => m.readFileSync(
      join(originalCwd, "src/tlisp/core/fikra/chat.tlisp"), "utf8"));
    expect(src).not.toContain("(defvar fikra-message-history");
    expect(src).not.toContain("(defvar fikra-turn-status-val");
    expect(src).not.toContain("editor-set-status (concat \"fikra:"); // modeline via lighters
    // turn-status delegates to the thread state machine.
    e(editor, "(require-module fikra/chat)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    expect(String(e(editor, "(fikra/chat/fikra-turn-status)").value)).toBe("idle");
  });
});
