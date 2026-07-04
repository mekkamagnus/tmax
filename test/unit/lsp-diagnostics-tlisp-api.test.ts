import { beforeEach, describe, expect, test } from "bun:test";
import type { LSPDiagnostic } from "../../src/core/types.ts";
import { createLSPDiagnosticsOps } from "../../src/editor/api/lsp-diagnostics.ts";
import type { EditorModelAccess } from "../../src/editor/api/state-context.ts";
import type { EditorModel } from "../../src/editor/functional/model.ts";
import { initialModel } from "../../src/editor/functional/model.ts";
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
    // CHORE-39 Phase 4: lsp-diagnostics ops now read/write EditorModel via the
    // State monad. Test harness mirrors the editor runtime's model access.
    let model: EditorModel = {
      ...initialModel(),
      lspDiagnostics: diagnostics,
      cursorPosition: { line: 0, column: 0 },
    };
    const access: EditorModelAccess = {
      getModel: () => model,
      applyModel: (m) => { model = m; },
    };

    interpreter = new TLispInterpreterImpl();
    for (const [name, operation] of createLSPDiagnosticsOps(access)) {
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
