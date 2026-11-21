import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";
import { editorStateToJson, jsonToEditorState, withTransientRevision, markTransientServed } from "../../src/server/serialize.ts";

/**
 * @file transient-repaint.test.ts
 * @description #318 — the display-layer repaint cadence (updated for
 * #319's indicator semantics: the tick carries the TS clock, and the
 * interval stops ONE TICK AFTER the last terminal — the frozen frame
 * rides a poll, the next tick clears + stops). The REAL 200ms shell is
 * silenced after setup in most tests (a live tick racing the manual
 * ones made aging nondeterministic); the tick's reconcile branch
 * re-activates the state machine on the first manual tick. The cadence
 * test alone runs the live shell (that is its subject).
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const active = (ed: Editor) => String(e(ed, "(if (fikra/transient/fikra-transient-active-p) 1 0)").value);
const tick = (ed: Editor) => e(ed, "(fikra/transient/fikra-transient-tick (editor-time-now))");
const silence = (ed: Editor) => e(ed, "(fikra/transient/fikra-transient-stop)");
const GERUND = /pondering|reading|editing/;

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

describe("#318/#319 — interval lifecycle (the REAL state machine drives it)", () => {
  test("starts on the first running thread; a terminal of ONE keeps it while another runs; the LAST terminal stops it one tick later", () => {
    expect(active(editor)).toBe("0");
    // First running thread starts the interval.
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    expect(active(editor)).toBe("1");
    // A SECOND running thread (fix-1 → running).
    e(editor, "(fikra/thread/fikra-thread-new)");
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    // Silence the live shell — manual ticks drive deterministically from
    // here (the tick's reconcile branch re-activates the state machine).
    silence(editor);
    // Terminal of ONE (main → idle) keeps the interval: fix-1 still runs.
    e(editor, '(fikra/thread/fikra-thread-focus "main")');
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
    tick(editor);
    expect(active(editor)).toBe("1");
    // Terminal of the LAST running thread: the stop is DEFERRED — the
    // frozen frame rides a poll, the tick after clears + stops (#319).
    e(editor, '(fikra/thread/fikra-thread-focus "fix-1")');
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
    expect(active(editor)).toBe("1"); // frozen still rideable
    tick(editor);
    expect(active(editor)).toBe("1"); // pending — a tick cannot clear an UNSERVED frame
    // The serve (a poll carried both frozen frames):
    e(editor, '(fikra/transient/fikra-transient-mark-rendered "main")');
    e(editor, '(fikra/transient/fikra-transient-mark-rendered "fix-1")');
    tick(editor);
    expect(active(editor)).toBe("0"); // cleared + stopped
  });

  test("a tick auto-stops on a MISSED terminal (registry-authoritative hardening)", () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    expect(active(editor)).toBe("1");
    silence(editor);
    // Simulate the missed hook: the registry goes idle WITHOUT status-set's
    // notification path (set-field bypasses the state machine's notify) —
    // so NO frozen frame exists either.
    e(editor, '(fikra/thread/fikra-thread-set-field "status" "idle")');
    tick(editor);
    expect(active(editor)).toBe("0"); // the tick caught it from the REGISTRY
    // A further tick is a no-op (the inactive guard kills the shell).
    expect(String(tick(editor).value)).toBe("null");
  });

  test("RECONCILE: a tick with the layer inactive but a thread RUNNING re-activates it (module-reload resume)", () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    expect(active(editor)).toBe("1");
    // The post-reload state shape: active flag gone (defvars reset /
    // explicit stop) while the REGISTRY still says running.
    silence(editor);
    expect(active(editor)).toBe("0");
    // The next tick RECONCILES instead of killing the interval.
    tick(editor);
    expect(active(editor)).toBe("1");
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
    e(editor, '(fikra/transient/fikra-transient-mark-rendered "main")');
    tick(editor);
    expect(active(editor)).toBe("0");
  });
});

describe("#318 — frame changes with the log byte-identical", () => {
  test("≥3 ticks bump the transient revision; the event log is UNCHANGED (byte-compare)", () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    silence(editor);
    const logPath = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
    e(editor, '(fikra/event/fikra-event-emit (list (list "kind" "text-delta") (list "text" "marker")))');
    const before = readFileSync(logPath, "utf8");
    const rev0 = Number(e(editor, "(fikra/transient/fikra-transient-revision)").value);
    for (let i = 0; i < 3; i++) tick(editor);
    const rev3 = Number(e(editor, "(fikra/transient/fikra-transient-revision)").value);
    expect(rev3 - rev0).toBe(3);
    // THE contract: the log is byte-identical across ticks.
    expect(readFileSync(logPath, "utf8")).toBe(before);
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
  });

  test("the REAL 200ms interval shell ticks on its own (the cadence is live, the log stays frozen, the stop self-settles)", async () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    const logPath = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
    const before = readFileSync(logPath, "utf8");
    const c0 = Number(e(editor, "(fikra/transient/fikra-transient-count)").value);
    try {
      // 900ms window at a 200ms cadence = ~4 expected ticks; asserting
      // ≥2 leaves 4.5x slack for timer coalescing on a loaded runner.
      await new Promise((r) => setTimeout(r, 900));
      const c1 = Number(e(editor, "(fikra/transient/fikra-transient-count)").value);
      expect(c1 - c0).toBeGreaterThanOrEqual(2);
      expect(readFileSync(logPath, "utf8")).toBe(before);
    } finally {
      e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
      // The serve (a live client's poll would do this via the wire):
      e(editor, '(fikra/transient/fikra-transient-mark-rendered "main")');
    }
    // The shell settles the deferred stop itself (one tick ≈ 200ms;
    // 600ms is a 3x window).
    await new Promise((r) => setTimeout(r, 600));
    expect(active(editor)).toBe("0");
  });

  test("the spinner GLYPH rotates across ticks (pinned directly, not via the revision-bearing segment)", () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    silence(editor);
    const glyphs = [0, 1, 2, 3, 4].map(() => strip(String(e(editor, "(progn (fikra/transient/fikra-transient-tick (editor-time-now)) (fikra/transient/fikra-transient-spinner-glyph))").value)));
    // 4-frame rotation: the 5th tick returns to the 1st frame.
    expect(new Set(glyphs.slice(0, 4)).size).toBe(4);
    expect(glyphs[4]).toBe(glyphs[0]);
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
  });
});

describe("#318/#319 — the wire: segment + revision through the REAL helper", () => {
  const interpOf = (ed: Editor) => (ed as unknown as { interpreter: { execute: (x: string) => unknown } }).interpreter;

  test("the stamp rides the wire for the VIEWED thread's buffer; a mid-turn attach sees the CURRENT revision; the terminal sequence is frozen→clear", () => {
    // View main's *Fikra* buffer, start a turn, tick.
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    silence(editor);
    tick(editor);
    const state = withTransientRevision(editor.getEditorState(), interpOf(editor));
    const wire = editorStateToJson(state, 22, 100) as { transientRevision?: number; transientSegment?: string };
    expect(typeof wire.transientRevision).toBe("number");
    expect(wire.transientRevision!).toBeGreaterThan(0);
    expect(wire.transientSegment).toMatch(GERUND);
    // MID-TURN ATTACH: a fresh poll (a client attaching now) sees the
    // CURRENT revision — three more ticks land on the next stamp.
    const revAtAttach = wire.transientRevision!;
    for (let i = 0; i < 3; i++) tick(editor);
    const wire2 = editorStateToJson(withTransientRevision(editor.getEditorState(), interpOf(editor)), 22, 100) as { transientRevision?: number };
    expect(wire2.transientRevision!).toBe(revAtAttach + 3);
    // TERMINAL SEQUENCE (#319): the first frame after terminal is FROZEN
    // (✓ + the final counts); the tick after clears it.
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
    const wireFrozen = editorStateToJson(withTransientRevision(editor.getEditorState(), interpOf(editor)), 22, 100) as { transientSegment?: string };
    expect(wireFrozen.transientSegment).toMatch(/^✓/);
    // The KEYLESS stamp alone does NOT acknowledge (a keypress response is
    // an input round-trip — tmaxclient --keys discards it; codex r4); the
    // POLL (markTransientServed, the render-state handler's seam) does.
    tick(editor);
    expect((editorStateToJson(withTransientRevision(editor.getEditorState(), interpOf(editor)), 22, 100) as { transientSegment?: string }).transientSegment).toMatch(/^✓/);
    markTransientServed(interpOf(editor), "*Fikra*");
    tick(editor);
    const wireClear = editorStateToJson(withTransientRevision(editor.getEditorState(), interpOf(editor)), 22, 100) as { transientSegment?: string };
    expect(wireClear.transientSegment).toBeUndefined();
  });

  test("PER-FRAME viewed threads: main's buffer gets the spinner; an idle fix-1's gets none — concurrently", () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)"); // main running
    e(editor, "(fikra/thread/fikra-thread-new)"); // fix-1 exists, idle
    silence(editor);
    tick(editor);
    // The T-Lisp resolution (what the helper evaluates per frame):
    const segMain = String(e(editor, '(fikra/transient/fikra-transient-viewed-segment-for "*Fikra*")').value);
    expect(segMain).toMatch(GERUND);
    const segFix = String(e(editor, '(fikra/transient/fikra-transient-viewed-segment-for "*Fikra-fix-1*")').value);
    expect(segFix).toBe("null");
    // A NON-fikra buffer gets no spinner.
    const segScratch = String(e(editor, '(fikra/transient/fikra-transient-viewed-segment-for "*scratch*")').value);
    expect(segScratch).toBe("null");
    // The HELPER path with a frame state viewing each buffer:
    const sMain = withTransientRevision({ ...editor.getEditorState(), currentBufferName: "*Fikra*" }, interpOf(editor)) as { transientSegment?: string };
    expect(sMain.transientSegment).toMatch(GERUND);
    const sFix = withTransientRevision({ ...editor.getEditorState(), currentBufferName: "*Fikra-fix-1*" }, interpOf(editor)) as { transientSegment?: string };
    expect(sFix.transientSegment).toBeUndefined();
    e(editor, '(fikra/thread/fikra-thread-focus "main")');
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
  });

  test("the CLIENT half: jsonToEditorState carries the segment — render()'s field survives the round-trip", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    silence(editor);
    tick(editor);
    const wire = editorStateToJson(withTransientRevision(editor.getEditorState(), interpOf(editor)), 22, 100);
    const clientState = jsonToEditorState(wire) as { transientRevision?: number; transientSegment?: string };
    expect(clientState.transientSegment).toMatch(GERUND);
    expect(clientState.transientRevision!).toBeGreaterThan(0);
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
    markTransientServed(interpOf(editor), "*Fikra*"); // the poll's acknowledgment
    tick(editor);
    const wireIdle = editorStateToJson(withTransientRevision(editor.getEditorState(), interpOf(editor)), 22, 100);
    expect((jsonToEditorState(wireIdle) as { transientSegment?: string }).transientSegment).toBeUndefined();
  });

  test("the spinner reservation over-sends ONE row: the former bottom line survives the client's viewport advance (codex r4)", () => {
    e(editor, `(buffer-insert "${Array.from({ length: 30 }, (_, i) => `line-${i}`).join("\\n")}\\n")`);
    const state = editor.getEditorState();
    const withSeg = { ...state, viewportTop: 0, transientSegment: "| pondering · 3 chunks · 4s" };
    const wireSeg = editorStateToJson(withSeg, 22, 100);
    expect(wireSeg.visibleLines!.length).toBe(23); // rows + the reserved row
    const client = jsonToEditorState(wireSeg);
    const formerBottom = client.currentBuffer!.getLine(22);
    expect(String((formerBottom as { right?: unknown }).right ?? formerBottom)).toContain("line-22");
    // Control: WITHOUT the segment the wire stays at the 22-row window.
    const wirePlain = editorStateToJson({ ...state, viewportTop: 0 }, 22, 100);
    expect(wirePlain.visibleLines!.length).toBe(22);
  });

  test("the reservation survives word wrap (codex r5: the wrap walk must not swallow the extra row)", () => {
    e(editor, `(buffer-insert "${Array.from({ length: 30 }, (_, i) => `line-${i}`).join("\\n")}\\n")`);
    const state = editor.getEditorState();
    const wrapped = { ...state, viewportTop: 0, config: { ...state.config, wordWrap: true }, transientSegment: "| pondering · 3 chunks · 4s" };
    const wireWrap = editorStateToJson(wrapped, 22, 100);
    expect(wireWrap.visibleLines!.length).toBe(23);
    // And genuinely-wrapping long lines: the wrapped window + the +1.
    e(editor, `(buffer-insert "${("x".repeat(200) + "\\n").repeat(5)}")`);
    const state2 = editor.getEditorState();
    const wrappedLong = { ...state2, viewportTop: 0, config: { ...state2.config, wordWrap: true }, transientSegment: "| pondering" };
    const wireLong = editorStateToJson(wrappedLong, 22, 100);
    const plainLong = editorStateToJson({ ...state2, viewportTop: 0, config: { ...state2.config, wordWrap: true } }, 22, 100);
    expect(wireLong.visibleLines!.length).toBe(plainLong.visibleLines!.length + 1);
  });
});
