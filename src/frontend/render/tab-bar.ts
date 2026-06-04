import type { Tab } from "../../core/types.ts";

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
    const truncated = label.length > maxLabelWidth
      ? label.slice(0, maxLabelWidth - 1) + "\u2026"
      : label;
    const display = ` ${truncated} `;
    const segmentWidth = display.length;

    if (usedWidth + segmentWidth > width) break;

    segments.push(i === currentTabIndex
      ? `\x1b[7m${display}\x1b[0m`
      : `\x1b[2m${display}\x1b[0m`
    );
    usedWidth += segmentWidth;
  }

  return segments.join("") + " ".repeat(Math.max(0, width - usedWidth));
}
