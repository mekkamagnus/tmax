import { describe, expect, test, beforeEach, beforeAll, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
// r129: THROW when the re-fire never arrives (a silent return here is
// how a broken resume path stayed unit-green while live turns stuck).
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
  throw new Error("the post-round re-fire never arrived (resume path broken?)");
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

// r129: every test here polls (100ms cycles) and several run git
// checkpoints through the allow path — under load the 5s default
// budget false-fails them (codex's gate run hit exactly that). One
// uniform 20s budget.
const tt = (name: string, fn: () => Promise<void>) => test(name, fn, 20000);
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
  // r129: point at the STUB server — /api/tags answers (availability +
  // model resolution pass), /api/chat accepts and NEVER responds. Every
  // real fire (the initial chat AND the async sentinel's re-fire) hangs
  // forever, so nothing can race the synthetic completions. (The r126
  // dead-port fixture refused instantly — fine until the r129 resume
  // fix made the re-fire actually fire: its refusal could land while it
  // was still latest and error the turn mid-test.)
  e(ed, `(fikra/backend-ollama/fikra-backend-ollama-set-url "${stubUrl}")`);
  // Pin a model (no live /api/tags resolution dependency).
  e(ed, '(fikra/backend-ollama/fikra-backend-ollama-set-model "test:fake")');
  e(ed, "(fikra/chat/fikra-refresh-lighter)");
  return ed;
}

// r129: the stub ollama (see armed()). A SEPARATE PROCESS: the
// availability probe is a SYNC shell-command curl — it blocks the
// editor's event loop, so an in-process listener can never answer it
// (curl self-deadlocks until --max-time). /api/tags answers instantly;
// POST /api/chat swallows the body and never responds (every real
// fire hangs; synthetic completions drive all replies).
let stubUrl = "";
let bodiesFile = "";
let stubProc: ReturnType<typeof Bun.spawn> | null = null;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "fikra-stub-"));
  const script = join(dir, "stub.ts");
  writeFileSync(script, `
const body = JSON.stringify({ models: [{ name: "test:fake" }] });
const l = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: {
  data(socket, chunk) {
    if (chunk.toString().includes("GET /api/tags")) {
      socket.write("HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nContent-Length: " + body.length + "\\r\\nConnection: close\\r\\n\\r\\n" + body);
      socket.end();
    }
    // POST /api/chat: RECORD the body, never respond (r136 codex
    // re-grade P1: the request boundary must be TESTED — a malformed
    // body 400s on every real ollama while a swallower hid it).
    require("node:fs").appendFileSync(process.argv[2], chunk.toString().slice(chunk.toString().indexOf("\\r\\n\\r\\n") + 4) + "\\n");
  },
} });
console.log(l.port);
`);
  bodiesFile = join(dir, "bodies.jsonl");
  stubProc = Bun.spawn(["bun", "run", script, bodiesFile], { stdout: "pipe", stderr: "inherit" });
  // Read the FIRST LINE only (the child keeps running to serve) — under
  // a 10s guard: a hung beforeAll defeats every test timeout and the
  // runner sits silent forever (codex r131's gate hung exactly so).
  const stream = stubProc.stdout;
  if (!stream || typeof stream === "number") throw new Error("stub ollama: no stdout");
  const port = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("stub ollama did not print a port within 10s")), 10_000);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value);
        const nl = acc.indexOf("\n");
        if (nl >= 0) { clearTimeout(timer); resolve(acc.slice(0, nl)); await reader.cancel(); return; }
      }
      clearTimeout(timer);
      reject(new Error(`stub ollama exited before printing a port: ${acc}`));
    })();
  });
  stubUrl = `http://127.0.0.1:${port.trim()}`;
  // Refuse to run against nothing (every test would 2s-timeout).
  if (!/^\d+$/.test(port.trim())) throw new Error(`stub ollama failed to start: ${port}`);
});

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
  stubProc?.kill();
});

describe("#8.1 raw-API ollama chat backend (r108)", () => {
  tt("the landed reply renders an ASSISTANT turn and ends it - the fikra-owned loop", async () => {
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

  tt("a dead server ends the turn as an ERROR with a visible status", async () => {
    const ed = await armed();
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-start-turn "hello")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 22 "live")');
    e(ed, `(fikra-http-complete 22 0 "${hex("refused")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("error");
    expect(String(e(ed, "(editor-status)").value)).toContain("unreachable");
  });

  tt("the modeline carries the backend; a backend without a model stays BARE", async () => {
    const ed = await armed();
    expect(String(e(ed, '(minor-mode-lighter "fikra")').value)).toContain("ollama");
    e(ed, '(fikra/adapter/fikra-set-backend-forced "replay")');
    e(ed, "(fikra/chat/fikra-refresh-lighter)");
    const bare = String(e(ed, '(minor-mode-lighter "fikra")').value);
    expect(bare).toContain("replay");
    expect(bare).not.toMatch(/\(/);
  });

  tt("the capabilities are honest: no streaming, no approvals", async () => {
    const ed = await armed();
    expect(String(e(ed, '(fikra/adapter/fikra-backend-capable-p "ollama" "streaming")').value)).toBe("null");
    expect(String(e(ed, '(fikra/adapter/fikra-backend-capable-p "ollama" "interactive-approvals")').value)).toBe("null");
  });
});

describe("ollama chat lifecycle (r109 — codex r108 catches)", () => {
  tt("a CONNECTION FAILURE (no chunks, unseeded-by-filter) still settles — fire-time ownership", async () => {
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

  tt("a late reply whose turn was ABORTED discards (no ghost render)", async () => {
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

  tt("HISTORY rides the messages (the second turn sees the first exchange)", async () => {
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
  tt("abort turn 1, start turn 2, deliver reply 1 — the STALE reply discards", async () => {
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

  tt("history ORDER: first exchange before second; the in-flight message excluded", async () => {
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
  tt("a reply arriving after the user SWITCHED AWAY settles ITS thread", async () => {
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
  tt("a FAILING bash command renders → FAIL with the exit status; the model sees it", async () => {
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
  tt("a tool_call round: the ⚙ rows render, the tool RUNS, the next request carries the exchange", async () => {
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

  tt("buffer_edit WRITES the file and renders its row", async () => {
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
  tt("arguments arriving as an OBJECT (the live qwen3 shape) execute for real", async () => {
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

  tt("the MODEL-VISIBLE failure status rides the next request (codex r113 P2#5)", async () => {
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

  tt("a DESTRUCTIVE bash parks at the gate: the panel renders, the command does NOT run", async () => {
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

  tt("ALLOW resumes: the command executes and the loop continues", async () => {
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

  tt("REJECT: the model LEARNS (the denial rides the next request)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "clean it up")');
    fireTool(ed, 104, "rm -rf build/");
    e(ed, "(fikra/approvals/fikra-approval-answer-reject)");
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
    const acc = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
    expect(acc).toContain("user rejected this command");
    expect(String(e(ed, "(buffer-text)").value)).toContain("= denied");
  });

  tt("a model EDIT lands a checkpoint (the marker rides INLINE via the merge)", async () => {
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

  tt("a PARKED call STOPS the round — later calls do not run", async () => {
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

  tt("a DIRECT eval of the decide seam is DENIED (the L2 guard)", async () => {
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

  tt("the refusal reaches the MODEL (no false 'wrote' after a refusal)", async () => {
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

  tt("an edit with ../ ESCAPE refuses (containment)", async () => {
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

describe("ollama gate pattern gaps (r133 — codex r130 P1#5)", () => {
  const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
  const fireCalls = (ed: Editor, seed: number, commands: { name: string; args: unknown }[]) => {
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed ${seed} "live")`);
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls:
      commands.map((c) => ({ function: { name: c.name, arguments: c.args } })) } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${seed} "${r}")`);
    e(ed, `(fikra-http-complete ${seed} 200 "${hex("{}")}")`);
  };

  // Recursive rm WITHOUT -f never matched the old patterns.
  tt("rm -r (no -f) PARKS at the gate", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "recursive no f")');
    fireCalls(ed, 141, [{ name: "bash", args: { command: "rm -r sometree/" } }]);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
  });

  // Truncating redirection clobbers state — it parks; appends and the
  // /dev/null sink do not.
  tt("a truncating > redirection PARKS; >> and /dev/null do not", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "clobber")');
    fireCalls(ed, 142, [{ name: "bash", args: { command: "echo overwritten > state.txt" } }]);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    expect(String(e(ed, "(fikra/approvals/fikra-approval-risk \"bash\" \"echo x >> state.txt\")").value)).toBe("shell");
    expect(String(e(ed, "(fikra/approvals/fikra-approval-risk \"bash\" \"make > /dev/null 2>&1\")").value)).toBe("shell");
  });

  // A symlink hop out of the tree refuses for BOTH write and read.
  tt("an in-tree symlink pointing OUTSIDE refuses for edit and read", async () => {
    const ed = await armed();
    // outside/ sits OUTSIDE the working dir (a sibling tmpdir).
    const outside = mkdtempSync(join(tmpdir(), "r133-out-"));
    e(ed, `(shell-command "ln -s ${outside} escape-link")`);
    e(ed, '(fikra/chat/fikra-turn-send "symlink escape")');
    fireCalls(ed, 143, [
      { name: "buffer_edit", args: { path: "escape-link/pwned.txt", content: "outside\n" } },
    ]);
    const acc = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
    expect(acc).toContain("refused: path escapes the working directory");
    expect(existsSync(join(outside, "pwned.txt"))).toBe(false);
    // Reads through the same hop leak nothing.
    writeFileSync(join(outside, "secret.txt"), "TOP-SECRET-CONTENT");
    fireCalls(ed, 144, [
      { name: "buffer_read", args: { path: "escape-link/secret.txt" } },
    ]);
    const acc2 = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
    expect(acc2).not.toContain("TOP-SECRET-CONTENT");
    expect(acc2).toContain("escape-link/secret.txt");
    // r133b (codex r133 catch): a DANGLING symlink escapes -e (the
    // test follows links) — the write followed the link OUT and created
    // the outside file. The walk now stops at the link itself and
    // readlink reveals the outside target.
    const dangling = mkdtempSync(join(tmpdir(), "r133-dangling-"));
    e(ed, `(shell-command "ln -s ${dangling}/gone.txt dangle-link")`);
    fireCalls(ed, 146, [
      { name: "buffer_edit", args: { path: "dangle-link", content: "DANGLING-ESCAPE\n" } },
    ]);
    expect(existsSync(join(dangling, "gone.txt"))).toBe(false);
    const accD = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
    expect(accD).toContain("refused: path escapes the working directory");
    rmSync(dangling, { recursive: true, force: true });
    // The classifier's redirection corners (r133b): >&FILE truncates;
    // only >&DIGIT is fd-duplication; /dev/nullish is not the sink.
    expect(String(e(ed, '(fikra/approvals/fikra-approval-risk "bash" "echo x >& state.txt")').value)).toBe("destructive");
    expect(String(e(ed, '(fikra/approvals/fikra-approval-risk "bash" "echo x >&state.txt")').value)).toBe("destructive");
    expect(String(e(ed, '(fikra/approvals/fikra-approval-risk "bash" "cmd 2>&1")').value)).toBe("shell");
    expect(String(e(ed, '(fikra/approvals/fikra-approval-risk "bash" "make > /dev/null 2>&1")').value)).toBe("shell");
    expect(String(e(ed, '(fikra/approvals/fikra-approval-risk "bash" "echo x > /dev/nullish")').value)).toBe("destructive");
    // r133c (codex r133b mid-verify catch): ">&1state.txt" is a FILE
    // named 1state.txt — only an ALL-DIGIT word after >& is fd-dup.
    expect(String(e(ed, '(fikra/approvals/fikra-approval-risk "bash" "echo x >&1state.txt")').value)).toBe("destructive");
    // r133d (codex r133c catches): multi-space and multi-flag-word
    // recursive rm classifies destructive.
    expect(String(e(ed, '(fikra/approvals/fikra-approval-risk "bash" "rm   -r tree/")').value)).toBe("destructive");
    expect(String(e(ed, '(fikra/approvals/fikra-approval-risk "bash" "rm --verbose -r tree/")').value)).toBe("destructive");
    // r133e (codex r133d catch): a TAB after rm; operand-order flags;
    // command separators end the scan.
    const tabCmd = Buffer.from("rm\t-r tree/", "utf8").toString("hex");
    expect(String(e(ed, `(fikra/approvals/fikra-approval-risk "bash" (hex-decode "${tabCmd}"))`).value)).toBe("destructive");
    expect(String(e(ed, '(fikra/approvals/fikra-approval-risk "bash" "rm tree -r")').value)).toBe("destructive");
    expect(String(e(ed, '(fikra/approvals/fikra-approval-risk "bash" "rm x; grep -r pat")').value)).toBe("shell");
    // r133f (codex r133e findings, FP-direction): --verbose/--force are
    // not recursive; a newline ends the scan like ; | &.
    expect(String(e(ed, '(fikra/approvals/fikra-approval-risk "bash" "rm --verbose file")').value)).toBe("shell");
    expect(String(e(ed, '(fikra/approvals/fikra-approval-risk "bash" "rm --force file")').value)).toBe("shell");
    expect(String(e(ed, '(fikra/approvals/fikra-approval-risk "bash" "rm --recursive x")').value)).toBe("destructive");
    expect(String(e(ed, '(fikra/approvals/fikra-approval-risk "bash" "rm --verbose -r tree/")').value)).toBe("destructive");
    const nlCmd = Buffer.from("rm x\ngrep -r pat", "utf8").toString("hex");
    expect(String(e(ed, `(fikra/approvals/fikra-approval-risk "bash" (hex-decode "${nlCmd}"))`).value)).toBe("shell");
    // A dangling link whose RAW target hops with ".. — refuses now.
    e(ed, '(shell-command "ln -s ../outside-hop/gone2.txt hop-link")');
    e(ed, '(fikra/chat/fikra-turn-send "hop link")');
    fireCalls(ed, 160, [{ name: "buffer_edit", args: { path: "hop-link", content: "HOP-ESCAPE\n" } }]);
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value)).toContain("refused");
    expect(String(e(ed, '(fikra/approvals/fikra-approval-risk "bash" "echo x >&2")').value)).toBe("shell");
    // The dotdot family refuses through buffer_edit (no .. anywhere —
    // including embedded and trailing shapes). Each fire gets its OWN
    // turn (the tool-round cap ends a turn after 4 rounds — later
    // seeded completions would go inert on an ended turn).
    let seed = 150;
    for (const p of ["../via-dotdot.txt", "sub/../../via-dotdot.txt", "sub/..", "..hidden/../../via-dotdot.txt"]) {
      e(ed, `(fikra/chat/fikra-turn-send "dotdot ${seed}")`);
      fireCalls(ed, seed, [{ name: "buffer_edit", args: { path: p, content: "DOTDOT-ESCAPE\n" } }]);
      seed += 1;
    }
    expect(existsSync(join(outside, "via-dotdot.txt"))).toBe(false);
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value))
      .toContain("refused: path escapes the working directory");
    // A LEGIT nested path still writes (no false refusals).
    fireCalls(ed, 145, [
      { name: "buffer_edit", args: { path: "nested/deep/ok.txt", content: "inside\n" } },
    ]);
    expect(existsSync(join(process.cwd(), "nested/deep/ok.txt"))).toBe(true);
    rmSync(outside, { recursive: true, force: true });
  });
});

describe("ollama per-action checkpoint refs (r134 — codex r130 P1#4)", () => {
  const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
  const fireCalls = (ed: Editor, seed: number, calls: { name: string; args: unknown }[]) => {
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed ${seed} "live")`);
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls:
      calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${seed} "${r}")`);
    e(ed, `(fikra-http-complete ${seed} 200 "${hex("{}")}")`);
  };
  // NB: %(refname) inside a T-Lisp string literal yields EMPTY output
  // (a reader oddity — named); the plain form works — parse the refname
  // from its third tab-field.
  const refs = (ed: Editor) =>
    String(e(ed, '(shell-command "git for-each-ref refs/fikra")').value)
      .split("\n").map((l: string) => l.split("\t")[1] ?? "")
      .filter((r: string) => r.startsWith("refs/fikra/main/")).join("\n");

  // Each mutating action gets its OWN ref — two edits in one turn do
  // not overwrite each other, and the turn's bare completion ref still
  // lands at turn-end.
  tt("two edits in one turn land DISTINCT action refs (+ the bare turn ref)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "two edits")');
    fireCalls(ed, 191, [
      { name: "buffer_edit", args: { path: "a134.txt", content: "one\n" } },
      { name: "buffer_edit", args: { path: "b134.txt", content: "two\n" } },
    ]);
    // Both action captures complete (async git children).
    let all = "";
    for (let i = 0; i < 60; i++) {
      all = refs(ed);
      if (all.includes("-a1") && all.includes("-a2")) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(all).toContain("refs/fikra/main/1-a1");
    expect(all).toContain("refs/fikra/main/1-a2");
    // The bare turn ref (the turn's ground truth) is NOT one of them.
    expect(all).not.toMatch(/refs\/fikra\/main\/1\n/);
    // The two action refs point at DIFFERENT commits (independence).
    const c1 = String(e(ed, '(shell-command "git rev-parse refs/fikra/main/1-a1")').value).trim();
    const c2 = String(e(ed, '(shell-command "git rev-parse refs/fikra/main/1-a2")').value).trim();
    expect(c1).not.toBe(c2);
    expect(c1).toMatch(/^[0-9a-f]{40}$/);
    // Settle: the turn-end completion capture lands the BARE ref.
    await settleRefireFrom(ed, "191", "DONE-134");
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
    let withBare = "";
    for (let i = 0; i < 60; i++) {
      withBare = refs(ed);
      if (/refs\/fikra\/main\/1\n/.test(withBare)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(withBare).toMatch(/refs\/fikra\/main\/1\n/);
  });

  // A MEDIATED bash (the user allowed a mutation) lands its own action
  // ref at exit — shell mutations get per-action coverage.
  tt("an ALLOWED destructive bash lands its own action ref", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "allowed mutation")');
    fireCalls(ed, 192, [{ name: "bash", args: { command: "rm -rf med134/" } }]);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    const before = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    await settleRefireFrom(ed, before, "MED-DONE");
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
    let all = "";
    for (let i = 0; i < 60; i++) {
      all = refs(ed);
      if (all.includes("-a1")) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(all).toContain("refs/fikra/main/1-a1");
  });
});

describe("ollama transcript evidence (r135 — codex r130 P2s)", () => {
  const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
  const fireReply = (ed: Editor, seed: number, reply: unknown) => {
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed ${seed} "live")`);
    const r = hex(JSON.stringify({ message: reply }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${seed} "${r}")`);
    e(ed, `(fikra-http-complete ${seed} 200 "${hex("{}")}")`);
  };

  // P2: the model's text BESIDE its tool calls renders and rides the
  // reconstructed message (it used to be discarded: content "").
  tt("text beside tool_calls renders + rides the assistant message", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "explain and run")');
    fireReply(ed, 195, { role: "assistant", content: "Running the check now.",
      tool_calls: [{ function: { name: "bash", arguments: { command: "echo TEXT-BESIDE" } } }] });
    const text = strip(await until(ed, "(buffer-text)", "→ ok", 60));
    // The text rendered BEFORE the tool row.
    const ti = text.indexOf("Running the check now.");
    const gi = text.indexOf("⚙ bash");
    expect(ti).toBeGreaterThan(-1);
    expect(gi).toBeGreaterThan(ti);
    expect(text).toMatch(/→ ok\s*TEXT-BESIDE/);
    // The reconstructed assistant message carries it (the next request).
    const acc = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
    expect(acc).toContain('"role":"assistant","content":"Running the check now."');
  });

  // P2: the edit row carries INLINE change evidence (the mockup's
  // +/- lines) — old vs new first lines with counted tails.
  tt("a buffer_edit renders - old / + new preview lines under the row", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "old135.txt"), "alpha\nbeta\ngamma\ndelta\n");
    e(ed, '(fikra/chat/fikra-turn-send "rewrite it")');
    fireReply(ed, 196, { role: "assistant", content: "",
      tool_calls: [{ function: { name: "buffer_edit",
        arguments: { path: "old135.txt", content: "alpha\nBETA-X\ngamma\ndelta\nepsilon\n" } } }] });
    const text = strip(await until(ed, "(buffer-text)", "buffer-edit", 60));
    expect(text).toContain("- alpha");
    expect(text).toContain("- beta");
    expect(text).toContain("- … 2 more");
    expect(text).toContain("+ alpha");
    expect(text).toContain("+ BETA-X");
    expect(text).toContain("+ … 3 more");
    expect(String(e(ed, '(shell-command "cat old135.txt")').value)).toContain("BETA-X");
  });
});

  // r137 (codex re-grade): LATER turns keep the tool context — turn 2's
  // request body carries turn 1's tool exchange (the recorded body is
  // the ground truth).
  tt("a SECOND turn's request carries the first turn's tool exchange", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "first turn")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 199 "live")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [{ function: { name: "bash", arguments: { command: "echo TOOL-CTX" } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 199 "${r}")`);
    e(ed, `(fikra-http-complete 199 200 "${hex("{}")}")`);
    await until(ed, "(buffer-text)", "TOOL-CTX", 60);
    await settleRefireFrom(ed, "199", "first done");
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
    // Turn 2: its fired body must contain turn 1's exchange.
    e(ed, '(fikra/chat/fikra-turn-send "second turn")');
    let body2 = "";
    for (let i = 0; i < 60; i++) {
      try {
        const lines = readFileSync(bodiesFile, "utf8").trimEnd().split("\n").filter(Boolean);
        const last = lines[lines.length - 1];
        if (last && last.includes("second turn")) { body2 = last; break; }
      } catch { /* wait */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(body2).toContain("tool_calls");
    // The RESULT message too (r137 gate catch: substring matches could
    // hit the call itself — assert the tool-role message with output).
    expect(body2).toContain('"role":"tool"');
    expect(body2).toMatch(/"role":"tool"[^}]*TOOL-CTX|"role":"tool","content":"[^"]*TOOL-CTX/);
  });

  // r136 (codex re-grade P1): the REQUEST BODY is valid JSON — the
  // stub records every /api/chat body; parse the LAST one (the escaper
  // changes across rounds made this boundary invisible to the suite —
  // a stray quote 400s on every real ollama).
  tt("the fired request body PARSES as JSON", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "wire check")');
    let body: unknown;
    for (let i = 0; i < 60; i++) {
      try {
        const lines = readFileSync(bodiesFile, "utf8").trimEnd().split("\n").filter(Boolean);
        const last = lines[lines.length - 1];
        // Wait for THIS turn's body (earlier tests' bodies ride the same
        // file — a stale accept broke the user-message assert).
        if (last && last.includes("wire check")) { body = JSON.parse(last); break; }
      } catch { /* not yet / partial */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(body).toBeTruthy();
    const b = body as { model?: string; messages?: { role: string }[]; tools?: unknown[] };
    expect(b.model).toBe("test:fake");
    expect(b.messages?.[0]?.role).toBe("system");
    // THIS turn's user message rides the body (r136b: the old assert was
    // a tautology; and filter to THIS request — earlier bodies belong to
    // earlier turns).
    const msgs = (body as { messages: { role: string; content: string }[] }).messages;
    expect(msgs.some((m) => m.role === "user" && m.content.includes("wire check"))).toBe(true);
    expect(Array.isArray(b.tools)).toBe(true);
  });

  // r135b (codex r135 catches): control chars escape (the file literal
  // "\n" never matched a real newline — multi-line content rode raw
  // into the JSON); refused edits show no + lines; the cap guards the
  // decision re-fire.
  tt("control characters escape in the reconstructed message", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "multiline")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "line1\nline2\ttabbed\rcr",
      tool_calls: [{ function: { name: "bash", arguments: { command: "echo M-ESC" } } }] } }));
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 197 "live")');
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 197 "${r}")`);
    e(ed, `(fikra-http-complete 197 200 "${hex("{}")}")`);
    const acc = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
    expect(acc).toContain("\\nline2");
    expect(acc).toContain("\\ttabbed");
    expect(acc).toContain("\\rcr");
    // The message must be VALID JSON when the re-fire builds the body:
    // extract the assistant message fragment and JSON-parse it.
    const frag = acc.slice(acc.indexOf('{"role":"assistant"'), acc.indexOf('"tool_calls"'));
    expect(() => JSON.parse(frag.slice(0, -1) + "}")).not.toThrow();
  });

  tt("a REFUSED edit shows no + preview lines", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "escape")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [{ function: { name: "buffer_edit",
        arguments: { path: "../escape135.txt", content: "NEVER\nWRITTEN\n" } } }] } }));
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 198 "live")');
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 198 "${r}")`);
    e(ed, `(fikra-http-complete 198 200 "${hex("{}")}")`);
    const text = strip(String(e(ed, "(buffer-text)").value));
    expect(text).toContain("REFUSED");
    expect(text).not.toContain("+ NEVER");
    expect(text).not.toContain("+ WRITTEN");
    expect(existsSync(join(process.cwd(), "..", "escape135.txt"))).toBe(false);
  });

describe("ollama focus-switch lifecycle (r119 — codex r118 P1)", () => {
  tt("park → switch → allow: the ORIGINATING thread settles (not stranded confirming)", async () => {
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

  tt("ALLOW resumes the parked reply's REMAINING calls (they were dropped)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "two step")');
    fireCalls(ed, 131, [
      { name: "bash", args: { command: "rm -rf q/" } },
      { name: "bash", args: { command: "echo AFTER-RESUME" } },
    ]);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    expect(String(e(ed, "(buffer-text)").value)).not.toContain("AFTER-RESUME");
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    // r132: the approved command runs ASYNC and HOLDS the round — the
    // remainder (echo AFTER-RESUME) runs at ITS exit, then the re-fire.
    // Immediately after the allow there is NO result yet — the ordering
    // r132 enforces (codex r130 P1#2: the model must never receive the
    // next request before the approved result exists).
    expect(String(e(ed, "(buffer-text)").value)).not.toContain("AFTER-RESUME");
    const text = strip(await until(ed, "(buffer-text)", "→ ok", 60));
    expect(text).toMatch(/→ ok\s*$/m);
    expect(await until(ed, "(buffer-text)", "AFTER-RESUME", 60)).toContain("AFTER-RESUME");
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value)).toContain("AFTER-RESUME");
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 132 "live")');
    const reply = hex(JSON.stringify({ message: { role: "assistant", content: "done both" } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 132 "${reply}")`);
    e(ed, `(fikra-http-complete 132 200 "${hex("{}")}")`);
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
  });

  tt("buffer_read returns the file's content to the model (and not-found is honest)", async () => {
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

  tt("results BEFORE a park are kept; a SECOND park holds the model request", async () => {
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
  tt("calls resumed after a focus switch run in the ORIGINATING dir", async () => {
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
  tt("the NEXT model request after a switched-away decision stamps the ORIGINATING thread", async () => {
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
  tt("a LONG bash does NOT block the daemon — another eval answers while it runs", async () => {
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

  tt("a buffer_read BEFORE an async bash rides the resume (its result never vanishes)", async () => {
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

  tt("a FAILED spawn renders an honest FAIL row + the model-visible message (never 'async)", async () => {
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

  tt("the non-blocking proof is DURING: the eval answers BEFORE the 2s command finishes", async () => {
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

  // r129 — the LIVE catch: the turn must SETTLE after the async round.
  // The resume's cond t-clause had two body expressions (T-Lisp clauses
  // are exactly 2 elements) — the throw was swallowed by the upstream
  // condition-case and live turns stuck "running" after the tool
  // result; every unit test stopped at the result row, so the suite
  // was green. This is the first consumer of settleRefireFrom.
  tt("the async round SETTLES: the re-fire reply completes the turn", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "settle")');
    fireCalls(ed, 183, [{ name: "bash", args: { command: "echo SETTLE-BASH" } }]);
    // The child ran and the sentinel emitted the RESULT row (the
    // command text also appears in the call row — bind the result
    // marker to the → ok row itself; until() returns the last text on
    // exhaustion, so a bare marker assert is fakeable by the call row).
    const row = strip(await until(ed, "(buffer-text)", "→ ok", 60));
    expect(row).toMatch(/→ ok\s*SETTLE-BASH/);
    // The sentinel's resume RE-FIRES (a new latest-id appears) — the
    // seeded reply must end the turn (throws if the re-fire never comes).
    await settleRefireFrom(ed, "183", "SETTLED-DONE");
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
    const text = await until(ed, "(buffer-text)", "SETTLED-DONE", 20);
    expect(text).toContain("SETTLED-DONE");
  });
});

describe("ollama async ownership + interruption (r131 — codex r130 P1#1/P1#3)", () => {
  const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
  const fireCalls = (ed: Editor, seed: number, calls: { name: string; args: unknown }[]) => {
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed ${seed} "live")`);
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls:
      calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${seed} "${r}")`);
    e(ed, `(fikra-http-complete ${seed} 200 "${hex("{}")}")`);
  };

  // P1#1: a focus switch DURING the async run must not reroute the
  // result or the continuation — the sentinel resumes under HOME.
  tt("a focus switch mid-run: the sentinel resumes the ORIGINATING thread", async () => {
    const ed = await armed();
    e(ed, "(require-module fikra/threads)");
    e(ed, '(fikra/chat/fikra-turn-send "slow then home")');
    fireCalls(ed, 171, [{ name: "bash", args: { command: "sleep 1 && echo HOME-RESUME" } }]);
    // The call row rendered = the child runs; switch focus mid-run.
    expect(String(e(ed, "(buffer-text)").value)).toContain("sleep 1");
    e(ed, '(fikra/thread/fikra-thread-focus "away")');
    expect(String(e(ed, "(fikra/thread/fikra-thread-current)").value)).toBe("away");
    // The sentinel fires under AWAY focus: the re-fire (a NEW
    // latest-id) must appear while focus is STILL away — the resume
    // ran home-bound, not on whatever is focused.
    const before = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    let now = before;
    for (let i = 0; i < 60; i++) {
      now = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
      if (now !== before && now !== "null") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(now).not.toBe(before);
    expect(String(e(ed, "(fikra/thread/fikra-thread-current)").value)).toBe("away");
    // The result row rendered (the evidence landed HOME's transcript).
    const row = strip(await until(ed, "(buffer-text)", "→ ok", 60));
    expect(row).toMatch(/→ ok\s*HOME-RESUME/);
    // Seed the re-fire under HOME focus (the real request was stamped
    // home at fire time; the seed must match).
    e(ed, '(fikra/thread/fikra-thread-focus "main")');
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed ${now} "live")`);
    const reply = hex(JSON.stringify({ message: { role: "assistant", content: "HOME-DONE" } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${now} "${reply}")`);
    e(ed, `(fikra-http-complete ${now} 200 "${hex("{}")}")`);
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
    expect(strip(String(e(ed, "(buffer-text)").value))).toContain("HOME-DONE");
    // The AWAY thread never ran anything (the home dance only borrowed
    // its focus for the resume, and restored it).
    e(ed, '(fikra/thread/fikra-thread-focus "away")');
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
  });

  // P1#3: the interrupt KILLS the child — the whole process GROUP (the
  // descendant side effect never happens) — and INVALIDATES its
  // sentinel: no result row, no resume, no re-fire.
  tt("an interrupt kills the child (and its descendants): the late sentinel drops everything", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "interrupt me")');
    fireCalls(ed, 172, [{ name: "bash", args: { command: "sleep 2 && printf X > desc-r131.txt && echo NEVER-LANDS" } }]);
    expect(String(e(ed, "(buffer-text)").value)).toContain("sleep 2");
    const before = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    const abort = e(ed, "(fikra/backend-ollama/fikra-backend-ollama-abort)");
    expect(String(abort.value)).toBe("true");
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("interrupted");
    // Wait past the child's full 2s sleep — the (killed) sentinel fires
    // and the descendant's file write would have landed by now.
    await new Promise((r) => setTimeout(r, 2500));
    // The process GROUP died: the descendant side effect NEVER happened
    // (killing only the outer shell left the $( ) subshell running —
    // codex r131's probe).
    expect(existsSync(join(process.cwd(), "desc-r131.txt"))).toBe(false);
    // No RESULT row (the command text in the call row is expected; the
    // result shape never renders).
    const text = strip(String(e(ed, "(buffer-text)").value));
    expect(text).not.toMatch(/→ (ok|FAIL)\s*NEVER-LANDS/);
    // No re-fire ever happened (latest-id frozen at the aborted turn's).
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value)).toBe(before);
    // The tool RESULT message never entered the accumulator (the
    // command text rides the tool_calls echo; the result would be a
    // tool message whose content is exactly the output).
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value))
      .not.toContain('"role":"tool","content":"NEVER-LANDS"');
  });

  // P1#3 (the other supersede path): a REPLACEMENT turn invalidates the
  // old turn's in-flight child the same way.
  tt("a replacement turn supersedes the old turn's in-flight child", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "old turn")');
    fireCalls(ed, 173, [{ name: "bash", args: { command: "sleep 1 && echo STALE-OUTPUT" } }]);
    expect(String(e(ed, "(buffer-text)").value)).toContain("sleep 1");
    // Replace: a NEW turn bumps the epoch — the old child's sentinel
    // becomes stale the moment the new turn begins.
    e(ed, '(fikra/chat/fikra-turn-send "new turn")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 174 "live")');
    const r2 = hex(JSON.stringify({ message: { role: "assistant", content: "new answer" } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 174 "${r2}")`);
    e(ed, `(fikra-http-complete 174 200 "${hex("{}")}")`);
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
    // The stale child exited by now; its RESULT must NOT have landed.
    await new Promise((r) => setTimeout(r, 1500));
    const text = strip(String(e(ed, "(buffer-text)").value));
    expect(text).not.toMatch(/→ (ok|FAIL)\s*STALE-OUTPUT/);
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value))
      .not.toContain('"role":"tool","content":"STALE-OUTPUT"');
    // And the stale sentinel never re-fired a request of its own.
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value)).toBe("174");
  });

  // r131c (codex r131b catch): an interrupted turn's pending park dies
  // with it — a LATE approval must not execute the old call under the
  // new turn's epoch/home.
  tt("an interrupt clears the parked call: a late approval executes nothing", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "park then die")');
    fireCalls(ed, 175, [{ name: "bash", args: { command: "rm -rf stale/" } }]);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    const accBefore = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
    e(ed, "(fikra/backend-ollama/fikra-backend-ollama-abort)");
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("interrupted");
    // The LATE decision arrives (the panel outlived the turn).
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    // Nothing executed: no new tool message, no rejection message, the
    // turn stays interrupted.
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value)).toBe(accBefore);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("interrupted");
    const text = strip(String(e(ed, "(buffer-text)").value));
    expect(text).not.toMatch(/→ (ok|FAIL)\s*$/m);
  });

  // r131e (codex r131d catch): turn-end's event append is BEST-EFFORT —
  // an unwritable log path must not strand the thread "running" (the
  // status transition is the state truth). Probed by codex with a
  // /dev/null thread root. The re-fire must FAIL FAST here (dead URL,
  // not the hanging stub) so the error settle is observable.
  tt("a turn still TERMINATES when the event log is unwritable", async () => {
    const ed = await armed();
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-set-url "http://127.0.0.1:1")');
    e(ed, '(fikra/chat/fikra-turn-send "poison log")');
    fireCalls(ed, 176, [{ name: "bash", args: { command: "echo POISON-LOG" } }]);
    // Poison the thread's log root (the -for emitter derives the
    // events.jsonl path from it; the state persist throws the same
    // way): /dev/null/<...> cannot be created.
    e(ed, '(fikra/thread/fikra-thread-set-field "root" "/dev/null")');
    // The sentinel fires; its resume re-fires against the dead port and
    // that failure settles the turn — every append/persist under the
    // poisoned root throws, yet the status must go terminal.
    const st = await untilStatus(ed, "error", 60);
    expect(st).toBe("error");
    // Restore a sane root for teardown.
    e(ed, `(fikra/thread/fikra-thread-set-field "root" "${process.cwd()}")`);
  });
});

describe("ollama allow-await ordering (r132 — codex r130 P1#2)", () => {
  const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
  const fireCalls = (ed: Editor, seed: number, calls: { name: string; args: unknown }[]) => {
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed ${seed} "live")`);
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls:
      calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${seed} "${r}")`);
    e(ed, `(fikra-http-complete ${seed} 200 "${hex("{}")}")`);
  };

  // The codex r131/r131d probe, now the contract: after an ALLOW, the
  // next model request must NOT exist until the approved command's
  // result does (before r132 the round continued immediately and
  // re-fired without it). The child WAITS ON A RELEASE FILE (codex
  // r132 P2: a fixed timer cannot guarantee DURING observation on a
  // shared machine — the handshake is deterministic).
  tt("an allowed ASYNC command holds the next request until its result exists", async () => {
    const ed = await armed();
    const release = join(process.cwd(), "release-r132");
    rmSync(release, { force: true });
    e(ed, '(fikra/chat/fikra-turn-send "slow approve")');
    fireCalls(ed, 181, [{ name: "bash", args: { command: `until [ -f ${release} ]; do sleep 0.05; done; rm -rf slowdir && echo SLOW-OK` } }]);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    const before = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    // The child is HELD (no release file yet): no re-fire, no result
    // row — deterministic, not timing-based.
    await new Promise((r) => setTimeout(r, 300));
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value)).toBe(before);
    expect(strip(String(e(ed, "(buffer-text)").value))).not.toMatch(/→ ok\s*SLOW-OK/);
    // Release: the result row, THEN the re-fire — which settles.
    writeFileSync(release, "go");
    const row = strip(await until(ed, "(buffer-text)", "→ ok", 60));
    expect(row).toMatch(/→ ok\s*SLOW-OK/);
    await settleRefireFrom(ed, before, "ALLOWED-DONE");
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
    // The model's context carries the approved result.
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value))
      .toContain('"role":"tool","content":"SLOW-OK"');
    rmSync(release, { force: true });
  });

  // r132b (codex r132 P1): the ASYNC REMAINDER holds too — a rejected
  // park (or a failed approved spawn) continues through resume-rest,
  // whose first remainder call going async must NOT append a marker nor
  // re-fire (the sentinel owns the continuation; the double re-fire
  // went latest 771→2→3 with "async" junk in the messages).
  tt("an async REMAINDER call holds the request (no marker, no early re-fire)", async () => {
    const ed = await armed();
    const release = join(process.cwd(), "release-r132b");
    rmSync(release, { force: true });
    e(ed, '(fikra/chat/fikra-turn-send "reject then slow remainder")');
    fireCalls(ed, 182, [
      { name: "bash", args: { command: "rm -rf rejectdir/" } },
      { name: "bash", args: { command: `until [ -f ${release} ]; do sleep 0.05; done; echo REST-OK` } },
    ]);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    const before = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    // REJECT: the remainder resumes immediately; its first call goes
    // async and HOLDS — no re-fire while held.
    e(ed, "(fikra/approvals/fikra-approval-answer-reject)");
    await new Promise((r) => setTimeout(r, 300));
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value)).toBe(before);
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value)).not.toContain("async");
    writeFileSync(release, "go");
    const row = strip(await until(ed, "(buffer-text)", "→ ok", 60));
    expect(row).toMatch(/→ ok\s*REST-OK/);
    await settleRefireFrom(ed, before, "REJECT-DONE");
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value)).not.toContain("async");
    rmSync(release, { force: true });
  });
});
