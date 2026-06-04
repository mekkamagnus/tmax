import { beforeEach, describe, expect, test } from "bun:test";
import type { LSPDiagnostic } from "../../src/core/types.ts";
import { createLSPDiagnosticsOps } from "../../src/editor/api/lsp-diagnostics.ts";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { expectRight, expectTlispList } from "../helpers/editor-fixture.ts";

describe("LSP Diagnostics T-Lisp API", () => {
  let interpreter: TLispInterpreterImpl;

  beforeEach(() => {
    const diagnostics: LSPDiagnostic[] = [
      {
        range: {
          start: { line: 0, column: 6 },
          end: { line: 0, column: 19 },
        },
        severity: 1,
        message: "Type error",
        source: "typescript",
      },
      {
        range: {
          start: { line: 1, column: 0 },
          end: { line: 1, column: 11 },
        },
        severity: 2,
        message: "Unused variable",
        source: "typescript",
      },
    ];
    const state = { state: { lspDiagnostics: diagnostics, cursorPosition: { line: 0 } } };

    interpreter = new TLispInterpreterImpl();
    for (const [name, operation] of createLSPDiagnosticsOps(() => state)) {
      interpreter.defineBuiltin(name, operation);
    }
  });

  test("returns all diagnostics", () => {
    const diagnostics = expectTlispList(expectRight(interpreter.execute("(lsp-diagnostics-list)")));

    expect(diagnostics).toHaveLength(2);
  });

  test("returns diagnostic counts by severity", () => {
    const counts = expectTlispList(expectRight(interpreter.execute("(lsp-diagnostics-count)")));

    expect(counts).toHaveLength(5);
  });
});
