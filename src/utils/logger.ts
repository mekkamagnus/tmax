/**
 * @file logger.ts
 * @description Centralized logging system optimized for AI development and troubleshooting
 */

import { Either } from "./task-either.ts";

/**
 * Log levels for structured logging
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4
}

/**
 * Context information for enhanced debugging
 */
export interface LogContext {
  /** Source module or component */
  module?: string;
  /** Function or method name */
  function?: string;
  /** Operation being performed */
  operation?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Stack trace */
  stack?: string;
  /** Timestamp */
  timestamp?: Date;
  /** Correlation ID for tracing */
  correlationId?: string;
}

/**
 * Structured log entry for AI-friendly analysis
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  context: LogContext;
  error?: Error;
  data?: unknown;
}

/**
 * Configuration for the logging system
 */
export interface LoggerConfig {
  /** Minimum log level to output */
  level: LogLevel;
  /** Enable structured JSON output */
  structured: boolean;
  /** Include stack traces */
  includeStack: boolean;
  /** Enable AI-friendly formatting */
  aiFriendly: boolean;
  /** Output file path (optional) */
  outputFile?: string;
}

/**
 * Centralized logger optimized for AI development
 */
export class Logger {
  private static instance: Logger;
  private config: LoggerConfig;
  private correlationIdCounter = 0;

  private constructor(config: LoggerConfig = {
    level: LogLevel.INFO,
    structured: true,
    includeStack: true,
    aiFriendly: true
  }) {
    this.config = config;
  }

  /**
   * Get singleton logger instance
   */
  static getInstance(config?: LoggerConfig): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(config);
    }
    return Logger.instance;
  }

  /**
   * Generate unique correlation ID for tracing
   */
  generateCorrelationId(): string {
    return `tmax-${Date.now()}-${++this.correlationIdCounter}`;
  }

  /**
   * Create base log context with caller information
   */
  private createContext(context: Partial<LogContext> = {}): LogContext {
    const stack = this.config.includeStack ? new Error().stack : undefined;
    
    return {
      timestamp: new Date(),
      correlationId: this.generateCorrelationId(),
      stack: stack?.split('\n').slice(3).join('\n'), // Remove logger internal calls
      ...context
    };
  }

  /**
   * Format log entry for output
   */
  private formatEntry(entry: LogEntry): string {
    const levelName = LogLevel[entry.level];
    const timestamp = entry.context.timestamp?.toISOString() || new Date().toISOString();

    if (this.config.structured) {
      const structured = {
        timestamp,
        level: levelName,
        message: entry.message,
        module: entry.context.module,
        function: entry.context.function,
        operation: entry.context.operation,
        correlationId: entry.context.correlationId,
        ...(entry.data ? { data: entry.data } : {}),
        ...(entry.error && {
          error: {
            name: entry.error.name,
            message: entry.error.message,
            stack: entry.error.stack
          }
        }),
        ...(entry.context.metadata && { metadata: entry.context.metadata }),
        ...(entry.context.stack && this.config.includeStack && { stack: entry.context.stack })
      };

      return this.config.aiFriendly 
        ? this.formatForAI(structured)
        : JSON.stringify(structured, null, 2);
    } else {
      const contextStr = entry.context.module 
        ? `[${entry.context.module}${entry.context.function ? '::' + entry.context.function : ''}]`
        : '';
      
      return `${timestamp} ${levelName.padEnd(5)} ${contextStr} ${entry.message}${
        entry.error ? `\nError: ${entry.error.stack}` : ''
      }`;
    }
  }

  /**
   * Format structured log for AI assistant analysis
   */
  private formatForAI(structured: Record<string, unknown>): string {
    const lines = [
      `🔍 LOG ENTRY - ${structured.level}`,
      `📝 Message: ${structured.message}`,
      `⏰ Time: ${structured.timestamp}`,
      `🆔 ID: ${structured.correlationId}`
    ];

    if (structured.module) {
      lines.push(`📦 Module: ${structured.module}`);
    }

    if (structured.function) {
      lines.push(`⚡ Function: ${structured.function}`);
    }

    if (structured.operation) {
      lines.push(`🔧 Operation: ${structured.operation}`);
    }

    if (structured.data) {
      lines.push(`📊 Data: ${JSON.stringify(structured.data, null, 2)}`);
    }

    if (structured.error) {
      lines.push(`❌ Error Details:`);
      const error = structured.error as Record<string, unknown>;
      lines.push(`   Name: ${error.name}`);
      lines.push(`   Message: ${error.message}`);
      if (error.stack) {
        lines.push(`   Stack: ${error.stack}`);
      }
    }

    if (structured.metadata) {
      lines.push(`📋 Metadata: ${JSON.stringify(structured.metadata, null, 2)}`);
    }

    if (structured.stack && this.config.includeStack) {
      lines.push(`📍 Stack Trace: ${structured.stack}`);
    }

    return lines.join('\n') + '\n' + '─'.repeat(60);
  }

  /**
   * Write log entry to output
   */
  private writeEntry(entry: LogEntry): void {
    if (entry.level < this.config.level) {
      return;
    }

    const formatted = this.formatEntry(entry);

    // Output to console
    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(formatted);
        break;
      case LogLevel.INFO:
        console.info(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(formatted);
        break;
    }

    // TODO: Implement file output if needed
  }

  /**
   * Log debug message
   */
  debug(message: string, context: Partial<LogContext> = {}, data?: unknown): void {
    this.writeEntry({
      level: LogLevel.DEBUG,
      message,
      context: this.createContext(context),
      data
    });
  }

  /**
   * Log info message
   */
  info(message: string, context: Partial<LogContext> = {}, data?: unknown): void {
    this.writeEntry({
      level: LogLevel.INFO,
      message,
      context: this.createContext(context),
      data
    });
  }

  /**
   * Log warning message
   */
  warn(message: string, context: Partial<LogContext> = {}, data?: unknown): void {
    this.writeEntry({
      level: LogLevel.WARN,
      message,
      context: this.createContext(context),
      data
    });
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, context: Partial<LogContext> = {}, data?: unknown): void {
    this.writeEntry({
      level: LogLevel.ERROR,
      message,
      context: this.createContext(context),
      error,
      data
    });
  }

  /**
   * Log fatal error message
   */
  fatal(message: string, error?: Error, context: Partial<LogContext> = {}, data?: unknown): void {
    this.writeEntry({
      level: LogLevel.FATAL,
      message,
      context: this.createContext(context),
      error,
      data
    });
  }

  /**
   * Create a module-specific logger with context
   */
  module(moduleName: string): ModuleLogger {
    return new ModuleLogger(this, moduleName);
  }

  /**
   * Update logger configuration
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): LoggerConfig {
    return { ...this.config };
  }
}

/**
 * Module-specific logger with automatic context
 */
export class ModuleLogger {
  constructor(
    private logger: Logger,
    private moduleName: string
  ) {}

  private addModuleContext(context: Partial<LogContext> = {}): Partial<LogContext> {
    return {
      module: this.moduleName,
      ...context
    };
  }

  debug(message: string, context: Partial<LogContext> = {}, data?: unknown): void {
    this.logger.debug(message, this.addModuleContext(context), data);
  }

  info(message: string, context: Partial<LogContext> = {}, data?: unknown): void {
    this.logger.info(message, this.addModuleContext(context), data);
  }

  warn(message: string, context: Partial<LogContext> = {}, data?: unknown): void {
    this.logger.warn(message, this.addModuleContext(context), data);
  }

  error(message: string, error?: Error, context: Partial<LogContext> = {}, data?: unknown): void {
    this.logger.error(message, error, this.addModuleContext(context), data);
  }

  fatal(message: string, error?: Error, context: Partial<LogContext> = {}, data?: unknown): void {
    this.logger.fatal(message, error, this.addModuleContext(context), data);
  }

  /**
   * Create a function-specific context
   */
  fn(functionName: string): FunctionLogger {
    return new FunctionLogger(this.logger, this.moduleName, functionName);
  }
}

/**
 * Function-specific logger with automatic context
 */
export class FunctionLogger {
  constructor(
    private logger: Logger,
    private moduleName: string,
    private functionName: string
  ) {}

  private addFunctionContext(context: Partial<LogContext> = {}): Partial<LogContext> {
    return {
      module: this.moduleName,
      function: this.functionName,
      ...context
    };
  }

  debug(message: string, context: Partial<LogContext> = {}, data?: unknown): void {
    this.logger.debug(message, this.addFunctionContext(context), data);
  }

  info(message: string, context: Partial<LogContext> = {}, data?: unknown): void {
    this.logger.info(message, this.addFunctionContext(context), data);
  }

  warn(message: string, context: Partial<LogContext> = {}, data?: unknown): void {
    this.logger.warn(message, this.addFunctionContext(context), data);
  }

  error(message: string, error?: Error, context: Partial<LogContext> = {}, data?: unknown): void {
    this.logger.error(message, error, this.addFunctionContext(context), data);
  }

  fatal(message: string, error?: Error, context: Partial<LogContext> = {}, data?: unknown): void {
    this.logger.fatal(message, error, this.addFunctionContext(context), data);
  }

  /**
   * Log operation start
   */
  startOperation(operation: string, data?: unknown): string {
    const correlationId = this.logger.generateCorrelationId();
    this.info(`Starting ${operation}`, { 
      operation, 
      correlationId,
      metadata: { phase: 'start' }
    }, data);
    return correlationId;
  }

  /**
   * Log operation completion
   */
  completeOperation(operation: string, correlationId: string, data?: unknown): void {
    this.info(`Completed ${operation}`, { 
      operation, 
      correlationId,
      metadata: { phase: 'complete' }
    }, data);
  }

  /**
   * Log operation failure
   */
  failOperation(operation: string, correlationId: string, error: Error, data?: unknown): void {
    this.error(`Failed ${operation}`, error, { 
      operation, 
      correlationId,
      metadata: { phase: 'failed' }
    }, data);
  }
}

/**
 * Global logger instance
 */
export const logger = Logger.getInstance();

/**
 * Quick access functions
 */
export const log = {
  debug: (message: string, context?: Partial<LogContext>, data?: unknown) => 
    logger.debug(message, context, data),
  info: (message: string, context?: Partial<LogContext>, data?: unknown) => 
    logger.info(message, context, data),
  warn: (message: string, context?: Partial<LogContext>, data?: unknown) => 
    logger.warn(message, context, data),
  error: (message: string, error?: Error, context?: Partial<LogContext>, data?: unknown) => 
    logger.error(message, error, context, data),
  fatal: (message: string, error?: Error, context?: Partial<LogContext>, data?: unknown) => 
    logger.fatal(message, error, context, data),
  module: (name: string) => logger.module(name)
};