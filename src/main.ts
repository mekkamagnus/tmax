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
// #250: main.ts is THE tmax CLI. The launcher (ported from bin/tmax) handles
// every terminal verb (client/sweep/stop/test/capture/TUI-attach) in-process
// so the compiled binary is a drop-in `tmax`; it returns the route for the
// two in-process paths ('daemon' / 'embedded') below. Internal child-process
// flags the launcher spawns (never user-facing): --tui-client runs the TUI
// client's main in this process.
import { runLauncher } from './cli/launcher.ts';
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
  const startupLog = Logger.getInstance().module('main').fn('main');
  const startupId = startupLog.startOperation('editor-initialization');

  // Configure logger based on mode
  const args = process.argv.slice(2);

  // #250: internal child-process entry — the launcher spawns the compiled
  // binary with --tui-client for TUI attach (process isolation for raw-mode
  // /SIGINT cleanup is part of the TUI design). Route straight to the TUI
  // client's main; never user-facing.
  if (args[0] === '--tui-client') {
    const tui = await import('./client/tui-client.ts');
    await tui.main();
    return;
  }

  // Version BEFORE the launcher: `tmax --version` must print even when a
  // daemon is running (the launcher would otherwise route bare invocations
  // to a TUI attach). Same for --help (the launcher prints the full usage).
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`tmax v${pkg.version} (T-Lisp powered terminal editor)`);
    process.exit(0);
  }

  // #250: the launcher handles every terminal verb (exiting like the bash
  // exec's) and returns the in-process route for the rest.
  const route = await runLauncher(args);
  if (route === 'daemon') {
    await runDaemonMode(args);
    return;
  }
  const devMode = args.includes('--dev') || args.includes('--no-tty');
  // (--daemon is routed by the launcher before this point.)

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

  // Version and help were handled BEFORE the launcher above (--version) and
  // by the launcher's usage() (-h/--help, the full tmax CLI surface).

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

  // CHORE-44 Change 10 (AC10.4) + CHORE-69 / #80: the file-open bootstrap now
  // routes through the Editor-owned `openOrCreateFile`, which shares the SAME
  // buffer+filename setup (`attachFileBuffer`) as the daemon `open` RPC. This
  // eliminates the "two file-open paths" drift that let BUG-58 slip through.
  // The CLI differs from the daemon only in that a missing file creates a new
  // buffer instead of erroring (openFile leaves the previous buffer intact).
  let filename: string | undefined;
  let statusMessage = "";

  // Phase 4: Load (or create) the file if specified.
  if (fileArgs.length > 0) {
    filename = fileArgs[0]!;
    const { isNew } = await editor.openOrCreateFile(filename);
    statusMessage = isNew ? `New file: ${filename}` : `Loaded ${filename}`;
    startupLog.info(isNew ? `Creating new file: ${filename}` : `Loaded ${filename}`, {
      correlationId: startupId,
      metadata: { phase: isNew ? 'new-file' : 'load-file', filename }
    });
  } else {
    // No file specified - start with the *scratch* buffer
    startupLog.info('No file specified - starting with empty buffer', {
      correlationId: startupId,
      metadata: { phase: 'empty-buffer' }
    });
    editor.createBuffer('*scratch*', "");
    filename = undefined;
    statusMessage = '';
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

  // Phase 5a: Start embedded socket server (Emacs-style server-start).
  // The embedded editor NEVER restores workspace state — the file (if any) was
  // explicitly opened by the user. Workspace persistence is a daemon/client
  // feature. cleanStart=true prevents initializeWorkspaces from overwriting
  // the just-loaded file + filename.
  const server = new TmaxServer(undefined, false, editor, initFilePath, true);
  try {
    await server.startEditor();

    // Activate major mode for file loaded before core bindings were ready
    if (filename) {
      editor.activateMajorModeForFile(filename);
    }

    // #252: quiet — the TUI owns this screen; the async "listening" log of a
    // fire-and-forget startSocket would print at the cursor and clobber the
    // first rendered line.
    server.startSocket(true).catch((err: Error) => {
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

/** Daemon mode (#250): `tmax --daemon` — the launcher has already verified
 *  the socket is free (#235 loud failure) and routed here. */
async function runDaemonMode(args: string[]): Promise<void> {
  const startupLog = Logger.getInstance().module('main').fn('runDaemonMode');
  const initFileArgIndex = args.indexOf('--init-file');
  const initFilePath = initFileArgIndex !== -1 ? args[initFileArgIndex + 1] : undefined;
  const cleanStart = args.includes('--clean');

  console.log('Starting tmax server daemon...');
  const server = new TmaxServer(undefined, false, undefined, initFilePath, cleanStart);
  try {
    await server.start();
    startupLog.info('Server daemon started successfully', {});
    // Keep the process alive
    await new Promise(() => {}); // This will keep the server running indefinitely
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Run the application
main();
