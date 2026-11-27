/**
 * @file file-ops-mkdir.test.ts
 * @description #359 / RFC-041 U1 — interactive mkdir.
 *
 * Drives the real two-stage minibuffer flow (primer → minibuffer-set-input →
 * Enter) through the fixture, per the capture-daily/wiki-link pattern. Also
 * pins file-mkdir's honest boolean return (the primitive used to swallow
 * failures on both paths).
 */
import { describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

describe("#359: mkdir (RFC-041 file-ops family)", () => {
  test("M-x mkdir: prompt → accept creates the directory and its parents, reports success", async () => {
    const vault = join(tmpdir(), `tmax-mkdir-${process.pid}-`);
    const editor = await createStartedEditor("");
    executeTlisp(editor, "(mkdir)");
    expect(editor.getState().mode).toBe("mx");
    expect(editor.getState().minibufferView?.prompt).toBe("Make directory: ");
    executeTlisp(editor, `(minibuffer-set-input "${join(vault, "a", "b", "c")}")`);
    executeTlisp(editor, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(vault, "a", "b", "c"))).toBe(true);
    expect(editor.getState().statusMessage).toContain("Created directory");
  });

  test("prompt prefills the current file's directory when a file is visited", async () => {
    const vault = join(tmpdir(), `tmax-mkdir-prefill-${process.pid}-`);
    mkdirSync(join(vault, "notes"), { recursive: true });
    const file = join(vault, "notes", "f.md");
    writeFileSync(file, "hello\n");
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(find-file-open "${file}")`);
    executeTlisp(editor, "(mkdir)");
    expect(editor.getState().mode).toBe("mx");
    expect(editor.getState().minibufferView?.input).toBe(join(vault, "notes") + "/");
    executeTlisp(editor, '(minibuffer-dispatch-key "Escape")');
    expect(editor.getState().mode).toBe("normal");
  });

  test("tilde path expands to $HOME", async () => {
    const editor = await createStartedEditor("");
    executeTlisp(editor, "(mkdir)");
    executeTlisp(editor, '(minibuffer-set-input "~/tmax-mkdir-tilde-probe")');
    executeTlisp(editor, '(minibuffer-dispatch-key "Enter")');
    expect(existsSync(join(process.env.HOME!, "tmax-mkdir-tilde-probe"))).toBe(true);
  });

  test("an existing directory produces an explicit message, not a crash", async () => {
    const vault = join(tmpdir(), `tmax-mkdir-exists-${process.pid}-`);
    mkdirSync(vault, { recursive: true });
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(mkdir "${vault}")`);
    expect(editor.getState().statusMessage).toContain("already exists");
  });

  test("direct path argument skips the prompt entirely", async () => {
    const vault = join(tmpdir(), `tmax-mkdir-direct-${process.pid}-`);
    const editor = await createStartedEditor("");
    executeTlisp(editor, `(mkdir "${join(vault, "nested")}")`);
    expect(editor.getState().mode).toBe("normal");
    expect(existsSync(join(vault, "nested"))).toBe(true);
    expect(editor.getState().statusMessage).toContain("Created directory");
  });

  test("primitive failures surface: mkdir under a file reports failure", async () => {
    const vault = join(tmpdir(), `tmax-mkdir-fail-${process.pid}-`);
    mkdirSync(vault, { recursive: true });
    const file = join(vault, "plain.txt");
    writeFileSync(file, "x");
    const editor = await createStartedEditor("");
    // ENOTDIR: a path component is a regular file — recursive mkdir fails.
    executeTlisp(editor, `(mkdir "${join(file, "sub")}")`);
    expect(editor.getState().statusMessage).toContain("failed to create");
    // file-mkdir's honest return is what the command branches on (#359).
    expect(executeTlisp(editor, `(file-mkdir "${join(file, "sub2")}")`).value).toBe(false);
  });
});
