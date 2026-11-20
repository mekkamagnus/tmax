// width.ts — the render layer's ONE width model (#242, SPEC-242).
// Extracted from the private copies in buffer-lines.ts / tab-bar.ts so the
// wide-char parity test can gate PRODUCTION code (the old test re-implemented
// these helpers locally and gated nothing), backed by Bun 1.4's
// grapheme/ANSI-aware built-ins:
//   - stringWidth: CJK 2, emoji 2, ZWJ sequences ONE grapheme (2), combining
//     marks add 0, narrow non-ASCII 1, ANSI escapes 0 (the default — the
//     render paths measure display text or pre-styled lines, never escapes).
//   - sliceAnsi: slices by CELL COLUMNS but rounds INTO a wide grapheme at odd
//     boundaries (sliceAnsi("中a", 0, 1) is "中", width 2) — sliceToVisualWidth
//     guards that so it never returns more columns than asked for.
// Known limitation (unchanged by #242): tabs count 0 (the old model said 1);
// neither model expands real tab stops. See SPEC-242 "Out of scope".

// Bun 1.4 built-ins; feature-detected fallbacks for older runtimes
// (codex r40 ran 1.3.9 where Bun.sliceAnsi is absent — renders THREW). The
// fallback skips ANSI CSI sequences and counts East-Asian-wide code points
// as 2 cells; wide-GRAPHHEME grouping (ZWJ etc.) degrades to per-code-point
// — the wide-char parity suite gates the 1.4 path where it runs.
const bunSlice = (Bun as unknown as { sliceAnsi?: (t: string, s: number, e: number) => string }).sliceAnsi;
const bunWidth = (Bun as unknown as { stringWidth?: (s: string) => number }).stringWidth;

const WIDE_RE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

function cellWidth(str: string): number {
  let w = 0;
  let inEsc = false;
  for (const ch of str) {
    if (ch === "\u001b") { inEsc = true; continue; }
    if (inEsc) { if (ch === "m") inEsc = false; continue; }
    w += WIDE_RE.test(ch) ? 2 : 1;
  }
  return w;
}

function cellsOf(str: string): string[] {
  const cells: string[] = [];
  let inEsc = false;
  let esc = "";
  for (const ch of str) {
    if (ch === "\u001b" || inEsc) {
      esc += ch;
      inEsc = ch !== "m" && (ch !== "\u001b" || esc.length > 1);
      if (ch === "m") { cells.push(esc); esc = ""; inEsc = false; }
      continue;
    }
    cells.push(ch);
  }
  return cells;
}

function sliceCells(text: string, start: number, end: number): string {
  const cells = cellsOf(text);
  let w = 0;
  let out = "";
  for (const c of cells) {
    const cw = cellWidth(c);
    if (w >= start && w < end) out += c;
    w += cw > 0 ? cw : 0;
    if (w >= end) break;
  }
  return out;
}

export function stringWidth(str: string): number {
  if (bunWidth) return bunWidth(str);
  return cellWidth(str);
}

export function charWidth(ch: string): number {
  return stringWidth(ch);
}

export function sliceToVisualWidth(text: string, maxCols: number): string {
  if (bunSlice) {
    let end = maxCols;
    let slice = bunSlice(text, 0, end);
    while (stringWidth(slice) > maxCols && end > 0) {
      end -= 1;
      slice = bunSlice(text, 0, end);
    }
    return slice;
  }
  return sliceCells(text, 0, maxCols);
}

export function sliceFromVisualOffset(text: string, offset: number): string {
  if (bunSlice) return bunSlice(text, offset, Infinity);
  return sliceCells(text, offset, Number.MAX_SAFE_INTEGER);
}

export function fitToWidth(text: string, width: number): string {
  if (width <= 0) return "";
  const sw = stringWidth(text);
  if (sw <= width) return text + " ".repeat(width - sw);
  if (width <= 3) return sliceToVisualWidth(text, width);
  return sliceToVisualWidth(text, width - 3) + "...";
}

export function padAnsiToWidth(text: string, width: number): string {
  const sw = stringWidth(text); // ANSI-blind by default — no strip needed
  if (sw >= width) return text;
  return text + " ".repeat(width - sw);
}
