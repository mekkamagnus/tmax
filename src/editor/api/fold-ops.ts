import type { EditorState } from "../../core/types.ts";

export function foldToggle(
  state: EditorState,
  line: number,
  headingRanges: { start: number; end: number }[],
): Partial<EditorState> {
  const ranges = new Map(state.foldRanges ?? new Map());
  if (ranges.has(line)) {
    ranges.delete(line);
  } else {
    const range = headingRanges.find((r) => r.start === line);
    if (range) ranges.set(range.start, range.end);
  }
  return { foldRanges: ranges };
}

export function foldOpen(
  state: EditorState,
  line: number,
): Partial<EditorState> {
  const ranges = new Map(state.foldRanges ?? new Map());
  ranges.delete(line);
  return { foldRanges: ranges };
}

export function foldClose(
  state: EditorState,
  startLine: number,
  endLine: number,
): Partial<EditorState> {
  const ranges = new Map(state.foldRanges ?? new Map());
  ranges.set(startLine, endLine);
  return { foldRanges: ranges };
}

export function foldCloseAll(
  state: EditorState,
  headingRanges: { start: number; end: number }[],
): Partial<EditorState> {
  const ranges = new Map();
  for (const { start, end } of headingRanges) {
    ranges.set(start, end);
  }
  return { foldRanges: ranges };
}

export function foldOpenAll(
  state: EditorState,
): Partial<EditorState> {
  return { foldRanges: new Map() };
}

export function foldByLevel(
  state: EditorState,
  maxLevel: number,
  headingRanges: { start: number; end: number; level: number }[],
): Partial<EditorState> {
  const ranges = new Map();
  for (const { start, end, level } of headingRanges) {
    if (level > maxLevel) ranges.set(start, end);
  }
  return { foldRanges: ranges };
}

export function foldIsCollapsed(state: EditorState, line: number): boolean {
  return (state.foldRanges ?? new Map()).has(line);
}

export function foldGetRanges(state: EditorState): { start: number; end: number }[] {
  const result: { start: number; end: number }[] = [];
  const ranges = state.foldRanges ?? new Map();
  for (const [start, end] of ranges) {
    result.push({ start, end });
  }
  return result;
}

export function findHeadingRanges(
  getLine: (line: number) => string,
  totalLines: number,
): { start: number; end: number; level: number }[] {
  const headings: { line: number; level: number }[] = [];
  for (let i = 0; i < totalLines; i++) {
    const text = getLine(i);
    const match = text?.match(/^(#{1,6})\s/);
    if (match) {
      headings.push({ line: i, level: match[1]!.length });
    }
  }

  return headings.map((h, i) => {
    const nextHeading = headings[i + 1];
    const end = nextHeading ? nextHeading.line - 1 : totalLines - 1;
    return { start: h.line, end, level: h.level };
  });
}
