/**
 * @file fold-ops.ts
 * @description Code-folding primitives. CHORE-39 Phase 4: adopted the State
 * monad against EditorModel. The pure helpers below remain the implementation
 * (they operate on a `Pick<EditorModel, "foldRanges">` snapshot and return an
 * immutable patch); the `*State` exports lift those patches into genuine
 * `State<EditorModel, void>` computations callers can run via `runModel`.
 */

import { State } from "../../utils/state.ts";
import type { EditorModel } from "../functional/model.ts";

const EMPTY_MAP: ReadonlyMap<number, number> = new Map();

function getRanges(model: Pick<EditorModel, "foldRanges">): ReadonlyMap<number, number> {
  return model.foldRanges ?? EMPTY_MAP;
}

export function foldToggle(
  model: Pick<EditorModel, "foldRanges">,
  line: number,
  headingRanges: { start: number; end: number }[],
): Partial<EditorModel> {
  const ranges = new Map(model.foldRanges ?? EMPTY_MAP);
  if (ranges.has(line)) {
    ranges.delete(line);
  } else {
    const range = headingRanges.find((r) => r.start === line);
    if (range) ranges.set(range.start, range.end);
  }
  return { foldRanges: ranges };
}

export function foldOpen(
  model: Pick<EditorModel, "foldRanges">,
  line: number,
): Partial<EditorModel> {
  const ranges = new Map(model.foldRanges ?? EMPTY_MAP);
  ranges.delete(line);
  return { foldRanges: ranges };
}

export function foldClose(
  model: Pick<EditorModel, "foldRanges">,
  startLine: number,
  endLine: number,
): Partial<EditorModel> {
  const ranges = new Map(model.foldRanges ?? EMPTY_MAP);
  ranges.set(startLine, endLine);
  return { foldRanges: ranges };
}

export function foldCloseAll(
  model: Pick<EditorModel, "foldRanges">,
  headingRanges: { start: number; end: number }[],
): Partial<EditorModel> {
  const ranges = new Map();
  for (const { start, end } of headingRanges) {
    ranges.set(start, end);
  }
  return { foldRanges: ranges };
}

export function foldOpenAll(
  _model: Pick<EditorModel, "foldRanges">,
): Partial<EditorModel> {
  return { foldRanges: new Map() };
}

export function foldByLevel(
  model: Pick<EditorModel, "foldRanges">,
  maxLevel: number,
  headingRanges: { start: number; end: number; level: number }[],
): Partial<EditorModel> {
  const ranges = new Map();
  for (const { start, end, level } of headingRanges) {
    if (level > maxLevel) ranges.set(start, end);
  }
  return { foldRanges: ranges };
}

export function foldIsCollapsed(model: Pick<EditorModel, "foldRanges">, line: number): boolean {
  return (model.foldRanges ?? EMPTY_MAP).has(line);
}

export function foldGetRanges(model: Pick<EditorModel, "foldRanges">): { start: number; end: number }[] {
  const result: { start: number; end: number }[] = [];
  const ranges = model.foldRanges ?? EMPTY_MAP;
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

/**
 * CHORE-39 Phase 4: `State<EditorModel, void>` fold primitives. Each runs the
 * pure helper against the model snapshot and commits the resulting fold-range
 * map immutably. Callers run them via `runModel(access, …)`.
 */
export const foldToggleState = (
  line: number,
  headingRanges: { start: number; end: number }[],
): State<EditorModel, void> =>
  State.modify((m: EditorModel) => ({ ...m, foldRanges: foldToggle(m, line, headingRanges).foldRanges ?? new Map() } as EditorModel));

export const foldOpenState = (line: number): State<EditorModel, void> =>
  State.modify((m: EditorModel) => ({ ...m, foldRanges: foldOpen(m, line).foldRanges ?? new Map() } as EditorModel));

export const foldCloseState = (startLine: number, endLine: number): State<EditorModel, void> =>
  State.modify((m: EditorModel) => ({ ...m, foldRanges: foldClose(m, startLine, endLine).foldRanges ?? new Map() } as EditorModel));

export const foldCloseAllState = (
  headingRanges: { start: number; end: number }[],
): State<EditorModel, void> =>
  State.modify((m: EditorModel) => ({ ...m, foldRanges: foldCloseAll(m, headingRanges).foldRanges ?? new Map() } as EditorModel));

export const foldOpenAllState = (): State<EditorModel, void> =>
  State.modify((m: EditorModel) => ({ ...m, foldRanges: new Map() } as EditorModel));

export const foldByLevelState = (
  maxLevel: number,
  headingRanges: { start: number; end: number; level: number }[],
): State<EditorModel, void> =>
  State.modify((m: EditorModel) => ({ ...m, foldRanges: foldByLevel(m, maxLevel, headingRanges).foldRanges ?? new Map() } as EditorModel));
