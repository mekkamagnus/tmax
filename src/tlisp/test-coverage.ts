/**
 * @file test-coverage.ts
 * @description Code coverage tracking for T-Lisp tests (US-0.6.6)
 *
 * This module implements code coverage metrics for T-Lisp testing framework.
 * It tracks which functions are called during test execution and generates
 * coverage reports with percentage, function-level details, and line coverage.
 */

// Type definition for coverage data
export interface FunctionCoverage {
  name: string;
  covered: boolean;
  callCount: number;
  lines?: {
    total: number;
    covered: number;
    uncovered: number[];
  };
  params?: any;
  sourceLocation?: string;
}

export interface CoverageReport {
  percentage: number;
  totalFunctions: number;
  coveredFunctions: number;
  functions: FunctionCoverage[];
  format: 'text' | 'json';
}

// Coverage state
let coverageEnabled = false;
let coverageThreshold = 80; // Default 80% threshold
let coverageFormat: 'text' | 'json' = 'text';

// Function tracking
interface FunctionInfo {
  name: string;
  callCount: number;
  covered: boolean;
  definedAt: string; // File/line info if available
  params?: any;
  isBuiltin: boolean; // Track if this is a builtin function
}

const functionRegistry = new Map<string, FunctionInfo>();
const coveredFunctions = new Set<string>();

// List of builtin/test-framework functions to exclude from coverage
const EXCLUDED_FUNCTIONS = new Set([
  'deftest',
  'test-run',
  'test-run-all',
  'test-run-suite',
  'list-suites',
  'assert-true',
  'assert-false',
  'assert-equal',
  'assert-not-equal',
  'assert-contains',
  'assert-contains-string',
  'assert-matches',
  'assert-type',
  'assert->=',
  'assert-<',
  'assert-in-delta',
  'assert-error',
  'setup',
  'teardown',
  'defvar',
  'set!',
  'deffixture',
  'use-fixtures',
  'set-output-mode',
  'set-verbosity',
  'set-color-mode',
  'set-progress-indicator',
  'set-async-timeout',
  'get-async-timeout',
  'async-all',
  'await',
  'assert-eventually',
  'coverage-enable',
  'coverage-percentage',
  'coverage-threshold',
  'get-coverage-threshold',
  'coverage-format',
  'coverage-report',
  'coverage-print',
  'coverage-reset',
  'coverage-enabled',
  'coverage-untested',
  'coverage-tested',
  'coverage-meets-threshold',
  // Add more test framework functions as needed
]);

/**
 * Reset coverage state (for testing or between test runs)
 */
export function resetCoverageState(): void {
  functionRegistry.clear();
  coveredFunctions.clear();
  coverageEnabled = false;
  coverageThreshold = 80;
  coverageFormat = 'text';
}

/**
 * Enable or disable coverage tracking
 * @param enabled - Whether to enable coverage tracking
 */
export function setCoverageEnabled(enabled: boolean): void {
  coverageEnabled = enabled;
}

/**
 * Check if coverage is enabled
 */
export function isCoverageEnabled(): boolean {
  return coverageEnabled;
}

/**
 * Set coverage threshold percentage
 * @param threshold - Coverage threshold (0-100)
 */
export function setCoverageThreshold(threshold: number): void {
  if (threshold < 0 || threshold > 100) {
    throw new Error(`Coverage threshold must be between 0 and 100, got ${threshold}`);
  }
  coverageThreshold = threshold;
}

/**
 * Get current coverage threshold
 */
export function getCoverageThreshold(): number {
  return coverageThreshold;
}

/**
 * Set coverage report format
 * @param format - Output format ('text' or 'json')
 */
export function setCoverageFormat(format: 'text' | 'json'): void {
  coverageFormat = format;
}

/**
 * Get current coverage format
 */
export function getCoverageFormat(): 'text' | 'json' {
  return coverageFormat;
}

/**
 * Register a function for coverage tracking
 * Called when a function is defined in T-Lisp
 * @param name - Function name
 * @param params - Function parameters
 * @param sourceLocation - Where the function was defined (optional)
 * @param isBuiltin - Whether this is a builtin function (optional)
 */
export function registerFunction(name: string, params?: any, sourceLocation?: string, isBuiltin: boolean = false): void {
  if (!coverageEnabled) {
    return;
  }

  if (!functionRegistry.has(name)) {
    functionRegistry.set(name, {
      name,
      callCount: 0,
      covered: false,
      definedAt: sourceLocation || 'unknown',
      params,
      isBuiltin
    });
  }
}

/**
 * Mark a function as covered (called during test execution)
 * @param name - Function name
 */
export function markFunctionCovered(name: string): void {
  if (!coverageEnabled) {
    return;
  }

  coveredFunctions.add(name);

  const funcInfo = functionRegistry.get(name);
  if (funcInfo) {
    funcInfo.callCount++;
    funcInfo.covered = true;
  } else {
    // Function wasn't pre-registered, add it now
    functionRegistry.set(name, {
      name,
      callCount: 1,
      covered: true,
      definedAt: 'unknown'
    });
  }
}

/**
 * Check if a function has been covered
 * @param name - Function name
 */
export function isFunctionCovered(name: string): boolean {
  return coveredFunctions.has(name);
}

/**
 * Get coverage percentage
 * @returns Coverage percentage (0-100)
 */
export function getCoveragePercentage(): number {
  if (functionRegistry.size === 0) {
    return 0;
  }

  const covered = Array.from(functionRegistry.values()).filter(f => f.covered).length;
  return Math.round((covered / functionRegistry.size) * 100);
}

/**
 * Check if coverage meets the configured threshold
 * @returns true if coverage >= threshold, false otherwise
 */
export function meetsCoverageThreshold(): boolean {
  const coverage = getCoveragePercentage();
  return coverage >= coverageThreshold;
}

/**
 * Get coverage report with function-level details
 * @returns Coverage report with percentage and function details
 */
export function getCoverageReport(): CoverageReport {
  // Filter out excluded functions (builtins, test framework)
  const userFunctions = Array.from(functionRegistry.values())
    .filter(f => !f.isBuiltin && !EXCLUDED_FUNCTIONS.has(f.name));

  const functions = userFunctions.map(funcInfo => ({
    name: funcInfo.name,
    covered: funcInfo.covered,
    callCount: funcInfo.callCount,
    params: funcInfo.params,
    sourceLocation: funcInfo.definedAt,
    // Line coverage is not fully implemented yet
    // Would require source mapping and execution tracking
    lines: {
      total: 1, // Placeholder
      covered: funcInfo.covered ? 1 : 0,
      uncovered: funcInfo.covered ? [] : [1]
    }
  }));

  const totalFunctions = functions.length;
  const coveredFunctions = functions.filter(f => f.covered).length;
  const percentage = totalFunctions > 0
    ? Math.round((coveredFunctions / totalFunctions) * 100)
    : 0;

  return {
    percentage,
    totalFunctions,
    coveredFunctions,
    functions,
    format: coverageFormat
  };
}

/**
 * Get list of untested functions
 * @returns Array of function names that haven't been covered
 */
export function getUntestedFunctions(): string[] {
  return Array.from(functionRegistry.values())
    .filter(f => !f.covered)
    .map(f => f.name);
}

/**
 * Get list of tested functions
 * @returns Array of function names that have been covered
 */
export function getTestedFunctions(): string[] {
  return Array.from(coveredFunctions);
}

/**
 * Format coverage report as text
 * @param report - Coverage report
 * @returns Formatted text output
 */
export function formatCoverageReport(report: CoverageReport): string {
  const lines: string[] = [];

  lines.push(`Coverage: ${report.percentage}%`);
  lines.push(`Functions: ${report.coveredFunctions}/${report.totalFunctions} covered`);
  lines.push('');

  if (report.functions.length === 0) {
    lines.push('No functions found in codebase.');
    return lines.join('\n');
  }

  // Group functions by coverage status
  const covered = report.functions.filter(f => f.covered);
  const uncovered = report.functions.filter(f => !f.covered);

  if (covered.length > 0) {
    lines.push('Covered Functions:');
    for (const func of covered) {
      lines.push(`  ✓ ${func.name} (${func.callCount} call${func.callCount !== 1 ? 's' : ''})`);
    }
    lines.push('');
  }

  if (uncovered.length > 0) {
    lines.push('Untested Functions:');
    for (const func of uncovered) {
      lines.push(`  ✗ ${func.name}`);
    }
  }

  // Coverage threshold warning
  if (report.percentage < coverageThreshold) {
    lines.push('');
    lines.push(`⚠️  Coverage (${report.percentage}%) is below threshold (${coverageThreshold}%)`);
  } else {
    lines.push('');
    lines.push(`✓ Coverage (${report.percentage}%) meets threshold (${coverageThreshold}%)`);
  }

  return lines.join('\n');
}

/**
 * Format coverage report as JSON
 * @param report - Coverage report
 * @returns JSON string
 */
export function formatCoverageReportJSON(report: CoverageReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Generate and format coverage report based on current format setting
 * @returns Formatted coverage report (text or JSON)
 */
export function generateCoverageReport(): string {
  const report = getCoverageReport();

  if (coverageFormat === 'json') {
    return formatCoverageReportJSON(report);
  } else {
    return formatCoverageReport(report);
  }
}

/**
 * Print coverage report to console
 */
export function printCoverageReport(): void {
  const report = generateCoverageReport();
  console.log(report);
}

/**
 * Get coverage summary for test output
 * @returns Brief summary string
 */
export function getCoverageSummary(): string {
  const percentage = getCoveragePercentage();
  const threshold = coverageThreshold;

  if (percentage < threshold) {
    return `Coverage: ${percentage}% (below threshold of ${threshold}%)`;
  } else {
    return `Coverage: ${percentage}% (meets threshold of ${threshold}%)`;
  }
}

/**
 * Exit with error code if coverage below threshold
 * Useful for CI/CD integration
 * @returns Exit code (0 for success, 1 for failure)
 */
export function checkCoverageThreshold(): number {
  if (meetsCoverageThreshold()) {
    return 0;
  } else {
    console.error(`Coverage (${getCoveragePercentage()}%) is below threshold (${coverageThreshold}%)`);
    return 1;
  }
}
