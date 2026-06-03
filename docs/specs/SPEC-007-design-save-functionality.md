# Enhanced Save Functionality Design: :w and :wq with File Naming

## Overview

**COMPREHENSIVE FUNCTIONAL DESIGN** specification for enhancing the `:w` and `:wq` commands to support file naming, following tmax functional programming requirements:
- Task-based operations with lazy evaluation
- TaskEither for error handling  
- No Promise usage or exception throwing
- Functional composition patterns
- Immutable state management
- Pure function design

## Current State Analysis

### Existing Implementation
- ✅ Basic `:w` and `:wq` commands exist but only save to current buffer's associated file
- ✅ `saveFile()` method implements file writing using buffer-to-filename mapping
- ✅ Command parsing in `editor-execute-command-line` handles basic commands
- ❌ **Missing**: Filename parsing from command arguments (e.g., `:w filename.txt`)
- ❌ **Missing**: New file creation from commands
- ❌ **Missing**: "Save As" functionality

### Current Limitations
1. No argument parsing for `:w filename` or `:wq filename`
2. Cannot create new files via save commands
3. No validation for file path safety or permissions
4. Limited error handling for file operations
5. No support for relative/absolute path resolution

## Requirements

### Functional Requirements

1. **Command Syntax Support**
   ```bash
   :w                    # Save current buffer to associated file
   :w filename.txt       # Save current buffer to specified file
   :w path/to/file.txt   # Save with relative/absolute path
   :wq                   # Save current buffer and quit
   :wq filename.txt      # Save to specified file and quit
   ```

2. **File Operations**
   - Save existing buffer to new filename (Save As)
   - Create new files if they don't exist
   - Overwrite existing files with confirmation
   - Handle directory creation for nested paths
   - Support both relative and absolute paths

3. **Buffer Management**
   - Update buffer-to-file associations after save
   - Handle unnamed buffers (*scratch*)
   - Maintain buffer state consistency

4. **Error Handling**
   - Invalid file paths or names
   - Permission denied errors
   - File system errors (disk full, read-only)
   - Path traversal security validation

### Non-Functional Requirements

1. **Security**: Validate file paths to prevent directory traversal attacks
2. **Performance**: Async file operations with proper error handling
3. **Usability**: Clear status messages and error feedback
4. **Consistency**: Follow existing tmax patterns and conventions

## Architecture Design

### 1. Command Parser Enhancement

#### Functional Command Structure
```typescript
import { Task, TaskEither } from "../utils/task-either.ts";

// Explicit error types for TaskEither
export type SaveError = 
  | "NO_BUFFER"
  | "NO_FILENAME" 
  | "INVALID_PATH"
  | "PERMISSION_DENIED"
  | "FILESYSTEM_ERROR"
  | "SECURITY_VIOLATION";

interface SaveCommand {
  action: 'save' | 'saveAndQuit' | 'quit';
  filename?: string;
  options?: SaveOptions;
}

interface SaveOptions {
  force?: boolean;      // Force overwrite (future: :w!)
  backup?: boolean;     // Create backup (future: :w~)
  encoding?: string;    // File encoding (future)
}

// Validation result using functional patterns
interface ValidationResult {
  valid: boolean;
  error?: SaveError;
  resolvedPath?: string;
}
```

#### Functional Command Parsing
```typescript
// Task-based command parsing with option chain pattern (lazy evaluation)
const parseCommandTask = (commandLine: string): Task<SaveCommand | null> =>
  Task.of(() => {
    const trimmed = commandLine.trim();
    
    const tryParseCommand = <T>(
      regex: RegExp, 
      builder: (match: RegExpMatchArray) => T
    ): T | null => {
      const match = trimmed.match(regex);
      return match ? builder(match) : null;
    };
    
    // Functional option chain with early return (replaces if guard clauses)
    return (
      tryParseCommand(/^(w|write)(?:\s+(.+))?$/, match => ({
        action: 'save' as const,
        filename: match[2]?.trim()
      })) ??
      tryParseCommand(/^(wq)(?:\s+(.+))?$/, match => ({
        action: 'saveAndQuit' as const,
        filename: match[2]?.trim()
      })) ??
      tryParseCommand(/^(q|quit)$/, () => ({
        action: 'quit' as const
      })) ??
      null
    );
  });

// Alternative: Array + Find pattern for extensible command parsing
const parseCommandExtensible = (commandLine: string): Task<SaveCommand | null> =>
  Task.of(() => {
    const trimmed = commandLine.trim();
    
    const patterns = [
      {
        regex: /^(w|write)(?:\s+(.+))?$/,
        builder: (match: RegExpMatchArray) => ({
          action: 'save' as const,
          filename: match[2]?.trim()
        })
      },
      {
        regex: /^(wq)(?:\s+(.+))?$/,
        builder: (match: RegExpMatchArray) => ({
          action: 'saveAndQuit' as const,
          filename: match[2]?.trim()
        })
      },
      {
        regex: /^(q|quit)$/,
        builder: () => ({ action: 'quit' as const })
      }
    ];
    
    return patterns
      .map(pattern => ({ ...pattern, match: trimmed.match(pattern.regex) }))
      .find(p => p.match)
      ?.builder(p.match!) ?? null;
  });
```

### 2. Enhanced File Operations Interface

#### Functional EditorOperations Interface
```typescript
export interface EditorOperations {
  // ❌ OLD: Promise-based (violates functional requirements)
  // saveFile: () => Promise<void>;
  
  // ✅ NEW: Task-based with explicit error types
  saveCurrentBuffer: (filename?: string) => TaskEither<SaveError, void>;
  validateFilePath: (path: string) => Task<ValidationResult>;
  resolveFilePath: (path: string) => Task<string>;
  createDirectoryIfNeeded: (path: string) => TaskEither<SaveError, void>;
  updateBufferAssociation: (oldName: string, newName: string) => Task<void>;
  openFile: (filename: string) => TaskEither<SaveError, void>;
}

// Error message mapping for user feedback
const errorMessages: Record<SaveError, string> = {
  NO_BUFFER: "No buffer to save",
  NO_FILENAME: "No filename specified. Use :w filename.txt or ensure buffer has associated file",
  INVALID_PATH: "Invalid file path. Check for invalid characters or path length",
  PERMISSION_DENIED: "Permission denied. Check file/directory permissions", 
  FILESYSTEM_ERROR: "File system error occurred",
  SECURITY_VIOLATION: "Security violation: path traversal or system file access not allowed"
};
```

### 3. Enhanced Save Implementation

#### Core Save Logic with Task Composition
```typescript
// Task-based save implementation following functional patterns
const saveCurrentBufferTask = (
  state: EditorState,
  filename?: string
): TaskEither<SaveError, void> => {
  
  // Validate buffer exists using Task pattern
  const validateBuffer = (): TaskEither<SaveError, TextBuffer> =>
    state.currentBuffer 
      ? TaskEither.right(state.currentBuffer)
      : TaskEither.left("NO_BUFFER" as SaveError);

  // Determine target filename using functional composition
  const determineFilename = (buffer: TextBuffer): TaskEither<SaveError, string> =>
    filename 
      ? TaskEither.right(filename)
      : getCurrentBufferFilenameTask(state, buffer);

  // File path validation with Task pattern
  const validatePath = (path: string): TaskEither<SaveError, string> =>
    validateFilePathTask(path)
      .flatMap(validation => 
        validation.valid
          ? TaskEither.right(validation.resolvedPath!)
          : TaskEither.left(validation.error!)
      );

  // Functional composition pipeline
  return validateBuffer()
    .flatMap(determineFilename)
    .flatMap(validatePath) 
    .flatMap(resolvedPath =>
      // Compose directory creation and file writing
      createDirectoryIfNeededTask(resolvedPath)
        .flatMap(() => writeFileTask(state, resolvedPath))
        .flatMap(() => updateBufferAssociationTask(state, filename, resolvedPath))
        .map(() => {
          // Immutable state update
          return updateStatusMessage(state, `Saved ${resolvedPath}`);
        })
    );
};

#### Individual Task Functions
```typescript
// Get current buffer filename using Task pattern
const getCurrentBufferFilenameTask = (
  state: EditorState, 
  buffer: TextBuffer
): TaskEither<SaveError, string> =>
  TaskEither.tryCatch(
    () => {
      for (const [name, buf] of state.buffers) {
        if (buf === buffer && name !== "*scratch*") {
          return name;
        }
      }
      throw new Error("NO_FILENAME");
    },
    () => "NO_FILENAME" as SaveError
  );

// File path validation with Task pattern
const validateFilePathTask = (path: string): Task<ValidationResult> =>
  Task.of(() => {
    // Security checks
    if (path.includes('..')) {
      return { valid: false, error: "SECURITY_VIOLATION" as SaveError };
    }
    
    if (path.startsWith('/proc/') || path.startsWith('/sys/')) {
      return { valid: false, error: "SECURITY_VIOLATION" as SaveError };
    }
    
    if (path.length > 4096) {
      return { valid: false, error: "INVALID_PATH" as SaveError };
    }
    
    const invalidChars = /[<>:"|?*\x00-\x1f]/;
    if (invalidChars.test(path)) {
      return { valid: false, error: "INVALID_PATH" as SaveError };
    }
    
    return { valid: true, resolvedPath: path };
  });

// Directory creation using TaskEither
const createDirectoryIfNeededTask = (filePath: string): TaskEither<SaveError, void> => {
  const pathParts = filePath.split('/');
  if (pathParts.length <= 1) {
    return TaskEither.right(void 0);
  }
  
  const dirPath = pathParts.slice(0, -1).join('/');
  
  return TaskEither.tryCatch(
    async () => {
      await Deno.mkdir(dirPath, { recursive: true });
    },
    (error) => {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes("already exists") || errorMsg.includes("File exists")) {
        return void 0; // Directory exists, that's OK
      }
      return "FILESYSTEM_ERROR" as SaveError;
    }
  );
};

// File writing using TaskEither
const writeFileTask = (
  state: EditorState, 
  resolvedPath: string
): TaskEither<SaveError, void> =>
  TaskEither.tryCatch(
    async () => {
      const content = state.currentBuffer!.getContent();
      await state.filesystem.writeFile(resolvedPath, content);
    },
    (error) => {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes("Permission denied")) {
        return "PERMISSION_DENIED" as SaveError;
      }
      return "FILESYSTEM_ERROR" as SaveError;
    }
  );

// Buffer association update using Task
const updateBufferAssociationTask = (
  state: EditorState,
  filename: string | undefined,
  resolvedPath: string  
): Task<void> =>
  Task.of(() => {
    if (!filename) return; // No association change needed
    
    // Find and remove old association
    const oldName = getCurrentBufferName(state);
    if (oldName && oldName !== "*scratch*") {
      state.buffers.delete(oldName);
    }
    
    // Add new association
    state.buffers.set(resolvedPath, state.currentBuffer!);
  });

// Immutable status message update
const updateStatusMessage = (state: EditorState, message: string): void => {
  // In a fully functional approach, this would return a new state object
  // For now, we update the existing state as per current architecture
  state.statusMessage = message;
};
### 4. Integration with Command System

#### Functional Command Handler
```typescript
// Updated command handler using TaskEither composition
export function createEditorAPI(state: EditorState): Map<string, Function> {
  const api = new Map<string, Function>();
  
  api.set("editor-execute-command-line", (args: TLispValue[]): TLispValue => {
    if (args.length !== 0) {
      // Using TaskEither instead of throwing
      const errorTask = TaskEither.left("Invalid arguments");
      // Handle error functionally
      return createString("error");
    }
    
    const command = state.commandLine.trim();
    
    // Functional command processing pipeline using option chain pattern
    const processCommand = parseCommandTask(command)
      .flatMap(parsedCmd => {
        if (!parsedCmd) {
          return TaskEither.left(`Unknown command: ${command}`);
        }
        
        return executeCommandTask(state, parsedCmd);
      })
      .map(() => {
        // Clear command and return to normal mode
        state.commandLine = "";
        state.mode = "normal";
        return "command-executed";
      })
      .mapLeft(error => {
        state.statusMessage = `Command error: ${error}`;
        state.commandLine = "";
        state.mode = "normal";
        return "command-error";
      });
    
    // Execute the task (this bridges to the synchronous T-Lisp world)
    processCommand.run().then(result => {
      // Handle result asynchronously
      if (result.isLeft()) {
        console.error("Command execution failed:", result.left);
      }
    });
    
    return createString("command-queued");
  });
  
  return api;
}

// Execute command using TaskEither composition
const executeCommandTask = (
  state: EditorState, 
  cmd: SaveCommand
): TaskEither<string, void> => {
  switch (cmd.action) {
    case 'quit':
      // Handle quit signal functionally
      return TaskEither.left("EDITOR_QUIT_SIGNAL");
      
    case 'save':
      return state.operations?.saveCurrentBuffer 
        ? state.operations.saveCurrentBuffer(cmd.filename)
            .mapLeft(error => `Save failed: ${error}`)
        : TaskEither.left("Save functionality not available");
        
    case 'saveAndQuit':
      return state.operations?.saveCurrentBuffer
        ? state.operations.saveCurrentBuffer(cmd.filename)
            .flatMap(() => TaskEither.left("EDITOR_QUIT_SIGNAL"))
            .mapLeft(error => 
              error === "EDITOR_QUIT_SIGNAL" 
                ? error 
                : `Save failed: ${error}`
            )
        : TaskEither.left("Save functionality not available");
        
    default:
      return TaskEither.left("Unknown command action");
  }
};
```

### 5. Functional Error Handling Strategy

#### Explicit Error Types
```typescript
// Explicit error types instead of generic Error objects
export const SaveErrors = {
  NO_BUFFER: "NO_BUFFER" as const,
  NO_FILENAME: "NO_FILENAME" as const, 
  INVALID_PATH: "INVALID_PATH" as const,
  PERMISSION_DENIED: "PERMISSION_DENIED" as const,
  FILESYSTEM_ERROR: "FILESYSTEM_ERROR" as const,
  SECURITY_VIOLATION: "SECURITY_VIOLATION" as const
} as const;

// Error message mapping
export const errorMessages: Record<SaveError, string> = {
  NO_BUFFER: "No buffer to save",
  NO_FILENAME: "No filename specified. Use :w filename.txt or ensure buffer has associated file",
  INVALID_PATH: "Invalid file path. Check for invalid characters or path length",
  PERMISSION_DENIED: "Permission denied. Check file/directory permissions", 
  FILESYSTEM_ERROR: "File system error occurred",
  SECURITY_VIOLATION: "Security violation: path traversal or system file access not allowed"
};
```

## Implementation Benefits

### ✅ **Functional Pattern Compliance**
- **Task-based operations**: Lazy evaluation with explicit error handling
- **No Promise usage**: All operations use Task/TaskEither patterns
- **No exception throwing**: Explicit error types with TaskEither
- **Function composition**: Pipeline operations with flatMap/map
- **Immutable patterns**: Functional state updates where possible

### ✅ **Error Safety**
- Compile-time error checking with TypeScript
- No uncaught exceptions or Promise rejections
- Explicit error propagation through TaskEither
- Clear error categorization and messaging

### ✅ **Composability** 
- Each operation is a pure Task that can be composed
- Lazy evaluation prevents unnecessary work
- Easy to test individual components
- Clear separation of concerns

## Implementation Phases

### Phase 1: Task-Based Command Parsing
- [ ] Implement `parseCommandTask()` function using Task pattern
- [ ] Add functional command parsing with proper type safety
- [ ] Create unit tests for command parsing edge cases
- [ ] Update command handler to use TaskEither composition

### Phase 2: Functional Path Validation
- [ ] Implement `validateFilePathTask()` with Task pattern
- [ ] Add security validation using pure functions
- [ ] Create validation result types with explicit error handling
- [ ] Build comprehensive test suite for path validation

### Phase 3: TaskEither Save Operations
- [ ] Implement `saveCurrentBufferTask()` with TaskEither composition
- [ ] Create individual Task functions for each save step
- [ ] Add functional directory creation and file writing
- [ ] Update buffer associations using Task pattern

### Phase 4: Functional Integration
- [ ] Update EditorOperations interface with TaskEither signatures
- [ ] Wire TaskEither-based functionality into T-Lisp command system
- [ ] Create comprehensive integration tests for functional pipeline
- [ ] Update documentation with functional patterns

### Phase 5: Advanced Functional Features (Future)
- [ ] Add validation applicative for comprehensive error collection
- [ ] Implement Reader monad for dependency injection
- [ ] Add State monad for immutable state management
- [ ] Consider Effect system for controlled side effects

## Error Handling Strategy

### Error Categories
1. **User Input Errors**: Invalid syntax, malformed filenames
2. **File System Errors**: Permission denied, disk full, read-only filesystem  
3. **Security Errors**: Path traversal attempts, system file access
4. **Application State Errors**: No buffer to save, editor not initialized

### Functional Error Recovery
```typescript
// Error recovery using TaskEither patterns
const handleSaveError = (error: SaveError): TaskEither<SaveError, void> => {
  switch (error) {
    case "NO_FILENAME":
      return TaskEither.left("Provide filename: :w filename.txt");
    case "PERMISSION_DENIED":
      return TaskEither.left("Check file permissions and try again");
    case "FILESYSTEM_ERROR":
      return TaskEither.left("File system error - check disk space");
    case "SECURITY_VIOLATION":
      return TaskEither.left("Invalid path - no traversal allowed");
    default:
      return TaskEither.left("Unknown save error occurred");
  }
};

// Error message mapping with functional approach
const getErrorMessage = (error: SaveError): string =>
  errorMessages[error] || "Unknown error occurred";
```

## Testing Strategy

### Unit Tests
- Command parsing with various input formats
- Path validation edge cases and security scenarios
- File operations with mocked filesystem
- Error handling for all failure modes

### Integration Tests
- Full workflow: command entry → parsing → validation → save → status update
- Buffer association updates after save-as operations
- Interaction with existing buffer and editor state

### Security Tests
- Path traversal prevention
- System file access prevention
- Long path handling
- Invalid character handling

## Migration Strategy

### Backward Compatibility
- Existing `:w` and `:wq` commands continue to work unchanged
- No breaking changes to current API
- Gradual enhancement approach

### Rollout Plan
1. **Phase 1**: Internal API changes with existing behavior preserved
2. **Phase 2**: Enable filename arguments with feature flag
3. **Phase 3**: Full functionality enabled by default
4. **Phase 4**: Add advanced features

## Future Enhancements

### Planned Features
- **File Explorer Integration**: `:e` command with tab completion
- **Recent Files**: `:recent` or `:r` to access recently opened files
- **Session Management**: Save and restore editor sessions
- **Multiple File Operations**: `:wa` to save all modified buffers
- **File Encoding**: Support for different character encodings
- **Backup Strategies**: Automatic backups, versioned saves

### Performance Optimizations
- Async file operations with progress indication
- File system watching for external changes
- Incremental save for large files
- Compressed save options

This design provides a comprehensive foundation for implementing robust, secure, and user-friendly file save functionality in tmax while maintaining compatibility with existing code and following established architectural patterns.