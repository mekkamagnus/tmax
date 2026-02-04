# tmux send-keys: Complete Guide to Command-Line Control

A comprehensive guide to automating tmux via command line, with deep dive into `send-keys` functionality.

## Table of Contents

1. [Introduction](#introduction)
2. [Basic Syntax](#basic-syntax)
3. [Enter vs C-m: The Critical Difference](#enter-vs-c-m-the-critical-difference)
4. [Literal Text vs Special Keys](#literal-text-vs-special-keys)
5. [Target Specification](#target-specification)
6. [Control Characters](#control-characters)
7. [Common Patterns](#common-patterns)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)
10. [Practical Examples](#practical-examples)

---

## Introduction

`tmux send-keys` is a powerful command that allows you to programmatically send keystrokes to any tmux pane or window, even if it's not currently active or visible. This makes it ideal for:

- **Automated testing** - Send commands to applications running in tmux
- **Workspace automation** - Set up development environments automatically
- **Parallel operations** - Send the same command to multiple panes
- **CI/CD integration** - Control terminal-based applications in pipelines

### Basic Syntax

```bash
tmux send-keys -t TARGET [key ...]
```

**Parameters:**
- `-t target` - Specifies which session, window, or pane to send keys to (optional, defaults to current pane)
- `-l` - Send literally, don't interpret special key names
- `-R` - Reset terminal state before sending
- `-M` - Pass through mouse events

---

## Enter vs C-m: The Critical Difference

### The Problem

When automating tmux, you might notice that `Enter` doesn't always execute commands:

```bash
# This might NOT execute the command
tmux send-keys -t mysession "ls -la" Enter

# This WILL execute the command
tmux send-keys -t mysession "ls -la" C-m
```

### Why This Happens

The difference comes down to how terminals interpret keypresses:

- **`Enter`** - A symbolic key name that tmux interprets. In some contexts (especially non-interactive shells or automation), this symbolic interpretation may not translate to actual execution.
- **`C-m`** - The literal carriage return character (ASCII 13, Control-M). This is the actual signal that tells the terminal "execute this command".

### Technical Details

From the tmux manual:
> Key names may be prefixed with `C-` or `^` for Ctrl keys, and `M-` for Alt (Meta) keys. `C-m` sends a carriage return, which is what the Enter key actually sends.

**In terminal terminology:**
- `Enter` key → Carriage Return (CR, `^M`, ASCII 13) or Line Feed (LF, `^J`, ASCII 10)
- Most terminals use `C-m` (Carriage Return) for Enter
- Some applications expect `C-j` (Line Feed) instead

### Best Practice

**Always use `C-m` instead of `Enter` when scripting:**

```bash
# ✅ Recommended - Works consistently in scripts
tmux send-keys -t mysession "ls -la" C-m

# ⚠️ Avoid - May not work in non-interactive contexts
tmux send-keys -t mysession "ls -la" Enter
```

---

## Literal Text vs Special Keys

### The `-l` Flag

By default, tmux interprets certain strings as special key names. Use `-l` to send text literally:

```bash
# Send "Escape" as the word, not the Escape key
tmux send-keys -l "Escape"

# Send "C-c" as text, not Ctrl+C
tmux send-keys -l "C-c"

# Send "up" as text, not Up arrow
tmux send-keys -l "up"
```

### Special Key Names

Without `-l`, tmux interprets these special key names:

**Editing Keys:**
- `Enter`, `Return` - Enter/Return key (prefer `C-m` for reliability)
- `Escape`, `Esc` - Escape key
- `Space` - Spacebar
- `Tab`, `BTab` - Tab / Back-Tab
- `BSpace`, `Backspace` - Backspace

**Cursor Movement:**
- `Up`, `Down`, `Left`, `Right` - Arrow keys
- `Home`, `End` - Home/End keys
- `PageUp`, `PageDown` - Page navigation

**Editing:**
- `DC` (Delete Character) - Delete key
- `IC` (Insert Character) - Insert key

**Function Keys:**
- `F1` through `F20` - Function keys

### Combining Literal and Special Keys

You **cannot** mix `-l` literal mode with special key names in a single command. Use multiple commands separated by `\\;`:

```bash
# Send literal "-3", then press Enter
tmux send-keys -t session -l '' "-3" \\; send-keys -t session C-m
```

The `''` empty string prevents tmux from interpreting `-3` as an option.

---

## Target Specification

### Target Formats

```bash
# Send to active pane in session (any window)
tmux send-keys -t mysession "command" C-m

# Send to specific window in session (active pane)
tmux send-keys -t mysession:1 "command" C-m

# Send to specific pane
tmux send-keys -t mysession:1.0 "command" C-m

# Send to window in current session
tmux send-keys -t :1 "command" C-m

# Send to pane in current window
tmux send-keys -t .0 "command" C-m
```

### Finding Target IDs

```bash
# List all sessions
tmux list-sessions

# List windows in a session
tmux list-windows -t mysession

# List panes in a window
tmux list-panes -t mysession:1
```

---

## Control Characters

### Ctrl Keys

Prefix with `C-` or `^`:

```bash
# Send Ctrl+C (interrupt)
tmux send-keys "C-c"
tmux send-keys "^c"

# Send Ctrl+D (end of transmission)
tmux send-keys "C-d"

# Send Ctrl+L (clear screen)
tmux send-keys "C-l"

# Send Ctrl+A then Ctrl+E (home to end of line)
tmux send-keys "C-a" "C-e"
```

### Alt/Meta Keys

Prefix with `M-`:

```bash
# Send Alt+F
tmux send-keys "M-f"

# Send Alt+B (backward word in many shells)
tmux send-keys "M-b"
```

### Common Control Sequences

| Sequence | Meaning | Use Case |
|----------|---------|----------|
| `C-c` | Interrupt/Cancel | Stop running command |
| `C-d` | EOF/Exit | Exit shell, close input |
| `C-l` | Clear Screen | Clean terminal display |
| `C-a` | Start of Line | Jump to beginning |
| `C-e` | End of Line | Jump to end |
| `C-w` | Delete Word | Delete word backwards |
| `C-u` | Delete Line | Delete to start of line |

---

## Common Patterns

### Sending Commands with Variables

```bash
PROJECT_DIR="~/projects/myapp"
SESSION="dev"

# Change directory
tmux send-keys -t $SESSION "cd $PROJECT_DIR" C-m

# Run multiple commands
tmux send-keys -t $SESSION "npm install" C-m
tmux send-keys -t $SESSION "npm test" C-m
```

### Handling Special Characters

```bash
# Commands with spaces - quote the entire command
tmux send-keys -t mysession "git commit -m 'fix: bug fix'" C-m

# Use double quotes inside single quotes
tmux send-keys -t mysession 'echo "hello world"' C-m

# Escaping quotes
tmux send-keys -t mysession "echo 'it'\''s working'" C-m
```

### Multiple Commands in Sequence

```bash
# Method 1: Multiple send-keys calls
tmux send-keys -t mysession "mkdir -p ~/projects" C-m
tmux send-keys -t mysession "cd ~/projects" C-m
tmux send-keys -t mysession "git init" C-m

# Method 2: Using command chaining
tmux send-keys -t mysession "mkdir -p ~/projects && cd ~/projects && git init" C-m

# Method 3: Shell script with heredoc
tmux send-keys -t mysession <<'EOF' C-m
cd ~/projects
git init
npm init -y
EOF
```

---

## Best Practices

### 1. Always Use C-m for Execution

```bash
# ✅ Good
tmux send-keys -t session "command" C-m

# ❌ Bad - Unreliable in scripts
tmux send-keys -t session "command" Enter
```

### 2. Quote Commands Properly

```bash
# ✅ Good - Single quotes preserve literal
tmux send-keys -t session 'echo "hello world"' C-m

# ❌ Bad - Word splitting
tmux send-keys -t session echo "hello world" C-m
```

### 3. Add Delays for State Changes

```bash
# Send command, wait for execution, then send next
tmux send-keys -t session "cd /path" C-m
sleep 0.5  # Wait for directory change
tmux send-keys -t session "ls" C-m
```

### 4. Verify Pane Exists Before Sending

```bash
# Check if pane exists first
if tmux display-message -p -t "${session}:0" >/dev/null 2>&1; then
    tmux send-keys -t "${session}:0" "command" C-m
fi
```

### 5. Use Descriptive Session/Window Names

```bash
# ✅ Good - Clear targeting
tmux send-keys -t project:editor.0 "vim ." C-m

# ❌ Bad - Hard to maintain
tmux send-keys -t 0:2.1 "vim ." C-m
```

---

## Troubleshooting

### Commands Not Executing

**Symptom:** Commands appear in pane but don't run

**Solution:** Use `C-m` instead of `Enter`

```bash
# Before (not working)
tmux send-keys -t session "ls" Enter

# After (working)
tmux send-keys -t session "ls" C-m
```

### Special Characters Being Stripped

**Symptom:** Spaces or special characters disappear

**Solution:** Use proper quoting

```bash
# ✅ Correct
tmux send-keys -t session "command with spaces" C-m

# ❌ Wrong - spaces lost
tmux send-keys -t session command with spaces C-m
```

### Literal Words Not Sending

**Symptom:** Words like "up" or "down" send as arrow keys

**Solution:** Use `-l` flag

```bash
# Send "up" as text
tmux send-keys -l "up"

# Send "up" as text, then Enter
tmux send-keys -t session -l '' "up" \\; send-keys -t session C-m
```

### Commands Going to Wrong Pane

**Symptom:** Commands appear in different pane than expected

**Solution:** Verify target specification

```bash
# List all panes to find correct target
tmux list-panes -a -F "#{session_name}:#{window_index}.#{pane_index} #{pane_current_command}"

# Use full target path
tmux send-keys -t sessionname:window.pane "command" C-m
```

---

## Practical Examples

### Automated Workspace Setup

```bash
#!/bin/bash

SESSION="dev-workspace"

# Create session if it doesn't exist
tmux has-session -t $SESSION 2>/dev/null

if [ $? != 0 ]; then
    # Create new session
    tmux new-session -d -s $SESSION -n "editor"

    # Editor window
    tmux send-keys -t $SESSION:editor "cd ~/projects/current" C-m
    tmux send-keys -t $SESSION:editor "vim ." C-m

    # Terminal window
    tmux new-window -t $SESSION -n "terminal"
    tmux send-keys -t $SESSION:terminal "cd ~/projects/current" C-m

    # Server window
    tmux new-window -t $SESSION -n "server"
    tmux send-keys -t $SESSION:server "cd ~/projects/current" C-m
    tmux send-keys -t $SESSION:server "npm run dev" C-m

    # Logs window with split panes
    tmux new-window -t $SESSION -n "logs"
    tmux send-keys -t $SESSION:logs "cd ~/projects/current" C-m
    tmux send-keys -t $SESSION:logs.0 "tail -f logs/app.log" C-m

    tmux split-window -t $SESSION:logs -h -p 50
    tmux send-keys -t $SESSION:logs.1 "htop" C-m
fi

# Attach to session
tmux attach-session -t $SESSION
```

### Running Tests in Multiple Panes

```bash
#!/bin/bash

SESSION="test-runner"
WINDOW="tests"

# Create window with 3 panes
tmux new-window -t $SESSION: -n $WINDOW

# Split into 3 vertical panes
tmux split-window -t $SESSION:$WINDOW -h -p 66
tmux split-window -t $SESSION:$WINDOW -h -p 50

# Run different test suites in each pane
tmux send-keys -t $SESSION:$WINDOW.0 "cd ~/project && npm run test:unit" C-m
tmux send-keys -t $SESSION:$WINDOW.1 "cd ~/project && npm run test:integration" C-m
tmux send-keys -t $SESSION:$WINDOW.2 "cd ~/project && npm run test:e2e" C-m
```

### Synchronized Command Execution

```bash
# Enable pane synchronization
tmux set-window-option synchronize-panes on

# Send command to all panes at once
tmux send-keys -t session:window "uptime" C-m

# Disable synchronization when done
tmux set-window-option synchronize-panes off
```

### Capturing Output After Command

```bash
# Send command
tmux send-keys -t session "ls -la" C-m

# Wait for command to complete
sleep 2

# Capture output
tmux capture-pane -t session -p > output.txt

# Or capture last 100 lines
tmux capture-pane -t session -p -S -100 > output.txt
```

---

## Quick Reference

### Common Key Sequences

| Action | Command |
|--------|---------|
| Execute command | `... C-m` |
| Cancel command | `C-c` |
| Exit shell/EOF | `C-d` |
| Clear screen | `C-l` |
| Delete word | `C-w` |
| Delete line | `C-u` |
| Escape (normal mode) | `Escape` |
| Insert mode | `i` |
| Save and quit | `:wq` C-m |
| Quit without save | `:q!` C-m |

### Target Formats

| Format | Targets |
|--------|---------|
| `session` | Active pane in session |
| `session:window` | Active pane in window |
| `session:window.pane` | Specific pane |
| `:window.pane` | Pane in current session |
| `.pane` | Pane in current window |

### Flags

| Flag | Purpose |
|------|---------|
| `-l` | Send literal text |
| `-R` | Reset terminal state |
| `-M` | Pass through mouse events |
| `-t` | Target specification |

---

## Sources

- [tmuxai.dev - tmux send-keys guide](https://tmuxai.dev/tmux-send-keys/)
- [tmux(1) - Linux manual page](https://man7.org/linux/man-pages/man1/tmux.1.html)
- [StackOverflow: tmux send-keys syntax](https://stackoverflow.com/questions/19313807/tmux-send-keys-syntax)
- [Unix StackExchange: Escape keywords with tmux send](https://unix.stackexchange.com/questions/471997/escape-keywords-with-tmux-send)
- [GitHub: tmux Modifier Keys](https://github.com/tmux/tmux/wiki/Modifier-Keys)
- [Tao of tmux: Scripting chapter](https://tao-of-tmux.readthedocs.io/en/latest/manuscript/10-scripting.html)
- [GitHub Gist: Tmux Send-keys Prefixed Controls](https://gist.github.com/stephancasas/1c82b66be1ea664c2a8f18019a436938)
- [Superuser: Why does tmux send-keys behave differently](https://superuser.com/questions/1904136/why-does-tmux-send-keys-behave-differently-in-a-bash-script)
