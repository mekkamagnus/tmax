import { describe, expect, test } from "bun:test";
import { FunctionalTextBufferImpl } from "../../src/core/buffer";
import { createEditorAPI, type TlispEditorState } from "../../src/editor/tlisp-api";
import { Either } from "../../src/utils/task-either";
import { expectDefined, expectRight } from "../helpers/editor-fixture.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function createState(): TlispEditorState {
  const currentBuffer = FunctionalTextBufferImpl.create("");
  return {
    currentBuffer,
    buffers: new Map([["default", currentBuffer]]),
    cursorLine: 0,
    cursorColumn: 0,
    terminal: new MockTerminal(),
    filesystem: new MockFileSystem(),
    mode: "normal",
    lastCommand: "",
    statusMessage: "",
    viewportTop: 0,
    viewportLeft: 0,
    commandLine: "",
    spacePressed: false,
    mxCommand: "",
    cursorFocus: "buffer",
  };
}

describe("Fikra Phase 2 — T-Lisp Modules", () => {
  test("fikra-mode.tlisp exists and contains key bindings", () => {
    const content = readFileSync(join(process.cwd(), "src/tlisp/core/fikra/fikra-mode.tlisp"), "utf-8");
    expect(content).toContain('SPC a a');
    expect(content).toContain('fikra-chat-open');
    expect(content).toContain('define-minor-mode "fikra"');
    expect(content).toContain('provide "fikra-mode"');
  });

  test("fikra-adapter.tlisp defines backend registry", () => {
    const content = readFileSync(join(process.cwd(), "src/tlisp/core/fikra/fikra-adapter.tlisp"), "utf-8");
    expect(content).toContain("fikra-register-backend");
    expect(content).toContain("fikra-set-backend");
    expect(content).toContain("fikra-backend-call");
    expect(content).toContain("provide \"fikra-adapter\"");
  });

  test("fikra-backend-claude.tlisp defines adapter protocol", () => {
    const content = readFileSync(join(process.cwd(), "src/tlisp/core/fikra/fikra-backend-claude.tlisp"), "utf-8");
    expect(content).toContain("fikra-backend-claude-available-p");
    expect(content).toContain("fikra-backend-claude-chat");
    expect(content).toContain("fikra-backend-claude-abort");
    expect(content).toContain("make-process");
    expect(content).toContain("fikra-register-backend \"claude\"");
  });

  test("fikra-chat.tlisp defines chat buffer management", () => {
    const content = readFileSync(join(process.cwd(), "src/tlisp/core/fikra/fikra-chat.tlisp"), "utf-8");
    expect(content).toContain("fikra-chat-open");
    expect(content).toContain("fikra-token-insert");
    expect(content).toContain("fikra-turn-send");
    expect(content).toContain("buffer-set-read-only");
    expect(content).toContain("*Fikra*");
  });

  test("fikra-capture.tlisp defines capture buffer lifecycle", () => {
    const content = readFileSync(join(process.cwd(), "src/tlisp/core/fikra/fikra-capture.tlisp"), "utf-8");
    expect(content).toContain("fikra-capture");
    expect(content).toContain("fikra-capture-submit");
    expect(content).toContain("fikra-capture-cancel");
    expect(content).toContain("fikra-history-prev");
    expect(content).toContain("split-window");
  });

  test("fikra-context.tlisp defines context extraction", () => {
    const content = readFileSync(join(process.cwd(), "src/tlisp/core/fikra/fikra-context.tlisp"), "utf-8");
    expect(content).toContain("fikra-build-context");
    expect(content).toContain("buffer-filename");
    expect(content).toContain("visual-get-selection");
    expect(content).toContain("truncated");
  });

  test("fikra-workflow.tlisp defines all workflow functions", () => {
    const content = readFileSync(join(process.cwd(), "src/tlisp/core/fikra/fikra-workflow.tlisp"), "utf-8");
    expect(content).toContain("fikra-explain");
    expect(content).toContain("fikra-fix");
    expect(content).toContain("fikra-refactor");
    expect(content).toContain("fikra-review");
    expect(content).toContain("fikra-test");
    expect(content).toContain("fikra-explain-prompt");
  });

  test("all 7 fikra module files exist", () => {
    const files = [
      "fikra-mode.tlisp",
      "fikra-adapter.tlisp",
      "fikra-backend-claude.tlisp",
      "fikra-chat.tlisp",
      "fikra-capture.tlisp",
      "fikra-context.tlisp",
      "fikra-workflow.tlisp",
    ];
    for (const f of files) {
      const content = readFileSync(join(process.cwd(), "src/tlisp/core/fikra", f), "utf-8");
      expect(content.length).toBeGreaterThan(0);
    }
  });

  // TypeScript API tests for primitives used by fikra
  test("buffer-create and buffer-set-read-only work for *Fikra*", () => {
    const state = createState();
    const api = createEditorAPI(state);

    const createBuf = expectDefined(api.get("buffer-create"));
    expectRight(createBuf([{ type: "string", value: "*Fikra*" } as any]));
    expect(state.buffers.has("*Fikra*")).toBe(true);

    const switchBuf = expectDefined(api.get("buffer-switch"));
    expectRight(switchBuf([{ type: "string", value: "*Fikra*" } as any]));

    const setRO = expectDefined(api.get("buffer-set-read-only"));
    const result = expectRight(setRO([{ type: "boolean", value: true } as any]));
    expect(result.value).toBe(true);
  });

  test("json-read-from-string parses Claude stream output", () => {
    const api = createEditorAPI(createState());
    const jsonParse = expectDefined(api.get("json-read-from-string"));

    const result = expectRight(jsonParse([
      { type: "string", value: '{"type":"content_block_delta","delta":{"text":"hello"}}' } as any,
    ]));
    expect(result.type).toBe("list");
  });

  test("shell-command detects claude on PATH", () => {
    const api = createEditorAPI(createState());
    const shellCmd = expectDefined(api.get("shell-command"));

    const result = expectRight(shellCmd([{ type: "string", value: "which claude 2>/dev/null" } as any]));
    // Result is either a path or empty string — both are valid
    expect(result.type).toBe("string");
  });
});
