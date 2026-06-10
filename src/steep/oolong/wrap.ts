import { stripAnsi } from "../matcha.ts";

export function wrapAnsi(text: string, width: number, indent: number = 0): string[] {
  if (width <= 0) return [text];

  const maxWidth = width - indent;
  const indentStr = " ".repeat(indent);

  const words = splitWords(text);
  const lines: string[] = [];
  let currentLine = "";
  let currentLineWidth = 0;

  for (const word of words) {
    const wordWidth = visualWidth(word);

    if (currentLineWidth === 0) {
      currentLine = word;
      currentLineWidth = wordWidth;
    } else if (currentLineWidth + 1 + wordWidth <= maxWidth) {
      currentLine += " " + word;
      currentLineWidth += 1 + wordWidth;
    } else {
      lines.push(indentStr + currentLine);
      currentLine = word;
      currentLineWidth = wordWidth;
    }
  }

  if (currentLineWidth > 0) {
    lines.push(indentStr + currentLine);
  }

  return lines.length > 0 ? lines : [indentStr];
}

function splitWords(text: string): string[] {
  const words: string[] = [];
  let current = "";
  let inEscape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === "\x1b") {
      inEscape = true;
      current += ch;
      continue;
    }

    if (inEscape) {
      current += ch;
      if (ch === "m") inEscape = false;
      continue;
    }

    if (ch === " " || ch === "\t") {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) words.push(current);
  return words;
}

function visualWidth(text: string): number {
  return stripAnsi(text).length;
}
