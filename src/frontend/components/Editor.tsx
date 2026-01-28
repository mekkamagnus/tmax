/**
 * @file Editor.tsx
 * @description Main React Editor component for tmax with Deno-ink
 * Handles file I/O errors during rendering and provides error feedback to users
 */

/** @jsxRuntime automatic */
/** @jsxImportSource react */

import { Box, Text, Static, useApp, useInput, useStdout } from "https://deno.land/x/ink@1.3/mod.ts";
import { useState, useEffect, useCallback } from "https://deno.land/x/ink@1.3/vendor/react/index.ts";
import { EditorState } from "../../core/types.ts";
import { FunctionalTextBufferImpl } from "../../core/buffer.ts";
import { Either } from "../../utils/task-either.ts";
import { BufferView } from "./BufferView.tsx";
import { StatusLine } from "./StatusLine.tsx";
import { CommandInput } from "./CommandInput.tsx";
import { useEditorState } from "../hooks/useEditorState.ts";

interface EditorProps {
  initialEditorState: EditorState;
  onError?: (error: Error) => void;
}

export const Editor = ({ initialEditorState, onError }: EditorProps) => {
  const { state, setState, dispatch } = useEditorState(initialEditorState);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { stdout } = useStdout();
  const { exit } = useApp();

  // Handle file I/O errors gracefully
  const handleError = useCallback((errorMessage: string) => {
    setError(errorMessage);
    setState(prev => ({
      ...prev,
      statusMessage: `ERROR: ${errorMessage}`
    }));

    // Clear error after 5 seconds
    setTimeout(() => {
      setError(null);
      setState(prev => ({
        ...prev,
        statusMessage: ""
      }));
    }, 5000);

    // Call external error handler if provided
    if (onError) {
      onError(new Error(errorMessage));
    }
  }, [setState, onError]);

  // Handle terminal resize events
  useEffect(() => {
    if (!stdout) return;

    const handleResize = () => {
      // Dispatch resize action to update viewport and status
      dispatch({
        type: 'HANDLE_RESIZE',
        width: stdout.columns,
        height: stdout.rows
      });

      // Clear status message after a delay
      setTimeout(() => {
        setState(prev => ({
          ...prev,
          statusMessage: ''
        }));
      }, 2000);
    };

    // Listen for resize events
    if (stdout.addListener) {
      stdout.addListener('resize', handleResize);
    }

    // Cleanup listener on unmount
    return () => {
      if (stdout.removeListener) {
        stdout.removeListener('resize', handleResize);
      }
    };
  }, [stdout, setState, dispatch]);

  // Handle key input
  useInput((input: string, key: any) => {
    if (state.mode === 'command' || state.mode === 'mx') {
      // Command input is handled by CommandInput component
      return;
    }

    if (key.escape) {
      // Exit command/M-x mode if active
      if (state.mode === 'command' || state.mode === 'mx') {
        setState(prev => ({
          ...prev,
          mode: 'normal',
          statusMessage: 'Exited command mode'
        }));
        return;
      }
      // In normal mode, escape might trigger other behaviors
      setState(prev => ({
        ...prev,
        statusMessage: 'Press : for command mode, M-x for extended commands'
      }));
      return;
    }

    if (input === ':') {
      setState(prev => ({
        ...prev,
        mode: 'command'
      }));
      return;
    }

    if (key.tab && key.ctrl) {
      // Ctrl+X combination for extended commands
      setState(prev => ({
        ...prev,
        mode: 'mx'
      }));
      return;
    }

    // Handle other keys based on current mode
    switch (state.mode) {
      case 'normal':
        handleNormalMode(input, key);
        break;
      case 'insert':
        handleInsertMode(input, key);
        break;
      case 'visual':
        handleVisualMode(input, key);
        break;
      default:
        setState(prev => ({
          ...prev,
          statusMessage: `Unknown mode: ${state.mode}`
        }));
    }
  });

  const handleNormalMode = (input: string, key: any) => {
    // Simple movement commands for demo
    setState(prev => {
      const newState = { ...prev };
      const buffer = prev.currentBuffer || FunctionalTextBufferImpl.create("");
      const lineCountResult = buffer.getLineCount();

      if (Either.isLeft(lineCountResult)) {
        handleError(`Buffer error: ${lineCountResult.left}`);
        return prev;
      }

      const lineCount = lineCountResult.right;
      const maxLine = Math.max(0, lineCount - 1);

      switch (input.toLowerCase()) {
        case 'h':
          if (newState.cursorPosition.column > 0) {
            newState.cursorPosition = {
              ...newState.cursorPosition,
              column: newState.cursorPosition.column - 1
            };
          }
          break;
        case 'j':
          if (newState.cursorPosition.line < maxLine) {
            newState.cursorPosition = {
              ...newState.cursorPosition,
              line: newState.cursorPosition.line + 1
            };
          }
          break;
        case 'k':
          if (newState.cursorPosition.line > 0) {
            newState.cursorPosition = {
              ...newState.cursorPosition,
              line: newState.cursorPosition.line - 1
            };
          }
          break;
        case 'l':
          const currentLineResult = buffer.getLine(newState.cursorPosition.line);
          if (Either.isRight(currentLineResult)) {
            const currentLine: string = currentLineResult.right;
            if (newState.cursorPosition.column < currentLine.length) {
              newState.cursorPosition = {
                ...newState.cursorPosition,
                column: newState.cursorPosition.column + 1
              };
            }
          }
          break;
        case 'i':
          newState.mode = 'insert';
          newState.statusMessage = 'INSERT mode';
          break;
        case 'v':
          newState.mode = 'visual';
          newState.statusMessage = 'VISUAL mode';
          break;
      }

      return newState;
    });
  };

  const handleInsertMode = (input: string, key: any) => {
    if (key.return) {
      // Insert newline
      setState(prev => {
        const buffer = prev.currentBuffer || FunctionalTextBufferImpl.create("");
        const newPosition = {
          line: prev.cursorPosition.line + 1,
          column: 0
        };

        // Insert newline at current position
        const insertResult = buffer.insert(prev.cursorPosition, '\n');
        if (Either.isLeft(insertResult)) {
          handleError(`Insert error: ${insertResult.left}`);
          return prev;
        }

        return {
          ...prev,
          currentBuffer: insertResult.right,
          cursorPosition: newPosition
        };
      });
    } else if (key.backspace) {
      // Handle backspace
      setState(prev => {
        if (prev.cursorPosition.column === 0 && prev.cursorPosition.line === 0) {
          // At the very beginning, nothing to delete
          return prev;
        }

        const buffer = prev.currentBuffer || FunctionalTextBufferImpl.create("");
        let targetPosition = { ...prev.cursorPosition };

        if (prev.cursorPosition.column === 0) {
          // At beginning of line, need to join with previous line
          targetPosition = {
            line: prev.cursorPosition.line - 1,
            column: 0
          };

          // Get previous line length to position cursor correctly
          const prevLineResult = buffer.getLine(targetPosition.line);
          if (Either.isRight(prevLineResult)) {
            targetPosition.column = (prevLineResult.right as string).length;
          }
        } else {
          // Just move back one column
          targetPosition.column -= 1;
        }

        // Delete character at target position
        const range = {
          start: targetPosition,
          end: prev.cursorPosition
        };

        const deleteResult = buffer.delete(range);
        if (Either.isLeft(deleteResult)) {
          handleError(`Delete error: ${deleteResult.left}`);
          return prev;
        }

        return {
          ...prev,
          currentBuffer: deleteResult.right,
          cursorPosition: targetPosition
        };
      });
    } else if (input.length === 1) {
      // Regular character input
      setState(prev => {
        const buffer = prev.currentBuffer || FunctionalTextBufferImpl.create("");

        const insertResult = buffer.insert(prev.cursorPosition, input);
        if (Either.isLeft(insertResult)) {
          handleError(`Insert error: ${insertResult.left}`);
          return prev;
        }

        const newPosition = {
          line: prev.cursorPosition.line,
          column: prev.cursorPosition.column + 1
        };

        return {
          ...prev,
          currentBuffer: insertResult.right,
          cursorPosition: newPosition
        };
      });
    } else if (key.escape) {
      setState(prev => ({
        ...prev,
        mode: 'normal',
        statusMessage: 'NORMAL mode'
      }));
    }
  };

  const handleVisualMode = (input: string, key: any) => {
    // For now, just return to normal mode on escape
    if (key.escape) {
      setState(prev => ({
        ...prev,
        mode: 'normal',
        statusMessage: 'NORMAL mode'
      }));
    }
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Error display */}
      {error && (
        <Box backgroundColor="red" paddingX={1} marginY={0.5}>
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
          onViewportChange={(top) => setState(prev => ({ ...prev, viewportTop: top }))}
        />
      </Box>

      {/* Command Input (when in command mode) */}
      {(state.mode === 'command' || state.mode === 'mx') && (
        <Box>
          <CommandInput
            mode={state.mode}
            onExecute={(command) => {
              // For now, just show the command in status
              setState(prev => ({
                ...prev,
                statusMessage: `Executed: ${command}`,
                mode: 'normal'
              }));
            }}
            onCancel={() => setState(prev => ({ ...prev, mode: 'normal' }))}
          />
        </Box>
      )}

      {/* Status Line */}
      <Static items={[{}]}>
        <StatusLine
          mode={state.mode}
          cursorPosition={state.cursorPosition}
          statusMessage={state.statusMessage}
        />
      </Static>
    </Box>
  );
};