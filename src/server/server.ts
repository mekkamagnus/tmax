#!/usr/bin/env bun
/**
 * @file server.ts
 * @description Server infrastructure for tmax editor with Unix socket support
 * Implements JSON-RPC 2.0 protocol for client communication
 */

import { createServer, Server, Socket } from 'net';
import { homedir, userInfo } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { Editor } from '../editor/editor.ts';
import { TerminalIOImpl } from '../core/terminal.ts';
import { FileSystemImpl } from '../core/filesystem.ts';
import { FunctionalTextBufferImpl } from '../core/buffer.ts';
import { EditorState } from '../core/types.ts';

// JSON-RPC 2.0 interfaces
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: any;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

interface ClientConnection {
  id: string;
  pid?: number;
  socket: Socket;
  connectedAt: Date;
}

export class TmaxServer {
  private server: Server;
  private socketPath: string;
  private editor: Editor;
  private clients: Map<string, ClientConnection>;
  private isRunning: boolean = false;
  private testMode: boolean = false;

  constructor(socketPath?: string, testMode: boolean = false) {
    this.socketPath = socketPath || this.getDefaultSocketPath();
    this.server = createServer();
    this.clients = new Map();
    this.testMode = testMode;

    // Create editor instance with T-Lisp interpreter
    const terminal = new TerminalIOImpl(true); // dev mode for server
    const filesystem = new FileSystemImpl();
    this.editor = new Editor(terminal, filesystem);

    // Load test framework to provide defvar and other testing utilities
    const interpreter = this.editor.getInterpreter();
    const { registerTestingFramework } = require('../tlisp/test-framework.ts');
    registerTestingFramework(interpreter);

    // Initialize default state
    const initialState: EditorState = {
      currentBuffer: FunctionalTextBufferImpl.create(""),
      cursorPosition: { line: 0, column: 0 },
      mode: 'normal' as const,
      statusMessage: 'Server started',
      viewportTop: 0,
      config: {
        theme: 'default',
        tabSize: 4,
        autoSave: false,
        keyBindings: {},
        maxUndoLevels: 100,
        showLineNumbers: true,
        wordWrap: false
      },
      currentFilename: undefined,
      commandLine: "",
      mxCommand: "",
      buffers: new Map(),
    };

    this.editor.setEditorState(initialState);
  }

  /**
   * Get the default socket path for the server
   */
  private getDefaultSocketPath(): string {
    const uid = process.env.SUDO_UID || userInfo().uid.toString();
    return `/tmp/tmax-${uid}/server`;
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    // Ensure the socket directory exists
    const socketDir = this.socketPath.substring(0, this.socketPath.lastIndexOf('/'));
    await this.mkdirp(socketDir);
    
    // Handle existing socket file
    try {
      await promisify(exec)(`rm -f "${this.socketPath}"`);
    } catch (err) {
      // Ignore error if socket doesn't exist
    }
    
    this.server.on('connection', this.handleConnection.bind(this));
    this.server.on('error', (err) => {
      console.error('Server error:', err);
      process.exit(1);
    });
    
    this.server.listen(this.socketPath, () => {
      console.log(`tmax server listening on ${this.socketPath}`);
      this.isRunning = true;
    });
    
    // Handle graceful shutdown
    process.on('SIGTERM', this.shutdown.bind(this));
    process.on('SIGINT', this.shutdown.bind(this));
  }

  /**
   * Handle incoming client connections
   */
  private handleConnection(conn: Socket): void {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const client: ClientConnection = {
      id: clientId,
      pid: conn.remotePort ? parseInt(conn.remotePort.toString()) : undefined,
      socket: conn,
      connectedAt: new Date()
    };
    
    this.clients.set(clientId, client);
    console.log(`Client connected: ${clientId}`);
    
    // Set up connection handlers
    conn.on('data', async (data) => {
      try {
        const requestStr = data.toString();
        // Handle potential multiple JSON objects in one data chunk
        const requests = this.parseMultipleRequests(requestStr);
        
        for (const request of requests) {
          const response = await this.processRequest(request);
          
          if (conn.writable) {
            conn.write(JSON.stringify(response) + '\n');
          }
        }
      } catch (error) {
        console.error('Error processing client request:', error);
        const errorResponse: JSONRPCResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: `Internal error: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        };
        
        if (conn.writable) {
          conn.write(JSON.stringify(errorResponse) + '\n');
        }
      }
    });
    
    conn.on('close', () => {
      console.log(`Client disconnected: ${clientId}`);
      this.clients.delete(clientId);
    });
    
    conn.on('error', (err) => {
      console.error(`Client ${clientId} error:`, err);
      this.clients.delete(clientId);
    });
  }

  /**
   * Parse multiple JSON-RPC requests from a single data chunk
   */
  private parseMultipleRequests(data: string): JSONRPCRequest[] {
    const requests: JSONRPCRequest[] = [];
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
              const requestStr = data.substring(startPos, i + 1);
              const request = JSON.parse(requestStr.trim());
              if (request && typeof request === 'object') {
                requests.push(request);
              }
            } catch (e) {
              console.error('Error parsing JSON request:', e);
            }
          }
        }
      }
    }
    
    return requests;
  }

  /**
   * Process a JSON-RPC request
   */
  private async processRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    if (request.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32600,
          message: 'Invalid Request: JSON-RPC version must be 2.0'
        }
      };
    }

    try {
      let result: any;

      switch (request.method) {
        case 'open':
          result = await this.handleOpen(request.params);
          break;
        case 'eval':
          result = await this.handleEval(request.params);
          break;
        case 'command':
          result = await this.handleCommand(request.params);
          break;
        case 'query':
          result = await this.handleQuery(request.params);
          break;
        case 'ping':
          result = await this.handlePing();
          break;
        case 'insert':
          result = await this.handleInsert(request.params);
          break;
        default:
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`
            }
          };
      }

      return {
        jsonrpc: '2.0',
        id: request.id,
        result
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: `Internal error: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      };
    }
  }

  /**
   * Handle file open request
   */
  private async handleOpen(params: any): Promise<any> {
    const filepath = params.filepath;
    const wait = params.wait ?? true;

    if (!filepath) {
      throw new Error('Filepath is required');
    }

    // Load the file content
    let content = '';
    try {
      const fs = new FileSystemImpl();
      content = await fs.readFile(filepath);
    } catch (error) {
      // File doesn't exist, create empty buffer
      content = '';
    }

    // Get current state
    const currentState = this.editor.getState();

    // Create or switch to buffer
    const buffer = FunctionalTextBufferImpl.create(content);

    // Add to buffers Map if not already there
    // Note: We need to modify the actual buffers Map, not create a new one
    const buffers = currentState.buffers;
    if (!buffers.has(filepath)) {
      buffers.set(filepath, buffer);
    }

    const newState = {
      ...currentState,
      currentBuffer: buffer,
      currentFilename: filepath,
      statusMessage: `Opened ${filepath}`,
      buffers: buffers
    };

    this.editor.setEditorState(newState);

    return {
      buffer: filepath,
      line: 1,
      column: 1,
      opened: true
    };
  }

  /**
   * Handle T-Lisp evaluation request
   */
  private async handleEval(params: any): Promise<any> {
    const code = params.code;

    if (!code) {
      throw new Error('Code is required for eval');
    }

    try {
      // Execute the T-Lisp code using the interpreter
      const interpreter = this.editor.getInterpreter();
      const result = interpreter.execute(code);

      // Handle Either return type - check _tag property
      if (result._tag === 'Left') {
        throw new Error(result.left.message || 'T-Lisp evaluation error');
      }

      // Convert T-Lisp value to JSON-serializable format
      return this.tlispValueToJson(result.right);
    } catch (error) {
      throw new Error(`T-Lisp evaluation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Handle insert request
   */
  private async handleInsert(params: any): Promise<any> {
    const text = params.text;

    if (!text) {
      throw new Error('Text is required for insert');
    }

    try {
      // For now, we'll execute a T-Lisp command to insert the text
      const result = this.editor.executeTlisp(`(buffer-insert "${text.replace(/"/g, '\\"')}")`);
      return result;
    } catch (error) {
      throw new Error(`Insert error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Handle editor command request
   */
  private async handleCommand(params: any): Promise<any> {
    const command = params.command;

    if (!command) {
      throw new Error('Command is required');
    }

    // For now, we'll handle a few basic commands
    switch (command) {
      case 'list-buffers':
        return this.editor.getState().buffers.map(buf => buf.name);
      case 'kill-buffer':
        const bufferName = params.bufferName;
        if (bufferName) {
          const index = this.editor.getState().buffers.findIndex(buf => buf.name === bufferName);
          if (index !== -1) {
            this.editor.getState().buffers.splice(index, 1);
            return { success: true, killed: bufferName };
          } else {
            return { success: false, error: `Buffer ${bufferName} not found` };
          }
        }
        throw new Error('Buffer name required for kill-buffer');
      case 'save-buffer':
        const currentFile = this.editor.getState().currentFilename;
        if (currentFile) {
          const fs = new FileSystemImpl();
          await fs.writeFile(currentFile, this.editor.getState().currentBuffer.content);
          return { success: true, saved: currentFile };
        }
        throw new Error('No file to save');
      case 'server-info':
        return {
          status: 'running',
          uptime: Math.floor((Date.now() - (this.server.address() as any)?.port ? Date.now() : Date.now()) / 1000),
          clients: this.clients.size,
          socketPath: this.socketPath
        };
      case 'describe-function':
        const functionName = params.functionName;
        if (functionName) {
          return this.getFunctionDocumentation(functionName);
        }
        throw new Error('Function name required for describe-function command');
      case 'describe-variable':
        const variableName = params.variableName;
        if (variableName) {
          return this.getVariableDocumentation(variableName);
        }
        throw new Error('Variable name required for describe-variable command');
      case 'apropos-command':
        const pattern = params.pattern;
        if (pattern) {
          return this.findCommandsByPattern(pattern);
        }
        throw new Error('Pattern required for apropos-command');
      case 'find-usages':
        const funcName = params.functionName;
        if (funcName) {
          return this.findFunctionUsages(funcName);
        }
        throw new Error('Function name required for find-usages command');
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  /**
   * Get documentation for a variable
   */
  private getVariableDocumentation(variableName: string): any {
    const interpreter = this.editor.getInterpreter();
    const value = interpreter.globalEnv.lookup(variableName);

    if (value === undefined) {
      return {
        name: variableName,
        value: null,
        type: 'unknown',
        documentation: `Variable ${variableName} is not defined.`,
        file: 'unknown',
        line: 0,
        customizable: false,
        defaultValue: null
      };
    }

    // Get the type and value
    const type = value.type || 'unknown';
    const jsonValue = this.tlispValueToJson(value);

    return {
      name: variableName,
      value: jsonValue,
      type: type,
      documentation: `Variable ${variableName} of type ${type}.`,
      file: 'tmax-interpreter',
      line: 0,
      customizable: variableName.startsWith('*') && variableName.endsWith('*'),
      defaultValue: null
    };
  }

  /**
   * Find commands matching a pattern
   */
  private findCommandsByPattern(pattern: string): any {
    const interpreter = this.editor.getInterpreter();
    const allFunctions = this.getTlispFunctions();

    // Convert pattern to regex (handle * wildcards)
    const regexPattern = pattern.replace(/\*/g, '.*');
    const regex = new RegExp(regexPattern, 'i');
    const matches = allFunctions.filter(fn => regex.test(fn));

    return {
      matches: matches.map(name => {
        // Try to get keybinding for this function
        const bindings = this.editor.getKeyMappings();
        let binding = 'unknown';

        for (const [key, mappings] of bindings.entries()) {
          const mapping = mappings.find(m => m.command === name);
          if (mapping) {
            binding = key;
            break;
          }
        }

        return {
          name: name,
          binding: binding,
          documentation: `Function ${name}.`
        };
      })
    };
  }

  /**
   * Find usages of a function
   */
  private findFunctionUsages(functionName: string): any {
    // For now, return an empty array as we don't track function call locations
    // This would require parsing all loaded T-Lisp files and tracking call sites
    return {
      function: functionName,
      usages: []
    };
  }

  /**
   * Convert T-Lisp value to JSON-serializable value
   */
  private tlispValueToJson(value: any): any {
    if (value === null || value === undefined) {
      return null;
    }

    // Handle T-Lisp value objects
    if (value.type !== undefined) {
      switch (value.type) {
        case 'nil':
          return null;
        case 'boolean':
        case 'number':
        case 'string':
          return value.value;
        case 'list':
          return value.value.map((v: any) => this.tlispValueToJson(v));
        case 'hashmap':
          const obj: Record<string, any> = {};
          value.value.forEach((v: any, k: string) => {
            obj[k] = this.tlispValueToJson(v);
          });
          return obj;
        case 'symbol':
          return value.value;
        default:
          return String(value);
      }
    }

    // Handle plain values
    return value;
  }

  /**
   * Get all variables from T-Lisp environment
   */
  private getTlispVariables(): Record<string, any> {
    const variables: Record<string, any> = {};
    const interpreter = this.editor.getInterpreter();

    // Get all bindings from global environment
    interpreter.globalEnv.bindings.forEach((value, name) => {
      // Only include variables (not functions, and use naming convention)
      if (name.startsWith('*') && name.endsWith('*')) {
        variables[name] = this.tlispValueToJson(value);
      }
    });

    return variables;
  }

  /**
   * Get all functions from T-Lisp environment
   */
  private getTlispFunctions(): string[] {
    const functions: string[] = [];
    const interpreter = this.editor.getInterpreter();

    // Get all bindings from global environment
    interpreter.globalEnv.bindings.forEach((value, name) => {
      // Include functions and special forms
      if (value.type === 'function' || value.type === 'macro') {
        functions.push(name);
      }
    });

    return functions.sort();
  }

  /**
   * Handle query request
   */
  private async handleQuery(params: any): Promise<any> {
    const query = params.query;
    const state = this.editor.getState();

    switch (query) {
      case 'buffers': {
        // Convert buffers Map to array for JSON serialization
        const buffersArray: any[] = [];
        state.buffers?.forEach((buffer, name) => {
          buffersArray.push({
            name: name,
            content: buffer.content || '',
            modified: false  // TODO: track modified state
          });
        });
        return buffersArray;
      }
      case 'variables':
        // Return variables from T-Lisp interpreter
        return this.getTlispVariables();
      case 'keybindings':
        return state.config.keyBindings;
      case 'full-state': {
        // Convert buffers Map to array for JSON serialization
        const buffersArray: any[] = [];
        state.buffers?.forEach((buffer, name) => {
          buffersArray.push({
            name: name,
            content: buffer.content || '',
            modified: false  // TODO: track modified state
          });
        });

        return {
          buffers: buffersArray,
          currentBuffer: state.currentFilename || null,
          mode: state.mode,
          variables: this.getTlispVariables(),
          keybindings: state.config.keyBindings,
          cursorPosition: state.cursorPosition,
          viewportTop: state.viewportTop,
          config: state.config
        };
      }
      case 'functions':
        // Query the T-Lisp interpreter for available functions
        return this.getTlispFunctions();
      case 'function-documentation':
        const functionName = params.functionName;
        if (functionName) {
          return this.getFunctionDocumentation(functionName);
        }
        throw new Error('Function name required for function-documentation query');
      default:
        throw new Error(`Unknown query: ${query}`);
    }
  }

  /**
   * Get documentation for a specific function
   */
  private getFunctionDocumentation(functionName: string): any {
    const interpreter = this.editor.getInterpreter();
    const value = interpreter.globalEnv.lookup(functionName);

    if (value === undefined || (value.type !== 'function' && value.type !== 'macro')) {
      return {
        name: functionName,
        signature: `(${functionName} ...)`,
        documentation: `Function ${functionName} is not defined.`,
        file: 'unknown',
        line: 0,
        examples: [],
        relatedFunctions: []
      };
    }

    // For built-in functions, try to get documentation from function metadata
    // For now, return basic information
    return {
      name: functionName,
      signature: `(${functionName} ...)`,
      documentation: `Function ${functionName}.`,
      file: 'tmax-interpreter',
      line: 0,
      examples: [],
      relatedFunctions: []
    };
  }

  /**
   * Handle ping request
   */
  private async handlePing(): Promise<any> {
    return {
      status: 'running',
      uptime: Math.floor((Date.now() - this.server.address() ? Date.now() : Date.now()) / 1000),
      clients: this.clients.size
    };
  }

  /**
   * Create directory recursively
   */
  private async mkdirp(dir: string): Promise<void> {
    const execPromise = promisify(exec);
    try {
      await execPromise(`mkdir -p "${dir}"`);
    } catch (error) {
      console.error(`Failed to create directory ${dir}:`, error);
      throw error;
    }
  }

  /**
   * Shutdown the server gracefully
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down tmax server...');

    // Close all client connections
    for (const [clientId, client] of this.clients) {
      try {
        client.socket.destroy();
      } catch (error) {
        console.error(`Error closing client ${clientId}:`, error);
      }
    }

    this.clients.clear();

    // Close the server
    this.server.close(() => {
      console.log('tmax server closed');
      // Only exit process if not in test mode
      if (!this.testMode) {
        process.exit(0);
      }
    });

    // Force exit after a timeout if server doesn't close (only in non-test mode)
    if (!this.testMode) {
      setTimeout(() => {
        console.log('Force closing tmax server');
        process.exit(1);
      }, 5000);
    }
  }

  /**
   * Get the socket path
   */
  getSocketPath(): string {
    return this.socketPath;
  }

  /**
   * Check if server is running
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }
}