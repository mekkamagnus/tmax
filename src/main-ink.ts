#!/usr/bin/env deno run --allow-read --allow-write --allow-run

/**
 * @file main-ink.ts
 * @description Main application entry point for tmax editor using Deno-ink React components
 */

import { render } from "https://deno.land/x/ink@1.3/mod.ts";
import { Editor } from "./frontend/components/Editor.tsx";
import { InkTerminalIO } from "./frontend/ink-adapter.ts";
import { FileSystemImpl } from "./core/filesystem.ts";
import { FunctionalTextBufferImpl } from "./core/buffer.ts";
import { Either } from "./utils/task-either.ts";
import { EditorState } from "./core/types.ts";
import { Logger, LogLevel } from "./utils/logger.ts";

/**
 * Main application class for Deno-ink version
 */
class TmaxInkApplication {
  private terminal: InkTerminalIO;
  private filesystem: FileSystemImpl;
  private initialState: EditorState;

  constructor(private developmentMode = false) {
    // Configure logger based on mode
    const logger = Logger.getInstance();
    if (developmentMode) {
      // Development mode: keep verbose logging for debugging
      logger.configure({
        level: LogLevel.DEBUG,
        structured: true,
        includeStack: true,
        aiFriendly: true
      });
    } else {
      // Normal mode: minimize logging to prevent terminal interference
      logger.configure({
        level: LogLevel.ERROR, // Only show errors
        structured: false,     // Simple format
        includeStack: false,   // No stack traces
        aiFriendly: false      // No emojis/formatting
      });
    }

    this.terminal = new InkTerminalIO();
    this.filesystem = new FileSystemImpl();
    
    // Initialize default editor state
    this.initialState = {
      currentBuffer: FunctionalTextBufferImpl.create(""),
      cursorPosition: { line: 0, column: 0 },
      mode: 'normal',
      statusMessage: 'Welcome to tmax (Deno-ink version)',
      viewportTop: 0,
      config: {
        theme: 'default',
        tabSize: 4,
        autoSave: false,
        keyBindings: {},
        maxUndoLevels: 100,
        showLineNumbers: true,
        wordWrap: false
      }
    };
  }

  /**
   * Start the application with Deno-ink renderer
   */
  async start(): Promise<void> {
    console.log("Starting tmax editor with Deno-ink...");

    // Parse command line arguments
    const args = Deno.args;
    const fileArgs = args.filter(arg => !arg.startsWith('--'));

    try {
      // If a file is specified, load it into the buffer
      if (fileArgs.length > 0) {
        const filename = fileArgs[0];
        
        try {
          const fileContent = await this.filesystem.readFile(filename).run();
          
          if (Either.isRight(fileContent)) {
            const buffer = FunctionalTextBufferImpl.create(fileContent.right);
            
            this.initialState = {
              ...this.initialState,
              currentBuffer: buffer,
              statusMessage: `Loaded ${filename}`
            };
          } else {
            // Handle file read error gracefully
            this.initialState = {
              ...this.initialState,
              statusMessage: `Error loading ${filename}: ${fileContent.left}`
            };
          }
        } catch (error) {
          this.initialState = {
            ...this.initialState,
            statusMessage: `Error loading ${filename}: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      }

      // Set up terminal resize handling
      this.setupResizeHandling();

      // Render the React-based editor
      await render(Editor, {
        initialEditorState: this.initialState,
        onError: (error: Error) => {
          console.error("Editor error:", error.message);
        }
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("stdin is not a TTY")) {
        console.error("Error: tmax must be run in a terminal.");
        console.error("Please run tmax from a real terminal (not through pipes, redirects, or non-interactive environments).");
      } else if (errorMessage.includes("raw mode")) {
        console.error("Error: Failed to initialize terminal for raw input.");
        console.error("This might be due to:");
        console.error("  - Running in a non-interactive environment");
        console.error("  - Terminal permissions issues");
        console.error("  - Unsupported terminal type");
        console.error(`Details: ${errorMessage}`);
      } else {
        console.error("Error starting tmax:", errorMessage);
      }

      await this.shutdown();
      Deno.exit(1);
    }
  }

  /**
   * Set up terminal resize handling
   */
  private setupResizeHandling(): void {
    // Set up the callback to handle terminal resize events
    this.terminal.onSizeChange((newSize) => {
      // Update the terminal size in the adapter
      // This will be used by components that need to know terminal dimensions
      console.log(`Terminal resized to ${newSize.width}x${newSize.height}`);
    });
  }

  /**
   * Handle shutdown
   */
  async shutdown(): Promise<void> {
    console.log("Shutting down tmax editor (Deno-ink version)...");
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Check for development mode flag
  const developmentMode = Deno.args.includes('--dev') || Deno.args.includes('--no-tty');

  // Show help if requested
  if (Deno.args.includes('--help') || Deno.args.includes('-h')) {
    console.log(`
tmax - Terminal-based text editor (Deno-ink version)

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
    Deno.exit(0);
  }

  if (developmentMode) {
    console.log("🔧 Development mode: TTY checks disabled for AI coding environments");
  }

  const app = new TmaxInkApplication(developmentMode);

  // Handle Ctrl+C gracefully
  const sigintHandler = async () => {
    console.log("\nReceived SIGINT, shutting down...");
    await app.shutdown();
    Deno.exit(0);
  };

  // Set up signal handlers
  Deno.addSignalListener("SIGINT", sigintHandler);

  try {
    await app.start();
  } catch (error) {
    console.error("Application error:", error instanceof Error ? error.message : String(error));
    await app.shutdown();
    Deno.exit(1);
  }

  // Clean shutdown
  await app.shutdown();
}

// Run the application if this file is executed directly
if (import.meta.main) {
  await main();
}