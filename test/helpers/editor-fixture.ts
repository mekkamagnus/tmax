import { Editor } from "../../src/editor/editor.ts";
import type { TLispValue } from "../../src/tlisp/types.ts";
import { Either, type Either as EitherValue } from "../../src/utils/task-either.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EditorAPIContext } from "../../src/editor/runtime/editor-api-context.ts";
import type { TextBuffer } from "../../src/core/types.ts";
import { initialModel } from "../../src/editor/functional/model.ts";
import type { EditorModel } from "../../src/editor/functional/model.ts";
import { update } from "../../src/editor/functional/index.ts";
import { createEditorSession, createEditorSessionState } from "../../src/editor/functional/domain-state.ts";
import { createEditorRuntimeCaches } from "../../src/editor/runtime/caches.ts";

/**
 * Options for {@link createTestAPIContext}. The fixture holds a real
 * `EditorModel`; `currentBuffer` / `buffers` overrides seed that model.
 */
export interface TestAPIContextOptions {
  /** Seed buffer for `model.currentBuffer` (also inserted into `buffers` as "default"). */
  currentBuffer?: TextBuffer;
  /** Seed buffer registry (defaults to a fresh empty Map; "default" is added if `currentBuffer` is set). */
  buffers?: Map<string, TextBuffer>;
}

/**
 * Test-only extras layered onto {@link EditorAPIContext} so legacy tests that
 * previously read/wrote mutable bridge fields can seed and observe model
 * state through a typed surface. These members do NOT exist on the production
 * `EditorAPIContext` (AC2.6) — they are test-infrastructure projections over
 * the model held by the fixture.
 */
export interface TestAPIContext extends EditorAPIContext {
  /** Live mutable buffer registry (the same Map the model holds). Seed/observe here. */
  readonly buffers: Map<string, TextBuffer>;
  /** Direct model read (alias for `access.getModel()`). */
  getModel(): EditorModel;
  /** Seed `model.currentBuffer` directly (test setup). */
  setCurrentBufferDirect(buffer: TextBuffer): void;
  /** Seed `model.statusMessage` directly (test setup/observation). */
  setStatusMessage(message: string): void;
  /** Seed `model.lastCommand` directly (test setup). */
  setLastCommand(command: string): void;
}

/**
 * CHORE-44 Change 2 — build a real `EditorAPIContext` for direct
 * `createEditorAPI` unit tests. Backed by a genuine `EditorModel`: reads go
 * through `access.getModel()` and writes go through `applyUpdate(msg)` (which
 * runs the pure reducer) or the four side-effectful methods (which, for the
 * fixture, delegate to the reducer since there are no tabs/windows/metadata
 * to sync). No mutable bridge fields — AC2.6.
 *
 * The returned handle includes the {@link TestAPIContext} test-only members
 * (`buffers`, `getModel`, `setStatusMessage`, `setLastCommand`,
 * `setCurrentBufferDirect`) so existing tests can seed and observe state
 * without re-introducing bridge properties on the production context.
 */
export function createTestAPIContext(options: TestAPIContextOptions = {}): TestAPIContext {
  const buffers = options.buffers ?? new Map<string, TextBuffer>();
  let model: EditorModel = {
    ...initialModel(),
    buffers,
    currentBuffer: options.currentBuffer,
  };

  const ctx: EditorAPIContext = {
    access: {
      getModel: () => model,
      applyModel: (m) => { model = m; },
    },
    session: createEditorSession(createEditorSessionState()),
    caches: createEditorRuntimeCaches(),
    terminal: new MockTerminal(),
    filesystem: new MockFileSystem(),
    applyUpdate: (msg) => { model = update(model, msg).model; },
    // The fixture has no tabs/windows/bufferMetadata, so the side-effectful
    // methods reduce to plain model commits via applyUpdate.
    setCurrentBuffer: (buffer) => {
      model = update(model, { type: "SetCurrentBuffer", buffer: buffer ?? undefined }).model;
    },
    setCursorLine: (line) => {
      model = update(model, { type: "SetCursorPosition", position: { ...model.cursorPosition, line } }).model;
    },
    setCursorColumn: (column) => {
      model = update(model, { type: "SetCursorPosition", position: { ...model.cursorPosition, column } }).model;
    },
    setCurrentFilename: (filename) => {
      model = update(model, { type: "SetCurrentFilename", filename }).model;
    },
    getSpacePressed: () => false,
    setSpacePressed: () => { /* no-op: fixture has no leader-key state */ },
  };

  // Test-only projections over the model. These are layered on AFTER the
  // EditorAPIContext object so the production context shape (AC2.6) is the
  // authoritative surface handed to `createEditorAPI`.
  const testCtx: TestAPIContext = {
    ...ctx,
    get buffers() { return buffers; },
    getModel: () => model,
    setCurrentBufferDirect: (buffer) => { model = { ...model, currentBuffer: buffer }; },
    setStatusMessage: (message) => { model = { ...model, statusMessage: message }; },
    setLastCommand: (command) => { model = { ...model, lastCommand: command }; },
  };
  return testCtx;
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
