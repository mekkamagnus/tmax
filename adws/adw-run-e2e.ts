#!/usr/bin/env bun
/**
 * Generic, data-driven e2e ADW (AI Development Workflow) runner for tmax.
 *
 * An ADW is a workflow meant to be run and fully executed on its own: it brings
 * up its own daemon from a clean slate, drives keys/eval, asserts expected
 * state via T-Lisp queries, tears down, and exits non-zero on any failure.
 * No tmux session, no TUI frame, no human-watched screen required.
 *
 *   bun adws/adw-run-e2e.ts adws/playbooks/which-key.yaml
 *   bun adws/adw-run-e2e.ts adws/playbooks/markdown.yaml adws/playbooks/_smoke.yaml
 *   bun adws/adw-run-e2e.ts                 # runs every adws/playbooks/*.yaml
 *
 * Authored with the project's functional patterns (rules/functional-programming.md):
 * client ops return Either instead of throwing; the daemon readiness poll,
 * fixture I/O, and per-step `wait` settle are TaskEither chains (retry/delay);
 * the playbook lint guard uses the Validation applicative to accumulate ALL
 * offending steps in one pass; and the playbook run is composed as a pipe.
 *
 * YAML schema (see adws/playbooks/README.md for the full reference):
 *   name: <string>
 *   mode: <major mode>              # verified via (major-mode-get) after open
 *   setup:
 *     - action: setup_file
 *       var: FILE                   # becomes ${FILE} in steps
 *       name: <filename>
 *       content: |
 *         <file content>
 *   steps:
 *     - name: <description>         # optional, shown in output
 *       keys: <sequence>            # e.g. "]h", ",xl", "iHello<Escape>"; via tmaxclient --keys
 *       eval: <tlisp expr>          # ALTERNATIVE to keys
 *       setup_cursor: [line, col]   # optional: (cursor-move line col) before this step
 *       wait: <ms>                  # optional: settle after keys/eval (default 120 keys / 150 eval)
 *       expect:                     # optional; ALL asserts must pass
 *         cursor_line: <number>
 *         cursor_column: <number>
 *         line_text: <string>              # exact match of cursor line
 *         line_text_matches: <regex>       # regex against cursor line
 *         mode: <string>                   # (major-mode-get)
 *         buffer_contains: <string>        # substring anywhere in buffer
 *         status_message: <string>         # substring of (editor-status)
 *         result_contains: <string>        # substring of the step's eval return value
 *   cleanup: true                   # remove temp files + kill buffer
 */

import { spawn, Readable } from "child_process";
import { realpathSync, promises as fs, existsSync } from "fs";
import { join } from "path";
import { Either, TaskEither, TaskEitherUtils } from "../src/utils/task-either.ts";
import { Option } from "../src/utils/option.ts";
import { Validation } from "../src/utils/validation.ts";
import { pipe } from "../src/utils/pipeline.ts";
import {
  createFileSystemError,
  createValidationError,
  type AppError,
} from "../src/error/types.ts";

const PROJECT_ROOT = realpathSync(join(import.meta.dir, ".."));
const CLIENT_CMD = join(PROJECT_ROOT, "bin", "tmaxclient");
const TMAX_UID = process.getuid?.() ?? 501;
const SOCKET_PATH = `/tmp/tmax-${TMAX_UID}/server`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExpectBlock {
  cursor_line?: number;
  cursor_column?: number;
  line_text?: string;
  line_text_matches?: string;
  mode?: string;
  buffer_contains?: string;
  status_message?: string;
  result_contains?: string;
  screen_contains?: string;       // HEADED: substring of the rendered TUI screen (tmux capture-pane)
  screen_not_contains?: string;   // HEADED: substring that must NOT appear on the rendered screen
}

interface Step {
  name?: string;
  keys?: string;
  eval?: string;
  setup_cursor?: [number, number];
  wait?: number;
  headed?: boolean;   // force this step through the real TUI (tmux send-keys)
  expect?: ExpectBlock;
}

interface SetupAction {
  action: string;
  var?: string;
  name?: string;
  content?: string;
}

interface Playbook {
  name: string;
  mode?: string;
  setup?: SetupAction[];
  steps: Step[];
  cleanup?: boolean;
}

interface StepResult {
  name: string;
  passed: boolean;
  details: string[];
}

// ---------------------------------------------------------------------------
// Daemon control — TaskEither-based readiness poll + teardown
// ---------------------------------------------------------------------------

let daemonChild: ReturnType<typeof spawn> | null = null;

/**
 * Stop any stale daemon squatting on the socket: send (editor-quit), then poll
 * for the socket to disappear, then SIGKILL any child we spawned as a last
 * resort. Composed as a single TaskEither that swallows expected errors —
 * teardown must not throw.
 */
async function stopDaemon(): Promise<void> {
  const teardown: TaskEither<never, void> = TaskEither.tryCatch(
    async () => {
      try {
        const proc = spawn(CLIENT_CMD, ["--socket", SOCKET_PATH, "eval", "(editor-quit)"], {
          stdio: "ignore",
        });
        await waitForExit(proc);
      } catch {}
      for (let i = 0; i < 30; i++) {
        if (!socketExists()) break;
        await sleep(100);
      }
      if (daemonChild && !daemonChild.killed) {
        try { daemonChild.kill("SIGKILL"); } catch {}
        daemonChild = null;
      }
    },
    () => undefined as never, // teardown errors are swallowed
  );
  await teardown.run();
}

/**
 * Start a fresh daemon: stop any existing one, remove a lingering socket, spawn
 * `src/server/server.ts` directly (no extra `bun run daemon` process layer),
 * then poll until the socket is responsive on `(+ 1 1)`.
 *
 * The readiness poll is expressed with TaskEitherUtils.retry: each attempt
 * waits for the socket file, then evals `(+ 1 1)` and checks for "2".
 */
async function startDaemon(): Promise<Either<string, void>> {
  await stopDaemon();
  for (let i = 0; i < 30; i++) {
    if (!socketExists()) break;
    await sleep(100);
  }
  try { await fs.unlink(SOCKET_PATH); } catch {}

  daemonChild = spawn("bun", ["src/server/server.ts"], {
    cwd: PROJECT_ROOT,
    stdio: "ignore",
    env: { ...process.env, TMAX_SOCKET: SOCKET_PATH },
  });
  daemonChild.on("error", () => {});

  // Wait for the socket file to appear (up to 5s).
  const socketAppeared: TaskEither<string, void> = TaskEitherUtils.retry(
    () =>
      TaskEither.from(async () =>
        socketExists()
          ? Either.right<string, void>(undefined)
          : Either.left<string, void>("socket not yet present"),
      ),
    50,
    100,
  );
  const socketRes = await socketAppeared.run();
  if (Either.isLeft(socketRes)) {
    return Either.left("Daemon failed to start (socket never appeared)");
  }

  // Now poll until the daemon is responsive on `(+ 1 1)`.
  const ready: TaskEither<string, void> = TaskEitherUtils.retry(
    () =>
      TaskEither.from(async () => {
        const r = await evalExpr("(+ 1 1)");
        return Either.isRight(r) && r.right === "2"
          ? Either.right<string, void>(undefined)
          : Either.left<string, void>("daemon not responsive");
      }),
    20,
    100,
  );
  const readyRes = await ready.run();
  if (Either.isLeft(readyRes)) {
    return Either.left("Daemon socket appeared but not responsive");
  }
  return Either.right(undefined);
}

// ---------------------------------------------------------------------------
// Headed TUI lifecycle (tmux) — the playwright "browser" analogue
// ---------------------------------------------------------------------------
//
// A headed step drives a REAL tmax TUI rendered in a dedicated tmux session,
// sending keys through tmux (real terminal input) and asserting on the captured
// screen. This makes "playbook passes" ⇔ "a fresh `tmax` shows the same thing".
// Pure-headless playbooks never start a session (backward compatible).

let headedSession: string | null = null;

/** True if the process can drive a headed TUI (tmux installed + not forced off). */
let forceHeadless = false;

/**
 * The tmux client the runner was invoked from (if any), so we can switch its
 * view to the headed TUI on start and back on teardown. TMUX = "<socket>,<pid>,<id>".
 */
const ORIGIN_CLIENT: string | null = process.env.TMUX?.split(",")[2] ?? null;

/** The session the origin client was viewing before we switched it (to return to). */
let originSession: string | null = null;

/** A unique-ish tmux session name per runner process, to avoid collisions. */
function headedSessionName(): string {
  return `tmax-adw-${process.pid}`;
}

/** Move the originating client's view to a tmux session (no-op if not in tmux). */
async function switchClientTo(session: string): Promise<void> {
  if (!ORIGIN_CLIENT) return; // runner not invoked from inside tmux
  try { await runQuiet(["tmux", "switch-client", "-c", ORIGIN_CLIENT, "-t", session]); } catch {}
}

/**
 * Spawn a TUI client inside a detached tmux session connected to the daemon
 * socket. Poll until the session exists AND a daemon eval responds (the TUI has
 * a frame registered). Mirrors startDaemon's readiness-poll shape.
 *
 * If the runner was invoked from inside tmux, switch that client's view to the
 * new session so the user watches the TUI live as the playbook drives it.
 */
async function startHeaded(): Promise<Either<string, string>> {
  if (forceHeadless) {
    return Either.left("cannot run a headed step with --headless");
  }
  const session = headedSessionName();
  // Kill any stale session with the same name from a crashed prior run.
  await stopHeaded(session);
  try {
    const proc = spawn(
      "tmux",
      [
        "new-session", "-d", "-s", session, "-x", "94", "-y", "29",
        `cd ${PROJECT_ROOT} && TMAX_SOCKET=${SOCKET_PATH} bun src/client/tui-client.ts`,
      ],
      { stdio: "ignore" },
    );
    proc.on("error", () => {});
    await waitForExit(proc);
  } catch (e) {
    return Either.left(`failed to spawn headed tmux session: ${String(e)}`);
  }
  // Poll until the session exists and the daemon is responsive (TUI registered).
  const ready: TaskEither<string, string> = TaskEitherUtils.retry(
    () =>
      TaskEither.from(async () => {
        const exists = (await runQuiet(["tmux", "has-session", "-t", session])) === 0;
        if (!exists) return Either.left<string, string>("tmux session not yet up");
        const r = await evalExpr("(+ 1 1)");
        return Either.isRight(r) && r.right === "2"
          ? Either.right<string, string>(session)
          : Either.left<string, string>("TUI not yet responsive");
      }),
    30,
    100,
  );
  const res = await ready.run();
  if (Either.isLeft(res)) {
    return Either.left("headed TUI failed to become responsive within 3s");
  }
  headedSession = session;
  // Bring the originating client's view to the headed TUI so it's visible live.
  // Record the session it was viewing first, so we can return it on teardown.
  if (ORIGIN_CLIENT) {
    try {
      const out = await runCapture(["tmux", "display-message", "-p", "-t", ORIGIN_CLIENT, "#{session_name}"]);
      if (Either.isRight(out)) originSession = out.right.trim() || null;
    } catch {}
    await switchClientTo(session);
  }
  return Either.right(session);
}

/**
 * Kill a headed tmux session. Idempotent — errors swallowed (teardown must not
 * throw), same pattern as stopDaemon. If we moved the origin client's view to
 * the headed session at start, move it back before killing.
 */
async function stopHeaded(session: string | null = headedSession): Promise<void> {
  if (!session) return;
  if (session === headedSession && ORIGIN_CLIENT && originSession) {
    try { await runQuiet(["tmux", "switch-client", "-c", ORIGIN_CLIENT, "-t", originSession]); } catch {}
    originSession = null;
  }
  try { await runQuiet(["tmux", "kill-session", "-t", session]); } catch {}
  if (session === headedSession) headedSession = null;
}

// Run a command, return its exit code (used for tmux has-session/kill-session).
function runQuiet(cmd: string[]): Promise<number> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(cmd[0]!, cmd.slice(1), { stdio: "ignore" });
      proc.on("close", (code) => resolve(code ?? 0));
      proc.on("error", () => resolve(1));
    } catch {
      resolve(1);
    }
  });
}

// Run a command, return its stdout as an Either (used for tmux display-message).
async function runCapture(cmd: string[]): Promise<Either<string, string>> {
  try {
    const proc = spawn(cmd[0]!, cmd.slice(1), { stdio: "pipe" });
    const stdout = await streamToText(proc.stdout!);
    await waitForExit(proc);
    return Either.right(stdout);
  } catch (e) {
    return Either.left(String(e));
  }
}

// ---------------------------------------------------------------------------
// Headed input + screen capture
// ---------------------------------------------------------------------------

/**
 * tmux send-keys translation table for special keys (aligned with the bash UI
 * harness in test/ui/core/input.sh). A bare "C-g" is NOT translated — the
 * daemon --keys path splits it into 3 chars; in headed mode you must use the
 * bracketed "<Escape>" form, same as the headless path's documented requirement.
 */
const TMUX_KEY_MAP: Record<string, string> = {
  "<Escape>": "Escape",
  "<ESC>": "Escape",
  "<Enter>": "C-m",
  "<RET>": "C-m",
  "<Space>": "Space",
  "<Tab>": "Tab",
  "<TAB>": "Tab",
  "<Backspace>": "BSpace",
  "<BS>": "BSpace",
  "<DEL>": "Delete",
};

/**
 * Send a key sequence to the headed TUI via tmux send-keys, char by char. Each
 * <Token> is looked up in TMUX_KEY_MAP; every other char is sent literally with
 * `-l` (no tmux interpretation). Returns Either; the daemon-side keys path is
 * not used here because the point is to drive the REAL terminal input.
 */
async function sendKeysTmux(sequence: string): Promise<Either<string, void>> {
  if (!headedSession) return Either.left("no headed TUI session is running");
  const tokens: string[] = [];
  let i = 0;
  while (i < sequence.length) {
    if (sequence[i] === "<") {
      const end = sequence.indexOf(">", i);
      if (end !== -1) {
        tokens.push(sequence.substring(i, end + 1));
        i = end + 1;
        continue;
      }
    }
    tokens.push(sequence[i]!);
    i++;
  }
  for (const tok of tokens) {
    const mapped = TMUX_KEY_MAP[tok];
    const args = mapped
      ? ["send-keys", "-t", headedSession, mapped]
      : ["send-keys", "-l", "-t", headedSession, tok];
    const rc = await runQuiet(["tmux", ...args]);
    if (rc !== 0) return Either.left(`tmux send-keys failed for token ${JSON.stringify(tok)} (rc=${rc})`);
  }
  return Either.right(undefined);
}

/** Capture the headed TUI's screen as plain text (no ANSI), for screen matchers. */
async function captureScreen(): Promise<Either<string, string>> {
  if (!headedSession) return Either.left("no headed TUI session is running");
  try {
    const proc = spawn("tmux", ["capture-pane", "-t", headedSession, "-p", "-e", "-J"], { stdio: "pipe" });
    const stdout = await streamToText(proc.stdout!);
    await waitForExit(proc);
    // Strip ANSI escapes so substring matching is reliable.
    const plain = stdout.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
    return Either.right(plain);
  } catch (e) {
    return Either.left(`tmux capture-pane failed: ${String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// Client operations — each returns Either instead of throwing
// ---------------------------------------------------------------------------

async function openFile(filePath: string): Promise<Either<string, string>> {
  return runClient([filePath]);
}

async function sendKeys(sequence: string): Promise<Either<string, string>> {
  return runClient(["--keys", sequence]);
}

async function evalExpr(expr: string): Promise<Either<string, string>> {
  const res = await runClient(["--eval", expr]);
  return Either.map(res, (s) => s.trim());
}

/** Low-level: spawn tmaxclient with the given args, return trimmed stdout. */
async function runClient(args: string[]): Promise<Either<string, string>> {
  try {
    const proc = spawn(CLIENT_CMD, ["--socket", SOCKET_PATH, ...args], { stdio: "pipe" });
    const stdout = await streamToText(proc.stdout!);
    const stderr = await streamToText(proc.stderr!);
    await waitForExit(proc);
    if (stderr.includes("ERROR") || stderr.includes("Failed")) {
      return Either.left(stderr);
    }
    return Either.right(stdout);
  } catch (e) {
    return Either.left(String(e));
  }
}

// ---------------------------------------------------------------------------
// State queries (map directly to T-Lisp the interpreter exposes)
// ---------------------------------------------------------------------------

async function getCursorLine(): Promise<Either<string, number>> {
  const r = await evalExpr("(cursor-line)");
  return Either.flatMap(r, (s) => {
    const n = parseInt(s, 10);
    return Number.isNaN(n)
      ? Either.left(`cursor-line not numeric: "${s}"`)
      : Either.right<string, number>(n);
  });
}

async function getCursorColumn(): Promise<Either<string, number>> {
  const r = await evalExpr("(cursor-column)");
  return Either.flatMap(r, (s) => {
    const n = parseInt(s, 10);
    return Number.isNaN(n)
      ? Either.left(`cursor-column not numeric: "${s}"`)
      : Either.right<string, number>(n);
  });
}

async function getCursorLineText(): Promise<Either<string, string>> {
  return evalExpr("(buffer-get-line (cursor-line))");
}

async function getMajorMode(): Promise<Either<string, string>> {
  return evalExpr("(major-mode-get)");
}

async function getBufferText(): Promise<Either<string, string>> {
  return evalExpr("(buffer-text)");
}

async function getStatusMessage(): Promise<Either<string, string>> {
  return evalExpr("(editor-status)");
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The daemon socket is a Unix domain socket file. Bun.file().exists() only
// recognizes regular files and returns false for sockets, so use existsSync.
function socketExists(): boolean {
  return existsSync(SOCKET_PATH);
}

async function streamToText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

function waitForExit(proc: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    proc.on("close", (code) => resolve(code));
    proc.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Lint guard — Validation applicative accumulates ALL offending steps
// ---------------------------------------------------------------------------

interface LintIssue {
  stepIndex: number;
  message: string;
}

/**
 * Static validation. The JSON-RPC eval path (tmaxclient --eval → server →
 * interpreter) re-decodes backslashes, so any `eval` expression containing a
 * backslash arrives mangled. Drive such features via `keys` instead.
 *
 * Implemented with the Validation applicative so EVERY offending step is
 * reported in a single pass — an author fixes all of them per run, not one.
 */
function lintPlaybook(playbook: Playbook): Validation<LintIssue, Playbook> {
  const steps = playbook.steps ?? [];
  // Check every step, collecting ALL failures (not fail-fast). Each check is a
  // Validation; we fold them so errors accumulate across the whole list.
  const checks: Validation<LintIssue, Step>[] = steps.map((step, i) => {
    if (step.eval !== undefined && step.eval.includes("\\")) {
      return Validation.failure<LintIssue, Step>({
        stepIndex: i,
        message:
          `step ${i + 1} (${step.name ?? "eval"}): expression contains a backslash, which the ` +
          `JSON-RPC eval path corrupts. Drive this feature via 'keys' instead ` +
          `(add a keybinding first if the feature lacks one).`,
      });
    }
    return Validation.success<LintIssue, Step>(step);
  });
  // Accumulate: gather every check's errors, only succeed if none failed.
  const allErrors: LintIssue[] = [];
  const okSteps: Step[] = [];
  for (const c of checks) {
    if (c.isFailure()) allErrors.push(...c.getErrors());
    else okSteps.push(c.getValue());
  }
  return allErrors.length > 0
    ? Validation.failure<LintIssue, Playbook>(allErrors)
    : Validation.success<LintIssue, Playbook>({ ...playbook, steps: okSteps });
}

/**
 * Pre-flight lint: parse + lint a playbook file WITHOUT starting the daemon.
 * Returns the accumulated issues (empty if clean). Called from main() before
 * startDaemon() so a malformed playbook fails fast.
 */
async function lintPlaybookFile(path: string): Promise<LintIssue[]> {
  const raw = await fs.readFile(path, "utf-8");
  let playbook: Playbook;
  try {
    playbook = Bun.YAML.parse(raw) as Playbook;
  } catch (e) {
    return [{ stepIndex: -1, message: `Failed to parse ${path}: ${String(e)}` }];
  }
  return lintPlaybook(playbook).fold(
    (issues) => issues,
    () => [],
  );
}

// ---------------------------------------------------------------------------
// Assertion engine
// ---------------------------------------------------------------------------

interface AssertOutcome {
  pass: boolean;
  detail: string;
}

async function evaluateExpect(expect: ExpectBlock, evalResult = ""): Promise<AssertOutcome[]> {
  const outcomes: AssertOutcome[] = [];

  if (expect.cursor_line !== undefined) {
    const got = await getCursorLine();
    const want = expect.cursor_line;
    const ok = Either.isRight(got) && got.right === want;
    outcomes.push({
      pass: ok,
      detail: `cursor_line: expected ${want}, got ${Either.isRight(got) ? got.right : got.left}`,
    });
  }
  if (expect.cursor_column !== undefined) {
    const got = await getCursorColumn();
    const want = expect.cursor_column;
    const ok = Either.isRight(got) && got.right === want;
    outcomes.push({
      pass: ok,
      detail: `cursor_column: expected ${want}, got ${Either.isRight(got) ? got.right : got.left}`,
    });
  }
  if (expect.line_text !== undefined) {
    const got = await getCursorLineText();
    const want = expect.line_text;
    const ok = Either.isRight(got) && got.right === want;
    outcomes.push({
      pass: ok,
      detail: `line_text: expected ${JSON.stringify(want)}, got ${JSON.stringify(Either.isRight(got) ? got.right : got.left)}`,
    });
  }
  if (expect.line_text_matches !== undefined) {
    const got = await getCursorLineText();
    if (Either.isRight(got)) {
      let ok = false;
      try {
        ok = new RegExp(expect.line_text_matches).test(got.right);
      } catch (e) {
        outcomes.push({
          pass: false,
          detail: `line_text_matches: invalid regex ${JSON.stringify(expect.line_text_matches)}: ${String(e)}`,
        });
      }
      outcomes.push({
        pass: ok,
        detail: `line_text_matches: /${expect.line_text_matches}/ against ${JSON.stringify(got.right)}`,
      });
    } else {
      outcomes.push({ pass: false, detail: `line_text_matches: ${got.left}` });
    }
  }
  if (expect.mode !== undefined) {
    const got = await getMajorMode();
    const want = expect.mode;
    const ok = Either.isRight(got) && got.right === want;
    outcomes.push({
      pass: ok,
      detail: `mode: expected ${JSON.stringify(want)}, got ${JSON.stringify(Either.isRight(got) ? got.right : got.left)}`,
    });
  }
  if (expect.buffer_contains !== undefined) {
    const got = await getBufferText();
    const ok = Either.isRight(got) && got.right.includes(expect.buffer_contains);
    outcomes.push({
      pass: ok,
      detail: `buffer_contains: substring ${JSON.stringify(expect.buffer_contains)} ${ok ? "found" : "NOT found"}`,
    });
  }
  if (expect.status_message !== undefined) {
    const got = await getStatusMessage();
    const ok = Either.isRight(got) && got.right.includes(expect.status_message);
    outcomes.push({
      pass: ok,
      detail: `status_message: substring ${JSON.stringify(expect.status_message)} in ${JSON.stringify(Either.isRight(got) ? got.right : got.left)} ${ok ? "found" : "NOT found"}`,
    });
  }
  if (expect.result_contains !== undefined) {
    // Checks the return value of the step's eval expression. More reliable
    // than (editor-status) for functions that report via their return value.
    const ok = evalResult.includes(expect.result_contains);
    outcomes.push({
      pass: ok,
      detail: `result_contains: substring ${JSON.stringify(expect.result_contains)} in ${JSON.stringify(evalResult)} ${ok ? "found" : "NOT found"}`,
    });
  }
  if (expect.screen_contains !== undefined) {
    // HEADED: asserts on the rendered TUI screen (tmux capture-pane, ANSI
    // stripped). This is what makes a playbook match what a user sees.
    const got = await captureScreen();
    const ok = Either.isRight(got) && got.right.includes(expect.screen_contains);
    outcomes.push({
      pass: ok,
      detail: `screen_contains: substring ${JSON.stringify(expect.screen_contains)} ${ok ? "found on screen" : "NOT found on screen"}`,
    });
  }
  if (expect.screen_not_contains !== undefined) {
    const got = await captureScreen();
    const present = Either.isRight(got) && got.right.includes(expect.screen_not_contains);
    outcomes.push({
      pass: !present,
      detail: `screen_not_contains: substring ${JSON.stringify(expect.screen_not_contains)} ${present ? "still present on screen" : "absent from screen"}`,
    });
  }

  return outcomes;
}

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

/** Resolve the effective settle delay via Option.fold over the optional wait. */
function effectiveWait(step: Step, branch: "keys" | "eval"): number {
  const defaultMs = branch === "keys" ? 120 : 150;
  // Screen assertions need a longer default settle: the TUI must repaint after
  // the editor state mutates and the poll cycle picks it up.
  const usesScreen = !!step.expect && (step.expect.screen_contains !== undefined || step.expect.screen_not_contains !== undefined);
  if (usesScreen && step.wait === undefined) return 300;
  return Option.fromNullable(step.wait).fold(() => defaultMs, (ms) => ms);
}

/** A step is headed if it declares `headed: true` OR asserts on the screen. */
function stepIsHeaded(step: Step): boolean {
  if (step.headed) return true;
  if (step.expect && (step.expect.screen_contains !== undefined || step.expect.screen_not_contains !== undefined)) {
    return true;
  }
  return false;
}

async function runStep(step: Step, index: number): Promise<StepResult> {
  const label = step.name ?? `step ${index + 1}`;
  const details: string[] = [];
  let evalResult = "";

  if (step.keys && step.eval) {
    return {
      name: label,
      passed: false,
      details: ["step has both keys and eval — they are mutually exclusive"],
    };
  }

  // Optional pre-positioning.
  if (step.setup_cursor) {
    const [line, col] = step.setup_cursor;
    await evalExpr(`(cursor-move ${line} ${col})`);
    await TaskEitherUtils.delay(60).run();
  }

  if (step.keys) {
    // Headed steps drive the real TUI (tmux send-keys); headless steps drive
    // the daemon client directly. Same assertion path either way.
    const res = stepIsHeaded(step)
      ? await sendKeysTmux(step.keys).then((r) => (Either.isLeft(r) ? Either.left(r.left) : Either.right("")))
      : await sendKeys(step.keys);
    if (Either.isLeft(res)) {
      details.push(`keys "${step.keys}" failed: ${res.left}`);
      return { name: label, passed: false, details };
    }
    await TaskEitherUtils.delay(effectiveWait(step, "keys")).run();
  } else if (step.eval) {
    const res = await evalExpr(step.eval);
    if (Either.isLeft(res)) {
      details.push(`eval "${step.eval}" failed: ${res.left}`);
      return { name: label, passed: false, details };
    }
    evalResult = res.right;
    await TaskEitherUtils.delay(effectiveWait(step, "eval")).run();
  }

  if (!step.expect || Object.keys(step.expect).length === 0) {
    return { name: label, passed: true, details }; // pure action step, no assertion
  }

  const outcomes = await evaluateExpect(step.expect, evalResult);
  let passed = true;
  for (const o of outcomes) {
    details.push(o.detail);
    if (!o.pass) passed = false;
  }
  return { name: label, passed, details };
}

// ---------------------------------------------------------------------------
// Playbook execution — composed as a pipe
// ---------------------------------------------------------------------------

interface PlaybookContext {
  playbook: Playbook;
  tempFiles: string[];
  vars: Map<string, string>;
}

interface PlaybookOutcome {
  passed: number;
  failed: number;
}

/** Resolve ${VAR} references in a step's keys/eval from the context vars map. */
function resolveStep(step: Step, ctx: PlaybookContext): Step {
  const resolve = (val: string): string =>
    val.replace(/\$\{(\w+)\}/g, (_m, key) => ctx.vars.get(key) ?? `\${${key}}`);
  return {
    ...step,
    keys: step.keys ? resolve(step.keys) : step.keys,
    eval: step.eval ? resolve(step.eval) : step.eval,
  };
}

/** Run setup_file actions, populate ctx.vars and ctx.tempFiles. */
function setupFixtures(ctx: PlaybookContext): TaskEither<AppError, PlaybookContext> {
  const tasks: TaskEither<AppError, void>[] = (ctx.playbook.setup ?? [])
    .filter((s) => s.action === "setup_file")
    .map((s) => {
      const fileName = s.name ?? `tmax-kbd-${Date.now()}.txt`;
      const filePath = join(PROJECT_ROOT, fileName);
      ctx.tempFiles.push(filePath);
      if (s.var) ctx.vars.set(s.var, filePath);
      console.log(`  setup_file → ${s.var ?? "(no var)"} = ${filePath}`);
      return TaskEitherUtils.writeFile(filePath, s.content ?? "").mapLeft((err) =>
        createFileSystemError("WriteError", err, filePath),
      );
    });
  return TaskEither.sequence(tasks).map(() => ctx);
}

/** Open the first setup file (the typical entry point) and verify mode. */
function openAndVerifyMode(ctx: PlaybookContext): TaskEither<AppError, PlaybookContext> {
  return TaskEither.from(async () => {
    const firstFile = ctx.vars.size > 0 ? Array.from(ctx.vars.values())[0] : undefined;
    if (firstFile) {
      const open = await openFile(firstFile);
      if (Either.isLeft(open)) {
        return Either.left<AppError, PlaybookContext>(
          createFileSystemError("ReadError", `could not open ${firstFile}: ${open.left}`, firstFile),
        );
      }
      await TaskEitherUtils.delay(400).run();
    }
    if (ctx.playbook.mode) {
      const mode = await getMajorMode();
      if (Either.isLeft(mode) || mode.right !== ctx.playbook.mode) {
        return Either.left<AppError, PlaybookContext>(
          createValidationError(
            "ConstraintViolation",
            `expected mode "${ctx.playbook.mode}", got ${JSON.stringify(Either.isRight(mode) ? mode.right : mode.left)}`,
          ),
        );
      }
      console.log(`  ✓ mode: ${mode.right}`);
    }
    return Either.right<AppError, PlaybookContext>(ctx);
  });
}

/** Run every step, printing per-step results. */
function runSteps(ctx: PlaybookContext): TaskEither<AppError, PlaybookOutcome> {
  return TaskEither.from(async () => {
    let passed = 0;
    let failed = 0;
    for (let i = 0; i < ctx.playbook.steps.length; i++) {
      const step = resolveStep(ctx.playbook.steps[i]!, ctx);
      const res = await runStep(step, i);
      if (res.passed) {
        passed++;
        console.log(`  ✓ ${res.name}${res.details.length ? " — " + res.details.join("; ") : ""}`);
      } else {
        failed++;
        console.error(`  ❌ FAIL: ${res.name}`);
        for (const d of res.details) console.error(`      ${d}`);
      }
    }
    // Steps run to completion (each reports its own pass/fail); the pipeline
    // reports failure only if at least one step failed.
    const outcome: PlaybookOutcome = { passed, failed };
    return failed === 0
      ? Either.right<AppError, PlaybookOutcome>(outcome)
      : Either.left<AppError, PlaybookOutcome>(
          createValidationError("ConstraintViolation", `${failed} step(s) failed`, undefined, undefined, "steps"),
        );
  });
}

/** Teardown that always runs: kill buffer + remove temp files. */
async function cleanup(ctx: PlaybookContext): Promise<void> {
  try { await evalExpr("(kill-buffer)"); } catch {}
  for (const f of ctx.tempFiles) {
    try { await fs.unlink(f); } catch {}
  }
}

/**
 * Compose the playbook run as a pipe. Cleanup is guaranteed whether the chain
 * succeeds or short-circuits on a Left (the FP equivalent of a finally block).
 */
async function runPlaybook(path: string): Promise<PlaybookOutcome> {
  const raw = await fs.readFile(path, "utf-8");
  const ctx: PlaybookContext = { playbook: { name: "", steps: [] }, tempFiles: [], vars: new Map() };

  // Parse + lint as one TaskEither chain. Lint uses the Validation applicative
  // to accumulate ALL offending steps, then folds into an Either<AppError, _>.
  const parseAndLint: TaskEither<AppError, Playbook> = TaskEither.fromSync<Playbook, AppError>(
    () => Bun.YAML.parse(raw) as Playbook,
    (e) => createValidationError("ParseError", `Failed to parse ${path}: ${String(e)}`),
  ).flatMap((playbook) =>
    lintPlaybook(playbook).fold<TaskEither<AppError, Playbook>>(
      (issues) =>
        TaskEither.left<AppError, Playbook>(
          createValidationError(
            "ConstraintViolation",
            `playbook failed lint (${issues.length} issue(s)):\n` +
              issues.map((it) => `  ${it.message}`).join("\n"),
          ),
        ),
      (checked) => TaskEither.right<AppError, Playbook>(checked),
    ),
  );

  const linted = await parseAndLint.run();
  if (Either.isLeft(linted)) {
    console.error(`  ❌ ${linted.left.message}`);
    return { passed: 0, failed: 1 };
  }
  ctx.playbook = linted.right;
  console.log(`\n=== ${ctx.playbook.name} (${path}) ===`);

  // Headed detection: if ANY step is headed (declares `headed` or uses a screen
  // matcher), bring up a real TUI in tmux first. Pure-headless playbooks skip
  // this entirely (backward compatible, zero tmux overhead).
  const needsHeaded = ctx.playbook.steps.some(stepIsHeaded);
  if (needsHeaded) {
    const started = await startHeaded();
    if (Either.isLeft(started)) {
      console.error(`  ❌ ${started.left}`);
      return { passed: 0, failed: 1 };
    }
    console.log(`  ✓ headed TUI: tmux attach -t ${headedSession} (to watch live)`);
  }

  let outcome: PlaybookOutcome = { passed: 0, failed: 0 };
  try {
    const result = await pipe
      .from(setupFixtures(ctx))
      .step((c) => openAndVerifyMode(c))
      .step((c) => runSteps(c))
      .effect((o) => {
        outcome = o;
      })
      .build()
      .run();
    if (Either.isLeft(result)) {
      console.error(`  ❌ ${result.left.message}`);
      outcome = { passed: outcome.passed, failed: outcome.failed + 1 };
    }
  } finally {
    if (ctx.playbook.cleanup !== false) {
      await cleanup(ctx);
    }
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  // CLI flags: --headless forces every step headless (CI: no tmux). Screen
  // matchers then fail fast, since they cannot run without a real TUI.
  forceHeadless = rawArgs.includes("--headless");
  const args = rawArgs.filter((a) => a !== "--headless");
  let paths: string[];
  if (args.length > 0) {
    paths = args;
  } else {
    const playbooksDir = join(import.meta.dir, "playbooks");
    try {
      const entries = await fs.readdir(playbooksDir);
      // Run all playbooks EXCEPT throwaway lint/self-test fixtures by default.
      paths = entries
        .filter((f) => f.endsWith(".yaml") && !f.startsWith("_"))
        .map((f) => join(playbooksDir, f))
        .sort();
    } catch {
      console.error(`No playbooks found in ${playbooksDir} and none given as arguments.`);
      process.exit(1);
    }
  }

  if (paths.length === 0) {
    console.error("No e2e YAML playbooks to run.");
    process.exit(1);
  }

  // Pre-flight lint: parse + lint EVERY playbook before starting the daemon,
  // so a malformed playbook fails fast (no 10s daemon startup wasted). Issues
  // accumulate per file via the Validation applicative.
  let lintHadFailures = false;
  for (const p of paths) {
    const issues = await lintPlaybookFile(p);
    if (issues.length > 0) {
      lintHadFailures = true;
      console.error(`\n❌ ${p} failed lint (${issues.length} issue(s)):`);
      for (const it of issues) console.error(`  ${it.message}`);
    }
  }
  if (lintHadFailures) {
    console.error("\nFix the lint issues above before running.");
    process.exit(1);
  }

  console.log("Starting daemon...");
  const started = await startDaemon();
  if (Either.isLeft(started)) {
    console.error(`Failed to start daemon: ${started.left}`);
    process.exit(1);
  }
  console.log(`✓ Daemon ready (${SOCKET_PATH})\n`);

  let totalPassed = 0;
  let totalFailed = 0;
  try {
    for (const p of paths) {
      const r = await runPlaybook(p);
      totalPassed += r.passed;
      totalFailed += r.failed;
    }
  } finally {
    await stopHeaded();
    await stopDaemon();
  }

  console.log(`\n${totalFailed === 0 ? "✅" : "❌"} ${totalPassed} passed, ${totalFailed} failed.`);
  process.exit(totalFailed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Runner crashed:", err);
  stopHeaded().finally(() => stopDaemon().finally(() => process.exit(1)));
});
