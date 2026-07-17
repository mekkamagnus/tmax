#!/usr/bin/env bun
/**
 * tmax - Terminal-based text editor with T-Lisp
 *
 * This is the main entry point when tmax is installed globally via npm/bun.
 * It simply delegates to the main Bun/Steep application.
 */

// Resolve the path to the main.ts file
const path = import.meta.resolve('./src/main.ts');

// Import and run the main application
await import(path);
