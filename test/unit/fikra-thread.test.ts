import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

// #213 (RFC-027 §D3/§D7, Phase 1 minimal) — thread core: state machine,
// persistence, reopen-after-restart, project-root detection.

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

let repoDir = "";
const repoDirs: string[] = [];
const originalCwd = process.cwd();

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "fikra-thread-"));
  repoDirs.push(repoDir);
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  process.chdir(repoDir);
});

afterAll(() => {
  process.chdir(originalCwd);
  for (const dir of repoDirs) rmSync(dir, { recursive: true, force: true });
});

const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);

describe("#213 thread core — init + persistence", () => {
  test("init creates .tmax/fikra/threads/main under the git root and wires FAEP", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/thread)");
    expect(String(e(editor, "(fikra/thread/fikra-thread-init)").value)).toBe("main");
    const log = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
    expect(log).toBe(join(realpathSync(repoDir), ".tmax/fikra/threads/main/events.jsonl"));
    expect(String(e(editor, "(fikra/thread/fikra-thread-current)").value)).toBe("main");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
  });

  test("session-id persists to state.json and survives a fresh editor (restart)", async () => {
    const editorA = await createStartedEditor("");
    e(editorA, "(require-module fikra/thread)");
    e(editorA, "(fikra/thread/fikra-thread-init)");
    e(editorA, '(fikra/thread/fikra-thread-set-session-id "sess-42")');
    const statePath = join(repoDir, ".tmax/fikra/threads/main/state.json");
    const persisted = JSON.parse(readFileSync(statePath, "utf8"));
    expect(persisted.session_id ?? persisted["session-id"]).toBe("sess-42");

    // "Restart": a second editor on the same repo loads the persisted state.
    const editorB = await createStartedEditor("");
    e(editorB, "(require-module fikra/thread)");
    e(editorB, "(fikra/thread/fikra-thread-init)");
    expect(String(e(editorB, "(fikra/thread/fikra-thread-session-id)").value)).toBe("sess-42");
  });

  test("a thread left 'running' by a crash loads back as idle (status is runtime-only)", async () => {
    const editorA = await createStartedEditor("");
    e(editorA, "(require-module fikra/thread)");
    e(editorA, "(fikra/thread/fikra-thread-init)");
    e(editorA, "(fikra/thread/fikra-thread-turn-begin)"); // running
    expect(String(e(editorA, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
    // No turn-end — simulate a crash: process dies mid-turn.

    const editorB = await createStartedEditor("");
    e(editorB, "(require-module fikra/thread)");
    e(editorB, "(fikra/thread/fikra-thread-init)");
    expect(String(e(editorB, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    // ...and the turn count survived.
    expect(Number(e(editorB, "(fikra/thread/fikra-thread-turn-count)").value)).toBe(1);
  });
});

describe("#213 thread core — state machine", () => {
  test("legal lifecycle: idle→running→idle, error/interrupted recovery, confirming round-trip", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/thread)");
    e(editor, "(fikra/thread/fikra-thread-init)");

    expect(String(e(editor, '(fikra/thread/fikra-thread-status-set "running")').value)).toBe("running");
    expect(String(e(editor, '(fikra/thread/fikra-thread-status-set "confirming")').value)).toBe("confirming");
    expect(String(e(editor, '(fikra/thread/fikra-thread-status-set "running")').value)).toBe("running");
    expect(String(e(editor, '(fikra/thread/fikra-thread-status-set "error")').value)).toBe("error");
    expect(String(e(editor, '(fikra/thread/fikra-thread-status-set "running")').value)).toBe("running");
    // Interrupt from confirming (a pending approval) is legal — the
    // confirmation is swept to reject (#210) and the turn interrupts.
    expect(String(e(editor, '(fikra/thread/fikra-thread-status-set "confirming")').value)).toBe("confirming");
    expect(String(e(editor, '(fikra/thread/fikra-thread-status-set "interrupted")').value)).toBe("interrupted");
    expect(String(e(editor, '(fikra/thread/fikra-thread-status-set "running")').value)).toBe("running");
  });

  test("illegal transitions error", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/thread)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    // idle → error is illegal (nothing failed yet)
    let threw = false;
    try { e(editor, '(fikra/thread/fikra-thread-status-set "error")'); } catch { threw = true; }
    expect(threw).toBe(true);
    // idle → confirming is illegal
    threw = false;
    try { e(editor, '(fikra/thread/fikra-thread-status-set "confirming")'); } catch { threw = true; }
    expect(threw).toBe(true);
  });

  test("illegal turn-begin (begin-while-running) does NOT bump the turn count", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/thread)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    e(editor, "(fikra/thread/fikra-thread-turn-begin)"); // count 1, running
    // A second begin while running is illegal — must throw AND leave the
    // count at 1 (validate-before-bump).
    let threw = false;
    try { e(editor, "(fikra/thread/fikra-thread-turn-begin)"); } catch { threw = true; }
    expect(threw).toBe(true);
    expect(Number(e(editor, "(fikra/thread/fikra-thread-turn-count)").value)).toBe(1);
  });

  test("turn lifecycle: begin bumps count + emits turn-start; end settles status + emits turn-end", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/thread)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    expect(Number(e(editor, "(fikra/thread/fikra-thread-turn-begin)").value)).toBe(1);
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
    e(editor, "(fikra/thread/fikra-thread-turn-end \"completed\")");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");

    const log = readFileSync(join(repoDir, ".tmax/fikra/threads/main/events.jsonl"), "utf8");
    const kinds = log.trimEnd().split("\n").map((l) => JSON.parse(l).kind);
    expect(kinds).toEqual(["turn-start", "turn-end"]);
    // error turn-end settles to error status
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    e(editor, "(fikra/thread/fikra-thread-turn-end \"error\")");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("error");
  });
});

describe("#213 thread core — reopen replays history into *Fikra*", () => {
  test("open on an existing thread replays the log; a fresh editor sees the full transcript", async () => {
    const editorA = await createStartedEditor("");
    e(editorA, "(require-module fikra/thread)");
    e(editorA, "(fikra/thread/fikra-thread-open)");
    e(editorA, "(fikra/thread/fikra-thread-turn-begin)");
    e(editorA, '(fikra/event/fikra-event-emit (list (list "kind" "text-delta") (list "text" "persisted turn text")))');
    e(editorA, "(fikra/thread/fikra-thread-turn-end \"completed\")");

    // "Daemon restart": fresh editor, same repo. Open replays history.
    const editorB = await createStartedEditor("");
    e(editorB, "(require-module fikra/thread)");
    e(editorB, "(fikra/thread/fikra-thread-open)");
    const buf = String(e(editorB, '(buffer-text)').value);
    expect(buf).toContain("AI: persisted turn text");
    expect(buf).toContain("── turn 1");
    // Fresh editor's *Fikra* buffer was created + focused.
    expect(String(e(editorB, '(buffer-current)').value)).toBe("*Fikra*");
  });

  test("open on a fresh repo yields an empty *Fikra* and no crash", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/thread)");
    expect(String(e(editor, "(fikra/thread/fikra-thread-open)").value)).toBe("*Fikra*");
    expect(String(e(editor, '(buffer-current)').value)).toBe("*Fikra*");
    // Empty log — no events, no error.
    expect(existsSync(join(repoDir, ".tmax/fikra/threads/main/events.jsonl"))).toBe(false);
  });
});
