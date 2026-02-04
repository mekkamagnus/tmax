# Advanced Client Commands

## Status

**proposed**

## Context

Basic server/client infrastructure (US-0.8.1) provided minimal edit/query commands. For full functionality, clients needed:
- Buffer management (create, switch, delete)
- Cursor movement and positioning
- Mode switching
- Search and replace
- Undo/redo operations

## Decision

Extend client protocol with advanced commands:

### Buffer Management

```lisp
;; Client sends buffer commands
(buffer-create "file.txt")
(buffer-switch "file.txt")
(buffer-list)
(buffer-delete "file.txt")
```

### Cursor Operations

```lisp
;; Move cursor
(cursor-move 10 5)  ; line 10, column 5
(cursor-up 5)       ; move up 5 lines
(cursor-down 3)     ; move down 3 lines
(cursor-left 10)    ; move left 10 columns
(cursor-right 5)    ; move right 5 columns
```

### Mode Commands

```lisp
;; Switch modes
(mode-enter "normal")
(mode-enter "insert")
(mode-enter "visual")
(mode-enter "command")
```

### Search and Replace

```lisp
;; Search
(search-forward "pattern")
(search-backward "pattern")
(replace "pattern" "replacement")
```

### Undo/Redo

```lisp
(undo)
(redo)
(undo-tree)  ; Get undo tree structure
```

### Implementation

Extended protocol in `src/server/protocol.ts`:
```typescript
export type ClientCommand =
  | BufferCommand
  | CursorCommand
  | ModeCommand
  | SearchCommand
  | UndoCommand;

export interface BufferCommand {
  type: 'buffer';
  action: 'create' | 'switch' | 'list' | 'delete';
  name?: string;
}

export interface CursorCommand {
  type: 'cursor';
  action: 'move' | 'up' | 'down' | 'left' | 'right';
  args?: (string | number)[];
}
```

Server handlers in `src/server/handlers.ts`:
```typescript
export class CommandHandler {
  handleBufferCommand(cmd: BufferCommand): ServerMessage {
    switch (cmd.action) {
      case 'create':
        return this.editor.createBuffer(cmd.name!);
      case 'switch':
        return this.editor.switchBuffer(cmd.name!);
      // ...
    }
  }

  handleCursorCommand(cmd: CursorCommand): ServerMessage {
    // Execute cursor operation
    // Return new cursor position
  }
}
```

## Consequences

### Benefits

1. **Full Feature Parity**: Clients have same capabilities as local editor
2. **Remote Editing**: Complete editor control remotely
3. **API Consistency**: Same operations across local and remote
4. **Extensibility**: Easy to add new commands

### Trade-offs

1. **Protocol Complexity**: More commands to implement and maintain
2. **Versioning**: Must handle protocol version compatibility
3. **Performance**: Remote commands slower than local
4. **Error Handling**: Network errors complicate command flow

### Future Considerations

1. **Batch Commands**: Send multiple commands in one request
2. **Command Chaining**: Execute commands conditionally
3. **Transaction Support**: Atomic multi-command operations
4. **Command Macros**: Record and replay command sequences
5. **Permissions**: Restrict certain commands for some clients

### Testing

Created `test/unit/server-client.test.ts`:
- All buffer commands work correctly
- Cursor commands update position
- Mode switches work remotely
- Search operations find matches
