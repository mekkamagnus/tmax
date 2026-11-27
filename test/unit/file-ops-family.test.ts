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
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
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
  test("empty directory goes without a confirm", async () => {
    const d = join(vault, "empty-dir");
    mkdirSync(d, { recursive: true });
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(delete-directory "${d}")`);
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
    expect(editor.getState().statusMessage).toContain("Deleted directory");
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
