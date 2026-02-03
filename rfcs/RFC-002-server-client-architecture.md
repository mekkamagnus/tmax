# RFC-002: Server/Client Architecture

**Status:** 📋 PROPOSED
**Created:** 2025-02-03
**Author:** tmax Design Team
**Phase:** 0.8 - Server/Client Infrastructure

## Table of Contents
- [Abstract](#abstract)
- [Motivation](#motivation)
- [Proposed Solution](#proposed-solution)
- [Detailed Design](#detailed-design)
- [AI Agent Integration](#ai-agent-integration)
- [Integration Examples](#integration-examples)
- [Alternatives Considered](#alternatives-considered)
- [Implementation Plan](#implementation-plan)
- [References](#references)

---

## Abstract

This RFC proposes a **Server/Client Architecture** for tmax, inspired by Emacs' `emacsclient` system. This feature enables a running tmax instance to be controlled from the command line, allowing instant file opening, T-Lisp evaluation, and remote control without startup overhead.

**Key Benefits:**
- ✅ Instant file opening (<100ms vs 2-5 seconds for new instance)
- ✅ Unified session state across all terminal windows
- ✅ Scriptable integration with git, file managers, and shell tools
- ✅ T-Lisp evaluation from command line
- ✅ Perfect alignment with T-Lisp-first architecture
- ✅ **AI agent control** - Full programmatic access for AI development agents
- ✅ Competitive advantage over other terminal editors

**AI Agent Capabilities:**
This architecture transforms tmax into an **AI-native editor**, enabling AI agents to:
- Get full visibility into editor state (buffers, variables, functions, stack traces)
- Control all editor operations programmatically (open, close, edit, save)
- Execute T-Lisp code and receive immediate interpreter feedback
- Query help system (`describe-function`, `describe-variable`, `apropos`)
- Run extended commands via M-x interface
- Accelerate AI-assisted development with real-time feedback loops

**Connection to REPL-Driven Development:**

This server/client architecture extends the traditional Lisp **REPL-Driven Development** workflow:

**Layer 1: Internal REPL (Like IELM)**
- Interactive T-Lisp evaluation within tmax
- Quick experimentation and testing
- Planned: `M-x tmax-repl` for in-editor REPL

**Layer 2: Server/Client (External REPL Connection)**
- Connect to running tmax from terminal/scripts
- Like having an external REPL with full editor access
- Bidirectional control: send commands, receive results

**Layer 3: AI Agent Control (Collaborative REPL Partner)**
- AI agents explore codebase via REPL-style queries
- Describe functions, inspect variables, find source
- Test changes in real-time before committing
- Maintain full context across development session

**The Complete Ecosystem:**
```
┌─────────────────────────────────────────────────────────┐
│         REPL-Driven Development with tmax                │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Internal REPL (IELM-like)  │  Server/Client  │  AI    │
│  - M-x tmax-repl             │  - tmaxclient   │  Agent │
│  - Quick experimentation     │  - Scripts      │  - Full │
│  - Buffer interaction        │  - Terminal I/O │    code │
│  - Live coding               │  - Git hooks    │  - Base │
│                             │                │  - REPL │
│  └───────────── All connected to same T-Lisp engine ─────┘
│                                                          │
│  Workflow:                                              │
│  1. Experiment in REPL (M-x tmax-repl)                  │
│  2. Automate via client (tmaxclient --eval)             │
│  3. Scale with AI (agent controls tmax via socket)       │
│  4. All sharing same editor state, no restart needed     │
└─────────────────────────────────────────────────────────┘
```

**Development Philosophy:**
This follows the Emacs/Lisp tradition of **interactive, exploratory programming** where:
- The line between "using" and "programming" the editor blurs
- You can extend the editor while using it
- AI agents become first-class participants in development
- The editor is a living, programmable environment

---

## Motivation

### Problems with Single-Instance Editors

1. **Startup Overhead**: Every terminal window needs a new tmax instance → 2-5 seconds wasted
2. **Fragmented State**: Multiple instances don't share buffers, kill ring, or history
3. **Poor Integration**: Can't effectively use as `$EDITOR` for git, crontab, visudo
4. **Limited Scriptability**: Can't control editor from shell scripts or other tools
5. **Resource Waste**: Multiple instances duplicate memory and CPU usage

### Why Server/Client Model?

**Instant Response:**
- Server starts once (background daemon)
- All client connections instant (<100ms)
- Perfect for `git difftool`, file managers, terminal workflows

**Single Shared Session:**
- All buffers, state, variables shared
- Multiple terminal windows → same tmax instance
- Kill ring shared across all client connections

**Script Integration:**
```bash
# Use as $EDITOR
export EDITOR='tmaxclient -nw'
git commit  # Opens commit msg in running tmax

# Evaluate T-Lisp from shell
tmaxclient --eval '(save-all-buffers)'

# Send text to tmax
echo "TODO: finish report" | tmaxclient --insert
```

### Design Philosophy

Following tmax's **T-Lisp-first architecture**:
- **T-Lisp handles all operations**: Open files, eval code, manage state
- **TypeScript is thin layer**: Socket server, client CLI, JSON-RPC protocol
- **Unix philosophy**: Composable tool that plays well with others
- **Editor as environment**: Like Emacs, tmax becomes your workspace, not just an editor

### AI Agent Control - The Game Changer

**Why AI Agents Need Direct Editor Access:**

Current AI coding assistants (Claude Code, GitHub Copilot, Cursor, Aider) operate by:
1. Reading files from filesystem
2. Generating code changes
3. Writing files back to filesystem
4. Running tests via shell commands
5. Parsing test output to verify changes

**This approach has limitations:**
- ❌ No visibility into editor's internal state (buffers, undo history, markers)
- ❌ Can't execute editor commands (navigation, search, refactoring)
- ❌ Can't query help system or documentation
- ❌ Slow feedback loops (file I/O vs in-memory operations)
- ❌ Can't leverage editor's built-in intelligence (keybindings, macros)

**With Server/Client Architecture, AI Agents Can:**

✅ **Full Editor Visibility:**
```json
// Query editor state
{
  "method": "query",
  "params": {
    "query": "full-state"
  }
}

// Response
{
  "result": {
    "buffers": [
      { "name": "src/editor.ts", "modified": true, "cursor": { "line": 42, "column": 5 } },
      { "name": "*scratch*", "modified": false }
    ],
    "variables": { "*test-coverage-target*: 80" },
    "keybindings": { "normal-mode": { "j": "cursor-move-down" } }
  }
}
```

✅ **Execute Editor Commands:**
```json
// Open file and go to line
{
  "method": "command",
  "params": {
    "command": "find-file",
    "args": ["src/editor.ts"],
    "then": "goto-line",
    "line": 42
  }
}
```

✅ **Evaluate T-Lisp and Get Results:**
```json
{
  "method": "eval",
  "params": {
    "code": "(progn (describe-function 'buffer-insert) (documentation 'buffer-insert))"
  }
}

// Response
{
  "result": {
    "documentation": "buffer-insert is a built-in function...\n\nInsert TEXT at cursor position...",
    "signature": "(buffer-insert text &optional buffer)",
    "file": "src/editor/buffer-ops.ts",
    "line": 123
  }
}
```

✅ **Query Help System:**
```json
// Search for functions by pattern
{
  "method": "command",
  "params": {
    "command": "apropos-command",
    "pattern": "buffer.*save"
  }
}

// Response
{
  "result": {
    "matches": [
      { "name": "save-buffer", "binding": "C-x C-s", "doc": "Save current buffer to file" },
      { "name": "save-all-buffers", "binding": "SPC f s", "doc": "Save all modified buffers" }
    ]
  }
}
```

✅ **Execute Extended Commands (M-x):**
```json
{
  "method": "command",
  "params": {
    "command": "execute-extended-command",
    "command-name": "query-replace-regexp"
  }
}
```

✅ **Real-Time Development Feedback Loop:**
```bash
# AI agent workflow
1. Agent queries: "What function implements cursor movement?"
2. tmax responds: "cursor-move in src/editor/cursor-ops.ts:45"
3. Agent evaluates: "(describe-function 'cursor-move)"
4. Agent generates code changes
5. Agent executes: "(load-file \"src/editor/cursor-ops.ts\")"
6. Agent runs tests: "(run-tests \"cursor-ops.test.tlisp\")"
7. Agent gets results: "5/5 tests passed"
8. Agent commits: "All green, ship it!"

# All in <1 second without file I/O overhead
```

**This Makes tmax AI-Native:**
- 🤖 **First terminal editor designed for AI agent control**
- ⚡ **10-100x faster than file-based AI workflows** (in-memory vs disk I/O)
- 🎯 **Full access to editor intelligence** (help, docs, keybindings, macros)
- 🔍 **Complete observability** (stack traces, buffer state, undo history)
- 🚀 **Accelerated AI-assisted development** (real-time feedback loops)

---

## Proposed Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                  tmax Server/Client System                  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐                    │
│  │ CLI Commands │      │ Editor Modes │                    │
│  │ tmaxclient   │      │ tmax --daemon│                    │
│  └──────┬───────┘      └──────┬───────┘                    │
│         │                     │                             │
│         │    Unix Socket      │                             │
│         └──────────┬──────────┘                             │
│                    ▼                                        │
│         ┌────────────────────┐                             │
│         │ Socket Server      │                             │
│         │ (TypeScript)       │                             │
│         └────────────────────┘                             │
│                    │                                        │
│         ┌──────────▼──────────┐                            │
│         │ JSON-RPC Protocol   │                            │
│         │ (bidirectional)     │                            │
│         └─────────────────────┘                            │
│                    │                                        │
│         ┌──────────▼──────────┐                            │
│         │ T-Lisp Engine       │                            │
│         │ (execute commands)  │                            │
│         └─────────────────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

### Dual-Mode Interface

**Mode 1: Server Mode** (`tmax --daemon`)
- Background daemon process
- Listens on Unix socket (`/tmp/tmax-$UID/server`)
- Shared editor state across all clients
- Auto-start on first client request (optional)

**Mode 2: Client Mode** (`tmaxclient`)
- Open files: `tmaxclient file.txt`
- Evaluate T-Lisp: `tmaxclient --eval '(code)'`
- Wait/no-wait modes
- Multiple connection types (terminal, background, new frame)

---

## Detailed Design

### Component #1: Server Infrastructure

**Server Startup:**
```bash
# Explicit daemon mode
tmax --daemon

# Custom socket path
tmax --daemon=/tmp/my-tmax-socket

# TCP socket (for remote)
tmax --daemon=tcp:127.0.0.1:8080
```

**Server Architecture:**
```typescript
// src/server/server.ts
class TmaxServer {
  private socketPath: string;
  private server: net.Server;
  private editor: Editor;
  private clients: Map<string, ClientConnection>;

  start(options?: { socket?: string, tcp?: string }) {
    // Create Unix or TCP socket
    this.socketPath = options?.socket || `/tmp/tmax-${process.uid}/server`;
    this.server = net.createServer(this.handleConnection.bind(this));
    this.server.listen(this.socketPath);

    // Initialize T-Lisp environment
    this.editor = new Editor();
  }

  async handleConnection(conn: net.Socket) {
    // JSON-RPC protocol handler
    conn.on('data', (data) => {
      const request = JSON.parse(data);
      const response = await this.processRequest(request);
      conn.write(JSON.stringify(response));
    });
  }

  async processRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    switch (request.method) {
      case 'open':
        return this.handleOpen(request.params);
      case 'eval':
        return this.handleEval(request.params);
      case 'command':
        return this.handleCommand(request.params);
      default:
        return { error: `Unknown method: ${request.method}` };
    }
  }
}
```

**T-Lisp Server API:**
```lisp
;; src/tlisp/server-api.tlisp

;; Check if running in server mode
(server-running-p)  ; => t or nil

;; Get server socket path
(server-socket-path)  ; => "/tmp/tmax-1000/server"

;; Server hooks
(add-hook 'server-client-connect-hook 'my-welcome-func)
(add-hook 'server-client-disconnect-hook 'my-cleanup-func)

;; Client info
(server-clients)  ; => ((id . 1) (pid . 12345) (socket . "..."))

;; Send message to all clients
(server-broadcast "Buffer saved!")

;; Get current client info
(server-current-client)  ; => Client info for this connection
```

---

### Component #2: Client CLI

**Basic Usage:**
```bash
# Open file (wait for user to close buffer)
tmaxclient file.txt

# Open file (background, don't wait)
tmaxclient -n file.txt

# Open in new "window" (buffer)
tmaxclient -c file.txt

# Open multiple files
tmaxclient file1.txt file2.txt file3.txt

# Use terminal frame (for $EDITOR)
tmaxclient -nw file.txt
```

**T-Lisp Evaluation:**
```bash
# Evaluate and print result
tmaxclient --eval '(buffer-name)'
=> "*scratch*"

# Evaluate without printing
tmaxclient --eval '(save-buffers)' -n

# Multiple expressions
tmaxclient --eval '(progn (switch-to-buffer "test") (buffer-text))'
```

**Advanced Commands:**
```bash
# List buffers
tmaxclient --list-buffers

# Kill specific buffer
tmaxclient --kill-buffer scratch.tlisp

# Insert text at cursor
tmaxclient --insert "TODO: finish report"

# Insert from stdin
echo "From stdin" | tmaxclient --insert-stdin

# Execute T-Lisp file
tmaxclient --script setup.tlisp

# Get server info
tmaxclient --server-info

# Ping server (check if running)
tmaxclient --ping
```

**Client Architecture:**
```typescript
// bin/tmaxclient
#!/usr/bin/env bun

class TmaxClient {
  private socketPath: string;
  private connection: net.Socket;

  constructor(options?: { socket?: string }) {
    this.socketPath = options?.socket || `/tmp/tmax-${process.uid}/server`;
  }

  async connect(): Promise<void> {
    // Connect to server socket
    this.connection = net.connect(this.socketPath);
  }

  async sendRequest(method: string, params: any): Promise<any> {
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: generateId(),
      method,
      params
    };

    this.connection.write(JSON.stringify(request));

    // Wait for response
    return new Promise((resolve, reject) => {
      this.connection.once('data', (data) => {
        const response = JSON.parse(data);
        if (response.error) reject(response.error);
        else resolve(response.result);
      });
    });
  }

  async openFile(filepath: string, options?: { wait?: boolean }): Promise<void> {
    await this.sendRequest('open', { filepath, ...options });
  }

  async eval(code: string): Promise<any> {
    return await this.sendRequest('eval', { code });
  }
}
```

---

### Component #3: JSON-RPC Protocol

**Protocol Specification:**
```typescript
// JSON-RPC 2.0 over Unix socket

// Request format
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: 'open' | 'eval' | 'command' | 'query' | 'broadcast';
  params: any;
}

// Response format
interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}
```

**Supported Methods:**

**`open`** - Open file in buffer
```json
// Request
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "open",
  "params": {
    "filepath": "/path/to/file.txt",
    "wait": true,
    "focus": true
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "buffer": "file.txt",
    "line": 1,
    "column": 1
  }
}
```

**`eval`** - Evaluate T-Lisp code
```json
// Request
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "eval",
  "params": {
    "code": "(buffer-list)"
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": ["*scratch*", "file.txt", "test.ts"]
}
```

**`command`** - Execute editor command
```json
// Request
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "command",
  "params": {
    "command": "save-all-buffers"
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "saved": ["file.txt", "test.ts"],
    "status": "success"
  }
}
```

**`query`** - Query editor state
```json
// Request
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "query",
  "params": {
    "query": "buffers"
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "buffers": [
      { "name": "*scratch*", "modified": false },
      { "name": "file.txt", "modified": true }
    ],
    "current": "file.txt"
  }
}
```

---

### Component #4: Wait/No-Wait Modes

**Wait Mode** (default for single file):
```bash
tmaxclient file.txt
# Blocks until buffer is closed
# Exit code: 0 if saved, 1 if discarded
```

**No-Wait Mode** (background):
```bash
tmaxclient -n file.txt
# Returns immediately
# Files open in background
```

**New Frame Mode** (new buffer/window):
```bash
tmaxclient -c file.txt
# Opens in new buffer, focus immediately
# Returns immediately
```

**Terminal Mode** (for `$EDITOR`):
```bash
tmaxclient -nw file.txt
# Uses terminal frame (like emacs -nw)
# Blocks until buffer closed
# Perfect for git commit, crontab -e, visudo
```

**Wait Logic:**
```typescript
async waitForBufferClose(bufferName: string): Promise<number> {
  return new Promise((resolve) => {
    const hook = () => {
      if (!this.editor.hasBuffer(bufferName)) {
        this.editor.removeHook('buffer-kill-hook', hook);
        resolve(this.editor.bufferSaved(bufferName) ? 0 : 1);
      }
    };
    this.editor.addHook('buffer-kill-hook', hook);
  });
}
```

---

### Component #5: Socket Management

**Default Socket Path:**
```bash
/tmp/tmax-$UID/server
# Example: /tmp/tmax-1000/server
```

**Custom Socket Paths:**
```bash
# Server
tmax --daemon=/tmp/my-project-tmax

# Client
tmaxclient -s /tmp/my-project-tmax file.txt
```

**Multiple Server Instances:**
```bash
# Personal server
tmax --daemon=~/.tmax/personal-server

# Work server
tmax --daemon=~/.tmax/work-server

# Connect to specific server
export TMAX_SOCKET=~/.tmax/work-server
tmaxclient file.txt  # Uses $TMAX_SOCKET
```

**TCP Sockets** (remote/SSH):
```bash
# Server
tmax --daemon=tcp:127.0.0.1:8080

# Client
tmaxclient -s 192.168.1.100:8080 file.txt

# SSH tunnel for remote access
ssh -L 8080:localhost:8080 remote-server
tmaxclient -s localhost:8080 file.txt
```

**Socket Cleanup:**
```lisp
;; T-Lisp hooks for socket lifecycle
(add-hook 'server-start-hook
  (lambda ()
    (message "Server listening on %s" (server-socket-path))))

(add-hook 'server-shutdown-hook
  (lambda ()
    (save-all-buffers)
    (message "Server shutting down")))
```

---

### Component #6: Auto-Start Server

**Optional Auto-Start on First Request:**
```bash
# If server not running, start it automatically
tmaxclient --autostart file.txt

# Or enable by default in config
# ~/.tmaxrc
(setq server-autostart t)
```

**Auto-Start Logic:**
```typescript
async ensureServerRunning(): Promise<void> {
  if (!await this.isServerRunning()) {
    console.log('Starting tmax server...');
    const server = spawn('tmax', ['--daemon']);
    await new Promise(resolve => server.once('ready', resolve));
    console.log('Server started');
  }
}
```

**Server Detection:**
```bash
# Check if server running
tmaxclient --ping

# Exit codes: 0 = running, 1 = not running, 2 = error
if tmaxclient --ping 2>/dev/null; then
  echo "Server is running"
else
  echo "Server not running"
fi
```

---

## AI Agent Integration

The server/client architecture transforms tmax into an **AI-native editor**. AI agents can control every aspect of the editor through the JSON-RPC protocol, enabling:

### AI Agent Capabilities Overview

| Capability | Description | JSON-RPC Method |
|------------|-------------|-----------------|
| **State Query** | Get full editor state (buffers, vars, cursor) | `query` |
| **Code Execution** | Evaluate T-Lisp and get results | `eval` |
| **Help System** | Query functions, variables, docs | `command` + help funcs |
| **File Operations** | Open, close, save buffers | `open`, `command` |
| **Navigation** | Move cursor, search buffers | `command` |
| **Refactoring** | Execute editor commands | `command` |
| **Testing** | Run tests and get results | `command` + `eval` |

### AI Agent Protocol Extensions

#### Extended Query Methods

**Full Editor State:**
```json
// Request
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "query",
  "params": {
    "query": "full-state"
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "buffers": [
      {
        "name": "src/editor.ts",
        "path": "/home/user/project/src/editor.ts",
        "modified": true,
        "size": 12345,
        "cursor": { "line": 42, "column": 5 },
        "selection": { "start": { "line": 40, "column": 0 }, "end": { "line": 42, "column": 10 } }
      }
    ],
    "current-buffer": "src/editor.ts",
    "mode": "normal",
    "variables": {
      "*test-coverage-target*": 80,
      "*backup-enabled*": true
    },
    "keybindings": {
      "normal-mode": {
        "j": "cursor-move-down",
        "k": "cursor-move-up",
        "SPC": "*leader-keymap*"
      }
    },
    "recent-commands": ["save-buffer", "goto-line", "find-file"],
    "mark-ring": [
      { "buffer": "test.ts", "line": 10, "column": 0 },
      { "buffer": "main.ts", "line": 25, "column": 5 }
    ]
  }
}
```

**Buffer List Query:**
```json
{
  "method": "query",
  "params": { "query": "buffers" }
}
// => List of all buffers with metadata
```

**Variable Query:**
```json
{
  "method": "query",
  "params": { "query": "variables", "pattern": "*test*" }
}
// => All variables matching pattern
```

**Function Query:**
```json
{
  "method": "query",
  "params": { "query": "functions", "pattern": "buffer.*save" }
}
// => All functions matching pattern with signatures
```

#### Extended Help System Access

**Describe Function:**
```json
{
  "method": "command",
  "params": {
    "command": "describe-function",
    "function-name": "buffer-insert"
  }
}

// Response
{
  "result": {
    "name": "buffer-insert",
    "signature": "(buffer-insert text &optional buffer)",
    "documentation": "Insert TEXT at cursor position in BUFFER.\n\nIf BUFFER is nil, use current buffer. Returns cursor position after insert.",
    "file": "src/editor/api/buffer-ops.ts",
    "line": 123,
    "examples": [
      "(buffer-insert \"hello world\")",
      "(buffer-insert \"TODO: \" (buffer-create \"notes\"))"
    ],
    "related-functions": ["buffer-delete", "buffer-replace", "buffer-insert-line"]
  }
}
```

**Describe Variable:**
```json
{
  "method": "command",
  "params": {
    "command": "describe-variable",
    "variable-name": "*test-coverage-target*"
  }
}

// Response
{
  "result": {
    "name": "*test-coverage-target*",
    "value": 80,
    "type": "integer",
    "documentation": "Target percentage for test coverage.\n\nTRT framework will fail if coverage below this threshold.",
    "file": "src/tlisp/trt/trt.tlisp",
    "line": 42,
    "customizable": true,
    "default-value": 80
  }
}
```

**Apropos Search:**
```json
{
  "method": "command",
  "params": {
    "command": "apropos-command",
    "pattern": "save.*buffer"
  }
}

// Response
{
  "result": {
    "matches": [
      {
        "name": "save-buffer",
        "binding": "C-x C-s",
        "documentation": "Save current buffer to its file"
      },
      {
        "name": "save-all-buffers",
        "binding": "SPC f s",
        "documentation": "Save all modified buffers"
      },
      {
        "name": "save-buffer-as",
        "binding": "SPC f A",
        "documentation": "Save buffer to a different filename"
      }
    ]
  }
}
```

**Locate Source:**
```json
{
  "method": "command",
  "params": {
    "command": "find-function-source",
    "function-name": "cursor-move"
  }
}

// Response
{
  "result": {
    "function": "cursor-move",
    "file": "src/editor/api/cursor-ops.ts",
    "line": 45,
    "column": 2,
    "definition": "(defun cursor-move (line column &optional buffer)\n  \"Move cursor to LINE and COLUMN in BUFFER.\n...\n)"
  }
}
```

#### Extended Command Execution

**Execute Extended Command (M-x):**
```json
{
  "method": "command",
  "params": {
    "command": "execute-extended-command",
    "command-name": "query-replace-regexp",
    "args": {
      "from": "foo\\(bar\\)",
      "to": "baz\\1",
      "scope": "buffer"
    }
  }
}
```

**Execute Key Sequence:**
```json
{
  "method": "command",
  "params": {
    "command": "execute-keys",
    "keys": "SPC f s"  // Save all buffers via leader key
  }
}
```

**Execute with Capture:**
```json
{
  "method": "command",
  "params": {
    "command": "save-buffer",
    "capture-output": true
  }
}

// Response
{
  "result": {
    "success": true,
    "output": "Wrote /home/user/project/src/editor.ts",
    "buffer": "src/editor.ts",
    "size": 12345
  }
}
```

### AI Agent Workflow Examples

#### Example 1: Understand Codebase

```python
# AI agent exploring codebase
import tmax_client

client = tmax_client.connect()

# 1. What functions are available for buffer operations?
buffer_funcs = client.command("apropos-command", {"pattern": "buffer"})
# => [buffer-create, buffer-switch, buffer-insert, buffer-delete, ...]

# 2. Tell me about buffer-insert
docs = client.command("describe-function", {"function-name": "buffer-insert"})
print(docs["documentation"])
# => "Insert TEXT at cursor position..."

# 3. Show me the source
source = client.command("find-function-source", {"function-name": "buffer-insert"})
print(f"Defined at {source['file']}:{source['line']}")

# 4. Open that file
client.open(source["file"])
client.goto_line(source["line"])

# 5. What functions call buffer-insert?
callers = client.eval("(find-callers 'buffer-insert)")
# => [("src/editor/handlers/insert-handler.ts" 45)
#     ("src/tlisp/core-bindings.tlisp" 123)]
```

#### Example 2: Debug and Fix Issue

```python
# AI agent debugging workflow
client = tmax_client.connect()

# 1. Get current state
state = client.query("full-state")
print(f"Current buffer: {state['current-buffer']}")
print(f"Cursor: {state['buffers'][0]['cursor']}")

# 2. Run tests and see failures
test_results = client.command("run-tests", {"suite": "buffer-ops"})
# => {"passed": 3, "failed": 1, "errors": [...]}

# 3. Investigate failure
error = test_results["errors"][0]
print(f"Test failed: {error['test']}")
print(f"Error: {error['message']}")

# 4. Check related code
client.open(error["file"])
client.goto_line(error["line"])

# 5. Query documentation for the failing function
docs = client.command("describe-function", {"function-name": error["function"]})
print(docs["documentation"])

# 6. Make fix
client.replace(error["line"], error["line"], fixed_code)

# 7. Re-run tests
results = client.command("run-tests", {"suite": "buffer-ops"})
if results["failed"] == 0:
    print("✅ All tests passed!")
```

#### Example 3: Refactor Code

```python
# AI agent refactoring workflow
client = tmax_client.connect()

# 1. Find all usages of a function
usages = client.command("find-usages", {
    "function": "old-function-name",
    "scope": "project"
})

print(f"Found {len(usages)} usages:")
for usage in usages:
    print(f"  {usage['file']}:{usage['line']}")

# 2. Batch rename across all files
for usage in usages:
    client.open(usage["file"])
    client.goto_line(usage["line"])
    client.replace(
        usage["line"],
        usage["line"],
        usage["code"].replace("old-function-name", "new-function-name")
    )
    client.command("save-buffer")

# 3. Update the function definition
client.open("src/api/old-functions.ts")
source = client.buffer_text()
new_source = source.replace("defun old-function-name", "defun new-function-name")
client.replace_buffer_text(new_source)
client.command("save-buffer")

# 4. Verify no references to old name remain
refs = client.command("find-usages", {"function": "old-function-name"})
if len(refs) == 0:
    print("✅ Refactoring complete!")
```

#### Example 4: Generate Documentation

```python
# AI agent generating documentation
client = tmax_client.connect()

# 1. Get all public functions
functions = client.query("functions", {"pattern": "^[^*]"})  # Non-internal

# 2. Generate documentation for each
docs = []
for func in functions:
    info = client.command("describe-function", {"function-name": func["name"]})
    docs.append({
        "name": func["name"],
        "signature": info["signature"],
        "documentation": info["documentation"],
        "examples": info.get("examples", [])
    })

# 3. Write to docs buffer
client.command("switch-to-buffer", {"buffer": "*api-docs*"})
client.command("erase-buffer")

for doc in docs:
    client.insert(f"## {doc['name']}\n\n")
    client.insert(f"**Signature:** `{doc['signature']}`\n\n")
    client.insert(f"**Description:** {doc['documentation']}\n\n")
    if doc["examples"]:
        client.insert("**Examples:**\n```lisp\n")
        for example in doc["examples"]:
            client.insert(f"{example}\n")
        client.insert("```\n\n")

# 4. Save documentation
client.command("save-buffer-as", {"filename": "docs/api-reference.md"})
```

### AI Agent Feedback Loop Advantages

**Speed Comparison:**
```
Traditional File-Based Workflow:
1. Read file from disk      [~10ms]
2. Parse file               [~5ms]
3. Generate changes         [~50ms]
4. Write file to disk       [~10ms]
5. Read test file           [~10ms]
6. Run tests via shell      [~500ms]
7. Parse test output        [~20ms]
Total: ~605ms per iteration

tmax Server/Client Workflow:
1. Query editor state       [~1ms via socket]
2. Generate changes         [~50ms]
3. Apply changes in-memory  [~0.1ms]
4. Run tests via eval       [~10ms in-memory]
5. Get results directly     [~1ms]
Total: ~62ms per iteration

Speedup: 10x faster (605ms → 62ms)
```

**Quality Advantages:**
- ✅ **No file I/O race conditions** - All operations in single process
- ✅ **Atomic transactions** - Multiple changes can be applied atomically
- ✅ **Undo/redo integration** - Agent can leverage editor's undo history
- ✅ **Buffer state preservation** - No lost edits or save conflicts
- ✅ **Real-time validation** - Agent can check syntax/errors before committing

---

## Integration Examples

### Git Integration

**Set tmax as Git Editor:**
```bash
# ~/.gitconfig
[core]
    editor = tmaxclient -nw

# Or via environment
export GIT_EDITOR='tmaxclient -nw'
```

**Usage:**
```bash
# All git commands use your running tmax instance
git commit  # Opens commit msg in tmax, instant
git rebase -i  # Interactive rebase in tmax
git add -p  # Patch add in tmax
git config -e  # Edit config in tmax
```

**Benefits:**
- ✅ No startup overhead (tmax already running)
- ✅ Access to all buffers and kill ring
- ✅ Can reference code while writing commit messages
- ✅ Unified session across all git operations

---

### File Manager Integration

**Ranger File Manager:**
```bash
# ~/.config/ranger/rc.conf
map ec eval emacsclient --no-wait %s  # Original Emacs
map et eval tmaxclient --no-wait %s   # tmax
```

**lf File Manager:**
```bash
# ~/.config/lf/lfrc
cmd tmax ${{tmaxclient --no-wait $f}}
map t :tmax
```

**NNN File Manager:**
```bash
# Uses EDITOR variable
export EDITOR='tmaxclient -nw'
nnn -e  # Opens files in tmax

# Or custom keybind
nnn -e tmaxclient  # Direct integration
```

**fzf Integration:**
```bash
# Fuzzy file opener
tf() {
    local file=$(fzf --query="$1")
    [ -n "$file" ] && tmaxclient "$file"
}

# Fuzzy buffer switcher
tb() {
    local buffer=$(tmaxclient --list-buffers | fzf)
    [ -n "$buffer" ] && tmaxclient --switch-buffer "$buffer"
}
```

---

### Shell Integration

**Quick Commands:**
```bash
# ~/.bashrc or ~/.zshrc

# Quick note capture
tn() {
    local note=$*
    tmaxclient --eval "(buffer-insert \"${note}\")"
}

# Open file in tmax
t() {
    tmaxclient "$@"
}

# Open in new buffer
tt() {
    tmaxclient -c "$@"
}

# Evaluate T-Lisp
te() {
    tmaxclient --eval "$@"
}

# List buffers
tl() {
    tmaxclient --list-buffers
}
```

**Zsh Hooks:**
```zsh
# Preexec hook - run command before shell prompt
precmd() {
    # Update tmax status line with last command exit code
    tmaxclient --eval "(setq last-command-exit $?)" -n 2>/dev/null
}
```

---

### Script Integration

**Shell Scripts:**
```bash
#!/bin/bash
# deploy.sh

# Run deployment, log results to tmax buffer
deploy_app() {
    local output=$(./deploy.sh 2>&1)
    local exit_code=$?

    # Open results in tmax
    tmaxclient --eval "(progn
      (switch-to-buffer \"*deploy-results*\")
      (erase-buffer)
      (insert '$output')
      (goto-char (point-min)))"

    return $exit_code
}
```

**Python Scripts:**
```python
#!/usr/bin/env python3
import subprocess
import sys

def open_in_tmax(filepath: str):
    """Open file in running tmax instance."""
    subprocess.run(['tmaxclient', filepath], check=True)

def eval_tmax(code: str) -> str:
    """Evaluate T-Lisp code and return result."""
    result = subprocess.run(
        ['tmaxclient', '--eval', code],
        capture_output=True,
        text=True
    )
    return result.stdout.strip()

# Usage
open_in_tmax('README.md')
buffer_list = eval_tmax('(buffer-list)')
print(f"Buffers: {buffer_list}")
```

---

### Web Browser Integration

**Browser Extensions:**
```bash
# "Open in tmax" browser extension
# Calls external command:

#!/bin/bash
# /usr/local/bin/open-in-tmax
url=$1

tmaxclient --eval "(progn
  (switch-to-buffer \"*urls*\")
  (insert '$url')
  (insert \"\n\"))"

# Focus tmax window (wmctrl)
wmctrl -a "tmax"
```

**URL Capture:**
```bash
# Capture URL from browser to tmax
capture_url() {
    local url=$(pbpaste)  # macOS clipboard
    if [[ $url =~ ^https?:// ]]; then
        tmaxclient --eval "(insert-url \"$url\")"
    fi
}
```

---

### Task Runner Integration

**Make Integration:**
```makefile
# Makefile
EDITOR = tmaxclient -nw

.PHONY: edit-config
edit-config:
	$(EDITOR) config.yml

.PHONY: commit
commit: test
	git commit  # Uses tmaxclient via GIT_EDITOR
```

**Taskfile Integration:**
```yaml
# Taskfile.yml
version: '3'

tasks:
  edit:
    cmds:
      - tmaxclient {{.CLI_ARGS}}

  commit:
    cmds:
      - git add -A
      - git commit  # Uses tmaxclient
```

**npm Scripts:**
```json
{
  "scripts": {
    "edit": "tmaxclient",
    "commit": "git commit"
  }
}
```

---

## Alternatives Considered

### Alternative 1: No Server/Client (Status Quo)
**Rejected** - Poor user experience
- Pros: Simpler implementation
- Cons: Slow startup, fragmented state, can't use as $EDITOR effectively

### Alternative 2: Separate Server Binary
**Rejected** - Doesn't align with T-Lisp-first philosophy
- Pros: Dedicated server process
- Cons: Extra binary, duplicated T-Lisp interpreter, can't run from within tmax

### Alternative 3: HTTP API Instead of Sockets
**Rejected** - Overhead and complexity
- Pros: Language-agnostic, remote access easier
- Cons: HTTP overhead, more complex, less Unix-like

### Alternative 4: Integrated Server/Client (Chosen Approach)
**Selected** - Best alignment with architecture and user needs
- ✅ Single binary (tmax) with modes
- ✅ Unix socket for efficiency
- ✅ Optional TCP for remote
- ✅ T-Lisp-first architecture
- ✅ Emacs-like user experience

---

## Implementation Plan

### Feature Prioritization

The server/client feature is organized into three phases to enable iterative development:

**🚨 MUST HAVE (MVP - Phase 0.8.1)**
- Basic server mode and client CLI
- File opening with wait/no-wait modes
- T-Lisp evaluation
- Timeline: 1 week

**⭐ SHOULD HAVE (Phase 0.8.2)**
- Advanced client commands (list, kill, insert)
- Custom socket paths
- Multiple server instances
- Timeline: +1 week (2 weeks total)

**💡 NICE TO HAVE (Phase 0.8.3+)**
- TCP sockets (remote access)
- Auto-start server
- Server hooks and client info
- Timeline: +1 week (3 weeks total)

---

### Phase 0.8.1: Basic Server/Client [CRITICAL]
**Duration:** 1 week (5-7 days)
**Priority:** HIGH

**Server Implementation:**
- [ ] `tmax --daemon` command
- [ ] Unix socket listener (`/tmp/tmax-$UID/server`)
- [ ] JSON-RPC protocol handler
- [ ] Connection management (accept, close, cleanup)
- [ ] T-Lisp execution engine integration
- [ ] Graceful shutdown (SIGTERM, SIGINT)

**Client Implementation:**
- [ ] `tmaxclient` CLI tool
- [ ] File opening: `tmaxclient file.txt`
- [ ] T-Lisp eval: `tmaxclient --eval '(code)'`
- [ ] Wait mode (block until buffer closed)
- [ ] No-wait mode (`-n` flag)
- [ ] Error handling (server not running, connection refused)

**Testing:**
- [ ] Unit tests for server socket handling
- [ ] Unit tests for client connection logic
- [ ] Integration tests (server + client)
- [ ] Manual testing with real workflows (git, file managers)

---

### Phase 0.8.2: Advanced Client Features [IMPORTANT]
**Duration:** 1 week (5-7 days)
**Priority:** HIGH

**Client Commands:**
- [ ] `tmaxclient --list-buffers` - List all buffers
- [ ] `tmaxclient --kill-buffer name` - Kill specific buffer
- [ ] `tmaxclient --insert text` - Insert text at cursor
- [ ] `tmaxclient --insert-stdin` - Insert from stdin pipe
- [ ] `tmaxclient --script file.tlisp` - Execute T-Lisp file
- [ ] `tmaxclient --server-info` - Get server status
- [ ] `tmaxclient --ping` - Check if server running

**Socket Management:**
- [ ] Custom socket paths: `-s /path/to/socket`
- [ ] Environment variable: `$TMAX_SOCKET`
- [ ] Multiple server instances support
- [ ] Socket conflict detection
- [ ] Socket cleanup on shutdown

**Wait Modes:**
- [ ] `-c` flag (new frame/buffer mode)
- [ ] `-nw` flag (terminal mode for $EDITOR)
- [ ] Exit codes based on buffer state (saved/discarded)

**Integration Examples:**
- [ ] Git integration examples (`$GIT_EDITOR`)
- [ ] File manager examples (ranger, lf, nnn)
- [ ] Shell function examples (tf, tb, tl)
- [ ] Script examples (Python, shell)

---

### Phase 0.8.3: Advanced Features [MEDIUM]
**Duration:** 1 week (3-5 days)
**Priority:** MEDIUM

**TCP Sockets:**
- [ ] `tmax --daemon=tcp:host:port`
- [ ] `tmaxclient -s host:port file.txt`
- [ ] Remote connection support
- [ ] SSH tunnel examples
- [ ] Security considerations (localhost only by default)

**Auto-Start:**
- [ ] `--autostart` flag for client
- [ ] Config option: `(setq server-autostart t)`
- [ ] Server detection logic
- [ ] Automatic server startup on first request

**T-Lisp Server API:**
- [ ] `(server-running-p)` - Check server status
- [ ] `(server-socket-path)` - Get socket path
- [ ] `(server-clients)` - List connected clients
- [ ] `(server-broadcast message)` - Send to all clients
- [ ] `(server-current-client)` - Get current client info
- [ ] Server hooks: `server-client-connect-hook`, `server-client-disconnect-hook`
- [ ] Server hooks: `server-start-hook`, `server-shutdown-hook`

**Documentation:**
- [ ] User guide for server/client usage
- [ ] Integration examples (git, file managers, shells)
- [ ] T-Lisp API reference for server functions
- [ ] Troubleshooting guide (socket permissions, etc.)

---

### Total Timeline: 2.5-3 weeks

**MVP (Phase 0.8.1):** 1 week
- Basic server/client functionality
- File opening and T-Lisp evaluation

**Production (Phase 0.8.1 + 0.8.2):** 2 weeks
- Advanced client commands
- Wait modes and socket management
- Integration examples

**Complete (Phase 0.8.1 + 0.8.2 + 0.8.3):** 3 weeks
- TCP sockets and remote access
- Auto-start and T-Lisp server API
- Complete documentation

---

## References

### Inspiration Sources
- [Emacs Server Mode](https://www.gnu.org/software/emacs/manual/html_node/emacs/Emacs-Server.html) - Original server/client architecture
- [Emacs Client Manual](https://www.gnu.org/software/emacs/manual/html_node/emacs/Emacs-Client-Options.html) - Client options and usage
- [Neovim --listen](https://neovim.io/doc/user/remote.html#RPC) - Modern RPC-based remote control
- [VS Code Server](https://code.visualstudio.com/docs/remote/vscode-server) - Remote development server
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification) - Protocol specification

### Integration Examples
- [Git Editor Configuration](https://git-scm.com/docs/git-config#Documentation/git-config.txt-coreeditor) - $GIT_EDITOR usage
- [Ranger File Manager](https://github.com/ranger/ranger) - File manager integration patterns
- [lf File Manager](https://github.com/gokcehan/lf) - Unix philosophy file manager
- [NNN File Manager](https://github.com/jarun/nnn) - Terminal file manager
- [fzf Fuzzy Finder](https://github.com/junegunn/fzf) - Fuzzy search integration

### Related Documentation
- [tmax PRD](../specs/prd.md) - Product Requirements Document
- [tmax ROADMAP](../docs/ROADMAP.md) - Development roadmap
- [RFC-001: TRT Framework](RFC-001-trt-framework.md) - Testing framework RFC
- [CLAUDE.md](../CLAUDE.md) - Development guidelines

### Protocol References
- [Unix Domain Sockets](https://man7.org/linux/man-pages/man7/unix.7.html) - Unix socket programming
- [Node.js Net Module](https://nodejs.org/api/net.html) - Socket server implementation
- [Bun Subprocess](https://bun.sh/docs/cli/spawn) - Process spawning

---

## Appendix: Comparison Matrix

| Feature | Emacs | Neovim | VS Code | tmax (Proposed) |
|---------|-------|--------|---------|-----------------|
| Server Mode | ✅ emacs --daemon | ✅ nvim --listen | ✅ code server | ✅ tmax --daemon |
| Client CLI | ✅ emacsclient | ✅ nvim --remote | ✅ code-cli | ✅ tmaxclient |
| File Opening | ✅ Instant | ✅ Instant | ✅ Instant | ✅ Instant |
| T-Lisp Eval | ✅ --eval | ✅ --remote-send | ❌ No | ✅ --eval |
| Wait/No-Wait | ✅ -n/-c flags | ✅ --remote-wait | ⚠️ Limited | ✅ -n/-c/-nw |
| Unix Socket | ✅ Yes | ✅ Yes | ⚠️ TCP only | ✅ Yes |
| TCP Socket | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Phase 0.8.3 |
| $EDITOR Support | ✅ Excellent | ✅ Excellent | ✅ Good | ✅ Excellent |
| Scriptable | ✅ Excellent | ✅ Excellent | ⚠️ Limited | ✅ Excellent |
| Multiple Servers | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| Auto-Start | ❌ Manual | ❌ Manual | ✅ Yes | ✅ Phase 0.8.3 |
| Server Hooks | ✅ Yes | ⚠️ Limited | ❌ No | ✅ T-Lisp hooks |
| Terminal Native | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| **AI Agent Control** | ⚠️ Possible | ⚠️ Possible | ❌ No | ✅ **First-Class** |

### AI Agent Capabilities Comparison

| Capability | Emacs | Neovim | VS Code | tmax (Proposed) |
|------------|-------|--------|---------|-----------------|
| Full State Query | ⚠️ Complex | ⚠️ Complex | ❌ No API | ✅ Native JSON-RPC |
| Help System Access | ⚠️ Manual | ⚠️ Manual | ❌ No | ✅ Built-in Commands |
| Function Documentation | ⚠️ Manual | ⚠️ Manual | ❌ No | ✅ describe-function |
| Variable Inspection | ⚠️ Manual | ⚠️ Manual | ❌ No | ✅ describe-variable |
| Apropos Search | ⚠️ Manual | ⚠️ Manual | ❌ No | ✅ apropos-command |
| Source Location | ⚠️ Manual | ⚠️ Manual | ❌ No | ✅ find-function-source |
| In-Memory Execution | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| Atomic Transactions | ❌ No | ❌ No | ❌ No | ✅ Yes |
| Real-Time Feedback | ⚠️ Slow | ⚠️ Slow | ❌ No | ✅ Fast (10x) |
| Undo/Redo Integration | ⚠️ Manual | ⚠️ Manual | ❌ No | ✅ Native |

**Key Advantage:** tmax is the **first terminal editor designed from the ground up for AI agent control**, with native JSON-RPC protocol, comprehensive help system access, and in-memory execution for 10x faster iteration loops.

---

**Next Steps:**
1. Review and approve RFC
2. Implement Phase 0.8.1 (Basic Server/Client)
3. **Prioritize AI agent protocol extensions** (query methods, help system, state inspection)
4. Add integration examples and documentation
5. Create AI agent client library (Python, TypeScript)
6. Update PRD with implementation details
7. Update ROADMAP with Phase 0.8 timeline

**AI Agent Development Priority:**
The AI agent integration should be considered a **high-priority feature** as it provides:
- Competitive differentiation (no other editor has first-class AI control)
- 10x faster AI development workflows (in-memory vs file I/O)
- Natural fit with T-Lisp-first architecture (eval, describe, apropos)
- Alignment with AI-assisted development trends

**Recommended Phasing:**
- **Phase 0.8.1**: Basic server/client + core AI query methods
- **Phase 0.8.2**: Help system integration + extended commands
- **Phase 0.8.3**: AI agent client libraries + documentation
