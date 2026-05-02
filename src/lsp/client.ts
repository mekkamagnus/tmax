/**
 * @file client.ts
 * @description LSP (Language Server Protocol) client implementation
 * Handles connections to language servers for IDE features
 */

import type { TerminalIO, FileSystem, LSPDiagnostic } from "../core/types.ts";

/**
 * LSP client configuration options
 */
export interface LSPClientOptions {
  shouldFailToConnect?: boolean;  // For testing error scenarios
}

/**
 * LSP client state
 */
interface LSPClientState {
  connected: boolean;
  serverName: string | null;
  language: string | null;
  errors: string[];
  diagnostics: LSPDiagnostic[];
}

/**
 * Language to server mapping
 */
const LANGUAGE_SERVERS: Record<string, string> = {
  typescript: "typescript-language-server",
  javascript: "typescript-language-server",
  // Future language servers can be added here
  // python: "pylsp",
  // rust: "rust-analyzer",
  // go: "gopls",
};

/**
 * File extension to language mapping
 */
const FILE_EXTENSIONS: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  // Future extensions can be added here
  // ".py": "python",
  // ".rs": "rust",
  // ".go": "go",
};

/**
 * LSP Client for managing language server connections
 */
export class LSPClient {
  private terminal: TerminalIO;
  private filesystem: FileSystem;
  private options: LSPClientOptions;
  private state: LSPClientState;

  constructor(
    terminal: TerminalIO,
    filesystem: FileSystem,
    options: LSPClientOptions = {}
  ) {
    this.terminal = terminal;
    this.filesystem = filesystem;
    this.options = options;
    this.state = {
      connected: false,
      serverName: null,
      language: null,
      errors: [],
      diagnostics: [],
    };
  }

  /**
   * Detect language from filename
   * @param filename - File name to detect language from
   * @returns Language string or null if unsupported
   */
  detectLanguage(filename: string): string | null {
    // Find the last extension (e.g., ".test.ts" -> ".ts")
    const lastDotIndex = filename.lastIndexOf(".");
    if (lastDotIndex === -1) {
      return null;
    }

    const extension = filename.substring(lastDotIndex);
    const language = FILE_EXTENSIONS[extension];
    return language || null;
  }

  /**
   * Get language server name for a language
   * @param language - Language string
   * @returns Server name or null if not configured
   */
  private getServerForLanguage(language: string): string | null {
    return LANGUAGE_SERVERS[language] || null;
  }

  /**
   * Connect to language server
   * @param serverName - Name of the language server to connect to
   * @returns Promise that resolves when connection is complete
   */
  private async connectToServer(serverName: string): Promise<void> {
    // Simulate connection attempt
    // In a real implementation, this would:
    // 1. Spawn the language server process
    // 2. Establish JSON-RPC communication via stdio
    // 3. Send initialize request
    // 4. Wait for initialized notification

    if (this.options.shouldFailToConnect) {
      const error = `Failed to connect to ${serverName}: Server not available`;
      this.state.errors.push(error);
      this.logError(error);
      return;
    }

    // Simulate successful connection
    this.state.connected = true;
    this.state.serverName = serverName;
    this.logInfo(`Connected to ${serverName}`);
  }

  /**
   * Handle file open event
   * @param filename - Name of the file being opened
   * @param content - Content of the file
   */
  async onFileOpen(filename: string, content: string): Promise<void> {
    // Detect language from filename
    const language = this.detectLanguage(filename);

    if (!language) {
      // Unsupported file type, do nothing
      return;
    }

    // Get the language server for this language
    const serverName = this.getServerForLanguage(language);

    if (!serverName) {
      // No server configured for this language
      this.logInfo(`No language server configured for ${language}`);
      return;
    }

    // Store the current language
    this.state.language = language;

    // Connect to the server
    await this.connectToServer(serverName);
  }

  /**
   * Disconnect from language server
   */
  async disconnect(): Promise<void> {
    if (!this.state.connected) {
      return;
    }

    // In a real implementation, this would:
    // 1. Send shutdown request
    // 2. Send exit notification
    // 3. Close the language server process

    this.state.connected = false;
    this.state.serverName = null;
    this.state.language = null;

    this.logInfo("Disconnected from language server");
  }

  /**
   * Check if client is connected
   * @returns true if connected to a language server
   */
  isConnected(): boolean {
    return this.state.connected;
  }

  /**
   * Get the name of the connected server
   * @returns Server name or null if not connected
   */
  getServerName(): string | null {
    return this.state.serverName;
  }

  /**
   * Get the current language
   * @returns Language string or null if no file is open
   */
  getLanguage(): string | null {
    return this.state.language;
  }

  /**
   * Get status message for display in UI
   * @returns Status message string
   */
  getStatusMessage(): string {
    if (!this.state.connected) {
      return "";
    }

    const serverName = this.state.serverName || "unknown";
    return `LSP connected (${serverName})`;
  }

  /**
   * Get list of errors that occurred
   * @returns Array of error messages
   */
  getErrors(): string[] {
    return [...this.state.errors];
  }

  /**
   * Clear error log
   */
  clearErrors(): void {
    this.state.errors = [];
  }

  /**
   * Update diagnostics from language server
   * @param diagnostics - Array of diagnostics
   */
  updateDiagnostics(diagnostics: LSPDiagnostic[]): void {
    this.state.diagnostics = diagnostics;
  }

  /**
   * Get current diagnostics
   * @returns Array of diagnostics
   */
  getDiagnostics(): LSPDiagnostic[] {
    return [...this.state.diagnostics];
  }

  /**
   * Clear all diagnostics
   */
  clearDiagnostics(): void {
    this.state.diagnostics = [];
  }

  /**
   * Get diagnostics for a specific line
   * @param line - Line number (0-based)
   * @returns Array of diagnostics on that line
   */
  getDiagnosticsForLine(line: number): LSPDiagnostic[] {
    return this.state.diagnostics.filter(
      d => d.range.start.line <= line && d.range.end.line >= line
    );
  }

  /**
   * Simulate receiving diagnostics from language server
   * In a real implementation, this would be called when the server sends diagnostic notifications
   * @param filename - File being analyzed
   * @param content - File content
   */
  async simulateDiagnostics(filename: string, content: string): Promise<void> {
    if (!this.state.connected) {
      return;
    }

    const language = this.state.language;
    if (!language) {
      return;
    }

    // Simulate diagnostics based on language
    // In a real implementation, this would come from the language server
    const diagnostics: LSPDiagnostic[] = [];

    if (language === "typescript" || language === "javascript") {
      // Simulate some common TypeScript/JavaScript errors
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        // Check for type errors (simple simulation)
        if (line.includes(": string") && line.includes("= ")) {
          const valueMatch = line.match(/=\s*(\d+)/);
          if (valueMatch) {
            diagnostics.push({
              range: {
                start: { line: index, character: line.indexOf(": string") },
                end: { line: index, character: line.length }
              },
              severity: 1,
              message: `Type 'number' is not assignable to type 'string'`,
              source: "typescript"
            });
          }
        }

        // Check for unused variables
        if (line.match(/const\s+(\w+)\s*=/)) {
          const varName = line.match(/const\s+(\w+)\s*=/)?.[1];
          if (varName && !content.includes(varName, line.indexOf(line) + line.length)) {
            diagnostics.push({
              range: {
                start: { line: index, character: line.indexOf(varName) },
                end: { line: index, character: line.indexOf(varName) + varName.length }
              },
              severity: 2,
              message: `'${varName}' is declared but its value is never read`,
              source: "typescript"
            });
          }
        }
      });
    }

    this.state.diagnostics = diagnostics;
  }

  /**
   * Log an error message
   * @param message - Error message to log
   */
  private logError(message: string): void {
    // In a real implementation, this would use a proper logging system
    console.error(`[LSP] ${message}`);
  }

  /**
   * Log an info message
   * @param message - Info message to log
   */
  private logInfo(message: string): void {
    // In a real implementation, this would use a proper logging system
    console.log(`[LSP] ${message}`);
  }
}
