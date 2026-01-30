# Support Write Command with Filename Parameter

## Status

Accepted

## Context

The tmax editor's command mode (`:`) only supported the basic `:w` command to save files, which required a filename to already be associated with the buffer. This limitation prevented users from:

1. **Saving new buffers** without first opening them with a filename
2. **"Save As" functionality** - writing the current buffer to a different file
3. **Quick file saving** - typing `:w filename.txt` to save without prior setup

When users attempted `:w filename.txt`, they received "Unknown command" errors because the command parser only matched exact `w` or `write` strings without arguments.

## Decision

Implement full support for vim-style write commands with optional filename parameters:

### Syntax Support
- `:w` - Save to current tracked filename (error if none set)
- `:w <filename>` - Save to specified file (e.g., `:w myfile.txt`)
- `:write <filename>` - Same as `:w` with explicit filename
- `:wq <filename>` - Save to file and quit (optional filename support)

### Implementation Approach

Modified three layers of the architecture:

1. **Editor Core** (`src/editor/editor.ts`)
   - Updated `saveFile(filename?: string)` to accept optional filename parameter
   - When filename is provided, it overrides the tracked filename
   - Automatically updates tracked filename when saving to new file

2. **T-Lisp Bindings** (`src/editor/api/bindings-ops.ts`)
   - Updated `editor-execute-command-line` to parse `w <filename>` syntax
   - Extracts filename from command using `split(' ')` and `slice(1).join(' ')`
   - Passes filename to `saveFile()` operation

3. **React/Ink Frontend** (`src/frontend/components/Editor.tsx`)
   - Added command handling for `trimmedCommand.startsWith('w ')` pattern
   - Parses filename from command string
   - Calls `editor.saveFile(filename)` and updates React state

### Code Changes

```typescript
// Before: Only supported bare 'w' command
else if (command === "w" || command === "write") {
  await ops.saveFile();
}

// After: Supports 'w <filename>' syntax
else if (command === "w" || command.startsWith("w ") ||
         command === "write" || command.startsWith("write ")) {
  const parts = command.split(" ");
  const filename = parts.length > 1 ? parts.slice(1).join(" ") : undefined;
  await ops.saveFile(filename);
}
```

## Consequences

### Benefits

1. **Improved User Experience**: Users can now save files using familiar vim-style syntax
2. **No Workflow Constraints**: New buffers can be saved directly without pre-planning filenames
3. **Flexibility**: Easy "Save As" functionality by specifying different filenames
4. **Backward Compatible**: Existing `:w` command still works for buffers with tracked filenames

### Trade-offs

1. **Ambiguous Filenames**: Filenames with spaces are supported but may be confusing (joined with spaces)
2. **No Path Validation**: The implementation doesn't validate file paths before attempting save
3. **No Confirmation**: Overwriting existing files happens without warning (standard vim behavior)

### Future Considerations

1. **Tab Completion**: Add filename tab completion in command mode
2. **Path Validation**: Validate paths and warn about overwrites
3. **Special Characters**: Better handling of quoted filenames with spaces
4. **Relative vs Absolute Paths**: Improve handling of relative path specifications

### Testing

Manual testing confirmed:
- `:w myfile.txt` creates new files
- `:w` without filename shows error for new buffers
- `:w` with tracked filename saves correctly
- Status messages show "Saved <filename>" on success
- Empty buffers create 0-byte files (expected behavior)
