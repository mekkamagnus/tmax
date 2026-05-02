# Chore: Init File System Refactoring

## Chore Description
Refactor the tmax initialization file system to modernize configuration management and improve developer experience. The refactoring includes:
1. Rename `.tmaxrc` to `init.tlisp` for better clarity
2. Relocate configuration from `~/` to `~/.config/tmax/` (XDG Base Directory compliance)
3. Add `eval-init-file` T-Lisp function to reload configuration without restarting
4. Add `--init-file` CLI flag to override default init file path for testing

**NOTE**: This is an alpha project. No backward compatibility with `.tmaxrc` is maintained.

## Relevant Files

### Files to Modify

- **src/editor/editor.ts** (lines 1524-1571)
  - Contains `loadInitFile()` method that currently loads `~/.tmaxrc`
  - Needs refactoring to support new location, filename, and CLI override
  - Needs to add `evalInitFile()` method for runtime reloading
  - Update `initializeAPI()` to register new T-Lisp functions

- **src/main.tsx** (lines 81-433)
  - Main entry point that parses command-line arguments
  - Need to add `--init-file` flag parsing and pass to Editor constructor
  - Update help text to include new flag

- **examples/tmaxrc.example**
  - Current example configuration file
  - Should be renamed to `init.tlisp.example`
  - Update content with new file paths and `eval-init-file` usage

- **README.md** (lines 118-140)
  - Documentation referencing `.tmaxrc`
  - Configuration section needs complete update
  - Add documentation for new features

- **src/editor/tlisp-api.ts**
  - T-Lisp API initialization
  - May need to register `eval-init-file` and `init-file-path` functions

### New Files to Create

- **test/unit/init-file-loading.test.ts** (~150 lines)
  - Unit tests for new init file loading logic
  - Test XDG config directory resolution
  - Test custom init file via CLI flag
  - Test missing directory creation

- **test/unit/eval-init-file.test.ts** (~100 lines)
  - Tests for `eval-init-file` T-Lisp function
  - Verify configuration reload works correctly
  - Test keymap updates after reload

- **test/integration/cli-flag.test.ts** (~100 lines)
  - Integration tests for `--init-file` CLI flag
  - Test relative and absolute paths
  - Test `/dev/null` to disable init file

## Step by Step Tasks

### Phase 1: Update Config Path & Filename

#### Modify src/editor/editor.ts loadInitFile() method
- Update to use XDG config directory: `~/.config/tmax/`
- Change default filename from `.tmaxrc` to `init.tlisp`
- Add config directory creation if it doesn't exist
- Store init file path in Editor state for later reference

```typescript
private async loadInitFile(initFilePath?: string): Promise<void> {
  const initLog = log.module('editor').fn('loadInitFile');

  // Determine init file path
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  const configDir = `${homeDir}/.config/tmax`;
  const defaultInitFile = `${configDir}/init.tlisp`;

  const initFile = initFilePath || defaultInitFile;

  // Store for later reference
  this.currentInitFile = initFile;

  try {
    initLog.debug(`Loading init file: ${initFile}`);
    const initContent = await this.filesystem.readFile(initFile);
    this.interpreter.execute(initContent);
    initLog.info('Loaded init file', { data: { path: initFile } });
  } catch (error) {
    initLog.debug('No init file found or error loading it', {
      data: { path: initFile, error: error instanceof Error ? error.message : String(error) }
    });
  }
}
```

#### Update Editor constructor
- Add optional `initFilePath?: string` parameter to constructor
- Pass to `loadInitFile()` call in `start()` method
- Store in state for `init-file-path` T-Lisp function

#### Create test/unit/init-file-loading.test.ts
- Test loading from `~/.config/tmax/init.tlisp`
- Test custom init file path
- Test missing directory creation
- Test error handling for non-existent files

### Phase 2: Add eval-init-file Functionality

#### Modify src/editor/editor.ts
- Add `evalInitFile()` method to reload current init file
- Register T-Lisp functions in `initializeAPI()`:
  - `(eval-init-file)` - Reload init file
  - `(init-file-path)` - Return current init file path

```typescript
async evalInitFile(): Promise<void> {
  const initLog = log.module('editor').fn('evalInitFile');
  initLog.info('Reloading init file');

  // Reload using stored init file path
  await this.loadInitFile(this.currentInitFile);

  initLog.info('Init file reloaded');
}

// In initializeAPI():
this.interpreter.defineBuiltin("eval-init-file", async (args: TLispValue[]) => {
  await this.evalInitFile();
  return createNil();
});

this.interpreter.defineBuiltin("init-file-path", (args: TLispValue[]) => {
  return createString(this.currentInitFile || "");
});
```

#### Create test/unit/eval-init-file.test.ts
- Test `eval-init-file` reloads configuration
- Test keymaps are updated after reload
- Test `init-file-path` returns correct path
- Test error handling for malformed init files

### Phase 3: Add CLI Flag Support

#### Modify src/main.tsx
- Parse `--init-file` flag from command-line arguments (lines 88-89)
- Extract init file path if flag is present
- Pass to Editor constructor (line 211)

```typescript
// Parse --init-file flag
const initFileArgIndex = args.indexOf('--init-file');
let initFilePath: string | undefined;
if (initFileArgIndex !== -1 && args[initFileArgIndex + 1]) {
  initFilePath = args[initFileArgIndex + 1];
}

// Pass to Editor
const editor = new EditorClass(terminal, filesystem, initFilePath);
```

- Update help text (lines 134-150) to include new flag:
```
  --init-file FILE  Use custom init file (default: ~/.config/tmax/init.tlisp)
```

#### Create test/integration/cli-flag.test.ts
- Test `--init-file` flag parsing
- Test relative and absolute paths
- Test `/dev/null` disables init file
- Test error handling for non-existent files

### Phase 4: Documentation Updates Documentation Updates

#### Rename examples/tmaxrc.example to examples/init.tlisp.example
- Update all references to new filename
- Update examples with new file path
- Add `eval-init-file` usage examples
- Document migration from `.tmaxrc`

#### Update README.md
- Update Configuration section (lines 118-140)
- Change `.tmaxrc` → `init.tlisp` references
- Update file path: `~/.config/tmax/init.tlisp`
- Add `eval-init-file` documentation
- Add `--init-file` flag documentation

#### Update src/editor/editor.ts JSDoc comments
- Update `loadInitFile()` method documentation
- Add `evalInitFile()` method documentation
- Update references to init file location

### Phase 6: Migration Helper (Optional)

#### Create src/editor/migration.ts
- Add `migrateTmaxrc()` function to copy `.tmaxrc` to new location
- Create backup of original file
- Register `migrate-tmaxrc` T-Lisp function

```typescript
export async function migrateTmaxrc(filesystem: FileSystem): Promise<boolean> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  const oldFile = `${homeDir}/.tmaxrc`;
  const newDir = `${homeDir}/.config/tmax`;
  const newFile = `${newDir}/init.tlisp`;

  try {
    // Check if old file exists
    await filesystem.readFile(oldFile);

    // Create new directory
    await filesystem.createDir(newDir);

    // Copy to new location
    const content = await filesystem.readFile(oldFile);
    await filesystem.writeFile(newFile, content);

    // Backup old file
    await filesystem.writeFile(`${oldFile}.backup`, content);

    return true;
  } catch {
    return false;
  }
}
```

#### Add T-Lisp API function
- Register `(migrate-tmaxrc)` in `initializeAPI()`
- Returns success/failure status

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

### Unit Tests
```bash
# Run all unit tests
bun test test/unit/

# Run specific init file tests
bun test test/unit/init-file-loading.test.ts
bun test test/unit/eval-init-file.test.ts

# Verify existing tests still pass
bun test test/unit/keymap-*.test.ts
bun test test/unit/tokenizer.test.ts
bun test test/unit/parser.test.ts
bun test test/unit/evaluator.test.ts
```

### Integration Tests
```bash
# Run CLI flag integration tests
bun test test/integration/cli-flag.test.ts

# Run existing integration tests
bun test test/integration/keymap-*.test.ts
```

### Manual Testing
```bash
# Test new default location
mkdir -p ~/.config/tmax
echo '(editor-set-status "Config loaded")' > ~/.config/tmax/init.tlisp
bun run src/main.tsx

# Test --init-file flag
bun run src/main.tsx --init-file ./test-config.tlisp

# Test /dev/null (disable init file)
bun run src/main.tsx --init-file /dev/null

# Test eval-init-file function
echo '(editor-set-status "Before reload")' > ~/.config/tmax/init.tlisp
bun run src/main.tsx
# In editor: M-x ; (eval-init-file)
# Verify status updates
```

### UI Tests
```bash
# Run UI test suite to ensure no regressions
bash test/ui/tests/01-startup.test.sh
bash test/ui/tests/02-basic-editing.test.sh
bash test/ui/tests/03-mode-switching.test.sh
```

### Verification Checklist
- [ ] Init file loads from `~/.config/tmax/init.tlisp`
- [ ] `--init-file` flag accepts custom paths
- [ ] `/dev/null` disables init file loading
- [ ] `eval-init-file` function reloads configuration
- [ ] `init-file-path` function returns current path
- [ ] All unit tests pass (including new tests)
- [ ] All integration tests pass
- [ ] Documentation updated (README, examples)
- [ ] No regressions in existing functionality
- [ ] All `.tmaxrc` references removed from codebase

## Notes

### XDG Compliance
- Following XDG Base Directory specification for config files
- Config directory: `~/.config/tmax/`
- This is standard for modern Linux/Unix applications

### Breaking Changes
- **Impact**: Users with existing `.tmaxrc` files need to move to `~/.config/tmax/init.tlisp`
- **Migration**: Users manually move file to new location
- **Note**: This is an alpha project, breaking changes are acceptable

### Error Handling
- Missing init files are silent (expected behavior)
- Malformed init files log errors but don't crash editor
- Invalid custom paths show clear error messages

### Testing Strategy
- Unit tests for all new functionality
- Integration tests for CLI flag parsing
- Manual verification of file operations
- UI tests to ensure no regressions

### Performance Considerations
- Init file loading happens once at startup
- `eval-init-file` reload is synchronous but fast
- No performance impact on normal editor operations

### Future Enhancements
- Consider `--no-init-file` flag as alternative to `/dev/null`
- Support for multiple init files (system, user, local)
- Init file validation and syntax checking
