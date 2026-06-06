/**
 * @file debug-state.ts
 * @description T-Lisp debug state: call stack tracking, trace, and last-error
 */

import type { TLispValue } from "./types.ts";
import type { TLispDiagnostic, TLispStackFrame } from "./diagnostics.ts";
import type { SourceSpan } from "./source.ts";
import { getSourceSpan } from "./source-metadata.ts";

const MAX_STACK_DEPTH = 256;
const MAX_TRACE_HISTORY = 1000;

export interface TraceEntry {
  depth: number;
  functionName: string;
  args: TLispValue[];
  result?: TLispValue;
  span?: SourceSpan;
  direction: "enter" | "exit";
}

export class DebugState {
  private stack: TLispStackFrame[] = [];
  private tracedFunctions: Set<string> = new Set();
  private traceHistory: TraceEntry[] = [];
  private lastDiagnostic: TLispDiagnostic | null = null;

  pushFrame(name: string, span?: SourceSpan): void {
    if (this.stack.length >= MAX_STACK_DEPTH) return;
    this.stack.push({ function: name, callSpan: span });
  }

  popFrame(): void {
    this.stack.pop();
  }

  getStack(): TLispStackFrame[] {
    return [...this.stack];
  }

  getStackDepth(): number {
    return this.stack.length;
  }

  setLastDiagnostic(d: TLispDiagnostic): void {
    this.lastDiagnostic = d;
  }

  getLastDiagnostic(): TLispDiagnostic | null {
    return this.lastDiagnostic;
  }

  traceFunction(name: string): void {
    this.tracedFunctions.add(name);
  }

  untraceFunction(name: string): void {
    this.tracedFunctions.delete(name);
  }

  isTraced(name: string): boolean {
    return this.tracedFunctions.has(name);
  }

  getTracedFunctions(): string[] {
    return [...this.tracedFunctions];
  }

  recordTrace(entry: TraceEntry): void {
    if (this.traceHistory.length >= MAX_TRACE_HISTORY) {
      this.traceHistory.shift();
    }
    this.traceHistory.push(entry);
  }

  getTraceHistory(): TraceEntry[] {
    return [...this.traceHistory];
  }

  clearTrace(): void {
    this.traceHistory = [];
  }

  reset(): void {
    this.stack = [];
    this.tracedFunctions.clear();
    this.traceHistory = [];
    this.lastDiagnostic = null;
  }
}
