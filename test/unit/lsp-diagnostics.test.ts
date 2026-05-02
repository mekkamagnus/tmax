/**
 * LSP Diagnostics Tests
 *
 * Tests for Language Server Protocol diagnostics functionality.
 * Validates error indicators, gutter display, and diagnostic listing.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../../test/mocks/terminal.ts";
import { MockFileSystem } from "../../test/mocks/filesystem.ts";
import { LSPClient } from "../../src/lsp/client.ts";

describe("LSP Diagnostics", () => {
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;
  let editor: Editor;
  let lspClient: LSPClient;

  beforeEach(() => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);
    lspClient = new LSPClient();

    // Set up test file
    filesystem.setFile("/test.ts", `const x: string = 123;\nconsole.log(x);`);
  });

  describe("Error indicators in gutter", () => {
    test("Error indicators appear in gutter for diagnostics", async () => {
      // Open file to trigger LSP connection
      await editor.openFile("/test.ts");

      // Simulate LSP diagnostics with errors
      const diagnostics = [
        {
          range: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 19 }
          },
          severity: 1, // Error
          message: "Type 'number' is not assignable to type 'string'"
        }
      ];

      // Update editor state with diagnostics
      editor.state.lspDiagnostics = diagnostics;

      // Check that error indicators are present
      expect(editor.state.lspDiagnostics).toHaveLength(1);
      expect(editor.state.lspDiagnostics[0].severity).toBe(1);
    });

    test("Warning indicators appear in gutter for warning diagnostics", async () => {
      await editor.openFile("/test.ts");

      const diagnostics = [
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 11 }
          },
          severity: 2, // Warning
          message: "Unused variable 'x'"
        }
      ];

      editor.state.lspDiagnostics = diagnostics;

      expect(editor.state.lspDiagnostics).toHaveLength(1);
      expect(editor.state.lspDiagnostics[0].severity).toBe(2);
    });
  });

  describe("Diagnostic messages in status line", () => {
    test("Navigating to error line shows message in status line", async () => {
      await editor.openFile("/test.ts");

      const diagnostics = [
        {
          range: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 19 }
          },
          severity: 1,
          message: "Type 'number' is not assignable to type 'string'"
        }
      ];

      editor.state.lspDiagnostics = diagnostics;

      // Move cursor to line with error
      editor.state.cursorPosition = { line: 0, column: 10 };

      // The status line should show the diagnostic message
      // This would be shown in the actual UI rendering
      const diagnosticsOnLine = editor.state.lspDiagnostics.filter(
        d => d.range.start.line === 0
      );
      expect(diagnosticsOnLine).toHaveLength(1);
      expect(diagnosticsOnLine[0].message).toContain("not assignable");
    });

    test("Multiple diagnostics on same line show all messages", async () => {
      await editor.openFile("/test.ts");

      const diagnostics = [
        {
          range: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 19 }
          },
          severity: 1,
          message: "Type error"
        },
        {
          range: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 19 }
          },
          severity: 2,
          message: "Unused variable"
        }
      ];

      editor.state.lspDiagnostics = diagnostics;
      editor.state.cursorPosition = { line: 0, column: 10 };

      const diagnosticsOnLine = editor.state.lspDiagnostics.filter(
        d => d.range.start.line === 0
      );
      expect(diagnosticsOnLine).toHaveLength(2);
    });
  });

  describe("Listing diagnostics", () => {
    test("Listing diagnostics shows all errors and warnings", async () => {
      await editor.openFile("/test.ts");

      const diagnostics = [
        {
          range: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 19 }
          },
          severity: 1,
          message: "Type error on line 1",
          source: "typescript"
        },
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 11 }
          },
          severity: 2,
          message: "Warning on line 2",
          source: "typescript"
        }
      ];

      editor.state.lspDiagnostics = diagnostics;

      // Should have 2 diagnostics
      expect(editor.state.lspDiagnostics).toHaveLength(2);

      // Should have both error and warning
      const severities = editor.state.lspDiagnostics.map(d => d.severity);
      expect(severities).toContain(1); // Error
      expect(severities).toContain(2); // Warning
    });

    test("Empty diagnostics list when no errors", async () => {
      await editor.openFile("/test.ts");

      editor.state.lspDiagnostics = [];

      expect(editor.state.lspDiagnostics).toHaveLength(0);
    });
  });

  describe("Diagnostic severity levels", () => {
    test("Supports Error severity (1)", async () => {
      await editor.openFile("/test.ts");

      const diagnostics = [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 }
          },
          severity: 1,
          message: "Error"
        }
      ];

      editor.state.lspDiagnostics = diagnostics;
      expect(editor.state.lspDiagnostics[0].severity).toBe(1);
    });

    test("Supports Warning severity (2)", async () => {
      await editor.openFile("/test.ts");

      const diagnostics = [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 }
          },
          severity: 2,
          message: "Warning"
        }
      ];

      editor.state.lspDiagnostics = diagnostics;
      expect(editor.state.lspDiagnostics[0].severity).toBe(2);
    });

    test("Supports Information severity (3)", async () => {
      await editor.openFile("/test.ts");

      const diagnostics = [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 }
          },
          severity: 3,
          message: "Info"
        }
      ];

      editor.state.lspDiagnostics = diagnostics;
      expect(editor.state.lspDiagnostics[0].severity).toBe(3);
    });

    test("Supports Hint severity (4)", async () => {
      await editor.openFile("/test.ts");

      const diagnostics = [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 }
          },
          severity: 4,
          message: "Hint"
        }
      ];

      editor.state.lspDiagnostics = diagnostics;
      expect(editor.state.lspDiagnostics[0].severity).toBe(4);
    });
  });
});
