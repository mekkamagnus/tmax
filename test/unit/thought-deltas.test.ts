import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file thought-deltas.test.ts
 * @description #320 — thinking deltas into THOUGHT EVENTS. The block-
 * indexed accumulator (ordered delivery: redelivery drop, contiguous
 * ride as fragments, gap buffer + 2s timeout close), the growing-line
 * render with collapse (>3 lines or >200 chars → first line + `… [N
 * lines — TAB to expand]`; auto-collapse markers rebuild), TAB toggle,
 * and replay parity (byte-compare live-final vs replayed under DEFAULT
 * collapse). The wire seam (thinking_delta normalize) is fixture-tested
 * hex-encoded (the reader's backslash gap).
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i320-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module fikra/thread)");
  e(editor, "(require-module fikra/event)");
  e(editor, "(require-module fikra/thought)");
  e(editor, "(require-module fikra/backend-claude)");
  e(editor, "(fikra/thread/fikra-thread-init)");
  e(editor, "(fikra/thought/fikra-thought-reset \"main\")");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// Newlines cross TS→T-Lisp HEX-ENCODED (the reader strips backslash
// escapes — the known gap).
const delta = (block: number, text: string) =>
  `(list (list "kind" "thought-delta") (list "block" "${block}") (list "text" (hex-decode "${hex(text)}")))`;
const feed = (exprs: string) =>
  `(fikra/thought/fikra-thought-feed "main" (list ${exprs}))`;
const feedCount = (exprs: string) =>
  `(length (fikra/thought/fikra-thought-feed "main" (list ${exprs})))`;
const textEv = (t: string) => `(list (list "kind" "text-delta") (list "text" "${t}"))`;
// Emit THROUGH the accumulator (production wiring: the backend filter
// feeds, then emits).
const emit = (eventsExpr: string) =>
  `(fikra/event/fikra-event-emit-batch (fikra/thought/fikra-thought-feed "main" (list ${eventsExpr})))`;

describe("#320 — ordered delivery (the accumulator)", () => {
  test("contiguous fragments ride IN ORDER; a redelivery (index ≤ watermark) drops", () => {
    // Fragments of the OPEN block append (the stream contract); a CLOSED
    // block's late delta drops: 0:a 0:b 1:c 0:late → 3 out.
    expect(String(e(editor, feedCount([delta(0, "a"), delta(0, "b"), delta(1, "c"), delta(0, "late")].join(" "))).value)).toBe("3");
  });

  test("a GAP buffers: the out-of-order delta is held until the missing index fills", () => {
    // Block 1 arrives before block 0 → buffered; block 0 arrives → both ride in order.
    expect(String(e(editor, feedCount([delta(1, "late"), delta(0, "first")].join(" "))).value)).toBe("2");
  });

  test("the 2s timeout closes a stale gap with a status event; late fills become redeliveries", () => {
    e(editor, feed(delta(2, "gapped")));
    const closed = String(e(editor, `(json-encode (car (fikra/thought/fikra-thought-timeout-check "main" (+ (editor-time-now) 2500))))`).value);
    expect(closed).toContain("thought-status");
    expect(closed).toContain("gap");
    // A late fill for the closed index is a redelivery — dropped.
    expect(String(e(editor, feedCount(delta(2, "late"))).value)).toBe("0");
  });

  test("the watermark + threshold state reset per thread", () => {
    e(editor, feed(delta(0, "x")));
    expect(String(e(editor, '(fikra/thought/fikra-thought-watermark "main")').value)).toBe("0");
    e(editor, '(fikra/thought/fikra-thought-reset "main")');
    expect(String(e(editor, '(fikra/thought/fikra-thought-watermark "main")').value)).toBe("-1");
  });
});

describe("#320 — the growing line + collapse (the renderer)", () => {
  test("multi-delta block renders as ONE growing dim line; block boundaries open new lines", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, emit(`${delta(0, "Think ")} ${delta(0, "more")}`));
    const t = strip(bufferText(editor));
    expect(t).toContain("· Think more");
    expect(t.indexOf("· Think")).toBe(t.lastIndexOf("· Think")); // ONE prefix
    e(editor, emit(delta(1, "Next block")));
    const t2 = strip(bufferText(editor));
    expect(t2.indexOf("· Next block")).toBeGreaterThan(t2.indexOf("· Think more"));
  });

  test("COLLAPSE: >3 lines renders first line + the marker; ≤3 lines stays whole (both shapes)", () => {
    const collapsed = String(e(editor, '(fikra/event/fikra-thought-render "l1\nl2\nl3\nl4")').value);
    expect(collapsed).toContain("l1 … [4 lines — TAB to expand]");
    const whole = String(e(editor, '(fikra/event/fikra-thought-render "l1\nl2\nl3")').value);
    expect(whole).toBe("l1\nl2\nl3");
    // The CHAR threshold: 201+ chars on ONE line collapses too.
    const long = "x".repeat(201);
    expect(String(e(editor, `(fikra/event/fikra-thought-render "${long}")`).value)).toContain("TAB to expand");
  });

  test("STREAMING auto-collapse: the crossing emits the marker; the rebuild lands the collapsed line", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    // Three fragments crossing the 3-line threshold mid-stream.
    e(editor, emit(delta(0, "a\nb\nc")));
    let t = strip(bufferText(editor));
    expect(t).toContain("a\nb\nc"); // under threshold: raw growth
    expect(t).not.toContain("TAB to expand");
    e(editor, emit(delta(0, "\nd")));
    t = strip(bufferText(editor));
    expect(t).toContain("a … [4 lines — TAB to expand]"); // the rebuild collapsed it
  });

  test("TAB toggles: collapsed → expanded → collapsed (display-only)", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, emit(delta(0, "one\ntwo\nthree\nfour")));
    let t = strip(bufferText(editor));
    expect(t).toContain("one … [4 lines — TAB to expand]");
    e(editor, '(fikra/event/fikra-thought-toggle-at "one")');
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    t = strip(bufferText(editor));
    expect(t).toContain("one\ntwo\nthree\nfour");
    e(editor, '(fikra/event/fikra-thought-toggle-at "one")');
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    t = strip(bufferText(editor));
    expect(t).toContain("TAB to expand");
  });
});

describe("#320 — replay parity + the stream shapes", () => {
  test("BYTE PARITY: live-final == replayed under DEFAULT collapse (toggles excluded)", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, emit(delta(0, "short thought")));
    e(editor, emit(delta(1, "a\nb\nc\nd\ne")));
    e(editor, emit(textEv("answer")));
    const live = strip(bufferText(editor));
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    const replayed = strip(bufferText(editor));
    expect(replayed).toBe(live);
    expect(replayed).toContain("· short thought");
    expect(replayed).toContain("a … [5 lines — TAB to expand]");
    expect(replayed).toContain("answer");
  });

  test("COMPLETED-ONLY: a whole thinking block renders once (the existing path); EMPTY renders nothing; TEXT blocks unaffected", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, `(fikra/event/fikra-event-emit (list (list "kind" "thought") (list "text" (hex-decode "${hex("whole1\nwhole2")}"))))`);
    let t = strip(bufferText(editor));
    expect(t).toContain("· whole1");
    // The wire seam: a complete thinking block in an assistant message.
    const normJSON = '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"full thought"},{"type":"text","text":"hi"}]}}';
    const norm = String(e(editor, `(json-encode (car (fikra/backend-claude/fikra-backend-claude-normalize (hex-decode "${hex(normJSON)}"))))`).value);
    expect(norm).toContain("thought");
    expect(norm).toContain("full thought");
    // Empty thinking block → no event (length-based: robust to the
    // nil-vs-empty-list truthiness quirk).
    const emptyJSON = '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":""}]}}';
    const empty = String(e(editor, `(length (fikra/backend-claude/fikra-backend-claude-normalize (hex-decode "${hex(emptyJSON)}")))`).value);
    expect(empty).toBe("0");
    void t;
  });

  test("INTERLEAVED: thinking renders in stream ORDER among the turn's events (text unaffected)", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, emit(`${delta(0, "ponder")} ${textEv("part1")}`));
    e(editor, emit(`${delta(1, "again")} ${textEv("part2")}`));
    const t = strip(bufferText(editor));
    const order = [t.indexOf("· ponder"), t.indexOf("part1"), t.indexOf("· again"), t.indexOf("part2")];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("the WIRE SEAM: thinking_delta partials normalize to thought-delta with the block index", () => {
    e(editor, "(require-module fikra/backend-claude)");
    const norm = String(e(editor, `(json-encode (car (fikra/backend-claude/fikra-backend-claude-normalize (hex-decode "${hex('{"type":"stream_event","event":{"type":"content_block_delta","index":3,"delta":{"type":"thinking_delta","thinking":"hmm"}}}')}"))))`).value);
    expect(norm).toContain("thought-delta");
    expect(norm).toContain('"block":"3"');
    expect(norm).toContain("hmm");
  });

  test("the log carries fragments + markers; dedupe holds on RE-REPLAY", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, emit(delta(0, "x\ny\nz\nw")));
    const log = readFileSync(join(process.cwd(), ".tmax/fikra/threads/main/events.jsonl"), "utf8");
    expect(log).toContain("thought-delta");
    expect(log).toContain("thought-collapse");
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    const once = strip(bufferText(editor));
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    expect(strip(bufferText(editor))).toBe(once); // idempotent replay
  });
});
