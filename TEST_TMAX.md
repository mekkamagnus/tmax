# Testing tmax Editor

## ✅ Key Bindings Are Fixed!

The core issue with key bindings has been resolved:
- **Before**: Only 1-2 key bindings were registered
- **After**: All 13 key bindings are registered correctly
- **Commands**: `:w`, `:wq`, `:q` all work properly

## 🚨 Critical: Must Run in a Real Terminal

**tmax will NOT work when run through:**
- Claude Code (this environment)
- VS Code terminal panels
- Pipes or redirects (`echo | deno task start`)
- CI/CD systems
- Docker without TTY allocation

**tmax WILL work when run in:**
- **macOS Terminal.app** ✅
- **iTerm2** ✅  
- **SSH with -t flag** ✅
- **tmux/screen sessions** ✅

## Testing Instructions

### 1. Test Key Bindings (works in any environment)
```bash
deno run --allow-read --allow-write scripts/test-binding.ts
```
Should show: `Total key mappings registered: 13`

### 2. Test Commands (works in any environment)  
```bash
deno run --allow-read --allow-write scripts/test-commands.ts
```
Should show: `:w`, `:wq`, `:q` all working

### 3. Test Terminal Detection (works in any environment)
```bash
deno task test-keys
```
Will show: "Error: Not running in a TTY" (if not in terminal)
In a real terminal, it will accept key input and exit with ESC, 'q', or Ctrl+C

### 4. Run tmax (REQUIRES REAL TERMINAL)
**In Terminal.app or iTerm2:**
```bash
cd /Users/mekael/Documents/programming/typescript/tmax
deno task start
```

**Expected behavior:**
- Editor starts with full-screen interface
- `hjkl` keys move cursor
- `i` enters insert mode  
- **Typing in insert mode shows characters on screen immediately**
- `Escape` returns to normal mode
- `:w` saves file
- `:wq` saves and quits
- `:q` quits without saving
- `q` (in normal mode) quits without saving
- `Space` followed by `;` enters M-x mode

## Key Bindings Available

| Key | Mode | Action |
|-----|------|--------|
| `h` | normal | Move left |
| `j` | normal | Move down |
| `k` | normal | Move up |
| `l` | normal | Move right |
| `i` | normal | Enter insert mode |
| `Escape` | insert/command/mx | Return to normal mode |
| `:` | normal | Enter command mode |
| `q` | normal/command | Quit |
| `Enter` | command/mx/insert | Execute/newline |
| `Space ;` | normal | Enter M-x mode |
| `Backspace` | insert | Delete character |

## Troubleshooting

If keys still don't work in a real terminal:
1. Verify you're in the project directory
2. Run diagnostic tests above
3. Check `~/.tmaxrc` configuration file
4. File an issue with diagnostic output

## Architecture Notes

- **Key bindings**: Load from `src/tlisp/core-bindings.tlisp`
- **Commands**: Implemented in `src/editor/tlisp-api.ts`
- **TTY detection**: In `src/core/terminal.ts`
- **Parser fix**: Multi-expression files now work correctly