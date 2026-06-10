import type { Tab } from "../../core/types.ts";

function charWidth(ch: string): number {
  return ch.charCodeAt(0) > 127 ? 2 : 1;
}

function stringWidth(str: string): number {
  let w = 0;
  for (const ch of str) w += charWidth(ch);
  return w;
}

function sliceToVisualWidth(text: string, maxCols: number): string {
  let cols = 0;
  let i = 0;
  for (const ch of text) {
    const cw = charWidth(ch);
    if (cols + cw > maxCols) break;
    cols += cw;
    i += ch.length;
  }
  return text.slice(0, i);
}

/** Render a terminal tab bar with the active tab highlighted. */
export function renderTabBarAnsi(
  tabs: Tab[],
  currentTabIndex: number,
  width: number,
): string {
  if (tabs.length <= 1) return "";

  const segments: string[] = [];
  let usedWidth = 0;

  for (let i = 0; i < tabs.length; i++) {
    const label = tabs[i]!.label;
    const maxLabelWidth = 16;
    const labelVisWidth = stringWidth(label);
    const truncated = labelVisWidth > maxLabelWidth
      ? sliceToVisualWidth(label, maxLabelWidth - 1) + "\u2026"
      : label;
    const display = ` ${truncated} `;
    const segmentWidth = stringWidth(display);

    if (usedWidth + segmentWidth > width) break;

    segments.push(i === currentTabIndex
      ? `\x1b[7m${display}\x1b[0m`
      : `\x1b[2m${display}\x1b[0m`
    );
    usedWidth += segmentWidth;
  }

  return segments.join("") + " ".repeat(Math.max(0, width - usedWidth));
}
