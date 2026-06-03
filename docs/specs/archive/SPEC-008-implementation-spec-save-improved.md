# Enhanced :w and :wq Commands - Improved Implementation Specification

## Executive Summary

This specification provides an improved implementation guide for `:w filename` and `:wq filename` functionality that leverages tmax's existing functional programming infrastructure and architectural patterns.

## Key Improvements Over Original Spec

### ✅ **Architectural Alignment**
- Leverages existing `FunctionalFileSystemImpl` with full TaskEither support
- Uses established `TaskEitherUtils` for common file operations
- Integrates with existing `EditorState` and `EditorOperations` patterns
- Follows established T-Lisp API conventions

### ✅ **Functional Programming Compliance**
- Utilizes mature TaskEither implementation with comprehensive utilities
- Leverages existing error handling patterns and types
- Uses established functional composition patterns
- Follows tmax's lazy evaluation and explicit error handling philosophy

### ✅ **Security & Validation**
- Incorporates existing path validation utilities
- Uses established security patterns from filesystem module
- Leverages existing error categorization system

## Core Implementation Strategy

### 1. Enhanced EditorOperations Interface

**Current State**: The interface uses Promise-based operations
**Improvement**: Extend to include TaskEither operations while maintaining backward compatibility

```typescript
// src/editor/tlisp-api.ts - Enhanced interface
export interface EditorOperations {
  // Existing Promise-based operations (maintain backward compatibility)
  saveFile: () => Promise<void>;
  openFile: (filename: string) => Promise<void>;
  
  // NEW: TaskEither-based operations for enhanced save functionality
  saveCurrentBuffer?: (filename?: string) => TaskEither<SaveError, void>;
  validateFilePath?: (path: string) => TaskEither<ValidationError, string>;
  createDirectoryPath?: (path: string) => TaskEither<FileSystemError, void>;
}

// Explicit error types leveraging existing patterns
export type SaveError = 
  | "NO_BUFFER"
  | "NO_FILENAME" 
  | "INVALID_PATH"
  | "PERMISSION_DENIED"
  | "FILESYSTEM_ERROR"
  | "SECURITY_VIOLATION";

export type ValidationError = 
  | "INVALID_PATH"
  | "SECURITY_VIOLATION"
  | "PATH_TOO_LONG";

export type FileSystemError = string; // Leverage existing filesystem error handling
```

### 2. Enhanced Command Parsing with Existing T-Lisp Patterns

**Current State**: Basic command parsing in `editor-execute-command-line`
**Improvement**: Enhance existing parsing logic with TaskEither composition

```typescript
// src/editor/tlisp-api.ts - Enhanced command parsing
interface SaveCommand {
  action: 'save' | 'saveAndQuit' | 'quit';
  filename?: string;
}

const parseCommandTask = (commandLine: string): Task<SaveCommand | null> =>
  Task.fromSync(() => {
    const trimmed = commandLine.trim();
    
    // Enhanced regex patterns for robust parsing
    const patterns = [
      {
        regex: /^(w|write)(?:\s+(.+))?$/,
        builder: (match: RegExpMatchArray) => ({
          action: 'save' as const,
          filename: match[2]?.trim()
        })
      },
      {
        regex: /^(wq|writequit)(?:\s+(.+))?$/,
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
    
    for (const pattern of patterns) {
      const match = trimmed.match(pattern.regex);
      if (match) {
        return pattern.builder(match);
      }
    }
    
    return null;
  });
```

### 3. Leverage Existing FunctionalFileSystemImpl

**Current State**: The codebase has a sophisticated functional filesystem
**Improvement**: Use existing infrastructure instead of recreating it

```typescript
// src/editor/editor.ts - Enhanced save implementation
import { FunctionalFileSystemImpl, FileSystemUtils } from "../core/filesystem.ts";
import { TaskEither, Task } from "../utils/task-either.ts";

class Editor {
  private functionalFileSystem: FunctionalFileSystemImpl;
  
  constructor(terminal: TerminalIO, filesystem: FileSystem) {
    // ... existing constructor logic
    this.functionalFileSystem = new FunctionalFileSystemImpl();
    
    // Enhance operations with TaskEither functionality
    this.state.operations = {
      // Existing Promise-based operations
      saveFile: () => this.saveFile(),
      openFile: (filename: string) => this.openFile(filename),
      
      // NEW: TaskEither-based operations
      saveCurrentBuffer: (filename?: string) => this.saveCurrentBufferTask(filename),
      validateFilePath: (path: string) => this.validateFilePathTask(path),
      createDirectoryPath: (path: string) => this.createDirectoryTask(path),
    };
  }
  
  /**
   * TaskEither-based save implementation leveraging existing infrastructure
   */
  private saveCurrentBufferTask(filename?: string): TaskEither<SaveError, void> {
    const validateBuffer = (): TaskEither<SaveError, TextBuffer> =>
      this.state.currentBuffer 
        ? TaskEither.right(this.state.currentBuffer)
        : TaskEither.left("NO_BUFFER" as SaveError);

    const determineFilename = (buffer: TextBuffer): TaskEither<SaveError, string> => {
      if (filename) {
        return TaskEither.right(filename);
      }
      
      // Find current buffer filename
      for (const [name, buf] of this.state.buffers) {
        if (buf === buffer && name !== "*scratch*") {
          return TaskEither.right(name);
        }
      }
      
      return TaskEither.left("NO_FILENAME" as SaveError);
    };

    const validateAndPreparePath = (path: string): TaskEither<SaveError, string> =>
      this.validateFilePathTask(path)
        .mapLeft((error): SaveError => error === "INVALID_PATH" ? "INVALID_PATH" : "SECURITY_VIOLATION")
        .flatMap(validPath => 
          this.createDirectoryTask(validPath)
            .mapLeft((): SaveError => "FILESYSTEM_ERROR")
            .map(() => validPath)
        );

    const writeFileContent = (path: string, buffer: TextBuffer): TaskEither<SaveError, void> =>
      this.functionalFileSystem.writeFile(path, buffer.getContent())
        .mapLeft((error): SaveError => {
          if (error.includes("Permission denied")) return "PERMISSION_DENIED";
          return "FILESYSTEM_ERROR";
        });

    const updateBufferAssociation = (path: string): Task<void> =>
      Task.fromSync(() => {
        if (filename) {
          // Remove old association if it exists
          const oldName = this.getCurrentBufferName();
          if (oldName && oldName !== "*scratch*") {
            this.state.buffers.delete(oldName);
          }
          
          // Add new association
          this.state.buffers.set(path, this.state.currentBuffer!);
        }
        
        // Update status message
        this.state.statusMessage = `Saved ${path}`;
      });

    // Functional composition pipeline
    return validateBuffer()
      .flatMap(determineFilename)
      .flatMap(validateAndPreparePath)
      .flatMap(path => 
        writeFileContent(path, this.state.currentBuffer!)
          .flatMap(() => TaskEither.fromTask(updateBufferAssociation(path)))
      );
  }
  
  /**
   * Path validation using existing security patterns
   */
  private validateFilePathTask(path: string): TaskEither<ValidationError, string> {
    return Task.fromSync(() => {
      // Security checks using existing patterns
      if (path.includes('..')) {
        return Either.left("SECURITY_VIOLATION" as ValidationError);
      }
      
      if (path.startsWith('/proc/') || path.startsWith('/sys/')) {
        return Either.left("SECURITY_VIOLATION" as ValidationError);
      }
      
      if (path.length > 4096) {
        return Either.left("PATH_TOO_LONG" as ValidationError);
      }
      
      const invalidChars = /[<>:"|?*\x00-\x1f]/;
      if (invalidChars.test(path)) {
        return Either.left("INVALID_PATH" as ValidationError);
      }
      
      return Either.right(path);
    });
  }
  
  /**
   * Directory creation using existing FileSystemUtils
   */
  private createDirectoryTask(filePath: string): TaskEither<string, void> {
    const pathParts = filePath.split('/');
    if (pathParts.length <= 1) {
      return TaskEither.right(void 0);
    }
    
    const dirPath = pathParts.slice(0, -1).join('/');
    return FileSystemUtils.ensureDir(dirPath);
  }
  
  /**
   * Helper to get current buffer name
   */
  private getCurrentBufferName(): string | null {
    for (const [name, buffer] of this.state.buffers) {
      if (buffer === this.state.currentBuffer) {
        return name;
      }
    }
    return null;
  }
}
```

### 4. Enhanced Command Execution with Existing Patterns

**Current State**: Basic command handling with manual async handling
**Improvement**: Use TaskEither composition with proper error propagation

```typescript
// src/editor/tlisp-api.ts - Enhanced command execution
const executeCommandTask = (
  state: EditorState, 
  cmd: SaveCommand
): TaskEither<string, void> => {
  switch (cmd.action) {
    case 'quit':
      return TaskEither.left("EDITOR_QUIT_SIGNAL");
      
    case 'save':
      if (!state.operations?.saveCurrentBuffer) {
        return TaskEither.left("Enhanced save functionality not available");
      }
      
      return state.operations.saveCurrentBuffer(cmd.filename)
        .mapLeft(error => `Save failed: ${error}`)
        .map(() => {
          state.statusMessage = cmd.filename 
            ? `Saved as ${cmd.filename}` 
            : "Saved";
        });
        
    case 'saveAndQuit':
      if (!state.operations?.saveCurrentBuffer) {
        return TaskEither.left("Enhanced save functionality not available");
      }
      
      return state.operations.saveCurrentBuffer(cmd.filename)
        .flatMap(() => TaskEither.left("EDITOR_QUIT_SIGNAL"))
        .mapLeft(error => 
          error === "EDITOR_QUIT_SIGNAL" 
            ? error 
            : `Save failed: ${error}`
        );
        
    default:
      return TaskEither.left("Unknown command action");
  }
};

// Enhanced editor-execute-command-line implementation
api.set("editor-execute-command-line", (args: TLispValue[]): TLispValue => {
  if (args.length !== 0) {
    state.statusMessage = "Invalid arguments";
    return createString("error");
  }
  
  const command = state.commandLine.trim();
  
  // Use functional composition pipeline
  parseCommandTask(command)
    .flatMap(parsedCmd => {
      if (!parsedCmd) {
        return Task.fromSync(() => {
          state.statusMessage = `Unknown command: ${command}`;
          return null;
        });
      }
      
      // Execute command task asynchronously with proper error handling
      return TaskEither.fromTask(Task.fromSync(() => parsedCmd))
        .flatMap(cmd => executeCommandTask(state, cmd))
        .fold(
          error => {
            if (error === "EDITOR_QUIT_SIGNAL") {
              throw new Error("EDITOR_QUIT_SIGNAL");
            }
            state.statusMessage = error;
          },
          () => {
            // Success case - status message set in executeCommandTask
          }
        );
    })
    .run()
    .catch(error => {
      if (error instanceof Error && error.message.includes("EDITOR_QUIT_SIGNAL")) {
        throw error; // Re-throw quit signal
      }
      state.statusMessage = `Command error: ${error instanceof Error ? error.message : String(error)}`;
    });
  
  // Clear command and return to normal mode
  state.commandLine = "";
  state.mode = "normal";
  
  return createString("command-executed");
});
```

## Testing Strategy with Existing Infrastructure

### Leverage Existing Test Patterns

```typescript
// test/unit/enhanced-save.test.ts
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { FileSystemImpl } from "../../src/core/filesystem.ts";
import { TaskEither, Either } from "../../src/utils/task-either.ts";

// Test enhanced save functionality
Deno.test("Enhanced save with filename", async () => {
  const terminal = new MockTerminal();
  const filesystem = new FileSystemImpl();
  const editor = new Editor(terminal, filesystem);
  const state = editor.getState();
  
  // Create a buffer with content
  state.currentBuffer = new TextBufferImpl("test content");
  state.buffers.set("*scratch*", state.currentBuffer);
  
  // Test save with filename using TaskEither
  const saveResult = await state.operations!.saveCurrentBuffer!("test-output.txt").run();
  
  if (Either.isLeft(saveResult)) {
    throw new Error(`Save failed: ${saveResult.left}`);
  }
  
  // Verify file was written
  const content = await filesystem.readFile("test-output.txt");
  assertEquals(content, "test content");
  
  // Verify buffer association updated
  assertTrue(state.buffers.has("test-output.txt"));
  assertFalse(state.buffers.has("*scratch*"));
});

// Test command integration
Deno.test("Command :w filename integration", async () => {
  const terminal = new MockTerminal();
  const filesystem = new FileSystemImpl();
  const editor = new Editor(terminal, filesystem);
  const state = editor.getState();
  
  // Setup
  state.currentBuffer = new TextBufferImpl("integration test");
  state.mode = "command";
  state.commandLine = "w integration-test.txt";
  
  // Execute command
  editor.handleKey("Enter");
  
  // Allow async operation to complete
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Verify results
  assertEquals(state.mode, "normal");
  assertEquals(state.commandLine, "");
  assertTrue(state.statusMessage.includes("Saved"));
  
  // Verify file exists
  const exists = await filesystem.exists("integration-test.txt");
  assertTrue(exists);
});
```

## Migration Strategy

### Phase 1: Extend Existing Interface
1. Add optional TaskEither operations to `EditorOperations`
2. Maintain backward compatibility with existing Promise-based operations
3. Add enhanced command parsing alongside existing logic

### Phase 2: Implement Enhanced Functionality  
1. Add TaskEither-based save operations to Editor class
2. Leverage existing `FunctionalFileSystemImpl` infrastructure
3. Enhance command execution with functional composition

### Phase 3: Integration and Testing
1. Update command parsing to handle filename arguments
2. Add comprehensive test coverage using existing test infrastructure
3. Validate functional programming compliance

### Phase 4: Documentation and Optimization
1. Document new functionality following existing patterns
2. Optimize performance using existing caching and batching strategies
3. Add error recovery patterns consistent with existing code

## Benefits of This Improved Approach

### ✅ **Infrastructure Reuse**
- Leverages existing `FunctionalFileSystemImpl` with full TaskEither support
- Uses established `TaskEitherUtils` for robust file operations
- Integrates with existing error handling and validation patterns

### ✅ **Architectural Consistency**
- Follows established T-Lisp API conventions
- Maintains existing Promise-based interface for backward compatibility
- Uses consistent error types and handling patterns

### ✅ **Functional Programming Excellence**
- Utilizes mature TaskEither implementation with comprehensive utilities
- Leverages existing functional composition patterns
- Follows established lazy evaluation and explicit error handling

### ✅ **Security & Robustness**
- Uses existing security validation patterns
- Leverages established path sanitization logic
- Incorporates existing error recovery mechanisms

### ✅ **Testing & Validation**
- Builds on existing test infrastructure and patterns
- Uses established mock objects and testing utilities
- Follows existing test organization and naming conventions

This improved specification provides a more practical and architecturally sound implementation that leverages tmax's existing sophisticated functional programming infrastructure while maintaining compatibility with current patterns and practices.