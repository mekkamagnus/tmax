/**
 * @file CommandInput.tsx
 * @description Command input component for tmax editor
 * Handles command mode and M-x mode input
 */

import { Box, Text } from "https://deno.land/x/ink@v3.0.0/mod.ts";
import { useState, useEffect } from "https://deno.land/x/ink@v3.0.0/vendor/react/index.ts";

interface CommandInputProps {
  mode: 'command' | 'mx';
  onExecute: (command: string) => void;
  onCancel: () => void;
}

export const CommandInput = ({
  mode,
  onExecute,
  onCancel
}: CommandInputProps) => {
  const [inputValue, setInputValue] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);

  // Set initial prompt based on mode
  useEffect(() => {
    if (mode === 'command') {
      setInputValue(':');
      setCursorPosition(1);
    } else if (mode === 'mx') {
      setInputValue('M-x ');
      setCursorPosition(4);
    }
  }, [mode]);

  // Get prompt based on mode
  const getPrompt = () => {
    if (mode === 'command') {
      return ':';
    } else if (mode === 'mx') {
      return 'M-x ';
    }
    return '';
  };

  // Simulate command input handling through external state management
  // In a real implementation, this would be connected to keyboard events
  const commandDisplay = inputValue || getPrompt();

  return (
    <Box backgroundColor="black" paddingX={1}>
      <Text color="white">{commandDisplay}</Text>
      {/* Cursor simulation */}
      <Text color="white"> </Text>
    </Box>
  );
};