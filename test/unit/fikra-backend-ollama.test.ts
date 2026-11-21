import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

// RFC-029 8.1's raw-API native loop (r108): the ollama chat backend -
// a fikra-owned turn (no CLI wrapper). Synthetic callback driving (the
// live proof is scripts/fikra-ollama-chat-live.sh).

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\[[0-9;]*m/g, "");
const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");

async function armed(): Promise<Editor> {
  const ed = await createStartedEditor("");
  e(ed, "(require-module fikra/adapter)");
  e(ed, "(require-module fikra/event)");
  e(ed, '(require-module "fikra/thread")');
  e(ed, "(require-module fikra/chat)");
  e(ed, "(fikra/chat/fikra-chat-open)");
  e(ed, "(require-module fikra/backend-ollama)");
  e(ed, '(fikra/adapter/fikra-set-backend-forced "ollama")');
  e(ed, "(fikra/chat/fikra-refresh-lighter)");
  return ed;
}

const dirs: string[] = [];
const originalCwd = process.cwd();
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "fikra-ol-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(join(dir, ".gitignore"), ".tmax/\n");
  process.chdir(dir);
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("#8.1 raw-API ollama chat backend (r108)", () => {
  test("the landed reply renders an ASSISTANT turn and ends it - the fikra-owned loop", async () => {
    const ed = await armed();
    // The REAL path: turn-send emits the user message then routes to the
    // backend (the claude contract — the caller owns the user's delta).
    const r = e(ed, '(fikra/chat/fikra-turn-send "fix the resize handler")');
    expect(String(r.value)).toBe("pending");
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
    // The reply arrives through the filter + the ownership dispatcher.
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 21 "live")');
    const reply = hex(JSON.stringify({ message: { role: "assistant", content: "Fixed - the handler re-rendered but never told the daemon." } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 21 "${reply}")`);
    e(ed, `(fikra-http-complete 21 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    const text = strip(String(e(ed, "(buffer-text)").value));
    expect(text).toContain("user › fix the resize handler");
    expect(text).toContain("assistant › Fixed - the handler re-rendered but never told the daemon.");
    expect(text).toContain("completed");
  });

  test("a dead server ends the turn as an ERROR with a visible status", async () => {
    const ed = await armed();
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-start-turn "hello")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 22 "live")');
    e(ed, `(fikra-http-complete 22 0 "${hex("refused")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("error");
    expect(String(e(ed, "(editor-status)").value)).toContain("unreachable");
  });

  test("the modeline carries the backend; a backend without a model stays BARE", async () => {
    const ed = await armed();
    expect(String(e(ed, '(minor-mode-lighter "fikra")').value)).toContain("ollama");
    e(ed, '(fikra/adapter/fikra-set-backend-forced "replay")');
    e(ed, "(fikra/chat/fikra-refresh-lighter)");
    const bare = String(e(ed, '(minor-mode-lighter "fikra")').value);
    expect(bare).toContain("replay");
    expect(bare).not.toMatch(/\(/);
  });

  test("the capabilities are honest: no streaming, no approvals", async () => {
    const ed = await armed();
    expect(String(e(ed, '(fikra/adapter/fikra-backend-capable-p "ollama" "streaming")').value)).toBe("null");
    expect(String(e(ed, '(fikra/adapter/fikra-backend-capable-p "ollama" "interactive-approvals")').value)).toBe("null");
  });
});

describe("ollama chat lifecycle (r109 — codex r108 catches)", () => {
  test("a CONNECTION FAILURE (no chunks, unseeded-by-filter) still settles — fire-time ownership", async () => {
    const ed = await armed();
    // Drive via the REAL fire (start-turn) but with the URL pointed at a
    // dead port — the request fails with no body chunks; ownership was
    // stamped at FIRE. The completion arrives unowned-by-filter.
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 41 "dead")');
    // Simulate: the request was fired (id 41), the connection died — the
    // completion reaches the dispatcher with NO filter-chunk ever seen.
    e(ed, `(fikra-http-complete 41 0 "${hex("connect ECONNREFUSED")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).not.toBe("running");
    expect(String(e(ed, "(editor-status)").value)).toContain("unreachable");
  });

  test("a late reply whose turn was ABORTED discards (no ghost render)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "first question")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 42 "live")');
    // The user interrupts before the reply lands.
    e(ed, "(fikra/backend-ollama/fikra-backend-ollama-abort)");
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("interrupted");
    const before = String(e(ed, "(buffer-text)").value);
    // The late reply arrives — it must DISCARD.
    const reply = hex(JSON.stringify({ message: { role: "assistant", content: "stale answer" } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 42 "${reply}")`);
    e(ed, `(fikra-http-complete 42 200 "${hex("{}")}")`);
    const after = String(e(ed, "(buffer-text)").value);
    expect(after).toBe(before);
    expect(after).not.toContain("stale answer");
  });

  test("HISTORY rides the messages (the second turn sees the first exchange)", async () => {
    const ed = await armed();
    // First exchange in memory.
    e(ed, '(fikra/chat/fikra-turn-send "remember the word pineapple")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 43 "live")');
    const r1 = hex(JSON.stringify({ message: { role: "assistant", content: "noted" } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 43 "${r1}")`);
    e(ed, `(fikra-http-complete 43 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    // The second turn's REQUEST BODY carries the history — assert via the
    // builder (the messages include the first user + assistant turns).
    const h = String(e(ed, "(fikra/backend-ollama/fikra-ollama-history-messages)").value);
    expect(h).toContain('"role":"user","content":"remember the word pineapple"');
    expect(h).toContain('"role":"assistant","content":"noted"');
  });
});

describe("ollama replacement turns (r110 — codex r109 P1)", () => {
  test("abort turn 1, start turn 2, deliver reply 1 — the STALE reply discards", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "first question")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 51 "live")');
    e(ed, "(fikra/backend-ollama/fikra-backend-ollama-abort)");
    // A REPLACEMENT turn: the new request (52) supersedes 51.
    e(ed, '(fikra/chat/fikra-turn-send "second question")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 52 "live")');
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
    // Reply 1 arrives LATE — it must NOT render nor settle turn 2.
    const stale = hex(JSON.stringify({ message: { role: "assistant", content: "STALE_ANSWER" } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 51 "${stale}")`);
    e(ed, `(fikra-http-complete 51 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
    const text = String(e(ed, "(buffer-text)").value);
    expect(text).not.toContain("STALE_ANSWER");
    // Reply 2 lands normally.
    const fresh = hex(JSON.stringify({ message: { role: "assistant", content: "fresh answer" } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 52 "${fresh}")`);
    e(ed, `(fikra-http-complete 52 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    expect(String(e(ed, "(buffer-text)").value)).toContain("fresh answer");
  });

  test("history ORDER: first exchange before second; the in-flight message excluded", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "first")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 61 "live")');
    const r1 = hex(JSON.stringify({ message: { role: "assistant", content: "first answer" } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 61 "${r1}")`);
    e(ed, `(fikra-http-complete 61 200 "${hex("{}")}")`);
    e(ed, '(fikra/chat/fikra-turn-send "second")');
    // turn-begin already ran — the history builder runs at fire time, but
    // assert the shape the builder produces from THIS memory.
    const h = String(e(ed, "(fikra/backend-ollama/fikra-ollama-history-messages)").value);
    const first = h.indexOf('"content":"first"');
    const answer = h.indexOf('"content":"first answer"');
    expect(first).toBeGreaterThan(-1);
    expect(answer).toBeGreaterThan(first);
    // The in-flight message ("second") appears EXACTLY ONCE in the final
    // body — the history cut excludes it; the explicit append adds it.
    const bodyParts = h.split('"content":"second"');
    expect(bodyParts.length - 1).toBe(0);
  });
});
