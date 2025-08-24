# tmax Troubleshooting Guide

## Keys Not Working / No Input Response

### Problem
When running tmax, keys don't work and no input is registered. The editor starts but doesn't respond to any keystrokes, showing "Unbound key" messages for all key presses.

### Root Causes
This issue can occur due to several reasons:

1. **Not running in a proper TTY (terminal)** - The editor requires direct terminal access to capture keyboard input in raw mode.
2. **Key bindings not loading** - The core-bindings.tlisp file may not be loading properly.
3. **T-Lisp API functions missing** - Some editor functions may not be properly implemented.

### Common Scenarios
1. **Running through pipes or redirects**:
   ```bash
   echo "test" | deno task start  # ❌ Won't work
   deno task start < input.txt   # ❌ Won't work
   ```

2. **Non-interactive environments**:
   - CI/CD systems
   - Automated scripts
   - Docker containers without proper TTY allocation
   - IDEs or code editors executing the command

3. **SSH without proper terminal allocation**:
   ```bash
   ssh user@server "deno task start"  # ❌ Won't work
   ssh -t user@server "deno task start"  # ✅ Works with -t flag
   ```

### Error Messages
- **Before fix**: "Operation not supported on socket"
- **After fix**: "tmax must be run in a terminal"

### Solutions

#### For Regular Use
Run tmax directly in a terminal:
```bash
# ✅ Correct usage
deno task start
deno task start myfile.txt
```

#### For SSH
Use the `-t` flag to allocate a TTY:
```bash
ssh -t user@server "cd /path/to/tmax && deno task start"
```

#### For Docker
Ensure TTY allocation when running containers:
```bash
docker run -it your-container deno task start
```

#### Testing & Debugging

#### Test Key Binding Registration
```bash
deno run --allow-read --allow-write scripts/test-binding.ts
```
Should show `Total key mappings registered: 13`. If less, key binding loading failed.

#### Test Command Functionality
```bash
deno run --allow-read --allow-write scripts/test-commands.ts
```
Tests `:w`, `:wq`, `:q` commands. Should create and save a test file.

#### Test Terminal Functionality
```bash
deno task test-keys
```
This will check if you're in a proper TTY and test raw key input.

#### Test Core Bindings Line by Line
```bash
deno run --allow-read --allow-write scripts/test-core-line-by-line.ts
```
This will execute the core bindings file line by line to identify any problematic statements.

### Technical Details

#### TTY Detection
The terminal module now includes proper TTY detection:
```typescript
private isStdinTTY(): boolean {
  return Deno.stdin.isTerminal && Deno.stdin.isTerminal();
}
```

#### Raw Mode Requirements
tmax requires raw mode for:
- Character-by-character input (not line-buffered)
- Immediate key response
- Special key handling (Escape, arrow keys, etc.)
- Modal editing functionality

#### Architecture Overview
```
User Input → Terminal (TTY) → Raw Mode → tmax Editor → Key Bindings → T-Lisp Commands
```

### Prevention
- Always run tmax in an interactive terminal
- Avoid pipes and redirects when starting the editor
- Use proper TTY allocation in scripted environments
- Test with `deno task test-keys` before reporting issues

### Related Issues
- Cursor positioning problems
- Display rendering issues
- Mode switching not working
- Command execution failures

All of these are typically resolved by ensuring proper TTY environment.

## Insert Mode Text Not Displaying

### Problem
In insert mode, 'i' key works to enter insert mode and Escape works to exit, but when typing characters in insert mode, the text doesn't appear on screen.

### Root Cause
The editor was calling `terminal.clear()` (which sends `\x1b[2J\x1b[H`) on every render cycle, clearing the entire screen before redrawing. This caused:
- Screen flicker as entire display was cleared and redrawn for each keypress
- Potential timing issues where text insertion wasn't visible
- Poor performance due to excessive screen clearing

### Solution Applied
**Phase 1**: Modified rendering to reduce screen clearing frequency.
**Phase 2**: Fixed main loop timing to ensure immediate render after input.

Key changes in `src/editor/editor.ts`:

```typescript
// Main loop reorganized for immediate feedback
async run() {
  // Initial render
  await this.render(true);
  
  while (this.running) {
    // Get key input
    const key = await this.state.terminal.readKey();
    
    try {
      await this.handleKey(key);  // Modify buffer
    } catch (error) { /* error handling */ }
    
    // Render immediately after handling input
    await this.render(false);
  }
}
```

Root cause was **render timing**:
- **Before**: Render → Read Key → Handle Key → (loop back to Render)
- **After**: Render → Read Key → Handle Key → **Immediate Render** → (loop)

This ensures every keypress results in immediate screen update.

### Verification
- Insert mode character insertion works correctly in real terminals
- Screen doesn't flicker during typing
- All existing functionality (modes, commands, navigation) remains intact
- Diagnostic tests confirm buffer insertion and rendering pipeline work correctly

## Command Mode Not Working (:w, :wq, :q)

### Problem
Command mode entry (`:` key) and command execution (`:w`, `:wq`, `:q`) not working. User cannot save files or quit using vim-style commands.

### Root Cause
Core key bindings were only loaded when `editor.start()` (the main loop) was called, but not during normal editor usage or testing. This meant:
- No key mappings were available for `:` to enter command mode
- Command functions existed but were unreachable via keyboard
- Editor could be used programmatically but not interactively

### Solution Applied
Added **lazy loading** of core bindings in `src/editor/editor.ts`:

```typescript
private coreBindingsLoaded: boolean = false;

private async ensureCoreBindingsLoaded(): Promise<void> {
  if (!this.coreBindingsLoaded) {
    await this.loadCoreBindings();
  }
}

async handleKey(key: string): Promise<void> {
  // Ensure core bindings are loaded before processing keys
  await this.ensureCoreBindingsLoaded();
  // ... rest of key handling
}
```

### Verification
- ✅ `:` key correctly enters command mode
- ✅ `:w` saves files successfully
- ✅ `:wq` saves and triggers quit signal  
- ✅ `:q` triggers quit signal correctly
- ✅ All 13 core key bindings loaded automatically
- ✅ Works both in `start()` mode and direct usage