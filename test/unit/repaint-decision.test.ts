import { describe, test, expect } from "bun:test";
import { shouldRepaint, repaintSnapshot, spinnerRowReserved, type RepaintSnapshot } from "../../src/client/repaint-decision.ts";

/**
 * @file repaint-decision.test.ts
 * @description #318 (codex r2 catch 2): the poll's repaint decision is
 * PURE and pinned — the transient-only case (spinner ticks with the
 * buffer revision FIXED) must repaint; an unchanged snapshot pair must
 * not. `bufferRevision` on the wire is a fresh Date.now() per response,
 * so without this pin a broken transient compare hides behind it.
 */

const base: RepaintSnapshot = {
  bufferRevision: 100,
  transientRevision: 5,
  mode: "normal",
  viewportTop: 0,
  statusMessage: "",
  cursorLine: 0,
  cursorColumn: 0,
  flashJson: "undefined",
  ghostText: undefined,
};
const snap = (over: Partial<RepaintSnapshot> = {}): RepaintSnapshot => ({ ...base, ...over });

describe("#318 — the pure repaint decision", () => {
  test("TRANSIENT-ONLY change repaints: 5→6 with bufferRevision FIXED (the #318 contract)", () => {
    expect(shouldRepaint(snap({ transientRevision: 5 }), snap({ transientRevision: 6 }))).toBe(true);
  });

  test("identical snapshots do NOT repaint (the O(1) no-op)", () => {
    expect(shouldRepaint(snap(), snap())).toBe(false);
  });

  test("each independent field still drives a repaint on its own", () => {
    expect(shouldRepaint(snap(), snap({ bufferRevision: 101 }))).toBe(true);
    expect(shouldRepaint(snap(), snap({ mode: "insert" }))).toBe(true);
    expect(shouldRepaint(snap(), snap({ viewportTop: 4 }))).toBe(true);
    expect(shouldRepaint(snap(), snap({ statusMessage: "saved" }))).toBe(true);
    expect(shouldRepaint(snap(), snap({ cursorLine: 2 }))).toBe(true);
    expect(shouldRepaint(snap(), snap({ cursorColumn: 7 }))).toBe(true);
    // #231: flash onset (undefined → spans) and supersede (yy → y) both repaint.
    expect(shouldRepaint(snap(), snap({ flashJson: '[{"start":0}]' }))).toBe(true);
    expect(shouldRepaint(snap({ flashJson: '"yy"' }), snap({ flashJson: '"y"' }))).toBe(true);
    // §8.8: ghost onset.
    expect(shouldRepaint(snap(), snap({ ghostText: "suggestion" }))).toBe(true);
  });

  test("repaintSnapshot maps the state + BOTH counters (the poll's inputs)", () => {
    const state = {
      mode: "normal",
      viewportTop: 3,
      statusMessage: "msg",
      cursorPosition: { line: 1, column: 2 },
      flashSpans: undefined,
      ghostText: undefined,
    } as Parameters<typeof repaintSnapshot>[0];
    const s = repaintSnapshot(state, 42, 7);
    expect(s.bufferRevision).toBe(42);
    expect(s.transientRevision).toBe(7);
    expect(s.viewportTop).toBe(3);
    expect(s.cursorLine).toBe(1);
    expect(s.cursorColumn).toBe(2);
    expect(s.statusMessage).toBe("msg");
  });
});

describe("#318 — the reserved spinner row (codex r3: the buffer keeps its last line)", () => {
  const st = (over: Record<string, unknown>) => ({
    transientSegment: "| working…",
    mode: "normal",
    statusMessage: "",
    ...over,
  }) as Parameters<typeof spinnerRowReserved>[0];

  test("segment present in normal mode → row RESERVED (buffer shrinks by one)", () => {
    expect(spinnerRowReserved(st({}))).toBe(true);
  });

  test("a status message does NOT release the row (stable layout for the whole turn)", () => {
    expect(spinnerRowReserved(st({ statusMessage: "Fikra: approve?" }))).toBe(true);
  });

  test("command/mx modes and the minibuffer already own the bottom rows → no extra reservation", () => {
    expect(spinnerRowReserved(st({ mode: "command" }))).toBe(false);
    expect(spinnerRowReserved(st({ mode: "mx" }))).toBe(false);
    expect(spinnerRowReserved(st({ minibufferView: { prompt: "m:" } }))).toBe(false);
  });

  test("no segment → no reservation (the row returns to the buffer)", () => {
    expect(spinnerRowReserved(st({ transientSegment: undefined }))).toBe(false);
  });
});
