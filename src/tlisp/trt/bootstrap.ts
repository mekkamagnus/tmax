/**
 * @file trt/bootstrap.ts
 * @description TS bootstrap for the self-hosted trt framework (SPEC-049).
 *
 * The framework itself is T-Lisp (src/tlisp/core/trt/*.tlisp). TS holds only what T-Lisp cannot
 * bootstrap itself:
 *   1. Bridge builtins connecting the T-Lisp runner to the pure result store (results.ts) —
 *      `trt-record`, `trt-results-ts`, `trt-results-json-ts`, `trt-reset-store`.
 *   2. A loader that evaluates the core/trt/*.tlisp files into the interpreter at startup.
 *
 * Nothing test-specific (no deftest, no assertions, no runner logic) lives here — that is the
 * Lisp-first discipline of RFC-001. This module is covered by test/unit/trt-bootstrap.test.ts.
 */

import type { TLispInterpreter, TLispValue } from "../types.ts";
import { createString, createNumber, createBoolean, createList, createNil, valueToString } from "../values.ts";
import { readFileSync, readdirSync } from "node:fs";
import type { AppError } from "../../error/types.ts";
import { Either } from "../../utils/task-either.ts";
import {
  recordResult,
  resetResultStore,
  getResultStore,
  toTLispValue,
  toJson,
  emptyRunResult,
} from "./results.ts";

/**
 * Register the bridge builtins that let the T-Lisp framework talk to the result store.
 * These are intentionally minimal and side-effect-free except for the store mutation itself.
 */
export function registerTrtBridgeBuiltins(interpreter: TLispInterpreter): void {
  // CHORE-44 Change 4 AC4.8: coverage builtins operate on the per-instance
  // CoverageState owned by this interpreter's evaluator. The non-null
  // assertion is safe because TLispInterpreterImpl (the sole production
  // implementor) always exposes `coverage`; the interface marks it optional
  // only because the test-interface mocks need not.
  const coverage = interpreter.coverage!;
  // trt-record NAME PASSED ERROR-OR-NIL DURATION-MS [FILE]
  // Record one test outcome in the store. ERROR-OR-NIL is a string when failed, nil when passed.
  interpreter.defineBuiltin("trt-record", (args: TLispValue[]) => {
    if (args.length < 4 || args.length > 5) {
      return Either.left({
        type: 'EvalError', variant: 'RuntimeError',
        message: "trt-record requires NAME PASSED ERROR DURATION [FILE]",
        details: { actual: args.length },
      });
    }
    const name = String(args[0]!.value);
    const passed = args[1]!.type === "boolean" ? (args[1]!.value as boolean) : isTruthyVal(args[1]!);
    const errorArg = args[2]!;
    const error = errorArg.type === "nil" ? undefined : String(errorArg.value);
    const durationMs = Number(args[3]!.value);
    const file = args[4] && args[4]!.type !== "nil" ? String(args[4]!.value) : undefined;
    recordResult({ name, passed, error, durationMs, file });
    return Either.right(createBoolean(true));
  });

  // trt-results-ts → structured T-Lisp data (stats alist + tests plist list).
  interpreter.defineBuiltin("trt-results-ts", () => {
    return Either.right(toTLispValue(getResultStore().getRunResult()));
  });

  // trt-results-json-ts → JSON string of stats + tests.
  interpreter.defineBuiltin("trt-results-json-ts", () => {
    return Either.right(createString(toJson(getResultStore().getRunResult())));
  });

  // trt-reset-store → clear the result store (called by trt-reset for isolation).
  interpreter.defineBuiltin("trt-reset-store", () => {
    resetResultStore();
    return Either.right(createBoolean(true));
  });

  // trt-eval-source SOURCE → evaluate a string of T-Lisp source (used by trt-load-file to load
  // a test file's contents). Returns the value of the last top-level expression, or raises.
  interpreter.defineBuiltin("trt-eval-source", (args: TLispValue[]) => {
    if (args.length !== 1 || args[0]!.type !== "string") {
      return Either.left({
        type: 'EvalError', variant: 'RuntimeError',
        message: "trt-eval-source requires exactly 1 string argument",
        details: { actual: args.length },
      });
    }
    const source = args[0]!.value as string;
    const result = (interpreter as any).execute(source);
    return result && Either.isLeft(result) ? Either.left(result.left as AppError) : Either.right(result.right ?? createNil());
  });

  // trt-read-file PATH -> file contents as a string (for trt-load-file). Scoped to the trt
  // framework because the daemon editor profile does not expose general file I/O to T-Lisp.
  interpreter.defineBuiltin("trt-read-file", (args: TLispValue[]) => {
    if (args.length !== 1 || args[0]!.type !== "string") {
      return Either.left({ type: 'EvalError', variant: 'RuntimeError', message: "trt-read-file requires 1 string", details: {} });
    }
    try {
      return Either.right(createString(readFileSync(args[0]!.value as string, "utf8")));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Either.left({ type: 'EvalError', variant: 'RuntimeError', message: `trt-read-file: ${message}`, details: {} });
    }
  });

  // trt-list-directory PATH -> list of entry names in a directory (for trt-discover).
  interpreter.defineBuiltin("trt-list-directory", (args: TLispValue[]) => {
    if (args.length !== 1 || args[0]!.type !== "string") {
      return Either.left({ type: 'EvalError', variant: 'RuntimeError', message: "trt-list-directory requires 1 string", details: {} });
    }
    try {
      const entries = readdirSync(args[0]!.value as string);
      return Either.right(createList(entries.map(e => createString(e))));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Either.left({ type: 'EvalError', variant: 'RuntimeError', message: `trt-list-directory: ${message}`, details: {} });
    }
  });

  // coverage-* builtins: the coverage API that wraps the per-instance
  // CoverageState owned by the active evaluator (CHORE-44 Change 4 AC4.8).
  // These were formerly registered by the removed test-framework.ts; they
  // now go through `interpreter.coverage` so two interpreters don't share
  // coverage state.
  interpreter.defineBuiltin("coverage-enable", (args: TLispValue[]) => {
    coverage.setEnabled(args[0]!.type === "boolean" ? (args[0]!.value as boolean) : true);
    return Either.right(createBoolean(true));
  });
  interpreter.defineBuiltin("coverage-enabled", () => Either.right(createBoolean(coverage.isEnabled())));
  interpreter.defineBuiltin("coverage-percentage", () => Either.right(createNumber(coverage.getPercentage())));
  interpreter.defineBuiltin("coverage-report", () => Either.right(createString(coverage.generateReport())));
  interpreter.defineBuiltin("coverage-reset", () => { coverage.reset(); return Either.right(createBoolean(true)); });
  interpreter.defineBuiltin("coverage-threshold", (args: TLispValue[]) => {
    if (args.length === 1) { coverage.setThreshold(Number(args[0]!.value)); return Either.right(createBoolean(true)); }
    return Either.right(createNumber(coverage.getThreshold()));
  });
  interpreter.defineBuiltin("coverage-format", (args: TLispValue[]) => {
    if (args.length === 1) { coverage.setFormat(args[0]!.value as "text" | "json"); return Either.right(createBoolean(true)); }
    return Either.right(createString(coverage.getFormat()));
  });

  // trt-lookup NAME -> the bound value, or nil (for trt-bound-p).
  interpreter.defineBuiltin("trt-lookup", (args: TLispValue[]) => {
    const v = interpreter.globalEnv?.lookup(args[0]!.value as string);
    return Either.right(v ?? createNil());
  });

  // trt-test-dir -> absolute path to the repo's test/tlisp directory. Computed from cwd
  // so it works regardless of where the daemon was launched.
  interpreter.defineBuiltin("trt-test-dir", () => {
    return Either.right(createString(`${process.cwd()}/test/tlisp/`));
  });

  // trt-failed-names -> list of just the failing test NAME strings (no error text), so
  // trt-run-failing can re-run exactly those tests.
  interpreter.defineBuiltin("trt-failed-names", () => {
    const run = getResultStore().getRunResult();
    const failed = run.tests.filter(t => !t.passed);
    return Either.right(createList(failed.map(t => createString(t.name))));
  });

  // trt-failed-tests -> list of "name :: error" strings for each failing test. Convenience
  // for the trt-commands M-x reporting path (avoids plist parsing in T-Lisp).
  interpreter.defineBuiltin("trt-failed-tests", () => {
    const run = getResultStore().getRunResult();
    const failed = run.tests.filter(t => !t.passed);
    return Either.right(createList(failed.map(t => createString(`${t.name} :: ${t.error ?? "(no message)"}`))));
  });

  // trt-value-to-string VALUE -> string rendering of a T-Lisp value (for snapshots).
  interpreter.defineBuiltin("trt-value-to-string", (args: TLispValue[]) => {
    return Either.right(createString(valueToString(args[0]!)));
  });

  // trt-coverage-enable FLAG -> enable/disable function coverage tracking.
  interpreter.defineBuiltin("trt-coverage-enable", (args: TLispValue[]) => {
    coverage.setEnabled(args[0]!.type === "boolean" ? (args[0]!.value as boolean) : true);
    return Either.right(createBoolean(true));
  });

  // trt-coverage-pct -> current coverage percentage (0-100).
  interpreter.defineBuiltin("trt-coverage-pct", () => {
    return Either.right(createNumber(coverage.getPercentage()));
  });

  // trt-coverage-format-report -> text coverage report string.
  interpreter.defineBuiltin("trt-coverage-format-report", () => {
    return Either.right(createString(coverage.generateReport()));
  });

  // trt-coverage-reset -> clear coverage state.
  interpreter.defineBuiltin("trt-coverage-reset", () => {
    coverage.reset();
    return Either.right(createBoolean(true));
  });

  // trt-now-ms -> current wall-clock time in ms. Scoped to trt because the daemon editor
  // profile does not register the standalone `current-time` builtin.
  interpreter.defineBuiltin("trt-now-ms", () => {
    return Either.right(createNumber(Date.now()));
  });

  // trt-current-stats-ts → (passed failed total duration) list, handy for exit-code
  // mapping in the CLI and observability logging (SPEC-055 carries duration).
  interpreter.defineBuiltin("trt-current-stats-ts", () => {
    const { stats } = getResultStore().getRunResult();
    return Either.right(createList([
      createNumber(stats.passed),
      createNumber(stats.failed),
      createNumber(stats.total),
      createNumber(stats.durationMs),
    ]));
  });

  // trt-exit-code-ts → 0 all-pass / 1 any-fail / 2 no-tests (the contract an agent/CI loops on).
  interpreter.defineBuiltin("trt-exit-code-ts", () => {
    const run = getResultStore().getRunResult();
    const code = run.stats.total === 0 ? 2 : run.stats.failed === 0 ? 0 : 1;
    return Either.right(createNumber(code));
  });
}

// Local helper to avoid importing isTruthy circularly in some profiles.
function isTruthyVal(v: TLispValue): boolean {
  if (!v) return false;
  if (v.type === "nil") return false;
  if (v.type === "boolean") return v.value as boolean;
  return true;
}

/**
 * Load the self-hosted trt framework T-Lisp files into the interpreter.
 * Reads each core/trt/*.tlisp file and evaluates it. Files are loaded in dependency order;
 * trt.tlisp first (core registry/runner), then the rest.
 *
 * Returns true on success; on failure, throws with the offending file + message so the caller
 * (daemon startup) surfaces a clear error rather than a silently-broken framework.
 */
export async function loadTrtFramework(interpreter: TLispInterpreter): Promise<boolean> {
  registerTrtBridgeBuiltins(interpreter);

  const coreDir = `${import.meta.dir}/../core/trt`;
  // Load order matters: trt.tlisp defines the registry/runner that the others build on.
  const files = [
    "trt.tlisp",
    "assertions.tlisp",
    "cli.tlisp",
    "fixtures.tlisp",
    "suites.tlisp",
    "parametrize.tlisp",
    "async.tlisp",
    "snapshots.tlisp",
    "coverage.tlisp",
    "mock.tlisp",
    "bench.tlisp",
    "doctest.tlisp",
  ];

  for (const file of files) {
    const path = `${coreDir}/${file}`;
    try {
      const source = await Bun.file(path).text();
      loadOne(interpreter, file, source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`trt bootstrap: failed to load ${file}: ${message}`);
    }
  }
  // Load the M-x trt command (lives outside core/trt, in core/commands).
  const commandSource = readFileSync(`${import.meta.dir}/../core/commands/trt-commands.tlisp`, "utf8");
  loadOne(interpreter, "trt-commands.tlisp", commandSource);
  return true;
}

/**
 * Synchronous variant for contexts that cannot await (e.g. a constructor). The framework files
 * are small, fixed paths, so readFileSync is acceptable here. Used by the daemon constructor.
 */
export function loadTrtFrameworkSync(interpreter: TLispInterpreter): boolean {
  registerTrtBridgeBuiltins(interpreter);

  const coreDir = `${import.meta.dir}/../core/trt`;
  const files = ["trt.tlisp", "assertions.tlisp", "cli.tlisp", "fixtures.tlisp", "suites.tlisp", "parametrize.tlisp", "async.tlisp", "snapshots.tlisp", "coverage.tlisp", "mock.tlisp", "bench.tlisp", "doctest.tlisp", "../commands/trt-commands.tlisp"];

  for (const file of files) {
    const path = `${coreDir}/${file}`;
    try {
      const source = readFileSync(path, "utf8");
      loadOne(interpreter, file, source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`trt bootstrap: failed to load ${file}: ${message}`);
    }
  }
  try {
    const cmdSrc = readFileSync(`${import.meta.dir}/../core/commands/trt-commands.tlisp`, "utf8");
    loadOne(interpreter, "trt-commands.tlisp", cmdSrc);
  } catch (e) {
    console.error("TRT COMMAND LOAD FAILED:", (e as Error).message);
  }
  return true;
}

/** Evaluate one framework source file, throwing on evaluation error. */
function loadOne(interpreter: TLispInterpreter, file: string, source: string): void {
  const result = (interpreter as any).execute(source);
  if (result && Either.isLeft(result)) {
    const leftAny = result.left as { message?: string };
    throw new Error(`trt bootstrap: ${file}: ${leftAny?.message ?? result.left}`);
  }
}

// results.ts re-exports for the CLI/bootstrap test consumers.
export { resetResultStore, getResultStore, emptyRunResult, toJson };
