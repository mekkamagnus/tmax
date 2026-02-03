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
 * Check if a character is a word character
 * Word characters are alphanumeric plus underscore
 */
function isWordChar(char: string): boolean {
  return /^[a-zA-Z0-9_]$/.test(char);
}

/**
 * Check if a character is whitespace
 */
function isWhitespace(char: string): boolean {
  return /^\s$/.test(char);
}

/**
 * Find the start of the word at the given position
 */
function findWordStart(content: string, line: number, column: number): Either<string, number> {
  const lines = content.split("\n");

  if (line >= lines.length) {
    return Either.left("Line out of bounds");
  }

  const currentLine = lines[line];

  // Skip whitespace to find the word
  while (column < currentLine.length && isWhitespace(currentLine[column])) {
    column++;
  }

  // Find start of word
  while (column > 0 && isWordChar(currentLine[column - 1])) {
    column--;
  }

  return Either.right(column);
}

/**
 * Find the end of the word at the given position
 */
function findWordEnd(content: string, line: number, column: number): Either<string, number> {
  const lines = content.split("\n");

  if (line >= lines.length) {
    return Either.left("Line out of bounds");
  }

  const currentLine = lines[line];

  // Skip whitespace to find the word
  while (column < currentLine.length && isWhitespace(currentLine[column])) {
    column++;
  }

  // Find end of word
  while (column < currentLine.length && isWordChar(currentLine[column])) {
    column++;
  }

  return Either.right(column);
}

/**
 * Find the end of the word including trailing whitespace
 */
function findWordEndWithSpace(content: string, line: number, column: number): Either<string, number> {
  const lines = content.split("\n");

  if (line >= lines.length) {
    return Either.left("Line out of bounds");
  }

  const currentLine = lines[line];

  // Skip whitespace to find the word
  while (column < currentLine.length && isWhitespace(currentLine[column])) {
    column++;
  }

  // Find end of word
  while (column < currentLine.length && isWordChar(currentLine[column])) {
    column++;
  }

  // Include trailing whitespace
  while (column < currentLine.length && isWhitespace(currentLine[column])) {
    column++;
  }

  return Either.right(column);
}

/**
 * Delete inner word (diw)
 * Deletes the word under the cursor, leaving trailing spaces
 * Returns the new buffer after deletion
 */
export function deleteInnerWord(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
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
  const end = endResult.right;

  // Get the text to delete
  const lines = content.split("\n");
  const textToDelete = lines[line].substring(start, end);

  // Store in register
  setDeleteRegister(textToDelete);
  killRingSave(textToDelete);  // Also save to kill ring (US-1.9.1)

  // Delete the text and return new buffer
  return buffer.delete({
    start: { line, column: start },
    end: { line, column: end }
  });
}

/**
 * Delete around word (daw)
 * Deletes the word under the cursor including trailing spaces
 * Returns the new buffer after deletion
 */
export function deleteAroundWord(
  buffer: FunctionalTextBuffer,
  line: number,
  column: number
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
  if (end > lines[line].length) {
    end = lines[line].length;
  }

  // Get the text to delete
  const textToDelete = lines[line].substring(start, end);

  // Store in register
  setDeleteRegister(textToDelete);
  killRingSave(textToDelete);  // Also save to kill ring (US-1.9.1)

  // Delete the text and return new buffer
  return buffer.delete({
    start: { line, column: start },
    end: { line, column: end }
  });
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

  const currentLine = lines[line];

  // Find opening quote before cursor
  let start = column;
  while (start >= 0 && currentLine[start] !== quoteChar) {
    start--;
  }

  if (start < 0) {
    return Either.left(`No opening ${quoteChar} found`);
  }

  // Find closing quote after cursor
  let end = column + 1;
  while (end < currentLine.length && currentLine[end] !== quoteChar) {
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
  const textToDelete = lines[line].substring(start + 1, end);
  setDeleteRegister(textToDelete);
  killRingSave(textToDelete);  // Also save to kill ring (US-1.9.1)

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
  const textToDelete = lines[line].substring(start, end + 1);
  setDeleteRegister(textToDelete);
  killRingSave(textToDelete);  // Also save to kill ring (US-1.9.1)

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
  const textToDelete = lines[line].substring(start + 1, end);
  setDeleteRegister(textToDelete);
  killRingSave(textToDelete);  // Also save to kill ring (US-1.9.1)

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
  const textToDelete = lines[line].substring(start, end + 1);
  setDeleteRegister(textToDelete);
  killRingSave(textToDelete);  // Also save to kill ring (US-1.9.1)

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

  const currentLine = lines[line];

  // Find opening parenthesis before cursor
  let start = column;
  let depth = 0;
  while (start >= 0) {
    if (currentLine[start] === closeChar) {
      depth++;
    } else if (currentLine[start] === openChar) {
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
    if (currentLine[end] === openChar) {
      depth++;
    } else if (currentLine[end] === closeChar) {
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
  const textToDelete = lines[line].substring(start + 1, end);
  setDeleteRegister(textToDelete);
  killRingSave(textToDelete);  // Also save to kill ring (US-1.9.1)

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
  const textToDelete = lines[line].substring(start + 1, end);
  setDeleteRegister(textToDelete);
  killRingSave(textToDelete);  // Also save to kill ring (US-1.9.1)

  // Delete content between parens and return new buffer
  return buffer.delete({
    start: { line, column: start + 1 },
    end: { line, column: end }
  });
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
  const textToDelete = lines[line].substring(start + 1, end);
  setDeleteRegister(textToDelete);
  killRingSave(textToDelete);  // Also save to kill ring (US-1.9.1)

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
  const textToDelete = lines[line].substring(start + 1, end);
  setDeleteRegister(textToDelete);
  killRingSave(textToDelete);  // Also save to kill ring (US-1.9.1)

  // Delete content between braces and return new buffer
  return buffer.delete({
    start: { line, column: start + 1 },
    end: { line, column: end }
  });
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
  const textToDelete = lines[line].substring(start + 1, end);
  setDeleteRegister(textToDelete);
  killRingSave(textToDelete);  // Also save to kill ring (US-1.9.1)

  // Delete content between brackets and return new buffer
  return buffer.delete({
    start: { line, column: start + 1 },
    end: { line, column: end }
  });
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
  const textToDelete = lines[line].substring(start + 1, end);
  setDeleteRegister(textToDelete);
  killRingSave(textToDelete);  // Also save to kill ring (US-1.9.1)

  // Delete content between angle brackets and return new buffer
  return buffer.delete({
    start: { line, column: start + 1 },
    end: { line, column: end }
  });
}

/**
 * Find HTML/XML tag boundaries at cursor position
 */
function findTagBounds(
  content: string,
  line: number,
  column: number
): Either<string, { start: number; end: number; tagName: string } | null> {
  const lines = content.split("\n");

  if (line >= lines.length) {
    return Either.left("Line out of bounds");
  }

  const currentLine = lines[line];

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
    if (currentLine[i] === "<") {
      const match = currentLine.substring(i).match(openTagRegex);
      if (match) {
        openTagStart = i;
        openTagEnd = i + match[0].length;
        tagName = match[1];
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

  const closeTagStart = openTagEnd + closeMatch.index;
  const closeTagEnd = closeTagStart + closeMatch[0].length;

  return Either.right({
    start: openTagEnd,
    end: closeTagStart,
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
  const textToDelete = lines[line].substring(start, end);
  setDeleteRegister(textToDelete);
  killRingSave(textToDelete);  // Also save to kill ring (US-1.9.1)

  // Delete content between tags and return new buffer
  return buffer.delete({
    start: { line, column: start },
    end: { line, column: end }
  });
}
