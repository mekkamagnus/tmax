/**
 * @file BufferView.tsx
 * @description Buffer display component with viewport management for tmax
 * Handles long lines, empty buffers, and Unicode characters gracefully
 */

import { Box, Text } from "https://deno.land/x/ink@v3.0.0/mod.ts";
import { useState, useEffect } from "https://deno.land/x/ink@v3.0.0/vendor/react/index.ts";
import { FunctionalTextBuffer } from "../../core/types.ts";
import { Position } from "../../core/types.ts";
import { FunctionalTextBufferImpl } from "../../core/buffer.ts";

interface BufferViewProps {
  buffer: FunctionalTextBuffer;
  cursorPosition: Position;
  viewportTop: number;
  onViewportChange: (top: number) => void;
}

export const BufferView = ({ 
  buffer, 
  cursorPosition, 
  viewportTop, 
  onViewportChange 
}: BufferViewProps) => {
  const [terminalWidth, setTerminalWidth] = useState(80);
  const [terminalHeight, setTerminalHeight] = useState(24);

  // Get buffer content and line count
  const lineCountResult = buffer.getLineCount();
  const totalLines = lineCountResult._tag === 'Right' ? lineCountResult.right : 0;
  
  // Calculate viewport dimensions
  const visibleLines = Math.max(1, terminalHeight - 2); // Leave space for status/command line
  
  // Adjust viewport if cursor goes out of view
  useEffect(() => {
    let newViewportTop = viewportTop;
    
    // If cursor is above viewport, scroll up
    if (cursorPosition.line < viewportTop) {
      newViewportTop = cursorPosition.line;
    }
    // If cursor is below viewport, scroll down
    else if (cursorPosition.line >= viewportTop + visibleLines) {
      newViewportTop = cursorPosition.line - visibleLines + 1;
    }
    
    if (newViewportTop !== viewportTop) {
      onViewportChange(newViewportTop);
    }
  }, [cursorPosition, viewportTop, visibleLines, onViewportChange]);

  // Render visible lines
  const renderLines = () => {
    const lines = [];
    
    for (let i = 0; i < visibleLines; i++) {
      const lineNumber = viewportTop + i;
      
      if (lineNumber >= totalLines) {
        // Render empty line if beyond buffer
        lines.push(
          <Box key={`line-${lineNumber}`} width="100%">
            <Text>{'~'}</Text>
          </Box>
        );
      } else {
        // Get line content
        const lineResult = buffer.getLine(lineNumber);
        const lineContent = lineResult._tag === 'Right' ? lineResult.right : '';
        
        // Truncate long lines to terminal width with ellipsis
        let displayContent = lineContent;
        if (displayContent.length > terminalWidth) {
          displayContent = displayContent.substring(0, terminalWidth - 3) + '...';
        }
        
        // Highlight cursor line if needed
        const isCursorLine = lineNumber === cursorPosition.line;
        const lineText = isCursorLine ? (
          <Text backgroundColor="white" color="black">
            {displayContent}
          </Text>
        ) : (
          <Text>{displayContent}</Text>
        );
        
        lines.push(
          <Box key={`line-${lineNumber}`} width="100%">
            {lineText}
          </Box>
        );
      }
    }
    
    return lines;
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      {totalLines === 0 ? (
        // Handle empty buffer case
        <Box width="100%" height="100%" justifyContent="center" alignItems="center">
          <Text color="gray">(empty buffer)</Text>
        </Box>
      ) : (
        // Render buffer content
        <Box flexDirection="column" width="100%" height="100%">
          {renderLines()}
        </Box>
      )}
    </Box>
  );
};