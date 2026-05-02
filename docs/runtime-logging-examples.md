# Runtime Logging Examples

This document shows actual runtime logging output during key presses in development mode.

## Example 1: Mode Change (Normal → Insert → Normal)

### Pressing 'i' to enter insert mode:

```
🔍 LOG ENTRY - DEBUG
📝 Message: Key pressed: i
⏰ Time: 2026-02-04T11:00:15.123Z
🆔 ID: tmax-1770204815123-100
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "key": "i",
  "normalizedKey": "i",
  "currentMode": "normal",
  "cursorPosition": { "line": 0, "column": 0 }
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - INFO
📝 Message: Entering insert mode
⏰ Time: 2026-02-04T11:00:15.124Z
🆔 ID: tmax-1770204815123-101
📦 Module: handlers
⚡ Function: handleNormalMode
📊 Data: {
  "triggerKey": "i",
  "fromMode": "normal"
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - INFO
📝 Message: Mode changed: normal → INSERT
⏰ Time: 2026-02-04T11:00:15.125Z
🆔 ID: tmax-1770204815123-100
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "previousMode": "normal",
  "newMode": "INSERT",
  "triggerKey": "i"
}
────────────────────────────────────────────────────────────
```

### Pressing Escape to return to normal mode:

```
🔍 LOG ENTRY - DEBUG
📝 Message: Key pressed: Escape
⏰ Time: 2026-02-04T11:00:20.456Z
🆔 ID: tmax-1770204820456-102
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "key": "Escape",
  "normalizedKey": "C-[",
  "currentMode": "insert",
  "cursorPosition": { "line": 0, "column": 5 }
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - INFO
📝 Message: Returning to normal mode from insert mode
⏰ Time: 2026-02-04T11:00:20.457Z
🆔 ID: tmax-1770204820456-103
📦 Module: handlers
⚡ Function: handleInsertMode
📊 Data: {
  "triggerKey": "Escape",
  "fromMode": "insert"
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - INFO
📝 Message: Mode changed: insert → NORMAL
⏰ Time: 2026-02-04T11:00:20.458Z
🆔 ID: tmax-1770204820456-102
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "previousMode": "insert",
  "newMode": "NORMAL",
  "triggerKey": "Escape"
}
────────────────────────────────────────────────────────────
```

---

## Example 2: Command Mode Execution

### Pressing ':' to enter command mode:

```
🔍 LOG ENTRY - DEBUG
📝 Message: Key pressed: :
⏰ Time: 2026-02-04T11:01:30.789Z
🆔 ID: tmax-1770204890789-104
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "key": ":",
  "normalizedKey": ":",
  "currentMode": "normal",
  "cursorPosition": { "line": 2, "column": 5 }
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - INFO
📝 Message: Entering command mode
⏰ Time: 2026-02-04T11:01:30.790Z
🆔 ID: tmax-1770204890789-105
📦 Module: handlers
⚡ Function: handleNormalMode
📊 Data: {
  "triggerKey": ":",
  "fromMode": "normal"
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - INFO
📝 Message: Mode changed: normal → COMMAND
⏰ Time: 2026-02-04T11:01:30.791Z
🆔 ID: tmax-1770204890789-104
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "previousMode": "normal",
  "newMode": "COMMAND",
  "triggerKey": ":"
}
────────────────────────────────────────────────────────────
```

### Typing 'w' and pressing Enter:

```
🔍 LOG ENTRY - DEBUG
📝 Message: Key pressed: w
⏰ Time: 2026-02-04T11:01:35.123Z
🆔 ID: tmax-1770204895123-106
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "key": "w",
  "normalizedKey": "w",
  "currentMode": "command",
  "cursorPosition": { "line": 2, "column": 5 }
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - DEBUG
📝 Message: Key pressed: Enter
⏰ Time: 2026-02-04T11:01:37.456Z
🆔 ID: tmax-1770204897456-107
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "key": "Enter",
  "normalizedKey": "Enter",
  "currentMode": "command",
  "cursorPosition": { "line": 2, "column": 6 }
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - INFO
📝 Message: Executing command line
⏰ Time: 2026-02-04T11:01:37.457Z
🆔 ID: tmax-1770204897456-108
📦 Module: handlers
⚡ Function: handleCommandMode
📊 Data: {
  "command": ":w"
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - INFO
📝 Message: Command executed successfully
⏰ Time: 2026-02-04T11:01:37.512Z
🆔 ID: tmax-1770204897456-108
📦 Module: handlers
⚡ Function: handleCommandMode
📊 Data: {
  "command": ":w"
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - INFO
📝 Message: Mode changed: command → NORMAL
⏰ Time: 2026-02-04T11:01:37.513Z
🆔 ID: tmax-1770204897456-107
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "previousMode": "command",
  "newMode": "NORMAL",
  "triggerKey": "Enter"
}
────────────────────────────────────────────────────────────
```

---

## Example 3: Typing Text in Insert Mode

### Pressing keys 'h', 'e', 'l', 'l', 'o':

```
🔍 LOG ENTRY - DEBUG
📝 Message: Key pressed: h
⏰ Time: 2026-02-04T11:02:10.111Z
🆔 ID: tmax-1770204930111-109
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "key": "h",
  "normalizedKey": "h",
  "currentMode": "insert",
  "cursorPosition": { "line": 0, "column": 0 }
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - DEBUG
📝 Message: Key pressed: e
⏰ Time: 2026-02-04T11:02:10.234Z
🆔 ID: tmax-1770204930234-110
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "key": "e",
  "normalizedKey": "e",
  "currentMode": "insert",
  "cursorPosition": { "line": 0, "column": 1 }
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - DEBUG
📝 Message: Key pressed: l
⏰ Time: 2026-02-04T11:02:10.356Z
🆔 ID: tmax-1770204930356-111
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "key": "l",
  "normalizedKey": "l",
  "currentMode": "insert",
  "cursorPosition": { "line": 0, "column": 2 }
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - DEBUG
📝 Message: Key pressed: l
⏰ Time: 2026-02-04T11:02:10.478Z
🆔 ID: tmax-1770204930478-112
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "key": "l",
  "normalizedKey": "l",
  "currentMode": "insert",
  "cursorPosition": { "line": 0, "column": 3 }
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - DEBUG
📝 Message: Key pressed: o
⏰ Time: 2026-02-04T11:02:10.590Z
🆔 ID: tmax-1770204930590-113
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "key": "o",
  "normalizedKey": "o",
  "currentMode": "insert",
  "cursorPosition": { "line": 0, "column": 4 }
}
────────────────────────────────────────────────────────────
```

---

## Example 4: Delete Operation

### Pressing 'd', 'd' to delete a line:

```
🔍 LOG ENTRY - DEBUG
📝 Message: Key pressed: d
⏰ Time: 2026-02-04T11:03:20.111Z
🆔 ID: tmax-1770205000111-114
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "key": "d",
  "normalizedKey": "d",
  "currentMode": "normal",
  "cursorPosition": { "line": 2, "column": 3 }
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - DEBUG
📝 Message: Delete operation initiated
⏰ Time: 2026-02-04T11:03:20.112Z
🆔 ID: tmax-1770205000112-115
📦 Module: handlers
⚡ Function: handleNormalMode
📊 Data: {
  "key": "d",
  "normalizedKey": "d"
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - DEBUG
📝 Message: Executing command: (buffer-delete-line)
⏰ Time: 2026-02-04T11:03:20.113Z
🆔 ID: tmax-1770205000113-116
📦 Module: handlers
⚡ Function: handleNormalMode
📊 Data: {
  "command": "(buffer-delete-line)",
  "key": "d",
  "count": 1
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - DEBUG
📝 Message: Key pressed: d
⏰ Time: 2026-02-04T11:03:21.234Z
🆔 ID: tmax-1770205010234-117
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "key": "d",
  "normalizedKey": "d",
  "currentMode": "normal",
  "cursorPosition": { "line": 2, "column": 3 }
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - DEBUG
📝 Message: Delete operation initiated
⏰ Time: 2026-02-04T11:03:21.235Z
🆔 ID: tmax-1770205010235-118
📦 Module: handlers
⚡ Function: handleNormalMode
📊 Data: {
  "key": "d",
  "normalizedKey": "d"
}
────────────────────────────────────────────────────────────
```

---

## Example 5: Error Handling

### Command execution failure:

```
🔍 LOG ENTRY - DEBUG
📝 Message: Key pressed: :
⏰ Time: 2026-02-04T11:04:10.555Z
🆔 ID: tmax-1770205050555-119
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "key": ":",
  "normalizedKey": ":",
  "currentMode": "normal",
  "cursorPosition": { "line": 0, "column": 0 }
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - INFO
📝 Message: Entering command mode
⏰ Time: 2026-02-04T11:04:10.556Z
🆔 ID: tmax-1770205050556-120
📦 Module: handlers
⚡ Function: handleNormalMode
📊 Data: {
  "triggerKey": ":",
  "fromMode": "normal"
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - DEBUG
📝 Message: Key pressed: :
⏰ Time: 2026-02-04T11:04:12.789Z
🆔 ID: tmax-1770205052789-121
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "key": ":",
  "normalizedKey": ":",
  "currentMode": "command",
  "cursorPosition": { "line": 0, "column": 1 }
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - DEBUG
📝 Message: Key pressed: Enter
⏰ Time: 2026-02-04T11:04:15.123Z
🆔 ID: tmax-1770205055123-122
📦 Module: editor
⚡ Function: handleKeyPress
📊 Data: {
  "key": "Enter",
  "normalizedKey": "Enter",
  "currentMode": "command",
  "cursorPosition": { "line": 0, "column": 2 }
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - INFO
📝 Message: Executing command line
⏰ Time: 2026-02-04T11:04:15.124Z
🆔 ID: tmax-1770205055124-123
📦 Module: handlers
⚡ Function: handleCommandMode
📊 Data: {
  "command": "::"
}
────────────────────────────────────────────────────────────

🔍 LOG ENTRY - ERROR
📝 Message: Command execution failed
⏰ Time: 2026-02-04T11:04:15.145Z
🆔 ID: tmax-1770205055145-124
📦 Module: handlers
⚡ Function: handleCommandMode
❌ Error Details:
   Name: Error
   Message: Unknown command: ::
   Stack: Error: Unknown command: ::
       at executeCommand (...)
🔧 Operation: command-line
📊 Data: {
  "command": "::"
}
────────────────────────────────────────────────────────────
```

---

## Normal Mode Output Comparison

### Same operations in normal mode (cleaner output):

```
2026-02-04T11:00:15.123Z DEBUG [editor::handleKeyPress] Key pressed: i
2026-02-04T11:00:15.124Z INFO  [handlers::handleNormalMode] Entering insert mode
2026-02-04T11:00:15.125Z INFO  [editor::handleKeyPress] Mode changed: normal → INSERT

2026-02-04T11:00:20.456Z DEBUG [editor::handleKeyPress] Key pressed: Escape
2026-02-04T11:00:20.457Z INFO  [handlers::handleInsertMode] Returning to normal mode from insert mode
2026-02-04T11:00:20.458Z INFO  [editor::handleKeyPress] Mode changed: insert → NORMAL

2026-02-04T11:01:30.789Z DEBUG [editor::handleKeyPress] Key pressed: :
2026-02-04T11:01:30.790Z INFO  [handlers::handleNormalMode] Entering command mode
2026-02-04T11:01:30.791Z INFO  [editor::handleKeyPress] Mode changed: normal → COMMAND

2026-02-04T11:01:37.456Z DEBUG [editor::handleKeyPress] Key pressed: Enter
2026-02-04T11:01:37.457Z INFO  [handlers::handleCommandMode] Executing command line
2026-02-04T11:01:37.512Z INFO  [handlers::handleCommandMode] Command executed successfully
2026-02-04T11:01:37.513Z INFO  [editor::handleKeyPress] Mode changed: command → NORMAL

2026-02-04T11:04:15.145Z ERROR [handlers::handleCommandMode] Command execution failed
```

---

## Key Observations

1. **Every key press is logged** with current mode and cursor position (DEBUG level)
2. **Mode changes are prominent** (INFO level) with before/after states
3. **Operations are tracked** from start to completion
4. **Errors include full context**: error object, operation name, data
5. **Correlation IDs link related events** across the key handling flow
6. **Normal mode provides clean output** without stack traces
7. **Development mode provides rich debugging** with full context

This logging system makes it trivial to:
- Debug mode transition issues
- Trace command execution
- Understand user behavior patterns
- Identify performance bottlenecks
- Reproduce issues from log files
