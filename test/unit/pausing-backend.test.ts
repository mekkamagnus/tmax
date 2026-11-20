import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file pausing-backend.test.ts
 * @description #303 — the L2 approval gate exercised end-to-end via the
 * pausing fixture backend: stream → PAUSE (permission-request rendered,
 * thread confirming) → out-of-band decision → the matching branch →
 * turn-end. y / n / a each drive their branch; `a` persists per-thread
 * (the allow-list survives a save/reload) and suppresses the next
 * matching pause; a non-matching pair still pauses. The GRADED CAPTURE
 * is the pause→decide→resume frame sequence asserted from the replayed
 * *Fikra* buffer (the frames a capture would show).
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

const dirs: string[] = [];

function setup(script: string): { editor: Editor; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "i303-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(join(dir, "fixture.jsonl"), script);
  return { editor: undefined as unknown as Editor, dir };
}

async function started(script: string): Promise<{ editor: Editor; dir: string }> {
  const s = setup(script);
  const editor = await createStartedEditor("");
  editor.setClientLaunchDir(s.dir);
  s.editor = editor;
  e(editor, "(require-module fikra/backend-pausing)");
  e(editor, "(require-module fikra/adapter)");
  e(editor, `(fikra/backend-pausing/fikra-backend-pausing-load "${join(s.dir, "fixture.jsonl")}")`);
  e(editor, '(fikra/adapter/fikra-set-backend-forced "pausing")');
  e(editor, "(fikra/thread/fikra-thread-init)");
  e(editor, "(fikra/thread/fikra-thread-open)");
  return s;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SCRIPT = [
  '{"type":"assistant","text":"before the gate"}',
  '{"type":"permission","tool":"Edit","scope":"src/**"}',
  '{"type":"assistant","text":"allowed continuation"}',
  '{"type":"denied","text":"action rejected"}',
  '{"type":"end"}',
].join("\n") + "\n";

describe("#303 — the pausing fixture backend (pause → decide → resume)", () => {
  test("y allows THIS request: the turn pauses at the gate, resumes on the allow branch, ends cleanly", async () => {
    const { editor, dir } = await started(SCRIPT);
    const start = e(editor, '(fikra/adapter/fikra-backend-start-turn "do it")');
    expect(String(start.value)).toBe("paused");
    // The PAUSE state: the request rendered, the thread is confirming.
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    expect(String(e(editor, "(fikra/backend-pausing/fikra-pausing-pending-p)").value)).toBe("true");
    const log = readFileSync(join(dir, ".tmax/fikra/threads/main/events.jsonl"), "utf8");
    expect(log).toContain("permission-request");
    expect(log).toContain("Edit: src/**");
    // Decide y → pump → the allow branch streams to turn-end.
    e(editor, '(fikra/backend-pausing/fikra-pausing-decide "y")');
    expect(String(e(editor, "(fikra/backend-pausing/fikra-pausing-pump)").value)).toBe("done");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    const log2 = readFileSync(join(dir, ".tmax/fikra/threads/main/events.jsonl"), "utf8");
    expect(log2).toContain("permission-allowed");
    expect(log2).toContain("allowed continuation");
    expect(log2).not.toContain("action rejected");
    // The DECISION renders in the frame (gate r1: the kinds used to fall
    // to the renderer's empty default — log-only decisions).
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    expect(strip(bufferText(editor))).toContain("= allowed this request");
  });

  test("n rejects: the denial branch renders, the turn ends cleanly", async () => {
    const { editor, dir } = await started(SCRIPT);
    e(editor, '(fikra/adapter/fikra-backend-start-turn "do it")');
    e(editor, '(fikra/backend-pausing/fikra-pausing-decide "n")');
    expect(String(e(editor, "(fikra/backend-pausing/fikra-pausing-pump)").value)).toBe("done");
    const log = readFileSync(join(dir, ".tmax/fikra/threads/main/events.jsonl"), "utf8");
    expect(log).toContain("permission-denied");
    expect(log).toContain("action rejected");
    expect(log).not.toContain("allowed continuation");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    expect(strip(bufferText(editor))).toContain("= denied — the turn ended");
  });

  test("a persists per-thread: the NEXT matching (tool, scope) skips the pause; a non-matching pair still pauses (across save/reload)", async () => {
    const { editor, dir } = await started(SCRIPT);
    e(editor, '(fikra/adapter/fikra-backend-start-turn "first")');
    e(editor, '(fikra/backend-pausing/fikra-pausing-decide "a")');
    expect(String(e(editor, "(fikra/backend-pausing/fikra-pausing-pump)").value)).toBe("done");
    const log = readFileSync(join(dir, ".tmax/fikra/threads/main/events.jsonl"), "utf8");
    expect(log).toContain("permission-allowed");
    // The allow-list persisted on the thread record.
    const state = JSON.parse(readFileSync(join(dir, ".tmax/fikra/threads/main/state.json"), "utf8"));
    expect(JSON.stringify(state["approval-allow-list"] ?? state)).toContain("src/**");

    // Reload the thread (fresh editor = the save/reload leg) and re-run
    // with the SAME pair: the pause is SKIPPED (start returns done,
    // permission-allowed with always=t).
      const editor2 = await createStartedEditor("");
    editor2.setClientLaunchDir(dir);
    e(editor2, "(require-module fikra/backend-pausing)");
    e(editor2, "(require-module fikra/adapter)");
    e(editor2, `(fikra/backend-pausing/fikra-backend-pausing-load "${join(dir, "fixture.jsonl")}")`);
    e(editor2, '(fikra/adapter/fikra-set-backend-forced "pausing")');
    e(editor2, "(fikra/thread/fikra-thread-init)");
    e(editor2, "(fikra/thread/fikra-thread-open)");
    const start2 = e(editor2, '(fikra/adapter/fikra-backend-start-turn "second")');
    expect(String(start2.value)).toBe("done");
    // The ALWAYS-branch render asserted in a FRAME (gate r3: only the log
    // payload was pinned — the renderer's conditional was untested).
    e(editor2, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    expect(strip(bufferText(editor2))).toContain("= allowed (always for this tool+scope)");
    const log2 = readFileSync(join(dir, ".tmax/fikra/threads/main/events.jsonl"), "utf8");
    expect(log2).toContain("permission-allowed");
    expect(log2).toContain("\"always\":\"true\"");
    expect(log2).toContain("allowed continuation");

    // A NON-matching pair (different scope) still pauses.
    writeFileSync(join(dir, "fixture2.jsonl"), [
      '{"type":"assistant","text":"x"}',
      '{"type":"permission","tool":"Edit","scope":"docs/**"}',
      '{"type":"assistant","text":"other continuation"}',
      '{"type":"end"}',
    ].join("\n") + "\n");
    e(editor2, `(fikra/backend-pausing/fikra-backend-pausing-load "${join(dir, "fixture2.jsonl")}")`);
    const start3 = e(editor2, '(fikra/adapter/fikra-backend-start-turn "third")');
    expect(String(start3.value)).toBe("paused");
    expect(String(e(editor2, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
  });

  test("a TOOL-differing pair still pauses (the symmetric non-match); the allow-list is thread-scoped", async () => {
    const { editor, dir } = await started(SCRIPT);
    e(editor, '(fikra/adapter/fikra-backend-start-turn "seed")');
    e(editor, '(fikra/backend-pausing/fikra-pausing-decide "a")');
    e(editor, "(fikra/backend-pausing/fikra-pausing-pump)");
    // A different TOOL (same scope) does not match the (Edit, src/**) pair.
    writeFileSync(join(dir, "fixture3.jsonl"), [
      '{"type":"assistant","text":"x"}',
      '{"type":"permission","tool":"Bash","scope":"src/**"}',
      '{"type":"assistant","text":"bash continuation"}',
      '{"type":"end"}',
    ].join("\n") + "\n");
    e(editor, `(fikra/backend-pausing/fikra-backend-pausing-load "${join(dir, "fixture3.jsonl")}")`);
    const st = e(editor, '(fikra/adapter/fikra-backend-start-turn "other-tool")');
    expect(String(st.value)).toBe("paused");
    e(editor, '(fikra/backend-pausing/fikra-pausing-decide "n")');
    e(editor, "(fikra/backend-pausing/fikra-pausing-pump)");
    // THREAD-SCOPED: a sibling thread has NO allow-list (its own
    // state.json) — the EXACT pair the parent allowed (Edit, src/**)
    // still pauses there (gate r2: a different pair was vacuous — it
    // pauses under both thread-scoped and global allow-lists).
    e(editor, '(fikra/thread/fikra-thread-new)');
    const child = String(e(editor, "(fikra/thread/fikra-thread-current)").value);
    expect(child).toBe("fix-1");
    e(editor, `(fikra/backend-pausing/fikra-backend-pausing-load "${join(dir, "fixture.jsonl")}")`);
    const st2 = e(editor, '(fikra/adapter/fikra-backend-start-turn "child")');
    expect(String(st2.value)).toBe("paused");
  });

  test("the GRADED CAPTURE: the pause→decide→resume frame sequence renders in *Fikra*", async () => {
    const { editor, dir } = await started(SCRIPT);
    // Frame 1 — the PAUSE frame (the [y/n/a] prompt + the request row).
    e(editor, '(fikra/adapter/fikra-backend-start-turn "capture")');
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    const pauseFrame = strip(bufferText(editor));
    expect(pauseFrame).toContain("before the gate");
    // The r70 panel: tool row + target row + the y/n/a keys.
    expect(pauseFrame).toContain("Edit");
    expect(pauseFrame).toContain("src/**");
    expect(pauseFrame).toContain("allow");
    expect(pauseFrame).toContain("Always"); // the current panel keys row (a Allow / A Always)
    // Frame 2 — the RESUMED frame (decision + continuation + completion).
    e(editor, '(fikra/backend-pausing/fikra-pausing-decide "y")');
    e(editor, "(fikra/backend-pausing/fikra-pausing-pump)");
    e(editor, "(fikra/event/fikra-event-rebuild-fikra-buffer)");
    const doneFrame = strip(bufferText(editor));
    expect(doneFrame).toContain("allowed continuation");
    expect(doneFrame).toContain("── completed ──");
    // The DECISION renders in the resumed frame of THIS sequence (codex
    // r1: the graded capture itself must show the decision text, not
    // only the separate render tests).
    expect(doneFrame).toContain("= allowed this request");
    // The transcript is append-only: the ANSWERED popup row remains as
    // history — the resume proof is the GAINED content (the decision row
    // + continuation + completion, all absent from the pause frame).
    expect(pauseFrame).not.toContain("= allowed");
    expect(pauseFrame).not.toContain("allowed continuation");
    expect(pauseFrame).not.toContain("── completed ──");
  });
});
