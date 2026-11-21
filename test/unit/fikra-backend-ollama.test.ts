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

// r126: bash runs ASYNC (make-process) — poll until the editor state
// contains the marker (the sentinel fires outside the eval's control).

// r126: the async sentinel re-fires a REAL request after the round —
// intercept it: poll for a NEW latest-id, seed it, complete it.
async function settleRefireFrom(ed: Editor, before: string, reply: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const now = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    if (now !== before && now !== "null") {
      e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed ${now} "live")`);
      const r = Buffer.from(JSON.stringify({ message: { role: "assistant", content: reply } }), "utf8").toString("hex");
      e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${now} "${r}")`);
      e(ed, `(fikra-http-complete ${now} 200 "${Buffer.from("{}", "utf8").toString("hex")}")`);
      return;
    }
    await new Promise((res) => setTimeout(res, 100));
  }
}


async function untilStatus(ed: Editor, want: string, tries = 40): Promise<string> {
  let s = "";
  for (let i = 0; i < tries; i++) {
    s = String(e(ed, "(fikra/thread/fikra-thread-status)").value);
    if (s === want) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  return s;
}

async function until(ed: Editor, expr: string, marker: string, tries = 40): Promise<string> {
  let text = "";
  for (let i = 0; i < tries; i++) {
    text = String(e(ed, expr).value);
    if (text.includes(marker)) return text;
    await new Promise((r) => setTimeout(r, 100));
  }
  return text;
}

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
  // r126: bash is async and the sentinel RE-FIRES real requests — a
  // live localhost ollama would race every seeded completion. Point at
  // a dead port: real requests fail fast and the pending-guard discards
  // their completions (every test drives replies synthetically).
  e(ed, '(fikra/backend-ollama/fikra-backend-ollama-set-url "http://127.0.0.1:1")');
  // Pin a model (no live /api/tags resolution on the dead port).
  e(ed, '(fikra/backend-ollama/fikra-backend-ollama-set-model "test:fake")');
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
  // A committed base (the per-action checkpoint captures refs — they
  // need a real tree; unborn repos have none).
  writeFileSync(join(dir, "base.txt"), "base\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
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

describe("ollama thread-switch routing (r111 — codex r110 P2)", () => {
  test("a reply arriving after the user SWITCHED AWAY settles ITS thread", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "question on main")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 71 "live")');
    // The user switches to another thread before the reply lands.
    e(ed, '(require-module fikra/threads)');
    e(ed, '(fikra/thread/fikra-thread-focus "away")');
    expect(String(e(ed, "(fikra/thread/fikra-thread-current)").value)).toBe("away");
    const reply = hex(JSON.stringify({ message: { role: "assistant", content: "background answer" } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 71 "${reply}")`);
    e(ed, `(fikra-http-complete 71 200 "${hex("{}")}")`);
    // The MAIN thread settled (not stranded); focus RESTORED to away.
    e(ed, '(fikra/thread/fikra-thread-focus "main")');
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    const text = String(e(ed, "(buffer-text)").value);
    expect(text).toContain("background answer");
    expect(String(e(ed, "(fikra/thread/fikra-thread-current)").value)).toBe("main");
  });
});

describe("ollama evidence honesty (r113 — codex r112 P1/P2)", () => {
  test("a FAILING bash command renders → FAIL with the exit status; the model sees it", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "run it")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 91 "live")');
    const r1 = Buffer.from(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [
      { function: { name: "bash", arguments: JSON.stringify({ command: "echo BOOM; exit 42" }) } },
    ] } }), "utf8").toString("hex");
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 91 "${r1}")`);
    e(ed, `(fikra-http-complete 91 200 "${Buffer.from("{}", "utf8").toString("hex")}")`);
    const text = await until(ed, "(buffer-text)", "FAIL");
    expect(text).toContain("FAIL");
    expect(text).toContain("BOOM");
    expect(text).toContain("exit 42");
    expect(String(e(ed, "(editor-status)").value)).not.toContain("unreachable");
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 92 "live")');
    const r2 = Buffer.from(JSON.stringify({ message: { role: "assistant", content: "noted the failure" } }), "utf8").toString("hex");
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 92 "${r2}")`);
    e(ed, `(fikra-http-complete 92 200 "${Buffer.from("{}", "utf8").toString("hex")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
  });
});

describe("ollama tool-using loop (r112 — the 8.1 native loop)", () => {
  test("a tool_call round: the ⚙ rows render, the tool RUNS, the next request carries the exchange", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "list the files")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 81 "live")');
    // Round 1: the model calls bash.
    const r1 = hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [
      { function: { name: "bash", arguments: JSON.stringify({ command: "echo tool-round-ran" }) } },
    ] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 81 "${r1}")`);
    e(ed, `(fikra-http-complete 81 200 "${hex("{}")}")`);
    // The tool EXECUTED: its result row renders with the real output.
    const mid = strip(await until(ed, "(buffer-text)", "tool-round-ran"));
    expect(mid).toContain("⚙ bash");
    expect(mid).toContain("echo tool-round-ran");
    expect(mid).toContain("tool-round-ran");
    // The turn continues (round 2 fired — still running).
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
    // The accumulator carries the exchange (the next request's context).
    const acc = await until(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)", '"role":"tool"');
    expect(acc).toContain("tool-round-ran");
    // Round 2: the model answers in plain text — the loop ends.
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 82 "live")');
    const r2 = hex(JSON.stringify({ message: { role: "assistant", content: "done listing" } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 82 "${r2}")`);
    e(ed, `(fikra-http-complete 82 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    const final = strip(String(e(ed, "(buffer-text)").value));
    expect(final).toContain("assistant › done listing");
    expect(final).toContain("── completed ──");
  });

  test("buffer_edit WRITES the file and renders its row", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "create the file")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 83 "live")');
    const r1 = hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [
      { function: { name: "buffer_edit", arguments: JSON.stringify({ path: "made-by-model.txt", content: "model content\n" }) } },
    ] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 83 "${r1}")`);
    e(ed, `(fikra-http-complete 83 200 "${hex("{}")}")`);
    const text = strip(String(e(ed, "(buffer-text)").value));
    expect(text).toContain("⚙ buffer-edit");
    expect(text).toContain("made-by-model.txt");
    expect(String(e(ed, '(shell-command "cat made-by-model.txt")').value)).toContain("model content");
    // End the turn (round 2 reply).
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 84 "live")');
    const r2 = hex(JSON.stringify({ message: { role: "assistant", content: "file created" } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 84 "${r2}")`);
    e(ed, `(fikra-http-complete 84 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
  });
});

describe("ollama object-shaped arguments (r114 — codex r113 P1)", () => {
  test("arguments arriving as an OBJECT (the live qwen3 shape) execute for real", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "run it")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 95 "live")');
    // The arguments as an OBJECT (not a JSON string) — the live shape.
    const r1 = Buffer.from(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [
      { function: { name: "bash", arguments: { command: "echo OBJECT-ARGS-RAN" } } },
    ] } }), "utf8").toString("hex");
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 95 "${r1}")`);
    e(ed, `(fikra-http-complete 95 200 "${Buffer.from("{}", "utf8").toString("hex")}")`);
    const text = await until(ed, "(buffer-text)", "OBJECT-ARGS-RAN");
    // The COMMAND RAN (the old path executed an empty command).
    expect(text).toContain("OBJECT-ARGS-RAN");
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 96 "live")');
    const r2 = Buffer.from(JSON.stringify({ message: { role: "assistant", content: "done" } }), "utf8").toString("hex");
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 96 "${r2}")`);
    e(ed, `(fikra-http-complete 96 200 "${Buffer.from("{}", "utf8").toString("hex")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
  });

  test("the MODEL-VISIBLE failure status rides the next request (codex r113 P2#5)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "run it")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 97 "live")');
    const r1 = Buffer.from(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [
      { function: { name: "bash", arguments: { command: "echo NOPE; exit 7" } } },
    ] } }), "utf8").toString("hex");
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 97 "${r1}")`);
    e(ed, `(fikra-http-complete 97 200 "${Buffer.from("{}", "utf8").toString("hex")}")`);
    // The ACCUMULATOR (the next request's tool message) carries the status.
    const acc = await until(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)", "exit code: 7");
    expect(acc).toContain("NOPE");
  });
});

describe("ollama L2 gate + per-action checkpoints (r116 — the 8.1 named follow-ups)", () => {
  const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
  const fireTool = (ed: Editor, seed: number, command: string, name = "bash") => {
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed ${seed} "live")`);
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [
      { function: { name, arguments: name === "bash" ? { command } : { path: "r116.txt", content: "checkpointed" } } },
    ] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${seed} "${r}")`);
    e(ed, `(fikra-http-complete ${seed} 200 "${hex("{}")}")`);
  };

  test("a DESTRUCTIVE bash parks at the gate: the panel renders, the command does NOT run", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "clean it up")');
    fireTool(ed, 101, "rm -rf build/");
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    expect(String(e(ed, "(fikra/approvals/fikra-approval-pending-p)").value)).toBe("true");
    const panel = String(e(ed, "(buffer-text)").value);
    expect(panel).toContain("APPROVE ACTION");
    expect(panel).toContain("rm -rf build/");
    expect(panel).not.toMatch(/→ (ok|FAIL)/);
  });

  test("ALLOW resumes: the command executes and the loop continues", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "clean it up")');
    fireTool(ed, 102, "rm -rf build/");
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    const idBefore = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
    const text = await until(ed, "(buffer-text)", "→ ");
    expect(text).toContain("rm -rf build/");
    expect(text).toMatch(/→ (ok|FAIL)/);
    // The async continuation: the tool message lands in the accumulator
    // and the loop RE-FIRES (a new request id appears; on the dead
    // port its refusal settles the turn — the seeded completions cannot
    // outrun a ms-fast connection refusal, so assert the ATTEMPT).
    const acc = await until(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)", '"role":"tool"');
    expect(acc).toContain("rm -rf build/");
    let refired = false;
    for (let i = 0; i < 40; i++) {
      const now = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
      if (now !== idBefore && now !== "null") { refired = true; break; }
      await new Promise((res) => setTimeout(res, 50));
    }
    expect(refired).toBe(true);
  });

  test("REJECT: the model LEARNS (the denial rides the next request)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "clean it up")');
    fireTool(ed, 104, "rm -rf build/");
    e(ed, "(fikra/approvals/fikra-approval-answer-reject)");
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
    const acc = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
    expect(acc).toContain("user rejected this command");
    expect(String(e(ed, "(buffer-text)").value)).toContain("= denied");
  });

  test("a model EDIT lands a checkpoint (the marker rides INLINE via the merge)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "make the file")');
    fireTool(ed, 105, "", "buffer_edit");
    expect(String(e(ed, '(shell-command "cat r116.txt")').value)).toContain("checkpointed");
    // The capture is async; poll the EVENT MEMORY for checkpoint-ready
    // (diagnostics first — then the inline marker after a rebuild).
    let marked = false;
    for (let i = 0; i < 15 && !marked; i++) {
      e(ed, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
      const t = String(e(ed, "(buffer-text)").value);
      if (/r116\.txt.*ckpt|ckpt.*r116\.txt/.test(t)) marked = true;
      else await new Promise((r) => setTimeout(r, 200));
    }
    expect(marked).toBe(true);
  });
});

describe("ollama gate hardening (r117 — codex r116 catches)", () => {
  const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
  const fireCalls = (ed: Editor, seed: number, commands: { name: string; args: unknown }[]) => {
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed ${seed} "live")`);
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls:
      commands.map((c) => ({ function: { name: c.name, arguments: c.args } })) } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${seed} "${r}")`);
    e(ed, `(fikra-http-complete ${seed} 200 "${hex("{}")}")`);
  };

  test("a PARKED call STOPS the round — later calls do not run", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "two calls")');
    fireCalls(ed, 111, [
      { name: "bash", args: { command: "rm -rf t/" } },
      { name: "bash", args: { command: "echo after-park" } },
    ]);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    const text = String(e(ed, "(buffer-text)").value);
    expect(text).not.toContain("after-park");
    expect(text).toContain("APPROVE ACTION");
  });

  test("a DIRECT eval of the decide seam is DENIED (the L2 guard)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "x")');
    fireCalls(ed, 112, [{ name: "bash", args: { command: "rm -rf d/" } }]);
    const direct = e(ed, '(condition-case nil (progn (require-module "fikra/approvals") (confirmation-service-stamp-headless) (fikra/backend-ollama/fikra-backend-ollama-decide "y")) (error () "ERR"))');
    void direct;
    // The guard denies headless resolvers by default in tests? The service
    // defaults interactive — drive the stamp directly instead:
    const { confirmationService } = await import("../../src/editor/api/confirmation-service.ts");
    confirmationService.resolverHint = "headless";
    expect(String(e(ed, '(fikra/backend-ollama/fikra-backend-ollama-decide "y")').value)).toBe("null");
    confirmationService.resolverHint = "interactive";
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
  });

  test("the refusal reaches the MODEL (no false 'wrote' after a refusal)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "escape")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 115 "live")');
    const r = Buffer.from(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [
      { function: { name: "buffer_edit", arguments: { path: "../out.txt", content: "x" } } }] } }), "utf8").toString("hex");
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 115 "${r}")`);
    e(ed, `(fikra-http-complete 115 200 "${Buffer.from("{}", "utf8").toString("hex")}")`);
    const acc = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
    expect(acc).toContain("refused: path escapes");
    expect(acc).not.toContain("wrote ../out.txt");
    expect(String(e(ed, "(buffer-text)").value)).not.toContain("wrote ../out.txt");
  });

  test("an edit with ../ ESCAPE refuses (containment)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "escape")');
    fireCalls(ed, 113, [{ name: "buffer_edit", args: { path: "../outside.txt", content: "nope" } }]);
    const text = String(e(ed, "(buffer-text)").value);
    expect(text).toContain("REFUSED: path escapes the working dir");
    expect(String(e(ed, '(shell-command "test -f ../outside.txt && echo EXISTS || echo ABSENT")').value).trim()).toBe("ABSENT");
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 114 "live")');
    const reply = hex(JSON.stringify({ message: { role: "assistant", content: "refused noted" } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 114 "${reply}")`);
    e(ed, `(fikra-http-complete 114 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
  });
});

describe("ollama focus-switch lifecycle (r119 — codex r118 P1)", () => {
  test("park → switch → allow: the ORIGINATING thread settles (not stranded confirming)", async () => {
    const ed = await armed();
    e(ed, "(require-module fikra/threads)");
    e(ed, '(fikra/chat/fikra-turn-send "dangerous")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 121 "live")');
    const r = Buffer.from(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [
      { function: { name: "bash", arguments: { command: "rm -rf z/" } } }] } }), "utf8").toString("hex");
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 121 "${r}")`);
    e(ed, `(fikra-http-complete 121 200 "${Buffer.from("{}", "utf8").toString("hex")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    // Switch away, then allow.
    e(ed, '(fikra/thread/fikra-thread-focus "away")');
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    // The home (main) thread must NOT be stranded confirming.
    e(ed, '(fikra/thread/fikra-thread-focus "main")');
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
    expect(String(e(ed, "(fikra/thread/fikra-thread-current)").value)).toBe("main");
  });
});

describe("ollama resume + buffer-read (r120 — codex r119 P2s)", () => {
  const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
  const fireCalls = (ed: Editor, seed: number, calls: { name: string; args: unknown }[]) => {
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed ${seed} "live")`);
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls:
      calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${seed} "${r}")`);
    e(ed, `(fikra-http-complete ${seed} 200 "${hex("{}")}")`);
  };

  test("ALLOW resumes the parked reply's REMAINING calls (they were dropped)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "two step")');
    fireCalls(ed, 131, [
      { name: "bash", args: { command: "rm -rf q/" } },
      { name: "bash", args: { command: "echo AFTER-RESUME" } },
    ]);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    expect(String(e(ed, "(buffer-text)").value)).not.toContain("AFTER-RESUME");
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    const text = String(e(ed, "(buffer-text)").value);
    expect(text).toContain("AFTER-RESUME");
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value)).toContain("AFTER-RESUME");
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 132 "live")');
    const reply = hex(JSON.stringify({ message: { role: "assistant", content: "done both" } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 132 "${reply}")`);
    e(ed, `(fikra-http-complete 132 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
  });

  test("buffer_read returns the file's content to the model (and not-found is honest)", async () => {
    const ed = await armed();
    e(ed, '(shell-command "printf \'hello-read-target\' > read-me.txt")');
    e(ed, '(fikra/chat/fikra-turn-send "read it")');
    fireCalls(ed, 133, [
      { name: "buffer_read", args: { path: "read-me.txt" } },
      { name: "buffer_read", args: { path: "absent.txt" } },
    ]);
    const text = String(e(ed, "(buffer-text)").value);
    expect(text).toContain("buffer-read");
    expect(text).toContain("read-me.txt: 17 chars");
    expect(text).toContain("not found: absent.txt");
    const acc = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
    expect(acc).toContain("hello-read-target");
    expect(acc).toContain("file not found: absent.txt");
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 134 "live")');
    const reply = hex(JSON.stringify({ message: { role: "assistant", content: "read both" } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 134 "${reply}")`);
    e(ed, `(fikra-http-complete 134 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
  });
});

describe("ollama multi-park + pre-park results (r121 — codex r120 catches)", () => {
  const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
  const fireCalls = (ed: Editor, seed: number, commands: string[]) => {
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed ${seed} "live")`);
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls:
      commands.map((c) => ({ function: { name: "bash", arguments: { command: c } } })) } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${seed} "${r}")`);
    e(ed, `(fikra-http-complete ${seed} 200 "${hex("{}")}")`);
  };

  test("results BEFORE a park are kept; a SECOND park holds the model request", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "multi")');
    fireCalls(ed, 141, [
      "echo BEFOREPARK",
      "rm -rf one/",
      "rm -rf two/",
      "echo AFTERPARK",
    ]);
    // First park (async: BEFOREPARK's bash runs, then the rm parks).
    expect(await untilStatus(ed, "confirming")).toBe("confirming");
    expect(await until(ed, "(buffer-text)", "BEFOREPARK")).toContain("BEFOREPARK");
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    // The SECOND rm parks again — AFTERPARK not yet, no model re-fire.
    expect(await untilStatus(ed, "confirming")).toBe("confirming");
    const mid = String(e(ed, "(buffer-text)").value);
    expect(mid).not.toContain("AFTERPARK");
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    // Now the rest completed; the model request fires; settle it.
    const acc = await until(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)", "AFTERPARK");
    expect(acc).toContain("BEFOREPARK");
    // r122 (codex r121 P1): ORDER — the tool messages appear in CALL
    // order (the approved result joins the acc at its position).
    const before = acc.indexOf("BEFOREPARK");
    const after = acc.indexOf("AFTERPARK");
    expect(before).toBeGreaterThan(-1);
    expect(after).toBeGreaterThan(before);
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 142 "live")');
    const reply = hex(JSON.stringify({ message: { role: "assistant", content: "all done" } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 142 "${reply}")`);
    e(ed, `(fikra-http-complete 142 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
  });
});

describe("ollama resumed-remainder dir binding (r123 — codex r122 P1)", () => {
  const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
  test("calls resumed after a focus switch run in the ORIGINATING dir", async () => {
    const ed = await armed();
    e(ed, "(require-module fikra/threads)");
    // A second thread with its own root.
    e(ed, '(fikra/chat/fikra-turn-send "park then read")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 151 "live")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [
      { function: { name: "bash", arguments: { command: "rm -rf h/" } } },
      { function: { name: "bash", arguments: { command: "pwd" } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 151 "${r}")`);
    e(ed, `(fikra-http-complete 151 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    const homeDir = String(e(ed, "(fikra/thread/fikra-thread-working-dir)").value);
    // Switch away; allow — the resumed `pwd` must report the HOME dir.
    e(ed, '(fikra/thread/fikra-thread-focus "away")');
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    const acc = await until(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)", homeDir.replace(/\/$/, ""));
    expect(acc).toContain(homeDir.replace(/\/$/, ""));
    expect(String(e(ed, "(fikra/thread/fikra-thread-current)").value)).toBe("away");
  });
});

describe("ollama next-round ownership (r124 — codex r123 P1)", () => {
  const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
  test("the NEXT model request after a switched-away decision stamps the ORIGINATING thread", async () => {
    const ed = await armed();
    e(ed, "(require-module fikra/threads)");
    e(ed, '(fikra/chat/fikra-turn-send "park then continue")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 161 "live")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [
      { function: { name: "bash", arguments: { command: "rm -rf n/" } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 161 "${r}")`);
    e(ed, `(fikra-http-complete 161 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    // Switch away; allow — the continuation (resume + the re-fire) runs
    // home-bound; the fired request's thread map entry names HOME.
    e(ed, '(fikra/thread/fikra-thread-focus "away")');
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    // The next request fired (running on home); its thread stamp is home.
    // Direct: the home thread is running (the re-fire began there).
    e(ed, '(fikra/thread/fikra-thread-focus "main")');
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
    expect(String(e(ed, "(fikra/thread/fikra-thread-current)").value)).toBe("main");
  });
});

describe("ollama async exec (r126 — the codex-named responsiveness gap)", () => {
  const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
  test("a LONG bash does NOT block the daemon — another eval answers while it runs", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "long work")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 171 "live")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [
      { function: { name: "bash", arguments: { command: "sleep 2 && echo SLOW-DONE" } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 171 "${r}")`);
    e(ed, `(fikra-http-complete 171 200 "${hex("{}")}")`);
    // The row rendered (the spawn happened)...
    expect(String(e(ed, "(buffer-text)").value)).toContain("sleep 2");
    // ...and the daemon answers OTHER evals while the child sleeps —
    // the OLD synchronous shell-command blocked everything for 2s.
    const t0 = Date.now();
    expect(String(e(ed, "(+ 1 2)").value)).toBe("3");
    expect(Date.now() - t0).toBeLessThan(1500);
    // The result arrives when the child exits.
    const text = await until(ed, "(buffer-text)", "SLOW-DONE", 60);
    expect(text).toContain("SLOW-DONE");
  });
});

describe("ollama async hardening (r127 — codex r126 catches)", () => {
  const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
  const fireCalls = (ed: Editor, seed: number, calls: { name: string; args: unknown }[]) => {
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed ${seed} "live")`);
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls:
      calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${seed} "${r}")`);
    e(ed, `(fikra-http-complete ${seed} 200 "${hex("{}")}")`);
  };

  test("a buffer_read BEFORE an async bash rides the resume (its result never vanishes)", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "pre.txt"), "READ-BEFORE-ASYNC");
    e(ed, '(fikra/chat/fikra-turn-send "mixed")');
    fireCalls(ed, 181, [
      { name: "buffer_read", args: { path: "pre.txt" } },
      { name: "bash", args: { command: "echo AFTER-BASH" } },
    ]);
    // Poll for the TOOL MESSAGE (the command text also appears in the
    // tool_calls JSON — match the result shape, not the command).
    const acc = await until(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)", '"role":"tool"');
    expect(acc).toContain("READ-BEFORE-ASYNC");
    const readMsg = acc.indexOf('"role":"tool","content":"READ-BEFORE-ASYNC"');
    const bashMsg = acc.indexOf('"role":"tool","content":"AFTER-BASH"');
    expect(readMsg).toBeGreaterThan(-1);
    expect(bashMsg).toBeGreaterThan(readMsg);
  });

  test("a FAILED spawn renders an honest FAIL row + the model-visible message (never 'async)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "bad dir")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 191 "live")');
    // Point the thread's worktree field at a nonexistent dir — the
    // spawn's :cwd fails.
    e(ed, '(fikra/thread/fikra-thread-set-field "worktree" "/nonexistent-dir-xyz")');
    const r = Buffer.from(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [
      { function: { name: "bash", arguments: { command: "echo never" } } }] } }), "utf8").toString("hex");
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 191 "${r}")`);
    e(ed, `(fikra-http-complete 191 200 "${Buffer.from("{}", "utf8").toString("hex")}")`);
    const text = await until(ed, "(buffer-text)", "spawn failed");
    expect(text).toContain("FAIL");
    const acc = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
    expect(acc).toContain("spawn failed");
    expect(acc).not.toContain("never\n");
    e(ed, '(fikra/thread/fikra-thread-set-field "worktree" nil)');
  });

  test("the non-blocking proof is DURING: the eval answers BEFORE the 2s command finishes", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "slow")');
    fireCalls(ed, 182, [{ name: "bash", args: { command: "sleep 2 && echo SLOW-END" } }]);
    // The row rendered = the spawn happened; the child sleeps NOW.
    expect(String(e(ed, "(buffer-text)").value)).toContain("sleep 2");
    // The concurrent eval must answer while the child still sleeps —
    // verified by the RESULT not yet being rendered.
    const t0 = Date.now();
    expect(String(e(ed, "(+ 1 2)").value)).toBe("3");
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(1500);
    // DURING: the call row (sleep 2) is rendered but NO result row —
    // the child verifiably still runs (the result shape, not the
    // command text, which the tool-call row already contains).
    expect(String(e(ed, "(buffer-text)").value)).not.toMatch(/→ (ok|FAIL)/);
    // ...and the RESULT row (not the command echo) lands at exit.
    const done = await until(ed, "(buffer-text)", "→ ok", 60);
    expect(done).toMatch(/→ ok\s*SLOW-END|SLOW-END[\s\S]*→ ok/);
  });
});
