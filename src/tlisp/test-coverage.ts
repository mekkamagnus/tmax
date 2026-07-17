/**
 * @file test-coverage.ts
 * @description CHORE-44 Change 4 AC4.8 — compatibility shim.
 *
 * The canonical coverage state now lives in `coverage-state.ts` as a
 * per-instance `CoverageState` class owned by each `TLispEvaluator`. This
 * file preserves the historical module-level function exports so external
 * callers that have not yet been threaded through an evaluator keep working
 * (notably `basic-coverage.test.ts`). Production callers should reach the
 * active evaluator's `CoverageState` instead.
 *
 * The shim operates on a single default instance. It is NOT shared with any
 * evaluator — the evaluators each hold their own `CoverageState`. The
 * default instance exists solely for these legacy external callers.
 */

export type { FunctionCoverage, CoverageReport } from "./coverage-state.ts";
import { CoverageState } from "./coverage-state.ts";

const defaultState = new CoverageState();

/** Reset coverage state (for testing or between test runs). */
export function resetCoverageState(): void {
  defaultState.reset();
}

/** Enable or disable coverage tracking. */
export function setCoverageEnabled(enabled: boolean): void {
  defaultState.setEnabled(enabled);
}

/** Check if coverage is enabled. */
export function isCoverageEnabled(): boolean {
  return defaultState.isEnabled();
}

/** Set coverage threshold percentage (0-100). */
export function setCoverageThreshold(threshold: number): void {
  defaultState.setThreshold(threshold);
}

/** Get current coverage threshold. */
export function getCoverageThreshold(): number {
  return defaultState.getThreshold();
}

/** Set coverage report format ('text' or 'json'). */
export function setCoverageFormat(format: 'text' | 'json'): void {
  defaultState.setFormat(format);
}

/** Get current coverage format. */
export function getCoverageFormat(): 'text' | 'json' {
  return defaultState.getFormat();
}

/** Register a function for coverage tracking. */
export function registerFunction(name: string, params?: unknown, sourceLocation?: string, isBuiltin: boolean = false): void {
  defaultState.registerFunction(name, params, sourceLocation, isBuiltin);
}

/** Mark a function as covered (called during test execution). */
export function markFunctionCovered(name: string): void {
  defaultState.markFunctionCovered(name);
}

/** Check if a function has been covered. */
export function isFunctionCovered(name: string): boolean {
  return defaultState.isFunctionCovered(name);
}

/** Get coverage percentage (0-100). */
export function getCoveragePercentage(): number {
  return defaultState.getPercentage();
}

/** Check if coverage meets the configured threshold. */
export function meetsCoverageThreshold(): boolean {
  return defaultState.meetsThreshold();
}

/** Get coverage report with function-level details. */
export function getCoverageReport(): import("./coverage-state.ts").CoverageReport {
  return defaultState.getReport();
}

/** Get list of untested function names. */
export function getUntestedFunctions(): string[] {
  return defaultState.getUntestedFunctions();
}

/** Get list of tested function names. */
export function getTestedFunctions(): string[] {
  return defaultState.getTestedFunctions();
}

/** Format coverage report as text. */
export function formatCoverageReport(report: import("./coverage-state.ts").CoverageReport): string {
  return defaultState.formatReport(report);
}

/** Format coverage report as JSON. */
export function formatCoverageReportJSON(report: import("./coverage-state.ts").CoverageReport): string {
  return defaultState.formatReportJSON(report);
}

/** Generate and format coverage report based on current format setting. */
export function generateCoverageReport(): string {
  return defaultState.generateReport();
}

/** Print coverage report to console. */
export function printCoverageReport(): void {
  console.log(defaultState.generateReport());
}

/** Get coverage summary string for test output. */
export function getCoverageSummary(): string {
  return defaultState.getSummary();
}

/** Exit with error code if coverage below threshold (0 success / 1 failure). */
export function checkCoverageThreshold(): number {
  return defaultState.checkThreshold();
}
