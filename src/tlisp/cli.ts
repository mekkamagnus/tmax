#!/usr/bin/env bun
/**
 * @file cli.ts
 * @description Standalone T-Lisp command-line interface.
 */

import { readFileSync } from "node:fs";
import { Either } from "../utils/task-either.ts";
import { createStandaloneInterpreter } from "./profiles/standalone.ts";
import { runREPL } from "./repl.ts";
import { valueToString } from "./values.ts";
import { renderDiagnostic } from "./diagnostic-renderer.ts";

function usage(): string {
  return `Usage: tlisp [options] [script.tlisp]

Options:
  -e, --eval EXPR   Evaluate one T-Lisp expression
  -h, --help        Show this help message
  --version         Show version

Examples:
  tlisp
  tlisp -e '(+ 1 2)'
  tlisp script.tlisp
`;
}

function stripShebang(source: string): string {
  return source.startsWith("#!") ? source.replace(/^#!.*(?:\r?\n|$)/, "") : source;
}

async function readVersion(): Promise<string> {
  try {
    const pkg = JSON.parse(await Bun.file("package.json").text()) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function printEvalError(message: string): void {
  process.stderr.write(`Error: ${message}\n`);
}

function runEval(source: string, printNil = true): number {
  const interpreter = createStandaloneInterpreter({ allowShell: true });
  const result = interpreter.execute(stripShebang(source));
  if (Either.isLeft(result)) {
    const err = result.left;
    if (err.diagnostic) {
      process.stderr.write(`${renderDiagnostic(err.diagnostic)}\n`);
    } else {
      printEvalError(err.message);
    }
    return 1;
  }
  if (printNil || result.right.type !== "nil") {
    process.stdout.write(`${valueToString(result.right)}\n`);
  }
  return 0;
}

function runScript(path: string): number {
  try {
    return runEval(readFileSync(path, "utf8"), false);
  } catch (error) {
    printEvalError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0) {
    await runREPL({ allowShell: true });
    return 0;
  }

  const [first, second] = argv;

  switch (first) {
    case "-h":
    case "--help":
      process.stdout.write(usage());
      return 0;
    case "--version":
      process.stdout.write(`${await readVersion()}\n`);
      return 0;
    case "-e":
    case "--eval":
      if (!second) {
        printEvalError(`${first} requires an expression`);
        return 1;
      }
      return runEval(second);
    default:
      if (first?.startsWith("-")) {
        printEvalError(`Unknown option: ${first}`);
        process.stderr.write(usage());
        return 1;
      }
      if (!first) {
        await runREPL({ allowShell: true });
        return 0;
      }
      return runScript(first);
  }
}

if (import.meta.main) {
  process.exit(await main());
}
