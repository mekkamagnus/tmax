import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

// #218 (RFC-027 §D6, Phase 2) — tree-diff-inverse revert: the 2×2
// presence matrix, content-divergence aborts with stash patches, and the
// append-only tombstone (rendering continues past it).

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

let repoDir = "";
const repoDirs: string[] = [];
const originalCwd = process.cwd();

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "fikra-rev-"));
  repoDirs.push(repoDir);
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repoDir });
  // .tmax/ is gitignored per the RFC — thread state must never be
  // checkpointed (else reverting a turn reverts the event log itself).
  writeFileSync(join(repoDir, ".gitignore"), ".tmax/\n");
  writeFileSync(join(repoDir, "keep.txt"), "original\n");
  writeFileSync(join(repoDir, "gone.txt"), "will be deleted\n");
  execFileSync("git", ["add", "-A"], { cwd: repoDir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repoDir });
  process.chdir(repoDir);
});

afterAll(() => {
  process.chdir(originalCwd);
  for (const d of repoDirs) rmSync(d, { recursive: true, force: true });
});

const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);
const git = (args: string[]) => execFileSync("git", args, { cwd: repoDir }).toString().trim();
const read = (p: string) => readFileSync(join(repoDir, p), "utf8");

/** Simulate a full agent turn: capture baseline, mutate the tree, capture completion. */
function makeTurn(editor: Editor, mutate: () => void) {
  e(editor, '(fikra/checkpoint/fikra-checkpoint-capture "baseline")');
  mutate();
  e(editor, '(fikra/checkpoint/fikra-checkpoint-capture "completion")');
}

function setupEditor(): Promise<Editor> {
  return createStartedEditor("").then((ed) => {
    executeTlisp(ed, "(require-module fikra/revert)");
    executeTlisp(ed, "(require-module fikra/thread)");
    executeTlisp(ed, "(fikra/thread/fikra-thread-init)");
    return ed;
  });
}

describe("#218 revert — the 2×2 matrix", () => {
  test("modified restored; deleted-by-turn restored; created-by-turn DELETED", async () => {
    const editor = await setupEditor();
    makeTurn(editor, () => {
      writeFileSync(join(repoDir, "keep.txt"), "modified by agent\n");   // M
      execFileSync("git", ["rm", "-q", "gone.txt"], { cwd: repoDir });    // D
      writeFileSync(join(repoDir, "new.txt"), "created by agent\n");      // A
    });
    expect(String(e(editor, '(fikra/revert/fikra-revert "refs/fikra/main/0-baseline" "refs/fikra/main/0")').value)).toBe("true");
    expect(read("keep.txt")).toBe("original\n");           // M → restored
    expect(read("gone.txt")).toBe("will be deleted\n");   // D → restored
    expect(existsSync(join(repoDir, "new.txt"))).toBe(false); // A → DELETED
  });

  test("A-entry the user EDITED post-turn: delete ABORTS with stash (gate catch)", async () => {
    const editor = await setupEditor();
    makeTurn(editor, () => writeFileSync(join(repoDir, "agent-new.txt"), "agent content\n"));
    // The user edits the agent-created file AFTER the turn (diverges).
    writeFileSync(join(repoDir, "agent-new.txt"), "USER EDITED\n");
    expect(String(e(editor, '(fikra/revert/fikra-revert "refs/fikra/main/0-baseline" "refs/fikra/main/0")').value)).toBe("true");
    // Diverged A-entry NOT deleted; content stashed.
    expect(read("agent-new.txt")).toBe("USER EDITED\n");
    expect(readFileSync(join(repoDir, ".tmax/fikra/stash/revert-agent-new.txt.patch"), "utf8")).toContain("USER EDITED");
  });

  test("user files NOT in the completion ref are untouched (standing exclusion)", async () => {
    const editor = await setupEditor();
    makeTurn(editor, () => writeFileSync(join(repoDir, "keep.txt"), "agent edit\n"));
    // The user's OWN new file, never checkpointed — not a diff entry.
    writeFileSync(join(repoDir, "user-own.txt"), "user work\n");
    e(editor, '(fikra/revert/fikra-revert "refs/fikra/main/0-baseline" "refs/fikra/main/0")');
    expect(read("user-own.txt")).toBe("user work\n"); // untouched
    expect(read("keep.txt")).toBe("original\n");      // the turn still reverted
  });

  test("gitignored files untouched", async () => {
    const editor = await setupEditor();
    writeFileSync(join(repoDir, ".gitignore"), "env.secrets\n");
    execFileSync("git", ["add", ".gitignore"], { cwd: repoDir });
    execFileSync("git", ["commit", "-q", "-m", "ignore"], { cwd: repoDir });
    makeTurn(editor, () => writeFileSync(join(repoDir, "keep.txt"), "agent\n"));
    writeFileSync(join(repoDir, "env.secrets"), "s3cret\n");
    e(editor, '(fikra/revert/fikra-revert "refs/fikra/main/0-baseline" "refs/fikra/main/0")');
    expect(read("env.secrets")).toBe("s3cret\n"); // ignored → untouched
  });
});

describe("#218 content-divergence guard", () => {
  test("a path the user edited after the turn ABORTS (patch stashed), others revert", async () => {
    const editor = await setupEditor();
    makeTurn(editor, () => {
      writeFileSync(join(repoDir, "keep.txt"), "agent edit\n");
      writeFileSync(join(repoDir, "other.txt"), "agent other\n");
    });
    // The user edits keep.txt AFTER the turn (diverges from completion).
    writeFileSync(join(repoDir, "keep.txt"), "USER LATE EDIT\n");
    expect(String(e(editor, '(fikra/revert/fikra-revert "refs/fikra/main/0-baseline" "refs/fikra/main/0")').value)).toBe("true");
    // Diverged path untouched + its current content stashed as a patch.
    expect(read("keep.txt")).toBe("USER LATE EDIT\n");
    const stash = join(repoDir, ".tmax/fikra/stash");
    expect(existsSync(join(stash, "revert-keep.txt.patch"))).toBe(true);
    expect(readFileSync(join(stash, "revert-keep.txt.patch"), "utf8")).toContain("USER LATE EDIT");
    // other.txt was CREATED by the turn (absent at baseline) → DELETE.
    expect(existsSync(join(repoDir, "other.txt"))).toBe(false);
  });
});

describe("#218 tombstone + log immutability", () => {
  test("revert appends checkpoint-reverted; the log is append-only; post-revert events still render", async () => {
    const editor = await setupEditor();
    makeTurn(editor, () => writeFileSync(join(repoDir, "keep.txt"), "agent\n"));
    const log = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
    const linesBefore = readFileSync(log, "utf8").trimEnd().split("\n").length;
    e(editor, '(fikra/revert/fikra-revert "refs/fikra/main/0-baseline" "refs/fikra/main/0")');
    const lines = readFileSync(log, "utf8").trimEnd().split("\n");
    expect(lines.length).toBeGreaterThan(linesBefore); // APPENDED, not truncated
    const tomb = JSON.parse(lines[lines.length - 1]!);
    expect(tomb.kind).toBe("checkpoint-reverted");
    expect(tomb.target).toBe("refs/fikra/main/0-baseline");
    expect(tomb.paths_reverted ?? tomb["paths-reverted"]).toBe(1);
    // Post-revert events still render (FAEP continues past the tombstone).
    e(editor, '(fikra/event/fikra-event-emit (list (list "kind" "text-delta") (list "text" "after revert")))');
    const text = String(e(editor, "(fikra/event/fikra-event-replay)").value);
    expect(text).toContain("after revert");
    expect(text).toContain("reverted to turn"); // the tombstone marker renders
  });
});

describe("#218 missing refs", () => {
  test("revert to nonexistent refs: nil + status, no crash", async () => {
    const editor = await setupEditor();
    expect(String(e(editor, '(fikra/revert/fikra-revert "refs/fikra/main/9-baseline" "refs/fikra/main/9")').value)).toBe("null");
  });
});
