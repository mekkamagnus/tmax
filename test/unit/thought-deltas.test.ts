import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file thought-deltas.test.ts
 * @description #320 — thinking deltas into THOUGHT EVENTS. The ordered
 * accumulator (same-raw appends, new-raw opens, older drops; message-
 * scoped state), the growing-line
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
const toolCall = (name: string) => `(list (list "kind" "tool-call") (list "tool" "${name}"))`;
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

  test("INTERLEAVED indices accept directly (the ordered contract: raw jumps are text blocks in between, never reordering)", () => {
    // thinking 0 → text (unseen index 1) → thinking 2: BOTH thoughts ride.
    expect(String(e(editor, feedCount([delta(0, "first"), delta(2, "after-text")].join(" "))).value)).toBe("2");
  });

  test("MESSAGE-FINAL events reset the context: a tool round mid-turn starts a fresh message (indices restart at 0)", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, emit(`${delta(0, "before tool")} ${toolCall("bash")}`));
    // The next assistant message's block 0 is FRESH after the tool round.
    e(editor, emit(delta(0, "after tool")));
    const t = strip(bufferText(editor));
    expect(t).toContain("before tool");
    expect(t).toContain("after tool");
  });

  test("same-chunk delta + complete: the complete drops IN ORDER (deltas earlier in the batch stream first)", () => {
    e(editor, "(require-module fikra/backend-claude)");
    const dline = '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"one shot"}}}';
    const cline = '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"one shot"}]}}';
    const norm = (j: string) => `(fikra/backend-claude/fikra-backend-claude-normalize (hex-decode "${hex(j)}"))`;
    const out = String(e(editor, `(length (fikra/thought/fikra-thought-feed "main" (append ${norm(dline)} ${norm(cline)})))`).value);
    expect(out).toBe("1"); // the delta rides; the complete drops
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
    // The REAL command (the keep-flag path — a bare rebuild resets
    // toggles): cursor on the thought line (line 0 of the buffer).
    e(editor, "(cursor-move 0 0)");
    e(editor, "(fikra/event/fikra-thought-tab)");
    t = strip(bufferText(editor));
    expect(t).toContain("one\ntwo\nthree\nfour");
    e(editor, "(fikra/event/fikra-thought-tab)");
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

  test("CONSECUTIVE TURNS: turn-begin resets the accumulator (indices restart at 0)", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    e(editor, emit(delta(0, "turn one")));
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
    e(editor, '(fikra/transient/fikra-transient-mark-rendered "main")');
    e(editor, "(fikra/transient/fikra-transient-tick (editor-time-now))");
    // Turn 2: SAME raw indices — the reset makes them fresh.
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    e(editor, emit(delta(0, "turn two")));
    const t = strip(bufferText(editor));
    expect(t).toContain("turn one");
    expect(t).toContain("turn two");
  });

  test("STREAMED + COMPLETE suppression through the feed (cross-chunk)", () => {
    e(editor, "(require-module fikra/backend-claude)");
    e(editor, emit(delta(0, "streamed thought")));
    const complete = '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"streamed thought"}]}}';
    const dropped = String(e(editor, `(length (fikra/thought/fikra-thought-feed "main" (fikra/backend-claude/fikra-backend-claude-normalize (hex-decode "${hex(complete)}"))))`).value);
    expect(dropped).toBe("0"); // suppressed
    // A FRESH context keeps it (completed-only path intact).
    e(editor, '(fikra/thought/fikra-thought-reset "main")');
    const kept = String(e(editor, `(length (fikra/thought/fikra-thought-feed "main" (fikra/backend-claude/fikra-backend-claude-normalize (hex-decode "${hex(complete)}"))))`).value);
    expect(kept).toBe("1");
  });

  test("the WIRE SEAM through the routed filter: normalize → drop-completes → feed → emit", () => {
    e(editor, "(require-module fikra/backend-claude)");
    // A thinking_delta line + an interleaved text delta, through the
    // production composition.
    const line1 = '{"type":"stream_event","event":{"type":"content_block_delta","index":2,"delta":{"type":"thinking_delta","thinking":"ponder"}}}';
    const line2 = '{"type":"stream_event","event":{"type":"content_block_delta","index":3,"delta":{"type":"text_delta","text":"hi"}}}';
    const routed = String(e(editor, `(length (fikra/thought/fikra-thought-feed "main" (append (fikra/backend-claude/fikra-backend-claude-normalize (hex-decode "${hex(line1)}")) (fikra/backend-claude/fikra-backend-claude-normalize (hex-decode "${hex(line2)}")))))`).value);
    expect(routed).toBe("2"); // the thought-delta AND the text delta ride
  });

  test("THOUGHT→TEXT transition parity: exact live-final vs replayed bytes (ANSI included)", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    e(editor, emit(delta(0, "brief")));
    e(editor, emit(textEv("answer")));
    // Production final states pass through the TURN-END rebuild — parity
    // compares that state against a fresh replay (codex r3: whole-line
    // dim; live growth is per-fragment until the rebuild).
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
    e(editor, '(fikra/transient/fikra-transient-mark-rendered "main")');
    e(editor, "(fikra/transient/fikra-transient-tick (editor-time-now))");
    const live = bufferText(editor);
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    expect(bufferText(editor)).toBe(live); // BYTE parity, faces included
    expect(strip(live)).toContain("· brief\nassistant › answer");
  });

  test("MULTI-BLOCK message suppression holds through the whole completed message (codex r3 c1)", () => {
    e(editor, "(require-module fikra/backend-claude)");
    // Streamed thinking at raw 0 AND raw 2 (a text block took 1).
    e(editor, emit(delta(0, "block zero")));
    e(editor, emit(delta(2, "block two")));
    // The completed message carries BOTH — both suppressed (the reset
    // defers to the message's end).
    const complete = '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"block zero"},{"type":"text","text":"x"},{"type":"thinking","thinking":"block two"}]}}';
    const out = String(e(editor, `(length (fikra/thought/fikra-thought-feed "main" (fikra/backend-claude/fikra-backend-claude-normalize (hex-decode "${hex(complete)}"))))`).value);
    expect(out).toBe("1"); // only the text block rides
  });

  test("the thought CONTENT is dim (the whole line, not just the prefix)", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, emit(delta(0, "deep thought")));
    e(editor, '(fikra/thread/fikra-thread-turn-begin)');
    e(editor, '(fikra/thread/fikra-thread-turn-end "completed")');
    e(editor, '(fikra/transient/fikra-transient-mark-rendered "main")');
    e(editor, "(fikra/transient/fikra-transient-tick (editor-time-now))");
    const raw = bufferText(editor);
    expect(raw).toContain("\u001b[2m· deep thought\u001b[0m"); // one face, whole line
  });

  test("EXPAND survives the next streaming fragment (marker rebuilds keep toggles; codex r3 c3)", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    // A block that crosses the threshold mid-stream.
    e(editor, emit(delta(0, "a\nb\nc")));
    e(editor, emit(delta(0, "\nd"))); // crosses → collapsed
    let t = strip(bufferText(editor));
    expect(t).toContain("TAB to expand");
    // Expand via the REAL TAB command.
    e(editor, "(cursor-move 0 0)");
    e(editor, "(fikra/event/fikra-thought-tab)");
    t = strip(bufferText(editor));
    expect(t).toContain("a\nb\nc\nd");
    // The NEXT fragment's marker rebuild PRESERVES the expansion.
    e(editor, emit(delta(0, "\ne")));
    t = strip(bufferText(editor));
    expect(t).toContain("a\nb\nc\nd\ne");
    expect(t).not.toContain("TAB to expand");
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

describe("#327 — per-segment identity (the events-walk)", () => {
  test("SAME-FIRST-LINE segments toggle INDEPENDENTLY (the collision case)", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, emit(delta(0, "same first\n" + "a".repeat(180) + "\nx\ny")));
    e(editor, toolCall("tool-one"));
    e(editor, emit(delta(1, "same first\n" + "b".repeat(180) + "\nz\nw")));
    let t = strip(bufferText(editor));
    expect((t.match(/same first …/g) || []).length).toBe(2);
    e(editor, "(cursor-move 0 0)");
    e(editor, "(fikra/event/fikra-thought-tab)");
    t = strip(bufferText(editor));
    expect(t).toContain("a".repeat(180)); // segment 1 expanded
    expect(t).not.toContain("b".repeat(180)); // segment 2 untouched
  });

  test("a STREAMED segment's toggle survives its own growth (the drift case)", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, emit(delta(0, "grow\n" + "a".repeat(180))));
    e(editor, "(cursor-move 0 0)");
    e(editor, "(fikra/event/fikra-thought-tab)"); // expand it
    e(editor, emit(delta(0, "\nmore\nlines\nhere")));
    const t = strip(bufferText(editor));
    expect(t).toContain("more"); // still expanded after growth
    expect(t).not.toContain("TAB to expand");
  });
});

describe("#327 — item 3 (the cross-batch thought join)", () => {
  test("block fragments across SEPARATE emit calls render as ONE run (no line break)", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    // The r4-escalation shape: the routed emitter hands each chunk's
    // events as its own batch — the thought fragments of ONE block
    // arrive in SEPARATE emit-batch calls.
    e(editor, emit(delta(0, "first part of ")));
    e(editor, emit(delta(0, "the thought"))); // same block, new batch
    const t = strip(bufferText(editor));
    // ONE ·-run: the fragments JOINED (no break mid-thought).
    expect(t).toContain("first part of the thought");
    expect((t.match(/· /g) || []).length).toBe(1);
  });

  test("a NEW block after a tool call starts a SEPARATE run (the boundary holds)", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, emit(delta(0, "run one")));
    e(editor, toolCall("sep"));
    e(editor, emit(delta(1, "run two")));
    const t = strip(bufferText(editor));
    expect((t.match(/· /g) || []).length).toBe(2); // TWO runs
    expect(t).toContain("run one");
    expect(t).toContain("run two");
  });
});

describe("#327 — gate r1 fixes", () => {
  test("POST-TOOL-ROUND collision: block indices RESTART but runs key uniquely", () => {
    // The realistic shape the gate probe-verified: raw blocks restart
    // per assistant message — TWO segments both carrying block "0".
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, emit(delta(0, "same first\n" + "a".repeat(180) + "\nx\ny")));
    // A MESSAGE-FINAL separator (the feed resets the context on the
    // batch boundary — tool rounds end an assistant message).
    e(editor, `(fikra/event/fikra-event-emit-batch (fikra/thought/fikra-thought-feed "main" (list (list (list "kind" "turn-end") (list "result" "ok")))))`);
    e(editor, emit(delta(0, "same first\n" + "b".repeat(180) + "\nz\nw")));
    let t = strip(bufferText(editor));
    expect((t.match(/same first …/g) || []).length).toBe(2);
    e(editor, "(cursor-move 0 0)");
    e(editor, "(fikra/event/fikra-thought-tab)");
    t = strip(bufferText(editor));
    expect(t).toContain("a".repeat(180)); // segment 1 expanded
    expect(t).not.toContain("b".repeat(180)); // segment 2 untouched
  });

  test("THREAD-SCOPED: a focus switch clears toggles", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, emit(delta(0, "thread one\n" + "a".repeat(180) + "\nline3\nline4")));
    e(editor, "(cursor-move 0 0)");
    e(editor, "(fikra/event/fikra-thought-tab)"); // expand in thread A
    expect(strip(bufferText(editor))).toContain("a".repeat(180));
    // Switch the log (what a thread focus does).
    e(editor, '(fikra/event/fikra-event-log-set (fikra/event/fikra-event-log-path))');
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    // The toggle is GONE: default collapse again.
    expect(strip(bufferText(editor))).toContain("thread one …");
    expect(strip(bufferText(editor))).not.toContain("a".repeat(180));
  });

  test("TAB works after STREAMED TEXT (the walk joins adjacent deltas)", () => {
    e(editor, "(fikra/thread/fikra-thread-open)");
    e(editor, emit(textEv("part one")));
    e(editor, emit(textEv("part two"))); // adjacent text-deltas: one line
    e(editor, emit(delta(0, "after text\n" + "a".repeat(180) + "\nz\nw")));
    const ls = strip(bufferText(editor)).split("\n");
    const thoughtLine = ls.findIndex((l) => l.startsWith("· after text"));
    expect(thoughtLine).toBeGreaterThan(0);
    e(editor, `(cursor-move ${thoughtLine} 0)`);
    e(editor, "(fikra/event/fikra-thought-tab)");
    expect(strip(bufferText(editor))).toContain("a".repeat(180)); // NOT a silent no-op
  });
});
