import { describe, expect, test, beforeEach, beforeAll, afterAll, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

// r154: poll a FILE for a marker (the stub's out-of-band evidence —
// the socket-close record).
async function untilFile(path: string, marker: string, tries = 60): Promise<string> {
  let text = "";
  for (let i = 0; i < tries; i++) {
    try {
      text = readFileSync(path, "utf8");
    } catch {
      text = "";
    }
    if (text.includes(marker)) return text;
    await new Promise((r) => setTimeout(r, 100));
  }
  return text;
}

// The LAST recorded /api/chat body carrying MARKER (this turn's own —
// earlier tests' bodies ride the same file).
async function lastBodyFor(marker: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    try {
      const lines = readFileSync(bodiesFile, "utf8").trimEnd().split("\n").filter(Boolean);
      const last = lines[lines.length - 1];
      if (last && last.includes(marker)) return last;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no recorded request body carries "${marker}"`);
}

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
  armedEditors.push(ed);
  return ed;
}

// r154: Bun's fetch keeps at most 256 connections open PER ORIGIN — the
// 257th request QUEUES and is never sent. The stub never answers, so
// every test used to leave its real fires hanging for the rest of the
// run: with 91 tests the tail's real requests (the recorded bodies, the
// sentinel's re-fires) silently stopped reaching the server. Each test's
// editor is retired with an ABORT, which cancels its in-flight requests
// (and kills lingering async children).
const armedEditors: Editor[] = [];
afterEach(() => {
  for (const ed of armedEditors.splice(0)) {
    try {
      e(ed, "(condition-case nil (fikra/backend-ollama/fikra-backend-ollama-abort) (error () nil))");
    } catch {
      /* the editor is retired regardless */
    }
  }
});

// r129: the stub ollama (see armed()). A SEPARATE PROCESS: the
// availability probe is a SYNC shell-command curl — it blocks the
// editor's event loop, so an in-process listener can never answer it
// (curl self-deadlocks until --max-time). /api/tags answers instantly;
// POST /api/chat swallows the body and never responds (every real
// fire hangs; synthetic completions drive all replies).
let stubUrl = "";
let bodiesFile = "";
let stubProc: ReturnType<typeof Bun.spawn> | null = null;
// The stub's own directory. It was never removed: 1,159 had piled up in
// the temp directory when an independent review counted them.
let stubDir = "";
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "fikra-stub-"));
  stubDir = dir;
  const script = join(dir, "stub.ts");
  writeFileSync(script, `
const fs = require("node:fs");
const body = JSON.stringify({ models: [{ name: "test:fake" }] });
// r154: the sockets HOLD-PROBE holds open. Their CLOSE is the evidence
// that an interrupted/replaced turn's request was CANCELLED at the
// transport (nothing ends these on the server side).
const held = new Set();
const noteClose = (socket) => {
  if (held.delete(socket)) fs.appendFileSync(process.argv[2] + ".closes", "HELD-CLOSED\\n");
};
const l = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: {
  data(socket, chunk) {
    if (socket.readyState === "closed") { noteClose(socket); return; }
    if (chunk.toString().includes("GET /api/tags")) {
      socket.write("HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nContent-Length: " + body.length + "\\r\\nConnection: close\\r\\n\\r\\n" + body);
      socket.end();
    }
    // POST /api/chat: RECORD the body (r136 codex re-grade P1: the
    // request boundary must be TESTED) — and answer STREAMING requests
    // with NDJSON deltas (r153: the progressive render needs real
    // chunks arriving over time).
    const text = chunk.toString();
    fs.appendFileSync(process.argv[2], text.slice(text.indexOf("\\r\\n\\r\\n") + 4) + "\\n");
    if (text.includes('"stream":true') && text.includes("HOLD-PROBE")) {
      // r154: one delta, then the stream stays OPEN until the client
      // goes away.
      socket.write("HTTP/1.1 200 OK\\r\\nContent-Type: application/x-ndjson\\r\\n\\r\\n");
      socket.write('{"message":{"role":"assistant","content":"HOLD-FIRST"}}\\n');
      held.add(socket);
      return;
    }
    if (text.includes('"stream":true') && text.includes("STREAM-PROBE")) {
      const lines = [
        '{"message":{"role":"assistant","content":"Str"}}',
        '{"message":{"role":"assistant","content":"eaming"}}',
        '{"message":{"role":"assistant","content":" DONE"}}',
        '{"done":true}',
      ];
      socket.write("HTTP/1.1 200 OK\\r\\nContent-Type: application/x-ndjson\\r\\nConnection: close\\r\\n\\r\\n");
      // The RELEASE-FILE handshake (the r132 pattern): the first delta
      // lands, then the stream WAITS for the test to release it —
      // deterministic DURING observation regardless of machine load.
      const release = process.argv[2] + ".release";
      const fs = require("node:fs");
      let i = 0;
      const tick = () => {
        if (i >= lines.length) { socket.end(); return; }
        if (i > 0 && !fs.existsSync(release)) { setTimeout(tick, 50); return; }
        socket.write(lines[i] + "\\n");
        i += 1;
        setTimeout(tick, 100);
      };
      setTimeout(tick, 100);
    }
  },
  // The close handlers cover Bun versions that still deliver them (the
  // readyState probe in the data handler covers the rest).
  close(socket) { noteClose(socket); },
  error(socket) { noteClose(socket); },
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
  if (stubDir) rmSync(stubDir, { recursive: true, force: true });
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

  tt("the capabilities are honest: streaming ON (r153b), no approvals", async () => {
    const ed = await armed();
    // r153/r153b: streaming is REAL now — the capability reports it; the
    // flag toggles the report honestly.
    expect(String(e(ed, '(fikra/adapter/fikra-backend-capable-p "ollama" "streaming")').value)).toBe("true");
    e(ed, '(fikra/backend-ollama/fikra-ollama-set-streaming nil)');
    expect(String(e(ed, '(fikra/adapter/fikra-backend-capable-p "ollama" "streaming")').value)).toBe("null");
    e(ed, '(fikra/backend-ollama/fikra-ollama-set-streaming t)');
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
    // The late reply arrives — it must DISCARD. r154 (codex re-grade):
    // NEWLINE-TERMINATED NDJSON — the real streaming shape. The
    // unterminated single-line bodies every older test sends never
    // reach the filter's delta path (they ride the completion's raw-body
    // fallback), so this guard was never exercised against a stream.
    const reply = hex(JSON.stringify({ message: { role: "assistant", content: "stale answer" } }) + "\n");
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 42 "${reply}")`);
    // The delta alone (no completion yet) must already be invisible.
    expect(String(e(ed, "(buffer-text)").value)).toBe(before);
    e(ed, `(fikra-http-complete 42 200 "${hex("{}")}")`);
    const after = String(e(ed, "(buffer-text)").value);
    expect(after).toBe(before);
    expect(after).not.toContain("stale answer");
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("interrupted");
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
    // r154 (codex re-grade): NEWLINE-TERMINATED NDJSON (the real
    // streaming shape — codex's probe put STALE_ANSWER into turn 2's
    // transcript: the filter rendered every delta before any guard).
    const stale = hex(JSON.stringify({ message: { role: "assistant", content: "STALE_ANSWER" } }) + "\n");
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 51 "${stale}")`);
    // The DELTA alone (the stream still open, no completion) renders
    // nothing.
    expect(String(e(ed, "(buffer-text)").value)).not.toContain("STALE_ANSWER");
    e(ed, `(fikra-http-complete 51 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
    const text = String(e(ed, "(buffer-text)").value);
    expect(text).not.toContain("STALE_ANSWER");
    // Reply 2 lands normally (streamed too).
    const fresh = hex(JSON.stringify({ message: { role: "assistant", content: "fresh answer" } }) + "\n");
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 52 "${fresh}")`);
    e(ed, `(fikra-http-complete 52 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    const final = String(e(ed, "(buffer-text)").value);
    expect(final).toContain("fresh answer");
    expect(final.split("fresh answer").length - 1).toBe(1);
    expect(final).not.toContain("STALE_ANSWER");
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

  // P2 + r138: the edit row carries CHANGE-FOCUSED evidence — the
  // common prefix/suffix trim away; only the CHANGED middle shows (a
  // middle change with an unchanged tail used to display the whole
  // opening as changed).
  tt("a buffer_edit renders the CHANGED lines (- old / + new) under the row", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "old135.txt"), "alpha\nbeta\ngamma\ndelta\nepsilon\n");
    e(ed, '(fikra/chat/fikra-turn-send "rewrite it")');
    fireReply(ed, 196, { role: "assistant", content: "",
      tool_calls: [{ function: { name: "buffer_edit",
        arguments: { path: "old135.txt", content: "alpha\nBETA-X\ngamma\ndelta\nepsilon\n" } } }] });
    const text = strip(await until(ed, "(buffer-text)", "buffer-edit", 60));
    // The CHANGED middle only: beta → BETA-X.
    expect(text).toContain("- beta");
    expect(text).toContain("+ BETA-X");
    // The unchanged context does NOT render as changed.
    expect(text).not.toContain("- alpha");
    expect(text).not.toContain("+ gamma");
    expect(text).not.toContain("- gamma");
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
    // r138 (codex ordering finding): the TRUE intra-turn order — the
    // exchange rode BEFORE turn 1's final reply (the tools ran first):
    // user1 < tool < reply < user2.
    const user1At = body2.indexOf("first turn");
    const toolAt = body2.indexOf('"role":"tool"');
    const replyAt = body2.indexOf("first done");
    const user2At = body2.indexOf("second turn");
    expect(user1At).toBeGreaterThan(-1);
    expect(toolAt).toBeGreaterThan(user1At);
    expect(replyAt).toBeGreaterThan(toolAt);
    expect(user2At).toBeGreaterThan(replyAt);
    // r138c (codex catch): history rebuilds EVERY turn — a SECOND call
    // must still carry the exchange (the walk must not consume it).
    const h1 = String(e(ed, "(fikra/backend-ollama/fikra-ollama-history-messages)").value);
    const h2 = String(e(ed, "(fikra/backend-ollama/fikra-ollama-history-messages)").value);
    expect(h1).toContain("TOOL-CTX");
    expect(h2).toContain("TOOL-CTX");
  });

  // r139 (codex re-grade): MULTI-ROUND history — true order, no
  // duplicated narration. Round 1 narrates then runs a tool; round 2
  // narrates then runs another; a final reply ends the turn. The next
  // turn's RECORDED body must read: user, tools1, narration2, tools2,
  // final — with each narration exactly once.
  tt("a two-round turn rides in true order without duplication", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "multi round")');
    const fireReplyRaw = (seed: number, reply: unknown) => {
      e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed ${seed} "live")`);
      const r = hex(JSON.stringify({ message: reply }));
      e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${seed} "${r}")`);
      e(ed, `(fikra-http-complete ${seed} 200 "${hex("{}")}")`);
    };
    fireReplyRaw(210, { role: "assistant", content: "First narration.",
      tool_calls: [{ function: { name: "bash", arguments: { command: "echo ROUND-ONE" } } }] });
    // Wait for round 1's re-fire (a new latest-id) WITHOUT consuming it
    // with a plain reply (that would END the turn).
    let refire1 = "210";
    for (let i = 0; i < 60; i++) {
      const now = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
      if (now !== "210" && now !== "null") { refire1 = now; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(refire1).not.toBe("210");
    // Round 2 seeds THAT re-fire with another tool round.
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed ${refire1} "live")`);
    const r2 = hex(JSON.stringify({ message: { role: "assistant", content: "Second narration.",
      tool_calls: [{ function: { name: "bash", arguments: { command: "echo ROUND-TWO" } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${refire1} "${r2}")`);
    e(ed, `(fikra-http-complete ${refire1} 200 "${hex("{}")}")`);
    await settleRefireFrom(ed, refire1, "ALL-DONE");
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
    // Turn 2's body.
    e(ed, '(fikra/chat/fikra-turn-send "next turn")');
    let body = "";
    for (let i = 0; i < 60; i++) {
      try {
        const lines = readFileSync(bodiesFile, "utf8").trimEnd().split("\n").filter(Boolean);
        const last = lines[lines.length - 1];
        if (last && last.includes("next turn")) { body = last; break; }
      } catch { /* wait */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(body).toContain("ROUND-ONE");
    expect(body).toContain("ROUND-TWO");
    // No duplicated narrations (each exactly once).
    expect(body.split("First narration.").length - 1).toBe(1);
    expect(body.split("Second narration.").length - 1).toBe(1);
    // The TRUE order: narration1 < tools1 < narration2 < tools2 < final.
    const n1 = body.indexOf("First narration.");
    const t1 = body.indexOf("ROUND-ONE");
    const n2 = body.indexOf("Second narration.");
    const t2 = body.indexOf("ROUND-TWO");
    const fin = body.indexOf("ALL-DONE");
    expect(n1).toBeGreaterThan(-1);
    expect(t1).toBeGreaterThan(n1);
    expect(n2).toBeGreaterThan(t1);
    expect(t2).toBeGreaterThan(n2);
    expect(fin).toBeGreaterThan(t2);
  });

  // r139b (codex round-2 probe): reject a destructive call with a
  // remainder — the refusal appears EXACTLY ONCE in a later turn's
  // body, ordered BEFORE the final reply.
  tt("a rejection rides exactly once, before the final reply", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "reject then rest")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 220 "live")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [
        { function: { name: "bash", arguments: { command: "rm -rf rej139/" } } },
        { function: { name: "some_unknown_tool", arguments: {} } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 220 "${r}")`);
    e(ed, `(fikra-http-complete 220 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    e(ed, "(fikra/approvals/fikra-approval-answer-reject)");
    // The remainder runs (the unknown tool records its honest result);
    // the re-fire lands and the final reply ends the turn.
    const before = "220";
    await settleRefireFrom(ed, before, "REJ-DONE");
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
    // The NEXT turn's body.
    e(ed, '(fikra/chat/fikra-turn-send "follow up")');
    let body = "";
    for (let i = 0; i < 60; i++) {
      try {
        const lines = readFileSync(bodiesFile, "utf8").trimEnd().split("\n").filter(Boolean);
        const last = lines[lines.length - 1];
        if (last && last.includes("follow up")) { body = last; break; }
      } catch { /* wait */ }
      await new Promise((r2) => setTimeout(r2, 100));
    }
    // The refusal EXACTLY once.
    expect(body.split("user rejected this command").length - 1).toBe(1);
    // Ordered before the final reply.
    expect(body.indexOf("user rejected this command")).toBeLessThan(body.indexOf("REJ-DONE"));
  });

  // r140 ROOT CAUSE (the declared r139 gap, closed): (list) is TRUTHY
  // in this dialect — a single-call park took the NON-empty resume
  // branch and serialized the empty rest as the assistant's calls.
  tt("a single-call rejection records the actual call in the exchange", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "solo reject")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [{ function: { name: "bash", arguments: { command: "rm -rf solo140/" } } }] } }));
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 240 "live")');
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 240 "${r}")`);
    e(ed, `(fikra-http-complete 240 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    e(ed, "(fikra/approvals/fikra-approval-answer-reject)");
    await settleRefireFrom(ed, "240", "SOLO-DONE");
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
    // Turn 2 rebuilds from history — the fragment carries the ACTUAL call.
    e(ed, '(fikra/chat/fikra-turn-send "after solo")');
    const msgs = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
    expect(msgs).toContain('"name":"bash"');
    expect(msgs).toContain("solo140");
    expect(msgs).toContain("user rejected this command");
    // The refusal appears exactly once.
    expect(msgs.split("user rejected this command").length - 1).toBe(1);
  });

  // r141 (codex 9-item): the MEDIATED bash's PRE ref captures the
  // state IMMEDIATELY BEFORE the command (an earlier edit may have
  // changed the tree since the baseline); the POST ref (evidence)
  // follows at exit. Verify by TREE CONTENT, not existence.
  tt("a mediated bash's pre-ref tree predates the command; the post-ref carries it", async () => {
    const ed = await armed();
    mkdirSync(join(process.cwd(), "med141dir"));
    writeFileSync(join(process.cwd(), "med141dir/pre141.txt"), "BEFORE-MUTATION");
    e(ed, '(fikra/chat/fikra-turn-send "remove it")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [{ function: { name: "bash", arguments: { command: "rm -rf med141dir/" } } }] } }));
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 250 "live")');
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 250 "${r}")`);
    e(ed, `(fikra-http-complete 250 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    await settleRefireFrom(ed, "250", "MED141-DONE");
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
    // Two action refs exist: -a1 (PRE, captured before the spawn) and
    // -a2 (POST, at exit). The PRE tree still HAS the file; the POST
    // tree does not.
    const refs = String(e(ed, '(shell-command "git for-each-ref refs/fikra")').value);
    expect(refs).toContain("1-a1");
    expect(refs).toContain("1-a2");
    const preTree = String(e(ed, '(shell-command "git ls-tree -r refs/fikra/main/1-a1 --name-only")').value);
    const postTree = String(e(ed, '(shell-command "git ls-tree -r refs/fikra/main/1-a2 --name-only")').value);
    expect(preTree).toContain("med141dir/pre141.txt");
    expect(postTree).not.toContain("pre141.txt");
  });

  // r142+r144 (codex): the ACTION-LEVEL REVERT — a divergent worktree
  // REFUSES (later user edits survive); the action stays revertable.
  tt("the action revert REFUSES a divergent worktree (user edits survive)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "edit then user edit")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 260 "live")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [
        { function: { name: "buffer_edit", arguments: { path: "first142.txt", content: "CONTENT-first142.txt\n" } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 260 "${r}")`);
    e(ed, `(fikra-http-complete 260 200 "${hex("{}")}")`);
    expect(existsSync(join(process.cwd(), "first142.txt"))).toBe(true);
    writeFileSync(join(process.cwd(), "first142.txt"), "USER-EDITED-AFTER\n");
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("REFUSED");
    expect(String(e(ed, '(shell-command "cat first142.txt")').value)).toContain("USER-EDITED-AFTER");
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-action-posts-get)").value)).toMatch(/-a\d+/);
  });

  // r143 (codex 9-item): DURABLE exchanges — a simulated restart (the
  // in-memory map wiped) loses nothing; the next turn's recorded body
  // still carries the prior tool exchange from the file.
  tt("exchanges survive a simulated restart (the map wiped; the file reloads)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "durable turn")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 270 "live")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [{ function: { name: "bash", arguments: { command: "echo DURABLE-CTX" } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 270 "${r}")`);
    e(ed, `(fikra-http-complete 270 200 "${hex("{}")}")`);
    await until(ed, "(buffer-text)", "DURABLE-CTX", 60);
    await settleRefireFrom(ed, "270", "durable done");
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
    // The durable file exists and names the exchange.
    const exFile = String(e(ed, "(fikra/backend-ollama/fikra-ollama-exchanges-file-get)").value);
    expect(exFile).toMatch(/exchanges\.jsonl$/);
    const exText = readFileSync(exFile, "utf8");
    expect(exText.length).toBeGreaterThan(0);
    // SIMULATED RESTART: wipe the in-memory map (the daemon restart's
    // effect on this state) — the reload must restore it.
    e(ed, "(fikra/backend-ollama/fikra-ollama-tool-exchanges-reset)");
    // Turn 2's body still carries the exchange.
    e(ed, '(fikra/chat/fikra-turn-send "after restart")');
    let body = "";
    for (let i = 0; i < 60; i++) {
      try {
        const lines = readFileSync(bodiesFile, "utf8").trimEnd().split("\n").filter(Boolean);
        const last = lines[lines.length - 1];
        if (last && last.includes("after restart")) { body = last; break; }
      } catch { /* wait */ }
      await new Promise((r2) => setTimeout(r2, 100));
    }
    expect(body).toContain("DURABLE-CTX");
    expect(body).toContain('"role":"tool"');
  });

  // r144 (#6): truncation is HONEST — a >30-line output carries a
  // TRUNCATED:N notice the model and the user both see.
  tt("a long bash output carries an honest truncation notice", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "long output")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 280 "live")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [{ function: { name: "bash", arguments: { command: "seq 1 35 | sed s/^/LINE-/" } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 280 "${r}")`);
    e(ed, `(fikra-http-complete 280 200 "${hex("{}")}")`);
    await until(ed, "(buffer-text)", "→ ok", 60);
    // The RENDERER shows 3 lines + a counted tail (r106, by design);
    // the MODEL-visible message carries the full head + the notice.
    const acc = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
    expect(acc).toContain("LINE-30");
    expect(acc).not.toContain("LINE-31");
    expect(acc).toContain("TRUNCATED: 5");
  });

  // r144b (codex gate catch): STAGED-only content also refuses — the
  // worktree matches the post-ref but the index holds user-staged
  // content on the path (the revert would silently replace it).
  tt("the action revert REFUSES staged-only divergence too", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "stage then revert")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 290 "live")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [
        { function: { name: "buffer_edit", arguments: { path: "staged144.txt", content: "ACTION-CONTENT\n" } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 290 "${r}")`);
    e(ed, `(fikra-http-complete 290 200 "${hex("{}")}")`);
    expect(existsSync(join(process.cwd(), "staged144.txt"))).toBe(true);
    // Stage user content, then make the WORKTREE match the action again.
    execFileSync("git", ["add", "staged144.txt"]);
    writeFileSync(join(process.cwd(), "staged144.txt"), "USER-STAGED\n");
    execFileSync("git", ["add", "staged144.txt"]);
    writeFileSync(join(process.cwd(), "staged144.txt"), "ACTION-CONTENT\n");
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("REFUSED");
    // The staged content survives.
    const staged = execFileSync("git", ["show", ":staged144.txt"]).toString();
    expect(staged).toContain("USER-STAGED");
  });

  // r145 (#4): a MIXED batch (buffer_read then a destructive bash)
  // parks — the reconstructed assistant message carries BOTH calls
  // (the read's result rode without its call before).
  tt("a parked mixed batch reconstructs BOTH calls (the read's call rides)", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "mix145.txt"), "MIX-READ-CONTENT");
    e(ed, '(fikra/chat/fikra-turn-send "read then destructive")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 300 "live")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [
        { function: { name: "buffer_read", arguments: { path: "mix145.txt" } } },
        { function: { name: "bash", arguments: { command: "rm -rf mix145dir/" } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 300 "${r}")`);
    e(ed, `(fikra-http-complete 300 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    e(ed, "(fikra/approvals/fikra-approval-answer-reject)");
    await settleRefireFrom(ed, "300", "MIX-DONE");
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
    // Turn 2: the reconstructed batch carries the READ's call too.
    e(ed, '(fikra/chat/fikra-turn-send "follow mix")');
    const msgs = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
    expect(msgs).toContain("MIX-READ-CONTENT");
    const readCallAt = msgs.indexOf('"name":"buffer_read"');
    const bashCallAt = msgs.indexOf('"name":"bash"');
    expect(readCallAt).toBeGreaterThan(-1);
    expect(bashCallAt).toBeGreaterThan(readCallAt);
    expect(msgs).toContain("user rejected this command");
  });

  // r145b (codex r145 catch): an APPROVED mixed batch also carries
  // every call — the async continuation reconstructs the full list
  // (the approved path previously serialized parked-call + rest only).
  tt("an APPROVED mixed batch reconstructs BOTH calls too", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "mix145b.txt"), "APPROVE-MIX-CONTENT");
    e(ed, '(fikra/chat/fikra-turn-send "read then approve")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 310 "live")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [
        { function: { name: "buffer_read", arguments: { path: "mix145b.txt" } } },
        { function: { name: "bash", arguments: { command: "rm -rf mix145bdir/" } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 310 "${r}")`);
    e(ed, `(fikra-http-complete 310 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    await settleRefireFrom(ed, "310", "APPROVE-MIX-DONE");
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
    e(ed, '(fikra/chat/fikra-turn-send "follow approve-mix")');
    const msgs = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
    const readCallAt = msgs.indexOf('"name":"buffer_read"');
    const bashCallAt = msgs.indexOf('"name":"bash"');
    expect(readCallAt).toBeGreaterThan(-1);
    expect(bashCallAt).toBeGreaterThan(readCallAt);
    expect(msgs).toContain("APPROVE-MIX-CONTENT");
    // The approved command's result rides (no re-execution: one result).
    expect((msgs.match(/"name":"bash"/g) ?? []).length).toBe(1);
  });

  // r149 (the r146 mystery, resolved): a no-change action SKIPS in
  // ISOLATION (r148 proved the async-batch edit flow works — the r146
  // in-suite failure was cross-test state; this test pins the behavior
  // so the pollution bisect has its marker).
  tt("a no-change action skips; the edit pair rides", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "async then edit")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 400 "live")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [
        { function: { name: "bash", arguments: { command: "true" } } },
        { function: { name: "buffer_edit", arguments: { path: "edit149.txt", content: "EDIT-CONTENT\n" } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 400 "${r}")`);
    e(ed, `(fikra-http-complete 400 200 "${hex("{}")}")`);
    await settleRefireFrom(ed, "400", "R149-DONE");
    expect(await untilStatus(ed, "idle", 60)).toBe("idle");
    expect(existsSync(join(process.cwd(), "edit149.txt"))).toBe(true);
    // The edit reverts (its own pair).
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(existsSync(join(process.cwd(), "edit149.txt"))).toBe(false);
    expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
    // Only the edit paired (a plain non-destructive bash never captures
    // pre/post — that's mediated-only), so the stack is empty: honest.
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("no action");
  });

  // r149b (codex gate catch): a WHITESPACE-ONLY user edit diverges —
  // content compares BYTE-EXACT (only the ABSENT/UNSTAGED sentinels
  // normalize their echo newline).
  tt("a whitespace-only user edit survives the revert (byte-exact compare)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "edit then whitespace")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 330 "live")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [{ function: { name: "buffer_edit", arguments: { path: "ws149.txt", content: "ACTION\n" } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 330 "${r}")`);
    e(ed, `(fikra-http-complete 330 200 "${hex("{}")}")`);
    writeFileSync(join(process.cwd(), "ws149.txt"), "ACTION\n\n");
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("REFUSED");
    expect(readFileSync(join(process.cwd(), "ws149.txt"), "utf8")).toBe("ACTION\n\n");
  });

  // r149c (codex sentinel-collision catch): a file whose CONTENT equals
  // the absent marker is a REAL file — the sentinel is exit-status based
  // now; content never collides.
  tt("a file whose content equals the absent marker is never read as absent", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "marker content")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 340 "live")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [{ function: { name: "buffer_edit", arguments: { path: "mark149.txt", content: "ACTION\n" } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 340 "${r}")`);
    e(ed, `(fikra-http-complete 340 200 "${hex("{}")}")`);
    // The user replaces the file's content with the marker string —
    // WITH and WITHOUT a trailing newline (both must refuse; the bare
    // marker collided with the failure sentinel before r149d).
    for (const content of ["__ABSENT__\n", "__ABSENT__"]) {
      writeFileSync(join(process.cwd(), "mark149.txt"), content);
      e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
      expect(String(e(ed, "(editor-status)").value)).toContain("REFUSED");
      expect(readFileSync(join(process.cwd(), "mark149.txt"), "utf8")).toBe(content);
    }
  });

  // r150 (codex): the action pairs are DURABLE — a simulated restart
  // (pairs + stack wiped) still reverts the latest action from the file;
  // a reverted pair stays reverted (tombstoned — never resurrected).
  // r150b (codex ordering catch): with TWO actions, a restart's revert
  // targets the NEWEST (the second edit), not the oldest.
  tt("after a restart, the revert targets the NEWEST action first", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "two durable edits")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 360 "live")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [
        { function: { name: "buffer_edit", arguments: { path: "d1.txt", content: "ONE\n" } } },
        { function: { name: "buffer_edit", arguments: { path: "d2.txt", content: "TWO\n" } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 360 "${r}")`);
    e(ed, `(fikra-http-complete 360 200 "${hex("{}")}")`);
    expect(existsSync(join(process.cwd(), "d1.txt"))).toBe(true);
    expect(existsSync(join(process.cwd(), "d2.txt"))).toBe(true);
    e(ed, "(fikra/backend-ollama/fikra-ollama-action-state-reset)");
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    // The NEWEST (d2) reverts; d1 stays.
    expect(existsSync(join(process.cwd(), "d2.txt"))).toBe(false);
    expect(existsSync(join(process.cwd(), "d1.txt"))).toBe(true);
  });

  tt("the action pairs survive a simulated restart; reverted pairs stay reverted", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "durable action")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 350 "live")');
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [{ function: { name: "buffer_edit", arguments: { path: "dur150.txt", content: "DUR-CONTENT\n" } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 350 "${r}")`);
    e(ed, `(fikra-http-complete 350 200 "${hex("{}")}")`);
    expect(existsSync(join(process.cwd(), "dur150.txt"))).toBe(true);
    // SIMULATED RESTART: wipe the pairs + the stack (the daemon restart's
    // effect on this process-local state).
    e(ed, "(fikra/backend-ollama/fikra-ollama-action-state-reset)");
    // The revert reloads from actions.jsonl and restores the pre-state.
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
    expect(existsSync(join(process.cwd(), "dur150.txt"))).toBe(false);
    // A SECOND revert does NOT resurrect the tombstoned pair.
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("no action");
  });

  // ── r151 SELF-AUDIT: the grader's probe list as regressions ──────
  // (staged-addition removal, partial retry, no-op skip, failed
  // append then turn — probed by codex in r144-r150, now pinned.)
  describe("r151 self-audit probes", () => {
    const fire = (ed: Editor, seed: number, calls: unknown[]) => {
      e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed ${seed} "live")`);
      const r = hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: calls } }));
      e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${seed} "${r}")`);
      e(ed, `(fikra-http-complete ${seed} 200 "${hex("{}")}")`);
    };
    const edit = (path: string, content: string) => ({ function: { name: "buffer_edit", arguments: { path, content } } });

    // r146 wanted the staged entry gone too; the codex r155 gate called
    // that P0 (a version the USER staged, destroyed). r155c: the entry
    // is the user's unless the action's own command moved the index —
    // a buffer_edit never does — so it STAYS, and the status says so.
    tt("a STAGED added file: the revert removes the worktree file and KEEPS the user's staged entry", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "stage an addition")');
      fire(ed, 600, [edit("added151.txt", "ADDED\n")]);
      expect(existsSync(join(process.cwd(), "added151.txt"))).toBe(true);
      // The user stages the addition.
      execFileSync("git", ["add", "added151.txt"]);
      e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
      const status = String(e(ed, "(editor-status)").value);
      expect(status).toContain("action reverted");
      // r155f: the consequence, never an instruction.
      expect(status).toContain("1 path(s) still staged: a commit would record the action's content");
      expect(existsSync(join(process.cwd(), "added151.txt"))).toBe(false);
      // …and the staged entry is exactly what the user staged.
      expect(execFileSync("git", ["show", ":added151.txt"]).toString()).toBe("ADDED\n");
    });

    // r152b (codex r152 catch): a bookkeeping write failure is DURABLY
    // visible — a transcript row survives the operation's own success
    // status (the ephemeral status line was overwritten).
    tt("a bookkeeping write failure leaves a durable transcript warning", async () => {
      const ed = await armed();
      // Obstruct the actions file with a DIRECTORY at its path.
      e(ed, '(shell-command "mkdir -p .tmax/fikra/threads/main/actions.jsonl")');
      e(ed, '(fikra/chat/fikra-turn-send "failing bookkeeping")');
      fire(ed, 620, [edit("bk152.txt", "BK\n")]);
      const text = strip(await until(ed, "(buffer-text)", "bookkeeping failed", 60));
      expect(text).toContain("bookkeeping failed to persist");
      // The warning row SURVIVES the turn's completion status.
      await settleRefireFrom(ed, "620", "BK-DONE");
      expect(await untilStatus(ed, "idle", 60)).toBe("idle");
      const after = strip(String(e(ed, "(buffer-text)").value));
      expect(after).toContain("bookkeeping failed to persist");
    });

    // r152 (codex re-grade): a STAGED DELETION of a tracked file refuses
    // (the revert would silently restore the index entry).
    tt("a staged deletion refuses (the user's git rm --cached survives)", async () => {
      const ed = await armed();
      // A TRACKED file the action edits.
      writeFileSync(join(process.cwd(), "tracked152.txt"), "ORIGINAL\n");
      execFileSync("git", ["add", "tracked152.txt"]);
      execFileSync("git", ["commit", "-q", "-m", "track"]);
      e(ed, '(fikra/chat/fikra-turn-send "edit tracked")');
      fire(ed, 610, [edit("tracked152.txt", "EDITED\n")]);
      expect(readFileSync(join(process.cwd(), "tracked152.txt"), "utf8")).toBe("EDITED\n");
      // The user stages the deletion.
      execFileSync("git", ["rm", "--cached", "-q", "tracked152.txt"]);
      e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
      expect(String(e(ed, "(editor-status)").value)).toContain("REFUSED");
      // The staged deletion SURVIVES (still no index entry).
      expect(execFileSync("git", ["ls-files", "tracked152.txt"]).toString()).toBe("");
    });

    // r152 (codex re-grade): the revert is SCOPED to the focused thread.
    tt("a focused OTHER thread never reverts main's action", async () => {
      const ed = await armed();
      e(ed, "(require-module fikra/threads)");
      e(ed, '(fikra/chat/fikra-turn-send "main action")');
      fire(ed, 611, [edit("main152.txt", "MAIN\n")]);
      expect(existsSync(join(process.cwd(), "main152.txt"))).toBe(true);
      // Switch to a new thread; its revert finds nothing.
      e(ed, '(fikra/thread/fikra-thread-focus "fix-1")');
      e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
      expect(String(e(ed, "(editor-status)").value)).toContain("no action");
      // main's file is untouched.
      expect(existsSync(join(process.cwd(), "main152.txt"))).toBe(true);
    });

    tt("a PARTIAL restore retries to completion (obstruction cleared)", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "two files then obstruct")');
      fire(ed, 601, [edit("p1.txt", "ONE\n"), edit("p2.txt", "TWO\n")]);
      expect(existsSync(join(process.cwd(), "p2.txt"))).toBe(true);
      // Obstruct the second path's removal (macOS immutable flag).
      execFileSync("chflags", ["uchg", join(process.cwd(), "p2.txt")]);
      e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
      expect(String(e(ed, "(editor-status)").value)).toContain("INCOMPLETE");
      // The action REMAINS revertable; p1 restored, p2 obstructed.
      execFileSync("chflags", ["nouchg", join(process.cwd(), "p2.txt")]);
      // Each edit is its OWN action (its own pair) — the obstructed
      // action is p2's; the retry reverts IT.
      e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
      expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
      expect(existsSync(join(process.cwd(), "p2.txt"))).toBe(false);
      // p1's action is next on the stack; it reverts cleanly.
      e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
      expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
      expect(existsSync(join(process.cwd(), "p1.txt"))).toBe(false);
    });

    tt("a no-change MEDIATED command skips (its pair pops; older reverts unblock)", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "noop destructive then edit")');
      // A destructive no-op: rm -rf a directory that does not exist.
      fire(ed, 602, [{ function: { name: "bash", arguments: { command: "rm -rf nonexistent-dir-151/" } } }]);
      expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
      e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
      await settleRefireFrom(ed, "602", "NOOP-DONE");
      expect(await untilStatus(ed, "idle", 60)).toBe("idle");
      e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
      expect(String(e(ed, "(editor-status)").value)).toContain("skipped");
      e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
      expect(String(e(ed, "(editor-status)").value)).toContain("no action");
    });

    tt("a FAILED exchange append: the next turn still carries the in-memory exchange", async () => {
      const ed = await armed();
      // Obstruct the exchanges file with a DIRECTORY at its path.
      e(ed, '(shell-command "mkdir -p .tmax/fikra/threads/main/exchanges.jsonl")');
      e(ed, '(fikra/chat/fikra-turn-send "failing append")');
      fire(ed, 603, [{ function: { name: "bash", arguments: { command: "echo FAILAPPEND-CTX" } } }]);
      await until(ed, "(buffer-text)", "FAILAPPEND-CTX", 60);
      // (The failure status fires in the SENTINEL's own editor session —
      // a separate context — so the main session's status is not the
      // observable here; the BEHAVIOR is: nothing durable landed, and
      // memory still serves the next turn.)
      await settleRefireFrom(ed, "603", "FA-DONE");
      expect(await untilStatus(ed, "idle", 60)).toBe("idle");
      // The NEXT turn's request body still carries the tool exchange.
      e(ed, '(fikra/chat/fikra-turn-send "after failed append")');
      const msgs = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
      expect(msgs).toContain("FAILAPPEND-CTX");
      expect(msgs).toContain('"role":"tool"');
    });
  });

  // r153 — STREAMING (the mockup's active transcript): the reply renders
  // PROGRESSIVELY (the first delta lands while the stream is open) and
  // exactly once (no duplicate at completion).
  tt("a streaming reply renders progressively and exactly once", async () => {
    const ed = await armed();
    rmSync(bodiesFile + ".release", { force: true });
    e(ed, '(fikra/chat/fikra-turn-send "STREAM-PROBE please")');
    // The FIRST delta renders while the stream is HELD OPEN (the stub
    // waits for the release file — deterministic under any load).
    const first = strip(await until(ed, "(buffer-text)", "Str", 150));
    expect(first).toContain("Str");
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
    expect(first).not.toContain("DONE");
    writeFileSync(bodiesFile + ".release", "go");
    // The full reply lands and the turn completes.
    const full = strip(await until(ed, "(buffer-text)", "DONE", 150));
    expect(full).toContain("Streaming DONE");
    expect(await untilStatus(ed, "idle", 150)).toBe("idle");
    // EXACTLY ONCE (no completion re-render).
    const text = strip(String(e(ed, "(buffer-text)").value));
    expect(text.split("Streaming DONE").length - 1).toBe(1);
    // The request asked for streaming.
    const lines = readFileSync(bodiesFile, "utf8").trimEnd().split("\n").filter(Boolean);
    const last = lines[lines.length - 1] ?? "";
    expect(last).toContain('"stream":true');
  });

  // r153b (codex catches): narration beside tool_calls renders ONCE;
  // ordinary text MENTIONING "tool_calls" is text, not a tool line.
  tt("streamed narration beside tool_calls renders exactly once", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "narrate then call")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 630 "live")');
    // ONE NDJSON line carrying both content and tool_calls (the ollama shape).
    const line = JSON.stringify({ message: { role: "assistant", content: "Checking now.", tool_calls: [
      { function: { name: "bash", arguments: { command: "echo NARRATE-ONCE" } } }] } });
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 630 "${hex(line + "\n")}")`);
    e(ed, `(fikra-http-complete 630 200 "${hex("{}")}")`);
    await until(ed, "(buffer-text)", "NARRATE-ONCE", 80);
    await settleRefireFrom(ed, "630", "NARR-DONE");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
    const text = strip(String(e(ed, "(buffer-text)").value));
    expect(text.split("Checking now.").length - 1).toBe(1);
  });

  tt("ordinary text mentioning tool_calls is TEXT (rendered once)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "mention the field")');
    e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 631 "live")');
    const line = JSON.stringify({ message: { role: "assistant", content: "The tool_calls field is here." } });
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 631 "${hex(line + "\n")}")`);
    e(ed, `(fikra-http-complete 631 200 "${hex("{}")}")`);
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
    const text = strip(String(e(ed, "(buffer-text)").value));
    expect(text.split("The tool_calls field is here.").length - 1).toBe(1);
  });

  // r154 — STREAM OWNERSHIP (codex re-grade: the grade fell 5 → 4 on the
  // r153 stream). The stream had no owner: the filter rendered every
  // delta before any guard ran (an interrupted turn's reply landed in its
  // REPLACEMENT's transcript), it rendered for whatever thread was
  // FOCUSED (a switched-away turn's text went to the wrong transcript and
  // its own thread settled with no reply), and the history serialized
  // every delta as its own assistant message. Every reply below is
  // NEWLINE-TERMINATED NDJSON — the shape ollama sends (one line per
  // token; captured live from 0.12.3). The unterminated single-line
  // bodies the older tests send never reach the filter's delta path (they
  // ride the completion's raw-body fallback), which is how the r153 suite
  // stayed green over all three.
  describe("ollama stream OWNERSHIP (r154 — codex re-grade)", () => {
    const ndjson = (os: unknown[]) => hex(os.map((o) => JSON.stringify(o) + "\n").join(""));
    const feed = (ed: Editor, id: number, raw: string) =>
      e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${id} "${raw}")`);
    const finish = (ed: Editor, id: number) =>
      e(ed, `(fikra-http-complete ${id} 200 "${hex("{}")}")`);
    const text = (ed: Editor) => strip(String(e(ed, "(buffer-text)").value));
    const count = (s: string, needle: string) => s.split(needle).length - 1;
    const idle = async (ed: Editor) => expect(await untilStatus(ed, "idle", 50)).toBe("idle");
    // A thread's DURABLE transcript (its event log), whatever is focused.
    const log = (ed: Editor, id: string) =>
      String(e(ed, `(condition-case nil (read-file-content (concat (fikra/thread/fikra-thread-field-root-of "${id}") "/.tmax/fikra/threads/${id}/events.jsonl")) (error () ""))`).value);

    tt("an INTERRUPT cancels the in-flight request — the server sees the socket close", async () => {
      const ed = await armed();
      rmSync(bodiesFile + ".closes", { force: true });
      e(ed, '(fikra/chat/fikra-turn-send "HOLD-PROBE one")');
      // A REAL request, really streaming: the stub holds it open after
      // its first delta (nothing ends it server-side).
      expect(strip(await until(ed, "(buffer-text)", "HOLD-FIRST", 150))).toContain("HOLD-FIRST");
      e(ed, "(fikra/chat/fikra-turn-interrupt)");
      expect(await untilStatus(ed, "interrupted", 50)).toBe("interrupted");
      expect(await untilFile(bodiesFile + ".closes", "HELD-CLOSED")).toContain("HELD-CLOSED");
      expect(count(text(ed), "HOLD-FIRST")).toBe(1);
    });

    tt("a REPLACED turn's request is cancelled too (the new turn never queues behind it)", async () => {
      const ed = await armed();
      rmSync(bodiesFile + ".closes", { force: true });
      e(ed, '(fikra/chat/fikra-turn-send "HOLD-PROBE replaced")');
      expect(strip(await until(ed, "(buffer-text)", "HOLD-FIRST", 150))).toContain("HOLD-FIRST");
      // The user submits again while the first turn runs (no interrupt).
      e(ed, '(fikra/chat/fikra-turn-send "the replacement")');
      expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
      expect(await untilFile(bodiesFile + ".closes", "HELD-CLOSED")).toContain("HELD-CLOSED");
      const t = text(ed);
      expect(count(t, "HOLD-FIRST")).toBe(1);
      // The replaced turn ended honestly BEFORE the new one began.
      expect(t).toContain("interrupted");
      expect(t.indexOf("interrupted")).toBeLessThan(t.indexOf("user › the replacement"));
    });

    tt("a send from ANOTHER thread supersedes the running turn — which ends on ITS OWN thread", async () => {
      const ed = await armed();
      e(ed, "(require-module fikra/threads)");
      e(ed, '(fikra/chat/fikra-turn-send "main is busy")');
      e(ed, '(fikra/thread/fikra-thread-switch "away")');
      e(ed, '(fikra/chat/fikra-turn-send "from away")');
      // main settled (it used to stay "running" forever — only its
      // completion was discarded); away's turn is the live one.
      expect(String(e(ed, '(fikra/thread/fikra-thread-status-of "main")').value)).toBe("interrupted");
      expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
      expect(String(e(ed, "(fikra/thread/fikra-thread-current)").value)).toBe("away");
      expect(log(ed, "main")).toContain("interrupted");
      expect(log(ed, "away")).toContain("from away");
      expect(log(ed, "away")).not.toContain("main is busy");
    });

    tt("focus moves MID-STREAM: the reply lands on the ORIGINATING thread — complete, once, nowhere else", async () => {
      const ed = await armed();
      e(ed, "(require-module fikra/threads)");
      e(ed, '(fikra/chat/fikra-turn-send "question for main")');
      e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 72 "live")');
      feed(ed, 72, ndjson([{ message: { role: "assistant", content: "hello" } }]));
      expect(text(ed)).toContain("hello");
      // The user switches away; the rest of the stream arrives unseen.
      e(ed, '(fikra/thread/fikra-thread-focus "away")');
      feed(ed, 72, ndjson([{ message: { role: "assistant", content: " world" } }]));
      feed(ed, 72, ndjson([{ message: { role: "assistant", content: "" }, done: true }]));
      finish(ed, 72);
      // Focus was restored; the other thread never received the reply…
      expect(String(e(ed, "(fikra/thread/fikra-thread-current)").value)).toBe("away");
      expect(log(ed, "away")).not.toContain("hello");
      expect(log(ed, "away")).not.toContain("world");
      // …and the originating thread holds ALL of it, exactly once, settled.
      expect(log(ed, "main")).toContain("hello");
      expect(log(ed, "main")).toContain("world");
      e(ed, '(fikra/thread/fikra-thread-focus "main")');
      expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
      e(ed, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
      const t = text(ed);
      expect(count(t, "assistant › hello world")).toBe(1);
      expect(count(t, "assistant ›")).toBe(1);
      expect(t).toContain("completed");
    });

    tt("a background thread's open stream never leaks into the FOCUSED thread's render", async () => {
      const ed = await armed();
      e(ed, "(require-module fikra/threads)");
      e(ed, '(fikra/chat/fikra-turn-send "streaming in main")');
      e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 73 "live")');
      feed(ed, 73, ndjson([{ message: { role: "assistant", content: "main is" } }]));
      // The user views ANOTHER thread while main keeps streaming.
      e(ed, '(fikra/thread/fikra-thread-switch "away")');
      feed(ed, 73, ndjson([{ message: { role: "assistant", content: " still streaming" } }]));
      expect(String(e(ed, "(buffer-current)").value)).toBe("*Fikra-away*");
      expect(text(ed)).not.toContain("still streaming");
      // away's OWN event renders with its speaker label on its own line —
      // main's open text run must not glue it onto the previous line.
      e(ed, '(fikra/event/fikra-event-emit (list (list "kind" "text-delta") (list "speaker" "user") (list "text" "away says hi")))');
      const t = text(ed);
      expect(t).toContain("user › away says hi");
      expect(t).not.toContain("main is");
      // …and main's line joined across the switch (one run of its own).
      feed(ed, 73, ndjson([{ message: { role: "assistant", content: "" }, done: true }]));
      finish(ed, 73);
      expect(log(ed, "main")).toContain("main is");
      expect(log(ed, "main")).toContain(" still streaming");
      expect(String(e(ed, '(fikra/thread/fikra-thread-status-of "main")').value)).toBe("idle");
    });

    tt("LEAVING and RETURNING mid-stream keeps the reply ONE line (no duplicate speaker labels)", async () => {
      const ed = await armed();
      e(ed, "(require-module fikra/threads)");
      e(ed, '(fikra/chat/fikra-turn-send "streamed across switches")');
      e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 74 "live")');
      feed(ed, 74, ndjson([{ message: { role: "assistant", content: "hel" } }]));
      e(ed, '(fikra/thread/fikra-thread-focus "away")');
      feed(ed, 74, ndjson([{ message: { role: "assistant", content: "lo" } }]));
      e(ed, '(fikra/thread/fikra-thread-focus "main")');
      feed(ed, 74, ndjson([{ message: { role: "assistant", content: " world" } }]));
      finish(ed, 74);
      await idle(ed);
      expect(count(text(ed), "assistant › hello world")).toBe(1);
      expect(count(text(ed), "assistant ›")).toBe(1);
      // Live render = replay (the transcript rebuilds to the same reply).
      e(ed, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
      expect(count(text(ed), "assistant › hello world")).toBe(1);
    });

    // r154b (codex gate P0): a delta the transcript could NOT take. The
    // delivered text has to stay a contiguous PREFIX — the first batch
    // that fails closes the live stream, and the completion renders the
    // WHOLE remainder. (Counting delivered characters across the gap
    // lost "FIRST" and rendered a misplaced "ECOND" over "SECOND".)
    tt("a delta the transcript could not take: the completion renders the whole remainder, once", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "with an obstructed log")');
      e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 75 "live")');
      const logPath = String(e(ed, "(fikra/thread/fikra-thread-log-path)").value);
      const aside = `${logPath}.aside`;
      renameSync(logPath, aside);
      mkdirSync(logPath); // the append fails now
      feed(ed, 75, ndjson([{ message: { role: "assistant", content: "FIRST" } }]));
      expect(text(ed)).not.toContain("FIRST");
      rmdirSync(logPath);
      renameSync(aside, logPath); // writable again
      feed(ed, 75, ndjson([{ message: { role: "assistant", content: "SECOND" } }]));
      // WITHHELD: a gap already sits before it.
      expect(text(ed)).not.toContain("SECOND");
      finish(ed, 75);
      await idle(ed);
      const t = text(ed);
      expect(count(t, "assistant › FIRSTSECOND")).toBe(1);
      expect(count(t, "FIRST")).toBe(1);
      expect(count(t, "SECOND")).toBe(1);
      expect(count(log(ed, "main"), "FIRSTSECOND")).toBe(1);
    });

    tt("streamed deltas are ONE assistant message in the next request's history", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "first: the history check")');
      e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 777 "live")');
      feed(ed, 777, ndjson([
        { message: { role: "assistant", content: "hello" } },
        { message: { role: "assistant", content: " world" } },
        { message: { role: "assistant", content: "" }, done: true },
      ]));
      finish(ed, 777);
      await idle(ed);
      const h = String(e(ed, "(fikra/backend-ollama/fikra-ollama-history-messages)").value);
      expect(h).toContain('"role":"assistant","content":"hello world"');
      expect(count(h, '"role":"assistant"')).toBe(1);
      // The REAL wire: the next turn's request body.
      e(ed, '(fikra/chat/fikra-turn-send "second: the follow-up")');
      const msgs = (JSON.parse(await lastBodyFor("second: the follow-up")) as {
        messages: { role: string; content: string }[];
      }).messages;
      expect(msgs.filter((m) => m.role === "assistant")).toEqual([{ role: "assistant", content: "hello world" }]);
      expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    });

    tt("HISTORY survives a thread switch (the thread's durable log is the source)", async () => {
      const ed = await armed();
      e(ed, "(require-module fikra/threads)");
      e(ed, '(fikra/chat/fikra-turn-send "remember the word pineapple")');
      e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 43 "live")');
      feed(ed, 43, ndjson([{ message: { role: "assistant", content: "noted" } }]));
      finish(ed, 43);
      await idle(ed);
      // Away and back: the in-memory event copy resets on every focus
      // change — the history used to vanish with it.
      e(ed, '(fikra/thread/fikra-thread-focus "away")');
      e(ed, '(fikra/thread/fikra-thread-focus "main")');
      const h = String(e(ed, "(fikra/backend-ollama/fikra-ollama-history-messages)").value);
      expect(h).toContain('"role":"user","content":"remember the word pineapple"');
      expect(h).toContain('"role":"assistant","content":"noted"');
    });

    // r154: durable history GROWS — and an unbounded one stalled the
    // editor at every send (measured: 2.7s at 100 turns) for a prompt the
    // 4096-token context cannot hold. Synthetic long-lived threads below
    // (main's log overwritten directly).
    const writeLog = (ed: Editor, rows: unknown[]) => {
      const path = String(e(ed, "(fikra/thread/fikra-thread-log-path)").value);
      writeFileSync(path, rows.map((r) => JSON.stringify(r) + "\n").join(""));
    };
    const history = (ed: Editor) =>
      JSON.parse("[" + String(e(ed, "(fikra/backend-ollama/fikra-ollama-history-messages)").value).replace(/,$/, "") + "]") as {
        role: string;
        content: string;
      }[];

    tt("a LONG thread sends only its most recent WHOLE turns (the history is budgeted)", async () => {
      const ed = await armed();
      const rows: unknown[] = [];
      // 40 turns of 400 chars each (question + streamed answer), in the
      // production order (the question is logged before its turn-start).
      for (let t = 1; t <= 40; t++) {
        rows.push({ kind: "text-delta", speaker: "user", text: `q${t} `.padEnd(200, "u") });
        rows.push({ kind: "turn-start", turn: t });
        for (let d = 0; d < 20; d++) rows.push({ kind: "text-delta", speaker: "assistant", text: "0123456789" });
        rows.push({ kind: "turn-end", turn: t, status: "completed" });
      }
      writeLog(ed, rows);
      const msgs = history(ed);
      const size = msgs.reduce((n, m) => n + m.content.length, 0);
      // Bounded — and it still FILLS the budget with whole turns.
      expect(size).toBeLessThanOrEqual(6000);
      expect(size).toBeGreaterThan(4000);
      // Whole turns, newest first: opens on a question, closes on its answer.
      expect(msgs[0]?.role).toBe("user");
      expect(Number(msgs[0]?.content.slice(1, msgs[0]?.content.indexOf(" ")))).toBeGreaterThan(20);
      expect(msgs[msgs.length - 1]).toEqual({ role: "assistant", content: "0123456789".repeat(20) });
      // …every question immediately followed by its answer.
      expect(msgs.map((m) => m.role).join(",")).toBe(msgs.map((_, i) => (i % 2 === 0 ? "user" : "assistant")).join(","));
    });

    tt("a turn larger than the read window never leaves a half-open history", async () => {
      const ed = await armed();
      const rows: unknown[] = [{ kind: "text-delta", speaker: "user", text: "q1" }, { kind: "turn-start", turn: 1 }];
      // One enormous turn (≈400KB of log): the window holds only its end.
      for (let d = 0; d < 6000; d++) rows.push({ kind: "text-delta", speaker: "assistant", text: "0123456789" });
      rows.push({ kind: "turn-end", turn: 1, status: "completed" });
      writeLog(ed, rows);
      // No WHOLE completed turn is visible → NO history (never a reply
      // without its question, never half a turn).
      expect(history(ed)).toEqual([]);
      // A later small turn is whole inside the window — it IS the history.
      writeLog(ed, [...rows,
        { kind: "text-delta", speaker: "user", text: "second question" },
        { kind: "turn-start", turn: 2 },
        { kind: "text-delta", speaker: "assistant", text: "short answer" },
        { kind: "turn-end", turn: 2, status: "completed" }]);
      expect(history(ed)).toEqual([
        { role: "user", content: "second question" },
        { role: "assistant", content: "short answer" },
      ]);
    });

    // r154b (codex gate P1): the budget must size turns WITH their
    // durable tool exchanges — on a COLD start too (after a restart the
    // exchanges file is the only copy). Sized without them, the first
    // prompt after a restart carried 14181 chars against the 6000 budget.
    tt("a COLD start budgets the durable tool exchanges too (the same turns as warm)", async () => {
      const ed = await armed();
      const big = "x".repeat(4500);
      const exFile = String(e(ed, "(fikra/backend-ollama/fikra-ollama-exchanges-file-get)").value);
      const exchange = JSON.stringify({ role: "assistant", content: "", tool_calls: [
        { function: { name: "bash", arguments: { command: "echo q" } } }] }) + "," +
        JSON.stringify({ role: "tool", content: big }) + ",";
      writeFileSync(exFile, [1, 2, 3].map((t) => `${hex(`main/${t}/1`)} ${hex(exchange)}`).join("\n") + "\n");
      const questionsOf = (h: string) => [...h.matchAll(/"role":"user","content":"(QUESTION-\d)"/g)].map((m) => m[1]);
      const historyText = () => String(e(ed, "(fikra/backend-ollama/fikra-ollama-history-messages)").value);
      // The production order: the question is logged BEFORE its turn-start
      // (the chat seam emits the user's line, then the backend begins the
      // turn) — three tool turns of ~4600 chars each against the budget.
      const rows: unknown[] = [];
      for (let t = 1; t <= 3; t++) {
        rows.push(
          { kind: "text-delta", speaker: "user", text: `QUESTION-${t}` },
          { kind: "turn-start", turn: t },
          { kind: "tool-call", tool: "bash", summary: "echo q" },
          { kind: "tool-result", ok: true, summary: big },
          { kind: "text-delta", speaker: "assistant", text: `ANSWER-${t}` },
          { kind: "turn-end", turn: t, status: "completed" });
      }
      writeLog(ed, rows);
      // COLD: the in-memory exchange map wiped (a restart's effect).
      e(ed, "(fikra/backend-ollama/fikra-ollama-tool-exchanges-reset)");
      const cold = historyText();
      const warm = historyText();
      expect(cold).toBe(warm);
      expect(questionsOf(cold)).toEqual(["QUESTION-3"]);
      expect(cold).toContain('"role":"tool"');
      expect(cold.length).toBeLessThanOrEqual(6000);
      expect(cold.length).toBeGreaterThan(4000);
    });

    // r154c (codex gate P1): a turn that never ENDED (a crash mid-turn)
    // is not history — neither its question nor its partial reply. The
    // budget already refused to size it; the scan still serialized it.
    tt("a turn that never ended is not history (completed turns only)", async () => {
      const ed = await armed();
      writeLog(ed, [
        { kind: "text-delta", speaker: "user", text: "old" },
        { kind: "turn-start", turn: 1 },
        { kind: "text-delta", speaker: "assistant", text: "ok" },
        { kind: "turn-end", turn: 1, status: "completed" },
        { kind: "text-delta", speaker: "user", text: "CRASH-QUESTION" },
        { kind: "turn-start", turn: 2 },
        { kind: "text-delta", speaker: "assistant", text: "CRASH-PARTIAL" },
        // …and no turn-end: the daemon died mid-turn.
        { kind: "text-delta", speaker: "user", text: "new" },
        { kind: "turn-start", turn: 3 },
        { kind: "text-delta", speaker: "assistant", text: "fine" },
        { kind: "turn-end", turn: 3, status: "completed" },
      ]);
      expect(history(ed)).toEqual([
        { role: "user", content: "old" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "new" },
        { role: "assistant", content: "fine" },
      ]);
    });

    // r154d (codex gate round 3): an ending that belongs to an EARLIER
    // turn (the replay's stale-ending class) must not close the next
    // turn's group — the question stayed in history and its answer went.
    tt("a stale ending never costs the next turn its answer", async () => {
      const ed = await armed();
      writeLog(ed, [
        { kind: "text-delta", speaker: "user", text: "QUESTION-1" },
        { kind: "turn-start", turn: 1 },
        { kind: "text-delta", speaker: "assistant", text: "ANSWER-1" },
        { kind: "turn-end", turn: 1, status: "completed" },
        { kind: "text-delta", speaker: "user", text: "QUESTION-2" },
        { kind: "turn-start", turn: 2 },
        // A LATE ending for turn 1 (a held flush, a straggler).
        { kind: "turn-end", turn: 1, status: "completed" },
        { kind: "text-delta", speaker: "assistant", text: "ANSWER-2" },
        { kind: "turn-end", turn: 2, status: "completed" },
      ]);
      expect(history(ed)).toEqual([
        { role: "user", content: "QUESTION-1" },
        { role: "assistant", content: "ANSWER-1" },
        { role: "user", content: "QUESTION-2" },
        { role: "assistant", content: "ANSWER-2" },
      ]);
    });

    // r154d (codex gate round 3): a question abandoned BEFORE its turn
    // started (a crash in that interval) must never merge into the next
    // question — the merge used to run first and history showed
    // "abandonednew" as the question.
    tt("a question abandoned before its turn started never joins the next question", async () => {
      const ed = await armed();
      writeLog(ed, [
        { kind: "text-delta", speaker: "user", text: "abandoned" },
        // …and nothing else: the daemon died before the turn began.
        { kind: "text-delta", speaker: "user", text: "new" },
        { kind: "turn-start", turn: 1 },
        { kind: "text-delta", speaker: "assistant", text: "answer" },
        { kind: "turn-end", turn: 1, status: "completed" },
      ]);
      expect(history(ed)).toEqual([
        { role: "user", content: "new" },
        { role: "assistant", content: "answer" },
      ]);
    });

    // r154e (codex gate round 4): a turn the user REVERTED is not
    // history either. Replay hides the tombstoned range (target,
    // revert-point]; the model was still told about it.
    tt("a REVERTED turn is not history (the model never learns what the user undid)", async () => {
      const ed = await armed();
      writeLog(ed, [
        { kind: "text-delta", speaker: "user", text: "QUESTION-1" },
        { kind: "turn-start", turn: 1 },
        { kind: "text-delta", speaker: "assistant", text: "ANSWER-1" },
        { kind: "turn-end", turn: 1, status: "completed" },
        { kind: "text-delta", speaker: "user", text: "QUESTION-2" },
        { kind: "turn-start", turn: 2 },
        { kind: "text-delta", speaker: "assistant", text: "ANSWER-2" },
        { kind: "turn-end", turn: 2, status: "completed" },
        // The user reverts to turn 1's checkpoint, undoing turn 2.
        { kind: "checkpoint-reverted", target: "refs/fikra/main/1", "revert-point": "refs/fikra/main/2", "paths-reverted": 1, "paths-aborted": 0 },
        { kind: "text-delta", speaker: "user", text: "QUESTION-3" },
        { kind: "turn-start", turn: 3 },
        { kind: "text-delta", speaker: "assistant", text: "ANSWER-3" },
        { kind: "turn-end", turn: 3, status: "completed" },
      ]);
      expect(history(ed)).toEqual([
        { role: "user", content: "QUESTION-1" },
        { role: "assistant", content: "ANSWER-1" },
        { role: "user", content: "QUESTION-3" },
        { role: "assistant", content: "ANSWER-3" },
      ]);
    });

    // r154c (codex gate P0): the completion's OWN write failing must not
    // lose the response. The text is HELD per thread and written out —
    // in front of the user's next line — at the next send.
    tt("a reply the transcript could not take at completion is HELD and written at the next send", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "the transcript fails")');
      e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 76 "live")');
      const logPath = String(e(ed, "(fikra/thread/fikra-thread-log-path)").value);
      const aside = `${logPath}.aside`;
      renameSync(logPath, aside);
      mkdirSync(logPath);
      feed(ed, 76, ndjson([{ message: { role: "assistant", content: "HELD-REPLY" } }]));
      finish(ed, 76);
      // The turn still settles (a thread never strands on an unwritable
      // transcript) and the status says the reply is held.
      expect(await untilStatus(ed, "idle", 50)).toBe("idle");
      expect(String(e(ed, "(editor-status)").value)).toContain("HELD");
      rmdirSync(logPath);
      renameSync(aside, logPath);
      e(ed, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
      expect(text(ed)).not.toContain("HELD-REPLY");
      // The next send writes the held reply FIRST, as a line of its own —
      // and the turn's refused ENDING with it (in order: the reply, the
      // end marker, then the new question, labelled, on its own line).
      e(ed, '(fikra/chat/fikra-turn-send "and the next question")');
      const t = text(ed);
      expect(count(t, "assistant › HELD-REPLY")).toBe(1);
      expect(t.indexOf("HELD-REPLY")).toBeLessThan(t.indexOf("completed"));
      expect(t.indexOf("completed")).toBeLessThan(t.indexOf("user › and the next question"));
      expect(count(log(ed, "main"), "HELD-REPLY")).toBe(1);
      const endings = strip(log(ed, "main")).split("\n").filter((l) => l.includes('"kind":"turn-end"'));
      expect(endings).toHaveLength(1);
      expect(endings[0]).toContain('"status":"completed"');
    });

    tt("a BLANK line in the stream never stalls it", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "blank lines")');
      e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 78 "live")');
      // A leading blank line, then the delta, then another blank.
      feed(ed, 78, hex("\n") + ndjson([{ message: { role: "assistant", content: "after-blank" } }]) + hex("\n"));
      expect(text(ed)).toContain("after-blank");
      feed(ed, 78, ndjson([{ message: { role: "assistant", content: " and-more" } }]));
      finish(ed, 78);
      await idle(ed);
      expect(count(text(ed), "assistant › after-blank and-more")).toBe(1);
    });

    tt("a final UNTERMINATED line is part of the reply (not discarded)", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "unterminated tail")');
      e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 79 "live")');
      // One complete line, then a last line with NO trailing newline.
      feed(ed, 79, ndjson([{ message: { role: "assistant", content: "complete line," } }]) +
        hex(JSON.stringify({ message: { role: "assistant", content: " then the tail" } })));
      expect(text(ed)).toContain("complete line,");
      expect(text(ed)).not.toContain("then the tail");
      finish(ed, 79);
      await idle(ed);
      expect(count(text(ed), "assistant › complete line, then the tail")).toBe(1);
    });

    tt("a line split across chunks renders once", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "split chunks")');
      e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 801 "live")');
      const whole = JSON.stringify({ message: { role: "assistant", content: "split-safe" } }) + "\n";
      const cut = Math.floor(whole.length / 2);
      feed(ed, 801, hex(whole.slice(0, cut)));
      expect(text(ed)).not.toContain("split-sa");
      feed(ed, 801, hex(whole.slice(cut)));
      finish(ed, 801);
      await idle(ed);
      expect(count(text(ed), "assistant › split-safe")).toBe(1);
    });

    tt("tool calls streamed ONE PER LINE all reach the round (ollama 0.12's live shape)", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "run two commands")');
      e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 80 "live")');
      // Captured live from ollama 0.12.3 + qwen3:8b asked for two tool
      // calls: the narration streams as content; EACH call is its own
      // line carrying a single-element tool_calls array; every call
      // after the first is stamped with its index inside `function`; the
      // last line is the done marker with empty content.
      feed(ed, 80, ndjson([
        { message: { role: "assistant", content: "Running both." } },
        { message: { role: "assistant", content: "", tool_calls: [
          { function: { name: "bash", arguments: { command: "echo FIRST-CALL" } } }] } },
        { message: { role: "assistant", content: "", tool_calls: [
          { function: { index: 1, name: "bash", arguments: { command: "echo SECOND-CALL" } } }] } },
        { message: { role: "assistant", content: "" }, done: true, done_reason: "stop" },
      ]));
      finish(ed, 80);
      const mid = strip(await until(ed, "(buffer-text)", "SECOND-CALL", 120));
      // BOTH calls ran (a last-line-wins stash dropped the first).
      expect(mid).toContain("FIRST-CALL");
      expect(count(mid, "⚙ bash")).toBe(2);
      // The narration rendered exactly once, before the rows.
      expect(count(mid, "Running both.")).toBe(1);
      expect(mid.indexOf("Running both.")).toBeLessThan(mid.indexOf("FIRST-CALL"));
      // The model's own record carries BOTH calls and its narration.
      const acc = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
      const assistant = acc.slice(acc.indexOf('"role":"assistant"'), acc.indexOf('"role":"tool"'));
      expect(count(assistant, '"name":"bash"')).toBe(2);
      expect(assistant).toContain('"content":"Running both."');
      await settleRefireFrom(ed, "80", "both done");
      await idle(ed);
      expect(count(text(ed), "Running both.")).toBe(1);
    });

    tt("an INCREMENTAL tool call (index + argument-string pieces) merges into ONE call", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "fragmented call")');
      e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 81 "live")');
      feed(ed, 81, ndjson([
        { message: { role: "assistant", content: "", tool_calls: [
          { index: 0, function: { name: "bash", arguments: "" } }] } },
        { message: { role: "assistant", content: "", tool_calls: [
          { index: 0, function: { arguments: '{"comm' } }] } },
        { message: { role: "assistant", content: "", tool_calls: [
          { index: 0, function: { arguments: 'and":"echo FRAG-MERGE"}' } }] } },
        { message: { role: "assistant", content: "" }, done: true },
      ]));
      finish(ed, 81);
      const mid = strip(await until(ed, "(buffer-text)", "FRAG-MERGE", 120));
      expect(count(mid, "⚙ bash")).toBe(1);
      expect(mid).toContain("FRAG-MERGE");
      await settleRefireFrom(ed, "81", "merged");
      await idle(ed);
    });

    tt("index-less argument fragments continue the LAST call (the object-fragment shape)", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "object fragments")');
      e(ed, '(fikra/backend-ollama/fikra-backend-ollama-seed 82 "live")');
      feed(ed, 82, ndjson([
        { message: { role: "assistant", content: "", tool_calls: [
          { function: { name: "bash", arguments: { command: "echo LEG" } } }] } },
        { message: { role: "assistant", content: "", tool_calls: [
          { function: { arguments: { command: "echo LEGACY-MERGE" } } }] } },
        { message: { role: "assistant", content: "" }, done: true },
      ]));
      finish(ed, 82);
      const mid = strip(await until(ed, "(buffer-text)", "LEGACY-MERGE", 120));
      expect(count(mid, "⚙ bash")).toBe(1);
      await settleRefireFrom(ed, "82", "merged");
      await idle(ed);
    });
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

// r155 — ORDINARY BASH GETS ITS CHECKPOINT (the codex gate's named 9-bar
// for §8.1: "a checkpoint for each mutating action"). A non-mediated bash
// call is bracketed with worktree snapshots taken IN THE CHILD (a
// persistent index per thread; GIT_INDEX_FILE scoped to the snapshot
// commands only; .tmax excluded; the two trees go to a marker FILE).
// Different trees → the sentinel seals the pair (post → pre), exactly
// like a mediated action: SPC a C-r reverts it. Same trees → nothing.
describe("ollama ordinary-bash checkpoints (r155)", () => {
  const call = (ed: Editor, id: number, command: string) => {
    const r = hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [
      { function: { name: "bash", arguments: { command } } }] } }));
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed ${id} "live")`);
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${id} "${r}")`);
    e(ed, `(fikra-http-complete ${id} 200 "${hex("{}")}")`);
  };
  const refs = () => execFileSync("git", ["for-each-ref", "--format=%(refname)", "refs/fikra/main/"], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
  const actionRefs = () => refs().filter((r) => /-a\d+$/.test(r));
  const ckptEvents = (ed: Editor) => strip(logText(ed)).split("\n").filter((l) => l.includes('"kind":"checkpoint-ready"'));
  const logText = (ed: Editor) => String(e(ed, `(condition-case nil (read-file-content (concat (fikra/thread/fikra-thread-field-root-of "main") "/.tmax/fikra/threads/main/events.jsonl")) (error () ""))`).value);

  tt("a MUTATING ordinary bash call gets an action pair — and SPC a C-r undoes it", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "write a file")');
    const before = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    // (A `>` redirect would park at the L2 gate — the mediated path,
    // which has its own pre/post captures. `cp` is an ordinary mutation.)
    call(ed, 500, "cp base.txt made-by-bash.txt");
    // A checkpoint-ready batch REBUILDS the transcript, so the marker
    // lands INLINE on the ⚙ row at once (the replay's inline merge — the
    // mockup's form); it never stands as a row of its own.
    const inlineRows = (t: string) => t.split("\n").filter((l) => l.includes("[ckpt main/1-a2"));
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    expect(inlineRows(strip(String(e(ed, "(buffer-text)").value)))).toEqual([expect.stringContaining("⚙ bash")]);
    await settleRefireFrom(ed, before, "written");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
    expect(inlineRows(strip(String(e(ed, "(buffer-text)").value)))).toEqual([expect.stringContaining("⚙ bash")]);
    // The pair: pre (-a1) → post (-a2), both real refs, the file in the post only.
    expect(actionRefs()).toEqual(["refs/fikra/main/1-a1", "refs/fikra/main/1-a2"]);
    expect(execFileSync("git", ["cat-file", "-e", "refs/fikra/main/1-a2:made-by-bash.txt"]) && true).toBe(true);
    expect(() => execFileSync("git", ["cat-file", "-e", "refs/fikra/main/1-a1:made-by-bash.txt"], { stdio: "pipe" })).toThrow();
    // …durable, and on the revert stack.
    const pairs = String(e(ed, '(shell-command "cat .tmax/fikra/threads/main/actions.jsonl")').value);
    expect(pairs).toContain("refs/fikra/main/1-a2 refs/fikra/main/1-a1");
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-action-posts-get)").value)).toContain("refs/fikra/main/1-a2");
    // The model saw exactly its command's output.
    const acc = String(e(ed, "(fikra/backend-ollama/fikra-ollama-messages-get)").value);
    expect(acc).toContain('"role":"tool","content":""');
    expect(acc).not.toContain("write-tree");
    expect(acc).not.toContain("EXIT:");
    // The user's index was never touched; the snapshots left nothing in the tree.
    expect(execFileSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8" }).trim()).toBe("");
    expect(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()).toBe("?? made-by-bash.txt");
    // SPC a C-r: the action is undone — the file is gone, the stack empty.
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("action reverted to refs/fikra/main/1-a1");
    expect(existsSync(join(process.cwd(), "made-by-bash.txt"))).toBe(false);
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("no action to revert");
  });

  tt("a READ-ONLY ordinary bash call gets NO checkpoint (no ref, no marker, no pair)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "just look")');
    const before = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    call(ed, 501, "echo just-looking");
    const mid = strip(await until(ed, "(buffer-text)", "just-looking", 120));
    expect(mid).not.toContain("[ckpt main/1-a");
    await settleRefireFrom(ed, before, "seen");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
    expect(actionRefs()).toEqual([]);
    expect(ckptEvents(ed).filter((l) => /-a\d+"/.test(l))).toEqual([]);
    expect(String(e(ed, "(fikra/backend-ollama/fikra-ollama-action-posts-get)").value)).not.toContain("-a");
  });

  // Each mutating call is its own pair: a deletion and a modification
  // in one turn revert one at a time, newest first.
  tt("a deleted file comes back and a modified one is restored — one action per pair", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "delete and append")');
    call(ed, 502, "rm base.txt");
    expect(strip(await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120))).toContain("[ckpt main/1-a2");
    call(ed, 503, "printf 'appended\\n' >> notes.txt");
    expect(strip(await until(ed, "(buffer-text)", "[ckpt main/1-a4", 120))).toContain("[ckpt main/1-a4");
    expect(actionRefs()).toEqual(["refs/fikra/main/1-a1", "refs/fikra/main/1-a2", "refs/fikra/main/1-a3", "refs/fikra/main/1-a4"]);
    expect(existsSync(join(process.cwd(), "base.txt"))).toBe(false);
    // Newest first: the append goes…
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("action reverted to refs/fikra/main/1-a3");
    expect(existsSync(join(process.cwd(), "notes.txt"))).toBe(false);
    expect(existsSync(join(process.cwd(), "base.txt"))).toBe(false);
    // …then the deletion.
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("action reverted to refs/fikra/main/1-a1");
    expect(readFileSync(join(process.cwd(), "base.txt"), "utf8")).toBe("base\n");
  });

  // The snapshots read the WORKTREE through their own index: whatever
  // the user has staged or left uncommitted stays exactly as it was.
  tt("the user's staged and unstaged work is untouched (and still reverts safely)", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "base.txt"), "user edit\n");
    execFileSync("git", ["add", "base.txt"]);
    writeFileSync(join(process.cwd(), "staged-then-edited.txt"), "v1\n");
    execFileSync("git", ["add", "staged-then-edited.txt"]);
    writeFileSync(join(process.cwd(), "staged-then-edited.txt"), "v2\n");
    e(ed, '(fikra/chat/fikra-turn-send "copy it")');
    call(ed, 504, "cp base.txt made-by-bash.txt");
    expect(strip(await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120))).toContain("[ckpt main/1-a2");
    expect(execFileSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8" }).trim().split("\n").sort()).toEqual(["base.txt", "staged-then-edited.txt"]);
    expect(execFileSync("git", ["show", ":base.txt"], { encoding: "utf8" })).toBe("user edit\n");
    expect(readFileSync(join(process.cwd(), "staged-then-edited.txt"), "utf8")).toBe("v2\n");
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(existsSync(join(process.cwd(), "made-by-bash.txt"))).toBe(false);
    expect(readFileSync(join(process.cwd(), "base.txt"), "utf8")).toBe("user edit\n");
    expect(execFileSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8" }).trim().split("\n").sort()).toEqual(["base.txt", "staged-then-edited.txt"]);
  });

  // The marker file sits inside the working dir — the very command it
  // describes can write it. Nothing but two 40-hex object names may
  // reach a shell command — and with checkpointing enabled, a marker
  // that yields no pair is a VISIBLE failure, never a quiet pass.
  tt("a tampered or bogus marker seals nothing, reaches no shell, and is REPORTED", async () => {
    const ed = await armed();
    const marker = join(process.cwd(), ".tmax", "fikra", "ckpt-trees-main");
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, "0; touch PWNED deadbeef");
    e(ed, "(fikra/backend-ollama/fikra-ollama-action-checkpoint)");
    expect(existsSync(join(process.cwd(), "PWNED"))).toBe(false);
    expect(actionRefs()).toEqual([]);
    expect(String(e(ed, "(editor-status)").value)).toContain("action checkpoint FAILED");
    expect(logText(ed)).toContain('"kind":"checkpoint-error"');
    expect(existsSync(marker)).toBe(false);
    // Right shape, no such objects: commit-tree fails — nothing is
    // sealed, and that is reported too.
    writeFileSync(marker, `${"a".repeat(40)} ${"b".repeat(40)}`);
    e(ed, "(fikra/backend-ollama/fikra-ollama-action-checkpoint)");
    expect(actionRefs()).toEqual([]);
    expect(String(e(ed, "(editor-status)").value)).toContain("action checkpoint FAILED");
    expect(existsSync(marker)).toBe(false);
    // The marker of a READ-ONLY call (identical trees) is not a failure:
    // nothing is reported (the status and the log stay as they were).
    const errorsBefore = logText(ed).split("\n").filter((l) => l.includes('"kind":"checkpoint-error"')).length;
    const statusBefore = String(e(ed, "(editor-status)").value);
    writeFileSync(marker, `${"a".repeat(40)} ${"a".repeat(40)}`);
    e(ed, "(fikra/backend-ollama/fikra-ollama-action-checkpoint)");
    expect(String(e(ed, "(editor-status)").value)).toBe(statusBefore);
    expect(logText(ed).split("\n").filter((l) => l.includes('"kind":"checkpoint-error"')).length).toBe(errorsBefore);
    expect(existsSync(marker)).toBe(false);
  });

  // r155b (codex gate round 1, P1): a locked snapshot index made both
  // `git add`s fail — the command ran, the mutation had NO checkpoint,
  // and nothing said so.
  tt("a snapshot that cannot run is a VISIBLE failure (never a silent mutation)", async () => {
    const ed = await armed();
    mkdirSync(join(process.cwd(), ".tmax", "fikra"), { recursive: true });
    writeFileSync(join(process.cwd(), ".tmax", "fikra", "ckpt-index-main.lock"), "");
    e(ed, '(fikra/chat/fikra-turn-send "copy it")');
    const before = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    call(ed, 508, "cp base.txt copied.txt");
    const mid = strip(await until(ed, "(buffer-text)", "checkpoint-error", 120));
    expect(mid.split("\n").filter((l) => l.includes("checkpoint-error: action checkpoint failed (snapshot)")).length).toBe(1);
    expect(String(e(ed, "(editor-status)").value)).toContain("action checkpoint FAILED");
    expect(existsSync(join(process.cwd(), "copied.txt"))).toBe(true);
    expect(actionRefs()).toEqual([]);
    await settleRefireFrom(ed, before, "copied");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
  });

  // r155b (codex gate round 1, P1): the worktree state of a SYMLINK is
  // its target text (what the tree stores) — `cat` followed the link,
  // so a link-creating action could never be reverted.
  tt("a symlink action reverts — a live link and a dangling one", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "link it")');
    call(ed, 506, "ln -s base.txt link.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    expect(existsSync(join(process.cwd(), "link.txt"))).toBe(true);
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
    expect(lstatSync(join(process.cwd(), "link.txt"), { throwIfNoEntry: false })).toBeUndefined();
    expect(readFileSync(join(process.cwd(), "base.txt"), "utf8")).toBe("base\n");
    call(ed, 507, "ln -s nowhere.txt dangling.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a4", 120);
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
    expect(lstatSync(join(process.cwd(), "dangling.txt"), { throwIfNoEntry: false })).toBeUndefined();
  });

  // r155b (codex gate round 1, P0): the revert restored with
  // `git checkout <pre> -- <path>`, which writes the INDEX too — a
  // version the user had STAGED was overwritten, and unstaged work the
  // user had left alone became staged. A revert restores the WORKTREE.
  tt("a revert restores the WORKTREE and never touches the user's staged content", async () => {
    const ed = await armed();
    // Staged one version, then returned the working file to another.
    writeFileSync(join(process.cwd(), "base.txt"), "staged content\n");
    execFileSync("git", ["add", "base.txt"]);
    writeFileSync(join(process.cwd(), "base.txt"), "base\n");
    writeFileSync(join(process.cwd(), "source.txt"), "staged content\n");
    e(ed, '(fikra/chat/fikra-turn-send "copy it")');
    call(ed, 505, "cp source.txt base.txt");
    // (The action made the working file identical to the staged one.)
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
    expect(readFileSync(join(process.cwd(), "base.txt"), "utf8")).toBe("base\n");
    expect(execFileSync("git", ["show", ":base.txt"], { encoding: "utf8" })).toBe("staged content\n");
  });

  tt("a revert never STAGES the user's unstaged work", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "base.txt"), "user edit\n");
    e(ed, '(fikra/chat/fikra-turn-send "append to it")');
    call(ed, 509, "printf 'more\\n' >> base.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    const status = String(e(ed, "(editor-status)").value);
    expect(status).toContain("action reverted");
    // Nothing was staged here (the index still holds HEAD's version): the
    // restored file is the user's own unstaged work again — no note.
    expect(status).not.toContain("staged");
    expect(readFileSync(join(process.cwd(), "base.txt"), "utf8")).toBe("user edit\n");
    expect(execFileSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8" }).trim()).toBe("");
  });

  // Each mutating call is its own pair: a deletion and a modification
  // in one turn revert one at a time, newest first.
  tt("a deleted file comes back and a modified one is restored — one action per pair", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "delete and append")');
    call(ed, 502, "rm base.txt");
    expect(strip(await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120))).toContain("[ckpt main/1-a2");
    call(ed, 503, "printf 'appended\\n' >> notes.txt");
    expect(strip(await until(ed, "(buffer-text)", "[ckpt main/1-a4", 120))).toContain("[ckpt main/1-a4");
    expect(actionRefs()).toEqual(["refs/fikra/main/1-a1", "refs/fikra/main/1-a2", "refs/fikra/main/1-a3", "refs/fikra/main/1-a4"]);
    expect(existsSync(join(process.cwd(), "base.txt"))).toBe(false);
    // Newest first: the append goes…
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("action reverted to refs/fikra/main/1-a3");
    expect(existsSync(join(process.cwd(), "notes.txt"))).toBe(false);
    expect(existsSync(join(process.cwd(), "base.txt"))).toBe(false);
    // …then the deletion.
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("action reverted to refs/fikra/main/1-a1");
    expect(readFileSync(join(process.cwd(), "base.txt"), "utf8")).toBe("base\n");
  });

  // The snapshots read the WORKTREE through their own index: whatever
  // the user has staged or left uncommitted stays exactly as it was.
  tt("the user's staged and unstaged work is untouched (and still reverts safely)", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "base.txt"), "user edit\n");
    execFileSync("git", ["add", "base.txt"]);
    writeFileSync(join(process.cwd(), "staged-then-edited.txt"), "v1\n");
    execFileSync("git", ["add", "staged-then-edited.txt"]);
    writeFileSync(join(process.cwd(), "staged-then-edited.txt"), "v2\n");
    e(ed, '(fikra/chat/fikra-turn-send "copy it")');
    call(ed, 504, "cp base.txt made-by-bash.txt");
    expect(strip(await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120))).toContain("[ckpt main/1-a2");
    expect(execFileSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8" }).trim().split("\n").sort()).toEqual(["base.txt", "staged-then-edited.txt"]);
    expect(execFileSync("git", ["show", ":base.txt"], { encoding: "utf8" })).toBe("user edit\n");
    expect(readFileSync(join(process.cwd(), "staged-then-edited.txt"), "utf8")).toBe("v2\n");
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(existsSync(join(process.cwd(), "made-by-bash.txt"))).toBe(false);
    expect(readFileSync(join(process.cwd(), "base.txt"), "utf8")).toBe("user edit\n");
    expect(execFileSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8" }).trim().split("\n").sort()).toEqual(["base.txt", "staged-then-edited.txt"]);
  });

  // The marker file sits inside the working dir — the very command it
  // describes can write it. Nothing but two 40-hex object names may
  // reach a shell command.
  tt("a tampered or bogus marker seals nothing and reaches no shell", async () => {
    const ed = await armed();
    const marker = join(process.cwd(), ".tmax", "fikra", "ckpt-trees-main");
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, "0; touch PWNED deadbeef");
    e(ed, "(fikra/backend-ollama/fikra-ollama-action-checkpoint)");
    expect(existsSync(join(process.cwd(), "PWNED"))).toBe(false);
    expect(actionRefs()).toEqual([]);
    // Right shape, no such objects: commit-tree fails — nothing is sealed.
    writeFileSync(marker, `${"a".repeat(40)} ${"b".repeat(40)}`);
    e(ed, "(fikra/backend-ollama/fikra-ollama-action-checkpoint)");
    expect(actionRefs()).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  });

  // r155c/r155d (codex gate rounds 2–3): a staged entry is the USER's
  // work. A revert NEVER writes the index — who staged what cannot be
  // told apart after the fact (a whole-index fingerprint granted an
  // action that ran its own `git add` for ONE path ownership of every
  // other added path, and cost the user an entry they staged).
  // The WORKTREE mode as git records it (100644 / 100755).
  const fileMode = (f: string) => ((statSync(join(process.cwd(), f)).mode & 0o111) ? "100755" : "100644");
  const worktreeIsLink = (f: string) => lstatSync(join(process.cwd(), f), { throwIfNoEntry: false })?.isSymbolicLink() ?? false;

  tt("an addition the USER staged survives the revert — and the status says so", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "make a file")');
    call(ed, 510, "touch user-staged.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    execFileSync("git", ["add", "user-staged.txt"]);
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    const status = String(e(ed, "(editor-status)").value);
    expect(status).toContain("action reverted");
    expect(status).toContain("still staged");
    expect(existsSync(join(process.cwd(), "user-staged.txt"))).toBe(false);
    expect(execFileSync("git", ["ls-files", "user-staged.txt"], { encoding: "utf8" }).trim()).toBe("user-staged.txt");
  });

  // The price of never writing the index: an action's OWN `git add`
  // stays staged too — said in the status AND in the transcript (the
  // entry would bring the file back at commit).
  tt("the action's OWN `git add` is LEFT STAGED — a revert never writes the index — and it is said twice", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "stage your own file")');
    call(ed, 511, "touch self-staged.txt && git add self-staged.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    expect(execFileSync("git", ["ls-files", "self-staged.txt"], { encoding: "utf8" }).trim()).toBe("self-staged.txt");
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    const status = String(e(ed, "(editor-status)").value);
    expect(status).toContain("action reverted");
    expect(status).toContain("1 path(s) still staged: a commit would record the action's content (review: git diff --cached)");
    expect(existsSync(join(process.cwd(), "self-staged.txt"))).toBe(false);
    expect(execFileSync("git", ["ls-files", "self-staged.txt"], { encoding: "utf8" }).trim()).toBe("self-staged.txt");
    // …and durably in the transcript.
    expect(strip(String(e(ed, "(buffer-text)").value))).toContain("note: 1 path(s) still staged with the content the action left");
  });

  // Codex gate round 3 (P0): the action ran its own `git add` for an
  // UNRELATED path, then the user staged the file it created. The
  // user's entry must survive the revert of that action.
  tt("a MIXED action: the user's staging of another added path survives", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "mixed staging")');
    call(ed, 517, "printf 'x\\n' >> base.txt && git add base.txt && touch victim.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    execFileSync("git", ["add", "victim.txt"]);
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    const status = String(e(ed, "(editor-status)").value);
    expect(status).toContain("action reverted");
    expect(status).toContain("still staged");
    expect(existsSync(join(process.cwd(), "victim.txt"))).toBe(false);
    expect(execFileSync("git", ["show", ":victim.txt"], { encoding: "utf8" })).toBe("");
    expect(execFileSync("git", ["ls-files", "victim.txt"], { encoding: "utf8" }).trim()).toBe("victim.txt");
    // The worktree is back to the pre-action content.
    expect(readFileSync(join(process.cwd(), "base.txt"), "utf8")).toBe("base\n");
  });

  // Kind and mode are part of a path's state: a symlink the user
  // replaced with a file holding its target text is not "unchanged".
  tt("a symlink the user replaced with a FILE is refused (and survives)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "link it")');
    call(ed, 512, "ln -s base.txt kind.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    execFileSync("rm", ["kind.txt"]);
    writeFileSync(join(process.cwd(), "kind.txt"), "base.txt");
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("REFUSED");
    expect(worktreeIsLink("kind.txt")).toBe(false);
    expect(readFileSync(join(process.cwd(), "kind.txt"), "utf8")).toBe("base.txt");
  });

  tt("a later chmod +x is neither reset nor clobbered — the revert refuses", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "append to it")');
    call(ed, 513, "printf 'more\\n' >> base.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    execFileSync("chmod", ["+x", "base.txt"]);
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("REFUSED");
    expect(fileMode("base.txt")).toBe("100755");
    expect(readFileSync(join(process.cwd(), "base.txt"), "utf8")).toBe("base\nmore\n");
  });

  tt("a MODE-ONLY action is checkpointed and reverts", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "make it runnable")');
    call(ed, 514, "chmod +x base.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    expect(fileMode("base.txt")).toBe("100755");
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
    expect(fileMode("base.txt")).toBe("100644");
    expect(readFileSync(join(process.cwd(), "base.txt"), "utf8")).toBe("base\n");
  });

  // git C-quotes such names in its line output; the revert used to pass
  // the quoted text as a filename and abort.
  tt("a path with a quote and a space reverts", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "odd name")');
    call(ed, 515, "touch 'quote\" and space.txt'");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    expect(existsSync(join(process.cwd(), 'quote" and space.txt'))).toBe(true);
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
    expect(existsSync(join(process.cwd(), 'quote" and space.txt'))).toBe(false);
  });

  // The snapshot's view excludes ignored paths (so does every other
  // checkpoint in the editor). A write to one is REPORTED — a mutation
  // without its checkpoint is never silent.
  tt("a write to an IGNORED path is reported as outside the checkpoint", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), ".gitignore"), ".tmax/\n.env\n");
    execFileSync("git", ["add", ".gitignore"]);
    execFileSync("git", ["commit", "-qm", "ignore env"]);
    e(ed, '(fikra/chat/fikra-turn-send "write the env")');
    const before = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    call(ed, 516, "cp base.txt .env");
    const mid = strip(await until(ed, "(buffer-text)", "cannot hold", 120));
    expect(mid.split("\n").filter((l) => l.includes("1 path(s) the checkpoint cannot hold changed — not revertable: .env")).length).toBe(1);
    expect(String(e(ed, "(editor-status)").value)).toContain("outside the checkpoint");
    expect(existsSync(join(process.cwd(), ".env"))).toBe(true);
    expect(actionRefs()).toEqual([]);
    await settleRefireFrom(ed, before, "written");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
  });

  // Codex gate round 3: the NUL stream was joined back onto newlines —
  // a name that CONTAINS a newline could not revert.
  tt("a path containing a NEWLINE reverts", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "odd newline")');
    // (A `$( )` in the command parks at the L2 gate — a literal newline
    // inside single quotes does not.)
    call(ed, 518, "touch 'line\nbreak'");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    expect(existsSync(join(process.cwd(), "line\nbreak"))).toBe(true);
    // …and it is CHECKPOINTED: no false "cannot hold" warning for the two
    // halves of the name (the scan's list is NUL-separated now).
    expect(strip(String(e(ed, "(buffer-text)").value))).not.toContain("cannot hold");
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
    expect(existsSync(join(process.cwd(), "line\nbreak"))).toBe(false);
  });

  // Codex gate round 4 (P1): a new file inside an EXISTING ignored
  // directory, with a preserved timestamp — the collapsed listing did not
  // change and the modification-time scan saw nothing. The scan now keys
  // on status-change time, which `cp -p` cannot preserve.
  tt("a preserved-timestamp write INSIDE an existing ignored directory is reported", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), ".gitignore"), ".tmax/\ncache/\n");
    execFileSync("git", ["add", ".gitignore"]);
    execFileSync("git", ["commit", "-qm", "ignore cache"]);
    mkdirSync(join(process.cwd(), "cache"));
    execFileSync("touch", ["-t", "202001010000", "old-source.txt"]);
    e(ed, '(fikra/chat/fikra-turn-send "copy into the cache")');
    const before = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    call(ed, 522, "cp -p old-source.txt cache/new");
    const mid = strip(await until(ed, "(buffer-text)", "cannot hold", 120));
    expect(mid.split("\n").filter((l) => l.includes("not revertable: cache/new")).length).toBe(1);
    expect(actionRefs()).toEqual([]);
    await settleRefireFrom(ed, before, "copied");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
  });

  // Codex gate round 4 (P0): the user stages the action's RESULT; the
  // revert restores the worktree but the index still holds what the
  // action wrote — a later commit would silently bring it back. The
  // status and the transcript must say so.
  tt("a staged MODIFICATION left behind by a revert is announced (status AND transcript)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "append to it")');
    call(ed, 523, "printf 'more\\n' >> base.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    execFileSync("git", ["add", "base.txt"]);
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    const status = String(e(ed, "(editor-status)").value);
    expect(status).toContain("action reverted");
    expect(status).toContain("1 path(s) still staged: a commit would record the action's content (review: git diff --cached)");
    expect(readFileSync(join(process.cwd(), "base.txt"), "utf8")).toBe("base\n");
    expect(execFileSync("git", ["show", ":base.txt"], { encoding: "utf8" })).toBe("base\nmore\n");
    expect(strip(String(e(ed, "(buffer-text)").value)).replace(/\n/g, " ")).toContain("note: 1 path(s) still staged with the content the action left");
  });

  // The mirror image: an UNTRACKED path restored by the revert is not
  // staging — nothing is announced.
  tt("an untracked path restored by a revert raises no staged note", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "append to an untracked file")');
    execFileSync("touch", ["fresh.txt"]);
    call(ed, 524, "printf 'more\\n' >> fresh.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    const status = String(e(ed, "(editor-status)").value);
    expect(status).toContain("action reverted");
    expect(status).not.toContain("staged");
    expect(readFileSync(join(process.cwd(), "fresh.txt"), "utf8")).toBe("");
  });

  // Codex gate round 4 (P1): a never-landed build wrote an optional
  // " ix" token on the durable pair line; the loader took it for part of
  // the pre-ref and the pair was lost on reload.
  tt("a durable pair line carrying the old ix token still reverts after a reload", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "make a file")');
    call(ed, 525, "touch ix-suffix.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    const pairs = join(process.cwd(), ".tmax", "fikra", "threads", "main", "actions.jsonl");
    writeFileSync(pairs, readFileSync(pairs, "utf8").trimEnd() + " ix\n");
    // A restart: the in-memory pairs and stack are gone; the file is all.
    e(ed, "(fikra/backend-ollama/fikra-ollama-action-state-reset)");
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
    expect(existsSync(join(process.cwd(), "ix-suffix.txt"))).toBe(false);
  });

  // Codex gate round 3: `cp -p` keeps the old timestamp — invisible to
  // the modification-time scan. Ignored entries that APPEAR are caught
  // by a listing taken before and after the command.
  tt("an ignored write that KEEPS its old timestamp is still reported", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), ".gitignore"), ".tmax/\n.env\n");
    execFileSync("git", ["add", ".gitignore"]);
    execFileSync("git", ["commit", "-qm", "ignore env"]);
    execFileSync("touch", ["-t", "202001010000", "old-source.txt"]);
    e(ed, '(fikra/chat/fikra-turn-send "copy preserving time")');
    const before = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    call(ed, 519, "cp -p old-source.txt .env");
    const mid = strip(await until(ed, "(buffer-text)", "cannot hold", 120));
    expect(mid.split("\n").filter((l) => l.includes("not revertable: .env")).length).toBe(1);
    expect(String(e(ed, "(editor-status)").value)).toContain("outside the checkpoint");
    expect(actionRefs()).toEqual([]);
    await settleRefireFrom(ed, before, "copied");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
  });

  // Codex gate round 3: with `.tmax` NOT ignored, the glob exclude
  // matched the directory entry but not its contents — the thread's own
  // indexes, locks and logs entered the snapshots.
  tt("an UNIGNORED .tmax never enters a snapshot — but a user's file named .tmax does", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), ".gitignore"), "node_modules/\n");
    execFileSync("git", ["add", ".gitignore"]);
    execFileSync("git", ["commit", "-qm", "tmax not ignored"]);
    e(ed, '(fikra/chat/fikra-turn-send "two files")');
    call(ed, 520, "touch plain.txt user-tmax-file.tmp && mkdir -p tools && mv user-tmax-file.tmp tools/.tmax");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    const post = actionRefs()[1]!;
    const tree = execFileSync("git", ["ls-tree", "-r", "--name-only", post], { encoding: "utf8" }).trim().split("\n");
    expect(tree.filter((p) => p.startsWith(".tmax/"))).toEqual([]);
    expect(tree).toContain("plain.txt");
    // A regular file NAMED .tmax below the root is the user's — kept.
    expect(tree).toContain("tools/.tmax");
    expect(existsSync(join(process.cwd(), ".tmax", "fikra", "ckpt-index-main"))).toBe(true);
    // r156: the mode listings live under that unignored .tmax too — their
    // own coming and going is never a "cannot hold" row.
    expect(logText(ed)).not.toContain("cannot hold");
    expect(existsSync(join(process.cwd(), ".tmax", "fikra", "ckpt-modes-main"))).toBe(false);
    expect(existsSync(join(process.cwd(), ".tmax", "fikra", "ckpt-modes-after-main"))).toBe(false);
  });

  // Codex gate round 3: with core.fileMode=false git records every file
  // as non-executable; a pre-existing executable bit read as divergence.
  tt("with core.fileMode=false an executable file's content action still reverts", async () => {
    const ed = await armed();
    execFileSync("git", ["config", "core.fileMode", "false"]);
    execFileSync("chmod", ["+x", "base.txt"]);
    e(ed, '(fikra/chat/fikra-turn-send "append to it")');
    call(ed, 521, "printf 'more\\n' >> base.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
    expect(readFileSync(join(process.cwd(), "base.txt"), "utf8")).toBe("base\n");
    expect(fileMode("base.txt")).toBe("100755");
  });

  // Codex gate round 5 (P2): a timestamp-only command reported its file
  // as "cannot hold". The report meant "changed but absent from the
  // pre→post diff" — which is every file a command merely TOUCHES.
  tt("`touch` on a tracked file is not reported — it changed nothing a checkpoint holds (r155f)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "freshen the stamp")');
    call(ed, 530, "touch base.txt");
    // The sentinel does its work — the result row, the checkpoint step —
    // BEFORE it re-fires: "a request newer than the seeded one" is the
    // signal that the step ran. (The PRE-call id must not be passed to
    // settleRefireFrom here: the seeded call itself already differs from
    // it, the turn ends before the child exits, and the test passes
    // vacuously — this test's first version did, on the old source too.)
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    expect(seeded).toBe("530");
    await settleRefireFrom(ed, seeded, "touched");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
    expect(strip(String(e(ed, "(buffer-text)").value))).not.toContain("cannot hold");
    expect(actionRefs()).toEqual([]);
    expect(logText(ed)).not.toContain('"kind":"checkpoint-error"');
    // …and the child's marker was consumed by that step.
    expect(existsSync(join(process.cwd(), ".tmax", "fikra", "ckpt-trees-main"))).toBe(false);
  });

  // Codex gate round 5 (P2): the staged note fired for an index equal to
  // HEAD — nothing was staged. The action ran `git restore` over an
  // unstaged edit; the revert brought the edit back and `git diff
  // --cached` was empty.
  tt("an action that undid an UNSTAGED edit reverts with NO staged note (r155f)", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "base.txt"), "user edit\n");
    e(ed, '(fikra/chat/fikra-turn-send "restore it")');
    call(ed, 531, "git restore base.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    expect(readFileSync(join(process.cwd(), "base.txt"), "utf8")).toBe("base\n");
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    const status = String(e(ed, "(editor-status)").value);
    expect(status).toContain("action reverted");
    expect(status).not.toContain("staged");
    expect(readFileSync(join(process.cwd(), "base.txt"), "utf8")).toBe("user edit\n");
    expect(execFileSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8" }).trim()).toBe("");
    expect(strip(String(e(ed, "(buffer-text)").value))).not.toContain("still staged");
  });

  // Codex gate round 5 (P1): the staged content may be the USER's own
  // earlier staging. S staged, the worktree edited to U, an action copies
  // S into the file: the revert restores U and the index still holds S.
  // The note used to say "their worktree files are gone; unstage to drop
  // them for good" — following it discards the user's staged work.
  tt("a staged version that was the USER's before the action is announced WITHOUT an instruction (r155f)", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "base.txt"), "S\n");
    execFileSync("git", ["add", "base.txt"]);
    writeFileSync(join(process.cwd(), "base.txt"), "U\n");
    writeFileSync(join(process.cwd(), "s-copy.txt"), "S\n");
    e(ed, '(fikra/chat/fikra-turn-send "copy the staged version")');
    call(ed, 532, "cp s-copy.txt base.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    const status = String(e(ed, "(editor-status)").value);
    expect(status).toContain("action reverted");
    // The consequence and the review command — never what to do.
    expect(status).toContain("git diff --cached");
    expect(status).not.toMatch(/unstage|drop them for good|files are gone/i);
    // The user's staged version AND the restored worktree file survive.
    expect(execFileSync("git", ["show", ":base.txt"], { encoding: "utf8" })).toBe("S\n");
    expect(readFileSync(join(process.cwd(), "base.txt"), "utf8")).toBe("U\n");
    const text = strip(String(e(ed, "(buffer-text)").value)).replace(/\n/g, " ");
    expect(text).toContain("note: 1 path(s) still staged with the content the action left");
    expect(text).not.toMatch(/unstage|drop them for good|files are gone/i);
  });

  // Codex gate round 5 (P2): "whatever it leaves staged is announced"
  // was broader than the behavior — and than what is true. The user
  // staged S and the worktree held S; the action edited the file; the
  // revert restores S. Index and worktree agree again: the user's own
  // staging, intact and consistent — nothing to announce.
  tt("the user's own staging that matches the restored file raises NO staged note (r155f)", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "base.txt"), "S\n");
    execFileSync("git", ["add", "base.txt"]);
    e(ed, '(fikra/chat/fikra-turn-send "append to it")');
    call(ed, 533, "printf 'more\\n' >> base.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    const status = String(e(ed, "(editor-status)").value);
    expect(status).toContain("action reverted");
    expect(status).not.toContain("staged");
    expect(readFileSync(join(process.cwd(), "base.txt"), "utf8")).toBe("S\n");
    expect(execFileSync("git", ["show", ":base.txt"], { encoding: "utf8" })).toBe("S\n");
    expect(strip(String(e(ed, "(buffer-text)").value))).not.toContain("still staged");
    // The snapshots wrote new objects under .git/objects/ after the
    // stamp: git's own state is never a path "the checkpoint cannot hold".
    expect(logText(ed)).not.toContain("cannot hold");
  });

  // r155f: OUTSIDE means "in NEITHER snapshot's tree". A write inside a
  // nested repository is such a path (the parent's tree holds only the
  // gitlink) — reported exactly like an ignored one.
  // …and NOTHING else is: the snapshot's own `git add -A` rewrites the
  // nested repo's index, which the scan used to list beside it.
  tt("a write INSIDE a nested repository is reported as outside the checkpoint — and only that write (r155f)", async () => {
    const ed = await armed();
    const nested = join(process.cwd(), "nested");
    mkdirSync(nested);
    execFileSync("git", ["init", "-q"], { cwd: nested });
    writeFileSync(join(nested, "inner.txt"), "inner\n");
    execFileSync("git", ["add", "-A"], { cwd: nested });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: nested });
    e(ed, '(fikra/chat/fikra-turn-send "append inside the nested repo")');
    call(ed, 534, "printf 'more\\n' >> nested/inner.txt");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    await until(ed, "(buffer-text)", "cannot hold", 120);
    const rows = logText(ed).split("\n").filter((l) => l.includes("checkpoint-error"));
    expect(rows).toHaveLength(1);
    // One path, exactly — no second entry, no separator after the last
    // (the row used to read "… nested/inner.txt, nested/.git/index, ").
    expect(rows[0]).toContain('"reason":"1 path(s) the checkpoint cannot hold changed — not revertable: nested/inner.txt"');
    expect(actionRefs()).toEqual([]);
    await settleRefireFrom(ed, seeded, "appended");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
  });

  // ── r156: what the trees hold the PATH of but cannot RECORD ──────────
  // Codex gate round 6 left two P2s. A permission change on a tracked file
  // was no longer reported — a REPORTING REGRESSION from r155f's "neither
  // tree" rule (it used to be reported, by accident, as "not in the
  // diff") — and a retargeted ignored symlink never was (the scan was
  // `-type f`). The child lists "mode:uid:gid<TAB>path" for the
  // snapshot's files before and after the command; a path whose line
  // changed is reported unless the tree diff already covers it. A RECORD,
  // not a timestamp rule: the first cut inferred the change from ctime,
  // which floods on Linux (a no-op chmod moves the ctime there) and
  // misses a chmod after a touch everywhere.
  const errorRows = (ed: Editor) => logText(ed).split("\n").filter((l) => l.includes("checkpoint-error"));

  tt("`chmod 600` on a TRACKED file is reported — git records the executable bit and nothing else (r156)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "lock it down")');
    call(ed, 540, "chmod 600 base.txt");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    await until(ed, "(buffer-text)", "cannot hold", 120);
    expect(errorRows(ed)).toEqual([
      expect.stringContaining('"reason":"1 path(s) the checkpoint cannot hold changed — not revertable: base.txt"'),
    ]);
    expect(String(e(ed, "(editor-status)").value)).toContain("outside the checkpoint");
    // The change is real, and it is all that happened.
    expect(statSync(join(process.cwd(), "base.txt")).mode & 0o777).toBe(0o600);
    expect(actionRefs()).toEqual([]);
    await settleRefireFrom(ed, seeded, "locked");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
  });

  tt("`chmod 644` on a private file is reported too — the checkpoint cannot put the restriction back (r156)", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "secret.txt"), "s3cret\n");
    execFileSync("git", ["add", "secret.txt"]);
    execFileSync("git", ["commit", "-qm", "add secret"]);
    execFileSync("chmod", ["600", "secret.txt"]);
    e(ed, '(fikra/chat/fikra-turn-send "open it up")');
    call(ed, 541, "chmod 644 secret.txt");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    await until(ed, "(buffer-text)", "cannot hold", 120);
    expect(errorRows(ed)).toEqual([
      expect.stringContaining('not revertable: secret.txt"'),
    ]);
    expect(actionRefs()).toEqual([]);
    await settleRefireFrom(ed, seeded, "opened");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
  });

  // …and only the uncovered one. The executable bit IS a tree entry: that
  // change is checkpointed and says nothing.
  tt("a representable mode change in the same call is checkpointed and NOT reported — the other one is named alone (r156)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "two mode changes")');
    call(ed, 542, "chmod 600 base.txt && chmod +x .gitignore");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    expect(errorRows(ed)).toEqual([
      expect.stringContaining('"reason":"1 path(s) the checkpoint cannot hold changed — not revertable: base.txt"'),
    ]);
    expect(actionRefs()).toEqual(["refs/fikra/main/1-a1", "refs/fikra/main/1-a2"]);
  });

  // A new file appears in the after-listing only — the tree diff covers it.
  tt("a new file with a PRESERVED mtime is covered by its content — not reported (r156)", async () => {
    const ed = await armed();
    execFileSync("touch", ["-t", "202001010000", "old-source.txt"]);
    e(ed, '(fikra/chat/fikra-turn-send "copy it")');
    call(ed, 543, "cp -p old-source.txt kept-time.txt");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    expect(logText(ed)).not.toContain("cannot hold");
    expect(actionRefs()).toEqual(["refs/fikra/main/1-a1", "refs/fikra/main/1-a2"]);
  });

  // r155d made an executable-bit action REVERTABLE under
  // core.fileMode=false only for a content change; the bit alone was a
  // declared silence. It is reported now.
  tt("with core.fileMode=false an executable-bit change is reported — git will not record it (r156)", async () => {
    const ed = await armed();
    execFileSync("git", ["config", "core.fileMode", "false"]);
    e(ed, '(fikra/chat/fikra-turn-send "make it runnable")');
    call(ed, 544, "chmod +x base.txt");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    await until(ed, "(buffer-text)", "cannot hold", 120);
    expect(errorRows(ed)).toEqual([
      expect.stringContaining('not revertable: base.txt"'),
    ]);
    expect(actionRefs()).toEqual([]);
    await settleRefireFrom(ed, seeded, "runnable");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
  });

  tt("a retargeted IGNORED symlink is reported — the scan sees every non-directory entry (r156)", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), ".gitignore"), ".tmax/\ncache/\n");
    execFileSync("git", ["add", ".gitignore"]);
    execFileSync("git", ["commit", "-qm", "ignore cache"]);
    mkdirSync(join(process.cwd(), "cache"));
    execFileSync("ln", ["-s", "base.txt", "cache/link"]);
    e(ed, '(fikra/chat/fikra-turn-send "retarget the cache link")');
    call(ed, 545, "ln -sfn .gitignore cache/link");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    await until(ed, "(buffer-text)", "cannot hold", 120);
    expect(errorRows(ed)).toEqual([
      expect.stringContaining('"reason":"1 path(s) the checkpoint cannot hold changed — not revertable: cache/link"'),
    ]);
    // The link really moved (readlink ends its output with a newline).
    expect(execFileSync("readlink", ["cache/link"], { encoding: "utf8" }).trim()).toBe(".gitignore");
    expect(actionRefs()).toEqual([]);
    await settleRefireFrom(ed, seeded, "retargeted");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
  });

  // A TRACKED link's target text is its content: retargeting it is an
  // ordinary, revertable change.
  tt("a retargeted TRACKED symlink is checkpointed and reverts — not reported (r156)", async () => {
    const ed = await armed();
    execFileSync("ln", ["-s", "base.txt", "trk-link"]);
    execFileSync("git", ["add", "trk-link"]);
    execFileSync("git", ["commit", "-qm", "add link"]);
    e(ed, '(fikra/chat/fikra-turn-send "retarget the tracked link")');
    call(ed, 546, "ln -sfn .gitignore trk-link");
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    expect(logText(ed)).not.toContain("cannot hold");
    expect(actionRefs()).toEqual(["refs/fikra/main/1-a1", "refs/fikra/main/1-a2"]);
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
    expect(execFileSync("readlink", ["trk-link"], { encoding: "utf8" }).trim()).toBe("base.txt");
  });

  // Codex gate r156 round 1 (P2): a touch earlier in the same call hid a
  // later chmod from a timestamp rule. A record of the modes cannot be
  // hidden by one.
  tt("a chmod AFTER a touch in the same call is reported (r156)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "freshen and lock")');
    call(ed, 547, "touch base.txt && chmod 600 base.txt");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    await until(ed, "(buffer-text)", "cannot hold", 120);
    expect(errorRows(ed)).toEqual([
      expect.stringContaining('"reason":"1 path(s) the checkpoint cannot hold changed — not revertable: base.txt"'),
    ]);
    expect(statSync(join(process.cwd(), "base.txt")).mode & 0o777).toBe(0o600);
    expect(actionRefs()).toEqual([]);
    await settleRefireFrom(ed, seeded, "locked");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
  });

  // The Linux flood, pinned where it can be seen: `chmod` moves a file's
  // ctime on Linux even when the mode is unchanged, so a ctime rule
  // reports a whole tree after `chmod -R`. Nothing changed here.
  tt("a chmod that changes NOTHING is not reported (r156)", async () => {
    const ed = await armed();
    mkdirSync(join(process.cwd(), "sub"));
    writeFileSync(join(process.cwd(), "sub", "a.txt"), "a\n");
    writeFileSync(join(process.cwd(), "sub", "b.txt"), "b\n");
    e(ed, '(fikra/chat/fikra-turn-send "normalize permissions")');
    call(ed, 548, "chmod 644 sub/a.txt sub/b.txt base.txt .gitignore");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    expect(seeded).toBe("548");
    await settleRefireFrom(ed, seeded, "normalized");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
    expect(logText(ed)).not.toContain("cannot hold");
    expect(actionRefs()).toEqual([]);
  });

  // A path may begin or end with a space: pin that the report carries the
  // exact name. (The listing used to be read through a string-trim of the
  // WHOLE text — harmless only because a changed path is listed twice and
  // the trim touched just the last line.)
  tt("a chmod on a file whose name ENDS WITH A SPACE is reported under that exact name (r156)", async () => {
    const ed = await armed();
    execFileSync("touch", ["spaced "]);
    e(ed, '(fikra/chat/fikra-turn-send "lock the oddly named one")');
    call(ed, 550, "chmod 600 'spaced '");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    expect(seeded).toBe("550");
    await settleRefireFrom(ed, seeded, "locked");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
    expect(errorRows(ed)).toEqual([
      expect.stringContaining('"reason":"1 path(s) the checkpoint cannot hold changed — not revertable: spaced "'),
    ]);
    expect(actionRefs()).toEqual([]);
  });

  // Codex gate r156 round 2 (P2, reproduced): with both `innocent` and
  // `innocent⏎other` present, a chmod of the latter was reported against
  // `innocent` — the line-based mode listing split the name, and the piece
  // named a real file. The table is keyed by inode and carries no name;
  // the name comes from `find -print0`, whole.
  tt("a chmod on a file whose name contains a NEWLINE is reported under that exact name — not against its first line (r156)", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "innocent"), "decoy\n");
    writeFileSync(join(process.cwd(), "innocent\nother"), "odd\n");
    e(ed, '(fikra/chat/fikra-turn-send "lock the oddly named one")');
    call(ed, 551, "touch innocent && chmod 600 'innocent\nother'");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    expect(seeded).toBe("551");
    await until(ed, "(buffer-text)", "cannot hold", 120);
    // One path, the whole name (a newline is escaped in the log's JSON) —
    // and the decoy that was merely touched is not named.
    expect(errorRows(ed)).toEqual([
      expect.stringContaining('"reason":"1 path(s) the checkpoint cannot hold changed — not revertable: innocent\\nother"'),
    ]);
    expect(actionRefs()).toEqual([]);
    await settleRefireFrom(ed, seeded, "locked");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
  });

  // Codex gate r156 round 2 (P2, reproduced): a name beginning with a dash
  // made the batched `stat` fail — "illegal option" — and the whole table
  // was lost with it. `--` ends the options.
  tt("a chmod on a file whose name BEGINS WITH A DASH is reported — and the table survives it (r156)", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "-dash"), "dash\n");
    e(ed, '(fikra/chat/fikra-turn-send "two mode changes, odd names")');
    call(ed, 552, "chmod 600 ./-dash && chmod 600 base.txt");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    expect(seeded).toBe("552");
    await until(ed, "(buffer-text)", "cannot hold", 120);
    expect(errorRows(ed)).toHaveLength(1);
    // Both — the dash name did not cost the ordinary one its entry.
    expect(errorRows(ed)[0]).toContain('"reason":"2 path(s) the checkpoint cannot hold changed — not revertable: ');
    expect(errorRows(ed)[0]).toContain("-dash");
    expect(errorRows(ed)[0]).toContain("base.txt");
    expect(actionRefs()).toEqual([]);
    await settleRefireFrom(ed, seeded, "locked");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
  });

  // Codex gate r156 round 2 (reading-only P2): the META marker stayed in
  // place when the scan found nothing, so a command could write it itself
  // and name any existing file. It is removed AFTER the command now and
  // written only by the checkpoint's own code.
  tt("a marker the COMMAND plants is never read (r156)", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "plant.txt"), "base.txt\n");
    e(ed, '(fikra/chat/fikra-turn-send "plant one")');
    call(ed, 553, "cp plant.txt .tmax/fikra/ckpt-meta-main");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    expect(seeded).toBe("553");
    await settleRefireFrom(ed, seeded, "planted");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
    expect(errorRows(ed)).toEqual([]);
    expect(actionRefs()).toEqual([]);
  });

  // Codex gate r156 round 3 (P2, reproduced): an inode with more than 100
  // hard links put one tuple per PATH into the join — 105 copies of that
  // inode filled the cap and every OTHER change went unreported.
  tt("a hard-linked inode with 105 links cannot crowd another change out of the report (r156)", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "target"), "t\n");
    for (let i = 0; i < 105; i++) execFileSync("ln", ["target", `h${i}`]);
    e(ed, '(fikra/chat/fikra-turn-send "two mode changes, one very shared")');
    call(ed, 554, "chmod 600 target && chmod 600 base.txt");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    expect(seeded).toBe("554");
    await until(ed, "(buffer-text)", "cannot hold", 120);
    // The row shows only three names; the COUNT proves both inodes were
    // named: all 106 paths of the shared inode plus base.txt.
    expect(errorRows(ed)).toHaveLength(1);
    expect(errorRows(ed)[0]).toContain('"reason":"107 path(s) the checkpoint cannot hold changed — not revertable: ');
    expect(actionRefs()).toEqual([]);
    await settleRefireFrom(ed, seeded, "locked");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
  });

  // Codex gate r156 round 4 (P2): my limit said no path under .tmax (root
  // or nested) is named. Untrue twice over — the walk excluded only the
  // ROOT .tmax, and more basically: a hard-linked inode shares one ctime,
  // so every alias is scanned, and an alias under a nested .tmax lies in
  // NO tree — the first pass reports it, correctly, because its mode
  // really did change and no checkpoint holds that path. The walk now
  // excludes .tmax at any depth; this pins the true behaviour.
  tt("a hard link under a NESTED .tmax shares the inode's change — reported as a path no tree holds (r156)", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "target"), "t\n");
    mkdirSync(join(process.cwd(), "nested", ".tmax"), { recursive: true });
    execFileSync("ln", ["target", "nested/.tmax/alias"]);
    e(ed, '(fikra/chat/fikra-turn-send "lock it")');
    call(ed, 555, "chmod 600 target && chmod 600 base.txt");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    expect(seeded).toBe("555");
    await until(ed, "(buffer-text)", "cannot hold", 120);
    expect(errorRows(ed)).toEqual([
      expect.stringContaining('"reason":"3 path(s) the checkpoint cannot hold changed — not revertable: '),
    ]);
    expect(errorRows(ed)[0]).toContain("nested/.tmax/alias");
    expect(errorRows(ed)[0]).toContain("target");
    expect(errorRows(ed)[0]).toContain("base.txt");
    expect(actionRefs()).toEqual([]);
    await settleRefireFrom(ed, seeded, "locked");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
  });

  // …nor a rewrite that leaves everything as it was, mtime included.
  tt("a preserved-mtime copy over an IDENTICAL tracked file is not reported (r156)", async () => {
    const ed = await armed();
    writeFileSync(join(process.cwd(), "same.txt"), "base\n");
    execFileSync("git", ["add", "same.txt"]);
    execFileSync("git", ["commit", "-qm", "add same"]);
    e(ed, '(fikra/chat/fikra-turn-send "refresh the copy")');
    call(ed, 549, "cp -p base.txt same.txt");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    expect(seeded).toBe("549");
    await settleRefireFrom(ed, seeded, "refreshed");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
    expect(logText(ed)).not.toContain("cannot hold");
    expect(actionRefs()).toEqual([]);
  });

  // ── r157: ACTION IDENTITY (the 8.1 re-grade's reproduced P1) ─────────
  // Two buffer_edit calls in ONE turn: each action captures a pre and a
  // post ref (1-a1..1-a4), and the pre-capture's marker fires BEFORE the
  // ⚙ row exists. The proximity merge labeled the first row with the
  // SECOND action's pre (1-a3), the second row with the turn's completion
  // ref, and left 1-a1 standalone. The identity pass attaches each row's
  // OWN post ref by the "act" id minted at the row.
  tt("two edits in one turn: each row carries its OWN post ref (r157)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "two edits")');
    const edit = (path: string, content: string) => ({ function: { name: "buffer_edit", arguments: { path, content } } });
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed 700 "live")`);
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 700 "${hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [edit("a157.txt", "A\n"), edit("b157.txt", "B\n")] } }))}")`);
    e(ed, `(fikra-http-complete 700 200 "${hex("{}")}")`);
    await until(ed, "(buffer-text)", "[ckpt main/1-a4", 120);
    await settleRefireFrom(ed, "700", "Done.");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
    const pairs = String(e(ed, '(shell-command "cat .tmax/fikra/threads/main/actions.jsonl")').value).trim().split("\n");
    // The pairs name the posts: pair 1 → 1-a2, pair 2 → 1-a4.
    expect(pairs.length).toBe(2);
    expect(pairs[0]!.startsWith("refs/fikra/main/1-a2 refs/fikra/main/1-a1")).toBe(true);
    expect(pairs[1]!.startsWith("refs/fikra/main/1-a4 refs/fikra/main/1-a3")).toBe(true);
    const buf = strip(String(e(ed, "(buffer-text)").value));
    const rows = buf.split("\n").filter((l) => l.includes("buffer-edit"));
    expect(rows).toHaveLength(2);
    // Each ⚙ row carries its OWN post ref — a2 on the first, a4 on the
    // second — and neither row claims another action's ref.
    expect(rows[0]).toContain("[ckpt main/1-a2 ✓]");
    expect(rows[0]).not.toContain("1-a3");
    expect(rows[0]).not.toContain("[ckpt main/1 ✓]");
    expect(rows[1]).toContain("[ckpt main/1-a4 ✓]");
    expect(rows[1]).not.toContain("[ckpt main/1 ✓]");
    // The pre markers (a1/a3) no longer stand alone either.
    expect(buf).not.toContain("[ckpt main/1-a1 ✓]");
    expect(buf).not.toContain("[ckpt main/1-a3 ✓]");
    // The turn's completion marker still stands alone (no act id).
    expect(buf).toContain("[ckpt main/1 ✓]");
  });

  // FOR_9 item 2: next-step guidance after a mutating turn — editor-side,
  // independent of model wording; the model's reply above is just "Done."
  tt("a turn that sealed actions ends with the diff/revert keys and the coverage (r157)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "two edits, terse reply")');
    const edit = (path: string, content: string) => ({ function: { name: "buffer_edit", arguments: { path, content } } });
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed 710 "live")`);
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 710 "${hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [edit("g157.txt", "G\n")] } }))}")`);
    e(ed, `(fikra-http-complete 710 200 "${hex("{}")}")`);
    await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
    await settleRefireFrom(ed, "710", "Done.");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
    const buf = strip(String(e(ed, "(buffer-text)").value));
    const hints = buf.split("\n").filter((l) => l.includes("action(s) checkpointed"));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("1 action(s) checkpointed this turn");
    expect(hints[0]).toContain("SPC a d diff");
    expect(hints[0]).toContain("SPC a R revert the turn");
    expect(hints[0]).toContain("SPC a C-r revert the last action");
    // The coverage boundary is honest (r158: the trees also cannot hold
    // nested-repository contents or permission metadata).
    expect(hints[0]).toContain("holds the worktree under ");
    expect(hints[0]).toContain("ignored paths, nested repositories, permission changes, and outside-root writes are NOT held");
  });

  // The read-only mirror: a turn that seals NOTHING carries no guidance.
  tt("a read-only turn ends with NO guidance row (r157)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "just look")');
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed 720 "live")`);
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 720 "${hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "bash", arguments: { command: "echo just-looking" } } }] } }))}")`);
    e(ed, `(fikra-http-complete 720 200 "${hex("{}")}")`);
    await settleRefireFrom(ed, "720", "seen");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
    expect(strip(String(e(ed, "(buffer-text)").value)).split("\n").filter((l) => l.includes("action(s) checkpointed"))).toEqual([]);
  });

  // Codex gate r154 round 5 (P2): the counters ran BEFORE the append — a
  // refused batch (held for a retry) counted every attempt.
  // ── r158: PER-ACTION COVERAGE HONESTY (the 8/10 re-grade's P1) ────────
  // An approved MEDIATED mutation the checkpoint's trees cannot hold (an
  // ignored path) rendered "[ckpt main/1-a2 ✓]" with no per-action
  // failure: the row implied a revertable action whose only change the
  // checkpoint cannot hold. The mediated command now runs the changed-
  // entry scan (the ordinary path's), the failure names the path, and
  // the marker is qualified — never an unqualified ✓ for an uncovered
  // mutation.
  tt("an approved ignored-path mutation does NOT claim a revertable checkpoint (r158)", async () => {
    const ed = await armed();
    // Append to the fixture's .gitignore (it excludes .tmax — clobbering
    // it would drag the checkpoint's own state into the mediated captures).
    const giPath = join(process.cwd(), ".gitignore");
    const gi = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
    writeFileSync(giPath, gi + (gi.length > 0 && !gi.endsWith("\n") ? "\n" : "") + ".env\n");
    writeFileSync(join(process.cwd(), ".env"), "SECRET-ENV");
    e(ed, '(fikra/chat/fikra-turn-send "remove the ignored file")');
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed 730 "live")`);
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 730 "${hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [{ function: { name: "bash", arguments: { command: "rm -rf .env" } } }] } }))}")`);
    e(ed, `(fikra-http-complete 730 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    await settleRefireFrom(ed, "730", "R158-DONE");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
    // The mutation happened, and the trees cannot hold it (the file is
    // ignored: both snapshot trees lack it).
    expect(String(e(ed, '(shell-command "test -f .env && echo EXISTS || echo GONE")').value).trim()).toBe("GONE");
    const buf = strip(String(e(ed, "(buffer-text)").value));
    const row = buf.split("\n").find((l) => l.includes("⚙ bash"));
    expect(row).toBeDefined();
    // No unqualified success marker: the row says the change is not
    // held, and the per-action failure names the path.
    expect(row!).not.toContain("✓]");
    expect(row!).toContain("not held");
    expect(buf).toContain("checkpoint-error");
    expect(buf).toContain(".env");
    // The pair IS recorded (r146's design: the skip lives at revert
    // time) — and reverting it is an honest no-op: nothing of this
    // action's change is revertable.
    e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
    expect(String(e(ed, "(editor-status)").value)).toContain("skipped");
  });

  // FOR_9 #2: every DISPLAYED action ref is verified against its git
  // tree — an edit and a mediated mutation in ONE turn; each row's ref
  // names the tree its own action produced.
  tt("mixed actions: each row's displayed ref matches its git tree (r158)", async () => {
    const ed = await armed();
    mkdirSync(join(process.cwd(), "b158dir"));
    writeFileSync(join(process.cwd(), "b158dir/inner.txt"), "INNER");
    e(ed, '(fikra/chat/fikra-turn-send "edit then remove a tracked dir")');
    const edit = { function: { name: "buffer_edit", arguments: { path: "a158.txt", content: "EDIT-CONTENT\n" } } };
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed 740 "live")`);
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 740 "${hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [edit, { function: { name: "bash", arguments: { command: "rm -rf b158dir/" } } }] } }))}")`);
    e(ed, `(fikra-http-complete 740 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    await settleRefireFrom(ed, "740", "R158-DONE");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
    const buf = strip(String(e(ed, "(buffer-text)").value));
    const editRow = buf.split("\n").find((l) => l.includes("buffer-edit"));
    const bashRow = buf.split("\n").find((l) => l.includes("⚙ bash"));
    expect(editRow).toBeDefined();
    expect(bashRow).toBeDefined();
    // Each row displays its own ref (identity, r157); the mediated
    // change IS held (a tracked dir), so its ✓ stands.
    expect(editRow).toContain("✓]");
    expect(bashRow).toContain("✓]");
    const editRef = /\[ckpt (main\/1-a\d+)/.exec(editRow!)?.[1];
    const bashRef = /\[ckpt (main\/1-a\d+)/.exec(bashRow!)?.[1];
    expect(editRef).toMatch(/^main\/1-a\d+$/);
    expect(bashRef).toMatch(/^main\/1-a\d+$/);
    expect(editRef).not.toBe(bashRef);
    // The edit's tree carries the edit; the bash's tree carries the
    // edit AND lacks the removed dir.
    expect(String(e(ed, `(shell-command "git show refs/fikra/${editRef}:a158.txt")`).value)).toContain("EDIT-CONTENT");
    const bashTree = String(e(ed, `(shell-command "git ls-tree -r --name-only refs/fikra/${bashRef}")`).value);
    expect(bashTree).toContain("a158.txt");
    expect(bashTree).not.toContain("b158dir/inner.txt");
  });

  // The 60 KB cap used to cut the scan's LAST path mid-name (the r156
  // declared limit): find -print0 always NUL-terminates a record, so a
  // file not ending in NUL lost a fragment — a partial path could name
  // a WRONG file. The scan's reader drops the fragment and says the cap
  // was hit.
  tt("the scan's byte cap drops a cut name and says so (r158)", async () => {
    const ed = await armed();
    const NUL = '(hex-decode "00")';
    // Complete records: every path arrives, no flag.
    expect(Number(e(ed, `(length (car (fikra/backend-ollama/fikra-ollama-scan-paths (concat "a.txt" ${NUL} "b.txt" ${NUL}) 60000)))`).value)).toBe(2);
    expect(String(e(ed, `(nth 0 (car (fikra/backend-ollama/fikra-ollama-scan-paths (concat "a.txt" ${NUL} "b.txt" ${NUL}) 60000)))`).value)).toBe("a.txt");
    expect(Number(e(ed, `(nth 1 (fikra/backend-ollama/fikra-ollama-scan-paths (concat "a.txt" ${NUL} "b.txt" ${NUL}) 60000))`).value)).toBe(0);
    // A cap cut mid-name: the fragment is DROPPED (a partial path must
    // never be reported) and the flag is set.
    expect(Number(e(ed, `(length (car (fikra/backend-ollama/fikra-ollama-scan-paths (concat "a.txt" ${NUL} "b.tx") 60000)))`).value)).toBe(1);
    expect(Number(e(ed, `(nth 1 (fikra/backend-ollama/fikra-ollama-scan-paths (concat "a.txt" ${NUL} "b.tx") 60000))`).value)).toBe(1);
    // Exactly AT the cap on a record boundary: complete records, but
    // whole records may have been lost beyond it — the flag is set.
    expect(Number(e(ed, `(nth 1 (fikra/backend-ollama/fikra-ollama-scan-paths (concat "abc" ${NUL}) 4))`).value)).toBe(1);
    expect(Number(e(ed, `(nth 1 (fikra/backend-ollama/fikra-ollama-scan-paths (concat "abc" ${NUL}) 5))`).value)).toBe(0);
  });

  // Gate round 1's reproduced P1: the report's 400-entry examination cap
  // gated the IGNORED-deletion entries too (they follow the scan's entries
  // in the combined changed-lines). 401 held entries touched by the same
  // command crowded the .env entry out — the row claimed an unqualified ✓
  // for a mutation the checkpoint cannot hold. The ignored entries are
  // examined in their OWN pass (they are the class the trees cannot hold
  // by construction) and can no longer be crowded out.
  // (A 90s budget: this one timed out at the uniform 20s in both r158 gate
  // full runs under load and passed solo every time.)
  test("a crowd of held changes cannot crowd out the ignored-deletion report (r158b)", async () => {
    const ed = await armed();
    const giPath = join(process.cwd(), ".gitignore");
    const gi = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
    writeFileSync(giPath, gi + (gi.length > 0 && !gi.endsWith("\n") ? "\n" : "") + ".env\n");
    writeFileSync(join(process.cwd(), ".env"), "SECRET-ENV");
    mkdirSync(join(process.cwd(), "bulk158"));
    for (let i = 0; i < 401; i++) writeFileSync(join(process.cwd(), `bulk158/f${i}.txt`), `B${i}\n`);
    e(ed, '(fikra/chat/fikra-turn-send "remove the ignored file among a crowd")');
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed 750 "live")`);
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 750 "${hex(JSON.stringify({ message: { role: "assistant", content: "",
      tool_calls: [{ function: { name: "bash", arguments: { command: "rm -rf .env; touch bulk158/*" } } }] } }))}")`);
    e(ed, `(fikra-http-complete 750 200 "${hex("{}")}")`);
    expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    await settleRefireFrom(ed, "750", "R158B-DONE");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
    expect(String(e(ed, '(shell-command "test -f .env && echo EXISTS || echo GONE")').value).trim()).toBe("GONE");
    const buf = strip(String(e(ed, "(buffer-text)").value));
    const row = buf.split("\n").find((l) => l.includes("⚙ bash"));
    expect(row).toBeDefined();
    // The ignored deletion is named even though the scan's 400-entry
    // examination cap was consumed by the held crowd.
    expect(row!).not.toContain("✓]");
    expect(row!).toContain("not held");
    expect(buf).toContain("checkpoint-error");
    expect(buf).toContain(".env");
  }, 90000);

  // Gate round 1's reproduced P2: the cap comparison counted T-Lisp
  // string units, the child's head -c counts BYTES — a capped scan ending
  // on a NUL boundary with non-ASCII names suppressed the flag.
  tt("the scan cap is counted in BYTES, not string units (r158b)", async () => {
    const ed = await armed();
    const NUL = '(hex-decode "00")';
    // éa + NUL is 4 UTF-8 bytes but 3 string units: a 4-BYTE cap is hit.
    expect(Number(e(ed, `(nth 1 (fikra/backend-ollama/fikra-ollama-scan-paths (concat "éa" ${NUL}) 4))`).value)).toBe(1);
    // One BYTE short of the cap (é + NUL is 3 bytes): no flag. (Gate
    // round 2's NIT: this probe used "a" + NUL — two bytes short.)
    expect(Number(e(ed, `(nth 1 (fikra/backend-ollama/fikra-ollama-scan-paths (concat "é" ${NUL}) 4))`).value)).toBe(0);
  });

  // ── r159: THE EXAMINATION CAP COUNTS CANDIDATES, NOT HELD ENTRIES ───
  // The r158 gate's round-2 reproduced limit: the report examined only
  // the first 400 entries of a class and HELD entries counted against
  // that bound — 401 held changes pushed a changed, scan-only outside
  // path past it, unexamined and unreported, with no cap warning.
  // Membership is a hash lookup now (the bound existed because each
  // entry was a scan of the held list), the bound is tenfold, and a hit
  // is no longer silent.
  test("a crowd of HELD entries cannot push an outside scan entry past the examination (r159)", async () => {
    const ed = await armed();
    const held = Array.from({ length: 401 }, (_, i) => `bulk159/f${i}.txt`);
    const scan = [...held.map((h) => `./${h}`), "./outside159/only.txt"];
    const expr = `(fikra/backend-ollama/fikra-ollama-outside-scan (list ${scan.map((x) => `"${x}"`).join(" ")}) (list) (hashmap) (fikra/backend-ollama/fikra-ollama-list-hash (list ${held.map((x) => `"${x}"`).join(" ")}) (hashmap)) (hashmap) 0)`;
    // The one candidate sits AFTER the 401 held entries — found, and
    // nothing was left unexamined.
    expect(Number(e(ed, `(length (car ${expr}))`).value)).toBe(1);
    expect(String(e(ed, `(nth 0 (car ${expr}))`).value)).toBe("outside159/only.txt");
    expect(Number(e(ed, `(nth 1 ${expr})`).value)).toBe(0);
    // A path two listings name is reported once (the passes share one
    // seen-set).
    const twice = '(fikra/backend-ollama/fikra-ollama-outside-scan (list "./x159.txt" "./x159.txt") (list) (hashmap) (hashmap) (hashmap) 0)';
    expect(Number(e(ed, `(length (car ${twice}))`).value)).toBe(1);
    // A path the tree diff covers is not a candidate.
    const covered = '(fikra/backend-ollama/fikra-ollama-outside-scan (list "./c159.txt" "./o159.txt") (list) (fikra/backend-ollama/fikra-ollama-list-hash (list "c159.txt") (hashmap)) (hashmap) (hashmap) 0)';
    expect(String(e(ed, `(nth 0 (car ${covered}))`).value)).toBe("o159.txt");
    expect(Number(e(ed, `(length (car ${covered}))`).value)).toBe(1);
    // Exactly at the cap: complete. One more: capped — and only the
    // cap's worth was examined. (The cap is pinned here on purpose.)
    const cap = 4000;
    const many = (n: number) => Array.from({ length: n }, (_, i) => `"./o159/${i}.txt"`).join(" ");
    const at = `(fikra/backend-ollama/fikra-ollama-outside-scan (list ${many(cap)}) (list) (hashmap) (hashmap) (hashmap) 0)`;
    expect(Number(e(ed, `(length (car ${at}))`).value)).toBe(cap);
    expect(Number(e(ed, `(nth 1 ${at})`).value)).toBe(0);
    const over = `(fikra/backend-ollama/fikra-ollama-outside-scan (list ${many(cap + 1)}) (list) (hashmap) (hashmap) (hashmap) 0)`;
    expect(Number(e(ed, `(length (car ${over}))`).value)).toBe(cap);
    expect(Number(e(ed, `(nth 1 ${over})`).value)).toBe(1);
  }, 90000);

  // The gate's scenario end to end, on the ordinary path: one command
  // touches 401 held files AND writes inside a nested repository (the
  // parent's tree holds only the gitlink — a scan-only outside path).
  test("a crowd of held changes cannot push a nested-repository write past the examination (r159)", async () => {
    const ed = await armed();
    const nested = join(process.cwd(), "nested");
    mkdirSync(nested);
    execFileSync("git", ["init", "-q"], { cwd: nested });
    writeFileSync(join(nested, "inner.txt"), "inner\n");
    execFileSync("git", ["add", "-A"], { cwd: nested });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: nested });
    mkdirSync(join(process.cwd(), "bulk159"));
    for (let i = 0; i < 401; i++) writeFileSync(join(process.cwd(), `bulk159/f${i}.txt`), "B\n");
    e(ed, '(fikra/chat/fikra-turn-send "touch a crowd, then write inside the nested repo")');
    // (The tracked-file edit makes the trees DIFFER, so a pair is sealed
    // and the row carries a marker to qualify — a content-neutral touch
    // of held files alone seals nothing.)
    call(ed, 760, "touch bulk159/*; echo more >> base.txt; printf 'more\\n' >> nested/inner.txt");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    // (The call row's summary names the path too — wait on the error
    // row's own words.)
    await until(ed, "(buffer-text)", "cannot hold", 240);
    const rows = logText(ed).split("\n").filter((l) => l.includes("checkpoint-error"));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.join("\n")).toContain("not revertable: nested/inner.txt");
    await settleRefireFrom(ed, seeded, "touched");
    expect(await untilStatus(ed, "idle", 120)).toBe("idle");
    const buf = strip(String(e(ed, "(buffer-text)").value));
    // (The row is wider than the terminal here — its summary names the
    // command — so the marker renders on a continuation line: look at
    // the row's first three lines.)
    const lines = buf.split("\n");
    const at = lines.findIndex((l) => l.includes("⚙ bash"));
    expect(at).toBeGreaterThanOrEqual(0);
    const row = lines.slice(at, at + 3).join("\n");
    // The row does not claim a checkpoint that holds the whole change.
    expect(row).toContain("[ckpt main/");
    expect(row).toContain("— not held]");
    expect(row).not.toContain("✓]");
  }, 90000);

  // A hit with NOTHING found is still a statement about the scan: the
  // entries past the cap were never looked at. The row says so in its
  // own words — "coverage not established", not "not held".
  test("an examination-cap hit qualifies the row as coverage not established (r159)", async () => {
    const ed = await armed();
    // One HELD path, listed past the cap: no candidate, and unexamined
    // entries remain.
    const changed = Array.from({ length: 4001 }, () => '"./base.txt"').join(" ");
    e(ed, '(fikra/event/fikra-event-emit (list (list "kind" "tool-call") (list "tool" "bash") (list "summary" "CAPPED-ROW") (list "act" "9-1")))');
    e(ed, '(fikra/event/fikra-event-emit (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/9-a2") (list "act" "9-1")))');
    e(ed, `(fikra/backend-ollama/fikra-ollama-report-outside-checkpoint (list ${changed}) (list) (list) "HEAD" "HEAD" "9-1" 0 0 0)`);
    // (No turn ran here, so read the replay's own render.)
    const buf = strip(String(e(ed, "(fikra/event/fikra-event-replay)").value));
    const row = buf.split("\n").find((l) => l.includes("CAPPED-ROW"));
    expect(row).toBeDefined();
    expect(row!).toContain("[ckpt main/9-a2 — coverage not established]");
    expect(row!).not.toContain("✓]");
    expect(buf).toContain("the change scan examined only its first 4000 entries — coverage beyond it is not established");
    // A named path keeps its own qualifier.
    e(ed, '(fikra/event/fikra-event-emit (list (list "kind" "tool-call") (list "tool" "bash") (list "summary" "NAMED-ROW") (list "act" "9-2")))');
    e(ed, '(fikra/event/fikra-event-emit (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/9-a4") (list "act" "9-2")))');
    e(ed, '(fikra/backend-ollama/fikra-ollama-report-outside-checkpoint (list "./lost159.txt") (list) (list) "HEAD" "HEAD" "9-2" 0 0 0)');
    const buf2 = strip(String(e(ed, "(fikra/event/fikra-event-replay)").value));
    expect(buf2.split("\n").find((l) => l.includes("CAPPED-ROW"))).toContain("coverage not established");
    const named = buf2.split("\n").find((l) => l.includes("NAMED-ROW"));
    expect(named).toContain("[ckpt main/9-a4 — not held]");
    expect(buf2).toContain("not revertable: lost159.txt");
    // THE PER-PASS CONTRACT (r156): a path the trees HOLD can still
    // carry an unrecordable change — the mode pass must not exclude by
    // the held-set. (The first r159 cut gave every pass the same sets
    // and every permission report went silent.)
    e(ed, '(fikra/event/fikra-event-emit (list (list "kind" "tool-call") (list "tool" "bash") (list "summary" "MODE-ROW") (list "act" "9-3")))');
    e(ed, '(fikra/event/fikra-event-emit (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/9-a6") (list "act" "9-3")))');
    e(ed, '(fikra/backend-ollama/fikra-ollama-report-outside-checkpoint (list) (list "./base.txt") (list) "HEAD" "HEAD" "9-3" 0 0 0)');
    const buf3 = strip(String(e(ed, "(fikra/event/fikra-event-replay)").value));
    expect(buf3.split("\n").find((l) => l.includes("MODE-ROW"))).toContain("[ckpt main/9-a6 — not held]");
    expect(buf3).toContain("1 path(s) the checkpoint cannot hold changed — not revertable: base.txt");
  }, 90000);

  // ── r160: THE MODE PASS EXCLUDES ONLY WHAT THE TREE RECORDED ────────
  // The r159 gate's two reproduced pre-existing P2s. (a) The mode/owner
  // pass dropped an entry whenever the tree diff NAMED its path — but a
  // path can carry a content edit (recorded) AND a permission change
  // (git keeps the executable bit and nothing else). (b) The child's
  // 100-inode cap on that join, and the ignored listing's 100-line cap,
  // said nothing when they hit.
  test("a content edit AND a permission change on ONE file is still reported (r160)", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "append to base and lock it down")');
    call(ed, 770, "echo more >> base.txt; chmod 600 base.txt");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    await until(ed, "(buffer-text)", "cannot hold", 120);
    const rows = logText(ed).split("\n").filter((l) => l.includes("checkpoint-error"));
    expect(rows.join("\n")).toContain("not revertable: base.txt");
    await settleRefireFrom(ed, seeded, "done");
    expect(await untilStatus(ed, "idle", 80)).toBe("idle");
    // The CONTENT is held (a pair was sealed) — the warning is about
    // the permission, and it qualifies the row.
    expect(actionRefs().length).toBeGreaterThan(0);
    const lines = strip(String(e(ed, "(buffer-text)").value)).split("\n");
    const at = lines.findIndex((l) => l.includes("⚙ bash"));
    expect(at).toBeGreaterThanOrEqual(0);
    const row = lines.slice(at, at + 3).join("\n");
    expect(row).toContain("[ckpt main/");
    expect(row).toContain("— not held]");
    expect(row).not.toContain("✓]");
  }, 90000);

  test("the mode/owner scan's 100-inode cap is flagged — 101 changes do not read as 100 (r160)", async () => {
    const ed = await armed();
    mkdirSync(join(process.cwd(), "mode160"));
    for (let i = 0; i < 101; i++) writeFileSync(join(process.cwd(), `mode160/f${i}.txt`), "data\n");
    e(ed, '(fikra/chat/fikra-turn-send "lock down the directory")');
    call(ed, 771, "chmod 600 mode160/*");
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    await until(ed, "(buffer-text)", "cannot hold", 240);
    const errors = () => logText(ed).split("\n").filter((l) => l.includes("checkpoint-error"));
    expect(errors().join("\n")).toContain("the mode/owner scan kept only its first 100 changed inodes");
    expect(errors().join("\n")).toContain("more changed paths may be unreported");
    await settleRefireFrom(ed, seeded, "done");
    expect(await untilStatus(ed, "idle", 120)).toBe("idle");
    // THE BOUNDARY: exactly 100 changed inodes is the whole change —
    // "100 path(s)" with no cap clause.
    mkdirSync(join(process.cwd(), "mode160b"));
    for (let i = 0; i < 100; i++) writeFileSync(join(process.cwd(), `mode160b/f${i}.txt`), "data\n");
    e(ed, '(fikra/chat/fikra-turn-send "lock down the other directory")');
    call(ed, 773, "chmod 600 mode160b/*");
    // (The id is read right after the call — before the sentinel's
    // re-fire lands, as in the first turn.)
    const seeded2 = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    for (let i = 0; i < 240 && errors().length < 2; i++) await new Promise((r) => setTimeout(r, 100));
    expect(errors().length).toBeGreaterThanOrEqual(2);
    const second = errors()[1]!;
    expect(second).toContain("100 path(s) the checkpoint cannot hold changed");
    expect(second).not.toContain("kept only");
    await settleRefireFrom(ed, seeded2, "done");
    expect(await untilStatus(ed, "idle", 120)).toBe("idle");
  }, 90000);

  test("the ignored-entry listing's 100-line cap is flagged (r160)", async () => {
    const ed = await armed();
    const giPath = join(process.cwd(), ".gitignore");
    const gi = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
    writeFileSync(giPath, gi + (gi.length > 0 && !gi.endsWith("\n") ? "\n" : "") + "mix160/g*\n");
    mkdirSync(join(process.cwd(), "mix160"));
    // A non-ignored sibling: git lists a directory of ONLY untracked
    // entries as one line, which would defeat the count.
    writeFileSync(join(process.cwd(), "mix160/keep.txt"), "keep\n");
    const gone = Array.from({ length: 101 }, (_, i) => `mix160/g${i}.txt`);
    // DELETED ignored entries: the listing is the only scan that can
    // see a deletion (a created one also shows up in the ctime scan).
    for (const g of gone) writeFileSync(join(process.cwd(), g), "x\n");
    e(ed, '(fikra/chat/fikra-turn-send "remove a crowd of ignored files")');
    call(ed, 772, `rm ${gone.join(" ")}`);
    if (String(e(ed, "(fikra/thread/fikra-thread-status)").value) === "confirming") {
      e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    }
    const seeded = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    await until(ed, "(buffer-text)", "cannot hold", 240);
    const errors = () => logText(ed).split("\n").filter((l) => l.includes("checkpoint-error"));
    expect(errors().join("\n")).toContain("the ignored-entry listing kept only its first 100 lines");
    await settleRefireFrom(ed, seeded, "done");
    expect(await untilStatus(ed, "idle", 120)).toBe("idle");
    // THE BOUNDARY: exactly 100 deleted entries is the whole change.
    writeFileSync(giPath, readFileSync(giPath, "utf8") + "mix160b/g*\n");
    mkdirSync(join(process.cwd(), "mix160b"));
    writeFileSync(join(process.cwd(), "mix160b/keep.txt"), "keep\n");
    const hundred = Array.from({ length: 100 }, (_, i) => `mix160b/g${i}.txt`);
    for (const g of hundred) writeFileSync(join(process.cwd(), g), "x\n");
    e(ed, '(fikra/chat/fikra-turn-send "remove exactly one hundred ignored files")');
    call(ed, 774, `rm ${hundred.join(" ")}`);
    if (String(e(ed, "(fikra/thread/fikra-thread-status)").value) === "confirming") {
      e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    }
    const seeded2 = String(e(ed, "(fikra/backend-ollama/fikra-ollama-latest-id-get)").value);
    for (let i = 0; i < 240 && errors().length < 2; i++) await new Promise((r) => setTimeout(r, 100));
    expect(errors().length).toBeGreaterThanOrEqual(2);
    const second = errors()[1]!;
    expect(second).toContain("100 path(s) the checkpoint cannot hold changed");
    expect(second).not.toContain("kept only");
    await settleRefireFrom(ed, seeded2, "done");
    expect(await untilStatus(ed, "idle", 120)).toBe("idle");
  }, 90000);

  // The rule itself, at the report's own level: a meta entry is excluded
  // only when the tree RECORDED a mode change for its path.
  test("the mode pass excludes only what the tree recorded (r160)", async () => {
    const ed = await armed();
    const gc = ["-c", "user.name=t", "-c", "user.email=t@t"];
    // A content edit: the tree records it, and its tree mode is unchanged.
    writeFileSync(join(process.cwd(), "base.txt"), "changed by a commit\n");
    execFileSync("git", ["add", "base.txt"]);
    execFileSync("git", [...gc, "commit", "-q", "-m", "r160 content"]);
    e(ed, '(fikra/event/fikra-event-emit (list (list "kind" "tool-call") (list "tool" "bash") (list "summary" "CONTENT-ROW") (list "act" "8-1")))');
    e(ed, '(fikra/event/fikra-event-emit (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/8-a2") (list "act" "8-1")))');
    e(ed, '(fikra/backend-ollama/fikra-ollama-report-outside-checkpoint (list) (list "./base.txt") (list) "HEAD~1" "HEAD" "8-1" 0 0 0)');
    let buf = strip(String(e(ed, "(fikra/event/fikra-event-replay)").value));
    expect(buf).toContain("not revertable: base.txt");
    expect(buf.split("\n").find((l) => l.includes("CONTENT-ROW"))).toContain("[ckpt main/8-a2 — not held]");
    // An executable-bit change: the tree records THAT — not a candidate.
    execFileSync("chmod", ["755", join(process.cwd(), "base.txt")]);
    execFileSync("git", ["add", "base.txt"]);
    execFileSync("git", [...gc, "commit", "-q", "-m", "r160 exec bit"]);
    e(ed, '(fikra/event/fikra-event-emit (list (list "kind" "tool-call") (list "tool" "bash") (list "summary" "EXECBIT-ROW") (list "act" "8-2")))');
    e(ed, '(fikra/event/fikra-event-emit (list (list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/8-a4") (list "act" "8-2")))');
    const before = strip(String(e(ed, "(fikra/event/fikra-event-replay)").value)).split("\n").filter((l) => l.includes("checkpoint-error")).length;
    e(ed, '(fikra/backend-ollama/fikra-ollama-report-outside-checkpoint (list) (list "./base.txt") (list) "HEAD~1" "HEAD" "8-2" 0 0 0)');
    buf = strip(String(e(ed, "(fikra/event/fikra-event-replay)").value));
    expect(buf.split("\n").filter((l) => l.includes("checkpoint-error")).length).toBe(before);
    expect(buf.split("\n").find((l) => l.includes("EXECBIT-ROW"))).toContain("[ckpt main/8-a4 ✓]");
  }, 90000);

  // ── r161: A FAILED OR PARTIAL CAPTURE NEVER SHOWS AN UNQUALIFIED ✓ ─
  // The capture's error event carried no action id and run-edit's
  // pre-failure path only set the status line, so an action whose FIRST
  // capture failed still showed "[ckpt <post> ✓]" — though nothing could
  // revert it. And when the SECOND capture failed, "last ref wins" put
  // the PRE ref on the row as if it were the result.
  const emitEv = (ed2: Editor, pairs: string) => {
    e(ed2, `(fikra/event/fikra-event-emit (list ${pairs}))`);
  };
  const rowOf = (ed2: Editor, needle: string) =>
    strip(String(e(ed2, "(fikra/event/fikra-event-replay)").value)).split("\n").find((l) => l.includes(needle)) ?? "";
  const carriersClear = (ed2: Editor) =>
    String(e(ed2, '(if (fikra/checkpoint/fikra-checkpoint-emit-act-get) "SET" "CLEAR")').value);
  const noPairRecorded = () => {
    const pairsFile = join(process.cwd(), ".tmax/fikra/threads/main/actions.jsonl");
    return existsSync(pairsFile) ? readFileSync(pairsFile, "utf8").trim() : "";
  };

  test("a POST that failed leaves NO checkpoint marker — the pre ref is not a stand-in (r161)", async () => {
    const ed = await armed();
    emitEv(ed, '(list "kind" "tool-call") (list "tool" "buffer-edit") (list "summary" "PREONLY-ROW") (list "act" "7-1")');
    emitEv(ed, '(list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/7-a1") (list "sha" "x") (list "act" "7-1") (list "stage" "pre")');
    emitEv(ed, '(list "kind" "checkpoint-error") (list "reason" "fatal: not a git repository") (list "act" "7-1") (list "stage" "post")');
    const row = rowOf(ed, "PREONLY-ROW");
    expect(row).not.toContain("✓]");
    // The PRE ref is the revert target — never the action's checkpoint.
    expect(row).not.toContain("7-a1");
    expect(row).toContain("[no checkpoint — not revertable]");
    // The error itself still stands in the transcript.
    expect(String(e(ed, "(fikra/event/fikra-event-replay)").value)).toContain("fatal: not a git repository");
  }, 90000);

  test("a PRE that failed leaves the post ref, qualified (r161)", async () => {
    const ed = await armed();
    emitEv(ed, '(list "kind" "tool-call") (list "tool" "buffer-edit") (list "summary" "POSTONLY-ROW") (list "act" "7-2")');
    emitEv(ed, '(list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/7-a4") (list "sha" "x") (list "act" "7-2") (list "stage" "post")');
    emitEv(ed, '(list "kind" "checkpoint-error") (list "reason" "fatal: not a git repository") (list "act" "7-2") (list "stage" "pre")');
    const row = rowOf(ed, "POSTONLY-ROW");
    expect(row).toContain("[ckpt main/7-a4 — not revertable]");
    expect(row).not.toContain("✓]");
  }, 90000);

  test("a ready from an older log (no stage) keeps its marker (r161)", async () => {
    const ed = await armed();
    emitEv(ed, '(list "kind" "tool-call") (list "tool" "buffer-edit") (list "summary" "LEGACY-ROW") (list "act" "7-3")');
    emitEv(ed, '(list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/7-a6") (list "sha" "x") (list "act" "7-3")');
    expect(rowOf(ed, "LEGACY-ROW")).toContain("[ckpt main/7-a6 ✓]");
  }, 90000);

  test("a coverage qualifier is not displaced by a capture failure, in either order (r161)", async () => {
    const ed = await armed();
    emitEv(ed, '(list "kind" "tool-call") (list "tool" "bash") (list "summary" "NAMED-FIRST") (list "act" "7-4")');
    emitEv(ed, '(list "kind" "checkpoint-error") (list "reason" "1 path(s) the checkpoint cannot hold changed") (list "qual" "not held") (list "act" "7-4")');
    emitEv(ed, '(list "kind" "checkpoint-error") (list "reason" "capture failed") (list "act" "7-4") (list "stage" "pre")');
    emitEv(ed, '(list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/7-a8") (list "sha" "x") (list "act" "7-4") (list "stage" "post")');
    emitEv(ed, '(list "kind" "tool-call") (list "tool" "bash") (list "summary" "NAMED-LAST") (list "act" "7-5")');
    emitEv(ed, '(list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/7-a10") (list "sha" "x") (list "act" "7-5") (list "stage" "post")');
    emitEv(ed, '(list "kind" "checkpoint-error") (list "reason" "capture failed") (list "act" "7-5") (list "stage" "pre")');
    emitEv(ed, '(list "kind" "checkpoint-error") (list "reason" "1 path(s) the checkpoint cannot hold changed") (list "qual" "not held") (list "act" "7-5")');
    expect(rowOf(ed, "NAMED-FIRST")).toContain("[ckpt main/7-a8 — not held]");
    expect(rowOf(ed, "NAMED-LAST")).toContain("[ckpt main/7-a10 — not held]");
  }, 90000);

  // ONE capture is made to fail from inside git: a reference-transaction
  // hook in the fixture repo refuses one ref, so that capture's
  // `git update-ref` fails and the capture reports CAPTURE-FAILED. (A
  // `git` shim placed first on PATH does NOT work here: the editor's
  // shell-command does not resolve through a PATH changed by the test —
  // the first cut of these witnesses never failed a capture at all.)
  // The turn's baseline ref is never touched.
  // r162: the same hook, generalized — ACTION is the shell that runs
  // when the named ref is updated. It can refuse (exit 1: that capture
  // fails) or WRITE: a file it creates during the PRE ref's transaction
  // is on disk for the post capture but not in the pre tree — exactly
  // "something else changed during the action's window".
  const withRefHook = async (onRef: string, action: string, body: () => Promise<void>) => {
    // This witness's OWN repo, captured now: every test runs in its own
    // temp repo through process.chdir, so a cleanup that runs LATE (the
    // witness timed out under load) must not land in whichever repo is
    // current then — it used to unset a LATER witness's hook.
    const repo = process.cwd();
    const hooks = join(repo, ".git", "r161-hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, "reference-transaction"), [
      "#!/bin/sh",
      "while read old new ref; do",
      '  case "$ref" in "' + onRef + '") ' + action + " ;; esac",
      "done",
      "exit 0",
      "",
    ].join("\n"));
    chmodSync(join(hooks, "reference-transaction"), 0o755);
    execFileSync("git", ["config", "core.hooksPath", hooks], { cwd: repo });
    try {
      await body();
    } finally {
      rmSync(hooks, { recursive: true, force: true });
      // Pinned to this witness's own repo, and idempotent: a witness that
      // times out under load finishes its cleanup late — after a later
      // witness has set ITS hook. Unpinned, it unset that later witness's
      // hook (its capture then never failed); unwrapped, `--unset` exits 5
      // once the section is gone (an unhandled error in a gate's run).
      try {
        execFileSync("git", ["config", "--unset", "core.hooksPath"], { cwd: repo, stdio: "ignore" });
      } catch {
        /* already unset */
      }
    }
  };
  const withRefusedRef = (suffix: string, body: () => Promise<void>) =>
    withRefHook("refs/fikra/main/" + suffix, 'echo "r161: refused ${ref}" >&2; exit 1', body);
  const fireEdit = (ed2: Editor, id: number, path: string, content: string) => {
    const callSpec = { function: { name: "buffer_edit", arguments: { path, content } } };
    e(ed2, `(fikra/backend-ollama/fikra-backend-ollama-seed ${id} "live")`);
    e(ed2, `(fikra/backend-ollama/fikra-backend-ollama-http-filter ${id} "${hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [callSpec] } }))}")`);
    e(ed2, `(fikra-http-complete ${id} 200 "${hex("{}")}")`);
  };

  test("an edit whose PRE capture fails shows a qualified row and records no pair (r161)", async () => {
    // The FIRST action capture of the turn: the edit's pre.
    await withRefusedRef("1-a1", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "edit without a pre ref")');
      fireEdit(ed, 780, "e161.txt", "EDITED\n");
      await until(ed, "(buffer-text)", "not revertable]", 120);
      await settleRefireFrom(ed, "780", "done");
      expect(await untilStatus(ed, "idle", 80)).toBe("idle");
      expect(readFileSync(join(process.cwd(), "e161.txt"), "utf8")).toContain("EDITED");
      const row = rowOf(ed, "e161.txt");
      expect(row).toContain("[ckpt main/");
      expect(row).toContain("— not revertable]");
      expect(row).not.toContain("✓]");
      // The failure is ON THE RECORD, tied to the action and its stage.
      const errs = logText(ed).split("\n").filter((l) => l.includes("checkpoint-error"));

      expect(errs.join("\n")).toContain('"stage":"pre"');
      // Nothing is revertable: no pair was recorded.
      expect(noPairRecorded()).toBe("");
      e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
      expect(String(e(ed, "(editor-status)").value)).toContain("no action");
      // The carriers did not leak past the failure.
      expect(carriersClear(ed)).toBe("CLEAR");
      // The ref the row DOES show is the edit's own result, tree-checked.
      const shown = /\[ckpt main\/(1-a\d+)/.exec(row)?.[1];
      expect(shown).toMatch(/^1-a\d+$/);
      expect(blobOf(ed, shown!, "e161.txt")).toContain("EDITED");
    });
  }, 90000);

  test("an edit whose POST capture fails shows no success marker and records no pair (r161)", async () => {
    // The SECOND: the edit's post.
    await withRefusedRef("1-a2", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "edit without a post ref")');
      fireEdit(ed, 781, "f161.txt", "EDITED\n");
      await until(ed, "(buffer-text)", "no checkpoint", 120);
      await settleRefireFrom(ed, "781", "done");
      expect(await untilStatus(ed, "idle", 80)).toBe("idle");
      expect(readFileSync(join(process.cwd(), "f161.txt"), "utf8")).toContain("EDITED");
      const row = rowOf(ed, "f161.txt");
      expect(row).toContain("[no checkpoint — not revertable]");
      expect(row).not.toContain("✓]");
      // The pre ref does not stand in for the result — and neither does
      // the TURN's completion ref: that marker stands on its own row.
      expect(row).not.toContain("[ckpt ");
      const all = strip(String(e(ed, "(fikra/event/fikra-event-replay)").value));
      expect(all).toContain("[ckpt main/1 ✓]");
      const errs = logText(ed).split("\n").filter((l) => l.includes("checkpoint-error"));
      expect(errs.join("\n")).toContain('"stage":"post"');
      expect(noPairRecorded()).toBe("");
      expect(carriersClear(ed)).toBe("CLEAR");
    });
  }, 90000);

  test("a mediated bash whose PRE capture fails shows a qualified row (r161)", async () => {
    // The mediated command's pre (captured at approval).
    await withRefusedRef("1-a1", async () => {
      const ed = await armed();
      mkdirSync(join(process.cwd(), "med161dir"));
      writeFileSync(join(process.cwd(), "med161dir/old.txt"), "BEFORE\n");
      e(ed, '(fikra/chat/fikra-turn-send "remove it without a pre ref")');
      call(ed, 782, "rm -rf med161dir/");
      expect(String(e(ed, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
      e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
      await until(ed, "(buffer-text)", "not revertable]", 180);
      await settleRefireFrom(ed, "782", "done");
      expect(await untilStatus(ed, "idle", 120)).toBe("idle");
      expect(existsSync(join(process.cwd(), "med161dir/old.txt"))).toBe(false);
      const row = rowOf(ed, "⚙ bash");
      expect(row).toContain("[ckpt main/");
      expect(row).toContain("— not revertable]");
      expect(row).not.toContain("✓]");
      const errs = logText(ed).split("\n").filter((l) => l.includes("checkpoint-error"));
      expect(errs.join("\n")).toContain('"stage":"pre"');
      expect(noPairRecorded()).toBe("");
      expect(carriersClear(ed)).toBe("CLEAR");
    });
  }, 90000);

  // ── r161b (the r161 gate's round-1 P2s): THE STAGE RULE ────────────
  // A ready that carries a stage is placed only through its act, and
  // by precedence: a post-stage ref beats an unstaged one in EITHER
  // order; a pre — or any stage other than "post" — attaches nowhere.
  // An unstaged ready (an older log) is last-wins among themselves and
  // never displaces a staged post. The legacy proximity merge attaches
  // UNSTAGED readies only: the one act-less staged ready a real log
  // holds is a mediated command's PRE (its act is minted later), and it
  // used to attach to the previous command's row.
  test("the stage rule: post beats unstaged in either order; other stages never attach (r161b)", async () => {
    const ed = await armed();
    const action = (act: string, name: string, readies: [stage: string, ref: string][]) => {
      emitEv(ed, `(list "kind" "tool-call") (list "tool" "buffer-edit") (list "summary" "${name}") (list "act" "${act}")`);
      for (const [stage, ref] of readies) {
        const st = stage ? ` (list "stage" "${stage}")` : "";
        emitEv(ed, `(list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/${ref}") (list "sha" "x") (list "act" "${act}")${st}`);
      }
    };
    action("6-1", "UNK-ROW", [["future", "6-a1"]]);
    action("6-2", "POST-THEN-LEGACY", [["post", "6-a2"], ["", "6-a4"]]);
    action("6-3", "LEGACY-THEN-POST", [["", "6-a6"], ["post", "6-a8"]]);
    action("6-4", "REVERSED", [["post", "6-a10"], ["pre", "6-a12"]]);
    action("6-5", "OLD-LOG", [["", "6-a14"], ["", "6-a16"]]);
    const text = strip(String(e(ed, "(fikra/event/fikra-event-replay)").value));
    const line = (name: string) => text.split("\n").find((l) => l.includes(name)) ?? "";
    expect(line("UNK-ROW")).not.toContain("[ckpt");
    expect(line("POST-THEN-LEGACY")).toContain("[ckpt main/6-a2 ✓]");
    expect(line("LEGACY-THEN-POST")).toContain("[ckpt main/6-a8 ✓]");
    expect(line("REVERSED")).toContain("[ckpt main/6-a10 ✓]");
    expect(line("REVERSED")).not.toContain("6-a12");
    // An older log carries a pre AND a post for one action, both
    // unstaged: the last one is the post, as it always was.
    expect(line("OLD-LOG")).toContain("[ckpt main/6-a16 ✓]");
  }, 90000);

  // The real path. A read-only command seals nothing, so its row has no
  // marker of its own. The NEXT command is mediated: its PRE capture is
  // an act-less action ref emitted at approval — BEFORE its own row —
  // and the proximity merge attached it to the row above. The command
  // that changed nothing then displayed the next command's pre-state as
  // its own checkpoint.
  test("a read-only command does not borrow the NEXT command's pre ref (r161b)", async () => {
    const ed = await armed();
    mkdirSync(join(process.cwd(), "med161c"));
    writeFileSync(join(process.cwd(), "med161c/old.txt"), "BEFORE\n");
    e(ed, '(fikra/chat/fikra-turn-send "look, then remove")');
    const read = { function: { name: "bash", arguments: { command: "echo JUST-LOOKING-161C" } } };
    const remove = { function: { name: "bash", arguments: { command: "rm -rf med161c/" } } };
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed 785 "live")`);
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 785 "${hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [read, remove] } }))}")`);
    e(ed, `(fikra-http-complete 785 200 "${hex("{}")}")`);
    // The first command is async: the round holds until it exits, then
    // the second parks.
    expect(await untilStatus(ed, "confirming", 120)).toBe("confirming");
    e(ed, "(fikra/approvals/fikra-approval-answer-allow)");
    await settleRefireFrom(ed, "785", "done");
    expect(await untilStatus(ed, "idle", 120)).toBe("idle");
    expect(existsSync(join(process.cwd(), "med161c/old.txt"))).toBe(false);
    const text = strip(String(e(ed, "(fikra/event/fikra-event-replay)").value));
    const look = text.split("\n").find((l) => l.includes("JUST-LOOKING-161C")) ?? "";
    // It changed nothing: no checkpoint marker at all — and above all
    // not the next command's pre ref.
    expect(look).not.toContain("[ckpt");
    // r161c (the r161 gate's round 2): the pre-state must not stand
    // ALONE either — it rendered "⌘ [ckpt main/1-a1 ✓]", a success-looking
    // row for a pre-state (and an edit never showed its own).
    expect(text).not.toContain("main/1-a1");
    // The mediated command keeps its own.
    // (The approval panel quotes the command too: take the TOOL row.)
    const row = text.split("\n").find((l) => l.includes("⚙ bash") && l.includes("rm -rf med161c/")) ?? "";
    expect(row).toContain("[ckpt main/1-a2 ✓]");
    expect(row).not.toContain("1-a1");
  }, 90000);

  test("a staged ready with no action id is not shown at all — a pre-state never stands alone (r161c)", async () => {
    const ed = await armed();
    emitEv(ed, '(list "kind" "tool-call") (list "tool" "buffer_edit") (list "summary" "NOACT-STAGED-ROW")');
    for (const [stage, ref] of [["pre", "5-a1"], ["future", "5-a2"], ["post", "5-a3"]]) {
      emitEv(ed, `(list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/${ref}") (list "sha" "x") (list "stage" "${stage}")`);
    }
    const text = strip(String(e(ed, "(fikra/event/fikra-event-replay)").value));
    expect(text).toContain("NOACT-STAGED-ROW");
    for (const ref of ["5-a1", "5-a2", "5-a3"]) expect(text).not.toContain(ref);
    // The turn's own checkpoints carry no stage: they keep their rows.
    emitEv(ed, '(list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/5") (list "sha" "x")');
    const after = strip(String(e(ed, "(fikra/event/fikra-event-replay)").value));
    expect(after).toContain("⌘ [ckpt main/5 ✓]");
  }, 90000);

  test("a witness's cleanup touches only its OWN repo, even when it runs from another one (r161d)", async () => {
    const mine = process.cwd();
    const other = mkdtempSync(join(tmpdir(), "r161d-other-"));
    execFileSync("git", ["init", "-q"], { cwd: other });
    const elsewhere = join(other, "elsewhere");
    execFileSync("git", ["config", "core.hooksPath", elsewhere], { cwd: other });
    try {
      await withRefusedRef("9-a1", async () => {
        // A cleanup that runs LATE (the witness timed out under load)
        // runs from whichever repo is current THEN.
        process.chdir(other);
      });
      process.chdir(mine);
      // The other repo's hook is untouched; this witness's own is gone.
      expect(execFileSync("git", ["config", "core.hooksPath"], { cwd: other, encoding: "utf8" }).trim()).toBe(elsewhere);
      expect(() => execFileSync("git", ["config", "core.hooksPath"], { cwd: mine, encoding: "utf8" })).toThrow();
    } finally {
      process.chdir(mine);
      rmSync(other, { recursive: true, force: true });
    }
  }, 90000);

  test("a coverage qualifier other than 'not held' survives a capture failure too (r161b)", async () => {
    const ed = await armed();
    const coverage = (act: string, qual: string) =>
      emitEv(ed, `(list "kind" "checkpoint-error") (list "reason" "the change scan examined only its first 4000 entries — coverage beyond it is not established") (list "qual" "${qual}") (list "act" "${act}")`);
    const failure = (act: string) =>
      emitEv(ed, `(list "kind" "checkpoint-error") (list "reason" "capture failed") (list "act" "${act}") (list "stage" "pre")`);
    const ready = (act: string, ref: string) => {
      emitEv(ed, `(list "kind" "tool-call") (list "tool" "buffer-edit") (list "summary" "${ref}-ROW") (list "act" "${act}")`);
      emitEv(ed, `(list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/${ref}") (list "sha" "x") (list "act" "${act}") (list "stage" "post")`);
    };
    ready("6-6", "6-a20"); coverage("6-6", "coverage not established"); failure("6-6");
    ready("6-7", "6-a22"); failure("6-7"); coverage("6-7", "coverage not established");
    expect(rowOf(ed, "6-a20-ROW")).toContain("[ckpt main/6-a20 — coverage not established]");
    expect(rowOf(ed, "6-a22-ROW")).toContain("[ckpt main/6-a22 — coverage not established]");
  }, 90000);

  // ── r162: A REVERT RESTORES ONLY WHAT THE ACTION CAN ACCOUNT FOR ───
  // The action revert restored EVERY path that differed between the two
  // checkpoint trees. Whatever else changed in the action's WINDOW — a
  // file saved in another buffer while a command ran, another local
  // thread's write — was swept in and silently undone (recoverable only
  // from the stash patch). An edit knows its file: it restores that file
  // and nothing else. (A shell command cannot declare its files; its
  // revert still covers the whole tree difference.)
  test("an edit's revert restores the edited file — not a file that appeared during its window (r162)", async () => {
    await withRefHook("refs/fikra/main/1-a1", "echo FOREIGN-162 > foreign162.txt", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "one edit")');
      fireEdit(ed, 790, "e162.txt", "EDITED-162\n");
      await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
      await settleRefireFrom(ed, "790", "done");
      expect(await untilStatus(ed, "idle", 80)).toBe("idle");
      // Both are in the post tree and not in the pre tree: the edit, and
      // the file that appeared while the pre ref was being written.
      expect(readFileSync(join(process.cwd(), "foreign162.txt"), "utf8")).toContain("FOREIGN-162");
      const diff = String(e(ed, '(shell-command "git diff --name-only refs/fikra/main/1-a1 refs/fikra/main/1-a2")').value).trim().split("\n").sort();
      expect(diff).toEqual(["e162.txt", "foreign162.txt"]);
      e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
      expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
      expect(existsSync(join(process.cwd(), "e162.txt"))).toBe(false);
      // The file that was not the action's to undo is still there.
      expect(readFileSync(join(process.cwd(), "foreign162.txt"), "utf8")).toContain("FOREIGN-162");
      // The durable record carried the edit's own path (a third token).
      const pairs = readFileSync(join(process.cwd(), ".tmax/fikra/threads/main/actions.jsonl"), "utf8");
      expect(pairs).toMatch(/^refs\/fikra\/main\/1-a2 refs\/fikra\/main\/1-a1 [0-9a-f]+/m);
    });
  }, 90000);

  test("an edit's revert stays precise after a restart — the pairs reload from disk (r162)", async () => {
    await withRefHook("refs/fikra/main/1-a1", "echo FOREIGN-162 > foreign162b.txt", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "one edit, then a restart")');
      fireEdit(ed, 791, "g162.txt", "EDITED-162B\n");
      await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
      await settleRefireFrom(ed, "791", "done");
      expect(await untilStatus(ed, "idle", 80)).toBe("idle");
      // The in-memory pairs are gone; the file is all there is.
      e(ed, "(fikra/backend-ollama/fikra-ollama-action-state-reset)");
      e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
      expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
      expect(existsSync(join(process.cwd(), "g162.txt"))).toBe(false);
      expect(readFileSync(join(process.cwd(), "foreign162b.txt"), "utf8")).toContain("FOREIGN-162");
    });
  }, 90000);

  test("an edit's own path survives the record whatever it looks like — a space, non-ASCII, a subdirectory (r162)", async () => {
    await withRefHook("refs/fikra/main/1-a1", "echo FOREIGN-162 > foreign162d.txt", async () => {
      const ed = await armed();
      const awkward = "sub162/dir with space/é162.txt";
      mkdirSync(join(process.cwd(), "sub162/dir with space"), { recursive: true });
      const edit = (path: string, content: string) => ({ function: { name: "buffer_edit", arguments: { path, content } } });
      e(ed, '(fikra/chat/fikra-turn-send "two edits, awkward paths")');
      e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed 793 "live")`);
      e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 793 "${hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [edit(awkward, "AWKWARD\n"), edit("plain162.txt", "PLAIN\n")] } }))}")`);
      e(ed, `(fikra-http-complete 793 200 "${hex("{}")}")`);
      await until(ed, "(buffer-text)", "[ckpt main/1-a4", 180);
      await settleRefireFrom(ed, "793", "done");
      expect(await untilStatus(ed, "idle", 120)).toBe("idle");
      expect(readFileSync(join(process.cwd(), awkward), "utf8")).toContain("AWKWARD");
      // The pairs reload from disk: the awkward path rides the token.
      const file = join(process.cwd(), ".tmax/fikra/threads/main/actions.jsonl");
      expect(readFileSync(file, "utf8")).toContain(Buffer.from(awkward).toString("hex"));
      e(ed, "(fikra/backend-ollama/fikra-ollama-action-state-reset)");
      e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
      expect(existsSync(join(process.cwd(), "plain162.txt"))).toBe(false);
      e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
      expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
      expect(existsSync(join(process.cwd(), awkward))).toBe(false);
      // The file that appeared during the first edit's window survives both.
      expect(readFileSync(join(process.cwd(), "foreign162d.txt"), "utf8")).toContain("FOREIGN-162");
    });
  }, 90000);

  test("when none of an action's own paths is in the diff, the whole difference is restored — never nothing (r162)", async () => {
    await withRefHook("refs/fikra/main/1-a1", "echo FOREIGN-162 > foreign162c.txt", async () => {
      const ed = await armed();
      e(ed, '(fikra/chat/fikra-turn-send "one edit, misrecorded")');
      fireEdit(ed, 792, "h162.txt", "EDITED-162C\n");
      await until(ed, "(buffer-text)", "[ckpt main/1-a2", 120);
      await settleRefireFrom(ed, "792", "done");
      expect(await untilStatus(ed, "idle", 80)).toBe("idle");
      // The record's own-path token names a path that is not in the
      // diff (a file spelled differently from git's form). Restoring
      // "nothing" would leave the edit standing.
      const file = join(process.cwd(), ".tmax/fikra/threads/main/actions.jsonl");
      const [post, pre] = readFileSync(file, "utf8").trim().split(" ");
      writeFileSync(file, `${post} ${pre} ${Buffer.from("not-the-file.txt").toString("hex")}\n`);
      e(ed, "(fikra/backend-ollama/fikra-ollama-action-state-reset)");
      e(ed, "(fikra/backend-ollama/fikra-ollama-revert-latest-action)");
      expect(String(e(ed, "(editor-status)").value)).toContain("action reverted");
      expect(existsSync(join(process.cwd(), "h162.txt"))).toBe(false);
      expect(existsSync(join(process.cwd(), "foreign162c.txt"))).toBe(false);
    });
  }, 90000);

  // ── r162b (an independent review's P3s): ONE BAD LINE MUST NOT TAKE THE
  // WHOLE TRANSCRIPT DOWN. A non-string field (a damaged or a newer log)
  // threw inside the identity passes, and the error traps then degraded
  // EVERY row of the thread, for good: a failed capture's pre stood as an
  // unqualified ✓, a coverage-qualified row lost its qualifier. The
  // traps' own debug write could throw as well, turning the degrade into
  // an error.
  test("one malformed line degrades nothing — the other rows keep their markers and qualifiers (r162b)", async () => {
    const ed = await armed();
    emitEv(ed, '(list "kind" "tool-call") (list "tool" "buffer-edit") (list "summary" "FAILED-ROW") (list "act" "4-1")');
    emitEv(ed, '(list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/4-a1") (list "sha" "x") (list "act" "4-1") (list "stage" "pre")');
    emitEv(ed, '(list "kind" "checkpoint-error") (list "reason" "capture failed") (list "act" "4-1") (list "stage" "post")');
    // The malformed one: a number where a string belongs.
    emitEv(ed, '(list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/4-a2") (list "sha" "x") (list "act" 3)');
    emitEv(ed, '(list "kind" "tool-call") (list "tool" "bash") (list "summary" "QUALIFIED-ROW") (list "act" "4-2")');
    emitEv(ed, '(list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/4-a4") (list "sha" "x") (list "act" "4-2") (list "stage" "post")');
    emitEv(ed, '(list "kind" "checkpoint-error") (list "reason" "1 path(s) the checkpoint cannot hold changed") (list "qual" "not held") (list "act" "4-2")');
    const text = strip(String(e(ed, "(fikra/event/fikra-event-replay)").value));
    const line = (needle: string) => text.split("\n").find((l) => l.includes(needle)) ?? "";
    expect(line("FAILED-ROW")).toContain("[no checkpoint — not revertable]");
    expect(line("FAILED-ROW")).not.toContain("4-a1");
    expect(line("QUALIFIED-ROW")).toContain("[ckpt main/4-a4 — not held]");
    // The malformed ready belongs to no row anyone can name, and does
    // not stand as a success marker.
    expect(text).not.toContain("4-a2");
  }, 90000);

  test("an unwritable debug log does not turn a degrade into an error (r162b)", async () => {
    const ed = await armed();
    // The traps' own debug write must fail: a DIRECTORY at its path.
    mkdirSync(join(process.cwd(), ".tmax/fikra"), { recursive: true });
    mkdirSync(join(process.cwd(), ".tmax/fikra/actdbg.log"));
    try {
      emitEv(ed, '(list "kind" "tool-call") (list "tool" "buffer-edit") (list "summary" "FAILED-ROW") (list "act" "4-1")');
      emitEv(ed, '(list "kind" "checkpoint-ready") (list "ref" "refs/fikra/main/4-a1") (list "sha" "x") (list "act" 3)');
      // Before: the malformed line threw in a pass, the handler's own
      // append-file threw too, and the REPLAY errored (a chat buffer
      // that could not open at all).
      const text = strip(String(e(ed, "(fikra/event/fikra-event-replay)").value));
      expect(text).toContain("FAILED-ROW");
    } finally {
      rmdirSync(join(process.cwd(), ".tmax/fikra/actdbg.log"));
    }
  }, 90000);

  // ── FOR_9 item 2: every DISPLAYED action ref is checked against its
  // own git tree — DELAYED (an async bash holds the round between two
  // edits, so its marker lands after the first edit's and before the
  // second's) and after a RESTART (a fresh editor has only the log).
  const treeOf = (ed2: Editor, ref: string) =>
    String(e(ed2, `(shell-command "git ls-tree -r --name-only refs/fikra/main/${ref}")`).value);
  const blobOf = (ed2: Editor, ref: string, path: string) =>
    String(e(ed2, `(shell-command "git show refs/fikra/main/${ref}:${path}")`).value);

  test("delayed: a bash between two edits — each row's displayed ref is its OWN tree (r161b)", async () => {
    const ed = await armed();
    const edit = (path: string, content: string) => ({ function: { name: "buffer_edit", arguments: { path, content } } });
    e(ed, '(fikra/chat/fikra-turn-send "edit, run, edit")');
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed 800 "live")`);
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 800 "${hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [
      edit("a162.txt", "EDIT-A\n"),
      { function: { name: "bash", arguments: { command: "echo BASH-RAN >> d162.txt" } } },
      edit("b162.txt", "EDIT-B\n"),
    ] } }))}")`);
    e(ed, `(fikra-http-complete 800 200 "${hex("{}")}")`);
    await until(ed, "(buffer-text)", "[ckpt main/1-a6", 180);
    await settleRefireFrom(ed, "800", "done");
    expect(await untilStatus(ed, "idle", 120)).toBe("idle");
    const lines = strip(String(e(ed, "(buffer-text)").value)).split("\n");
    const rowOf = (needle: string) => lines.find((l) => l.includes(needle)) ?? "";
    expect(rowOf("a162.txt")).toContain("[ckpt main/1-a2 ✓]");
    expect(rowOf("⚙ bash")).toContain("[ckpt main/1-a4 ✓]");
    expect(rowOf("b162.txt")).toContain("[ckpt main/1-a6 ✓]");
    // The trees say the same thing — each in BOTH directions.
    expect(treeOf(ed, "1-a2")).toContain("a162.txt");
    expect(treeOf(ed, "1-a2")).not.toContain("d162.txt");
    expect(treeOf(ed, "1-a2")).not.toContain("b162.txt");
    expect(treeOf(ed, "1-a4")).toContain("d162.txt");
    expect(treeOf(ed, "1-a4")).not.toContain("b162.txt");
    expect(treeOf(ed, "1-a6")).toContain("b162.txt");
    // …and each LATER tree retains what came before it.
    expect(treeOf(ed, "1-a4")).toContain("a162.txt");
    expect(treeOf(ed, "1-a6")).toContain("a162.txt");
    expect(treeOf(ed, "1-a6")).toContain("d162.txt");
    expect(blobOf(ed, "1-a4", "d162.txt")).toContain("BASH-RAN");
    expect(blobOf(ed, "1-a6", "b162.txt")).toContain("EDIT-B");
  }, 90000);

  test("restart: a fresh editor replays the log and every displayed ref still matches its tree (r161b)", async () => {
    const ed = await armed();
    const edit = (path: string, content: string) => ({ function: { name: "buffer_edit", arguments: { path, content } } });
    e(ed, '(fikra/chat/fikra-turn-send "two edits before a restart")');
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-seed 801 "live")`);
    e(ed, `(fikra/backend-ollama/fikra-backend-ollama-http-filter 801 "${hex(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [edit("c162.txt", "EDIT-C\n"), edit("e162.txt", "EDIT-E\n")] } }))}")`);
    e(ed, `(fikra-http-complete 801 200 "${hex("{}")}")`);
    await until(ed, "(buffer-text)", "[ckpt main/1-a4", 180);
    await settleRefireFrom(ed, "801", "done");
    expect(await untilStatus(ed, "idle", 120)).toBe("idle");
    // A fresh editor on the same thread root: the persisted log is all
    // it has (no in-memory pairs, no live events).
    const ed2 = await armed();
    const lines = strip(String(e(ed2, "(fikra/event/fikra-event-replay)").value)).split("\n");
    const rowOf = (needle: string) => lines.find((l) => l.includes(needle)) ?? "";
    expect(rowOf("c162.txt")).toContain("[ckpt main/1-a2 ✓]");
    expect(rowOf("e162.txt")).toContain("[ckpt main/1-a4 ✓]");
    expect(treeOf(ed2, "1-a2")).toContain("c162.txt");
    expect(treeOf(ed2, "1-a2")).not.toContain("e162.txt");
    expect(treeOf(ed2, "1-a4")).toContain("e162.txt");
    expect(treeOf(ed2, "1-a4")).toContain("c162.txt");
    expect(blobOf(ed2, "1-a2", "c162.txt")).toContain("EDIT-C");
    expect(blobOf(ed2, "1-a4", "e162.txt")).toContain("EDIT-E");
  }, 90000);

  tt("a held batch counts its chunks ONCE", async () => {
    const ed = await armed();
    e(ed, "(require-module fikra/transient)");
    const logPath = String(e(ed, "(fikra/thread/fikra-thread-log-path)").value);
    const aside = `${logPath}.aside`;
    // A fresh editor has no log yet (nothing was emitted).
    if (existsSync(logPath)) renameSync(logPath, aside);
    mkdirSync(logPath);
    const delta = '(list (list (list "kind" "text-delta") (list "speaker" "assistant") (list "text" "one")))';
    e(ed, `(fikra/event/fikra-event-emit-held-for "main" ${delta} t)`);
    e(ed, '(fikra/event/fikra-event-flush-undelivered "main")');
    expect(Number(e(ed, '(fikra/transient/fikra-transient-chunks-of "main")').value)).toBe(0);
    rmdirSync(logPath);
    if (existsSync(aside)) renameSync(aside, logPath);
    e(ed, '(fikra/event/fikra-event-flush-undelivered "main")');
    expect(Number(e(ed, '(fikra/transient/fikra-transient-chunks-of "main")').value)).toBe(1);
  });
});

// r154: the suite's own plumbing, guarded. Bun's fetch keeps at most 256
// connections open per origin and QUEUES the 257st forever; with the stub
// never answering, a run that leaks one request per test goes deaf in its
// tail (bodies stop being recorded; sentinel re-fires never reach the
// server). The afterEach abort retires each editor's requests — this
// LAST test proves the stub still hears the suite after everything else.
describe("ollama suite plumbing (r154)", () => {
  tt("the stub still receives requests at the END of the suite", async () => {
    const ed = await armed();
    e(ed, '(fikra/chat/fikra-turn-send "tail plumbing check")');
    const body = JSON.parse(await lastBodyFor("tail plumbing check")) as { model?: string };
    expect(body.model).toBe("test:fake");
  });
});
