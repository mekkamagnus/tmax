import { Box, Text } from "ink";
import type { Tab } from "../../core/types.ts";
import { renderTabBarAnsi } from "../render/tab-bar.ts";

interface TabBarProps {
  tabs: Tab[];
  currentTabIndex: number;
  width: number;
}

export const TabBar = ({ tabs, currentTabIndex, width }: TabBarProps) => {
  if (tabs.length <= 1) return null;

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

  const content = segments.join("");
  const padding = " ".repeat(Math.max(0, width - usedWidth));

  return (
    <Box width={width} height={1}>
      <Text>{content}{padding}</Text>
    </Box>
  );
};

export { renderTabBarAnsi };
