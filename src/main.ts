#!/usr/bin/env deno run --allow-read --allow-write --allow-run

/**
 * @file main.ts
 * @description Main application entry point for tmax editor
 */

import { Editor } from "./editor/editor.ts";
import { TerminalIOImpl } from "./core/terminal.ts";
import { FileSystemImpl } from "./core/filesystem.ts";
import { Logger, LogLevel } from "./utils/logger.ts";

/**
 * Main application class
 */
class TmaxApplication {
  private editor: Editor;
  private terminal: TerminalIOImpl;
  private filesystem: FileSystemImpl;

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

    this.terminal = new TerminalIOImpl(developmentMode);
    this.filesystem = new FileSystemImpl();
    this.editor = new Editor(this.terminal, this.filesystem);
  }

  /**
   * Start the application
   */
  async start(): Promise<void> {
    console.log("Starting tmax editor...");
    
    // Parse command line arguments
    const args = Deno.args;
    const fileArgs = args.filter(arg => !arg.startsWith('--'));
    
    try {
      // Enter raw mode for terminal input (skip in development mode)
      if (!this.developmentMode) {
        await this.terminal.enterRawMode();
      }
      
      // If a file is specified, open it
      if (fileArgs.length > 0) {
        const filename = fileArgs[0];
        await this.editor.openFile(filename);
      }
      
      // Start the editor
      await this.editor.start();
      
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
   * Handle shutdown
   */
  async shutdown(): Promise<void> {
    console.log("Shutting down tmax editor...");
    this.editor.stop();
    await this.terminal.exitRawMode();
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
tmax - Terminal-based text editor

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
  
  const app = new TmaxApplication(developmentMode);
  
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