import type { EditorState } from "../../core/types.ts";

const EMPTY_MAP: ReadonlyMap<number, number> = new Map();

function getRanges(state: Pick<EditorState, "foldRanges">): Map<number, number> {
  return state.foldRanges ?? EMPTY_MAP as Map<number, number>;
}

export function foldToggle(
  state: Pick<EditorState, "foldRanges">,
  line: number,
  headingRanges: { start: number; end: number }[],
): Partial<EditorState> {
  const ranges = new Map(state.foldRanges ?? EMPTY_MAP);
  if (ranges.has(line)) {
    ranges.delete(line);
  } else {
    const range = headingRanges.find((r) => r.start === line);
    if (range) ranges.set(range.start, range.end);
  }
  return { foldRanges: ranges };
}

export function foldOpen(
  state: Pick<EditorState, "foldRanges">,
  line: number,
): Partial<EditorState> {
  const ranges = new Map(state.foldRanges ?? EMPTY_MAP);
  ranges.delete(line);
  return { foldRanges: ranges };
}

export function foldClose(
  state: Pick<EditorState, "foldRanges">,
  startLine: number,
  endLine: number,
): Partial<EditorState> {
  const ranges = new Map(state.foldRanges ?? EMPTY_MAP);
  ranges.set(startLine, endLine);
  return { foldRanges: ranges };
}

export function foldCloseAll(
  state: Pick<EditorState, "foldRanges">,
  headingRanges: { start: number; end: number }[],
): Partial<EditorState> {
  const ranges = new Map();
  for (const { start, end } of headingRanges) {
    ranges.set(start, end);
  }
  return { foldRanges: ranges };
}

export function foldOpenAll(
  state: Pick<EditorState, "foldRanges">,
): Partial<EditorState> {
  return { foldRanges: new Map() };
}

export function foldByLevel(
  state: Pick<EditorState, "foldRanges">,
  maxLevel: number,
  headingRanges: { start: number; end: number; level: number }[],
): Partial<EditorState> {
  const ranges = new Map();
  for (const { start, end, level } of headingRanges) {
    if (level > maxLevel) ranges.set(start, end);
  }
  return { foldRanges: ranges };
}

export function foldIsCollapsed(state: Pick<EditorState, "foldRanges">, line: number): boolean {
  return (state.foldRanges ?? EMPTY_MAP).has(line);
}

export function foldGetRanges(state: Pick<EditorState, "foldRanges">): { start: number; end: number }[] {
  const result: { start: number; end: number }[] = [];
  const ranges = state.foldRanges ?? EMPTY_MAP;
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
