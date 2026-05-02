/**
 * @file lsp-diagnostics.ts
 * @description LSP diagnostics API functions for tmax editor
 * Provides T-Lisp API for listing and managing language server diagnostics
 */

import type { LSPDiagnostic } from "../../core/types.ts";
import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList } from "../../tlisp/values.ts";

/**
 * Create LSP diagnostics API operations for T-Lisp
 * @param getCurrentBuffer - Callback to get current editor state
 * @returns Map of function names to implementations
 */
export function createLSPDiagnosticsOps(
  getCurrentBuffer: () => {
    state: {
      lspDiagnostics?: LSPDiagnostic[];
      cursorPosition: { line: number };
    }
  }
): Map<string, TLispFunctionImpl> {
  const ops = new Map<string, TLispFunctionImpl>();

  // (lsp-diagnostics-list) - List all diagnostics
  ops.set("lsp-diagnostics-list", () => lspDiagnosticsList(getCurrentBuffer));

  // (lsp-diagnostics-for-line <line>) - Get diagnostics for specific line
  ops.set("lsp-diagnostics-for-line", (args) => {
    const lineArg = args[0];
    const line = lineArg?.type === "number" ? lineArg.value : 0;
    return lspDiagnosticsForLine(line, getCurrentBuffer);
  });

  // (lsp-diagnostics-current-line) - Get diagnostics for current cursor line
  ops.set("lsp-diagnostics-current-line", () => lspDiagnosticsCurrentLine(getCurrentBuffer));

  // (lsp-diagnostics-count) - Get diagnostic count by severity
  ops.set("lsp-diagnostics-count", () => lspDiagnosticsCount(getCurrentBuffer));

  // (lsp-diagnostics-clear) - Clear all diagnostics
  ops.set("lsp-diagnostics-clear", () => lspDiagnosticsClear(getCurrentBuffer));

  // (lsp-diagnostics-has-errors) - Check if there are any errors
  ops.set("lsp-diagnostics-has-errors", () => lspDiagnosticsHasErrors(getCurrentBuffer));

  return ops;
}

/**
 * Get all diagnostics from LSP client
 * @param getCurrentBuffer - Callback to get current buffer
 * @returns List of diagnostics or empty list
 */
export function lspDiagnosticsList(
  getCurrentBuffer: () => { state: { lspDiagnostics?: LSPDiagnostic[] } }
): TLispValue {
  try {
    const editor = getCurrentBuffer();
    const diagnostics = editor.state.lspDiagnostics || [];

    if (diagnostics.length === 0) {
      return createList([]);
    }

    // Convert diagnostics to T-Lisp list of alists
    const diagnosticLists = diagnostics.map(diag => {
      return createList([
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
        diag.source ? createList([createString("source"), createString(diag.source)]) : createNil(),
        diag.code !== undefined ? createList([createString("code"), createString(String(diag.code))]) : createNil(),
      ].filter(v => {
        // Filter out null values (filter creates proper T-Lisp null check)
        const nullVal = createNull();
        return JSON.stringify(v) !== JSON.stringify(nullVal);
      }));
    });

    return createList(diagnosticLists);
  } catch (error) {
    return createList([]);
  }
}

/**
 * Get diagnostics for a specific line
 * @param line - Line number (0-based)
 * @param getCurrentBuffer - Callback to get current buffer
 * @returns List of diagnostics on that line
 */
export function lspDiagnosticsForLine(
  line: number,
  getCurrentBuffer: () => { state: { lspDiagnostics?: LSPDiagnostic[]; cursorPosition: { line: number } } }
): TLispValue {
  try {
    const editor = getCurrentBuffer();
    const diagnostics = editor.state.lspDiagnostics || [];

    // Filter diagnostics that affect this line
    const lineDiagnostics = diagnostics.filter(
      d => d.range.start.line <= line && d.range.end.line >= line
    );

    if (lineDiagnostics.length === 0) {
      return createList([]);
    }

    // Convert to T-Lisp list format
    const diagnosticLists = lineDiagnostics.map(diag => {
      return createList([
        createList([createString("severity"), createNumber(diag.severity)]),
        createList([createString("message"), createString(diag.message)]),
        diag.source ? createList([createString("source"), createString(diag.source)]) : createNil(),
      ].filter(v => {
        const nilVal = createNil();
        return JSON.stringify(v) !== JSON.stringify(nilVal);
      }));
    });

    return createList(diagnosticLists);
  } catch (error) {
    return createList([]);
  }
}

/**
 * Get diagnostics for current cursor line
 * @param getCurrentBuffer - Callback to get current buffer
 * @returns List of diagnostics on current line
 */
export function lspDiagnosticsCurrentLine(
  getCurrentBuffer: () => { state: { lspDiagnostics?: LSPDiagnostic[]; cursorPosition: { line: number } } }
): TLispValue {
  try {
    const editor = getCurrentBuffer();
    const currentLine = editor.state.cursorPosition.line;
    return lspDiagnosticsForLine(currentLine, getCurrentBuffer);
  } catch (error) {
    return createList([]);
  }
}

/**
 * Get diagnostic count by severity
 * @param getCurrentBuffer - Callback to get current buffer
 * @returns Alist with counts for each severity level
 */
export function lspDiagnosticsCount(
  getCurrentBuffer: () => { state: { lspDiagnostics?: LSPDiagnostic[] } }
): TLispValue {
  try {
    const editor = getCurrentBuffer();
    const diagnostics = editor.state.lspDiagnostics || [];

    const errors = diagnostics.filter(d => d.severity === 1).length;
    const warnings = diagnostics.filter(d => d.severity === 2).length;
    const info = diagnostics.filter(d => d.severity === 3).length;
    const hints = diagnostics.filter(d => d.severity === 4).length;

    return createList([
      createList([createString("errors"), createNumber(errors)]),
      createList([createString("warnings"), createNumber(warnings)]),
      createList([createString("info"), createNumber(info)]),
      createList([createString("hints"), createNumber(hints)]),
      createList([createString("total"), createNumber(diagnostics.length)]),
    ]);
  } catch (error) {
    return createList([
      createList([createString("errors"), createNumber(0)]),
      createList([createString("warnings"), createNumber(0)]),
      createList([createString("info"), createNumber(0)]),
      createList([createString("hints"), createNumber(0)]),
      createList([createString("total"), createNumber(0)]),
    ]);
  }
}

/**
 * Clear all diagnostics
 * @param getCurrentBuffer - Callback to get current buffer
 * @returns true on success
 */
export function lspDiagnosticsClear(
  getCurrentBuffer: () => { state: { lspDiagnostics?: LSPDiagnostic[] } }
): TLispValue {
  try {
    const editor = getCurrentBuffer();
    editor.state.lspDiagnostics = [];
    return createBoolean(true);
  } catch (error) {
    return createBoolean(false);
  }
}

/**
 * Check if there are any diagnostics
 * @param getCurrentBuffer - Callback to get current buffer
 * @returns true if there are diagnostics
 */
export function lspDiagnosticsHasErrors(
  getCurrentBuffer: () => { state: { lspDiagnostics?: LSPDiagnostic[] } }
): TLispValue {
  try {
    const editor = getCurrentBuffer();
    const diagnostics = editor.state.lspDiagnostics || [];
    const hasErrors = diagnostics.some(d => d.severity === 1);
    return createBoolean(hasErrors);
  } catch (error) {
    return createBoolean(false);
  }
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
