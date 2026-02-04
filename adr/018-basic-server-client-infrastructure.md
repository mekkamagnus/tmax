# Basic Server/Client Infrastructure

## Status

**proposed**

## Context

The tmax editor needed infrastructure for:
- Daemon mode for long-running editor sessions
- Client-server communication for multiple connections
- Remote editing capabilities
- Session persistence across client disconnections

## Decision

Implement basic server/client architecture:

### Server Architecture

Created `src/server/server.ts`:
```typescript
export class EditorServer {
  private port: number;
  private editor: Editor;
  private clients: Map<string, EditorClient> = new Map();

  async start(): Promise<void> {
    const server = Bun.serve({
      port: this.port,
      fetch: async (req) => this.handleRequest(req)
    });
  }

  private async handleRequest(req: Request): Promise<Response> {
    // Route request to appropriate handler
    // Handle WebSocket connections
    // Manage client lifecycle
  }
}
```

### Client Architecture

Created `src/server/client.ts`:
```typescript
export class EditorClient {
  private serverUrl: string;
  private socket: WebSocket;

  async connect(): Promise<void> {
    this.socket = new WebSocket(this.serverUrl);
    // Handle connection lifecycle
    // Send commands to server
    // Receive updates from server
  }

  sendCommand(cmd: ClientCommand): void {
    this.socket.send(JSON.stringify(cmd));
  }
}
```

### Protocol

Defined client-server protocol in `src/server/protocol.ts`:
```typescript
export interface ServerMessage {
  type: 'update' | 'response' | 'error';
  payload: unknown;
}

export interface ClientCommand {
  type: 'edit' | 'query' | 'subscribe';
  payload: unknown;
}
```

### Commands

**Client Commands:**
- `edit`: Apply edit operation to buffer
- `query`: Request buffer content or state
- `subscribe`: Subscribe to buffer updates

**Server Messages:**
- `update`: Broadcast buffer changes to subscribers
- `response`: Respond to client queries
- `error`: Report errors to client

## Consequences

### Benefits

1. **Daemon Mode**: Editor runs as background service
2. **Multiple Clients**: Multiple terminal connections to same session
3. **Remote Editing**: Edit files on remote server
4. **Session Persistence**: Session survives client disconnect

### Trade-offs

1. **Complexity**: Server-client architecture adds complexity
2. **Network Dependency**: Requires network for communication
3. **Latency**: Network adds latency to operations
4. **State Management**: Must synchronize state across clients

### Future Considerations

1. **Authentication**: Secure server access
2. **Encryption**: TLS for secure communication
3. **Session Management**: Multiple editor sessions
4. **Load Balancing**: Distribute clients across servers
5. **Offline Mode**: Client cache for offline editing

### Testing

Created `test/unit/server-daemon.test.ts` and `test/unit/server-client.test.ts`:
- Server starts and accepts connections
- Client connects and sends commands
- Commands execute correctly on server
- Server broadcasts updates to clients
- Client disconnect handled gracefully
