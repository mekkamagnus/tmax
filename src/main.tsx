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
import { TmaxServer } from './server/server.ts';
import { Logger, LogLevel } from './utils/logger.ts';

/**
 * Switch to alternate screen buffer (full screen mode)
 * Skips alternate screen buffer if TMAX_TEST_MODE is set (for UI testing)
 */
function enterFullScreen() {
  // Check if we're in test mode (UI testing via tmux)
  const testMode = process.env.TMAX_TEST_MODE === 'true';

  if (!testMode) {
    // ANSI escape code to enter alternate screen buffer
    process.stdout.write('\x1b[?1049h');
  }

  // Clear screen and move cursor to top-left
  process.stdout.write('\x1b[2J');
  process.stdout.write('\x1b[H');

  // Hide cursor
  process.stdout.write('\x1b[?25l');
}

/**
 * Exit alternate screen buffer (restore normal screen)
 * Skips alternate screen buffer exit if TMAX_TEST_MODE is set
 */
function exitFullScreen() {
  // Show cursor
  process.stdout.write('\x1b[?25h');

  // Check if we're in test mode
  const testMode = process.env.TMAX_TEST_MODE === 'true';

  if (!testMode) {
    // Exit alternate screen buffer
    process.stdout.write('\x1b[?1049l');
  }
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
 * 4. Renders the React UI (dumb view layer) OR starts daemon
 *
 * Architecture: T-Lisp (core logic) → Editor class → React UI (dumb view)
 */

async function main() {
  const startTime = Date.now();
  const perfLog = Logger.getInstance().module('performance').fn('main');
  const startupLog = Logger.getInstance().module('main').fn('main');
  const startupId = startupLog.startOperation('editor-initialization');

  // Configure logger based on mode
  const args = process.argv.slice(2);
  const devMode = args.includes('--dev') || args.includes('--no-tty');
  const daemonMode = args.includes('--daemon');

  const logger = Logger.getInstance();
  if (devMode) {
    // Development mode: show everything with AI-friendly formatting
    logger.configure({
      level: LogLevel.DEBUG,
      structured: true,
      includeStack: true,
      aiFriendly: true
    });
    startupLog.info('Development mode: VERBOSE logging enabled', {
      correlationId: startupId,
      metadata: { logLevel: 'DEBUG' }
    });
  } else {
    // Normal mode: show only INFO and above with clean output
    logger.configure({
      level: LogLevel.INFO,
      structured: false,
      includeStack: false,
      aiFriendly: false
    });
    startupLog.debug('Normal mode: STANDARD logging enabled', {
      correlationId: startupId,
      metadata: { logLevel: 'INFO' }
    });
  }

  // Log startup configuration
  startupLog.info('Starting tmax editor', {
    correlationId: startupId,
    data: {
      mode: devMode ? 'development' : 'normal',
      args: args,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd()
    }
  });

  // Show help if requested
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
tmax - Terminal-based text editor (Bun + Ink version with T-Lisp)

Usage: tmax [options] [filename]

Options:
  --daemon           Start server daemon mode
  --dev, --no-tty    Development mode (skip TTY checks for AI coding assistants)
  --help, -h         Show this help message

Examples:
  tmax               # Start editor in normal mode
  tmax file.txt      # Open file.txt
  tmax --daemon      # Start server daemon
  tmax --dev         # Start in development mode (for AI coding environments)
  tmax --dev file.txt # Open file.txt in development mode
    `);
    startupLog.completeOperation('editor-initialization', startupId);
    process.exit(0);
  }

  // Handle daemon mode
  if (daemonMode) {
    startupLog.info('Phase 1: Starting server daemon', {
      correlationId: startupId,
      metadata: { phase: 'daemon' }
    });

    console.log('Starting tmax server daemon...');
    const server = new TmaxServer();
    try {
      await server.start();

      startupLog.info('Server daemon started successfully', {
        correlationId: startupId,
        data: { uptime: Date.now() - startTime }
      });

      // Keep the process alive
      await new Promise(() => {}); // This will keep the server running indefinitely
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      startupLog.failOperation('editor-initialization', startupId, err, {
        phase: 'daemon'
      });
      console.error('Failed to start server:', error);
      process.exit(1);
    }
    return;
  }

  // Filter out file arguments
  const fileArgs = args.filter(arg => !arg.startsWith('--') && arg !== '-d');

  // Phase 2: Create core components
  startupLog.info('Phase 2: Creating core components', {
    correlationId: startupId,
    metadata: { phase: 'create-components' }
  });

  const terminal = new TerminalIOImpl(devMode);
  startupLog.debug('Terminal implementation created', {
    correlationId: startupId,
    data: { devMode }
  });

  const filesystem = new FileSystemImpl();
  startupLog.debug('Filesystem implementation created', {
    correlationId: startupId
  });

  // Phase 3: Initialize editor
  startupLog.info('Phase 3: Initializing T-Lisp editor', {
    correlationId: startupId,
    metadata: { phase: 'init-editor' }
  });

  const editor = new EditorClass(terminal, filesystem);
  startupLog.debug('Editor instance created', {
    correlationId: startupId,
    data: {
      mode: editor.getState().mode,
      bufferCount: editor.getState().buffers.size
    }
  });

  let filename: string | undefined;
  let initialState: EditorState;

  // Phase 4: Load file if specified
  if (fileArgs.length > 0) {
    filename = fileArgs[0];

    // Try to load the file
    try {
      startupLog.info(`Loading file: ${filename}`, {
        correlationId: startupId,
        metadata: { phase: 'load-file', filename }
      });

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

      startupLog.info('File loaded successfully', {
        correlationId: startupId,
        data: {
          filename,
          bufferSize: content.length,
          lineCount: initialState.currentBuffer.getLineCount()
        }
      });
    } catch (error) {
      // File doesn't exist or can't be read - create new buffer
      startupLog.info(`Creating new file: ${filename}`, {
        correlationId: startupId,
        metadata: { phase: 'new-file', filename }
      });

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

      startupLog.debug('New buffer created', {
        correlationId: startupId,
        data: { filename }
      });
    }
  } else {
    // No file specified - start with empty buffer
    startupLog.info('No file specified - starting with empty buffer', {
      correlationId: startupId,
      metadata: { phase: 'empty-buffer' }
    });

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

    startupLog.debug('Empty buffer initialized', {
      correlationId: startupId
    });
  }

  // Phase 5: Initialize UI
  startupLog.info('Phase 5: Initializing React UI', {
    correlationId: startupId,
    metadata: { phase: 'init-ui' }
  });

  // Enter full screen mode
  enterFullScreen();

  // Setup cleanup handlers to restore terminal on exit
  setupCleanupHandlers();

  // Render the React-based editor
  // React is now a DUMB component - all logic goes through T-Lisp
  try {
    // Configure Ink options for development/testing environments
    const inkOptions: any = {};

    // In dev mode, only use mock stdin if we're NOT in a real TTY
    // This allows the editor to work properly in tmux while still supporting
    // non-TTY environments like Claude Code
    if (devMode && !process.stdin.isTTY) {
      const { Duplex } = await import('stream');
      const mockStdin = new Duplex({
        read() { /* No-op in dev mode - input comes from test harness */ },
        write(_chunk, _encoding, callback) { callback(); }
      });
      // Mock isTTY for Ink's internal checks
      (mockStdin as any).isTTY = true;
      inkOptions.stdin = mockStdin;
    }

    const { waitUntilExit } = render(
      <Editor
        initialEditorState={initialState}
        editor={editor}
        filename={filename}
        onError={(error: Error) => {
          console.error("Editor error:", error.message);
        }}
      />,
      inkOptions
    );

    startupLog.info('React UI rendered successfully', {
      correlationId: startupId,
      data: {
        filename: filename || '<new buffer>',
        mode: initialState.mode
      }
    });

    const totalStartupTime = Date.now() - startTime;
    startupLog.completeOperation('editor-initialization', startupId, {
      data: {
        totalTime: totalStartupTime,
        filename: filename || '<new buffer>',
        mode: initialState.mode
      }
    });

    perfLog.info('Startup performance metrics', {
      data: {
        totalStartupTime,
        mode: devMode ? 'development' : 'normal'
      }
    });

    await waitUntilExit();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const err = error instanceof Error ? error : new Error(errorMessage);

    startupLog.failOperation('editor-initialization', startupId, err, {
      phase: 'init-ui'
    });

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
