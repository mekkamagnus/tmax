/**
 * @file diagnostics.ts
 * @description Structured T-Lisp diagnostic model and error codes
 */

import type { SourceSpan } from "./source.ts";

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface DiagnosticLabel {
  span: SourceSpan;
  style: "primary" | "secondary";
  message: string;
}

export interface DiagnosticSuggestion {
  kind: "replacement" | "insertion" | "removal";
  message: string;
  span?: SourceSpan;
  replacement?: string;
}

export interface DiagnosticRelatedLocation {
  span: SourceSpan;
  sourceName: string;
  message: string;
}

export interface TLispStackFrame {
  function: string;
  module?: string;
  source?: { kind: string; name?: string; uri?: string };
  callSpan?: SourceSpan;
}

export interface TLispDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  source?: { kind: string; name: string; uri?: string };
  primarySpan?: SourceSpan;
  labels?: DiagnosticLabel[];
  notes?: string[];
  help?: string;
  suggestions?: DiagnosticSuggestion[];
  related?: DiagnosticRelatedLocation[];
  stack?: TLispStackFrame[];
  expected?: string;
  actual?: string;
}

export const DiagnosticCodes = {
  TL0001: "parse error",
  TL0002: "tokenize error",
  TL1001: "undefined symbol",
  TL1002: "type error",
  TL1003: "arity error",
  TL1004: "invalid special form",
  TL2001: "module not found",
  TL2002: "symbol not exported",
  TL2003: "circular module dependency",
  TL3001: "macro expansion error",
  TL4001: "host primitive error",
} as const;

export type DiagnosticCode = keyof typeof DiagnosticCodes;

export function createDiagnostic(fields: Partial<TLispDiagnostic> & { code: string; message: string }): TLispDiagnostic {
  return {
    severity: "error",
    ...fields,
  };
}

export function diagnosticToJSON(d: TLispDiagnostic): Record<string, any> {
  const result: Record<string, any> = {
    severity: d.severity,
    code: d.code,
    message: d.message,
  };
  if (d.source) result.source = d.source;
  if (d.primarySpan) {
    result.primarySpan = {
      start: { line: d.primarySpan.start.line, column: d.primarySpan.start.column, offset: d.primarySpan.start.offset },
      end: { line: d.primarySpan.end.line, column: d.primarySpan.end.column, offset: d.primarySpan.end.offset },
    };
  }
  if (d.expected) result.expected = d.expected;
  if (d.actual) result.actual = d.actual;
  if (d.help) result.help = d.help;
  if (d.notes) result.notes = d.notes;
  if (d.suggestions) result.suggestions = d.suggestions;
  if (d.stack) result.stack = d.stack;
  if (d.related) result.related = d.related;
  return result;
}

export function diagnosticToLSP(d: TLispDiagnostic): Record<string, any> {
  return {
    range: d.primarySpan
      ? {
          start: { line: d.primarySpan.start.line, character: d.primarySpan.start.column },
          end: { line: d.primarySpan.end.line, character: d.primarySpan.end.column },
        }
      : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : d.severity === "info" ? 3 : 4,
    code: d.code,
    source: "t-lisp",
    message: d.message,
    relatedInformation: d.related?.map((r) => ({
      location: { uri: r.sourceName, range: { start: { line: r.span.start.line, character: r.span.start.column }, end: { line: r.span.end.line, character: r.span.end.column } } },
      message: r.message,
    })),
  };
}
