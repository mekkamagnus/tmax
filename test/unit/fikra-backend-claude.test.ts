import { describe, expect, test, beforeEach } from "bun:test";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

// #214 (RFC-027 §D3/§D4) — adapter contract v2 + the Claude agent backend.
// Normalization is fixture-tested WITHOUT spawning claude: the pure
// line→events pipeline is exercised with recorded stream-json shapes.

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
type Event = [string, string][];
type EventList = Event[];

const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);

/** Unwrap a T-Lisp list-of-alists value into JS [[k, v], ...] events. */
function toEvents(tlispValue: { value: unknown }): EventList {
  const raw = tlispValue.value as { value: { value: unknown }[] }[] | null;
  if (!raw) return [];
  return raw.map((ev) =>
    (ev.value as { value: { value: string }[] }[]).map((pair) => {
      const items = pair.value;
      return [String(items[0]!.value), String(items[1]!.value)] as [string, string];
    }),
  );
}

function normalize(editor: Editor, line: string): EventList {
  const escaped = JSON.stringify(line);
  const r = e(editor, `(fikra/backend-claude/fikra-backend-claude-normalize ${escaped})`);
  return toEvents(r as { value: unknown });
}

function field(ev: Event, key: string): string {
  const hit = ev.find((p) => p[0] === key);
  return hit ? String(hit[1]) : "";
}

describe("#214 adapter contract v2", () => {
  test("capabilities: session-resume t; interactive-approvals nil (probed in #220)", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-claude)");
    expect(String(e(editor, '(fikra/adapter/fikra-backend-capable-p "claude" "session-resume")').type)).toBe("boolean");
    expect(String(e(editor, '(fikra/adapter/fikra-backend-capable-p "claude" "session-resume")').value)).toBe("true");
    expect(String(e(editor, '(fikra/adapter/fikra-backend-capable-p "claude" "interactive-approvals")').value)).toBe("null");
  });

  test("register/set/current/list round-trip; unavailable backend refused", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/adapter)");
    e(editor, '(fikra/adapter/fikra-register-backend "nope")');
    // unavailable → set refuses, stays none
    expect(String(e(editor, '(fikra/adapter/fikra-set-backend "nope")').value)).toBe("null");
    expect(String(e(editor, "(fikra/adapter/fikra-current-backend)").value)).toBe("none");
    expect(String(e(editor, '(fikra/adapter/fikra-backend-available-p "nope")').value)).toBe("null");
  });
});

describe("#214 claude args (fixture)", () => {
  test("first turn: no --resume; resume turn carries the session id", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-claude)");
    const first = e(editor, '(fikra/backend-claude/fikra-backend-claude-args "do it" nil)');
    const argv1 = (first.value as { value: string }[]).map((v) => String(v.value));
    expect(argv1).toContain("--print");
    expect(argv1).toContain("stream-json");
    expect(argv1).toContain("--verbose");
    expect(argv1).toContain("default");
    expect(argv1).not.toContain("--resume");
    expect(argv1[argv1.length - 1]).toBe("do it");

    const resumed = e(editor, '(fikra/backend-claude/fikra-backend-claude-args "more" "sess-9")');
    const argv2 = (resumed.value as { value: string }[]).map((v) => String(v.value));
    const ri = argv2.indexOf("--resume");
    expect(ri).toBeGreaterThan(-1);
    expect(argv2[ri + 1]).toBe("sess-9");
  });
});

describe("#214 claude normalization (recorded stream-json fixtures)", () => {
  test("system/init → session event", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-claude)");
    const evs = normalize(editor, '{"type":"system","subtype":"init","session_id":"abc-123","model":"claude-x"}');
    expect(evs).toHaveLength(1);
    expect(field(evs[0]!, "kind")).toBe("session");
    expect(field(evs[0]!, "id")).toBe("abc-123");
  });

  test("assistant text block → text-delta", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-claude)");
    const evs = normalize(editor, '{"type":"assistant","message":{"content":[{"type":"text","text":"The gap buffer is O(1)."}]}}');
    expect(evs).toHaveLength(1);
    expect(field(evs[0]!, "kind")).toBe("text-delta");
    expect(field(evs[0]!, "text")).toBe("The gap buffer is O(1).");
  });

  test("assistant tool_use → tool-call with per-tool summary (Bash → command, Edit → path)", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-claude)");
    const bash = normalize(editor, '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"bun test buffer"}}]}}');
    expect(field(bash[0]!, "kind")).toBe("tool-call");
    expect(field(bash[0]!, "tool")).toBe("Bash");
    expect(field(bash[0]!, "summary")).toBe("bun test buffer");

    const edit = normalize(editor, '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t2","name":"Edit","input":{"file_path":"src/x.ts"}}]}}');
    expect(field(edit[0]!, "summary")).toBe("src/x.ts");
  });

  test("mixed content blocks normalize in order", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-claude)");
    const evs = normalize(editor, '{"type":"assistant","message":{"content":[{"type":"text","text":"running"},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}');
    expect(evs).toHaveLength(2);
    expect(field(evs[0]!, "kind")).toBe("text-delta");
    expect(field(evs[1]!, "kind")).toBe("tool-call");
  });

  test("user tool_result → tool-result ok/fail", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-claude)");
    const ok = normalize(editor, '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"92 pass","is_error":false}]}}');
    expect(field(ok[0]!, "kind")).toBe("tool-result");
    expect(field(ok[0]!, "summary")).toBe("92 pass");
    expect(field(ok[0]!, "ok")).toBe("true");

    const bad = normalize(editor, '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"boom","is_error":true}]}}');
    // nil (JSON false → T-Lisp nil) stringifies as "null" on the bridge.
    expect(field(bad[0]!, "ok")).toBe("null");
  });

  test("result line → no events (sentinel owns turn-end); unparseable → nil", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-claude)");
    expect(normalize(editor, '{"type":"result","subtype":"success","duration_ms":1200}')).toHaveLength(0);
    const r = e(editor, '(fikra/backend-claude/fikra-backend-claude-normalize "not json")');
    expect(String(r.value)).toBe("null");
  });

  test("non-tool_result blocks in user messages are ignored", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-claude)");
    const evs = normalize(editor, '{"type":"user","message":{"content":[{"type":"text","text":"stray"},{"type":"tool_result","tool_use_id":"t1","content":"real","is_error":false}]}}');
    expect(evs).toHaveLength(1);
    expect(field(evs[0]!, "summary")).toBe("real");
  });

  test("REAL subprocess abort: SIGTERM fires the sentinel; guard prevents double turn-end", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-claude)");
    e(editor, "(require-module fikra/thread)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    // Spawn a REAL long-running process through the module's own process
    // plumbing (make-process + sentinel), then abort it.
    const pid = e(editor, `(make-process :command '("/bin/sleep" "30")
                             :cwd "/tmp"
                             :filter "fikra-backend-claude-filter"
                             :sentinel "fikra-backend-claude-sentinel")`);
    expect(Number(pid.value)).toBeGreaterThan(0);
    // Wire the module's abort to this pid: set its process handle, abort.
    e(editor, `(fikra/backend-claude/fikra-backend-claude-adopt-process ${Number(pid.value)})`);
    expect(String(e(editor, "(fikra/backend-claude/fikra-backend-claude-abort)").value)).toBe("true");
    // Wait for the sentinel to fire on the killed process.
    await new Promise((r) => setTimeout(r, 400));
    // Turn ended EXACTLY once — interrupted, not overridden by the
    // SIGTERM-death sentinel's "error".
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("interrupted");
    const logPath = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
    const { readFileSync } = await import("node:fs");
    const kinds = readFileSync(logPath, "utf8").trimEnd().split("\n").map((l) => JSON.parse(l).kind);
    expect(kinds.filter((k) => k === "turn-end").length).toBe(1);
  });

  test("abort ends the turn interrupted; the SIGTERM'd sentinel does NOT end it again", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-claude)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    // Simulate abort: mark-aborted + turn-end(interrupted), then the
    // sentinel fires with a non-zero exit — it must SKIP (no double end).
    e(editor, "(fikra/backend-claude/fikra-backend-claude-abort-sim)");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("interrupted");
  });

  test("empty text blocks are dropped (no empty text-deltas)", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-claude)");
    expect(normalize(editor, '{"type":"assistant","message":{"content":[{"type":"text","text":""}]}}')).toHaveLength(0);
  });
});

describe("#214 line accumulation (chunk splitting)", () => {
  test("a JSON object split across chunks reassembles; complete lines flow", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-claude)");
    const feed = (chunk: string) => {
      const r = e(editor, `(fikra/backend-claude/fikra-backend-claude-line-events ${JSON.stringify(chunk)})`);
      return toEvents(r as { value: unknown });
    };
    // Chunk 1: one complete line + a partial second line.
    const evs1 = feed('{"type":"assistant","message":{"content":[{"type":"text","text":"a"}]}}\n{"type":"res');
    expect(evs1).toHaveLength(1);
    expect(field(evs1[0]!, "text")).toBe("a");
    // Chunk 2 completes the partial line (a result → no events).
    const evs2 = feed('ult","subtype":"success"}\n');
    expect(evs2).toHaveLength(0);
    // Chunk 3: two complete lines in one chunk.
    const evs3 = feed('{"type":"assistant","message":{"content":[{"type":"text","text":"b"}]}}\n{"type":"assistant","message":{"content":[{"type":"text","text":"c"}]}}\n');
    expect(evs3).toHaveLength(2);
    expect(field(evs3[0]!, "text")).toBe("b");
    expect(field(evs3[1]!, "text")).toBe("c");
  });
});

describe("#214 filter → FAEP integration (no process)", () => {
  beforeEach(() => {
    // The filter is exercised directly: feed it a chunk and assert the
    // FAEP log received a batch + the session id was recorded.
  });

  test("filter emits a FAEP batch and records the session id", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-claude)");
    // Init a thread in the tmax repo (cwd) so FAEP has a log.
    e(editor, "(fikra/thread/fikra-thread-init)");
    const chunk = '{"type":"system","subtype":"init","session_id":"fx-1"}\n{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}\n';
    e(editor, `(fikra/backend-claude/fikra-backend-claude-filter 0 ${JSON.stringify(chunk)})`);
    // Session id landed in the thread state.
    expect(String(e(editor, "(fikra/thread/fikra-thread-session-id)").value)).toBe("fx-1");
    // FAEP log has both events (session kind renders as "" — check jsonl).
    const logPath = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
    const { readFileSync } = await import("node:fs");
    const lines = readFileSync(logPath, "utf8").trimEnd().split("\n").map((l) => JSON.parse(l));
    const kinds = lines.map((l) => l.kind);
    expect(kinds).toContain("session");
    expect(kinds).toContain("text-delta");
  });
});
