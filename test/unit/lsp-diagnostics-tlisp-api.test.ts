/**
 * LSP Diagnostics T-Lisp API Tests
 *
 * Tests for T-Lisp API functions for LSP diagnostics.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import type { LSPDiagnostic } from "../../src/core/types.ts";

describe("LSP Diagnostics T-Lisp API", () => {
  let interpreter: TLispInterpreterImpl;

  beforeEach(() => {
    interpreter = new TLispInterpreterImpl();

    // Register mock diagnostics functions
    const mockDiagnostics: LSPDiagnostic[] = [
      {
        range: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 19 }
        },
        severity: 1,
        message: "Type error",
        source: "typescript"
      },
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 11 }
        },
        severity: 2,
        message: "Unused variable",
        source: "typescript"
      }
    ];

    // Mock the getCurrentBuffer function
    interpreter.defineBuiltin("lsp-diagnostics-list", () => {
      return {
        type: "list",
        value: mockDiagnostics.map(d => ({
          type: "list",
          value: [
            { type: "list", value: [
              { type: "string", value: "severity" },
              { type: "number", value: d.severity }
            ]},
            { type: "list", value: [
              { type: "string", value: "message" },
              { type: "string", value: d.message }
            ]},
            { type: "list", value: [
              { type: "string", value: "source" },
              { type: "string", value: d.source || "" }
            ]}
          ]
        }))
      };
    });

    interpreter.defineBuiltin("lsp-diagnostics-count", () => {
      return {
        type: "list",
        value: [
          { type: "list", value: [
            { type: "string", value: "errors" },
            { type: "number", value: 1 }
          ]},
          { type: "list", value: [
            { type: "string", value: "warnings" },
            { type: "number", value: 1 }
          ]},
          { type: "list", value: [
            { type: "string", value: "info" },
            { type: "number", value: 0 }
          ]},
          { type: "list", value: [
            { type: "string", value: "hints" },
            { type: "number", value: 0 }
          ]},
          { type: "list", value: [
            { type: "string", value: "total" },
            { type: "number", value: 2 }
          ]}
        ]
      };
    });
  });

  describe("lsp-diagnostics-list", () => {
    test("returns list of diagnostics", () => {
      const result = interpreter.execute("(lsp-diagnostics-list)");
      expect(result._tag).toBe("Right");

      const diagnostics = result.right;
      expect(diagnostics.type).toBe("list");
      expect(diagnostics.value).toHaveLength(2);
    });
  });

  describe("lsp-diagnostics-count", () => {
    test("returns diagnostic counts by severity", () => {
      const result = interpreter.execute("(lsp-diagnostics-count)");
      expect(result._tag).toBe("Right");

      const counts = result.right;
      expect(counts.type).toBe("list");

      // Should have 5 entries (errors, warnings, info, hints, total)
      expect(counts.value).toHaveLength(5);
    });
  });
});
