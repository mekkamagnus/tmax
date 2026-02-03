/**
 * @file test-output.ts
 * @description Test Output Formatting System for T-Lisp Testing Framework
 *
 * This module provides colored output, progress indicators, and summary statistics
 * for the T-Lisp testing framework (US-0.6.5: Better CLI Output).
 */

// ANSI color codes
const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
  bright: "\x1b[1m",
};

// Symbols for test results
const SYMBOLS = {
  pass: "✔",
  fail: "✘",
  skip: "⊝",
  dot: "·",
};

/**
 * Output mode configuration
 */
export type OutputMode = "normal" | "verbose" | "quiet" | "plain";

/**
 * Color mode configuration
 */
export type ColorMode = "auto" | "always" | "never";

/**
 * Test result information
 */
export interface TestResult {
  testName: string;
  passed: boolean;
  error?: string;
  file?: string;
  line?: number;
  duration?: number;
}

/**
 * Test run statistics
 */
export interface TestStats {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;
}

/**
 * Output configuration
 */
export interface OutputConfig {
  mode: OutputMode;
  colorMode: ColorMode;
  showProgress: boolean;
  ttyCheck: () => boolean;
}

/**
 * Default output configuration
 */
const defaultConfig: OutputConfig = {
  mode: "normal",
  colorMode: "auto",
  showProgress: true,
  ttyCheck: () => process.stdout.isTTY,
};

/**
 * Current output configuration
 */
let currentConfig: OutputConfig = { ...defaultConfig };

/**
 * Check if colors should be used
 */
function shouldUseColors(): boolean {
  switch (currentConfig.colorMode) {
    case "always":
      return true;
    case "never":
      return false;
    case "auto":
    default:
      return currentConfig.ttyCheck();
  }
}

/**
 * Apply color to text if colors are enabled
 */
export function colorize(text: string, color: keyof typeof COLORS): string {
  if (!shouldUseColors()) {
    return text;
  }
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

/**
 * Format a test result for output
 */
export function formatTestResult(result: TestResult): string {
  const { testName, passed, error, file, line, duration } = result;

  // In quiet mode, don't show individual results
  if (currentConfig.mode === "quiet") {
    return "";
  }

  // Build the output line
  let output = "";

  if (passed) {
    const symbol = colorize(SYMBOLS.pass, "green");
    output += `${symbol} ${colorize(testName, "green")}`;

    if (duration !== undefined && currentConfig.mode === "verbose") {
      const timeStr = `${duration}ms`;
      output += ` ${colorize(`(${timeStr})`, "dim")}`;
    }
  } else {
    const symbol = colorize(SYMBOLS.fail, "red");
    output += `${symbol} ${colorize(testName, "red")}`;

    if (file) {
      output += ` ${colorize(`${file}:${line || 0}`, "dim")}`;
    }

    if (error && currentConfig.mode !== "quiet") {
      output += `\n    ${colorize(error, "dim")}`;
    }
  }

  return output;
}

/**
 * Format progress indicator
 */
export function formatProgress(current: number, total: number): string {
  if (!currentConfig.showProgress || currentConfig.mode === "quiet") {
    return "";
  }

  const percentage = Math.round((current / total) * 100);
  const progressBar = "█".repeat(Math.floor(percentage / 5)) + "░".repeat(20 - Math.floor(percentage / 5));
  const counter = `${current}/${total}`;

  return `\r${colorize("Running tests...", "blue")} [${progressBar}] ${counter} (${percentage}%)`;
}

/**
 * Format test summary statistics
 */
export function formatSummary(stats: TestStats): string {
  const { passed, failed, skipped, total, duration } = stats;

  let summary = "";

  // Build summary line
  if (failed > 0) {
    summary += colorize(`${failed} failed`, "red");
  } else {
    summary += colorize(`${failed} failed`, "green");
  }

  summary += ", ";

  if (passed > 0) {
    summary += colorize(`${passed} passed`, "green");
  } else {
    summary += `${passed} passed`;
  }

  if (skipped > 0) {
    summary += `, ${colorize(`${skipped} skipped`, "yellow")}`;
  }

  summary += `, ${total} total`;

  // Add duration
  const durationStr = duration < 1000
    ? `${Math.round(duration)}ms`
    : `${(duration / 1000).toFixed(2)}s`;

  summary += ` ${colorize(`(${durationStr})`, "dim")}`;

  // Add pass/fail indicator for overall result
  if (failed === 0 && passed > 0) {
    summary += ` ${colorize("✓ All tests passed!", "green")}`;
  } else if (failed > 0) {
    summary += ` ${colorize("✘ Some tests failed", "red")}`;
  }

  return summary;
}

/**
 * Format failing test output section
 */
export function formatFailingTests(results: TestResult[]): string {
  const failures = results.filter(r => !r.passed);

  if (failures.length === 0 || currentConfig.mode === "quiet") {
    return "";
  }

  let output = "\n\n" + colorize("Failing tests:", "red") + "\n";

  for (const result of failures) {
    output += `\n${formatTestResult(result)}`;
  }

  return output;
}

/**
 * Set output mode
 */
export function setOutputMode(mode: OutputMode): void {
  currentConfig.mode = mode;
}

/**
 * Set color mode
 */
export function setColorMode(mode: ColorMode): void {
  currentConfig.colorMode = mode;
}

/**
 * Set progress display
 */
export function setShowProgress(show: boolean): void {
  currentConfig.showProgress = show;
}

/**
 * Reset output configuration to defaults
 */
export function resetOutputConfig(): void {
  currentConfig = { ...defaultConfig };
}

/**
 * Get current output configuration
 */
export function getOutputConfig(): OutputConfig {
  return { ...currentConfig };
}
