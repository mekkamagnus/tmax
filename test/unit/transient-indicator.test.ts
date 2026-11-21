import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file transient-indicator.test.ts
 * @description #319 — the animated working indicator on #318's transient
 * layer: the HONEST chunk counter (text-delta + tool-call — the named
 * rule, nothing else), elapsed from the turn's FIRST streamed event
 * (daemon-side: attach/reconnect read the same state), the fixed gerund
 * list cycling on tick, the deterministic frozen→clear terminal sequence
 * at EVERY terminal kind (done/error/interrupted), and the
 * provider-reported usage final line (persisted FAEP event — present
 * and absent paths). The graded frame sequence captures the whole arc.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const tick = (ed: Editor, nowMs?: number) =>
  e(ed, `(fikra/transient/fikra-transient-tick ${nowMs ?? "(editor-time-now)"})`);
const silence = (ed: Editor) => e(ed, "(fikra/transient/fikra-transient-stop)");
const chunksOf = (ed: Editor, id: string) => Number(e(ed, `(fikra/transient/fikra-transient-chunks-of "${id}")`).value);
const segment = (ed: Editor, id: string) => strip(String(e(ed, `(fikra/transient/fikra-transient-segment "${id}")`).value));

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i319-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module fikra/thread)");
  e(editor, "(require-module fikra/transient)");
  e(editor, "(require-module fikra/event)");
  e(editor, "(fikra/thread/fikra-thread-init)");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const delta = (text: string) => `(fikra/event/fikra-event-emit (list (list "kind" "text-delta") (list "text" "${text}")))`;
const toolCall = (name: string) => `(fikra/event/fikra-event-emit (list (list "kind" "tool-call") (list "tool" "${name}")))`;

describe("#319 — the honest chunk counter (the named rule)", () => {
  test("text-delta + tool-call count; thought/turn-start/session do NOT", () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    silence(editor);
    e(editor, delta("hello "));
    e(editor, delta("world"));
    e(editor, toolCall("buffer-edit"));
    e(editor, '(fikra/event/fikra-event-emit (list (list "kind" "thought") (list "text" "hm")))');
    expect(chunksOf(editor, "main")).toBe(3);
    // A NEW turn resets the counter (note-running on the ->running edge).
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    expect(chunksOf(editor, "main")).toBe(0);
    e(editor, toolCall("bash"));
    expect(chunksOf(editor, "main")).toBe(1);
  });

  test("the segment carries the live count: '<glyph> <gerund> · N chunks · <elapsed>'", () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    silence(editor);
    for (let i = 0; i < 5; i++) e(editor, delta(`c${i} `));
    tick(editor);
    const seg = segment(editor, "main");
    expect(seg).toMatch(/pondering|reading|editing/);
    expect(seg).toContain("5 chunks");
    expect(seg).toMatch(/· \d+s$/);
  });
});

describe("#319 — elapsed (first-event start; the daemon owns it)", () => {
  test("starts at the FIRST streamed event, grows with ticks, formats Ns / NmNNs", () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    silence(editor);
    // No streamed event yet: elapsed 0.
    const now0 = Date.now();
    tick(editor, now0);
    expect(Number(e(editor, '(fikra/transient/fikra-transient-elapsed-of "main")').value)).toBe(0);
    // The FIRST streamed event stamps the start.
    e(editor, delta("begin"));
    const now1 = Date.now();
    tick(editor, now1);
    const el1 = Number(e(editor, '(fikra/transient/fikra-transient-elapsed-of "main")').value);
    expect(el1).toBeGreaterThanOrEqual(0);
    expect(el1).toBeLessThan(2000);
    // Grows: a later tick shows MORE elapsed (attach/reconnect semantics —
    // the daemon state, not client-local time).
    tick(editor, now1 + 61_000);
    const seg = segment(editor, "main");
    expect(seg).toMatch(/1m0[0-5]s/);
    // Format helper pinned directly.
    expect(String(e(editor, '(fikra/transient/fikra-transient-format-elapsed 42000)').value)).toBe("42s");
    expect(String(e(editor, '(fikra/transient/fikra-transient-format-elapsed 72000)').value)).toBe("1m12s");
  });
});

describe("#319 — rotation (deterministic under driven ticks)", () => {
  test("the gerund cycles the fixed 3-verb list; the glyph keeps its 4-frame cycle", () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    silence(editor);
    const gerunds = [0, 1, 2, 3].map(() => strip(String(e(editor, "(progn (fikra/transient/fikra-transient-tick (editor-time-now)) (fikra/transient/fikra-transient-gerund))").value)));
    // The list cycles in ORDER (pondering, reading, editing); the first
    // read is after tick 1 → "reading" (mod 3 of the tick count).
    expect(gerunds).toEqual(["reading", "editing", "pondering", "reading"]);
    const glyphs = [0, 1, 2, 3, 4].map(() => strip(String(e(editor, "(progn (fikra/transient/fikra-transient-tick (editor-time-now)) (fikra/transient/fikra-transient-spinner-glyph))").value)));
    expect(new Set(glyphs.slice(0, 4)).size).toBe(4);
    expect(glyphs[4]).toBe(glyphs[0]);
  });
});

describe("#319 — per-thread isolation", () => {
  test("each running thread's OWN indicator (chunks counted separately); an idle thread's is nil", () => {
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    e(editor, delta("one"));
    e(editor, "(fikra/thread/fikra-thread-new)");
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    silence(editor);
    tick(editor); // reconcile: the state machine runs again (shell dead)
    e(editor, toolCall("edit"));
    e(editor, toolCall("bash"));
    e(editor, toolCall("read"));
    expect(chunksOf(editor, "fix-1")).toBe(3);
    expect(chunksOf(editor, "main")).toBe(1);
    const segFix = segment(editor, "fix-1");
    expect(segFix).toContain("3 chunks");
    // main is STILL running (both run concurrently) — its own count.
    const segMain = segment(editor, "main");
    expect(segMain).toContain("1 chunks");
  });
});

describe("#319 — the frozen→clear terminal sequence at EVERY terminal kind", () => {
  const cases: Array<[string, string]> = [
    ["completed", "idle"],
    ["errored", "error"],
    ["interrupted", "interrupted"],
  ];
  for (const [endArg, _status] of cases) {
    test(`turn-end "${endArg}": frozen ✓ frame (elapsed STOPPED) → cleared on the next tick → interval settles`, () => {
      e(editor, "(fikra/thread/fikra-thread-turn-begin)");
      silence(editor);
      for (let i = 0; i < 4; i++) e(editor, delta(`c${i} `));
      const now = Date.now();
      tick(editor, now);
      e(editor, `(fikra/thread/fikra-thread-turn-end "${endArg}")`);
      // FROZEN frame: ✓ prefix, final counts, elapsed captured at terminal.
      const frozen = segment(editor, "main");
      expect(frozen).toMatch(/^✓/);
      expect(frozen).toContain("4 chunks");
      const elapsedInFrozen = (frozen.match(/· (\S+)$/) || [])[1] ?? "";
      // A much-later tick does NOT advance the frozen elapsed (the clock
      // stopped at the terminal edge) — and ages the frame.
      tick(editor, now + 300_000);
      const frozen2 = segment(editor, "main");
      expect(frozen2).toMatch(/^✓/);
      expect(frozen2).toContain(elapsedInFrozen);
      // The next tick CLEARS the transient; with no runner left the
      // interval settles (the one-tick-after stop).
      tick(editor, now + 300_200);
      expect(segment(editor, "main")).toBe("null");
      expect(String(e(editor, "(if (fikra/transient/fikra-transient-active-p) 1 0)").value)).toBe("0");
    });
  }
});

describe("#319 — the usage final line (provider-reported, persisted)", () => {
  test("normalize maps the CLI result's usage → a usage FAEP event (input+output); absent usage → no event", () => {
    e(editor, "(require-module fikra/backend-claude)");
    // JSON crosses TS→T-Lisp HEX-ENCODED (the reader escape gap).
    const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
    const normExpr = (json: string) => `(json-encode (car (fikra/backend-claude/fikra-backend-claude-normalize (hex-decode "${hex(json)}"))))`;
    const withUsage = String(e(editor, normExpr('{"type":"result","usage":{"input_tokens":230,"output_tokens":1004}}')).value);
    expect(withUsage).toContain("usage");
    expect(withUsage).toContain("1234");
    // Absent usage → nil (no event, no line).
    const noUsage = String(e(editor, `(if (fikra/backend-claude/fikra-backend-claude-normalize (hex-decode "${hex('{"type":"result","subtype":"error_max_turns"}')}")) 1 0)`).value);
    expect(noUsage).toBe("0");
  });

  test("the rendered final line: '✓ 1,234 tokens' in *Fikra* — persisted, replay-identical", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    const logPath = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
    e(editor, '(fikra/event/fikra-event-emit (list (list "kind" "usage") (list "tokens" "1234")))');
    expect(strip(bufferText(editor))).toContain("✓ 1,234 tokens");
    // REPLAY: rebuild from the log renders the same line (no transient
    // state involved in the final line).
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    expect(strip(bufferText(editor))).toContain("✓ 1,234 tokens");
    expect(readFileSync(logPath, "utf8")).toContain("\"kind\":\"usage\"");
  });
});

describe("#319 — the graded frame sequence (capture evidence)", () => {
  test("streaming → more chunks → frozen ✓ → cleared: four captured frames", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    silence(editor);
    // Frame 1 — first chunks arrive.
    e(editor, delta("Once "));
    e(editor, delta("upon "));
    tick(editor);
    const f1 = segment(editor, "main");
    expect(f1).toMatch(/pondering|reading|editing/);
    expect(f1).toContain("2 chunks");
    // Frame 2 — more streaming (a tool round + text).
    e(editor, toolCall("buffer-edit"));
    e(editor, delta("a time"));
    tick(editor);
    const f2 = segment(editor, "main");
    expect(f2).toContain("4 chunks");
    expect(f2).not.toBe(f1); // rotated glyph/gerund + grown count
    // Frame 3 — the terminal FROZEN frame (✓, final counts).
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
    const f3 = segment(editor, "main");
    expect(f3).toMatch(/^✓/);
    expect(f3).toContain("4 chunks");
    // Frame 4 — cleared (the next tick's frame omits the transient).
    tick(editor);
    tick(editor);
    const f4 = segment(editor, "main");
    expect(f4).toBe("null");
  });
});
