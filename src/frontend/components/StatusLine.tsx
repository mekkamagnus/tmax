/**
 * @file StatusLine.tsx
 * @description Status line display component for tmax editor
 * Shows mode, cursor position, and status messages
 */

import { Box, Text } from "https://deno.land/x/ink@v3.0.0/mod.ts";
import { Position } from "../../core/types.ts";

interface StatusLineProps {
  mode: 'normal' | 'insert' | 'visual' | 'command' | 'mx';
  cursorPosition: Position;
  statusMessage: string;
}

export const StatusLine = ({ 
  mode, 
  cursorPosition, 
  statusMessage 
}: StatusLineProps) => {
  // Determine display mode text and color
  const getModeDisplay = () => {
    const modeInfo = {
      normal: { text: 'NORMAL', color: 'green' },
      insert: { text: 'INSERT', color: 'yellow' },
      visual: { text: 'VISUAL', color: 'magenta' },
      command: { text: 'COMMAND', color: 'cyan' },
      mx: { text: 'M-X', color: 'blue' }
    };
    
    return modeInfo[mode];
  };
  
  const modeDisplay = getModeDisplay();

  return (
    <Box 
      backgroundColor="blue" 
      width="100%" 
      paddingX={1} 
      justifyContent="space-between"
    >
      {/* Left side: Mode and cursor position */}
      <Box>
        <Text color={modeDisplay.color} bold={true}>
          {modeDisplay.text}
        </Text>
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