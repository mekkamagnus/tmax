#!/usr/bin/env deno run --allow-read --allow-write --allow-run

/**
 * @file main.ts
 * @description Main application entry point for tmax editor
 */

import { Editor } from "./editor/editor.ts";
import { TerminalIOImpl } from "./core/terminal.ts";
import { FileSystemImpl } from "./core/filesystem.ts";

/**
 * Main application class
 */
class TmaxApplication {
  private editor: Editor;
  private terminal: TerminalIOImpl;
  private filesystem: FileSystemImpl;

  constructor() {
    this.terminal = new TerminalIOImpl();
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
    
    try {
      // Enter raw mode for terminal input
      await this.terminal.enterRawMode();
      
      // If a file is specified, open it
      if (args.length > 0) {
        const filename = args[0];
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
  const app = new TmaxApplication();
  
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