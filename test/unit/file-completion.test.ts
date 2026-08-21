import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createStartedEditor, executeTlisp, minibufferRowText } from "../helpers/editor-fixture.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #198: hermetic fixture — the old tests asserted the CHECKOUT's cwd listing
// ("src", "package.json"), which fails on CI runners whose directory listing
// differs. Run them against a fixture tree with exactly the entries they
// assert. bun test isolates per file (own worker); afterAll restores cwd.
const originalCwd = process.cwd();
let fixtureDir = "";
beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "tmax-find-file-"));
  mkdirSync(join(fixtureDir, "src", "core"), { recursive: true });
  writeFileSync(join(fixtureDir, "package.json"), "{}\n");
  writeFileSync(join(fixtureDir, "README.md"), "# fixture\n");
  writeFileSync(join(fixtureDir, "src", "core", "buffer.ts"), "export {};\n");
  process.chdir(fixtureDir);
});
afterAll(() => {
  process.chdir(originalCwd);
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

const startFindFile = async () => {
  const editor = await createStartedEditor();
  executeTlisp(editor, "(find-file)");
  return editor;
};

describe("File completion", () => {
  test("find-file shows candidates from current directory", async () => {
    const editor = await startFindFile();

    const state = editor.getEditorState();
    expect(state.mode).toBe("mx");
    expect(state.minibufferView?.prompt).toBe("Find file: ");
    expect(state.minibufferView?.rows.some(row => minibufferRowText(row).includes("src"))).toBe(true);
  });

  test("typing a prefix filters candidates", async () => {
    const editor = await startFindFile();

    await editor.handleKey("s");
    await editor.handleKey("r");

    const state = editor.getEditorState();
    expect(state.minibufferView?.rows.some(row => minibufferRowText(row).includes("src"))).toBe(true);
    expect(state.minibufferView?.rows.every(row => !minibufferRowText(row).includes("package.json"))).toBe(true);
  });

  test("non-matching prefix shows No match", async () => {
    const editor = await startFindFile();

    for (const key of "zzzzz") await editor.handleKey(key);

    const state = editor.getEditorState();
    expect(state.minibufferView?.message).toBe("No match");
  });

  test("directory prefix narrows to entries in that directory", async () => {
    const editor = await startFindFile();

    for (const key of "src/") await editor.handleKey(key);

    const state = editor.getEditorState();
    expect(state.minibufferView?.rows.some(row => minibufferRowText(row).includes("src/core"))).toBe(true);
  });

  test("accepting a candidate opens the file", async () => {
    const editor = await startFindFile();

    for (const key of "package.json") await editor.handleKey(key);
    await editor.handleKey("Enter");

    expect(executeTlisp(editor, "(buffer-current)").value).toBe("package.json");
  });

  test("cancel returns to normal mode", async () => {
    const editor = await startFindFile();

    await editor.handleKey("Escape");

    const state = editor.getEditorState();
    expect(state.mode).toBe("normal");
  });
});
