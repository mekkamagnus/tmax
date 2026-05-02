# LSP Client Connection

## Status

**proposed**

## Context

Language Server Protocol support for:
- Code completion
- Go to definition
- Find references
- Diagnostics
- Code actions

## Decision

Implement LSP client connection:

### LSP Client

```typescript
export class LSPClient {
  private process: Bun.Process | null = null;
  private stdout: ReadableStream | null = null;
  private stdin: WritableStream | null = null;

  async connect(serverCommand: string, args: string[]): Promise<void> {
    this.process = Bun.spawn({
      cmd: [serverCommand, ...args],
      stdout: 'pipe',
      stdin: 'pipe'
    });

    this.stdout = this.process.stdout;
    this.stdin = this.process.stdin;

    // Start message handler
    this.handleMessages();
  }

  async sendRequest(method: string, params: unknown): Promise<LSPResponse> {
    const request: LSPRequest = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method,
      params
    };

    const message = ContentLengthHeader + JSON.stringify(request) + '\r\n\r\n';
    await this.stdin.write(message);

    return await this.waitForResponse(request.id);
  }

  async notify(method: string, params: unknown): Promise<void> {
    const notification: LSPNotification = {
      jsonrpc: '2.0',
      method,
      params
    };

    const message = ContentLengthHeader + JSON.stringify(notification) + '\r\n\r\n';
    await this.stdin.write(message);
  }
}
```

### Server Configuration

```lisp
;; Configure LSP server
(lsp-config "typescript-language-server" :args ["--stdio"])
(lsp-config "gopls" :args ["serve"])
(lsp-config "pyright" :args ["--stdio"])
```

### Connection Management

```lisp
;; Connect to server
(lsp-connect "typescript-language-server")

;; Disconnect from server
(lsp-disconnect)

;; Check connection status
(lsp-connected-p)
```

### Implementation

Created `src/lsp/client.ts`:
- LSP client implementation
- JSON-RPC messaging
- Process management
- Message handler

## Consequences

### Benefits

1. **Language Support**: Rich language features via LSP
2. **Extensibility**: Add new languages easily
3. **Standard Protocol**: Use industry-standard LSP
4. **Modularity**: LSP servers are separate processes

### Trade-offs

1. **Latency**: IPC communication overhead
2. **Complexity**: LSP protocol is complex
3. **Resource Usage**: Each LSP server consumes resources
4. **Debugging**: Debugging LSP issues is hard

### Future Considerations

1. **Dynamic Registration**: Register capabilities dynamically
2. **Workspace Folders**: Multi-folder workspaces
3. **LSP over WebSocket`: Remote LSP connections
4. **LSP Caching**: Cache LSP responses

### Testing

Created `test/unit/editor.test.ts`:
- Client connects to server
- Client sends requests
- Client receives responses
- Notifications work
- Client disconnects cleanly
- Errors handled gracefully
