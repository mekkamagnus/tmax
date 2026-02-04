# Init File System Refactoring

## Status

**accepted** (implemented 2026-02-04)

## Context

The tmax editor used a simple initialization file system with several limitations:

1. **Non-standard location**: Configuration file (`~/.tmaxrc`) in home directory violated XDG Base Directory specification
2. **No config reload**: Required full editor restart to test configuration changes
3. **No eval-buffer**: Couldn't test T-Lisp code without saving to files
4. **Inflexible init path**: Couldn't specify custom init file location for testing
5. **Unclear naming**: `.tmaxrc` filename didn't indicate file format (T-Lisp)

These limitations slowed down development workflow and made tmax non-compliant with modern Unix/Linux standards.

## Decision

Refactor the init file system to provide:
- XDG-compliant configuration directory (`~/.config/tmax/`)
- Clearer filename (`init.tlisp` instead of `.tmaxrc`)
- Runtime configuration reloading via `eval-init-file`
- Buffer evaluation for testing T-Lisp code via `eval-buffer`
- Custom init file path via `--init-file` CLI flag

### Implementation

#### Core Components

**1. Config Path Resolution** (`src/editor/editor.ts`)
- Default location: `~/.config/tmax/init.tlisp`
- XDG Base Directory compliance
- Automatic directory creation
- Custom path support via constructor parameter

```typescript
private currentInitFile: string = '';  // Track active init file

constructor(terminal: TerminalIO, filesystem: FileSystem, initFilePath?: string) {
  // Store custom init file path if provided
  if (initFilePath) {
    this.currentInitFile = initFilePath;
  }
}

private async loadInitFile(initFilePath?: string): Promise<void> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  const configDir = `${homeDir}/.config/tmax`;
  const defaultInitFile = `${configDir}/init.tlisp`;
  
  const initFile = initFilePath || defaultInitFile;
  
  // Create config directory if needed
  await this.filesystem.createDir(configDir);
  
  // Load and execute init file
  const initContent = await this.filesystem.readFile(initFile);
  this.interpreter.execute(initContent);
}
```

**2. eval-init-file Function** (`src/editor/editor.ts`)
- Reload init file from disk without restarting
- Preserves editor state
- Useful for testing configuration changes

```typescript
async evalInitFile(): Promise<void> {
  const initLog = log.module('editor').fn('evalInitFile');
  initLog.info('Reloading init file');
  
  // Reload using stored init file path
  await this.loadInitFile(this.currentInitFile || undefined);
  
  initLog.info('Init file reloaded successfully');
}

// T-Lisp API registration
this.interpreter.defineBuiltin("eval-init-file", async (args) => {
  await this.evalInitFile();
  return createNil();
});
```

**3. eval-buffer Function** (`src/editor/editor.ts`)
- Evaluate current buffer contents as T-Lisp code
- Returns result of last expression
- Perfect for testing code in `*scratch*` buffer

```typescript
evalBuffer(): TLispValue {
  const evalLog = log.module('editor').fn('evalBuffer');
  
  if (!this.state.currentBuffer) {
    evalLog.warn('No buffer to evaluate');
    return createNil();
  }
  
  const bufferContent = this.state.currentBuffer.getContent();
  
  try {
    const result = this.interpreter.execute(bufferContent);
    evalLog.info('Buffer evaluated successfully');
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    evalLog.error('Error evaluating buffer', { data: { error: errorMsg } });
    throw error;
  }
}

// T-Lisp API registration
this.interpreter.defineBuiltin("eval-buffer", (args) => {
  return this.evalBuffer();
});
```

**4. CLI Flag Support** (`src/main.tsx`)
- Parse `--init-file` flag from command line
- Pass to Editor constructor
- Support absolute and relative paths

```typescript
// Parse --init-file flag (SPEC-025)
const initFileArgIndex = args.indexOf('--init-file');
let initFilePath: string | undefined;
if (initFileArgIndex !== -1 && args[initFileArgIndex + 1]) {
  initFilePath = args[initFileArgIndex + 1];
}

// Pass to Editor
const editor = new EditorClass(terminal, filesystem, initFilePath);
```

**5. init-file-path Function** (`src/editor/editor.ts`)
- Query current init file path
- Useful for debugging and documentation

```typescript
this.interpreter.defineBuiltin("init-file-path", (args) => {
  return createString(this.currentInitFile || "");
});
```

**6. File System API** (`src/core/types.ts`, `src/core/filesystem.ts`)
- Added `createDir(path)` method to FileSystem interface
- Recursive directory creation
- Error handling for permission issues

```typescript
// Interface
createDir(path: string): Promise<void>;

// Implementation
async createDir(path: string): Promise<void> {
  const result = await this.functionalFileSystem.createDir(path).run();
  if (Either.isLeft(result)) {
    throw new Error(result.left);
  }
}

// Functional implementation
createDir(path: string): TaskEither<FileSystemError, void> {
  return TaskEither.tryCatch(
    async () => {
      const fs = await import('fs/promises');
      await fs.mkdir(path, { recursive: true });
    },
    (error) => createFileSystemError(...)
  );
}
```

#### Architecture

```
Editor starts with --init-file path
           ↓
Editor stores path in currentInitFile
           ↓
loadInitFile() creates ~/.config/tmax/ (if needed)
           ↓
loadInitFile() reads init.tlisp or custom path
           ↓
T-Lisp interpreter executes init file
           ↓
Keymaps, functions, and configuration loaded
           ↓
User can reload: M-x ; (eval-init-file)
           ↓
User can test: M-x ; (eval-buffer)
```

#### File Structure

**Before:**
```
~/.tmaxrc                          # Single file in home directory
```

**After:**
```
~/.config/tmax/
├── init.tlisp                      # Main configuration file (NEW)
└── init.tlisp.default             # Optional reference config
```

#### Migration Path

**For users with existing `.tmaxrc`:**
```bash
# Manual migration
mkdir -p ~/.config/tmax
mv ~/.tmaxrc ~/.config/tmax/init.tlisp

# Or use M-x to migrate (in future)
M-x ; (migrate-tmaxrc)  # NOT IMPLEMENTED - manual migration only
```

## Consequences

### Benefits

1. **XDG Compliance**: Follows XDG Base Directory specification for config files
2. **Better DX**: Test config changes with `eval-init-file` without restart
3. **Rapid Prototyping**: Use `eval-buffer` to test T-Lisp code immediately
4. **Testing**: Use `--init-file` flag to test multiple configurations
5. **Clear Naming**: `init.tlisp` filename clearly indicates T-Lisp format
6. **Flexibility**: Support per-project configurations via custom paths

### Trade-offs

1. **Breaking Change**: Existing `.tmaxrc` files require manual migration
2. **Directory Creation**: Requires filesystem write access (silent failure)
3. **Alpha Project**: No backward compatibility with `.tmaxrc` (acceptable for alpha)
4. **Multiple Locations**: Users may be confused about where config lives

### Compatibility

- **No Legacy Support**: `.tmaxrc` is not automatically migrated
- **User Action Required**: Manual migration or create new init file
- **Alpha Status**: Breaking changes acceptable for alpha phase

## Testing

### Unit Tests (23 tests)

**test/unit/eval-buffer.test.ts** (9 tests)
- eval-buffer function registration
- Buffer evaluation functionality
- Return value handling
- Empty buffer handling
- Malformed T-Lisp error handling
- Runtime error handling
- Function definition evaluation
- Key binding evaluation
- Scratch buffer integration

**test/unit/eval-init-file.test.ts** (6 tests)
- eval-init-file function registration
- init-file-path function
- Configuration reloading
- Keymap updates after reload
- Malformed init file error handling
- Error logging

**test/unit/init-file-loading.test.ts** (8 tests)
- XDG config directory path resolution
- Custom init file path support
- Config directory creation
- XDG Base Directory compliance
- init.tlisp filename usage
- Missing init file handling
- Malformed init file handling
- Error logging

### Integration Tests (18 tests)

**test/integration/cli-flag.test.ts** (7 tests)
- --init-file flag parsing
- Absolute path handling
- Relative path handling
- /dev/null support (disable init)
- Missing flag value handling
- Non-existent file error handling
- Invalid path error handling

**test/integration/init-file-cli.test.ts** (11 tests)
- Custom init file loading with absolute path
- Relative path support
- /dev/null to disable init file
- Graceful handling of non-existent files
- Valid T-Lisp execution from custom init
- Malformed T-Lisp error handling
- Multiple keybindings in custom init
- CLI argument parsing
- Flag positioning (start/end of args)
- Multiple flag combinations
- Filename extraction from args

### Manual Testing

**test/manual/init-file-flag-test.sh**
- Creates temporary custom init file
- Verifies file content and structure
- Provides manual testing commands
- Tests absolute paths, relative paths, and /dev/null
- Validates status messages and key bindings

### Test Coverage Summary

| Feature | Unit Tests | Integration Tests | Manual Tests | Total |
|---------|-----------|-------------------|--------------|-------|
| eval-buffer | 9 | - | - | 9 |
| eval-init-file | 6 | - | - | 6 |
| init-file loading | 8 | - | - | 8 |
| CLI flag parsing | - | 7 | - | 7 |
| CLI flag integration | - | 11 | 1 | 12 |
| **Total** | **23** | **18** | **1** | **42** |

**All 42 tests passing (100% success rate)**

### Regression Testing

Core T-Lisp and Editor tests still pass:
- tokenizer.test.ts - 13/13 pass ✅
- parser.test.ts - 18/18 pass ✅
- evaluator.test.ts - 20/20 pass ✅
- editor.test.ts - 14/14 pass ✅

**Total Core Tests: 65/65 passing (100%)**

## Example Usage

### Basic Configuration

**Create `~/.config/tmax/init.tlisp`:**
```lisp
;; ~/.config/tmax/init.tlisp
;; tmax configuration file

;; Custom key bindings
(key-bind "w" "(cursor-move (+ (cursor-line) 5) (cursor-column))" "normal")
(key-bind "b" "(cursor-move (- (cursor-line) 5) (cursor-column))" "normal")

;; Custom functions
(defun quick-save ()
  "Save current buffer"
  (let ((buffer-name (buffer-current)))
    (if buffer-name
      (progn
        (file-write buffer-name (buffer-text))
        (editor-set-status (string-append "Saved " buffer-name)))
      (editor-set-status "No buffer to save")))))

(key-bind "s" "(quick-save)" "normal")

;; Welcome message
(editor-set-status "tmax configuration loaded successfully")
```

### Reload Configuration Without Restart

```
1. Edit ~/.config/tmax/init.tlisp in another terminal
2. In tmax: M-x ; (eval-init-file)
3. Changes take effect immediately!
```

### Test T-Lisp Code in Buffer

```
1. Open *scratch* buffer or create new buffer
2. Write T-Lisp code:
   (defun test-function ()
     "A test function"
     (editor-set-status "TEST_FUNCTION_CALLED"))
3. Press: M-x ; (eval-buffer)
4. Function is now defined and available!
```

### Custom Init File for Testing

**Test configuration:**
```bash
# Create test configuration
cat > /tmp/test-config.tlisp << 'EOF'
(editor-set-status "TEST_CONFIG_LOADED")
(key-bind "C-t" "(editor-set-status \"CTRL_T_WORKS\")" "normal")
