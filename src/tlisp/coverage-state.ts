/**
 * @file coverage-state.ts
 * @description CHORE-44 Change 4 AC4.8 — per-instance T-Lisp coverage state.
 *
 * Before this module, all coverage state lived as MODULE-GLOBAL mutables in
 * `test-coverage.ts` (`coverageEnabled`, `coverageThreshold`, `coverageFormat`,
 * `functionRegistry`, `coveredFunctions`). Two concurrently-running
 * `TLispEvaluator` instances shared the same coverage state — enabling
 * coverage in one inflated the other's percentage, and registering a
 * function in one appeared in the other's report. AC4.8 requires each
 * evaluator to own its own state.
 *
 * `CoverageState` is the per-instance state object. Each `TLispEvaluator`
 * holds a `readonly coverage: CoverageState` field and routes its coverage
 * calls through it. The T-Lisp `coverage-*` / `trt-coverage-*` bridge
 * builtins (registered in `trt/bootstrap.ts`) reach the active evaluator's
 * state via the interpreter (see `bootstrap.ts` for the thread-through).
 *
 * `test-coverage.ts` is preserved as a compatibility shim: its exported
 * functions now operate on a single shared default instance so existing
 * external callers (e.g. `basic-coverage.test.ts`) keep working. Production
 * callers go through the evaluator's per-instance state.
 */

export interface FunctionCoverage {
  name: string;
  covered: boolean;
  callCount: number;
  lines?: {
    total: number;
    covered: number;
    uncovered: number[];
  };
  params?: unknown;
  sourceLocation?: string;
}

export interface CoverageReport {
  percentage: number;
  totalFunctions: number;
  coveredFunctions: number;
  functions: FunctionCoverage[];
  format: 'text' | 'json';
}

/** Function-tracking record (internal). */
interface FunctionInfo {
  name: string;
  callCount: number;
  covered: boolean;
  definedAt: string;
  params?: unknown;
  isBuiltin: boolean;
}

// List of builtin/test-framework functions to exclude from coverage.
// (MOVED from test-coverage.ts — unchanged.)
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
]);

/**
 * Per-instance coverage state. MOVED from the module-globals of
 * `test-coverage.ts`. The methods preserve the EXACT behavior of the former
 * module functions (same thresholds, same report shape, same message text).
 */
export class CoverageState {
  private enabled = false;
  private threshold = 80; // Default 80% threshold (preserved).
  private format: 'text' | 'json' = 'text';
  private functionRegistry = new Map<string, FunctionInfo>();
  private coveredFunctions = new Set<string>();

  /** Reset coverage state (for testing or between test runs). */
  reset(): void {
    this.functionRegistry.clear();
    this.coveredFunctions.clear();
    this.enabled = false;
    this.threshold = 80;
    this.format = 'text';
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setThreshold(value: number): void {
    if (value < 0 || value > 100) {
      throw new Error(`Coverage threshold must be between 0 and 100, got ${value}`);
    }
    this.threshold = value;
  }

  getThreshold(): number {
    return this.threshold;
  }

  setFormat(format: 'text' | 'json'): void {
    this.format = format;
  }

  getFormat(): 'text' | 'json' {
    return this.format;
  }

  registerFunction(name: string, params?: unknown, sourceLocation?: string, isBuiltin: boolean = false): void {
    if (!this.enabled) return;
    if (!this.functionRegistry.has(name)) {
      this.functionRegistry.set(name, {
        name,
        callCount: 0,
        covered: false,
        definedAt: sourceLocation || 'unknown',
        params,
        isBuiltin,
      });
    }
  }

  markFunctionCovered(name: string): void {
    if (!this.enabled) return;
    this.coveredFunctions.add(name);
    const funcInfo = this.functionRegistry.get(name);
    if (funcInfo) {
      funcInfo.callCount++;
      funcInfo.covered = true;
    } else {
      this.functionRegistry.set(name, {
        name,
        callCount: 1,
        covered: true,
        definedAt: 'unknown',
        isBuiltin: false,
      });
    }
  }

  isFunctionCovered(name: string): boolean {
    return this.coveredFunctions.has(name);
  }

  getPercentage(): number {
    if (this.functionRegistry.size === 0) return 0;
    const covered = Array.from(this.functionRegistry.values()).filter(f => f.covered).length;
    return Math.round((covered / this.functionRegistry.size) * 100);
  }

  meetsThreshold(): boolean {
    return this.getPercentage() >= this.threshold;
  }

  getReport(): CoverageReport {
    const userFunctions = Array.from(this.functionRegistry.values())
      .filter(f => !f.isBuiltin && !EXCLUDED_FUNCTIONS.has(f.name));

    const functions = userFunctions.map(funcInfo => ({
      name: funcInfo.name,
      covered: funcInfo.covered,
      callCount: funcInfo.callCount,
      params: funcInfo.params,
      sourceLocation: funcInfo.definedAt,
      lines: {
        total: 1,
        covered: funcInfo.covered ? 1 : 0,
        uncovered: funcInfo.covered ? [] : [1],
      },
    }));

    const totalFunctions = functions.length;
    const coveredFunctionsCount = functions.filter(f => f.covered).length;
    const percentage = totalFunctions > 0
      ? Math.round((coveredFunctionsCount / totalFunctions) * 100)
      : 0;

    return {
      percentage,
      totalFunctions,
      coveredFunctions: coveredFunctionsCount,
      functions,
      format: this.format,
    };
  }

  getUntestedFunctions(): string[] {
    return Array.from(this.functionRegistry.values())
      .filter(f => !f.covered)
      .map(f => f.name);
  }

  getTestedFunctions(): string[] {
    return Array.from(this.coveredFunctions);
  }

  formatReport(report: CoverageReport): string {
    const lines: string[] = [];
    lines.push(`Coverage: ${report.percentage}%`);
    lines.push(`Functions: ${report.coveredFunctions}/${report.totalFunctions} covered`);
    lines.push('');

    if (report.functions.length === 0) {
      lines.push('No functions found in codebase.');
      return lines.join('\n');
    }

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

    if (report.percentage < this.threshold) {
      lines.push('');
      lines.push(`⚠️  Coverage (${report.percentage}%) is below threshold (${this.threshold}%)`);
    } else {
      lines.push('');
      lines.push(`✓ Coverage (${report.percentage}%) meets threshold (${this.threshold}%)`);
    }

    return lines.join('\n');
  }

  formatReportJSON(report: CoverageReport): string {
    return JSON.stringify(report, null, 2);
  }

  generateReport(): string {
    const report = this.getReport();
    if (this.format === 'json') {
      return this.formatReportJSON(report);
    }
    return this.formatReport(report);
  }

  getSummary(): string {
    const percentage = this.getPercentage();
    const threshold = this.threshold;
    if (percentage < threshold) {
      return `Coverage: ${percentage}% (below threshold of ${threshold}%)`;
    }
    return `Coverage: ${percentage}% (meets threshold of ${threshold}%)`;
  }

  checkThreshold(): number {
    if (this.meetsThreshold()) return 0;
    console.error(`Coverage (${this.getPercentage()}%) is below threshold (${this.threshold}%)`);
    return 1;
  }
}
