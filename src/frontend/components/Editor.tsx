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

  // Check if we're in test mode with FIFO input
  const testInputFifo = process.env.TMAX_TEST_INPUT_FIFO;

  // Use a ref to always have access to the current state
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Initialize the editor when component mounts
  useEffect(() => {
    const initEditor = async () => {
      // Debug logging - write to file for reliable capture in tests
      const debugMode = process.env.TMAX_TEST_MODE === 'true' || process.env.TMAX_DEBUG === 'true';
      if (debugMode) {
        const fs = await import('fs');
        const debugLog = `[EDITOR] Component mounting, stdin.isTTY: ${process.stdin.isTTY}, TMAX_TEST_MODE: ${process.env.TMAX_TEST_MODE}\n`;
        fs.appendFileSync('/tmp/tmax-debug.log', debugLog);
      }

      try {
        await editor.start();
        // Sync initial state from Editor class
        setState(editor.getEditorState());

        if (debugMode) {
          const fs = await import('fs');
          const debugLog = `[EDITOR] Editor initialized, mode: ${editor.getEditorState().mode}\n`;
          fs.appendFileSync('/tmp/tmax-debug.log', debugLog);
        }
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
    // Debug logging to trace input reception - write to file for reliable capture
    const debugMode = process.env.TMAX_TEST_MODE === 'true' || process.env.TMAX_DEBUG === 'true';
    if (debugMode) {
      const fs = await import('fs');
      const inputStr = input === '\x1b' ? '\\x1b (Escape)' :
                       input === '\r' ? '\\r (Return)' :
                       input === '\x7f' ? '\\x7f (Backspace)' :
                       `"${input}"`;
      const keyInfo = Object.keys(key).filter(k => key[k] === true).join(', ') || 'none';
      const debugLog = `[INPUT] Received key: ${inputStr}, flags: ${keyInfo}, mode: ${stateRef.current.mode}\n`;
      fs.appendFileSync('/tmp/tmax-debug.log', debugLog);
    }

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

      // All other keys - pass through to T-Lisp
      // T-Lisp key bindings will determine what happens
      if (input) {
        await executeTlisp(input);
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

  // Test mode: Read input from file if configured (for automated testing)
  useEffect(() => {
    if (!testInputFifo) return;

    const fs = require('fs');
    const debugLog = (msg: string) => {
      if (process.env.TMAX_TEST_MODE === 'true') {
        fs.appendFileSync('/tmp/tmax-debug.log', msg + '\n');
      }
    };

    debugLog(`[TEST INPUT] Starting to poll file: ${testInputFifo}`);

    // Track last read position to only read new content
    let lastPosition = 0;
    let running = true;

    // Initialize the input file
    if (!fs.existsSync(testInputFifo)) {
      try {
        fs.writeFileSync(testInputFifo, '');
        lastPosition = 0;
        debugLog(`[TEST INPUT] Created input file at ${testInputFifo}`);
      } catch (err) {
        debugLog(`[TEST INPUT] Failed to create input file: ${err}`);
        return;
      }
    }

    // Poll file for new input
    const pollFile = async () => {
      while (running) {
        try {
          const stats = fs.statSync(testInputFifo);
          if (stats.size > lastPosition) {
            // Read new content
            const buffer = Buffer.alloc(stats.size - lastPosition);
            const fd = fs.openSync(testInputFifo, 'r');
            fs.readSync(fd, buffer, 0, buffer.length, lastPosition);
            fs.closeSync(fd);

            const input = buffer.toString('utf8');
            debugLog(`[TEST INPUT] Read ${input.length} bytes: "${input}"`);

            // Process each character
            for (const char of input) {
              try {
                await executeTlisp(char);
              } catch (error) {
                if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
                  exit();
                  return;
                }
              }
            }

            lastPosition = stats.size;
          }

          // Poll every 100ms
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          if (running) {
            debugLog(`[TEST INPUT] Poll error: ${err}`);
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    };

    pollFile();

    return () => {
      running = false;
      debugLog('[TEST INPUT] Stopped polling input file');
    };
  }, [testInputFifo, executeTlisp, exit]);

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
