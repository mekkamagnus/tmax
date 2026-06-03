/**
 * @file StatusLine.tsx
 * @description Status line display component for tmax editor
 * Shows mode, cursor position, and status messages
 */

import { Box, Text } from "ink";
import { Position } from "../../../../core/types.ts";
import { modeDisplay } from "../../../render/status-line.ts";

interface StatusLineProps {
  mode: 'normal' | 'insert' | 'visual' | 'command' | 'mx';
  cursorPosition: Position;
  statusMessage: string;
  currentMajorMode?: string;
  activeMinorModeLighters?: string[];
}

export const StatusLine = ({
  mode,
  cursorPosition,
  statusMessage,
  currentMajorMode,
  activeMinorModeLighters = [],
}: StatusLineProps) => {
  const display = modeDisplay[mode];
  const modeSuffix = `${currentMajorMode ? ` [${currentMajorMode}]` : ""}${activeMinorModeLighters.length > 0 ? ` (${activeMinorModeLighters.join(" ")})` : ""}`;

  return (
    <Box
      backgroundColor="blue"
      width="100%"
      paddingX={1}
      justifyContent="space-between"
    >
      {/* Left side: Mode and cursor position */}
      <Box>
        <Text color={display.color} bold={true}>
          {display.text}
        </Text>
        <Text color="cyan">{modeSuffix}</Text>
        <Text color="white"> </Text>
        <Text color="white">{`Line: ${cursorPosition.line + 1}, Col: ${cursorPosition.column + 1}`}</Text>
      </Box>

      {/* Right side: Status message */}
      <Box flexGrow={1} justifyContent="flex-end">
        <Text color="white">{statusMessage}</Text>
      </Box>
    </Box>
  );
};
