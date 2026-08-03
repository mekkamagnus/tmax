/**
 * @file comment-ops.ts
 * @description Comment operation primitives for T-Lisp editor API (SPEC-074)
 *
 * Provides line/region commenting primitives driven by a per-major-mode
 * comment-syntax table. The comment prefix is resolved from the current
 * major-mode name via an internal lookup; fundamental mode (and any unknown
 * mode) has no entry, so the primitives return a clear validation error that
 * the T-Lisp `comment-dwim` command surfaces to the user via `(message ...)`.
 *
 * Available operations:
 * - comment-toggle-line: prepend (or strip) the active mode's comment prefix
 *   on the cursor's current line
 * - comment-region-lines: prepend the comment prefix to every line in a range
 * - uncomment-region-lines: strip the comment prefix from every line in a range
 * - comment-region-active-p: non-nil when a visual selection is active
 *
 * The region primitives are suffixed `-lines` (not `comment-region`/
 * `uncomment-region`) so the T-Lisp user-facing commands of those exact names
 * (per SPEC-074) can wrap them without shadowing the primitive and recursing
 * (a defun and a builtin of the same name would collide: the defun's body
 * would resolve its own binding first). `comment-toggle-line` has no defun
 * wrapper so it keeps the bare name.
 *
 * The actual buffer edits reuse the immutable `buffer.delete` + `buffer.insert`
 * pair (the same primitive pair `buffer-replace-range` in replace-ops.ts wraps)
 * and propagate the result through `setCurrentBuffer` so the model stays the
 * single source of truth.
 *
 * These are FACTUAL primitives only: they mutate the buffer per the requested
 * range/mode and report errors. Editor decisions (region-vs-line dispatch,
 * messaging, mode-exit) live in `src/tlisp/core/commands/comment.tlisp`.
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createBoolean } from "../../tlisp/values.ts";
import type { TextBuffer } from "../../core/contracts/buffer.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
import { Either } from "../../utils/task-either.ts";
import {
  validateArgsCount,
  validateArgType,
  validateBufferExists,
} from "../../utils/validation.ts";
import {
  createValidationError,
  createBufferError,
  AppError,
} from "../../error/types.ts";

/**
 * Per-major-mode comment-prefix table. Keyed on the major-mode name held at
 * `access.getModel().session.majorMode.fallback` (the same field
 * `major-mode-get` reads). Modes without an entry (notably `fundamental` and
 * `markdown`) intentionally have no comment syntax: the primitives report
 * "No comment syntax for major mode X" so the T-Lisp layer can surface it.
 *
 * Seeded from SPEC-074's mapping (lisp → `;`, ts/c/cpp/go/java → `//`,
 * python/shell → `#`). Modes added later extend this table.
 */
const COMMENT_SYNTAX: Record<string, string> = {
  lisp: ";",
  clojure: ";",
  scheme: ";",
  typescript: "//",
  javascript: "//",
  tsx: "//",
  js: "//",
  c: "//",
  cpp: "//",
  "c++": "//",
  java: "//",
  go: "//",
  rust: "//",
  swift: "//",
  kotlin: "//",
  php: "//",
  python: "#",
  shell: "#",
  bash: "#",
  sh: "#",
  zsh: "#",
  ruby: "#",
  yaml: "#",
  toml: "#",
  perl: "#",
  ini: "#",
  conf: "#",
};

/**
 * Resolve the comment prefix for the current major mode, or null when the
 * active mode has no comment syntax (fundamental / markdown / unknown).
 */
function resolveCommentSyntax(access: EditorModelAccess, getCurrentMajorMode?: () => string): string | null {
  const modeName: string = getCurrentMajorMode ? getCurrentMajorMode() : access.getModel().session.majorMode.fallback;
  return COMMENT_SYNTAX[modeName] ?? null;
}

/**
 * Build a "no comment syntax" validation error for the current major mode.
 * Centralized so every primitive surfaces the same message shape.
 */
function noSyntaxError(access: EditorModelAccess, getCurrentMajorMode?: () => string): Either<AppError, TLispValue> {
  const modeName = getCurrentMajorMode ? getCurrentMajorMode() : access.getModel().session.majorMode.fallback;
  return Either.left(createValidationError(
    "ConstraintViolation",
    `No comment syntax for major mode '${modeName}'`,
    "major-mode",
    modeName,
    "a major mode with a comment syntax",
  ));
}

/**
 * Create comment operation API functions.
 *
 * @param access - Model access handle (single source of truth for buffer,
 *   cursor, mode, and visual-selection reads).
 * @param setCurrentBuffer - Setter to propagate the immutable mutated buffer
 *   back into the model.
 * @param setCursorLine - Setter to reposition the cursor after a line toggle
 *   (kept in the signature to mirror replace-ops/indent-ops; the toggle
 *   primitive leaves the cursor on the toggled line).
 */
export function createCommentOps(
  access: EditorModelAccess,
  setCurrentBuffer: (buffer: TextBuffer) => void,
  setCursorLine: (line: number) => void,
  getCurrentMajorMode?: () => string,
): Map<string, TLispFunctionImpl> {
  // CHORE-39 Phase 4: buffer/cursor/mode reads flow through the State monad
  // against EditorModel; writes stay on the supplied setters to preserve side
  // effects.
  const getCursorLine = (): number => runModel(access, readModelField("cursorPosition")).line;
  const getCurrentBuffer = (): TextBuffer | null =>
    runModel(access, readModelField("currentBuffer")) ?? null;
  const getMode = (): string => runModel(access, readModelField("mode"));
  // The model's session.visual is plain state ({ selection: ... }); the live
  // accessor (session.visual.get) lives on the EditorSession runtime object
  // that the visual-ops factory owns. We read the model field directly.
  const getVisualSelection = () => access.getModel().session.visual.selection;
  const api = new Map<string, TLispFunctionImpl>();

  // (comment-toggle-line) -> nil | error
  // Toggles the current major-mode comment prefix on the cursor's line:
  // - if the trimmed line already starts with the prefix (optionally followed
  //   by one space), strip the prefix (and that one space);
  // - otherwise prepend `prefix + " "` after any leading whitespace so
  //   indented code keeps its indentation under the comment (Emacs / peer
  //   editor behavior).
  api.set("comment-toggle-line", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "comment-toggle-line");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const prefix = resolveCommentSyntax(access, getCurrentMajorMode);
    if (prefix === null) {
      return noSyntaxError(access, getCurrentMajorMode);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    const line = getCursorLine();
    const lineResult = currentBuffer!.getLine(line);
    if (Either.isLeft(lineResult)) {
      return Either.left(createBufferError("OutOfBounds", `comment-toggle-line: ${lineResult.left}`));
    }

    const content = lineResult.right;
    const trimmed = content.trimStart();
    const leadingWs = content.length - trimmed.length;

    // Already a comment? Match the prefix at the trimmed start, optionally
    // followed by exactly one space (the canonical `; ` / `// ` / `# ` form).
    if (trimmed.startsWith(prefix)) {
      let stripCols = prefix.length;
      const afterPrefixCol = leadingWs + prefix.length;
      if (content.length > afterPrefixCol && content[afterPrefixCol] === " ") {
        stripCols += 1;
      }
      const deleteResult = currentBuffer!.delete({
        start: { line, column: leadingWs },
        end: { line, column: leadingWs + stripCols },
      });
      if (Either.isLeft(deleteResult)) {
        return Either.left(createBufferError(
          "InvalidOperation",
          `comment-toggle-line: ${deleteResult.left}`,
        ));
      }
      setCurrentBuffer(deleteResult.right);
      return Either.right(createNil());
    }

    // Not a comment: prepend `prefix + " "` after leading whitespace.
    const insertText = `${prefix} `;
    const insertResult = currentBuffer!.insert({ line, column: leadingWs }, insertText);
    if (Either.isLeft(insertResult)) {
      return Either.left(createBufferError(
        "InvalidOperation",
        `comment-toggle-line: ${insertResult.left}`,
      ));
    }
    setCurrentBuffer(insertResult.right);
    setCursorLine(line);
    return Either.right(createNil());
  });

  // (comment-region-lines START-LINE END-LINE) -> nil | error
  // Prepends `prefix + " "` to every line in [START-LINE, END-LINE] (inclusive,
  // after normalizing so start <= end). Lines already carrying the prefix are
  // skipped so the operation is idempotent.
  api.set("comment-region-lines", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "comment-region-lines");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const startArg = args[0]!;
    const startValidation = validateArgType(startArg, "number", 0, "comment-region");
    if (Either.isLeft(startValidation)) {
      return Either.left(startValidation.left);
    }
    const endArg = args[1]!;
    const endValidation = validateArgType(endArg, "number", 1, "comment-region");
    if (Either.isLeft(endValidation)) {
      return Either.left(endValidation.left);
    }

    const prefix = resolveCommentSyntax(access, getCurrentMajorMode);
    if (prefix === null) {
      return noSyntaxError(access, getCurrentMajorMode);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    let startLine = Math.max(0, Math.floor(startArg.value as number));
    let endLine = Math.max(0, Math.floor(endArg.value as number));
    if (startLine > endLine) {
      const tmp = startLine;
      startLine = endLine;
      endLine = tmp;
    }

    const insertText = `${prefix} `;
    let working: TextBuffer = currentBuffer!;
    let mutated = false;
    for (let ln = startLine; ln <= endLine; ln++) {
      const lineResult = working.getLine(ln);
      if (Either.isLeft(lineResult)) {
        return Either.left(createBufferError("OutOfBounds", `comment-region-lines: line ${ln}: ${lineResult.left}`));
      }
      const content = lineResult.right;
      const trimmed = content.trimStart();
      const leadingWs = content.length - trimmed.length;
      // Idempotent: skip lines that already carry the prefix.
      if (trimmed.startsWith(prefix)) {
        continue;
      }
      const insertResult = working.insert({ line: ln, column: leadingWs }, insertText);
      if (Either.isLeft(insertResult)) {
        return Either.left(createBufferError(
          "InvalidOperation",
          `comment-region-lines: line ${ln}: ${insertResult.left}`,
        ));
      }
      working = insertResult.right;
      mutated = true;
    }

    if (mutated) {
      setCurrentBuffer(working);
    }
    return Either.right(createNil());
  });

  // (uncomment-region-lines START-LINE END-LINE) -> nil | error
  // Strips the comment prefix (and one following space) from every line in
  // [START-LINE, END-LINE] (inclusive, normalized). Lines without the prefix
  // are left untouched.
  api.set("uncomment-region-lines", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 2, "uncomment-region-lines");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }

    const startArg = args[0]!;
    const startValidation = validateArgType(startArg, "number", 0, "uncomment-region-lines");
    if (Either.isLeft(startValidation)) {
      return Either.left(startValidation.left);
    }
    const endArg = args[1]!;
    const endValidation = validateArgType(endArg, "number", 1, "uncomment-region-lines");
    if (Either.isLeft(endValidation)) {
      return Either.left(endValidation.left);
    }

    const prefix = resolveCommentSyntax(access, getCurrentMajorMode);
    if (prefix === null) {
      return noSyntaxError(access, getCurrentMajorMode);
    }

    const currentBuffer = getCurrentBuffer();
    const bufferValidation = validateBufferExists(currentBuffer);
    if (Either.isLeft(bufferValidation)) {
      return Either.left(bufferValidation.left);
    }

    let startLine = Math.max(0, Math.floor(startArg.value as number));
    let endLine = Math.max(0, Math.floor(endArg.value as number));
    if (startLine > endLine) {
      const tmp = startLine;
      startLine = endLine;
      endLine = tmp;
    }

    let working: TextBuffer = currentBuffer!;
    let mutated = false;
    for (let ln = startLine; ln <= endLine; ln++) {
      const lineResult = working.getLine(ln);
      if (Either.isLeft(lineResult)) {
        return Either.left(createBufferError("OutOfBounds", `uncomment-region-lines: line ${ln}: ${lineResult.left}`));
      }
      const content = lineResult.right;
      const trimmed = content.trimStart();
      if (!trimmed.startsWith(prefix)) {
        continue;
      }
      const leadingWs = content.length - trimmed.length;
      let stripCols = prefix.length;
      const afterPrefixCol = leadingWs + prefix.length;
      if (content.length > afterPrefixCol && content[afterPrefixCol] === " ") {
        stripCols += 1;
      }
      const deleteResult = working.delete({
        start: { line: ln, column: leadingWs },
        end: { line: ln, column: leadingWs + stripCols },
      });
      if (Either.isLeft(deleteResult)) {
        return Either.left(createBufferError(
          "InvalidOperation",
          `uncomment-region-lines: line ${ln}: ${deleteResult.left}`,
        ));
      }
      working = deleteResult.right;
      mutated = true;
    }

    if (mutated) {
      setCurrentBuffer(working);
    }
    return Either.right(createNil());
  });

  // (comment-region-active-p) -> boolean
  // Non-nil when the editor is in visual mode with an active selection — the
  // condition `comment-dwim` uses to branch region-vs-line. Reads the same
  // per-editor visual-selection state the visual-ops factory maintains.
  api.set("comment-region-active-p", (args: TLispValue[]): Either<AppError, TLispValue> => {
    const argsValidation = validateArgsCount(args, 0, "comment-region-active-p");
    if (Either.isLeft(argsValidation)) {
      return Either.left(argsValidation.left);
    }
    const inVisual = getMode() === "visual";
    const selection = getVisualSelection();
    return Either.right(createBoolean(inVisual && selection !== null));
  });

  return api;
}
