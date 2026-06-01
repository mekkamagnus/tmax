/**
 * @file text-utils.ts
 * @description Shared text utility functions for editor operations
 *
 * Single source of truth for word character detection, word boundary
 * finding, and whitespace utilities used across editor API modules.
 */

import { Either } from "../../utils/task-either.ts";

/**
 * Check if a character is a word character (alphanumeric or underscore)
 */
export function isWordChar(char: string): boolean {
  return /[a-zA-Z0-9_]/.test(char);
}

/**
 * Check if a character is whitespace
 */
export function isWhitespace(char: string): boolean {
  return /^\s$/.test(char);
}

/**
 * Find the first non-blank column in a line
 * @param lineText - Text of the line
 * @returns Column index of first non-blank character
 */
export function findFirstNonBlankColumn(lineText: string): number {
  let column = 0;
  while (column < lineText.length && /\s/.test(lineText[column]!)) {
    column++;
  }
  return column;
}

/**
 * Find the end of the current word starting from position.
 * Returns the position after the last character of the word.
 * Used by delete-word, change-word, yank-word operations.
 */
export function findWordEnd(
  text: string,
  line: number,
  column: number
): { line: number; column: number } {
  const lines = text.split('\n');

  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    return { line: 0, column: 0 };
  }

  let currentLine = Math.max(0, Math.min(line, lines.length - 1));
  let currentColumn = Math.max(0, Math.min(column, lines[currentLine]!.length - 1));

  const lineText = lines[currentLine]!;

  if (currentColumn >= lineText.length || !isWordChar(lineText[currentColumn]!)) {
    while (currentColumn < lineText.length && !isWordChar(lineText[currentColumn]!)) {
      currentColumn++;
    }

    if (currentColumn >= lineText.length && currentLine < lines.length - 1) {
      currentLine++;
      currentColumn = 0;
      while (currentLine < lines.length && currentColumn >= lines[currentLine]!.length) {
        currentLine++;
        currentColumn = 0;
      }
      return { line: currentLine, column: currentColumn };
    }
  }

  while (currentColumn < lineText.length && isWordChar(lineText[currentColumn]!)) {
    currentColumn++;
  }

  return { line: currentLine, column: currentColumn };
}

/**
 * Find the end of a word on a single line (for text-object operations).
 * Returns the column after the last word character.
 */
export function findWordEndOnLine(
  content: string,
  line: number,
  column: number
): Either<string, number> {
  const lines = content.split("\n");

  if (line >= lines.length) {
    return Either.left("Line out of bounds");
  }

  const currentLine = lines[line]!;

  // Skip whitespace to find the word
  let col = column;
  while (col < currentLine.length && isWhitespace(currentLine[col]!)) {
    col++;
  }

  // Find end of word
  while (col < currentLine.length && isWordChar(currentLine[col]!)) {
    col++;
  }

  return Either.right(col);
}

/**
 * Find the end of a word on a single line including trailing whitespace.
 * Returns the column after trailing whitespace.
 */
export function findWordEndWithSpace(
  content: string,
  line: number,
  column: number
): Either<string, number> {
  const lines = content.split("\n");

  if (line >= lines.length) {
    return Either.left("Line out of bounds");
  }

  const currentLine = lines[line]!;

  // Skip whitespace to find the word
  let col = column;
  while (col < currentLine.length && isWhitespace(currentLine[col]!)) {
    col++;
  }

  // Find end of word
  while (col < currentLine.length && isWordChar(currentLine[col]!)) {
    col++;
  }

  // Include trailing whitespace
  while (col < currentLine.length && isWhitespace(currentLine[col]!)) {
    col++;
  }

  return Either.right(col);
}

/**
 * Find the start of the word at the given position.
 * Returns the column of the first character of the word.
 */
export function findWordStart(
  content: string,
  line: number,
  column: number
): Either<string, number> {
  const lines = content.split("\n");

  if (line >= lines.length) {
    return Either.left("Line out of bounds");
  }

  const currentLine = lines[line]!;

  // Skip whitespace to find the word
  let col = column;
  while (col < currentLine.length && isWhitespace(currentLine[col]!)) {
    col++;
  }

  // Find start of word
  while (col > 0 && isWordChar(currentLine[col - 1]!)) {
    col--;
  }

  return Either.right(col);
}
