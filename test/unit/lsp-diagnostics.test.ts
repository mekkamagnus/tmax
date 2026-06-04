import { beforeEach, describe, expect, test } from "bun:test";
import type { LSPDiagnostic } from "../../src/core/types.ts";
import { LSPClient } from "../../src/lsp/client.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";

function diagnostic(
  severity: LSPDiagnostic["severity"],
  line: number = 0,
  endLine: number = line,
): LSPDiagnostic {
  return {
    range: {
      start: { line, column: 0 },
      end: { line: endLine, column: 10 },
    },
    severity,
    message: `Severity ${severity}`,
    source: "test",
  };
}

describe("LSP diagnostics", () => {
  let client: LSPClient;

  beforeEach(() => {
    client = new LSPClient(new MockTerminal(), new MockFileSystem());
  });

  test("preserves every diagnostic severity", () => {
    const diagnostics = [
      diagnostic(1),
      diagnostic(2),
      diagnostic(3),
      diagnostic(4),
    ];

    client.updateDiagnostics(diagnostics);

    expect(client.getDiagnostics().map((item) => item.severity)).toEqual([1, 2, 3, 4]);
  });

  test("returns a defensive copy of diagnostics", () => {
    client.updateDiagnostics([diagnostic(1)]);

    const result = client.getDiagnostics();
    result.push(diagnostic(2));

    expect(client.getDiagnostics()).toHaveLength(1);
  });

  test("filters diagnostics that overlap a line", () => {
    client.updateDiagnostics([
      diagnostic(1, 0),
      diagnostic(2, 1, 3),
      diagnostic(3, 4),
    ]);

    expect(client.getDiagnosticsForLine(2).map((item) => item.severity)).toEqual([2]);
    expect(client.getDiagnosticsForLine(4).map((item) => item.severity)).toEqual([3]);
  });

  test("clears diagnostics", () => {
    client.updateDiagnostics([diagnostic(1), diagnostic(2)]);

    client.clearDiagnostics();

    expect(client.getDiagnostics()).toEqual([]);
  });

  test("simulates TypeScript diagnostics after opening a supported file", async () => {
    await client.onFileOpen("/test.ts", "const value: string = 123;");
    await client.simulateDiagnostics("/test.ts", "const value: string = 123;");

    expect(client.getDiagnostics().some((item) => item.severity === 1)).toBe(true);
  });
});
