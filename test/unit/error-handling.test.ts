/**
 * @file error-handling.test.ts
 * @description Tests for centralized error handling and logging system
 */

import { describe, test, expect } from "bun:test";
import { Logger, LogLevel, log } from "../../src/utils/logger.ts";
import {
  ErrorManager,
  TmaxError,
  ErrorCategory,
  ErrorSeverity,
  ErrorFactory,
  errorManager
} from "../../src/utils/error-manager.ts";
import { debugReporter } from "../../src/utils/debug-reporter.ts";
import { FunctionalTerminalIOImpl } from "../../src/core/terminal.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("Error Handling and Logging System", () => {

  test("Logger - should create structured logs", () => {
    const logger = Logger.getInstance();

    // Test basic logging
    logger.info("Test info message", { module: "Test" });
    logger.warn("Test warning", { module: "Test", operation: "test_op" });
    logger.error("Test error", new Error("Test error"), { module: "Test" });

    // Test module logger
    const moduleLogger = logger.module("TestModule");
    moduleLogger.debug("Debug from module");
    moduleLogger.info("Info from module");

    // Test function logger
    const fnLogger = moduleLogger.fn("testFunction");
    const correlationId = fnLogger.startOperation("test_operation");
    fnLogger.completeOperation("test_operation", correlationId);

    expect(typeof correlationId).toBe("string");
    expect(correlationId.startsWith("tmax-")).toBe(true);
  });

  test("ErrorManager - should create and track errors", () => {
    // Clear previous errors for clean test
    errorManager.clearHistory();

    // Test error creation
    const error = errorManager.createError(
      "Test error message",
      {
        module: "TestModule",
        function: "testFunction",
        category: ErrorCategory.VALIDATION,
        severity: ErrorSeverity.HIGH,
        userMessage: "User-friendly error message",
        suggestions: ["Try again", "Check input"]
      }
    );

    expect(error).toBeDefined();
    expect(error.message).toBe("Test error message");
    expect(error.context.category).toBe(ErrorCategory.VALIDATION);
    expect(error.context.severity).toBe(ErrorSeverity.HIGH);
    expect(error.getUserMessage()).toBe("User-friendly error message");
    expect(error.getSuggestions().length).toBe(2);

    // Test error history
    const history = errorManager.getErrorHistory();
    expect(history.length).toBe(1);
    expect(history[0].message).toBe("Test error message");
    
    // Test error statistics
    const stats = errorManager.getErrorStats();
    expect(stats.total).toBe(1);
    expect(stats.byCategory[ErrorCategory.VALIDATION]).toBe(1);
    expect(stats.bySeverity[ErrorSeverity.HIGH]).toBe(1);
  });

test("ErrorFactory - should create specific error types", () => {
    errorManager.clearHistory();
    
    // Test validation error
    const validationError = ErrorFactory.validation(
      "Invalid input",
      "email",
      "not-an-email",
      "valid@email.com"
    );
    
    expect(validationError.context.category).toBe(ErrorCategory.VALIDATION);
    expect(validationError.context.input).toBe("not-an-email");
    expect(validationError.context.expected).toBe("valid@email.com");
    expect(validationError.getUserMessage().toBe(true).includes("Invalid email"));
    
    // Test parsing error
    const parseError = ErrorFactory.parsing(
      "Unexpected token",
      "(defun incomplete",
      15
    );
    
    expect(parseError.context.category).toBe(ErrorCategory.PARSING);
    expect(parseError.context.input).toBe("(defun incomplete");
    expect(parseError.context.metadata?.position).toBe(15);
    
    // Test IO error
    const ioError = ErrorFactory.io(
      "File not found",
      "/path/to/file.txt",
      "read",
      new Error("ENOENT")
    );
    
    expect(ioError.context.category).toBe(ErrorCategory.IO);
    expect(ioError.context.metadata?.path).toBe("/path/to/file.txt");
    expect(ioError.context.metadata?.operation).toBe("read");
    expect(ioError.cause).toBeDefined();
  });

test("TmaxError - should provide AI-friendly formatting", () => {
    const error = new TmaxError(
      "Complex error for AI analysis",
      {
        module: "TestModule",
        function: "complexFunction",
        operation: "complex_operation",
        category: ErrorCategory.RUNTIME,
        severity: ErrorSeverity.CRITICAL,
        userMessage: "Something went wrong",
        suggestions: ["Restart the application", "Check logs"],
        code: "ERR_COMPLEX_001",
        input: { operation: "test", data: [1, 2, 3] },
        expected: "successful execution",
        actual: "runtime failure"
      }
    );
    
    const aiFormat = error.toAIFormat();
    
    expect(aiFormat.includes("🚨 TMAX ERROR REPORT").toBe(true));
    expect(aiFormat.includes("Complex error for AI analysis").toBe(true));
    expect(aiFormat.includes("📦 Module: TestModule").toBe(true));
    expect(aiFormat.includes("⚡ Function: complexFunction").toBe(true));
    expect(aiFormat.includes("🔧 Operation: complex_operation").toBe(true));
    expect(aiFormat.includes("🏷️  Category: runtime").toBe(true));
    expect(aiFormat.includes("⚠️  Severity: critical").toBe(true));
    expect(aiFormat.includes("👤 User Message: Something went wrong").toBe(true));
    expect(aiFormat.includes("🔢 Error Code: ERR_COMPLEX_001").toBe(true));
    expect(aiFormat.includes("💡 Suggestions:").toBe(true));
    expect(aiFormat.includes("1. Restart the application").toBe(true));
    expect(aiFormat.includes("2. Check logs").toBe(true));
    expect(aiFormat.includes("📥 Input:").toBe(true));
    expect(aiFormat.includes("✅ Expected: \"successful execution\"").toBe(true));
    expect(aiFormat.includes("❌ Actual: \"runtime failure\"").toBe(true));
  });

test("DebugReporter - should track system health", () => {
    const health = debugReporter.getSystemHealth();
    
    expect(health).toBeDefined();
    expect(["healthy", "degraded", "critical"].includes(health.status).toBe(true));
    expect(typeof health.uptime).toBe("number");
    expect(typeof health.errorRate).toBe("number");
    expect(typeof health.recentErrors).toBe("number");
    expect(typeof health.criticalErrors).toBe("number");
  });

test("DebugReporter - should generate AI reports", () => {
    // Create some test errors first
    ErrorFactory.validation("Test validation error", "field1");
    ErrorFactory.runtime("Test runtime error", "test_operation");
    ErrorFactory.io("Test IO error", "/test/path", "read");
    
    const report = debugReporter.generateAIReport();
    
    expect(report.includes("🔬 TMAX DEBUG ANALYSIS REPORT").toBe(true));
    expect(report.includes("═══ SYSTEM HEALTH ═══").toBe(true));
    expect(report.includes("═══ ENVIRONMENT ═══").toBe(true));
    expect(report.includes("═══ ERROR ANALYSIS ═══").toBe(true));
    expect(report.includes("═══ AI TROUBLESHOOTING RECOMMENDATIONS ═══").toBe(true));
    
    // Check environment information
    expect(report.includes("🖥️  Platform:").toBe(true));
    expect(report.includes("🦕 Deno Version:").toBe(true));
    expect(report.includes("💻 TTY Status:").toBe(true));
  });

test("DebugReporter - should track operation performance", () => {
    const correlationId1 = "test-op-1";
    const correlationId2 = "test-op-2";
    
    // Record operations
    debugReporter.recordOperationStart(correlationId1, "fast_operation", "TestModule");
    debugReporter.recordOperationComplete(correlationId1);
    
    debugReporter.recordOperationStart(correlationId2, "slow_operation", "TestModule");
    // Simulate slow operation by not completing immediately
    
    const context = debugReporter.getDebugContext();
    
    expect(context.performanceMetrics).toBeDefined();
    expect(typeof context.performanceMetrics.operationsPerSecond).toBe("number");
    expect(typeof context.performanceMetrics.averageResponseTime).toBe("number");
    
    // Should have one active operation
    expect(context.activeOperations.length).toBe(1);
    expect(context.activeOperations[0].operation).toBe("slow_operation");
    expect(context.activeOperations[0].correlationId).toBe(correlationId2);
    
    // Complete the slow operation
    debugReporter.recordOperationComplete(correlationId2);
    
    const updatedContext = debugReporter.getDebugContext();
    expect(updatedContext.activeOperations.length).toBe(0);
  });

  test("Integration - Terminal with enhanced error handling", async () => {
    // Test the enhanced terminal implementation
    const terminal = new FunctionalTerminalIOImpl();
    
    // Test getSize (should not throw)
    const sizeResult = terminal.getSize();
    expect(Either.isRight(sizeResult).toBe(true) || Either.isLeft(sizeResult));
    
    if (Either.isRight(sizeResult)) {
      const size = sizeResult.right;
      expect(typeof size.width).toBe("number");
      expect(typeof size.height).toBe("number");
      expect(size.width > 0).toBe(true);
      expect(size.height > 0).toBe(true);
    }
    
    // Test readKey error handling (should fail gracefully when not in raw mode)
    const keyResult = await terminal.readKey().run();
    expect(Either.isLeft(keyResult).toBe(true)); // Should fail because not in raw mode
    
    if (Either.isLeft(keyResult)) {
      const error = keyResult.left;
      expect(error instanceof TmaxError).toBe(true);
      expect(error.context.category).toBe(ErrorCategory.VALIDATION);
      expect(error.context.suggestions && error.context.suggestions.length > 0).toBe(true);
    }
  });

test("Error Manager - comprehensive report generation", () => {
    const aiReport = errorManager.generateAIReport();
    
    expect(aiReport.includes("🔍 TMAX ERROR ANALYSIS REPORT").toBe(true));
    expect(aiReport.includes("📊 Total Errors:").toBe(true));
    expect(aiReport.includes("📈 BY CATEGORY:").toBe(true));
    expect(aiReport.includes("⚠️  BY SEVERITY:").toBe(true));
    
    // Should contain error categories we created
    expect(aiReport.includes("validation:").toBe(true) || aiReport.includes("runtime:") || aiReport.includes("io:"));
  });

test("Logger configuration and AI-friendly formatting", () => {
    const logger = Logger.getInstance();
    const originalConfig = logger.getConfig();
    
    // Test configuration changes
    logger.configure({ 
      aiFriendly: true,
      structured: true,
      includeStack: true 
    });
    
    const newConfig = logger.getConfig();
    expect(newConfig.aiFriendly).toBe(true);
    expect(newConfig.structured).toBe(true);
    expect(newConfig.includeStack).toBe(true);
    
    // Test different log levels
    logger.debug("Debug message with AI formatting", { 
      module: "Test", 
      metadata: { testData: "value" } 
    });
    
    logger.info("Info message with context", { 
      module: "Test", 
      function: "testAI" 
    }, { 
      processedData: 42 
    });
    
    // Restore original config
    logger.configure(originalConfig);
  });

});

describe("Error Handling Performance", () => {
  
test("Should handle high error volume efficiently", () => {
    const startTime = performance.now();
    
    // Generate many errors
    for (let i = 0; i < 100; i++) {
      ErrorFactory.validation(`Error ${i}`, "field", `value${i}`);
    }
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    // Should complete in reasonable time (less than 100ms for 100 errors)
    expect(duration < 100, `Error generation took too long: ${duration}ms`).toBe(true);
    
    const stats = errorManager.getErrorStats();
    expect(stats.total >= 100).toBe(true);
  });

test("Should generate reports efficiently", () => {
    const startTime = performance.now();
    
    const report = debugReporter.generateAIReport();
    const aiReport = errorManager.generateAIReport();
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    // Report generation should be fast
    expect(duration < 50, `Report generation took too long: ${duration}ms`).toBe(true);
    
    expect(report.length > 0).toBe(true);
    expect(aiReport.length > 0).toBe(true);
  });

});