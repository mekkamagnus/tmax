import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";
import { TLispParser } from "../../src/tlisp/parser.ts";
import { TLispTokenizer } from "../../src/tlisp/tokenizer.ts";
import { readFileSync as rf } from "node:fs";

// #215 (RFC-027 §Testing, §Phase 1) — backend-replay: the keyless-CI
// keystone. Recorded fixtures drive the IDENTICAL pipeline (normalize →
// FAEP batch → thread lifecycle) with no network, keys, or CLI installs.
// Plus the module-load guard: a deliberately broken fikra module must FAIL
// a parse (the BUG-60 swallowed-parse-error failure mode).

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

let repoDir = "";
const originalCwd = process.cwd();

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "fikra-replay-"));
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  process.chdir(repoDir);
});

afterAll(() => {
  process.chdir(originalCwd);
  if (repoDir) rmSync(repoDir, { recursive: true, force: true });
});

const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);

function loadFixture(editor: Editor, lines: string[]): string {
  const fx = join(repoDir, "fixture.jsonl");
  writeFileSync(fx, lines.join("\n") + "\n");
  e(editor, `(fikra/backend-replay/fikra-backend-replay-load "${fx}")`);
  return fx;
}

const turn = (editor: Editor, q: string) =>
  e(editor, `(fikra/backend-replay/fikra-backend-replay-start-turn "${q}")`);

function logKinds(editor: Editor): string[] {
  const log = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
  return readFileSync(log, "utf8").trimEnd().split("\n").map((l) => JSON.parse(l).kind);
}

describe("#215 module-load guard (BUG-60 family)", () => {
  test("every fikra module parses clean", () => {
    const dir = "src/tlisp/core/fikra";
    for (const f of ["event.tlisp", "thread.tlisp", "adapter.tlisp",
                     "backend-claude.tlisp", "backend-replay.tlisp",
                     "mode.tlisp", "chat.tlisp", "capture.tlisp",
                     "context.tlisp", "workflow.tlisp"]) {
      const src = rf(join(originalCwd, dir, f), "utf8");
      const toks = new TLispTokenizer().tokenizeWithSpans(src, f);
      expect(toks._tag).toBe("Right");
      if (toks._tag !== "Right") throw new Error(`${f}: tokenize failed`);
      const r = new TLispParser().parseProgram(src, f);
      expect((r as { _tag?: string })._tag).toBe("Right");
    }
  });

  test("every fikra module LOADS through the editor's require-module path", async () => {
    // The BUG-60 stray-paren class passes parseProgram but FAILS at load —
    // this is the load-path guard (gate round-1 catch). A started editor
    // resolves modules against the repo's core root; a fresh editor per
    // module keeps state isolated.
    for (const m of ["fikra/mode", "fikra/adapter", "fikra/chat", "fikra/capture",
                     "fikra/context", "fikra/workflow", "fikra/event",
                     "fikra/thread", "fikra/backend-claude", "fikra/backend-replay"]) {
      const editor = await createStartedEditor("");
      // executeTlisp throws on Left — loading IS the assertion.
      executeTlisp(editor, `(require-module ${m})`);
    }
  }, 20_000);

  test("a deliberately broken module FAILS the same parse (guard proves itself)", () => {
    // Paren imbalance alone is tolerated by parseProgram (it surfaces at
    // module LOAD — the "Expected ')' to close list" errors seen in #212/
    // #214 dev); an unterminated string is rejected at TOKENIZE, which is
    // where the guard catches deterministic .tlisp corruption.
    const broken = '(defun x () "unterminated';
    const toks = new TLispTokenizer().tokenizeWithSpans(broken, "b");
    expect(toks._tag).toBe("Left");
    // (parseProgram takes source; paren-imbalance surfaces at LOAD, the
    // "Expected ')' to close list" family seen in #212/#214 dev.)
  });
});

describe("#215 replay backend — fixture pipeline", () => {
  test("turn 1: session + text normalize and emit as ONE batch; session recorded", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-replay)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    loadFixture(editor, [
      '{"type":"system","subtype":"init","session_id":"s-77"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hello there"}]}}',
    ]);
    expect(String(turn(editor, "q1").value)).toBe("idle");
    expect(String(e(editor, "(fikra/thread/fikra-thread-session-id)").value)).toBe("s-77");
    expect(logKinds(editor)).toEqual([
      "turn-start", "session", "text-delta", "turn-end",
    ]);
  });

  test("### markers split chunks; each start-turn feeds the next chunk", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-replay)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    loadFixture(editor, [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"one"}]}}',
      "###",
      '{"type":"assistant","message":{"content":[{"type":"text","text":"two"}]}}',
    ]);
    turn(editor, "q1");
    expect(logKinds(editor)).toEqual(["turn-start", "text-delta", "turn-end"]);
    turn(editor, "q2");
    expect(logKinds(editor)).toEqual([
      "turn-start", "text-delta", "turn-end",
      "turn-start", "text-delta", "turn-end",
    ]);
  });

  test("tool calls + results + unparseable lines: identical-pipeline guarantee", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-replay)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    loadFixture(editor, [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"bun test"}}]}}',
      "###",
      "not json at all",
      '{"type":"user","message":{"content":[{"type":"tool_result","content":"92 pass","is_error":false}]}}',
    ]);
    turn(editor, "q1");
    const log1 = readFileSync(String(e(editor, "(fikra/thread/fikra-thread-log-path)").value), "utf8");
    const toolCall = log1.trimEnd().split("\n").map((l) => JSON.parse(l)).find((l) => l.kind === "tool-call");
    expect(toolCall).toEqual({ kind: "tool-call", tool: "Bash", summary: "bun test" });
    turn(editor, "q2");
    const kinds = logKinds(editor);
    expect(kinds).toContain("tool-result");
    // The unparseable line produced NOTHING.
    expect(kinds.filter((k) => k === "tool-result")).toHaveLength(1);
  });

  test("running past the fixture: turn ends empty, no crash, cursor saturates", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-replay)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    loadFixture(editor, ['{"type":"assistant","message":{"content":[{"type":"text","text":"only"}]}}']);
    turn(editor, "q1");
    turn(editor, "q2"); // past the end
    turn(editor, "q3");
    const kinds = logKinds(editor);
    expect(kinds.filter((k) => k === "text-delta")).toHaveLength(1);
    expect(kinds.filter((k) => k === "turn-end")).toHaveLength(3);
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
  });

  test("start-turn without a fixture: nil + message, no crash", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-replay)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    expect(String(turn(editor, "q").value)).toBe("null");
  });

  test("replay capabilities include the replay flag; available always t", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-replay)");
    expect(String(e(editor, '(fikra/adapter/fikra-backend-capable-p "replay" "replay")').value)).toBe("true");
    expect(String(e(editor, '(fikra/adapter/fikra-backend-available-p "replay")').value)).toBe("true");
  });
});

describe("#215 e2e: fixture → FAEP → rendering → thread state", () => {
  test("full transcript renders into *Fikra* via thread-open after replay turns", async () => {
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/backend-replay)");
    e(editor, "(fikra/thread/fikra-thread-open)");
    loadFixture(editor, [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"rendered from a fixture"}]}}',
      "###",
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"echo hi"}}]}}',
    ]);
    turn(editor, "q1");
    turn(editor, "q2");
    const buf = String(e(editor, "(buffer-text)").value);
    expect(buf).toContain("AI: rendered from a fixture");
    expect(buf).toContain("⚙ Bash  echo hi");
    expect(buf).toContain("── turn 2");
    // And replay-from-disk agrees with the live buffer (rebuild is idempotent).
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    expect(String(e(editor, "(buffer-text)").value)).toBe(buf);
  });
});
