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
    assertEquals(history[0].message, "Test error message");
    
    // Test error statistics
    const stats = errorManager.getErrorStats();
    assertEquals(stats.total, 1);
    assertEquals(stats.byCategory[ErrorCategory.VALIDATION], 1);
    assertEquals(stats.bySeverity[ErrorSeverity.HIGH], 1);
  });

  await t.step("ErrorFactory - should create specific error types", () => {
    errorManager.clearHistory();
    
    // Test validation error
    const validationError = ErrorFactory.validation(
      "Invalid input",
      "email",
      "not-an-email",
      "valid@email.com"
    );
    
    assertEquals(validationError.context.category, ErrorCategory.VALIDATION);
    assertEquals(validationError.context.input, "not-an-email");
    assertEquals(validationError.context.expected, "valid@email.com");
    assert(validationError.getUserMessage().includes("Invalid email"));
    
    // Test parsing error
    const parseError = ErrorFactory.parsing(
      "Unexpected token",
      "(defun incomplete",
      15
    );
    
    assertEquals(parseError.context.category, ErrorCategory.PARSING);
    assertEquals(parseError.context.input, "(defun incomplete");
    assertEquals(parseError.context.metadata?.position, 15);
    
    // Test IO error
    const ioError = ErrorFactory.io(
      "File not found",
      "/path/to/file.txt",
      "read",
      new Error("ENOENT")
    );
    
    assertEquals(ioError.context.category, ErrorCategory.IO);
    assertEquals(ioError.context.metadata?.path, "/path/to/file.txt");
    assertEquals(ioError.context.metadata?.operation, "read");
    assertExists(ioError.cause);
  });

  await t.step("TmaxError - should provide AI-friendly formatting", () => {
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
    
    assert(aiFormat.includes("🚨 TMAX ERROR REPORT"));
    assert(aiFormat.includes("Complex error for AI analysis"));
    assert(aiFormat.includes("📦 Module: TestModule"));
    assert(aiFormat.includes("⚡ Function: complexFunction"));
    assert(aiFormat.includes("🔧 Operation: complex_operation"));
    assert(aiFormat.includes("🏷️  Category: runtime"));
    assert(aiFormat.includes("⚠️  Severity: critical"));
    assert(aiFormat.includes("👤 User Message: Something went wrong"));
    assert(aiFormat.includes("🔢 Error Code: ERR_COMPLEX_001"));
    assert(aiFormat.includes("💡 Suggestions:"));
    assert(aiFormat.includes("1. Restart the application"));
    assert(aiFormat.includes("2. Check logs"));
    assert(aiFormat.includes("📥 Input:"));
    assert(aiFormat.includes("✅ Expected: \"successful execution\""));
    assert(aiFormat.includes("❌ Actual: \"runtime failure\""));
  });

  await t.step("DebugReporter - should track system health", () => {
    const health = debugReporter.getSystemHealth();
    
    assertExists(health);
    assert(["healthy", "degraded", "critical"].includes(health.status));
    assertEquals(typeof health.uptime, "number");
    assertEquals(typeof health.errorRate, "number");
    assertEquals(typeof health.recentErrors, "number");
    assertEquals(typeof health.criticalErrors, "number");
  });

  await t.step("DebugReporter - should generate AI reports", () => {
    // Create some test errors first
    ErrorFactory.validation("Test validation error", "field1");
    ErrorFactory.runtime("Test runtime error", "test_operation");
    ErrorFactory.io("Test IO error", "/test/path", "read");
    
    const report = debugReporter.generateAIReport();
    
    assert(report.includes("🔬 TMAX DEBUG ANALYSIS REPORT"));
    assert(report.includes("═══ SYSTEM HEALTH ═══"));
    assert(report.includes("═══ ENVIRONMENT ═══"));
    assert(report.includes("═══ ERROR ANALYSIS ═══"));
    assert(report.includes("═══ AI TROUBLESHOOTING RECOMMENDATIONS ═══"));
    
    // Check environment information
    assert(report.includes("🖥️  Platform:"));
    assert(report.includes("🦕 Deno Version:"));
    assert(report.includes("💻 TTY Status:"));
  });

  await t.step("DebugReporter - should track operation performance", () => {
    const correlationId1 = "test-op-1";
    const correlationId2 = "test-op-2";
    
    // Record operations
    debugReporter.recordOperationStart(correlationId1, "fast_operation", "TestModule");
    debugReporter.recordOperationComplete(correlationId1);
    
    debugReporter.recordOperationStart(correlationId2, "slow_operation", "TestModule");
    // Simulate slow operation by not completing immediately
    
    const context = debugReporter.getDebugContext();
    
    assertExists(context.performanceMetrics);
    assertEquals(typeof context.performanceMetrics.operationsPerSecond, "number");
    assertEquals(typeof context.performanceMetrics.averageResponseTime, "number");
    
    // Should have one active operation
    assertEquals(context.activeOperations.length, 1);
    assertEquals(context.activeOperations[0].operation, "slow_operation");
    assertEquals(context.activeOperations[0].correlationId, correlationId2);
    
    // Complete the slow operation
    debugReporter.recordOperationComplete(correlationId2);
    
    const updatedContext = debugReporter.getDebugContext();
    assertEquals(updatedContext.activeOperations.length, 0);
  });

  await t.step("Integration - Terminal with enhanced error handling", async () => {
    // Test the enhanced terminal implementation
    const terminal = new FunctionalTerminalIOImpl();
    
    // Test getSize (should not throw)
    const sizeResult = terminal.getSize();
    assert(Either.isRight(sizeResult) || Either.isLeft(sizeResult));
    
    if (Either.isRight(sizeResult)) {
      const size = sizeResult.right;
      assertEquals(typeof size.width, "number");
      assertEquals(typeof size.height, "number");
      assert(size.width > 0);
      assert(size.height > 0);
    }
    
    // Test readKey error handling (should fail gracefully when not in raw mode)
    const keyResult = await terminal.readKey().run();
    assert(Either.isLeft(keyResult)); // Should fail because not in raw mode
    
    if (Either.isLeft(keyResult)) {
      const error = keyResult.left;
      assert(error instanceof TmaxError);
      assertEquals(error.context.category, ErrorCategory.VALIDATION);
      assert(error.context.suggestions && error.context.suggestions.length > 0);
    }
  });

  await t.step("Error Manager - comprehensive report generation", () => {
    const aiReport = errorManager.generateAIReport();
    
    assert(aiReport.includes("🔍 TMAX ERROR ANALYSIS REPORT"));
    assert(aiReport.includes("📊 Total Errors:"));
    assert(aiReport.includes("📈 BY CATEGORY:"));
    assert(aiReport.includes("⚠️  BY SEVERITY:"));
    
    // Should contain error categories we created
    assert(aiReport.includes("validation:") || aiReport.includes("runtime:") || aiReport.includes("io:"));
  });

  await t.step("Logger configuration and AI-friendly formatting", () => {
    const logger = Logger.getInstance();
    const originalConfig = logger.getConfig();
    
    // Test configuration changes
    logger.configure({ 
      aiFriendly: true,
      structured: true,
      includeStack: true 
    });
    
    const newConfig = logger.getConfig();
    assertEquals(newConfig.aiFriendly, true);
    assertEquals(newConfig.structured, true);
    assertEquals(newConfig.includeStack, true);
    
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

Deno.test("Error Handling Performance", async (t) => {
  
  await t.step("Should handle high error volume efficiently", () => {
    const startTime = performance.now();
    
    // Generate many errors
    for (let i = 0; i < 100; i++) {
      ErrorFactory.validation(`Error ${i}`, "field", `value${i}`);
    }
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    // Should complete in reasonable time (less than 100ms for 100 errors)
    assert(duration < 100, `Error generation took too long: ${duration}ms`);
    
    const stats = errorManager.getErrorStats();
    assert(stats.total >= 100);
  });

  await t.step("Should generate reports efficiently", () => {
    const startTime = performance.now();
    
    const report = debugReporter.generateAIReport();
    const aiReport = errorManager.generateAIReport();
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    // Report generation should be fast
    assert(duration < 50, `Report generation took too long: ${duration}ms`);
    
    assert(report.length > 0);
    assert(aiReport.length > 0);
  });

});