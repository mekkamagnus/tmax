import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

// #225 (RFC-027 §Phase 5 + RFC-013 §T-Lisp API) — workflows re-bound to
// CREATE-OR-APPEND threads, the backend switcher, custom workflow
// registration. Keyless: the replay backend + thread machinery.

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

let repoDir = "";
const repoDirs: string[] = [];
const originalCwd = process.cwd();

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "fikra-wk-"));
  repoDirs.push(repoDir);
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repoDir });
  execFileSync("git", ["branch", "-M", "main"], { cwd: repoDir });
  writeFileSync(join(repoDir, ".gitignore"), ".tmax/\n");
  writeFileSync(join(repoDir, "f.txt"), "x\n");
  execFileSync("git", ["add", "-A"], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repoDir });
  process.chdir(repoDir);
});

afterAll(() => {
  process.chdir(originalCwd);
  for (const d of repoDirs) rmSync(d, { recursive: true, force: true });
});

const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);

async function setup(content = "the selected code\nmore\n"): Promise<Editor> {
  const editor = await createStartedEditor(content);
  e(editor, "(require-module fikra/workflow)");
  e(editor, "(require-module fikra/adapter)");
  e(editor, "(require-module fikra/threads)");
  e(editor, "(require-module fikra/backend-replay)");
  // A replay fixture: every turn answers with one assistant text line
  // (the replay backend refuses turns without a loaded fixture).
  const fx = join(repoDir, "fixture.jsonl");
  writeFileSync(fx, '{"type":"assistant","message":{"content":[{"type":"text","text":"answer"}]}}\n');
  e(editor, `(fikra/backend-replay/fikra-backend-replay-load "${fx}")`);
  e(editor, '(fikra/adapter/fikra-set-backend-forced "replay")');
  e(editor, "(fikra/thread/fikra-thread-init)");
  return editor;
}

const logKinds = (id: string) =>
  readFileSync(join(repoDir, `.tmax/fikra/threads/${id}/events.jsonl`), "utf8")
    .trimEnd().split("\n").map((l) => JSON.parse(l).kind);

describe("#225 workflows — create-or-append labeled threads", () => {
  test("explain creates a labeled thread with context attached, streaming via replay", async () => {
    const editor = await setup();
    expect(String(e(editor, "(fikra-explain)").value)).not.toBe("___"); // ran
    // A thread EXISTS and is labeled explain (state.json).
    const id = String(e(editor, '(fikra-workflow-thread-for "explain")').value);
    expect(id).toBe("fix-1");
    expect(String(e(editor, "(fikra/thread/fikra-thread-current)").value)).toBe("fix-1");
    const state = JSON.parse(readFileSync(join(repoDir, ".tmax/fikra/threads/fix-1/state.json"), "utf8"));
    expect(state.workflow).toBe("explain");
    // The turn + context streamed into the thread's OWN log (replay backend:
    // turn-start from turn-begin; the user echo carries the context).
    const log = readFileSync(join(repoDir, ".tmax/fikra/threads/fix-1/events.jsonl"), "utf8");
    expect(log).toContain("code explainer"); // the specialized prompt
    expect(log).toContain("the selected code"); // the attached context
    expect(logKinds("fix-1")).toContain("turn-start");
  });

  test("repeated invocations APPEND to the same thread (no new thread)", async () => {
    const editor = await setup();
    e(editor, "(fikra-explain)");
    // Reload the one-chunk replay fixture per turn (a turn consumes a chunk).
    e(editor, `(fikra/backend-replay/fikra-backend-replay-load "${join(repoDir, "fixture.jsonl")}")`);
    e(editor, "(fikra-explain)");
    e(editor, `(fikra/backend-replay/fikra-backend-replay-load "${join(repoDir, "fixture.jsonl")}")`);
    e(editor, "(fikra-explain)");
    expect(String(e(editor, '(fikra-workflow-thread-for "explain")').value)).toBe("fix-1"); // SAME thread
    const starts = logKinds("fix-1").filter((k) => k === "turn-start");
    expect(starts.length).toBe(3); // three turns in ONE conversation
    // Only one workflow thread exists — no thread-per-invocation.
    const ids = (e(editor, "(fikra/thread/fikra-thread-ids)").value as { value: string }[]).map((v) => String(v.value));
    expect(ids.filter((i) => i.startsWith("fix-"))).toHaveLength(1);
  });

  test("each workflow gets its OWN labeled thread", async () => {
    const editor = await setup();
    e(editor, "(fikra-explain)");
    e(editor, "(fikra-fix)");
    expect(String(e(editor, '(fikra-workflow-thread-for "explain")').value)).toBe("fix-1");
    expect(String(e(editor, '(fikra-workflow-thread-for "fix")').value)).toBe("fix-2");
    const fixLog = readFileSync(join(repoDir, ".tmax/fikra/threads/fix-2/events.jsonl"), "utf8");
    expect(fixLog).toContain("bug fixer");
  });

  test("the label survives a restart (state.json scan)", async () => {
    const editor = await setup();
    e(editor, "(fikra-explain)");
    // The restart proof: the label is ON DISK (not just the registry).
    const state = JSON.parse(readFileSync(join(repoDir, ".tmax/fikra/threads/fix-1/state.json"), "utf8"));
    expect(state.workflow).toBe("explain");
    // And a fresh editor's thread-for finds it via the DISK scan.
    const editor2 = await createStartedEditor("the code\n");
    e(editor2, "(require-module fikra/workflow)");
    e(editor2, "(fikra/thread/fikra-thread-init)");
    expect(String(e(editor2, '(fikra-workflow-thread-for "explain")').value)).toBe("fix-1");
  });

  test("workflow threads inherit the runtime mode (#219)", async () => {
    const editor = await setup();
    e(editor, "(require-module fikra/modes)");
    e(editor, '(fikra/modes/fikra-set-runtime-mode "full-access")');
    e(editor, "(fikra-explain)");
    expect(String(e(editor, "(fikra/modes/fikra-runtime-mode)").value)).toBe("full-access");
  });
});

describe("#225 custom workflows (RFC-013 §Custom Workflow, thread-aware)", () => {
  test("register + run: own labeled thread; listing; unknown refused", async () => {
    const editor = await setup();
    e(editor, '(fikra-register-workflow "document" "You write documentation.")');
    const names = (e(editor, "(fikra-registered-workflows)").value as { value: string }[]).map((v) => String(v.value));
    expect(names).toContain("document");
    e(editor, '(fikra-run-named-workflow "document")');
    expect(String(e(editor, '(fikra-workflow-thread-for "document")').value)).toBe("fix-1");
    const log = readFileSync(join(repoDir, ".tmax/fikra/threads/fix-1/events.jsonl"), "utf8");
    expect(log).toContain("You write documentation.");
    // Unknown workflow: refused with a status, no thread.
    expect(String(e(editor, '(fikra-run-named-workflow "nope")').value)).toContain("no workflow");
    expect(String(e(editor, '(fikra-workflow-thread-for "nope")').value)).toBe("null");
  });
});

describe("#225 backend switcher — mid-conversation", () => {
  test("switching backends continues the SAME event log with the new backend's turn", async () => {
    const editor = await setup();
    e(editor, "(require-module fikra/chat)");
    // A turn on the replay backend.
    e(editor, "(fikra/chat/fikra-chat-open)");
    e(editor, '(fikra/chat/fikra-turn-send "first question")');
    const logBefore = readFileSync(join(repoDir, ".tmax/fikra/threads/main/events.jsonl"), "utf8");
    expect(logBefore).toContain("first question");
    // Switch to codex (forced — keyless) MID-THREAD.
    e(editor, '(require-module fikra/backend-codex)');
    e(editor, '(fikra/adapter/fikra-set-backend-forced "codex")');
    expect(String(e(editor, "(fikra/adapter/fikra-current-backend)").value)).toBe("codex");
    // The SAME thread continues: a new turn records the new backend.
    e(editor, '(fikra/chat/fikra-turn-send "second question after switch")');
    const log = readFileSync(join(repoDir, ".tmax/fikra/threads/main/events.jsonl"), "utf8");
    expect(log).toContain("first question"); // history intact
    expect(log).toContain("second question after switch");
    // turn-start events record the backend per turn (#213).
    const starts = log.trimEnd().split("\n").map((l) => JSON.parse(l)).filter((ev) => ev.kind === "turn-start");
    expect(starts.length).toBe(2);
    expect(starts[1]!.backend).toBe("codex");
  });

  test("both real backends register; availability probing drives the offered list", async () => {
    const editor = await setup();
    e(editor, "(require-module fikra/backend-claude)");
    e(editor, "(require-module fikra/backend-codex)");
    const backends = (e(editor, "(fikra/adapter/fikra-list-backends)").value as { value: string }[]).map((v) => String(v.value));
    expect(backends).toContain("claude");
    expect(backends).toContain("codex");
    expect(backends).toContain("replay");
    // The switcher entry point exists (SPC a b registered in mode.tlisp).
    e(editor, "(require-module fikra/mode)");
    expect(JSON.stringify(e(editor, '(key-binding "SPC a b" "normal")').value)).toContain("fikra-set-backend");
  });
});

describe("#225 context — the unchanged user-overridable contract", () => {
  test("fikra-build-context includes file/mode/selection/buffer", async () => {
    const editor = await setup("function foo() {}\n");
    const ctx = String(e(editor, "(fikra-build-context)").value);
    expect(ctx).toContain("Buffer content");
    expect(ctx).toContain("function foo()");
    expect(ctx).toContain("fundamental");
  });
});
