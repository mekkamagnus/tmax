/**
 * @file debug-reporter.ts
 * @description AI-optimized debugging and error reporting utilities for tmax
 */

import { errorManager, TmaxError, ErrorCategory, ErrorSeverity } from "./error-manager.ts";
import { logger, LogLevel } from "./logger.ts";
import { SLOW_OPERATION_THRESHOLD_MS } from "../constants/editor.ts";

/**
 * System health metrics
 */
export interface SystemHealth {
  status: "healthy" | "degraded" | "critical";
  uptime: number;
  memoryUsage?: number;
  errorRate: number;
  recentErrors: number;
  criticalErrors: number;
  lastError?: TmaxError;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  operationsPerSecond: number;
  averageResponseTime: number;
  slowOperations: Array<{
    operation: string;
    duration: number;
    timestamp: Date;
  }>;
}

/**
 * Debug context for AI analysis
 */
export interface DebugContext {
  systemHealth: SystemHealth;
  recentErrors: TmaxError[];
  performanceMetrics?: PerformanceMetrics;
  activeOperations: Array<{
    operation: string;
    correlationId: string;
    startTime: Date;
    module: string;
  }>;
  environment: {
    platform: string;
    bunVersion: string;
    nodeVersion: string;
    tmaxVersion: string;
    workingDirectory: string;
    ttyStatus: boolean;
  };
}

/**
 * AI-optimized debug reporter
 */
export class DebugReporter {
  private static instance: DebugReporter;
  private startTime = Date.now();
  private operationMetrics = new Map<string, { count: number; totalTime: number; lastExecution: Date }>();
  private activeOperations = new Map<string, { operation: string; startTime: Date; module: string }>();
  private slowOperationThreshold = SLOW_OPERATION_THRESHOLD_MS; // 1 second

  private constructor() {}

  static getInstance(): DebugReporter {
    if (!DebugReporter.instance) {
      DebugReporter.instance = new DebugReporter();
    }
    return DebugReporter.instance;
  }

  /**
   * Record operation start
   */
  recordOperationStart(correlationId: string, operation: string, module: string): void {
    this.activeOperations.set(correlationId, {
      operation,
      startTime: new Date(),
      module
    });
  }

  /**
   * Record operation completion
   */
  recordOperationComplete(correlationId: string): void {
    const active = this.activeOperations.get(correlationId);
    if (!active) return;

    const duration = Date.now() - active.startTime.getTime();
    const key = `${active.module}::${active.operation}`;
    
    // Update metrics
    const existing = this.operationMetrics.get(key) || { count: 0, totalTime: 0, lastExecution: new Date() };
    this.operationMetrics.set(key, {
      count: existing.count + 1,
      totalTime: existing.totalTime + duration,
      lastExecution: new Date()
    });

    this.activeOperations.delete(correlationId);
  }

  /**
   * Get system health status
   */
  getSystemHealth(): SystemHealth {
    const stats = errorManager.getErrorStats();
    const uptime = Date.now() - this.startTime;
    const hourAgo = Date.now() - (60 * 60 * 1000);
    
    const recentErrors = stats.recentCount;
    const criticalErrors = stats.bySeverity[ErrorSeverity.CRITICAL] || 0;
    const errorRate = stats.total > 0 ? recentErrors / (uptime / (60 * 60 * 1000)) : 0;
    
    let status: "healthy" | "degraded" | "critical" = "healthy";
    if (criticalErrors > 0 || errorRate > 10) {
      status = "critical";
    } else if (recentErrors > 5 || errorRate > 3) {
      status = "degraded";
    }

    const errorHistory = errorManager.getErrorHistory();
    const lastError = errorHistory[errorHistory.length - 1];

    return {
      status,
      uptime: Math.floor(uptime / 1000),
      errorRate,
      recentErrors,
      criticalErrors,
      lastError
    };
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    const operations = Array.from(this.operationMetrics.entries());
    const totalOps = operations.reduce((sum, [, metrics]) => sum + metrics.count, 0);
    const totalTime = operations.reduce((sum, [, metrics]) => sum + metrics.totalTime, 0);
    
    const operationsPerSecond = totalOps / ((Date.now() - this.startTime) / 1000);
    const averageResponseTime = totalTime / Math.max(totalOps, 1);

    // Find slow operations
    const slowOperations = operations
      .filter(([, metrics]) => metrics.totalTime / metrics.count > this.slowOperationThreshold)
      .map(([operation, metrics]) => ({
        operation,
        duration: metrics.totalTime / metrics.count,
        timestamp: metrics.lastExecution
      }))
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10);

    return {
      operationsPerSecond,
      averageResponseTime,
      slowOperations
    };
  }

  /**
   * Get full debug context
   */
  getDebugContext(): DebugContext {
    const systemHealth = this.getSystemHealth();
    const recentErrors = errorManager.getErrorHistory().slice(-20);
    const performanceMetrics = this.getPerformanceMetrics();
    
    const activeOperations = Array.from(this.activeOperations.entries()).map(
      ([correlationId, data]) => ({
        operation: data.operation,
        correlationId,
        startTime: data.startTime,
        module: data.module
      })
    );

    return {
      systemHealth,
      recentErrors,
      performanceMetrics,
      activeOperations,
      environment: {
        platform: process.platform,
        bunVersion: typeof Bun !== 'undefined' ? Bun.version : 'N/A',
        nodeVersion: process.version,
        tmaxVersion: "1.0.0", // TODO: Get from package.json
        workingDirectory: process.cwd(),
        ttyStatus: process.stdin.isTTY
      }
    };
  }

  /**
   * Generate comprehensive AI analysis report
   */
  generateAIReport(): string {
    const context = this.getDebugContext();
    const lines = [
      "🔬 TMAX DEBUG ANALYSIS REPORT",
      `📊 Generated: ${new Date().toISOString()}`,
      "",
      "═══ SYSTEM HEALTH ═══",
      `🏥 Status: ${context.systemHealth.status.toUpperCase()}`,
      `⏱️  Uptime: ${Math.floor(context.systemHealth.uptime / 60)}m ${context.systemHealth.uptime % 60}s`,
      `📈 Error Rate: ${context.systemHealth.errorRate.toFixed(2)}/hour`,
      `🚨 Recent Errors: ${context.systemHealth.recentErrors}`,
      `💥 Critical Errors: ${context.systemHealth.criticalErrors}`,
      ""
    ];

    // Environment information
    lines.push(
      "═══ ENVIRONMENT ═══",
      `🖥️  Platform: ${context.environment.platform}`,
      `🦕 Deno Version: ${context.environment.denoVersion}`,
      `📦 Tmax Version: ${context.environment.tmaxVersion}`,
      `📁 Working Dir: ${context.environment.workingDirectory}`,
      `💻 TTY Status: ${context.environment.ttyStatus ? 'Connected' : 'Not Connected'}`,
      ""
    );

    // Performance metrics
    if (context.performanceMetrics) {
      lines.push(
        "═══ PERFORMANCE ═══",
        `⚡ Operations/sec: ${context.performanceMetrics.operationsPerSecond.toFixed(2)}`,
        `🕐 Avg Response: ${context.performanceMetrics.averageResponseTime.toFixed(2)}ms`,
        ""
      );

      if (context.performanceMetrics.slowOperations.length > 0) {
        lines.push("🐌 SLOW OPERATIONS:");
        context.performanceMetrics.slowOperations.forEach((op, i) => {
          lines.push(`   ${i + 1}. ${op.operation}: ${op.duration.toFixed(2)}ms`);
        });
        lines.push("");
      }
    }

    // Active operations
    if (context.activeOperations.length > 0) {
      lines.push("═══ ACTIVE OPERATIONS ═══");
      context.activeOperations.forEach((op, i) => {
        const duration = Date.now() - op.startTime.getTime();
        lines.push(`   ${i + 1}. [${op.module}] ${op.operation} (${duration}ms)`);
        lines.push(`      ID: ${op.correlationId}`);
      });
      lines.push("");
    }

    // Recent errors analysis
    if (context.recentErrors.length > 0) {
      lines.push("═══ ERROR ANALYSIS ═══");
      
      // Group errors by category
      const errorsByCategory: Record<string, TmaxError[]> = {};
      context.recentErrors.forEach(error => {
        const category = error.context.category || 'unknown';
        if (!errorsByCategory[category]) {
          errorsByCategory[category] = [];
        }
        errorsByCategory[category].push(error);
      });

      Object.entries(errorsByCategory).forEach(([category, errors]) => {
        lines.push(`📋 ${category.toUpperCase()}: ${errors.length} errors`);
        
        // Show most recent error details
        const latest = errors[errors.length - 1];
        lines.push(`   Latest: ${latest.message}`);
        lines.push(`   Module: ${latest.context.module || 'unknown'}`);
        lines.push(`   Time: ${latest.timestamp.toISOString()}`);
        
        if (latest.context.suggestions && latest.context.suggestions.length > 0) {
          lines.push(`   Suggestion: ${latest.context.suggestions[0]}`);
        }
        lines.push("");
      });

      // Show most critical recent error
      const criticalError = context.recentErrors
        .filter(e => e.context.severity === ErrorSeverity.CRITICAL)
        .pop();
      
      if (criticalError) {
        lines.push("🚨 MOST RECENT CRITICAL ERROR:");
        lines.push(criticalError.toAIFormat());
      }
    }

    // Recommendations
    lines.push("═══ AI TROUBLESHOOTING RECOMMENDATIONS ═══");
    
    const recommendations = this.generateRecommendations(context);
    recommendations.forEach((rec, i) => {
      lines.push(`${i + 1}. ${rec}`);
    });

    return lines.join('\n');
  }

  /**
   * Generate AI-specific troubleshooting recommendations
   */
  private generateRecommendations(context: DebugContext): string[] {
    const recommendations: string[] = [];
    
    // System health recommendations
    if (context.systemHealth.status === "critical") {
      recommendations.push("🚨 System in critical state - investigate recent errors immediately");
      recommendations.push("📊 Check system resources and restart if necessary");
    } else if (context.systemHealth.status === "degraded") {
      recommendations.push("⚠️ System performance degraded - review recent changes");
    }

    // Error pattern recommendations
    const errorsByModule: Record<string, number> = {};
    context.recentErrors.forEach(error => {
      const module = error.context.module || 'unknown';
      errorsByModule[module] = (errorsByModule[module] || 0) + 1;
    });

    const problemModules = Object.entries(errorsByModule)
      .filter(([, count]) => count > 3)
      .sort(([, a], [, b]) => b - a);

    if (problemModules.length > 0) {
      recommendations.push(`🎯 Focus investigation on modules: ${problemModules.map(([mod]) => mod).join(', ')}`);
    }

    // Performance recommendations
    if (context.performanceMetrics?.slowOperations.length) {
      recommendations.push(`⚡ Optimize slow operations: ${context.performanceMetrics.slowOperations[0].operation}`);
    }

    // TTY recommendations
    if (!context.environment.ttyStatus) {
      recommendations.push("💻 Terminal not detected - ensure tmax is run in proper terminal environment");
    }

    // Active operations recommendations
    if (context.activeOperations.length > 10) {
      recommendations.push("🔄 High number of active operations - potential resource leak");
    }

    const stuckOperations = context.activeOperations.filter(
      op => Date.now() - op.startTime.getTime() > 30000 // 30 seconds
    );
    
    if (stuckOperations.length > 0) {
      recommendations.push(`⏰ Operations may be stuck: ${stuckOperations.map(op => op.operation).join(', ')}`);
    }

    if (recommendations.length === 0) {
      recommendations.push("✅ System appears healthy - continue monitoring");
    }

    return recommendations;
  }

  /**
   * Write debug report to file for AI analysis
   */
  async writeDebugReport(path?: string): Promise<void> {
    const report = this.generateAIReport();
    const filename = path || `debug-report-${Date.now()}.txt`;
    
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(filename, report, "utf-8");
      logger.info(`Debug report written to ${filename}`, {
        module: "DebugReporter",
        operation: "write_report"
      });
    } catch (error) {
      logger.error(
        "Failed to write debug report",
        error instanceof Error ? error : new Error(String(error)),
        {
          module: "DebugReporter",
          operation: "write_report"
        },
        { filename, reportLength: report.length }
      );
    }
  }
}

/**
 * Global debug reporter instance
 */
export const debugReporter = DebugReporter.getInstance();

/**
 * Quick access functions for debugging
 */
export const debug = {
  /**
   * Get current system status
   */
  status: () => debugReporter.getSystemHealth(),
  
  /**
   * Generate quick report for AI
   */
  report: () => debugReporter.generateAIReport(),
  
  /**
   * Record operation for performance tracking
   */
  startOp: (correlationId: string, operation: string, module: string) =>
    debugReporter.recordOperationStart(correlationId, operation, module),
  
  /**
   * Complete operation tracking
   */
  endOp: (correlationId: string) =>
    debugReporter.recordOperationComplete(correlationId),
  
  /**
   * Get full debug context
   */
  context: () => debugReporter.getDebugContext(),
  
  /**
   * Write report to file
   */
  writeReport: (path?: string) => debugReporter.writeDebugReport(path)
};