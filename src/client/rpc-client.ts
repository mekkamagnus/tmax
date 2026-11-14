#!/usr/bin/env bun
/**
 * @file rpc-client.ts
 * @description JSON-RPC 2.0 client library for the tmax daemon.
 *   Extracted verbatim from bin/tmaxclient (#250) so the compiled binary can
 *   run client verbs in-process (the binary cannot shell out to bin/*).
 *   CLI surface lives in ./cli.ts; bin/tmaxclient is a thin shim over it.
 */

import { defaultSocketPath } from '../core/socket-path.ts';import { Socket } from 'net';
import { userInfo } from 'os';
import { spawnSync, spawn } from 'child_process';
import { resolve as pathResolve } from 'path';
import { readFileSync } from 'fs';
// Single source of truth for the wire-protocol version (RFC-025 #1 / SPEC-070).
// Deliberately the first src import here: a second hardcoded copy of the
// version in this client would re-create the exact version-drift hazard this
// feature prevents.
import { PROTOCOL_VERSION } from '../server/rpc/types.ts';

// JSON-RPC 2.0 interfaces
export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
  /** Client-declared wire-protocol version (RFC-025 #1 / SPEC-070). */
  protocolVersion?: number;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class TmaxClient {
  private socketPath: string;
  private connection: Socket | null = null;

  constructor(socketPath?: string) {
    this.socketPath = socketPath || this.getDefaultSocketPath();
  }

  /**
   * Get the default socket path
   */
  private getDefaultSocketPath(): string {
    return defaultSocketPath();
  }

  /**
   * Connect to the server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connection = new Socket();

      // Bounded connect timeout: a wedged daemon whose socket is bound but not
      // responding should fail fast, not block indefinitely. #75 / BUG-57.
      const connectTimer = setTimeout(() => {
        this.connection?.destroy();
        reject(new Error('connect timeout'));
      }, 3000);

      this.connection.connect(this.socketPath, () => {
        clearTimeout(connectTimer);
        resolve();
      });

      this.connection.on('error', (err) => {
        clearTimeout(connectTimer);
        reject(err);
      });
    });
  }

  /**
   * Send a request to the server
   */
  async sendRequest(method: string, params: any, timeoutMs: number = 30000): Promise<any> {
    if (!this.connection) {
      throw new Error('Not connected to server');
    }
    // Captured OUTSIDE the promise executor: the guard above narrows it here;
    // inside the callback TS cannot (close() may race). A racing close()
    // destroys the socket, which fails the pending request — safe.
    const connection = this.connection;

    const requestId = Date.now();
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params,
      protocolVersion: PROTOCOL_VERSION
    };

    return new Promise((resolve, reject) => {
      let buffer = '';
      // Bounded request timeout: a wedged daemon that accepted the connection
      // but never responds should fail fast, not block indefinitely. #75/BUG-57.
      const requestTimer = setTimeout(() => {
        connection.removeListener('data', responseHandler);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);
      const responseHandler = (data: Buffer) => {
        try {
          buffer += data.toString();
          const responses = this.parseMultipleResponses(buffer);

          for (const response of responses) {
            if (response.id === requestId) {
              clearTimeout(requestTimer);
              connection.removeListener('data', responseHandler);

              if (response.error) {
                reject(new Error(`${response.error.code}: ${response.error.message}`));
              } else {
                resolve(response.result);
              }
              return;
            }
          }
        } catch (error) {
          clearTimeout(requestTimer);
          this.connection?.removeListener('data', responseHandler);
          reject(error);
        }
      };

      connection.on('data', responseHandler);

      // Send request
      connection.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * Parse multiple JSON-RPC responses from a single data chunk
   */
  private parseMultipleResponses(data: string): JSONRPCResponse[] {
    const responses: JSONRPCResponse[] = [];
    let startPos = 0;
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < data.length; i++) {
      const char = data[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\' && inString) {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') {
          if (braceCount === 0) {
            startPos = i;
          }
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            try {
              const responseStr = data.substring(startPos, i + 1);
              const response = JSON.parse(responseStr.trim());
              if (response && typeof response === 'object') {
                responses.push(response);
              }
            } catch (e) {
              console.error('Error parsing JSON response:', e);
            }
          }
        }
      }
    }

    return responses;
  }

  /**
   * Open a file in the server
   */
  async openFile(filepath: string, options?: { wait?: boolean; workspaceId?: string }): Promise<void> {
    const wait = options?.wait ?? true;

    try {
      await this.sendRequest('open', {
        filepath,
        wait,
        ...(options?.workspaceId ? { workspaceId: options.workspaceId } : {})
      });

      if (wait) {
        // For now, just return after sending the request
        // In a real implementation, we'd wait for the buffer to be closed
        return;
      }
    } catch (error) {
      // Re-throw so callers decide: the non-TUI open loop exits 1, while
      // `--tui` mode is best-effort (one bad file does not abort the launch).
      // #52 / BUG-34.
      throw error;
    }
  }

  /**
   * Evaluate T-Lisp code
   */
  async eval(code: string, extraParams?: Record<string, any>): Promise<any> {
    try {
      return await this.sendRequest('eval', { code, ...extraParams });
    } catch (error) {
      console.error('Error evaluating code:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  /**
   * Execute a command
   */
  async executeCommand(command: string, params?: any): Promise<any> {
    try {
      return await this.sendRequest('command', { command, ...params });
    } catch (error) {
      console.error(`Error executing command ${command}:`, error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  /**
   * Query server state
   */
  async query(query: string, params?: any): Promise<any> {
    try {
      return await this.sendRequest('query', { query, ...params });
    } catch (error) {
      console.error('Error querying server:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  /**
   * Ping the server
   */
  async ping(): Promise<boolean> {
    try {
      // Short timeout (3s) so is_running returns quickly against a wedged
      // daemon whose socket is bound but RPC handler isn't ready. #75/BUG-57.
      await this.sendRequest('ping', {}, 3000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close the connection
   */
  close(): void {
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }
  }
}

/**
 * Parse a key sequence string into individual key strings.
 * Supports <Escape>, <Enter>, <Space>, <Tab>, <Backspace>, and single characters.
 */
export function parseKeySequence(sequence: string): string[] {
  const keys: string[] = [];
  let i = 0;
  while (i < sequence.length) {
    if (sequence[i] === '<') {
      const end = sequence.indexOf('>', i);
      if (end !== -1) {
        const keyName = sequence.substring(i + 1, end);
        const keyMap: Record<string, string> = {
          'Escape': '\x1b',
          'Enter': '\r',
          'Space': ' ',
          'Tab': '\t',
          'Backspace': '\x7f',
          'SPC': ' ',
          'RET': '\r',
          'ESC': '\x1b',
          'TAB': '\t',
          'BS': '\x7f',
          'DEL': '\x7f',
        };
        // #134: support <C-letter> and <M-letter> notation (align with tmax-use keys.ts)
        let resolved = keyMap[keyName];
        if (resolved === undefined) {
          const ctrl = keyName.match(/^C-([a-zA-Z])$/);
          const meta = keyName.match(/^M-(.)$/);
          if (ctrl) resolved = String.fromCharCode(ctrl[1]!.toLowerCase().charCodeAt(0) - 96);
          else if (meta) resolved = '\x1b' + meta[1];
          else resolved = keyName;
        }
        keys.push(resolved);
        i = end + 1;
        continue;
      }
    }
    keys.push(sequence[i]!);
    i++;
  }
  return keys;
}

export function parseSingleKey(key: string): string {
  const bracketed = key.startsWith('<') && key.endsWith('>') ? key.slice(1, -1) : key;
  const keyMap: Record<string, string> = {
    'Escape': '\x1b',
    'Enter': '\r',
    'Space': ' ',
    'Tab': '\t',
    'Backspace': '\x7f',
    'SPC': ' ',
    'RET': '\r',
    'ESC': '\x1b',
    'TAB': '\t',
    'BS': '\x7f',
    'DEL': '\x7f',
  };
  return keyMap[bracketed] ?? key;
}
