# Chore: Fix k key binding and quit command

## Chore Description

Fix two bugs discovered during UI testing:

1. **`k` key bound to help system instead of cursor-up**: In normal mode, pressing `k` triggers "Describe key: press a key" prompt instead of moving the cursor up. This is because the help system binding `(key-bind "k" "(describe-key-prompt)" "normal")` on line 183 of `normal.tlisp` overrides the correct cursor movement binding on line 25.

2. **Quit commands don't work**: The `q` key, `:q`, and `:wq` commands don't actually quit the editor. The `editor-quit` function returns a string `"EDITOR_QUIT_SIGNAL"` instead of throwing an error that the handlers can catch and propagate to trigger the exit.

## Relevant Files

Use these files to resolve the chore:

- **`src/tlisp/core/bindings/normal.tlisp`** - Contains the normal mode key bindings; the `k` key is incorrectly bound twice (lines 25 and 183), with line 183 overriding line 25
- **`src/editor/api/bindings-ops.ts`** - Contains the `editor-quit` function that returns a string instead of throwing an error (line 53)
- **`src/editor/handlers/normal-handler.ts`** - The normal mode handler that catches `EDITOR_QUIT_SIGNAL` errors and re-throws them; needs to check return values
- **`src/frontend/hooks/useEditorState.ts`** - The React hook that handles the editor-quit signal; may need updates to handle return value checks

### New Files
None required

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fix the k key binding override in normal.tlisp

The help system bindings in `normal.tlisp` should be prefixed with `C-h` (Ctrl+h), not standalone keys. The bindings on lines 183-191 incorrectly use bare `k`, `f`, and `a` keys.

- Open `src/tlisp/core/bindings/normal.tlisp`
- Locate the HELP SYSTEM section (lines 174-192)
- Remove the incorrect standalone key bindings for `k`, `f`, and `a` (lines 183, 187, 191)
- These bindings should only be accessible via the `C-h` prefix, not as direct key presses
- The `C-h` prefix binding on line 179 is correct and should remain

### Step 2: Fix the editor-quit function to throw an error

The `editor-quit` function in `bindings-ops.ts` returns a string `"EDITOR_QUIT_SIGNAL"` but the handlers expect an Error with that message.

- Open `src/editor/api/bindings-ops.ts`
- Locate the `editor-quit` function (line 44)
- Change the return statement from `return Either.right(createString("EDITOR_QUIT_SIGNAL"));` to `throw new Error("EDITOR_QUIT_SIGNAL");`
- This ensures the error is caught by the try-catch blocks in the handlers

### Step 3: Fix the editor-execute-command-line quit handling

The `:wq` command in `editor-execute-command-line` has a similar issue where it returns the quit signal inside a Promise instead of throwing.

- Open `src/editor/api/bindings-ops.ts`
- Locate the `wq` command handling (around line 85-98)
- The current implementation calls `saveFile()` and returns the quit signal in a `.then()` callback
- This needs to be changed to await the save operation synchronously or use a different approach
- Since `saveFile` is async, we need to either:
  a) Make the quit happen after save completes, or
  b) Use a different mechanism to signal quit after async save
- The simplest fix is to set a flag after save completes that the main loop checks

### Step 4: Update the executeCommand method to handle quit signal from string return

For backward compatibility with code that might expect the string return value:

- Open `src/editor/editor.ts`
- Locate the `executeCommand` private method (around line 1672)
- After executing the interpreter command, check if the result is a string with value `"EDITOR_QUIT_SIGNAL"`
- If so, convert it to an Error throw for consistent handling

### Step 5: Verify the wq async issue

The `:wq` command has an async issue where the quit signal is returned in a Promise callback but never propagates.

- Review the `editor-execute-command-line` function in `bindings-ops.ts`
- The `wq` case (line 85-98) needs to be restructured
- Option: Change the return type to support async operations, or
- Option: Use a synchronous save approach for the command mode, or
- Option: Defer the quit until after save completes via state flag
- Recommended approach: Use the `editor-execute-command-line` to set a pending quit flag that gets checked after save

### Step 6: Test the fixes manually

- Start the editor with `bun run src/main.ts` or `npm start`
- Test `k` key in normal mode - should move cursor up
- Test `q` key in normal mode - should quit
- Test `:q` command - should quit
- Test `:wq` command - should save and quit

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

```bash
# Run the unit tests to ensure no regressions
bun test

# Run the UI test for basic editing to verify hjkl navigation works
bash test/ui/tests/02-basic-editing.test.sh

# Manual verification steps:
# 1. Start editor: bun run src/main.ts
# 2. Press 'k' multiple times - cursor should move up
# 3. Press 'q' - editor should exit
# 4. Start editor again, type 'i', type some text, Escape, ':wq', Enter - should save and exit
```

## Notes

- The `k` key binding conflict is a simple ordering issue - later bindings override earlier ones for the same key
- The quit issue is more complex because the T-Lisp API returns Either types but the quit signal needs to propagate as an error
- The async `:wq` case requires special handling because we can't throw from inside a Promise callback
- Consider whether the command mode should wait for async operations to complete before returning to normal mode
