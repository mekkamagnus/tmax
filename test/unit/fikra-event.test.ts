import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

// #212 (RFC-027 §D2) — FAEP: normalized event vocabulary, event-sourced
// JSONL logs, replay-as-renderer (tombstone-aware, crash-tolerant).

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

let dir = "";
let log = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fikra-faep-"));
  log = join(dir, "events.jsonl");
});

const setup = (editor: Editor) => {
  executeTlisp(editor, "(require-module fikra/event)");
  executeTlisp(editor, `(fikra/event/fikra-event-log-set "${log}")`);
};

const ev = (editor: Editor, kind: string, fields: Record<string, string>) => {
  const pairs = Object.entries({ kind, ...fields })
    .map(([k, v]) => `(list "${k}" "${v}")`).join(" ");
  executeTlisp(editor, `(fikra/event/fikra-event-emit (list ${pairs}))`);
};

const replay = (editor: Editor): string =>
  String(executeTlisp(editor, "(fikra/event/fikra-event-replay)").value);

const turn = (editor: Editor, n: number) => {
  ev(editor, "turn-start", { turn: String(n), backend: "claude" });
};

describe("#212 FAEP — emit + log", () => {
  test("events append as JSONL lines; memory records oldest-first", async () => {
    const editor = await createStartedEditor("");
    setup(editor);
    turn(editor, 1);
    ev(editor, "text-delta", { text: "hello" });
    ev(editor, "turn-end", { turn: "1", status: "completed" });

    const raw = readFileSync(log, "utf8");
    const lines = raw.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toEqual({ kind: "turn-start", turn: "1", backend: "claude" });
    expect(JSON.parse(lines[1]!)).toEqual({ kind: "text-delta", text: "hello" });

    const memory = executeTlisp(editor, "(fikra/event/fikra-event-events)");
    expect((memory.value as unknown[]).length).toBe(3);
  });

  test("emit-batch appends all events in ONE write (per-chunk coalescing)", async () => {
    const editor = await createStartedEditor("");
    setup(editor);
    executeTlisp(editor, `(fikra/event/fikra-event-emit-batch (list
      (list (list "kind" "text-delta") (list "text" "a"))
      (list (list "kind" "text-delta") (list "text" "b"))
      (list (list "kind" "tool-call") (list "tool" "Bash") (list "summary" "bun test"))))`);
    const lines = readFileSync(log, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toEqual({ kind: "text-delta", text: "a" });
  });
});

describe("#212 FAEP — replay rendering (RFC §D2 table)", () => {
  test("full transcript: header, joined AI text run, tool blocks, footer", async () => {
    const editor = await createStartedEditor("");
    setup(editor);
    turn(editor, 1);
    ev(editor, "text-delta", { text: "The gap buffer " });
    ev(editor, "text-delta", { text: "is O(1) at the gap." });
    ev(editor, "tool-call", { tool: "Bash", summary: "bun test buffer" });
    ev(editor, "tool-result", { ok: "t", summary: "92 pass" });
    ev(editor, "file-change", { path: "src/x.ts", adds: "8", dels: "0" });
    ev(editor, "turn-end", { turn: "1", status: "completed" });

    const text = replay(editor);
    expect(text).toContain("── turn 1 · claude ──");
    expect(text).toContain("AI: The gap buffer is O(1) at the gap.\n");
    expect(text).toContain("⚙ Bash  bun test buffer\n");
    expect(text).toContain("  → ok 92 pass\n");
    expect(text).toContain("± src/x.ts +8 -0\n");
    expect(text).toContain("── completed ──");
  });

  test("thought, permission request/response, checkpoint lines render", async () => {
    const editor = await createStartedEditor("");
    setup(editor);
    ev(editor, "thought", { text: "considering the gap" });
    ev(editor, "permission-request", { action: "write src/x.ts" });
    ev(editor, "permission-response", { decision: "allow" });
    ev(editor, "checkpoint-ready", { ref: "refs/fikra/main/1" });
    const text = replay(editor);
    expect(text).toContain("· considering the gap\n");
    expect(text).toContain("? write src/x.ts  [y] Allow [n] Reject [a] Always\n");
    expect(text).toContain("  = allow\n");
    expect(text).toContain("  ⌘ checkpoint refs/fikra/main/1\n");
  });

  test("tombstone invalidates the turn range; rendering CONTINUES after it", async () => {
    const editor = await createStartedEditor("");
    setup(editor);
    turn(editor, 1);
    ev(editor, "text-delta", { text: "keep me" });
    ev(editor, "turn-end", { turn: "1", status: "completed" });
    turn(editor, 2);
    ev(editor, "text-delta", { text: "discard me" });
    ev(editor, "turn-end", { turn: "2", status: "completed" });
    turn(editor, 4); // post-revert turns continue PAST revert-point
    ev(editor, "text-delta", { text: "after revert" });
    ev(editor, "turn-end", { turn: "4", status: "completed" });
    // Revert to turn 1: range (1, 3] invalidated.
    ev(editor, "checkpoint-reverted", { target: "1", "revert-point": "3" });

    const text = replay(editor);
    expect(text).toContain("keep me");
    expect(text).toContain("── reverted to turn 1 (discarded through 3) ──");
    expect(text).not.toContain("discard me");
    // Post-revert turns still render.
    expect(text).toContain("after revert");
  });

  test("live *Fikra* REBUILDS on tombstone emit (no stale turns on screen)", async () => {
    const editor = await createStartedEditor("");
    setup(editor);
    executeTlisp(editor, '(buffer-create "*Fikra*")');
    executeTlisp(editor, '(buffer-switch "*Fikra*")');
    turn(editor, 1);
    ev(editor, "text-delta", { text: "keep" });
    ev(editor, "turn-end", { turn: "1", status: "completed" });
    turn(editor, 2);
    ev(editor, "text-delta", { text: "gone-text" });
    ev(editor, "turn-end", { turn: "2", status: "completed" });
    // Tombstone emit → the buffer is rebuilt from replay (stale turn gone).
    ev(editor, "checkpoint-reverted", { target: "1", "revert-point": "2" });
    const bufText = String(executeTlisp(editor, "(buffer-text)").value);
    expect(bufText).toContain("keep");
    expect(bufText).not.toContain("gone-text");
    expect(bufText).toContain("reverted to turn 1");
  });

  test("crash tolerance: trailing partial JSONL line dropped", async () => {
    writeFileSync(log, [
      '{"kind":"text-delta","text":"complete"}',
      '{"kind":"text-delta","text":"part', // interrupted mid-write
    ].join("\n")); // NO trailing newline on the partial line
    const editor = await createStartedEditor("");
    setup(editor);
    const text = replay(editor);
    expect(text).toContain("complete");
    expect(text).not.toContain("part");
  });
});

describe("#212 FAEP — incremental render into *Fikra*", () => {
  test("emit renders into *Fikra* via buffer-append when it is current", async () => {
    const editor = await createStartedEditor("");
    setup(editor);
    // Create + switch to *Fikra* like fikra-chat-open does.
    executeTlisp(editor, '(buffer-create "*Fikra*")');
    executeTlisp(editor, '(buffer-switch "*Fikra*")');
    ev(editor, "text-delta", { text: "streaming!" });

    const bufText = String(executeTlisp(editor, "(buffer-text)").value);
    expect(bufText).toContain("AI: streaming!");
    // Switching away: further emits must NOT render into this buffer.
    executeTlisp(editor, '(buffer-switch "test")');
    ev(editor, "text-delta", { text: "second-chunk" });
    expect(String(executeTlisp(editor, '(buffer-text)').value)).not.toContain("second-chunk");
    // ...but *Fikra* keeps its first render.
    executeTlisp(editor, '(buffer-switch "*Fikra*")');
    expect(String(executeTlisp(editor, '(buffer-text)').value)).toContain("AI: streaming!");
  });

  test("emit does not write into non-Fikra buffers", async () => {
    const editor = await createStartedEditor("user content");
    setup(editor);
    ev(editor, "text-delta", { text: "should not appear" });
    const bufText = String(executeTlisp(editor, "(buffer-text)").value);
    expect(bufText).not.toContain("should not appear");
    // Log still received it.
    expect(readFileSync(log, "utf8")).toContain("should not appear");
  });
});
