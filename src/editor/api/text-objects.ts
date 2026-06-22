/**
 * @file text-objects.ts
 * @description Basic text objects for T-Lisp editor API (US-1.8.1)
 *
 * Implements Vim-style text objects:
 * - diw/daw: delete inner/around word
 * - ci"/ca': change inside/around quotes
 * - di)/ci(: delete/change inside parentheses
 * - ci{/ci{: change inside braces
 * - dit: delete inside tag
 *
 * Text objects allow efficient text manipulation by operating on semantic
 * units like words, quoted strings, parentheses, etc.
 *
 * NOTE: Functions return the new buffer after modification (immutable buffer pattern)
 * NOTE: Deleted text also added to kill ring (US-1.9.1)
 */

import type { FunctionalTextBuffer, Position } from "../../core/types.ts";
import { Either } from "../../utils/task-either.ts";
import { killRingSave } from "./kill-ring.ts";
import { registerDelete } from "./evil-integration.ts";
import { isWordChar, isWhitespace, findWordStart, findWordEndOnLine as findWordEnd, findWordEndWithSpace } from "./text-utils.ts";

/**
 * Register storage for deleted text
 * Shared with delete-ops.ts
 */
let deleteRegister: string = "";

/**
 * Get the current content of the delete register
 */
export function getDeleteRegister(): string {
  return deleteRegister;
}

/**
 * Set the delete register content
 */
export function setDeleteRegister(text: string): void {
  deleteRegister = text;
}

/**
 * Delete inner word (diw)
 * Deletes the word under the cursor, leaving trailing spaces.
 * COUNT extends the deletion across N consecutive inner words (vim semantics
 * for `d2iw` — count multiplies the text object, including the whitespace
 * between words but not the trailing whitespace after the last word).
 * Returns the new buffer after deletion.
 */
export function deleteInnerWord(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number,
  count: number = 1
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  if (content.length === 0) {
    return Either.left("Buffer is empty");
  }

  const startResult = findWordStart(content, line, column);
  if (Either.isLeft(startResult)) {
    return Either.left(startResult.left);
  }

  const endResult = findWordEnd(content, line, column);
  if (Either.isLeft(endResult)) {
    return Either.left(endResult.left);
  }

  const start = startResult.right;
  let end = endResult.right;

  // Extend end across COUNT-1 additional inner words. The whitespace between
  // words is included; the whitespace after the final word is not.
  const lines = content.split("\n");
  const lineText = lines[line]!;
  const safeCount = Math.max(1, Math.floor(count));
  for (let i = 1; i < safeCount; i++) {
    while (end < lineText.length && isWhitespace(lineText[end]!)) end++;
    while (end < lineText.length && isWordChar(lineText[end]!)) end++;
  }

  const textToDelete = lineText.substring(start, end);

  // Store in register
  setDeleteRegister(textToDelete);  // Legacy register
  registerDelete(textToDelete, false);  // Evil Integration (US-1.9.3)

  // Delete the text and return new buffer
  return buffer.delete({
    start: { line, column: start },
    end: { line, column: end }
  });
}

/**
 * Delete around word (daw)
 * Deletes the word under the cursor including trailing spaces.
 * COUNT extends across N around-word objects (vim `d2aw` includes the
 * trailing whitespace of the final word).
 * Returns the new buffer after deletion.
 */
export function deleteAroundWord(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number,
  count: number = 1
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  if (content.length === 0) {
    return Either.left("Buffer is empty");
  }

  const startResult = findWordStart(content, line, column);
  if (Either.isLeft(startResult)) {
    return Either.left(startResult.left);
  }

  const endResult = findWordEndWithSpace(content, line, column);
  if (Either.isLeft(endResult)) {
    return Either.left(endResult.left);
  }

  const start = startResult.right;
  let end = endResult.right;

  // If at end of line, don't go beyond
  const lines = content.split("\n");
  const lineText = lines[line] ?? "";
  if (end > lineText.length) {
    end = lineText.length;
  }

  // Extend across COUNT-1 additional around-word objects. Each extension
  // captures one more word plus its trailing whitespace.
  const safeCount = Math.max(1, Math.floor(count));
  for (let i = 1; i < safeCount; i++) {
    while (end < lineText.length && isWhitespace(lineText[end]!)) end++;
    while (end < lineText.length && isWordChar(lineText[end]!)) end++;
    while (end < lineText.length && isWhitespace(lineText[end]!)) end++;
  }
  if (end > lineText.length) {
    end = lineText.length;
  }

  // Get the text to delete
  const textToDelete = lineText.substring(start, end);

  // Store in register
  setDeleteRegister(textToDelete);  // Legacy register
  registerDelete(textToDelete, false);  // Evil Integration (US-1.9.3)

  // Delete the text and return new buffer
  return buffer.delete({
    start: { line, column: start },
    end: { line, column: end }
  });
}

/**
 * Change inner word (ciw)
 * Deletes the word under the cursor (same range as diw). COUNT extends the
 * deletion across N words. The ops wrapper triggers the mode transition to
 * insert — TS primitive is pure delete.
 */
export function changeInnerWord(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number,
  count: number = 1
): Either<string, FunctionalTextBuffer> {
  return deleteInnerWord(buffer, line, column, count);
}

/**
 * Change around word (caw)
 * Deletes the word with trailing space (same range as daw). COUNT extends the
 * deletion across N around-words. Mode transition lives in the ops wrapper.
 */
export function changeAroundWord(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number,
  count: number = 1
): Either<string, FunctionalTextBuffer> {
  return deleteAroundWord(buffer, line, column, count);
}

/**
 * Find matching quote for single or double quotes
 */
function findMatchingQuote(
  content: string,
  line: number,
  column: number,
  quoteChar: "'" | '"'
): Either<string, { start: number; end: number }> {
  const lines = content.split("\n");

  if (line >= lines.length) {
    return Either.left("Line out of bounds");
  }

  const currentLine = lines[line]!;

  // Find opening quote before cursor
  let start = column;
  while (start >= 0 && currentLine[start]! !== quoteChar) {
    start--;
  }

  if (start < 0) {
    return Either.left(`No opening ${quoteChar} found`);
  }

  // Find closing quote after cursor
  let end = column + 1;
  while (end < currentLine.length && currentLine[end]! !== quoteChar) {
    end++;
  }

  if (end >= currentLine.length) {
    return Either.left(`No closing ${quoteChar} found`);
  }

  return Either.right({ start, end });
}

/**
 * Change inner single quote (ci')
 * Deletes inside single quotes and returns { buffer: newBuffer, mode: "INSERT" }
 */
export function deleteInnerSingleQuote(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingQuote(content, line, column, "'");
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start + 1, end);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  return buffer.delete({
    start: { line, column: start + 1 },
    end: { line, column: end }
  });
}

/**
 * Delete around single quote (da')
 * Deletes including single quotes and returns new buffer
 */
export function deleteAroundSingleQuote(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingQuote(content, line, column, "'");
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start, end + 1);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  return buffer.delete({
    start: { line, column: start },
    end: { line, column: end + 1 }
  });
}

/**
 * Delete inner double quote (di")
 * Deletes inside double quotes and returns new buffer
 */
export function deleteInnerDoubleQuote(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingQuote(content, line, column, '"');
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start + 1, end);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  return buffer.delete({
    start: { line, column: start + 1 },
    end: { line, column: end }
  });
}

/**
 * Delete around double quote (da")
 * Deletes including double quotes and returns new buffer
 */
export function deleteAroundDoubleQuote(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingQuote(content, line, column, '"');
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start, end + 1);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  return buffer.delete({
    start: { line, column: start },
    end: { line, column: end + 1 }
  });
}

/**
 * Change inner single quote (ci')
 * Deletes inside single quotes and returns { buffer: newBuffer, mode: "INSERT" }
 */
export function changeInnerSingleQuote(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingQuote(content, line, column, "'");
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  // Store content between quotes (not including quotes)
  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start + 1, end);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  // Delete content between quotes (not including quotes) and return new buffer
  return buffer.delete({
    start: { line, column: start + 1 },
    end: { line, column: end }
  });
}

/**
 * Change around single quote (ca')
 * Deletes including single quotes and returns new buffer
 */
export function changeAroundSingleQuote(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingQuote(content, line, column, "'");
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  // Store content including quotes
  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start, end + 1);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  // Delete including quotes and return new buffer
  return buffer.delete({
    start: { line, column: start },
    end: { line, column: end + 1 }
  });
}

/**
 * Change inner double quote (ci")
 * Deletes inside double quotes and returns new buffer
 */
export function changeInnerDoubleQuote(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingQuote(content, line, column, '"');
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  // Store content between quotes
  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start + 1, end);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  // Delete content between quotes and return new buffer
  return buffer.delete({
    start: { line, column: start + 1 },
    end: { line, column: end }
  });
}

/**
 * Change around double quote (ca")
 * Deletes including double quotes and returns new buffer
 */
export function changeAroundDoubleQuote(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingQuote(content, line, column, '"');
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  // Store content including quotes
  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start, end + 1);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  // Delete including quotes and return new buffer
  return buffer.delete({
    start: { line, column: start },
    end: { line, column: end + 1 }
  });
}

/**
 * Find matching parenthesis
 */
function findMatchingParen(
  content: string,
  line: number,
  column: number,
  openChar: string,
  closeChar: string
): Either<string, { start: number; end: number }> {
  const lines = content.split("\n");

  if (line >= lines.length) {
    return Either.left("Line out of bounds");
  }

  const currentLine = lines[line]!;

  // Find opening parenthesis before cursor
  let start = column;
  let depth = 0;
  while (start >= 0) {
    if (currentLine[start]! === closeChar) {
      depth++;
    } else if (currentLine[start]! === openChar) {
      if (depth === 0) {
        break;
      }
      depth--;
    }
    start--;
  }

  if (start < 0) {
    return Either.left(`No opening ${openChar} found`);
  }

  // Find closing parenthesis after cursor
  let end = column + 1;
  depth = 0;
  while (end < currentLine.length) {
    if (currentLine[end]! === openChar) {
      depth++;
    } else if (currentLine[end]! === closeChar) {
      if (depth === 0) {
        break;
      }
      depth--;
    }
    end++;
  }

  if (end >= currentLine.length) {
    return Either.left(`No closing ${closeChar} found`);
  }

  return Either.right({ start, end });
}

/**
 * Delete inner parenthesis (di))
 * Deletes inside parentheses and returns new buffer
 */
export function deleteInnerParen(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingParen(content, line, column, "(", ")");
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  // Store content between parens
  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start + 1, end);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  // Delete content between parens and return new buffer
  return buffer.delete({
    start: { line, column: start + 1 },
    end: { line, column: end }
  });
}

/**
 * Change inner parenthesis (ci))
 * Deletes inside parentheses and returns new buffer
 */
export function changeInnerParen(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingParen(content, line, column, "(", ")");
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  // Store content between parens
  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start + 1, end);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  // Delete content between parens and return new buffer
  return buffer.delete({
    start: { line, column: start + 1 },
    end: { line, column: end }
  });
}

/**
 * Delete around parenthesis (da))
 * Deletes including parens and returns new buffer
 */
export function deleteAroundParen(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingParen(content, line, column, "(", ")");
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start, end + 1);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  return buffer.delete({
    start: { line, column: start },
    end: { line, column: end + 1 }
  });
}

/**
 * Change around parenthesis (ca))
 * Deletes including parens. Mode transition lives in the ops wrapper.
 */
export function changeAroundParen(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  return deleteAroundParen(buffer, line, column);
}

/**
 * Delete inner brace (di{)
 * Deletes inside braces and returns new buffer
 */
export function deleteInnerBrace(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingParen(content, line, column, "{", "}");
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  // Store content between braces
  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start + 1, end);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  // Delete content between braces and return new buffer
  return buffer.delete({
    start: { line, column: start + 1 },
    end: { line, column: end }
  });
}

/**
 * Change inner brace (ci{)
 * Deletes inside braces and returns new buffer
 */
export function changeInnerBrace(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingParen(content, line, column, "{", "}");
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  // Store content between braces
  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start + 1, end);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  // Delete content between braces and return new buffer
  return buffer.delete({
    start: { line, column: start + 1 },
    end: { line, column: end }
  });
}

/**
 * Delete around brace (da})
 * Deletes including braces and returns new buffer
 */
export function deleteAroundBrace(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingParen(content, line, column, "{", "}");
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start, end + 1);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  return buffer.delete({
    start: { line, column: start },
    end: { line, column: end + 1 }
  });
}

/**
 * Change around brace (ca})
 * Deletes including braces. Mode transition lives in the ops wrapper.
 */
export function changeAroundBrace(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  return deleteAroundBrace(buffer, line, column);
}

/**
 * Delete inner bracket (di])
 * Deletes inside square brackets and returns new buffer
 */
export function deleteInnerBracket(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingParen(content, line, column, "[", "]");
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  // Store content between brackets
  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start + 1, end);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  // Delete content between brackets and return new buffer
  return buffer.delete({
    start: { line, column: start + 1 },
    end: { line, column: end }
  });
}

/**
 * Change inner bracket (ci])
 * Deletes inside brackets. Mode transition lives in the ops wrapper.
 */
export function changeInnerBracket(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  return deleteInnerBracket(buffer, line, column);
}

/**
 * Delete around bracket (da])
 * Deletes including brackets and returns new buffer
 */
export function deleteAroundBracket(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingParen(content, line, column, "[", "]");
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start, end + 1);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  return buffer.delete({
    start: { line, column: start },
    end: { line, column: end + 1 }
  });
}

/**
 * Change around bracket (ca])
 * Deletes including brackets. Mode transition lives in the ops wrapper.
 */
export function changeAroundBracket(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  return deleteAroundBracket(buffer, line, column);
}

/**
 * Delete inner angle bracket (di<)
 * Deletes inside angle brackets and returns new buffer
 */
export function deleteInnerAngle(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingParen(content, line, column, "<", ">");
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  // Store content between angle brackets
  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start + 1, end);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  // Delete content between angle brackets and return new buffer
  return buffer.delete({
    start: { line, column: start + 1 },
    end: { line, column: end }
  });
}

/**
 * Change inner angle bracket (ci<)
 * Deletes inside angle brackets. Mode transition lives in the ops wrapper.
 */
export function changeInnerAngle(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  return deleteInnerAngle(buffer, line, column);
}

/**
 * Delete around angle bracket (da<)
 * Deletes including angle brackets and returns new buffer
 */
export function deleteAroundAngle(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const matchResult = findMatchingParen(content, line, column, "<", ">");
  if (Either.isLeft(matchResult)) {
    return Either.left(matchResult.left);
  }

  const { start, end } = matchResult.right;

  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start, end + 1);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  return buffer.delete({
    start: { line, column: start },
    end: { line, column: end + 1 }
  });
}

/**
 * Change around angle bracket (ca<)
 * Deletes including angle brackets. Mode transition lives in the ops wrapper.
 */
export function changeAroundAngle(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  return deleteAroundAngle(buffer, line, column);
}

/**
 * Find HTML/XML tag boundaries at cursor position.
 * Returns inner bounds (between tags) for di/cit and outer bounds (including
 * the tags themselves) for dat/cat. `start`/`end` are inner; `outerStart`/
 * `outerEnd` are the around positions.
 */
function findTagBounds(
  content: string,
  line: number,
  column: number
): Either<string, { start: number; end: number; outerStart: number; outerEnd: number; tagName: string } | null> {
  const lines = content.split("\n");

  if (line >= lines.length) {
    return Either.left("Line out of bounds");
  }

  const currentLine = lines[line]!;

  // Check if we're on a self-closing tag
  const selfClosingRegex = /<(\w+)[^>]*\/>/;
  const selfClosingMatch = currentLine.match(selfClosingRegex);
  if (selfClosingMatch) {
    const matchStart = currentLine.indexOf(selfClosingMatch[0]);
    const matchEnd = matchStart + selfClosingMatch[0].length;

    // Check if cursor is within this tag
    if (column >= matchStart && column <= matchEnd) {
      return Either.right(null); // Self-closing tag has no content
    }
  }

  // Find opening tag before cursor
  const openTagRegex = /<(\w+)[^>]*>/;
  let openTagStart = -1;
  let openTagEnd = -1;
  let tagName = "";

  // Search backwards from cursor for opening tag
  for (let i = column; i >= 0; i--) {
    if (currentLine[i]! === "<") {
      const match = currentLine.substring(i).match(openTagRegex);
      if (match) {
        openTagStart = i;
        openTagEnd = i + match[0].length;
        tagName = match[1]!;
        break;
      }
    }
  }

  if (openTagStart < 0) {
    return Either.left("No opening tag found");
  }

  // Find closing tag after cursor
  const closeTagRegex = new RegExp(`</${tagName}>`);
  const closeMatch = currentLine.substring(openTagEnd).match(closeTagRegex);

  if (!closeMatch) {
    return Either.left(`No closing tag for ${tagName} found`);
  }

  const closeTagStart = openTagEnd + closeMatch.index!;
  const closeTagEnd = closeTagStart + closeMatch[0].length;

  return Either.right({
    start: openTagEnd,
    end: closeTagStart,
    outerStart: openTagStart,
    outerEnd: closeTagEnd,
    tagName
  });
}

/**
 * Delete inner tag (dit)
 * Deletes inside HTML/XML tags and returns new buffer
 */
export function deleteInnerTag(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const boundsResult = findTagBounds(content, line, column);
  if (Either.isLeft(boundsResult)) {
    return Either.left(boundsResult.left);
  }

  const bounds = boundsResult.right;

  // Self-closing tag has no content to delete
  if (bounds === null) {
    return Either.right(buffer);
  }

  const { start, end } = bounds;

  // Store content between tags
  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(start, end);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  // Delete content between tags and return new buffer
  return buffer.delete({
    start: { line, column: start },
    end: { line, column: end }
  });
}

/**
 * Change inner tag (cit)
 * Clears tag contents. Mode transition lives in the ops wrapper.
 */
export function changeInnerTag(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  return deleteInnerTag(buffer, line, column);
}

/**
 * Delete around tag (dat)
 * Deletes opening tag, contents, and closing tag.
 */
export function deleteAroundTag(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  const contentResult = buffer.getContent();
  if (Either.isLeft(contentResult)) {
    return Either.left(contentResult.left);
  }

  const content = contentResult.right;
  const boundsResult = findTagBounds(content, line, column);
  if (Either.isLeft(boundsResult)) {
    return Either.left(boundsResult.left);
  }

  const bounds = boundsResult.right;
  if (bounds === null) {
    return Either.right(buffer);
  }

  const { outerStart, outerEnd } = bounds;

  const lines = content.split("\n");
  const textToDelete = lines[line]!.substring(outerStart, outerEnd);
  setDeleteRegister(textToDelete);
  registerDelete(textToDelete, false);

  return buffer.delete({
    start: { line, column: outerStart },
    end: { line, column: outerEnd }
  });
}

/**
 * Change around tag (cat)
 * Deletes opening tag, contents, and closing tag.
 * Mode transition lives in the ops wrapper.
 */
export function changeAroundTag(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
): Either<string, FunctionalTextBuffer> {
  return deleteAroundTag(buffer, line, column);
}
