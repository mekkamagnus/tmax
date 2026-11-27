/**
 * @file file-ops-family.test.ts
 * @description #361 / RFC-041 U2 — interactive delete-file / rename-file /
 * copy-file / delete-directory.
 *
 * Drives the real minibuffer state machines (primer → set-input → Enter,
 * once per prompt) through the fixture. Destructive paths are proven BOTH
 * ways: confirmed delete removes, cancelled delete leaves the file intact,
 * and the guard refuses /, $HOME, and the process working directory.
 */
import { describe, test, expect } from "bun:test";
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

const vault = join(tmpdir(), `tmax-u2-${process.pid}-`);

const feed = (editor: Awaited<ReturnType<typeof createStartedEditor>>, input: string): void => {
  executeTlisp(editor, `(minibuffer-set-input "${input}")`);
  executeTlisp(editor, '(minibuffer-dispatch-key "Enter")');
};

describe("#361 tier 1: delete-file", () => {
  test("prompts, confirms, deletes, and reports", async () => {
    const f = join(vault, "victim.txt");
    mkdirSync(vault, { recursive: true });
    writeFileSync(f, "bye");
    const editor = await createStartedEditor("");
    executeTlisp(editor, "(delete-file)");
    expect(editor.getState().mode).toBe("mx");
    feed(editor, f);
    // second prompt: the yes/no confirm
    expect(editor.getState().minibufferView?.prompt).toContain("Delete");
    feed(editor, "yes");
    expect(existsSync(f)).toBe(false);
    expect(editor.getState().statusMessage).toContain("Deleted");
  });

  test("answering no cancels — the file survives", async () => {
    const f = join(vault, "spared.txt");
    mkdirSync(vault, { recursive: true });
    writeFileSync(f, "stay");
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(delete-file "${f}")`);
    feed(editor, "no");
    expect(existsSync(f)).toBe(true);
    expect(editor.getState().statusMessage).toContain("Cancelled");
  });

  test("tilde path deletes under $HOME; missing file is a visible message", async () => {
    const homeFile = join(process.env.HOME!, "tmax-u2-tilde-victim.txt");
    writeFileSync(homeFile, "x");
    const editor = await createStartedEditor("");
    executeTlisp(editor, '(delete-file "~/tmax-u2-tilde-victim.txt")');
    feed(editor, "yes");
    expect(existsSync(homeFile)).toBe(false);
    executeTlisp(editor, '(delete-file "~/no-such-tmax-u2-file.txt")');
    feed(editor, "yes");
    expect(editor.getState().statusMessage).toContain("no such file");
  });
});

describe("#361 tier 1: rename-file / copy-file", () => {
  test("rename-file: two prompts move the file", async () => {
    const src = join(vault, "old-name.txt");
    const dst = join(vault, "new-name.txt");
    mkdirSync(vault, { recursive: true });
    writeFileSync(src, "payload");
    const editor = await createStartedEditor("");
    executeTlisp(editor, "(rename-file)");
    feed(editor, src);
    feed(editor, dst);
    expect(existsSync(src)).toBe(false);
    expect(existsSync(dst)).toBe(true);
    expect(editor.getState().statusMessage).toContain("Renamed");
  });

  test("copy-file: two prompts copy, original survives; tilde destination works", async () => {
    const src = join(vault, "original.txt");
    mkdirSync(vault, { recursive: true });
    writeFileSync(src, "payload");
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(copy-file "${src}")`);
    feed(editor, "~/tmax-u2-copy-dest.txt");
    expect(existsSync(src)).toBe(true);
    expect(existsSync(join(process.env.HOME!, "tmax-u2-copy-dest.txt"))).toBe(true);
    expect(editor.getState().statusMessage).toContain("Copied");
  });

  test("missing source is a visible message, never silence", async () => {
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(rename-file "${join(vault, "ghost.txt")}")`);
    feed(editor, join(vault, "anywhere.txt"));
    expect(editor.getState().statusMessage).toContain("no such file");
  });
});

describe("#361 tier 2: delete-directory", () => {
  test("empty directory requires confirmation and is removed non-recursively on yes (superseded r2 contract)", async () => {
    const d = join(vault, "empty-dir");
    mkdirSync(d, { recursive: true });
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(delete-directory "${d}")`);
    // RFC-041 §3.4 via codex r2 F2: empty directories confirm too.
    expect(editor.getState().mode).toBe("mx");
    feed(editor, "yes");
    expect(existsSync(d)).toBe(false);
    expect(editor.getState().statusMessage).toContain("Deleted directory");
  });

  test("non-empty tree: confirm yes removes recursively, no leaves it intact", async () => {
    const d = join(vault, "tree-dir");
    mkdirSync(join(d, "sub"), { recursive: true });
    writeFileSync(join(d, "a.txt"), "a");
    writeFileSync(join(d, "sub", "b.txt"), "b");
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(delete-directory "${d}")`);
    feed(editor, "no");
    expect(existsSync(join(d, "sub", "b.txt"))).toBe(true);
    executeTlisp(editor, `(delete-directory "${d}")`);
    feed(editor, "yes");
    expect(existsSync(d)).toBe(false);
  });

  test("the guard refuses /, $HOME, and the process working directory", async () => {
    const editor = await createStartedEditor("");
    executeTlisp(editor, '(delete-directory "/")');
    expect(editor.getState().statusMessage).toContain("refusing");
    executeTlisp(editor, '(delete-directory "~")');
    expect(editor.getState().statusMessage).toContain("refusing");
    expect(existsSync(process.env.HOME!)).toBe(true);
    executeTlisp(editor, '(delete-directory (process-cwd))');
    expect(editor.getState().statusMessage).toContain("refusing");
    expect(existsSync(join(process.cwd(), "package.json"))).toBe(true);
  });

  test("file-remove recursive flag removes a tree; missing path returns false", async () => {
    const d = join(vault, "prim-tree");
    mkdirSync(join(d, "x", "y"), { recursive: true });
    writeFileSync(join(d, "x", "y", "f.txt"), "f");
    const editor = await createStartedEditor("");
    expect(executeTlisp(editor, `(file-remove "${d}" t)`).value).toBe(true);
    expect(existsSync(d)).toBe(false);
    expect(executeTlisp(editor, `(file-remove "${join(vault, "gone")}")`).value).toBe(false);
  });
});

describe("#361 codex r1: delete-directory operand + fast-path findings", () => {
  test("F1: a symlink operand removes the LINK, never the target tree", async () => {
    const target = join(vault, "link-target");
    const deep = join(target, "precious.txt");
    mkdirSync(target, { recursive: true });
    writeFileSync(deep, "do not delete me");
    const link = join(vault, "the-link");
    symlinkSync(target, link);
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(delete-directory "${link}")`);
    feed(editor, "yes");
    expect(existsSync(link)).toBe(false); // the link itself is gone
    expect(existsSync(deep)).toBe(true); // the target tree SURVIVES
    expect(editor.getState().statusMessage).toContain("Deleted symlink");
  });

  test("F2: file-rmdir is the non-recursive fast path — fails on non-empty, destroys nothing", async () => {
    const d = join(vault, "rmdir-nonempty");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "appears-late.txt"), "survivor");
    const empty = join(vault, "rmdir-empty");
    mkdirSync(empty, { recursive: true });
    const editor = await createStartedEditor("");
    // Non-empty: honest false, content intact (the TOCTOU contract: the
    // fast path cannot destroy content that was not confirmed).
    expect(executeTlisp(editor, `(file-rmdir "${d}")`).value).toBe(false);
    expect(existsSync(join(d, "appears-late.txt"))).toBe(true);
    // Empty: succeeds.
    expect(executeTlisp(editor, `(file-rmdir "${empty}")`).value).toBe(true);
    expect(existsSync(empty)).toBe(false);
  });

  test("F3: a regular file operand reports 'not a directory' instead of erroring", async () => {
    const f = join(vault, "plain-file.txt");
    mkdirSync(vault, { recursive: true });
    writeFileSync(f, "x");
    const editor = await createStartedEditor("");
    expect(() => executeTlisp(editor, `(delete-directory "${f}")`)).not.toThrow();
    expect(editor.getState().statusMessage).toContain("not a directory");
    expect(existsSync(f)).toBe(true);
  });

  test("F4: a file directly under root prefills the prompt with /", async () => {
    const editor = await createStartedEditor("");
    executeTlisp(editor, '(set-buffer-filename "/package-root.md")');
    executeTlisp(editor, "(mkdir)");
    expect(editor.getState().minibufferView?.input).toBe("/");
    executeTlisp(editor, '(minibuffer-dispatch-key "Escape")');
  });
});

describe("#361 codex r2: trailing slash, confirm-always, dangling links", () => {
  test("R2-F1: delete-directory link/ (trailing slash) still removes only the link", async () => {
    const target = join(vault, "slash-target");
    const deep = join(target, "keep-me.txt");
    mkdirSync(target, { recursive: true });
    writeFileSync(deep, "survivor");
    const link = join(vault, "slashed-link");
    symlinkSync(target, link);
    const editor = await createStartedEditor("");
    // The exact shape codex flagged: the operand carries a trailing slash.
    executeTlisp(editor, `(delete-directory "${link}/")`);
    feed(editor, "yes");
    expect(existsSync(link)).toBe(false); // the link itself is gone
    expect(existsSync(deep)).toBe(true); // the target's contents SURVIVE
  });

  test("R2-F2: an EMPTY directory also requires confirmation (RFC-041 §3.4)", async () => {
    const d = join(vault, "confirm-empty");
    mkdirSync(d, { recursive: true });
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(delete-directory "${d}")`);
    // A confirm prompt is open — the directory is NOT gone yet.
    expect(editor.getState().mode).toBe("mx");
    expect(editor.getState().minibufferView?.prompt).toContain("empty directory");
    feed(editor, "no");
    expect(existsSync(d)).toBe(true);
    executeTlisp(editor, `(delete-directory "${d}")`);
    feed(editor, "yes");
    expect(existsSync(d)).toBe(false);
    expect(editor.getState().statusMessage).toContain("Deleted directory");
  });

  test("R2-F2: confirmed-empty removal stays non-recursive — late content is refused", async () => {
    const d = join(vault, "late-content");
    mkdirSync(d, { recursive: true });
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(delete-directory "${d}")`);
    // Content appears AFTER the empty confirm opened, BEFORE Enter.
    writeFileSync(join(d, "late.txt"), "x");
    feed(editor, "yes");
    expect(existsSync(join(d, "late.txt"))).toBe(true); // not destroyed
    expect(editor.getState().statusMessage).toContain("no longer empty");
  });

  test("R2-F3: a dangling symlink is deletable through delete-file after confirm", async () => {
    const missing = join(vault, "never-existed");
    const broken = join(vault, "broken-link");
    mkdirSync(vault, { recursive: true });
    symlinkSync(missing, broken); // dangling by construction
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(delete-file "${broken}")`);
    feed(editor, "yes");
    expect(existsSync(broken)).toBe(false); // the link entry is gone
    expect(editor.getState().statusMessage).toContain("Deleted");
  });
});
describe("#361 coach round 3: read failure, link semantics, canonical guard", () => {
  test("C3-1: unreadable directory (mode 000) — visible error, no confirm, no delete", async () => {
    const d = join(vault, "coach-noread");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "f.txt"), "x");
    chmodSync(d, 0o000);
    const editor = await createStartedEditor("");
    expect(() => executeTlisp(editor, `(delete-directory "${d}")`)).not.toThrow();
    expect(editor.getState().statusMessage).toContain("cannot read");
    expect(editor.getState().mode).toBe("normal"); // no confirm opened
    chmodSync(d, 0o755);
    expect(existsSync(join(d, "f.txt"))).toBe(true);
  });

  test("C3-2a: rename-file renames a dangling symlink (the entry)", async () => {
    const broken = join(vault, "coach-dangling");
    const renamed = join(vault, "coach-dangling-moved");
    mkdirSync(vault, { recursive: true });
    symlinkSync(join(vault, "no-target"), broken);
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(rename-file "${broken}")`);
    feed(editor, renamed);
    expect(lstatSync(broken, { throwIfNoEntry: false })).toBeUndefined();
    expect(lstatSync(renamed, { throwIfNoEntry: false })?.isSymbolicLink()).toBe(true);
    expect(editor.getState().statusMessage).toContain("Renamed");
  });

  test("C3-2b: mkdir on a dangling-link path reports failure, never success", async () => {
    const link = join(vault, "coach-mkdir-link");
    mkdirSync(vault, { recursive: true });
    symlinkSync(join(vault, "no-target"), link);
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(mkdir "${join(link, "sub")}")`);
    expect(editor.getState().statusMessage).not.toContain("Created");
    expect(editor.getState().statusMessage).toContain("failed");
  });

  test("C3-2c: copy-file on a dangling link stays a visible failure", async () => {
    const link = join(vault, "coach-copy-link");
    mkdirSync(vault, { recursive: true });
    symlinkSync(join(vault, "no-target"), link);
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(copy-file "${link}")`);
    feed(editor, join(vault, "coach-copy-dest.txt"));
    expect(editor.getState().statusMessage).toContain("no such file");
    expect(existsSync(join(vault, "coach-copy-dest.txt"))).toBe(false);
  });

  test("C3-3a: delete-file refuses every protected operand form", async () => {
    const homeLink = join(vault, "coach-home-link");
    const cwdLink = join(vault, "coach-cwd-link");
    mkdirSync(vault, { recursive: true });
    symlinkSync(process.env.HOME!, homeLink);
    symlinkSync(process.cwd(), cwdLink);
    const editor = await createStartedEditor("");
    for (const operand of ["/", "~", "(process-cwd)", homeLink, cwdLink, "."]) {
      const arg = operand === "(process-cwd)" ? "(process-cwd)" : `"${operand}"`;
      executeTlisp(editor, `(delete-file ${arg})`);
      expect(editor.getState().statusMessage).toContain("refusing");
      expect(editor.getState().mode).toBe("normal"); // refused before any confirm
    }
    expect(lstatSync(homeLink, { throwIfNoEntry: false })?.isSymbolicLink()).toBe(true);
    expect(lstatSync(cwdLink, { throwIfNoEntry: false })?.isSymbolicLink()).toBe(true);
  });

  test("C3-3b: delete-directory refuses protected operands through symlinks and relative forms", async () => {
    const homeLink = join(vault, "coach-dd-home-link");
    const cwdLink = join(vault, "coach-dd-cwd-link");
    mkdirSync(vault, { recursive: true });
    symlinkSync(process.env.HOME!, homeLink);
    symlinkSync(process.cwd(), cwdLink);
    const editor = await createStartedEditor("");
    for (const operand of [homeLink, cwdLink, "."]) {
      executeTlisp(editor, `(delete-directory "${operand}")`);
      expect(editor.getState().statusMessage).toContain("refusing");
      expect(editor.getState().mode).toBe("normal");
    }
    expect(lstatSync(homeLink, { throwIfNoEntry: false })?.isSymbolicLink()).toBe(true);
    expect(lstatSync(cwdLink, { throwIfNoEntry: false })?.isSymbolicLink()).toBe(true);
  });

  test("C3-3c: delete-file rechecks the guard at removal time — a confirm-window retarget to $HOME is refused", async () => {
    const safeTarget = join(vault, "coach-safe-target.txt");
    writeFileSync(safeTarget, "x");
    const link = join(vault, "coach-retarget-link");
    symlinkSync(safeTarget, link);
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(delete-file "${link}")`);
    expect(editor.getState().mode).toBe("mx"); // confirm open, link is safe
    // Retarget the SAME entry to $HOME while the confirm is pending.
    rmSync(link);
    symlinkSync(process.env.HOME!, link);
    feed(editor, "yes");
    expect(editor.getState().statusMessage).toContain("refusing");
    expect(lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()).toBe(true);
  });

  test("C3-3d: delete-directory rechecks the guard at removal time — confirm-window retarget refused", async () => {
    const safeDir = join(vault, "coach-safe-dir");
    mkdirSync(safeDir, { recursive: true });
    const link = join(vault, "coach-dd-retarget-link");
    symlinkSync(safeDir, link);
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(delete-directory "${link}")`);
    expect(editor.getState().mode).toBe("mx"); // symlink confirm open
    rmSync(link);
    symlinkSync(process.env.HOME!, link);
    feed(editor, "yes");
    expect(editor.getState().statusMessage).toContain("refusing");
    expect(lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()).toBe(true);
  });
});

describe("Enter on an empty confirmation cancels (the preselected-yes fix)", () => {
  test("delete-file: empty input + Enter keeps the file", async () => {
    const f = join(vault, "enter-guard.txt");
    mkdirSync(vault, { recursive: true });
    writeFileSync(f, "keep");
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(delete-file "${f}")`);
    expect(editor.getState().mode).toBe("mx"); // confirm open
    executeTlisp(editor, '(minibuffer-dispatch-key "Enter")'); // empty input
    expect(existsSync(f)).toBe(true);
    expect(editor.getState().statusMessage).toContain("Cancelled");
  });

  test("delete-directory on a folder with files: empty input + Enter keeps everything", async () => {
    const d = join(vault, "enter-guard-dir");
    mkdirSync(join(d, "sub"), { recursive: true });
    writeFileSync(join(d, "sub", "f.txt"), "keep");
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(delete-directory "${d}")`);
    executeTlisp(editor, '(minibuffer-set-input "")');
    executeTlisp(editor, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(d, "sub", "f.txt"))).toBe(true);
    expect(editor.getState().statusMessage).toContain("Cancelled");
  });

  test("delete-file: typing yes still deletes (the real path is intact)", async () => {
    const f = join(vault, "enter-yes.txt");
    mkdirSync(vault, { recursive: true });
    writeFileSync(f, "gone");
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(delete-file "${f}")`);
    executeTlisp(editor, '(minibuffer-set-input "yes")');
    executeTlisp(editor, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(f)).toBe(false);
  });
});
