import { Editor } from "../../src/editor/editor.ts";
import type { TLispValue } from "../../src/tlisp/types.ts";
import { Either, type Either as EitherValue } from "../../src/utils/task-either.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EditorAPIContext } from "../../src/editor/runtime/editor-api-context.ts";
import type { FunctionalTextBuffer } from "../../src/core/types.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import { initialModel } from "../../src/editor/functional/model.ts";
import { createEditorSession } from "../../src/editor/functional/domain-state.ts";
import { createEditorRuntimeCaches } from "../../src/editor/runtime/caches.ts";

/**
 * CHORE-44 Change 2 — build a real `EditorAPIContext` for direct `createEditorAPI`
 * unit tests. The model access projects the bridge fields (the former compat
 * path, now in test infra only, never production). Overrides merge on top.
 */
export function createTestAPIContext(overrides: Partial<EditorAPIContext> = {}): EditorAPIContext {
  const base = {
    currentBuffer: FunctionalTextBufferImpl.create("") as FunctionalTextBuffer,
    buffers: new Map<string, FunctionalTextBuffer>(),
    cursorLine: 0,
    cursorColumn: 0,
    terminal: new MockTerminal(),
    filesystem: new MockFileSystem(),
    mode: "normal" as const,
    lastCommand: "",
    statusMessage: "",
    viewportTop: 0,
    viewportLeft: 0,
    commandLine: "",
    spacePressed: false,
    mxCommand: "",
    cursorFocus: "buffer" as const,
    session: createEditorSession(),
    caches: createEditorRuntimeCaches(),
  };
  const ctx: EditorAPIContext = { ...base, ...overrides } as EditorAPIContext;
  ctx.access = {
    getModel: () => ({
      ...initialModel(),
      currentBuffer: ctx.currentBuffer ?? undefined,
      buffers: ctx.buffers,
      cursorPosition: { line: ctx.cursorLine, column: ctx.cursorColumn },
      mode: ctx.mode,
      statusMessage: ctx.statusMessage,
      commandLine: ctx.commandLine,
      mxCommand: ctx.mxCommand,
      cursorFocus: ctx.cursorFocus,
      lastCommand: ctx.lastCommand,
      currentFilename: ctx.currentFilename,
      viewportTop: ctx.viewportTop,
      viewportLeft: ctx.viewportLeft,
    }),
    applyModel: (m) => {
      ctx.cursorLine = m.cursorPosition.line;
      ctx.cursorColumn = m.cursorPosition.column;
      ctx.mode = m.mode;
      ctx.statusMessage = m.statusMessage;
      if (m.currentBuffer !== undefined) ctx.currentBuffer = m.currentBuffer;
    },
  };
  return ctx;
}

/** Isolate the SPEC-055 log file per editor instance so tail-load never reads
 *  the developer's real ~/.config/tmax/messages.log AND never carries entries
 *  from a prior test in the same file (each editor gets its own empty log). */
function isolatedLogPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "tmax-test-log-"));
  return join(dir, "messages.log");
}

/** Create an editor whose asynchronous startup has completed. */
export async function createStartedEditor(content?: string): Promise<Editor> {
  process.env.TMAX_LOG_PATH = isolatedLogPath();
  const editor = new Editor(new MockTerminal(), new MockFileSystem());
  await editor.start();
  if (content !== undefined) {
    editor.createBuffer("test", content);
  }
  return editor;
}

/** Return the successful value or fail the test immediately. */
export function expectRight<L, R>(result: EitherValue<L, R>, message: string = "Expected Right"): R {
  if (Either.isLeft(result)) {
    throw new Error(`${message}: ${String(result.left)}`);
  }
  return result.right;
}

/** Return the failed value or fail the test immediately. */
export function expectLeft<L, R>(result: EitherValue<L, R>, message: string = "Expected Left"): L {
  if (Either.isRight(result)) {
    throw new Error(`${message}: received Right`);
  }
  return result.left;
}

/** Return a present value or fail the test immediately. */
export function expectDefined<T>(value: T | null | undefined, message: string = "Expected defined value"): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

/** Return a T-Lisp list value or fail the test immediately. */
export function expectTlispList(value: TLispValue, message: string = "Expected T-Lisp list"): TLispValue[] {
  if (value.type !== "list" || !Array.isArray(value.value)) {
    throw new Error(`${message}: received ${value.type}`);
  }
  return value.value as TLispValue[];
}

/** Return a T-Lisp string value or fail the test immediately. */
export function expectTlispString(value: TLispValue, message: string = "Expected T-Lisp string"): string {
  if (value.type !== "string" || typeof value.value !== "string") {
    throw new Error(`${message}: received ${value.type}`);
  }
  return value.value;
}

/** Return a T-Lisp number value or fail the test immediately. */
export function expectTlispNumber(value: TLispValue, message: string = "Expected T-Lisp number"): number {
  if (value.type !== "number" || typeof value.value !== "number") {
    throw new Error(`${message}: received ${value.type}`);
  }
  return value.value;
}

/** Return a T-Lisp boolean value or fail the test immediately. */
export function expectTlispBoolean(value: TLispValue, message: string = "Expected T-Lisp boolean"): boolean {
  if (value.type !== "boolean" || typeof value.value !== "boolean") {
    throw new Error(`${message}: received ${value.type}`);
  }
  return value.value;
}

/** Return current buffer text or fail the test immediately. */
export function bufferText(editor: Editor): string {
  const buffer = editor.getState().currentBuffer;
  if (!buffer) {
    throw new Error("Expected a current buffer");
  }
  return expectRight(buffer.getContent(), "Expected current buffer content");
}

/** Execute T-Lisp through the editor's public interpreter boundary. */
export function executeTlisp(editor: Editor, expression: string): TLispValue {
  return expectRight(editor.getInterpreter().execute(expression), `T-Lisp failed: ${expression}`);
}

/** Return the visible text for a T-Lisp-owned minibuffer row. */
export function minibufferRowText(row: { segments: { text: string }[] }): string {
  return row.segments.map(segment => segment.text).join("");
}

/** Move the cursor through the public T-Lisp editor boundary. */
export function moveCursor(editor: Editor, line: number, column: number): void {
  executeTlisp(editor, `(cursor-move ${line} ${column})`);
}
