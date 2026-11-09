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

export function stringWidth(str: string): number {
  return Bun.stringWidth(str);
}

export function charWidth(ch: string): number {
  return Bun.stringWidth(ch);
}

export function sliceToVisualWidth(text: string, maxCols: number): string {
  let end = maxCols;
  let slice = Bun.sliceAnsi(text, 0, end);
  while (stringWidth(slice) > maxCols && end > 0) {
    end -= 1;
    slice = Bun.sliceAnsi(text, 0, end);
  }
  return slice;
}

export function sliceFromVisualOffset(text: string, offset: number): string {
  return Bun.sliceAnsi(text, offset, Infinity);
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
