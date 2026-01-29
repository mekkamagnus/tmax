/**
 * @file CommandInput.tsx
 * @description Command input component for tmax editor
 * Handles command mode and M-x mode input with full keyboard interaction
 */

import { Box, Text } from "ink";
import { useState, useEffect, useRef } from "react";
import { useInput } from "ink";

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
  const [error, setError] = useState<string | null>(null);

  // Initialize input value based on mode
  useEffect(() => {
    if (mode === 'command') {
      setInputValue(':');
      setCursorPosition(1);
    } else if (mode === 'mx') {
      setInputValue('M-x ');
      setCursorPosition(4);
    }
    setError(null); // Clear any previous errors when mode changes
  }, [mode]);

  // Handle key input for command input
  useInput((input: string, key: any) => {
    // Handle escape key to cancel
    if (key.escape) {
      onCancel();
      return;
    }

    // Handle enter key to execute command
    if (key.return) {
      // Extract command text (without the prompt)
      let commandText = '';
      if (mode === 'command' && inputValue.startsWith(':')) {
        commandText = inputValue.substring(1); // Remove the ':' prefix
      } else if (mode === 'mx' && inputValue.startsWith('M-x ')) {
        commandText = inputValue.substring(4); // Remove the 'M-x ' prefix
      }

      if (commandText.trim() === '') {
        // Don't execute empty commands, just exit
        onCancel();
      } else {
        // Validate command format if needed
        if (mode === 'command' && commandText.startsWith(':')) {
          setError('Invalid command format');
          return;
        }

        // Execute the command
        onExecute(commandText);
      }
      return;
    }

    // Handle backspace
    if (key.backspace) {
      if (cursorPosition > getPromptLength()) { // Prevent deleting the prompt
        setInputValue((prev: string) => {
          if (prev.length > 0 && cursorPosition > 0) {
            return prev.slice(0, cursorPosition - 1) + prev.slice(cursorPosition);
          }
          return prev;
        });
        setCursorPosition((prev: number) => Math.max(getPromptLength(), prev - 1));
      }
      return;
    }

    // Handle delete key
    if (key.delete) {
      setInputValue((prev: string) => {
        if (cursorPosition < prev.length) {
          return prev.slice(0, cursorPosition) + prev.slice(cursorPosition + 1);
        }
        return prev;
      });
      return;
    }

    // Handle left arrow key
    if (key.leftArrow) {
      setCursorPosition((prev: number) => Math.max(getPromptLength(), prev - 1));
      return;
    }

    // Handle right arrow key
    if (key.rightArrow) {
      setCursorPosition((prev: number) => Math.min(inputValue.length, prev + 1));
      return;
    }

    // Handle home key (go to beginning of command, after prompt)
    if (key.home) {
      setCursorPosition(getPromptLength());
      return;
    }

    // Handle end key (go to end of input)
    if (key.end) {
      setCursorPosition(inputValue.length);
      return;
    }

    // Handle regular character input
    if (input.length === 1) {
      // Only allow input after the prompt
      const promptLength = getPromptLength();

      // Insert character at cursor position
      setInputValue((prev: string) => {
        return prev.slice(0, cursorPosition) + input + prev.slice(cursorPosition);
      });

      setCursorPosition((prev: number) => prev + 1);
    }
  });

  // Helper function to get prompt length
  const getPromptLength = (): number => {
    if (mode === 'command') {
      return 1; // Length of ':'
    } else if (mode === 'mx') {
      return 4; // Length of 'M-x '
    }
    return 0;
  };

  // Get the command text without the prompt
  const getCommandText = (): string => {
    if (mode === 'command' && inputValue.startsWith(':')) {
      return inputValue.substring(1);
    } else if (mode === 'mx' && inputValue.startsWith('M-x ')) {
      return inputValue.substring(4);
    }
    return inputValue;
  };

  return (
    <Box flexDirection="column">
      {/* Error display */}
      {error && (
        <Box paddingX={1} marginY={0.5}>
          <Text color="white">{error}</Text>
        </Box>
      )}

      {/* Input field */}
      <Box paddingX={1}>
        <Text color="white">{inputValue}</Text>
        {/* Visual cursor representation */}
        <Text color="white" backgroundColor="white"> </Text>
      </Box>
    </Box>
  );
};