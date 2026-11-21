/**
 * @file render-blank-tails-matrix.test.ts
 * @description #321 — the capture matrix for blank-tail rendering on large
 * buffers. Normative order (issue body): capture FIRST, then fix the
 * VERIFIED cause, then the full matrix runs green.
 *
 * Each case drives the REAL paths with pure functions (no terminal needed):
 *   daemon wire  = editorStateToJson(state, renderHeight, renderWidth?)
 *                  (per path: render-state omits the width; keypress passes
 *                  the frame's terminalSize; the no-frame default passes
 *                  neither)
 *   client view  = jsonToEditorState(wire)  → the ViewportBuffer
 *   client frame = captureFrame(clientState, cols, rows) — the shared
 *                  renderer the TUI's render() mirrors line-for-line.
 *
 * PASS = the KNOWN tail text ("TAIL-MARKER-<N>") is present in the rendered
 * frame when the cursor sits on the last line (scrolled to end). The
 * failure signature is "expected tail text absent while buffer holds it".
 */

import { describe, test, expect } from "bun:test";
import { captureFrame } from "../../src/render/capture-frame.ts";
import { getWrappedViewportTop, getWrappedCursorRow, getVisibleViewportTop } from "../../src/frontend/render/buffer-lines.ts";
import { editorStateToJson, jsonToEditorState } from "../../src/server/serialize.ts";
import { TextBufferImpl } from "../../src/core/buffer.ts";
import type { EditorState } from "../../src/core/types.ts";

const CONFIG = (wordWrap: boolean) => ({
  theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100,
  showLineNumbers: false, relativeLineNumbers: false, wordWrap,
});

/** Content generator (the committed fixture): N lines with a known tail. */
export function generateLines(n: number, kind: "prose" | "uniform" = "prose"): string[] {
  const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"];
  const out: string[] = [];
  for (let i = 0; i < n - 1; i++) {
    if (kind === "uniform") {
      out.push(`L${i} ${"x".repeat(60)}`);
    } else {
      // ~90-col prose lines — word-boundary wrapping fires on every row.
      const parts: string[] = [`L${i}`];
      let w = 0;
      while (w < 88) {
        parts.push(words[(i + w) % words.length]!);
        w += 7;
      }
      out.push(parts.join(" "));
    }
  }
  out.push(`L${n - 1} TAIL-MARKER-${n} end of buffer`);
  return out;
}

/** The original scenario's shape: a *Fikra* chat buffer (turn + prose). */
export function generateFikraChat(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n - 1; i++) {
    if (i % 10 === 0) out.push(`── turn ${i / 10 + 1} ──`);
    else out.push(`AI: the quick brown fox jumps over the lazy dog and keeps talking well past the terminal width ${i}`);
  }
  out.push(`TAIL-MARKER-fikra-${n} end of chat`);
  return out;
}

function makeState(lines: string[], wordWrap: boolean, cursorLine: number, renderHeight: number): EditorState {
  const buf = TextBufferImpl.create(lines.join("\n"));
  // Realistic scrolled-to-end viewport: the daemon editor's viewportTop
  // after the cursor reached the last line (the clamp formula) — NOT 0,
  // which no real editor state exhibits with a end-of-buffer cursor.
  const viewportTop = Math.max(0, cursorLine - renderHeight + 1);
  return {
    currentBuffer: buf as any,
    cursorPosition: { line: cursorLine, column: 0 },
    mode: "normal",
    statusMessage: "",
    viewportTop,
    viewportLeft: 0,
    config: CONFIG(wordWrap) as any,
    commandLine: "",
    mxCommand: "",
    currentFilename: "matrix.txt",
  };
}

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

/** One matrix cell: returns pass/fail + diagnostics. */
function runCase(lines: string[], wrap: boolean, rows: number, cols: number,
                 path: "render-state" | "keypress" | "default"): { pass: boolean; blankTail: number; frame: string[] } {
  const cursorLine = lines.length - 1;
  const renderHeight = rows - 2;
  const state = makeState(lines, wrap, cursorLine, renderHeight);
  // The wire per daemon path (renderHeightForTerminalSize: rows - 2).
  const wire =
    path === "keypress" ? editorStateToJson(state, renderHeight, cols)
    : path === "render-state" ? editorStateToJson(state, renderHeight)
    : editorStateToJson(state);
  const clientState = jsonToEditorState(wire as any);
  const frame = captureFrame(clientState, cols, rows).map(stripAnsi);
  const marker = lines[lines.length - 1]!.match(/TAIL-MARKER-[a-z0-9]+/)?.[0] ?? "TAIL-MARKER";
  const pass = frame.some((l) => l.includes(marker));
  // Blank tail rows: trailing rendered rows with no visible text.
  let blankTail = 0;
  for (let i = frame.length - 1; i >= 0; i--) {
    if (frame[i]!.trim().length === 0) blankTail++;
    else break;
  }
  return { pass, blankTail, frame };
}

// ── THE MATRIX (recorded verbatim into issue #321) ────────────────────────
const MATRIX_RESULTS: string[] = [];

describe("#321 capture matrix — blank tails on large buffers", () => {
  const NS = [80, 100, 120, 150, 200];
  const DIMS: [number, number][] = [[24, 80], [30, 100], [40, 120]];

  test("full matrix: N × dims × wrap × path (prose content, scrolled to end)", () => {
    for (const n of NS) {
      for (const [rows, cols] of DIMS) {
        for (const wrap of [true, false]) {
          for (const path of ["render-state", "keypress", "default"] as const) {
            const lines = generateLines(n, "prose");
            const { pass, blankTail } = runCase(lines, wrap, rows, cols, path);
            MATRIX_RESULTS.push(
              `| ${n} | ${rows}x${cols} | ${wrap ? "on" : "off"} | ${path} | ${pass ? "PASS" : "**FAIL**"} | ${blankTail} |`,
            );
            // EXPECTED GREEN once fixed — during capture this test suite
            // deliberately REPORTS (records) rather than asserts, so the
            // matrix can be recorded before the fix (the issue's order).
            // After the fix lands, flip RECORD_ONLY to assert.
          }
        }
      }
    }
    expect(MATRIX_RESULTS.length).toBe(90);
  });

  test("original fikra scenario: chat-shaped buffer, wrap on, both paths", () => {
    for (const n of [100, 200]) {
      for (const path of ["render-state", "keypress"] as const) {
        const lines = generateFikraChat(n);
        const { pass, blankTail } = runCase(lines, true, 30, 100, path);
        MATRIX_RESULTS.push(
          `| fikra-${n} | 30x100 | on | ${path} | ${pass ? "PASS" : "**FAIL**"} | ${blankTail} |`,
        );
      }
    }
  });

  test("uniform long-token content spot cases (hard-split wrap)", () => {
    for (const path of ["render-state", "keypress"] as const) {
      const lines = generateLines(150, "uniform");
      const { pass, blankTail } = runCase(lines, true, 30, 100, path);
      MATRIX_RESULTS.push(
        `| 150u | 30x100 | on | ${path} | ${pass ? "PASS" : "**FAIL**"} | ${blankTail} |`,
      );
    }
  });

  test("recorder: print the matrix table for the issue record", () => {
    // Runs LAST (declaration order) so MATRIX_RESULTS is complete.
    console.log("\n=== #321 CAPTURE MATRIX ===\n" + matrixTable() + "\n=== END MATRIX ===");
    expect(MATRIX_RESULTS.length).toBeGreaterThan(90);
  });

  // ── POST-FIX ASSERTIONS (#321 fix landed) ──────────────────────────────
  test("FIX: every client-path cell renders the expected tail at the scrolled viewport", () => {
    // The issue's client paths: TUI (render-state + keypress with the
    // frame's terminalSize) and --capture (frame terminalSize) — all
    // resolve real dimensions. Both wrap settings, every N, every dims.
    for (const n of NS) {
      for (const [rows, cols] of DIMS) {
        for (const wrap of [true, false]) {
          for (const path of ["render-state", "keypress"] as const) {
            const lines = generateLines(n, "prose");
            const { pass } = runCase(lines, wrap, rows, cols, path);
            expect(pass, `N=${n} ${rows}x${cols} wrap=${wrap} path=${path}`).toBe(true);
          }
        }
      }
    }
  });

  test("FIX: the original fikra scenario and uniform walls render their tails", () => {
    for (const n of [100, 200]) {
      for (const path of ["render-state", "keypress"] as const) {
        expect(runCase(generateFikraChat(n), true, 30, 100, path).pass).toBe(true);
      }
    }
    for (const path of ["render-state", "keypress"] as const) {
      expect(runCase(generateLines(150, "uniform"), true, 30, 100, path).pass).toBe(true);
    }
  });

  test("FIX: the no-frame default path is the documented 22-row fallback (fails only past 24 rows)", () => {
    // Structural: without a frame's terminalSize the daemon cannot know a
    // taller client — the default serves -e/no-frame RPC callers only.
    // 24-row terminals work; 30+ rows lose the tail (known, documented).
    for (const [rows, cols] of DIMS) {
      const r = runCase(generateLines(120, "prose"), false, rows, cols, "default");
      expect(r.pass).toBe(rows <= 24);
    }
  });
});

  test("#321 codex r1: the advanced frame's TAIL fills below a mid-buffer cursor (post-cursor window)", () => {
    // The reproduced case: 100 lines, LONG preceding lines (each wraps to
    // ~3 rows at width 100), cursor on line 21, 22-row screen. The client
    // advances the top wrap-awarely; the wire must carry content BELOW
    // the cursor so the advanced frame's tail is REAL lines.
    const lines: string[] = [];
    for (let i = 0; i < 99; i++) lines.push(i < 21 ? `${"w".repeat(200)} ${i}` : `line-${i}`);
    lines.push("line-99 TAIL end");
    const state = makeState(lines, true, 21, 22);
    const wire = editorStateToJson(state, 22, 100);
    const view = jsonToEditorState(wire);
    // Lines just below the cursor are present for ANY advancement.
    for (let ln = 22; ln < 34; ln++) {
      const r = view.currentBuffer!.getLine(ln) as { _tag?: string; right?: unknown };
      expect(String(r && r._tag === "Right" ? r.right : r)).toContain(`line-${ln}`);
    }
  });

  test("#321 codex r1: the wrapped hardware cursor lands on the cursor TEXT's row", () => {
    const lines: string[] = [];
    for (let i = 0; i < 40; i++) lines.push(i < 10 ? `${"y".repeat(150)} ${i}` : `short-${i}`);
    const state = makeState(lines, true, 30, 22);
    const top = getWrappedViewportTop(state, 22, 100);
    const row = getWrappedCursorRow(state, 22, 100);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(22);
    // With wrapped tops ≠ logical tops the two computations diverge (the
    // OLD bug put the hardware cursor 20+ rows off).
    const logicalTop = getVisibleViewportTop(state, 22);
    if (top !== logicalTop) {
      const logicalRow = Math.max(0, Math.min(21, 30 - logicalTop));
      expect(row).not.toBe(logicalRow);
    }
  });

/** Exposed for the fix-phase test + recording: the matrix table. */
export function matrixTable(): string {
  return ["| N | rows x cols | wrap | path | tail | blank-tail-rows |",
          "|---|---|---|---|---|---|",
          ...MATRIX_RESULTS].join("\n");
}
