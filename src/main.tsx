#!/usr/bin/env bun
/**
 * @file main-bun.tsx
 * @description Main application entry point for tmax editor using Bun + Ink
 * T-Lisp drives ALL editor logic - React is just a thin UI layer
 */

import { render } from 'ink';
import { Box, Text } from 'ink';
import { Editor } from './frontend/components/Editor.tsx';
import { Editor as EditorClass } from './editor/editor.ts';
import { TerminalIOImpl } from './core/terminal.ts';
import { FileSystemImpl } from './core/filesystem.ts';
import { FunctionalTextBufferImpl } from './core/buffer.ts';
import { EditorState } from './core/types.ts';

/**
 * Switch to alternate screen buffer (full screen mode)
 */
function enterFullScreen() {
  // ANSI escape code to enter alternate screen buffer
  process.stdout.write('\x1b[?1049h');

  // Clear screen and move cursor to top-left
  process.stdout.write('\x1b[2J');
  process.stdout.write('\x1b[H');

  // Hide cursor
  process.stdout.write('\x1b[?25l');
}

/**
 * Exit alternate screen buffer (restore normal screen)
 */
function exitFullScreen() {
  // Show cursor
  process.stdout.write('\x1b[?25h');

  // Exit alternate screen buffer
  process.stdout.write('\x1b[?1049l');
}

/**
 * Cleanup handler to ensure terminal is restored on exit
 */
function setupCleanupHandlers() {
  const cleanup = () => {
    exitFullScreen();
  };

  // Handle various exit signals
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);
}

/**
 * Main entry point that:
 * 1. Parses command line arguments
 * 2. Loads file if specified (or creates new buffer)
 * 3. Creates Editor class (with T-Lisp interpreter)
 * 4. Renders the React-based editor (dumb UI layer)
 *
 * Architecture: T-Lisp (core logic) → Editor class → React UI (dumb view)
 */

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const devMode = args.includes('--dev') || args.includes('--no-tty');
  const fileArgs = args.filter(arg => !arg.startsWith('--'));

  // Show help if requested
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
tmax - Terminal-based text editor (Bun + Ink version with T-Lisp)

Usage: tmax [options] [filename]

Options:
  --dev, --no-tty    Development mode (skip TTY checks for AI coding assistants)
  --help, -h         Show this help message

Examples:
  tmax               # Start editor in normal mode
  tmax file.txt      # Open file.txt
  tmax --dev         # Start in development mode (for AI coding environments)
  tmax --dev file.txt # Open file.txt in development mode
    `);
    process.exit(0);
  }

  let filename: string | undefined;
  let initialState: EditorState;

  // Create the Editor class with T-Lisp interpreter
  // Note: We pass TerminalIOImpl even though React doesn't use it directly
  // The Editor class needs it for the T-Lisp API functions
  const terminal = new TerminalIOImpl(devMode);
  const filesystem = new FileSystemImpl();
  const editor = new EditorClass(terminal, filesystem);

  // Initialize default state
  if (fileArgs.length > 0) {
    filename = fileArgs[0];

    // Try to load the file
    try {
      const content = await filesystem.readFile(filename);
      initialState = {
        currentBuffer: FunctionalTextBufferImpl.create(content),
        cursorPosition: { line: 0, column: 0 },
        mode: 'normal' as const,
        statusMessage: `Loaded ${filename}`,
        viewportTop: 0,
        config: {
          theme: 'default',
          tabSize: 4,
          autoSave: false,
          keyBindings: {},
          maxUndoLevels: 100,
          showLineNumbers: true,
          wordWrap: false
        },
        currentFilename: filename,
        commandLine: "",
        mxCommand: "",
        buffers: editor.getState().buffers,
      };

      // Set the filename in the editor state
      editor.setEditorState(initialState);
    } catch (error) {
      // File doesn't exist or can't be read - create new buffer
      initialState = {
        currentBuffer: FunctionalTextBufferImpl.create(""),
        cursorPosition: { line: 0, column: 0 },
        mode: 'normal' as const,
        statusMessage: `New file: ${filename}`,
        viewportTop: 0,
        config: {
          theme: 'default',
          tabSize: 4,
          autoSave: false,
          keyBindings: {},
          maxUndoLevels: 100,
          showLineNumbers: true,
          wordWrap: false
        },
        currentFilename: filename,
        commandLine: "",
        mxCommand: "",
        buffers: editor.getState().buffers,
      };

      // Set the filename in the editor state
      editor.setEditorState(initialState);
    }
  } else {
    // No file specified - start with empty buffer
    initialState = {
      currentBuffer: FunctionalTextBufferImpl.create(""),
      cursorPosition: { line: 0, column: 0 },
      mode: 'normal' as const,
      statusMessage: '',
      viewportTop: 0,
      config: {
        theme: 'default',
        tabSize: 4,
        autoSave: false,
        keyBindings: {},
        maxUndoLevels: 100,
        showLineNumbers: true,
        wordWrap: false
      },
      currentFilename: undefined,
      commandLine: "",
      mxCommand: "",
      buffers: editor.getState().buffers,
    };

    // Set the initial state in the editor
    editor.setEditorState(initialState);
  }

  // Enter full screen mode
  enterFullScreen();

  // Setup cleanup handlers to restore terminal on exit
  setupCleanupHandlers();

  // Render the React-based editor
  // React is now a DUMB component - all logic goes through T-Lisp
  try {
    const { waitUntilExit } = render(
      <Editor
        initialEditorState={initialState}
        editor={editor}
        filename={filename}
        onError={(error: Error) => {
          console.error("Editor error:", error.message);
        }}
      />
    );

    await waitUntilExit();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("stdin is not a TTY") && !devMode) {
      console.error("Error: tmax must be run in a terminal.");
      console.error("Use --dev flag for non-TTY environments (testing, AI assistants).");
      console.error(`Details: ${errorMessage}`);
      process.exit(1);
    } else {
      console.error("Error starting tmax:", errorMessage);
      process.exit(1);
    }
  }

  // Restore terminal (cleanup handlers will also do this, but we do it here for safety)
  exitFullScreen();
}

// Run the application
main();
