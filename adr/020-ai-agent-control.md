# AI Agent Control

## Status

Accepted

## Context

The Ralph Loop system needed infrastructure for:
- Running AI agents in server mode
- Controlling agent execution remotely
- Monitoring agent progress
- Retrieving agent results

## Decision

Implement AI agent control through server/client:

### Agent Lifecycle

```lisp
;; Start agent
(agent-start "ralph" :max-iterations 10)

;; Query agent status
(agent-status)  ; => {:running true, :iteration 3, :stories-complete 2}

;; Stop agent
(agent-stop)

;; Get agent results
(agent-results)
```

### Agent Commands

Server accepts agent control commands:
```typescript
export interface AgentCommand {
  type: 'agent';
  action: 'start' | 'stop' | 'status' | 'results';
  agent: string;
  config?: AgentConfig;
}

export interface AgentConfig {
  maxIterations?: number;
  agentType?: 'claude' | 'claude-glm' | 'qwen';
  prdFile?: string;
}
```

### Progress Streaming

Server streams agent progress to clients:
```typescript
export interface AgentProgress {
  type: 'agent-progress';
  iteration: number;
  storiesCompleted: number;
  currentStory: string;
  timestamp: number;
}

// Server broadcasts to all subscribed clients
server.broadcast({
  type: 'agent-progress',
  iteration: 5,
  storiesCompleted: 3,
  currentStory: 'US-1.1.1: Word Navigation',
  timestamp: Date.now()
});
```

### Implementation

Created `src/server/agent-controller.ts`:
```typescript
export class AgentController {
  private runningAgent: Agent | null = null;
  private clients: Set<WebSocket> = new Set();

  startAgent(config: AgentConfig): void {
    this.runningAgent = new Agent(config);

    // Stream progress to clients
    this.runningAgent.on('progress', (progress) => {
      this.broadcast({
        type: 'agent-progress',
        ...progress
      });
    });

    this.runningAgent.start();
  }

  stopAgent(): void {
    this.runningAgent?.stop();
    this.runningAgent = null;
  }

  getStatus(): AgentStatus {
    return this.runningAgent?.status() || { running: false };
  }

  subscribe(client: WebSocket): void {
    this.clients.add(client);
  }
}
```

## Consequences

### Benefits

1. **Remote Agent Execution**: Run Ralph Loop on server
2. **Real-Time Monitoring**: Watch agent progress remotely
3. **Multi-User**: Multiple users can monitor same agent
4. **Resource Efficiency**: One server for multiple agent runs
5. **Persistence**: Agent state survives client disconnect

### Trade-offs

1. **Complexity**: Additional agent lifecycle management
2. **Resource Usage**: Long-running agents consume server resources
3. **Concurrency**: Must handle multiple agent requests
4. **Security**: Agent needs file system and network access

### Future Considerations

1. **Queueing**: Queue multiple agent requests
2. **Resource Limits**: CPU/memory limits for agent execution
3. **Agent Pooling**: Pre-warm agent instances
4. **Distributed Execution**: Run agents across multiple servers
5. **Agent Communication**: Agents can communicate with each other

### Testing

Created `test/unit/server-daemon.test.ts`:
- Agent starts and runs iterations
- Status queries return correct state
- Stop command terminates agent
- Progress broadcasts to clients
- Multiple clients can monitor agent
- Agent cleanup on completion
