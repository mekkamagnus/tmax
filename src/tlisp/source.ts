/**
 * @file source.ts
 * @description Source location tracking for T-Lisp diagnostics
 */

export interface SourcePosition {
  line: number;
  column: number;
  offset: number;
}

export interface SourceSpan {
  start: SourcePosition;
  end: SourcePosition;
}

export interface SourceFile {
  name: string;
  content: string;
  lineOffsets: number[];
}

export function createSourceFile(name: string, content: string): SourceFile {
  const lineOffsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") {
      lineOffsets.push(i + 1);
    }
  }
  return { name, content, lineOffsets };
}

export function positionAt(source: SourceFile, offset: number): SourcePosition {
  const lineOffsets = source.lineOffsets;
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineOffsets[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  const line = lo;
  const column = offset - lineOffsets[line]!;
  return { line, column, offset };
}

export function sourceExcerpt(
  source: SourceFile,
  span: SourceSpan,
  contextLines: number = 1
): { before: string; primary: string; after: string; lineNum: number } {
  const lines = source.content.split("\n");
  const lineNum = span.start.line;
  const before = lines.slice(Math.max(0, lineNum - contextLines), lineNum).join("\n");
  const primary = lines[lineNum] ?? "";
  const after = lines.slice(lineNum + 1, lineNum + 1 + contextLines).join("\n");
  return { before, primary, after, lineNum };
}

export function spanToJSON(span: SourceSpan) {
  return {
    start: { line: span.start.line, column: span.start.column, offset: span.start.offset },
    end: { line: span.end.line, column: span.end.column, offset: span.end.offset },
  };
}
