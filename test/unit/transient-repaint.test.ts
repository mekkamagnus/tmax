import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";
import { editorStateToJson, jsonToEditorState, withTransientRevision } from "../../src/server/serialize.ts";

/**
 * @file transient-repaint.test.ts
 * @description #318 — the display-layer repaint cadence. The transient
 * layer (fikra/transient): daemon-side state OUTSIDE the buffer/event
 * log; ticks bump a revision carried in the poll response beside
 * bufferRevision; the interval runs ONLY while ≥1 thread runs. Gate r2 /
 * codex r1 hardening: the lifecycle drives through the REAL thread
 * state machine, the tick's auto-stop asks the AUTHORITATIVE registry
 * (a missed notification is caught), the glyph rotation is pinned
 * directly, the REAL 200ms interval shell fires, and the segment
 * survives the FULL wire round-trip into the client EditorState (what
 * render() reads) — including the per-frame viewed-thread resolution.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const active = (ed: Editor) => String(e(ed, "(if (fikra/transient/fikra-transient-active-p) 1 0)").value);

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

describe("#318 — interval lifecycle (the REAL state machine drives it)", () => {
  test("starts on the first running thread; a terminal of ONE keeps it while another runs; the LAST terminal stops it", () => {
    expect(active(editor)).toBe("0");
    // First running thread starts the interval (main → running).
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    expect(active(editor)).toBe("1");
    // A SECOND running thread (fix-1 → running).
    e(editor, "(fikra/thread/fikra-thread-new)");
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    // Terminal of ONE (main → idle) keeps the interval: fix-1 still runs.
    e(editor, '(fikra/thread/fikra-thread-focus "main")');
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
    expect(active(editor)).toBe("1");
    // Terminal of the LAST running thread stops it.
    e(editor, '(fikra/thread/fikra-thread-focus "fix-1")');
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
    expect(active(editor)).toBe("0");
  });

  test("a tick auto-stops on a MISSED terminal (registry-authoritative hardening)", () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    expect(active(editor)).toBe("1");
    // Simulate the missed hook: the registry goes idle WITHOUT status-set's
    // notification path (set-field bypasses the state machine's notify).
    e(editor, '(fikra/thread/fikra-thread-set-field "status" "idle")');
    expect(active(editor)).toBe("1"); // the interval is STILL live (missed)
    e(editor, "(fikra/transient/fikra-transient-tick)");
    expect(active(editor)).toBe("0"); // the tick caught it from the REGISTRY
    // A further tick is a no-op (the inactive guard).
    expect(String(e(editor, "(fikra/transient/fikra-transient-tick)").value)).toBe("null");
  });

  test("RECONCILE: a tick with the layer inactive but a thread RUNNING re-activates it (module-reload resume)", () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    expect(active(editor)).toBe("1");
    // The post-reload state shape: active flag gone (defvars reset /
    // explicit stop) while the REGISTRY still says running.
    e(editor, "(fikra/transient/fikra-transient-stop)");
    expect(active(editor)).toBe("0");
    // The next tick RECONCILES instead of killing the interval.
    e(editor, "(fikra/transient/fikra-transient-tick)");
    expect(active(editor)).toBe("1");
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
    expect(active(editor)).toBe("0");
  });
});

describe("#318 — frame changes with the log byte-identical", () => {
  test("≥3 ticks bump the transient revision; the event log is UNCHANGED (byte-compare)", () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    const logPath = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
    e(editor, '(fikra/event/fikra-event-emit (list (list "kind" "text-delta") (list "text" "marker")))');
    const before = readFileSync(logPath, "utf8");
    const rev0 = Number(e(editor, "(fikra/transient/fikra-transient-revision)").value);
    for (let i = 0; i < 3; i++) e(editor, "(fikra/transient/fikra-transient-tick)");
    const rev3 = Number(e(editor, "(fikra/transient/fikra-transient-revision)").value);
    expect(rev3 - rev0).toBe(3);
    // THE contract: the log is byte-identical across ticks.
    expect(readFileSync(logPath, "utf8")).toBe(before);
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
  });

  test("the REAL 200ms interval shell ticks on its own (the cadence is live, the log stays frozen)", async () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    const logPath = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
    const before = readFileSync(logPath, "utf8");
    const c0 = Number(e(editor, "(fikra/transient/fikra-transient-count)").value);
    try {
      // 900ms window at a 200ms cadence = ~4 expected ticks; asserting
      // ≥2 leaves 4.5x slack for timer coalescing on a loaded runner
      // (gate r3 flake note).
      await new Promise((r) => setTimeout(r, 900));
      const c1 = Number(e(editor, "(fikra/transient/fikra-transient-count)").value);
      expect(c1 - c0).toBeGreaterThanOrEqual(2);
      expect(readFileSync(logPath, "utf8")).toBe(before);
    } finally {
      e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
    }
    expect(active(editor)).toBe("0");
  });

  test("the spinner GLYPH rotates across ticks (pinned directly, not via the revision-bearing segment)", () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    const glyphs = [0, 1, 2, 3, 4].map(() => strip(String(e(editor, "(progn (fikra/transient/fikra-transient-tick) (fikra/transient/fikra-transient-spinner-glyph))").value)));
    // 4-frame rotation: the 5th tick returns to the 1st frame.
    expect(new Set(glyphs.slice(0, 4)).size).toBe(4);
    expect(glyphs[4]).toBe(glyphs[0]);
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
  });
});

describe("#318 — the wire: segment + revision through the REAL helper", () => {
  const interpOf = (ed: Editor) => (ed as unknown as { interpreter: { execute: (x: string) => unknown } }).interpreter;

  test("the stamp rides the wire for the VIEWED thread's buffer; a mid-turn attach sees the CURRENT revision", () => {
    // View main's *Fikra* buffer, start a turn, tick.
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    e(editor, "(fikra/transient/fikra-transient-tick)");
    const state = withTransientRevision(editor.getEditorState(), interpOf(editor));
    const wire = editorStateToJson(state, 22, 100) as { transientRevision?: number; transientSegment?: string };
    expect(typeof wire.transientRevision).toBe("number");
    expect(wire.transientRevision!).toBeGreaterThan(0);
    expect(wire.transientSegment).toContain("working");
    // MID-TURN ATTACH: a fresh poll (a client attaching now) sees the
    // CURRENT revision — three more ticks land on the next stamp.
    const revAtAttach = wire.transientRevision!;
    for (let i = 0; i < 3; i++) e(editor, "(fikra/transient/fikra-transient-tick)");
    const wire2 = editorStateToJson(withTransientRevision(editor.getEditorState(), interpOf(editor)), 22, 100) as { transientRevision?: number };
    expect(wire2.transientRevision!).toBe(revAtAttach + 3);
    // Idle viewed thread → NO segment on the wire (the focused rule).
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
    const wire3 = editorStateToJson(withTransientRevision(editor.getEditorState(), interpOf(editor)), 22, 100) as { transientSegment?: string };
    expect(wire3.transientSegment).toBeUndefined();
  });

  test("PER-FRAME viewed threads: main's buffer gets the spinner; an idle fix-1's gets none — concurrently", () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)"); // main running
    e(editor, "(fikra/thread/fikra-thread-new)"); // fix-1 exists, idle
    e(editor, "(fikra/transient/fikra-transient-tick)");
    // The T-Lisp resolution (what the helper evaluates per frame):
    const segMain = String(e(editor, '(fikra/transient/fikra-transient-viewed-segment-for "*Fikra*")').value);
    expect(segMain).toContain("working");
    const segFix = String(e(editor, '(fikra/transient/fikra-transient-viewed-segment-for "*Fikra-fix-1*")').value);
    expect(segFix).toBe("null");
    // A NON-fikra buffer gets no spinner.
    const segScratch = String(e(editor, '(fikra/transient/fikra-transient-viewed-segment-for "*scratch*")').value);
    expect(segScratch).toBe("null");
    // The HELPER path with a frame state viewing each buffer:
    const sMain = withTransientRevision({ ...editor.getEditorState(), currentBufferName: "*Fikra*" }, interpOf(editor)) as { transientSegment?: string };
    expect(sMain.transientSegment).toContain("working");
    const sFix = withTransientRevision({ ...editor.getEditorState(), currentBufferName: "*Fikra-fix-1*" }, interpOf(editor)) as { transientSegment?: string };
    expect(sFix.transientSegment).toBeUndefined();
    e(editor, '(fikra/thread/fikra-thread-focus "main")');
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
  });

  test("the CLIENT half: jsonToEditorState carries the segment — render()'s field survives the round-trip", () => {
    // THE gate-r2 CRITICAL regression pin: the wire half was live but the
    // client deserializer dropped the field — the spinner was dead code
    // in the live TUI.
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    e(editor, "(fikra/transient/fikra-transient-tick)");
    const wire = editorStateToJson(withTransientRevision(editor.getEditorState(), interpOf(editor)), 22, 100);
    const clientState = jsonToEditorState(wire) as { transientRevision?: number; transientSegment?: string };
    expect(clientState.transientSegment).toContain("working");
    expect(clientState.transientRevision!).toBeGreaterThan(0);
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
    const wireIdle = editorStateToJson(withTransientRevision(editor.getEditorState(), interpOf(editor)), 22, 100);
    expect((jsonToEditorState(wireIdle) as { transientSegment?: string }).transientSegment).toBeUndefined();
  });
});
