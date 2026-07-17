#!/usr/bin/env bun
/**
 * @file main.ts
 * @description Main application entry point for tmax editor
 * T-Lisp drives ALL editor logic - TypeScript is just a thin I/O layer
 */

import { Editor as EditorClass } from './editor/editor.ts';
import { TerminalIOImpl } from './core/terminal.ts';
import { FileSystemImpl } from './core/filesystem.ts';
import { TmaxServer } from './server/server.ts';
import { Logger, LogLevel } from './utils/logger.ts';
import { SteepFrontend } from './steep/assam.ts';
// Single source of truth for the version: package.json. The `with { type: "json" }`
// import attribute is supported by Bun's runtime AND its `bun build --compile`
// bundler, so the compiled binary and `tmax --version` both read the same value
// the npm package declares. AC10.3.
import pkg from "../package.json" with { type: "json" };

/**
 * Main entry point that:
 * 1. Parses command line arguments
 * 2. Loads file if specified (or creates new buffer)
 * 3. Creates Editor class (with T-Lisp interpreter)
 * 4. Starts the Steep ANSI frontend OR the daemon
 *
 * Architecture: T-Lisp (core logic) → Editor class → Steep frontend (rendering)
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

  // Parse --init-file flag (SPEC-025)
  const initFileArgIndex = args.indexOf('--init-file');
  let initFilePath: string | undefined;
  if (initFileArgIndex !== -1 && args[initFileArgIndex + 1]) {
    initFilePath = args[initFileArgIndex + 1];
  }

  // Version comes from package.json (single source of truth, AC10.3).
  const VERSION = pkg.version;

  // Show version if requested
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`tmax v${VERSION} (T-Lisp powered terminal editor)`);
    startupLog.completeOperation('editor-initialization', startupId);
    process.exit(0);
  }

  // Show help if requested
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
tmax - Terminal-based text editor (T-Lisp powered)
Version: ${VERSION}

Usage: tmax [options] [filename]

Options:
  -v, --version       Show version and exit
  -h, --help          Show this help message
  --daemon            Start server daemon mode
  --dev, --no-tty     Development mode (skip TTY checks for AI coding assistants)
  --init-file FILE    Use custom init file (default: ~/.config/tmax/init.tlisp)

Examples:
  tmax                    # Start editor with native frontend
  tmax file.txt           # Open file.txt
  tmax --daemon           # Start server daemon
  tmax --dev              # Start in development mode
  tmax --init-file ./my-config.tlisp  # Use custom init file
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

  const editor = new EditorClass(terminal, filesystem, initFilePath);
  startupLog.debug('Editor instance created', {
    correlationId: startupId,
    data: {
      mode: editor.getState().mode,
      bufferCount: editor.getState().buffers?.size ?? 0
    }
  });

  // CHORE-44 Change 10 (AC10.4): one initial model path for empty,
  // existing-file, and new-file cases. We no longer construct an EditorState
  // object literal — instead the three cases differ only in
  // (bufferName, filename, content, status), and we route the result through
  // the model API (createBuffer + applyUpdate) exactly as `openFile` does.
  // Buffer naming, status text, and filename binding match the prior path.
  let bufferName: string;
  let filename: string | undefined;
  let content = "";
  let statusMessage = "";

  // Phase 4: Load file if specified
  if (fileArgs.length > 0) {
    filename = fileArgs[0]!;
    bufferName = filename;
    try {
      startupLog.info(`Loading file: ${filename}`, {
        correlationId: startupId,
        metadata: { phase: 'load-file', filename }
      });
      content = await filesystem.readFile(filename);
      statusMessage = `Loaded ${filename}`;
      startupLog.info('File loaded successfully', {
        correlationId: startupId,
        data: { filename, bufferSize: content.length }
      });
    } catch (error) {
      // File doesn't exist or can't be read - create new buffer
      startupLog.info(`Creating new file: ${filename}`, {
        correlationId: startupId,
        metadata: { phase: 'new-file', filename }
      });
      content = "";
      statusMessage = `New file: ${filename}`;
      startupLog.debug('New buffer created', {
        correlationId: startupId,
        data: { filename }
      });
    }
  } else {
    // No file specified - start with the *scratch* buffer
    startupLog.info('No file specified - starting with empty buffer', {
      correlationId: startupId,
      metadata: { phase: 'empty-buffer' }
    });
    bufferName = '*scratch*';
    filename = undefined;
    content = "";
    statusMessage = '';
  }

  // Route the bootstrap through the model API. `createBuffer` sets
  // currentBuffer, seeds windows, registers default buffer metadata, and (for
  // the first buffer) initializes the mode to 'normal'. We then attach the
  // filename on the model (consulted by `saveFile`) and the status text. The
  // buffer name equals the filename, so per-buffer metadata lookups naturally
  // resolve; no manual metadata binding is needed.
  editor.createBuffer(bufferName, content);
  if (filename !== undefined) {
    editor.applyUpdate({ type: "SetCurrentFilename", filename });
  }
  if (statusMessage) {
    editor.applyUpdate({ type: "SetStatusMessage", message: statusMessage });
  }

  if (!fileArgs.length) {
    startupLog.debug('Empty buffer initialized', {
      correlationId: startupId
    });
  }

  // Phase 5: Initialize UI
  startupLog.info('Phase 5: Initializing Steep native frontend', {
    correlationId: startupId,
    metadata: { phase: 'init-ui', frontend: 'steep' }
  });

  // Phase 5a: Start embedded socket server (Emacs-style server-start)
  const server = new TmaxServer(undefined, false, editor);
  try {
    await server.startEditor();

    // Activate major mode for file loaded before core bindings were ready
    if (filename) {
      editor.activateMajorModeForFile(filename);
    }

    server.startSocket().catch((err: Error) => {
      // Graceful degradation: editor works without socket if already in use
      startupLog.info('Socket server not started (already in use or unavailable)', {
        correlationId: startupId,
        data: { reason: err.message }
      });
    });
  } catch (err) {
    startupLog.info('Embedded server init skipped', {
      correlationId: startupId,
      data: { reason: err instanceof Error ? err.message : String(err) }
    });
  }

  const frontend = new SteepFrontend();
  // Subscribe the frontend to editor state changes so that input arriving over
  // the socket (tmaxclient --keys) — which mutates the shared editor but
  // bypasses the SteepFrontend's own stdin render path — still triggers a
  // repaint. requestRender is a no-op until frontend.run initializes its loop.
  editor.onStateChange(() => frontend.requestRender(editor));
  try {
    // Read the post-bootstrap model state as the frontend's initial snapshot.
    await frontend.run(editor, editor.getState());
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!errorMessage.includes('EDITOR_QUIT_SIGNAL')) {
      console.error("Error starting tmax:", errorMessage);
      process.exit(1);
    }
  }
}

// Run the application
main();
