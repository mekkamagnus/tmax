/**
 * @file lsp-diagnostics.ts
 * @description LSP diagnostics API functions for tmax editor
 * Provides T-Lisp API for listing and managing language server diagnostics.
 *
 * CHORE-39 Phase 4: diagnostics live on EditorModel (lspDiagnostics,
 * cursorPosition). This factory reads/writes them through the State monad
 * (runModel + readModelField/setModelField) instead of closing over a mutable
 * state callback.
 */

import type { LSPDiagnostic } from "../../core/types.ts";
import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNumber, createString, createBoolean, createList } from "../../tlisp/values.ts";
import { Either } from "../../utils/task-either.ts";
import { runModel, readModelField, setModelField, type EditorModelAccess } from "./state-context.ts";

/**
 * Create LSP diagnostics API operations for T-Lisp.
 * Reads/writes diagnostics through EditorModel via the State monad.
 */
export function createLSPDiagnosticsOps(
  access: EditorModelAccess
): Map<string, TLispFunctionImpl> {
  const ops = new Map<string, TLispFunctionImpl>();

  const getDiagnostics = (): LSPDiagnostic[] =>
    [...(runModel(access, readModelField("lspDiagnostics")) ?? [])];
  const getCurrentLine = (): number =>
    runModel(access, readModelField("cursorPosition")).line;
  const clearDiagnostics = (): void => {
    runModel(access, setModelField("lspDiagnostics", []));
  };

  // (lsp-diagnostics-list) - List all diagnostics
  ops.set("lsp-diagnostics-list", () => Either.right(lspDiagnosticsList(getDiagnostics())));

  // (lsp-diagnostics-for-line <line>) - Get diagnostics for specific line
  ops.set("lsp-diagnostics-for-line", (args) => {
    const lineArg = args[0];
    const line = lineArg?.type === "number" ? lineArg.value as number : 0;
    return Either.right(lspDiagnosticsForLine(line, getDiagnostics()));
  });

  // (lsp-diagnostics-current-line) - Get diagnostics for current cursor line
  ops.set("lsp-diagnostics-current-line", () =>
    Either.right(lspDiagnosticsForLine(getCurrentLine(), getDiagnostics())));

  // (lsp-diagnostics-count) - Get diagnostic count by severity
  ops.set("lsp-diagnostics-count", () => Either.right(lspDiagnosticsCount(getDiagnostics())));

  // (lsp-diagnostics-clear) - Clear all diagnostics
  ops.set("lsp-diagnostics-clear", () => {
    clearDiagnostics();
    return Either.right(createBoolean(true));
  });

  // (lsp-diagnostics-has-errors) - Check if there are any errors
  ops.set("lsp-diagnostics-has-errors", () =>
    Either.right(createBoolean(lspDiagnosticsHasErrors(getDiagnostics()))));

  return ops;
}

/**
 * Get all diagnostics as a T-Lisp list of alists.
 * Pure helper — operates on a diagnostics array snapshot.
 */
export function lspDiagnosticsList(diagnostics: LSPDiagnostic[]): TLispValue {
  if (diagnostics.length === 0) {
    return createList([]);
  }

  const diagnosticLists = diagnostics.map(diag => {
    const entries: TLispValue[] = [
      createList([createString("range"), createList([
        createList([createString("start"), createList([
          createNumber(diag.range.start.line),
          createNumber(diag.range.start.column)
        ])]),
        createList([createString("end"), createList([
          createNumber(diag.range.end.line),
          createNumber(diag.range.end.column)
        ])]),
      ])]),
      createList([createString("severity"), createNumber(diag.severity)]),
      createList([createString("message"), createString(diag.message)]),
    ];
    if (diag.source) entries.push(createList([createString("source"), createString(diag.source)]));
    if (diag.code !== undefined) entries.push(createList([createString("code"), createString(String(diag.code))]));
    return createList(entries);
  });

  return createList(diagnosticLists);
}

/**
 * Get diagnostics for a specific line. Pure helper.
 * @param line - Line number (0-based)
 */
export function lspDiagnosticsForLine(line: number, diagnostics: LSPDiagnostic[]): TLispValue {
  const lineDiagnostics = diagnostics.filter(
    d => d.range.start.line <= line && d.range.end.line >= line
  );

  if (lineDiagnostics.length === 0) {
    return createList([]);
  }

  const diagnosticLists = lineDiagnostics.map(diag => {
    const entries: TLispValue[] = [
      createList([createString("severity"), createNumber(diag.severity)]),
      createList([createString("message"), createString(diag.message)]),
    ];
    if (diag.source) entries.push(createList([createString("source"), createString(diag.source)]));
    return createList(entries);
  });

  return createList(diagnosticLists);
}

/**
 * Get diagnostic count by severity. Pure helper.
 * @returns Alist with counts for each severity level
 */
export function lspDiagnosticsCount(diagnostics: LSPDiagnostic[]): TLispValue {
  let errors = 0, warnings = 0, info = 0, hints = 0;
  for (const d of diagnostics) {
    if (d.severity === 1) errors++;
    else if (d.severity === 2) warnings++;
    else if (d.severity === 3) info++;
    else if (d.severity === 4) hints++;
  }

  return createList([
    createList([createString("errors"), createNumber(errors)]),
    createList([createString("warnings"), createNumber(warnings)]),
    createList([createString("info"), createNumber(info)]),
    createList([createString("hints"), createNumber(hints)]),
    createList([createString("total"), createNumber(diagnostics.length)]),
  ]);
}

/**
 * Check if there are any error-severity diagnostics. Pure helper.
 */
export function lspDiagnosticsHasErrors(diagnostics: LSPDiagnostic[]): boolean {
  return diagnostics.some(d => d.severity === 1);
}

/**
 * Get severity name as string
 * @param severity - Severity number (1-4)
 * @returns Severity name
 */
export function lspSeverityName(severity: number): string {
  switch (severity) {
    case 1: return "Error";
    case 2: return "Warning";
    case 3: return "Information";
    case 4: return "Hint";
    default: return "Unknown";
  }
}
