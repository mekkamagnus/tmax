#!/usr/bin/env bun
/**
 * tmax - Terminal-based text editor with T-Lisp
 *
 * This is the main entry point when tmax is installed globally via npm/bun.
 * It simply delegates to the main React/Ink application.
 */

// Resolve the path to the main.tsx file
const path = import.meta.resolve('./src/main.tsx');

// Import and run the main application
await import(path);
