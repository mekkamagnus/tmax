/**
 * @file Editor.tsx
 * @description Main React Editor component for tmax with Deno-ink
 * This is a DUMB component - ALL business logic is in T-Lisp
 * It only captures input and renders the current state from T-Lisp
 */

import { Box, Text, useApp, useInput } from 'ink';
import { useState, useEffect, useCallback, useRef } from "react";
import { EditorState } from "../../core/types.ts";
import { FunctionalTextBufferImpl } from "../../core/buffer.ts";
import { Either } from "../../utils/task-either.ts";
import { BufferView } from "./BufferView.tsx";
import { StatusLine } from "./StatusLine.tsx";
import { CommandInput } from "./CommandInput.tsx";
import { useEditorState } from "../hooks/useEditorState.ts";
import { useTerminalDimensions } from "../hooks/useTerminalDimensions.ts";
import { splitInputForTlisp } from "../input.ts";
import type { Editor as EditorClass } from "../../editor/editor.ts";

interface EditorProps {
  initialEditorState: EditorState;
  editor: EditorClass;
  filename?: string;
  onStateChange?: (newState: EditorState) => void;
  onError?: (error: Error) => void;
}

export const Editor = ({ initialEditorState, editor, filename, onStateChange, onError }: EditorProps) => {
  const { state, setState, executeTlisp } = useEditorState(initialEditorState, editor);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { exit } = useApp();

  // Get actual terminal dimensions
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions();

  // Use a ref to always have access to the current state
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Initialize the editor when component mounts
  useEffect(() => {
    const initEditor = async () => {
      try {
        await editor.start();
        // Sync initial state from Editor class
        setState(editor.getEditorState());
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        handleError(`Failed to initialize editor: ${errorMessage}`);
      }
    };
    initEditor();
  }, [editor, setState]);

  // Handle file I/O errors gracefully
  const handleError = useCallback((errorMessage: string) => {
    setError(errorMessage);
    setState(prev => {
      const newState = {
        ...prev,
        statusMessage: `ERROR: ${errorMessage}`
      };

      // Notify parent of state change
      if (onStateChange) {
        onStateChange(newState);
      }

      return newState;
    });

    // Clear error after 5 seconds
    setTimeout(() => {
      setError(null);
      setState(prev => {
        const newState = {
          ...prev,
          statusMessage: ""
        };

        if (onStateChange) {
          onStateChange(newState);
        }

        return newState;
      });
    }, 5000);

    // Call external error handler if provided
    if (onError) {
      onError(new Error(errorMessage));
    }
  }, [setState, onStateChange, onError]);

  // Handle key input - ALL keys go through T-Lisp via executeTlisp
  useInput(async (input: string, key: any) => {
    try {
      // Command mode input is handled by CommandInput component
      // IMPORTANT: Use ref to always get current mode, not closure value
      // Check both mode AND cursorFocus to ensure proper input routing
      if ((stateRef.current.mode === 'command' || stateRef.current.mode === 'mx') &&
          stateRef.current.cursorFocus === 'command') {
        return;
      }

      // Escape key - normalize to the escape sequence T-Lisp expects
      if (key.escape) {
        await executeTlisp("\x1b");
        return;
      }

      // Return key - normalize to newline for T-Lisp
      if (key.return) {
        await executeTlisp("\n");
        return;
      }

      // Backspace key - normalize to backspace for T-Lisp
      if (key.backspace || key.delete) {
        await executeTlisp("\x7f");
        return;
      }

      // All other keys - split batched chunks into per-key events
      // T-Lisp key bindings process one key at a time
      if (input) {
        for (const keyInput of splitInputForTlisp(input)) {
          await executeTlisp(keyInput);
        }
      }
    } catch (error) {
      // Handle quit signal
      if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
        exit();
        return;
      }
      // For other errors, show in status
      handleError(error instanceof Error ? error.message : String(error));
    }
  }, [executeTlisp, exit]);

  return (
    <Box flexDirection="column" height={terminalHeight} width={terminalWidth}>
      {/* Error display */}
      {error && (
        <Box paddingX={1} marginY={0.5}>
          <Text color="white">{error}</Text>
        </Box>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <Box paddingX={1} marginY={0.5}>
          <Text color="blue">Loading...</Text>
        </Box>
      )}

      {/* Buffer View */}
      <Box flexGrow={1} flexDirection="column">
        <BufferView
          buffer={state.currentBuffer || FunctionalTextBufferImpl.create("")}
          cursorPosition={state.cursorPosition}
          viewportTop={state.viewportTop}
          onViewportChange={(top) => setState((prev: EditorState) => ({ ...prev, viewportTop: top }))}
          terminalWidth={terminalWidth}
          terminalHeight={terminalHeight}
        />
      </Box>

      {/* Command Input (when in command mode) */}
      {(state.mode === 'command' || state.mode === 'mx') && (
        <Box>
          <CommandInput
            mode={state.mode}
            onExecute={async (command) => {
              // Execute the command directly via the editor
              try {
                if (state.mode === 'command') {
                  // Handle vim-style commands
                  const trimmedCommand = command.trim();
                  if (trimmedCommand === 'q' || trimmedCommand === 'quit') {
                    exit();
                    return;
                  } else if (trimmedCommand === 'w' || trimmedCommand === 'write') {
                    await editor.saveFile();
                    setState(editor.getEditorState());
                  } else if (trimmedCommand === 'wq' || trimmedCommand === 'quit-write') {
                    await editor.saveFile();
                    exit();
                    return;
                  } else if (trimmedCommand.startsWith('w ') || trimmedCommand.startsWith('write ')) {
                    // Handle write with filename: "w file.txt" or "write file.txt"
                    const parts = trimmedCommand.split(' ');
                    const filename = parts.slice(1).join(' ');
                    if (filename) {
                      await editor.saveFile(filename);
                      setState(editor.getEditorState());
                    } else {
                      handleError('No filename specified');
                    }
                  } else {
                    handleError(`Unknown command: ${trimmedCommand}`);
                  }
                } else if (state.mode === 'mx') {
                  // Handle M-x commands
                  await editor.start(); // This will trigger the M-x execution
                }
                // Explicitly set cursor focus back to buffer after command execution
                setState((prev: EditorState) => ({ ...prev, cursorFocus: 'buffer' }));
              } catch (error) {
                handleError(error instanceof Error ? error.message : String(error));
              }
            }}
            onCancel={() => {
              // Cancel also goes through T-Lisp
              executeTlisp("\x1b").catch(err => {
                if (err instanceof Error && err.message !== "EDITOR_QUIT_SIGNAL") {
                  handleError(err.message);
                }
              });
              // Explicitly set cursor focus back to buffer after cancel
              setState((prev: EditorState) => ({ ...prev, cursorFocus: 'buffer' }));
            }}
          />
        </Box>
      )}

      {/* Status Line */}
      <StatusLine
        mode={state.mode}
        cursorPosition={state.cursorPosition}
        statusMessage={state.statusMessage}
      />
    </Box>
  );
};
