import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

// #222 (RFC-027 §D7) — full thread machinery: creation (generated ids,
// inherited mode), switching (focus/buffer/modeline), per-thread buffers
// with no state bleed, archive, and the *Fikra-Threads* list.

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

let repoDir = "";
const repoDirs: string[] = [];
const originalCwd = process.cwd();

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "fikra-th-"));
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
  for (const d of repoDirs) {
    try { execFileSync("git", ["worktree", "remove", "--force", join(dirname(d), `${basename(d)}.fikra-fix-1`)], { cwd: d }); } catch { /* gone */ }
    rmSync(d, { recursive: true, force: true });
  }
});

const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);

async function setup(): Promise<Editor> {
  const editor = await createStartedEditor("");
  e(editor, "(require-module fikra/threads)");
  e(editor, "(require-module fikra/modes)");
  e(editor, "(fikra/thread/fikra-thread-init)");
  return editor;
}

describe("#222 lifecycle — create / switch / archive", () => {
  test("new thread gets a generated fix-1 id, its own state dir + buffer; ids increment", async () => {
    const editor = await setup();
    expect(String(e(editor, "(fikra/thread/fikra-thread-new)").value)).toBe("fix-1");
    expect(String(e(editor, "(fikra/thread/fikra-thread-current)").value)).toBe("fix-1");
    // Its own chat buffer, focused, empty.
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Fikra-fix-1*");
    expect(bufferText(editor)).not.toContain("fix-2"); // own buffer, isolated
    // A second new thread increments.
    expect(String(e(editor, "(fikra/thread/fikra-thread-new)").value)).toBe("fix-2");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Fikra-fix-2*");
  });

  test("child threads inherit the parent runtime mode", async () => {
    const editor = await setup();
    e(editor, '(fikra/modes/fikra-set-runtime-mode "full-access")');
    expect(String(e(editor, "(fikra/thread/fikra-thread-new)").value)).toBe("fix-1");
    expect(String(e(editor, "(fikra/modes/fikra-runtime-mode)").value)).toBe("full-access");
  });

  test("switch swaps focus, FAEP log pointer, buffer, and modeline", async () => {
    const editor = await setup();
    e(editor, '(require-module fikra/adapter)');
    e(editor, '(fikra/adapter/fikra-set-backend-forced "replay")');
    e(editor, "(require-module fikra/chat)");
    e(editor, '(fikra/event/fikra-event-emit (list (list "kind" "text-delta") (list "text" "from main")))');
    e(editor, "(fikra/thread/fikra-thread-new)"); // fix-1
    e(editor, '(fikra/event/fikra-event-emit (list (list "kind" "text-delta") (list "text" "from fix-1")))');
    // Switch back to main: its buffer replays ITS OWN log.
    expect(String(e(editor, '(fikra/thread/fikra-thread-switch "main")').value)).toBe("main");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Fikra*");
    expect(bufferText(editor)).toContain("from main");
    expect(bufferText(editor)).not.toContain("from fix-1");
    // Switch to fix-1: separate buffer with its own content.
    expect(String(e(editor, '(fikra/thread/fikra-thread-switch "fix-1")').value)).toBe("fix-1");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Fikra-fix-1*");
    expect(bufferText(editor)).toContain("from fix-1");
    expect(bufferText(editor)).not.toContain("from main");
    // The modeline follows the focused thread (wt: only in worktree mode —
    // none here; the backend is visible).
    e(editor, "(fikra/chat/fikra-refresh-lighter)");
    expect(String(e(editor, '(minor-mode-lighter "fikra")').value)).toContain("replay");
  });

  test("two live threads keep independent turn/status state (no bleed)", async () => {
    const editor = await setup();
    e(editor, "(fikra/thread/fikra-thread-turn-begin)"); // main turn 1 running
    e(editor, "(fikra/thread/fikra-thread-new)"); // fix-1
    // fix-1 is fresh: idle, 0 turns — main's turn state did NOT follow.
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("idle");
    expect(String(e(editor, "(fikra/thread/fikra-thread-turn-count)").value)).toBe("0");
    // And main keeps its own.
    e(editor, '(fikra/thread/fikra-thread-switch "main")');
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
    expect(String(e(editor, "(fikra/thread/fikra-thread-turn-count)").value)).toBe("1");
  });

  test("archive hides the thread; main refuses; logs preserved", async () => {
    const editor = await setup();
    e(editor, "(fikra/thread/fikra-thread-new)");
    e(editor, '(fikra/event/fikra-event-emit (list (list "kind" "text-delta") (list "text" "kept")))');
    expect(String(e(editor, "(fikra/thread/fikra-thread-archive)").value)).toBe("true");
    expect(String(e(editor, '(fikra/thread/fikra-thread-archived-p "fix-1")').value)).toBe("true");
    // A fresh editor still sees it as archived (state.json) and it is
    // excluded from rows.
    const editor2 = await createStartedEditor("");
    e(editor2, "(require-module fikra/threads)");
    e(editor2, "(fikra/thread/fikra-thread-init)");
    // Disk truth lists BOTH (archive is a soft delete); the LIST filter
    // (rows) excludes the archived one.
    const ids = (e(editor2, "(fikra/thread/fikra-thread-ids)").value as { value: string }[]).map((v) => String(v.value));
    expect(ids).toContain("main");
    expect(ids).toContain("fix-1");
    // Main cannot be archived.
    expect(String(e(editor2, "(fikra/thread/fikra-thread-archive)").value)).toBe("null");
    // The archived thread's log survives (retention owns real deletion).
    const rows = (e(editor2, "(fikra/thread/fikra-thread-rows)").value as unknown[]).length;
    expect(rows).toBe(1);
  });
});

describe("#222 *Fikra-Threads* list buffer", () => {
  test("renders the project's threads with the location column (local/worktree)", async () => {
    const editor = await setup();
    e(editor, "(fikra/thread/fikra-thread-new)"); // fix-1 (local)
    expect(String(e(editor, "(fikra/threads/fikra-threads-list-open)").value)).toBe("*Fikra-Threads*");
    const text = bufferText(editor);
    // Header + project root grouping label.
    expect(text).toContain("Threads — ");
    expect(text).toContain(repoDir);
    // Both threads listed with columns.
    expect(text).toContain("main");
    expect(text).toContain("fix-1");
    expect(text).toContain("local");
    // A worktree thread shows worktree in the location column.
    e(editor, "(require-module fikra/worktree)");
    e(editor, '(fikra/thread/fikra-thread-switch "fix-1")');
    e(editor, "(fikra/worktree/fikra-worktree-enter)");
    e(editor, "(fikra/threads/fikra-threads-list-open)");
    const text2 = bufferText(editor);
    expect(text2).toContain("worktree");
    // cleanup the worktree (fixture afterAll also tries)
    e(editor, '(fikra/worktree/fikra-worktree-close)');
  });

  test("j/k move the selection; RET switches; d archives + refreshes", async () => {
    const editor = await setup();
    e(editor, "(fikra/thread/fikra-thread-new)"); // fix-1
    e(editor, "(fikra/threads/fikra-threads-list-open)");
    // Selection starts at row 0 (main).
    expect(String(e(editor, "(fikra/threads/fikra-threads-selected-id)").value)).toBe("main");
    e(editor, "(fikra/threads/fikra-threads-j)");
    expect(String(e(editor, "(fikra/threads/fikra-threads-selected-id)").value)).toBe("fix-1");
    // Clamp at the ends.
    e(editor, "(fikra/threads/fikra-threads-j)");
    expect(String(e(editor, "(fikra/threads/fikra-threads-selected-id)").value)).toBe("fix-1");
    e(editor, "(fikra/threads/fikra-threads-k)");
    expect(String(e(editor, "(fikra/threads/fikra-threads-selected-id)").value)).toBe("main");
    // RET switches to the selected thread's buffer.
    e(editor, "(fikra/threads/fikra-threads-j)");
    expect(String(e(editor, "(fikra/threads/fikra-threads-RET)").value)).toBe("fix-1");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Fikra-fix-1*");
    // d archives the selected (fix-1) and refreshes.
    e(editor, "(fikra/threads/fikra-threads-list-open)");
    e(editor, "(fikra/threads/fikra-threads-j)");
    expect(String(e(editor, "(fikra/threads/fikra-threads-archive-selected)").value)).toBe("true");
    const text = bufferText(editor);
    expect(text).not.toContain("fix-1");
    expect(text).toContain("main");
  });

  test("SPC a t and SPC a T are registered", async () => {
    const editor = await setup();
    e(editor, "(require-module fikra/mode)");
    expect(JSON.stringify(e(editor, '(key-binding "SPC a t" "normal")').value)).toContain("fikra-thread-new");
    expect(JSON.stringify(e(editor, '(key-binding "SPC a T" "normal")').value)).toContain("fikra-threads-list-open");
  });
});
