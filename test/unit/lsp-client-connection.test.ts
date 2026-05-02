/**
 * @file lsp-client-connection.test.ts
 * @description Tests for LSP Client Connection functionality (US-3.1.1)
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { LSPClient } from "../../src/lsp/client.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("LSP Client Connection (US-3.1.1)", () => {
  let mockTerminal: MockTerminal;
  let mockFileSystem: MockFileSystem;
  let lspClient: LSPClient;

  beforeEach(() => {
    mockTerminal = new MockTerminal();
    mockFileSystem = new MockFileSystem();
    lspClient = new LSPClient(mockTerminal, mockFileSystem);
  });

  describe("Language Server Detection", () => {
    test("TypeScript files should trigger typescript-language-server connection", async () => {
      const filename = "example.ts";
      const content = "const x: number = 42;";

      // Create buffer with TypeScript file
      await lspClient.onFileOpen(filename, content);

      // Check that LSP client attempted connection
      const isConnected = lspClient.isConnected();
      expect(isConnected).toBe(true);

      // Check that the correct language server was started
      const serverName = lspClient.getServerName();
      expect(serverName).toBe("typescript-language-server");
    });

    test("TypeScript JSX files should trigger typescript-language-server connection", async () => {
      const filename = "component.tsx";
      const content = "const Component = () => <div>Hello</div>;";

      await lspClient.onFileOpen(filename, content);

      expect(lspClient.isConnected()).toBe(true);
      expect(lspClient.getServerName()).toBe("typescript-language-server");
    });

    test("JavaScript files should trigger typescript-language-server connection", async () => {
      const filename = "script.js";
      const content = "function hello() { return 'world'; }";

      await lspClient.onFileOpen(filename, content);

      expect(lspClient.isConnected()).toBe(true);
      expect(lspClient.getServerName()).toBe("typescript-language-server");
    });

    test("Non-TypeScript files should not trigger LSP connection", async () => {
      const filename = "README.md";
      const content = "# My Project";

      await lspClient.onFileOpen(filename, content);

      expect(lspClient.isConnected()).toBe(false);
    });
  });

  describe("LSP Connection Status", () => {
    test("Successful connection shows 'LSP connected' in status line", async () => {
      const filename = "test.ts";
      const content = "const x = 1;";

      await lspClient.onFileOpen(filename, content);

      const statusMessage = lspClient.getStatusMessage();
      expect(statusMessage).toContain("LSP connected");
    });

    test("Status message includes language server name", async () => {
      const filename = "test.ts";
      const content = "const x = 1;";

      await lspClient.onFileOpen(filename, content);

      const statusMessage = lspClient.getStatusMessage();
      expect(statusMessage).toContain("typescript-language-server");
    });

    test("Disconnected status shows no LSP connection", () => {
      const statusMessage = lspClient.getStatusMessage();
      expect(statusMessage).not.toContain("LSP");
    });
  });

  describe("Error Handling", () => {
    test("Failed connection logs error but keeps editor functional", async () => {
      // Create an LSP client that will fail to connect
      const failingClient = new LSPClient(mockTerminal, mockFileSystem, {
        shouldFailToConnect: true,
      });

      const filename = "test.ts";
      const content = "const x = 1;";

      // Should not throw
      await failingClient.onFileOpen(filename, content);

      // Editor should remain functional (client exists)
      expect(failingClient).toBeDefined();

      // Connection should show as disconnected
      expect(failingClient.isConnected()).toBe(false);

      // Error should be logged
      const errors = failingClient.getErrors();
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("typescript-language-server");
    });

    test("Multiple failed connections don't crash the editor", async () => {
      const failingClient = new LSPClient(mockTerminal, mockFileSystem, {
        shouldFailToConnect: true,
      });

      // Try multiple connections
      await failingClient.onFileOpen("test1.ts", "const x = 1;");
      await failingClient.onFileOpen("test2.ts", "const y = 2;");
      await failingClient.onFileOpen("test3.ts", "const z = 3;");

      // Editor should still be functional
      expect(failingClient).toBeDefined();
      expect(failingClient.isConnected()).toBe(false);
    });
  });

  describe("LSP Lifecycle", () => {
    test("LSP client can disconnect properly", async () => {
      const filename = "test.ts";
      const content = "const x = 1;";

      await lspClient.onFileOpen(filename, content);
      expect(lspClient.isConnected()).toBe(true);

      await lspClient.disconnect();
      expect(lspClient.isConnected()).toBe(false);
    });

    test("Reconnecting after disconnect works", async () => {
      const filename = "test.ts";
      const content = "const x = 1;";

      // First connection
      await lspClient.onFileOpen(filename, content);
      expect(lspClient.isConnected()).toBe(true);

      // Disconnect
      await lspClient.disconnect();
      expect(lspClient.isConnected()).toBe(false);

      // Reconnect by opening another file
      await lspClient.onFileOpen("test2.ts", "const y = 2;");
      expect(lspClient.isConnected()).toBe(true);
    });
  });

  describe("File Language Detection", () => {
    test("Correctly detects TypeScript file types", () => {
      expect(lspClient.detectLanguage("file.ts")).toBe("typescript");
      expect(lspClient.detectLanguage("file.tsx")).toBe("typescript");
      expect(lspClient.detectLanguage("file.js")).toBe("javascript");
      expect(lspClient.detectLanguage("file.jsx")).toBe("javascript");
    });

    test("Returns null for unsupported file types", () => {
      expect(lspClient.detectLanguage("file.md")).toBeNull();
      expect(lspClient.detectLanguage("file.txt")).toBeNull();
      expect(lspClient.detectLanguage("file.json")).toBeNull();
      expect(lspClient.detectLanguage("file.css")).toBeNull();
    });

    test("Handles files with multiple extensions", () => {
      expect(lspClient.detectLanguage("file.test.ts")).toBe("typescript");
      expect(lspClient.detectLanguage("file.spec.tsx")).toBe("typescript");
    });
  });
});
