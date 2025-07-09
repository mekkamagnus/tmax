#!/usr/bin/env deno run --allow-read --allow-write

/**
 * @file repl.ts
 * @description CLI script to run the T-Lisp REPL
 */

import { runREPL } from "../src/tlisp/repl.ts";

// Handle Ctrl+C gracefully
Deno.addSignalListener("SIGINT", () => {
  console.log("\nExiting...");
  Deno.exit(0);
});

// Run the REPL
if (import.meta.main) {
  await runREPL();
}