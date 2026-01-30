/**
 * @file error-manager.ts
 * @description Centralized error management system with context preservation and AI-friendly reporting
 */

import { Either } from "./task-either.ts";
import { logger, LogContext } from "./logger.ts";
import { MAX_ERROR_HISTORY_SIZE } from "../constants/editor.ts";

/**
 * Error categories for classification
 */
export enum ErrorCategory {
  VALIDATION = "validation",
  IO = "io",
  PARSING = "parsing",
  RUNTIME = "runtime",
  CONFIGURATION = "configuration",
  NETWORK = "network",
  PERMISSION = "permission",
  USER_INPUT = "user_input",
  INTERNAL = "internal"
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical"
}

/**
 * Enhanced error context for detailed debugging
 */
export interface ErrorContext extends LogContext {
  /** Error category */
  category?: ErrorCategory;
  /** Error severity */
  severity?: ErrorSeverity;
  /** User-facing message */
  userMessage?: string;
  /** Recovery suggestions */
  suggestions?: string[];
  /** Related error codes */
  code?: string;
  /** Input that caused the error */
  input?: unknown;
  /** Expected vs actual values */
  expected?: unknown;
  actual?: unknown;
}

/**
 * Enhanced error class with rich context
 */
export class TmaxError extends Error {
  public readonly context: ErrorContext;
  public readonly timestamp: Date;
  public readonly correlationId: string;

  constructor(
    message: string,
    context: ErrorContext = {},
    cause?: Error
  ) {
    super(message);
    this.name = "TmaxError";
    this.context = context;
    this.timestamp = new Date();
    this.correlationId = logger.generateCorrelationId();

    if (cause) {
      this.cause = cause;
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }

    // Log the error creation
    logger.error(
      `TmaxError created: ${message}`,
      this,
      context,
      { 
        category: context.category,
        severity: context.severity,
        userMessage: context.userMessage
      }
    );
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(): string {
    return this.context.userMessage || this.message;
  }

  /**
   * Get recovery suggestions
   */
  getSuggestions(): string[] {
    return this.context.suggestions || [];
  }

  /**
   * Convert to AI-friendly format
   */
  toAIFormat(): string {
    const lines = [
      "🚨 TMAX ERROR REPORT",
      `📝 Message: ${this.message}`,
      `🏷️  Category: ${this.context.category || 'unknown'}`,
      `⚠️  Severity: ${this.context.severity || 'unknown'}`,
      `🆔 Correlation ID: ${this.correlationId}`,
      `⏰ Timestamp: ${this.timestamp.toISOString()}`
    ];

    if (this.context.module) {
      lines.push(`📦 Module: ${this.context.module}`);
    }

    if (this.context.function) {
      lines.push(`⚡ Function: ${this.context.function}`);
    }

    if (this.context.operation) {
      lines.push(`🔧 Operation: ${this.context.operation}`);
    }

    if (this.context.userMessage) {
      lines.push(`👤 User Message: ${this.context.userMessage}`);
    }

    if (this.context.code) {
      lines.push(`🔢 Error Code: ${this.context.code}`);
    }

    if (this.context.input !== undefined) {
      lines.push(`📥 Input: ${JSON.stringify(this.context.input, null, 2)}`);
    }

    if (this.context.expected !== undefined) {
      lines.push(`✅ Expected: ${JSON.stringify(this.context.expected, null, 2)}`);
    }

    if (this.context.actual !== undefined) {
      lines.push(`❌ Actual: ${JSON.stringify(this.context.actual, null, 2)}`);
    }

    if (this.context.suggestions && this.context.suggestions.length > 0) {
      lines.push("💡 Suggestions:");
      this.context.suggestions.forEach((suggestion, i) => {
        lines.push(`   ${i + 1}. ${suggestion}`);
      });
    }

    if (this.context.metadata) {
      lines.push(`📋 Metadata: ${JSON.stringify(this.context.metadata, null, 2)}`);
    }

    if (this.stack) {
      lines.push(`📍 Stack Trace:`);
      lines.push(this.stack);
    }

    return lines.join('\n') + '\n' + '═'.repeat(80);
  }
}

/**
 * Centralized error manager
 */
export class ErrorManager {
  private static instance: ErrorManager;
  private errorHistory: TmaxError[] = [];
  private maxHistorySize = MAX_ERROR_HISTORY_SIZE;

  private constructor() {}

  static getInstance(): ErrorManager {
    if (!ErrorManager.instance) {
      ErrorManager.instance = new ErrorManager();
    }
    return ErrorManager.instance;
  }

  /**
   * Create a new TmaxError with context
   */
  createError(
    message: string,
    context: ErrorContext = {},
    cause?: Error
  ): TmaxError {
    const error = new TmaxError(message, context, cause);
    this.recordError(error);
    return error;
  }

  /**
   * Record an error in history
   */
  private recordError(error: TmaxError): void {
    this.errorHistory.push(error);
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }
  }

  /**
   * Get error history
   */
  getErrorHistory(): TmaxError[] {
    return [...this.errorHistory];
  }

  /**
   * Get recent errors by category
   */
  getRecentErrorsByCategory(category: ErrorCategory, limit = 10): TmaxError[] {
    return this.errorHistory
      .filter(error => error.context.category === category)
      .slice(-limit);
  }

  /**
   * Get error statistics
   */
  getErrorStats(): {
    total: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
    recentCount: number;
  } {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000); // 1 hour in milliseconds

    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let recentCount = 0;

    this.errorHistory.forEach(error => {
      // Count by category
      const category = error.context.category || 'unknown';
      byCategory[category] = (byCategory[category] || 0) + 1;

      // Count by severity
      const severity = error.context.severity || 'unknown';
      bySeverity[severity] = (bySeverity[severity] || 0) + 1;

      // Count recent errors
      if (error.timestamp.getTime() > oneHourAgo) {
        recentCount++;
      }
    });

    return {
      total: this.errorHistory.length,
      byCategory,
      bySeverity,
      recentCount
    };
  }

  /**
   * Clear error history
   */
  clearHistory(): void {
    this.errorHistory = [];
    logger.info("Error history cleared", { module: "ErrorManager" });
  }

  /**
   * Generate comprehensive error report for AI analysis
   */
  generateAIReport(): string {
    const stats = this.getErrorStats();
    const recentErrors = this.errorHistory.slice(-10);

    const lines = [
      "🔍 TMAX ERROR ANALYSIS REPORT",
      `📊 Total Errors: ${stats.total}`,
      `⏰ Recent (1h): ${stats.recentCount}`,
      "",
      "📈 BY CATEGORY:",
    ];

    Object.entries(stats.byCategory).forEach(([category, count]) => {
      lines.push(`   ${category}: ${count}`);
    });

    lines.push("", "⚠️  BY SEVERITY:");
    Object.entries(stats.bySeverity).forEach(([severity, count]) => {
      lines.push(`   ${severity}: ${count}`);
    });

    if (recentErrors.length > 0) {
      lines.push("", "🕐 RECENT ERRORS:");
      recentErrors.forEach((error, i) => {
        lines.push(`${i + 1}. [${error.context.category || 'unknown'}] ${error.message}`);
        lines.push(`   Time: ${error.timestamp.toISOString()}`);
        lines.push(`   Module: ${error.context.module || 'unknown'}`);
        if (error.context.suggestions && error.context.suggestions.length > 0) {
          lines.push(`   Suggestion: ${error.context.suggestions[0]}`);
        }
        lines.push("");
      });
    }

    return lines.join('\n');
  }
}

/**
 * Error factory functions for common error types
 */
export const ErrorFactory = {
  /**
   * Validation error
   */
  validation: (
    message: string,
    field?: string,
    input?: unknown,
    expected?: unknown,
    context: Partial<ErrorContext> = {}
  ): TmaxError => {
    return errorManager.createError(message, {
      category: ErrorCategory.VALIDATION,
      severity: ErrorSeverity.MEDIUM,
      userMessage: `Invalid ${field || 'input'}: ${message}`,
      suggestions: [
        `Check the ${field || 'input'} format`,
        "Refer to the documentation for valid values"
      ],
      input,
      expected,
      ...context
    });
  },

  /**
   * Parsing error
   */
  parsing: (
    message: string,
    input?: string,
    position?: number,
    context: Partial<ErrorContext> = {}
  ): TmaxError => {
    return errorManager.createError(message, {
      category: ErrorCategory.PARSING,
      severity: ErrorSeverity.HIGH,
      userMessage: `Syntax error: ${message}`,
      suggestions: [
        "Check syntax and formatting",
        "Look for missing or extra parentheses, quotes, or brackets"
      ],
      input,
      metadata: position !== undefined ? { position } : undefined,
      ...context
    });
  },

  /**
   * IO error
   */
  io: (
    message: string,
    path?: string,
    operation?: string,
    cause?: Error,
    context: Partial<ErrorContext> = {}
  ): TmaxError => {
    return errorManager.createError(message, {
      category: ErrorCategory.IO,
      severity: ErrorSeverity.HIGH,
      userMessage: `File operation failed: ${message}`,
      suggestions: [
        "Check file permissions",
        "Ensure the file or directory exists",
        "Check available disk space"
      ],
      metadata: { path, operation },
      ...context
    }, cause);
  },

  /**
   * Runtime error
   */
  runtime: (
    message: string,
    operation?: string,
    cause?: Error,
    context: Partial<ErrorContext> = {}
  ): TmaxError => {
    return errorManager.createError(message, {
      category: ErrorCategory.RUNTIME,
      severity: ErrorSeverity.HIGH,
      userMessage: `Runtime error: ${message}`,
      suggestions: [
        "Check the current state of the application",
        "Try restarting the operation",
        "Report this issue if it persists"
      ],
      operation,
      ...context
    }, cause);
  },

  /**
   * User input error
   */
  userInput: (
    message: string,
    input?: unknown,
    suggestions: string[] = [],
    context: Partial<ErrorContext> = {}
  ): TmaxError => {
    return errorManager.createError(message, {
      category: ErrorCategory.USER_INPUT,
      severity: ErrorSeverity.LOW,
      userMessage: message,
      suggestions: suggestions.length > 0 ? suggestions : [
        "Check your input and try again",
        "Use the help command for guidance"
      ],
      input,
      ...context
    });
  }
};

/**
 * Global error manager instance
 */
export const errorManager = ErrorManager.getInstance();

/**
 * Utility functions for working with Either and errors
 */
export const ErrorUtils = {
  /**
   * Convert a throwing function to Either
   */
  tryCatch: <T>(fn: () => T, context?: ErrorContext): Either<TmaxError, T> => {
    try {
      const result = fn();
      return Either.right(result);
    } catch (error) {
      const tmaxError = error instanceof TmaxError 
        ? error 
        : errorManager.createError(
            error instanceof Error ? error.message : String(error),
            context,
            error instanceof Error ? error : undefined
          );
      return Either.left(tmaxError);
    }
  },

  /**
   * Convert a Promise to TaskEither with error handling
   */
  fromPromise: async <T>(
    promise: Promise<T>, 
    context?: ErrorContext
  ): Promise<Either<TmaxError, T>> => {
    try {
      const result = await promise;
      return Either.right(result);
    } catch (error) {
      const tmaxError = error instanceof TmaxError 
        ? error 
        : errorManager.createError(
            error instanceof Error ? error.message : String(error),
            context,
            error instanceof Error ? error : undefined
          );
      return Either.left(tmaxError);
    }
  },

  /**
   * Throw an Either.Left as an error
   */
  throwLeft: <T>(either: Either<TmaxError, T>): T => {
    if (Either.isLeft(either)) {
      throw either.left;
    }
    return either.right;
  },

  /**
   * Log and return an error
   */
  logAndReturn: <T>(either: Either<TmaxError, T>): Either<TmaxError, T> => {
    if (Either.isLeft(either)) {
      logger.error(
        "Operation failed",
        either.left,
        either.left.context
      );
    }
    return either;
  }
};