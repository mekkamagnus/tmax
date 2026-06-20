import { Editor } from "../../src/editor/editor.ts";
import type { TLispValue } from "../../src/tlisp/types.ts";
import { Either, type Either as EitherValue } from "../../src/utils/task-either.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
