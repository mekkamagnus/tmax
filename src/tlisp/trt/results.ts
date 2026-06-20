/**
 * @file trt/results.ts
 * @description Pure structured result store for the trt (T-Lisp Runtime Testing) framework.
 *
 * This is the AI-observable contract: a runner executes tests and records each result here;
 * callers obtain per-test {name, passed, error, duration} as structured data (never stdout-only).
 *
 * It is deliberately side-effect-free: no console, no I/O. The T-Lisp framework wraps it via
 * thin builtins; the CLI renders from it. Keeping the contract in one tested TS module means the
 * structured-output surface is stable and independently testable (see test/unit/trt-bootstrap.test.ts).
 */

import {
  createList,
  createNumber,
  createString,
  createBoolean,
  createSymbol,
  createNil,
} from "../values.ts";
import type { TLispValue } from "../types.ts";

/** A single test outcome. */
export interface TrtTestResult {
  name: string;
  passed: boolean;
  /** Present (and non-empty) only when the test failed. */
  error?: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Source file/suite this test came from, when known (for grouping/reporting). */
  file?: string;
}

/** Aggregate counts over a run. */
export interface TrtStats {
  passed: number;
  failed: number;
  total: number;
  /** Sum of per-test durations in ms. */
  durationMs: number;
}

/** A full run's structured result: aggregate stats plus per-test detail. */
export interface TrtRunResult {
  stats: TrtStats;
  tests: TrtTestResult[];
}

const emptyStats = (): TrtStats => ({ passed: 0, failed: 0, total: 0, durationMs: 0 });

class TrtResultStore {
  private results: TrtTestResult[] = [];

  /** Clear the store. Called at the start of every trt-run for isolation. */
  reset(): void {
    this.results = [];
  }

  /** Record one test outcome. */
  record(entry: TrtTestResult): void {
    this.results.push(entry);
  }

  /** Read-only snapshot of all recorded results. */
  getAll(): TrtTestResult[] {
    return [...this.results];
  }

  /** Compute aggregates from the recorded results. */
  getStats(): TrtStats {
    const stats = emptyStats();
    for (const r of this.results) {
      stats.total += 1;
      stats.durationMs += r.durationMs;
      if (r.passed) stats.passed += 1;
      else stats.failed += 1;
    }
    return stats;
  }

  /** Full structured result (stats + per-test detail). */
  getRunResult(): TrtRunResult {
    return { stats: this.getStats(), tests: this.getAll() };
  }
}

// Single shared store — matches the framework's existing module-global registry pattern.
const store = new TrtResultStore();

export function resetResultStore(): void {
  store.reset();
}

export function recordResult(entry: TrtTestResult): void {
  store.record(entry);
}

export function getResultStore(): TrtResultStore {
  return store;
}

/** Build a TrtTestResult for a passing test. */
export function passResult(name: string, durationMs: number, file?: string): TrtTestResult {
  return { name, passed: true, durationMs, file };
}

/** Build a TrtTestResult for a failing test. */
export function failResult(name: string, error: string, durationMs: number, file?: string): TrtTestResult {
  return { name, passed: false, error, durationMs, file };
}

/**
 * Serialize a run result to structured T-Lisp data:
 *   (trt-results
 *     (stats (passed . N) (failed . N) (total . N) (duration . N))
 *     (tests (name "..." passed t error "..." duration N) ...))
 *
 * Stats is an alist; tests is a list of property lists. The shape is stable and documented in
 * SPEC-049 as the AI-observable surface.
 */
export function toTLispValue(run: TrtRunResult): TLispValue {
  const statsAlist = createList([
    createCons(createString("passed"), createNumber(run.stats.passed)),
    createCons(createString("failed"), createNumber(run.stats.failed)),
    createCons(createString("total"), createNumber(run.stats.total)),
    createCons(createString("duration"), createNumber(run.stats.durationMs)),
  ]);

  const testPlists = run.tests.map((t) => {
    const entries: TLispValue[] = [
      createString("name"), createString(t.name),
      createString("passed"), createBoolean(t.passed),
      createString("duration"), createNumber(t.durationMs),
    ];
    if (t.file !== undefined) {
      entries.push(createString("file"), createString(t.file));
    }
    if (t.error !== undefined) {
      entries.push(createString("error"), createString(t.error));
    }
    return createList(entries);
  });

  return createList([
    createSymbol("trt-results"),
    createList([createSymbol("stats"), statsAlist]),
    createList([createSymbol("tests"), createList(testPlists)]),
  ]);
}

/** Serialize a run result to a JSON string (for `trt --json` / non-Lisp consumers). */
export function toJson(run: TrtRunResult): string {
  return JSON.stringify({
    stats: run.stats,
    tests: run.tests,
  });
}

/**
 * Convert the current store to the exit-code an agent/CI loops on:
 *   0 = all tests passed
 *   1 = one or more tests failed
 *   2 = no tests ran (runner / discovery error territory)
 */
export function runExitCode(run: TrtRunResult): number {
  if (run.stats.total === 0) return 2;
  return run.stats.failed === 0 ? 0 : 1;
}

// Local cons cell helper: represented as a 2-element list (name . value) for portability,
// since T-Lisp's hashmap/cons interop is fiddly and an alist of 2-lists is universally readable.
function createCons(car: TLispValue, cdr: TLispValue): TLispValue {
  return createList([car, cdr]);
}

/** Build an empty TrtRunResult (zeroed stats, no tests) — used by tests + empty-store handling. */
export function emptyRunResult(): TrtRunResult {
  return { stats: emptyStats(), tests: [] };
}

// Re-export createNil for callers that probe an empty store.
export { createNil };
