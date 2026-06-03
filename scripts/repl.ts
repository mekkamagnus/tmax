#!/usr/bin/env bun

/**
 * @file repl.ts
 * @description CLI script to run the T-Lisp REPL
 */

import { runREPL } from "../src/tlisp/repl.ts";

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
  console.log("\nExiting...");
  process.exit(0);
});

// Run the REPL
if (import.meta.main) {
  await runREPL();
}