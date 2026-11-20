import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";
import { editorStateToJson } from "../../src/server/serialize.ts";

/**
 * @file transient-repaint.test.ts
 * @description #318 — the display-layer repaint cadence. The transient
 * layer (fikra/transient): daemon-side state OUTSIDE the buffer/event
 * log; ticks bump a revision carried in the poll response beside
 * bufferRevision; the interval runs ONLY while ≥1 thread runs.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i318-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module fikra/thread)");
  e(editor, "(require-module fikra/transient)");
  e(editor, "(fikra/thread/fikra-thread-init)");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("#318 — interval lifecycle", () => {
  test("starts on the first running thread; stops on the LAST terminal transition (no interval with zero running)", () => {
    expect(String(e(editor, "(if (fikra/transient/fikra-transient-active-p) 1 0)").value)).toBe("0");
    // First running thread starts the interval.
    e(editor, "(fikra/transient/fikra-transient-note-running \"main\")");
    expect(String(e(editor, "(if (fikra/transient/fikra-transient-active-p) 1 0)").value)).toBe("1");
    // A second running thread: still active; terminal of ONE keeps it.
    e(editor, "(fikra/transient/fikra-transient-note-running \"fix-1\")");
    e(editor, "(fikra/transient/fikra-transient-note-terminal \"main\")");
    expect(String(e(editor, "(if (fikra/transient/fikra-transient-active-p) 1 0)").value)).toBe("1");
    // Terminal of the LAST running thread stops it.
    e(editor, "(fikra/transient/fikra-transient-note-terminal \"fix-1\")");
    expect(String(e(editor, "(if (fikra/transient/fikra-transient-active-p) 1 0)").value)).toBe("0");
  });

  test("the thread status machine drives the lifecycle (turn-begin starts; turn-end stops)", () => {
    expect(String(e(editor, "(if (fikra/transient/fikra-transient-active-p) 1 0)").value)).toBe("0");
    e(editor, "(fikra/thread/fikra-thread-turn-begin)"); // -> running
    expect(String(e(editor, "(if (fikra/transient/fikra-transient-active-p) 1 0)").value)).toBe("1");
    e(editor, "(fikra/thread/fikra-thread-turn-end \"completed\")"); // -> idle
    expect(String(e(editor, "(if (fikra/transient/fikra-transient-active-p) 1 0)").value)).toBe("0");
  });

  test("a tick auto-stops when no thread runs (missed-terminal hardening)", () => {
    e(editor, "(fikra/transient/fikra-transient-note-running \"main\")");
    expect(String(e(editor, "(if (fikra/transient/fikra-transient-active-p) 1 0)").value)).toBe("1");
    e(editor, "(fikra/transient/fikra-transient-note-terminal \"main\")");
    expect(String(e(editor, "(if (fikra/transient/fikra-transient-active-p) 1 0)").value)).toBe("0");
    // An in-flight tick after the stop is a no-op (active flag guards).
    expect(String(e(editor, "(fikra/transient/fikra-transient-tick)").value)).toBe("null");
  });
});

describe("#318 — frame changes with the log byte-identical", () => {
  test("≥3 ticks bump the transient revision; the event log is UNCHANGED (byte-compare)", () => {
    e(editor, "(fikra/transient/fikra-transient-note-running \"main\")");
    const logPath = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
    e(editor, '(fikra/event/fikra-event-emit (list (list "kind" "text-delta") (list "text" "marker")))');
    const before = readFileSync(logPath, "utf8");
    const rev0 = Number(e(editor, "(fikra/transient/fikra-transient-revision)").value);
    for (let i = 0; i < 3; i++) e(editor, "(fikra/transient/fikra-transient-tick)");
    const rev3 = Number(e(editor, "(fikra/transient/fikra-transient-revision)").value);
    expect(rev3 - rev0).toBe(3);
    // THE contract: the log is byte-identical across ticks.
    expect(readFileSync(logPath, "utf8")).toBe(before);
  });

  test("the transient revision rides the poll response (serialize stamp)", () => {
    e(editor, "(fikra/transient/fikra-transient-note-running \"main\")");
    e(editor, "(fikra/transient/fikra-transient-tick)");
    // The serialize side reads the T-Lisp counter — simulate the stamp.
    const state = editor.getEditorState();
    const r = e(editor, "(fikra/transient/fikra-transient-revision)");
    (state as { transientRevision?: number }).transientRevision = Number(String((r as { value: unknown }).value));
    const wire = editorStateToJson(state, 22, 100) as { transientRevision?: number };
    expect(typeof wire.transientRevision).toBe("number");
    expect(wire.transientRevision!).toBeGreaterThan(0);
  });

  test("the spinner segment: running thread gets a rotating row; idle thread nil (focused-thread rule)", () => {
    e(editor, "(fikra/transient/fikra-transient-note-running \"main\")");
    const seg = String(e(editor, '(fikra/transient/fikra-transient-segment "main")').value);
    expect(seg).toContain("working");
    // An idle thread's segment is nil even while another runs.
    const idle = String(e(editor, '(fikra/transient/fikra-transient-segment "fix-1")').value);
    expect(idle).toBe("null");
    // Rotation: the glyph changes across ticks.
    const g1 = strip(String(e(editor, "(fikra/transient/fikra-transient-tick)") && e(editor, '(fikra/transient/fikra-transient-segment "main")').value));
    const g2 = strip(String(e(editor, "(fikra/transient/fikra-transient-tick)") && e(editor, '(fikra/transient/fikra-transient-segment "main")').value));
    expect(g1).not.toBe(g2);
  });
});
