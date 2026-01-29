/**
 * @file BufferView.tsx
 * @description Buffer display component with viewport management for tmax
 * Handles long lines, empty buffers, and Unicode characters gracefully
 */

import { Box, Text } from "ink";
import { useState, useEffect, useCallback } from "react";
import { FunctionalTextBuffer } from "../../core/types.ts";
import { Position } from "../../core/types.ts";
import { FunctionalTextBufferImpl } from "../../core/buffer.ts";
import { Either } from "../../utils/task-either.ts";

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

  // Get buffer content and line count with error handling
  const lineCountResult = buffer.getLineCount();
  const totalLines = Either.isRight(lineCountResult) ? lineCountResult.right : 0;

  // Calculate viewport dimensions
  const visibleLines = Math.max(1, terminalHeight - 2); // Leave space for status/command line

  // Adjust viewport if cursor goes out of view
  useEffect(() => {
    let newViewportTop = viewportTop;

    // If cursor is above viewport, scroll up
    if (cursorPosition.line < viewportTop) {
      newViewportTop = Math.max(0, cursorPosition.line);
    }
    // If cursor is below viewport, scroll down
    else if (cursorPosition.line >= viewportTop + visibleLines) {
      newViewportTop = Math.max(0, cursorPosition.line - visibleLines + 1);
    }

    if (newViewportTop !== viewportTop) {
      onViewportChange(newViewportTop);
    }
  }, [cursorPosition, viewportTop, visibleLines, onViewportChange]);

  // Safely get line content with error handling
  const getSafeLineContent = useCallback((lineNumber: number): string => {
    try {
      const lineResult = buffer.getLine(lineNumber);
      if (Either.isRight(lineResult)) {
        return lineResult.right;
      } else {
        // Return empty string for error case, but log it
        console.warn(`Error getting line ${lineNumber}:`, lineResult.left);
        return '';
      }
    } catch (error) {
      console.warn(`Exception getting line ${lineNumber}:`, error);
      return '';
    }
  }, [buffer]);

  // Render visible lines with proper error handling
  const renderLines = () => {
    const lines = [];

    for (let i = 0; i < visibleLines; i++) {
      const lineNumber = viewportTop + i;

      if (lineNumber >= totalLines) {
        // Render empty line if beyond buffer
        lines.push(
          <Box key={`empty-${i}`} width="100%">
            <Text>{'~'}</Text>
          </Box>
        );
      } else {
        // Get line content with error handling
        const lineContent = getSafeLineContent(lineNumber);

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