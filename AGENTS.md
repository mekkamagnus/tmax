# AGENTS.md

Guide for AI agents (Claude Code, GitHub Copilot, etc.) working on the tmax codebase.

## Quick Reference for AI Agents

### Essential Commands

**Testing:**
```bash
# Unit tests
deno task test

# UI tests (tmux-based)
bash test/ui/tests/01-startup.test.sh
bash test/ui/tests/02-basic-editing.test.sh
bash test/ui/tests/03-mode-switching.test.sh

# Type checking
deno check src/main.ts
```

**Running the Editor:**
```bash
# Terminal-based editor (for UI tests)
deno task start-old [filename]

# React-based editor (development)
deno task start [filename]

# Development mode with verbose logging
deno task start --dev [filename]
```

**REPL:**
```bash
deno task repl
```

### Project Structure

```
tmax/
├── src/
│   ├── core/           # Low-level operations (buffer, filesystem, terminal)
│   ├── tlisp/          # T-Lisp interpreter (tokenizer, parser, evaluator)
│   ├── editor/         # Editor with T-Lisp integration
│   ├── frontend/       # React-based UI (Deno-ink components)
│   ├── main.ts         # Terminal-based editor entry point
│   └── main-ink.ts     # React-based editor entry point
├── test/
│   ├── unit/           # Unit tests for core functionality
│   ├── frontend/       # React component tests
│   └── ui/             # Tmux-based UI integration tests
├── specs/              # Architecture Decision Records and specs
└── prd.json           # Product Requirements (for Ralph Loop)
```

### Two Editor Implementations

**IMPORTANT:** tmax has TWO separate editor implementations:

1. **Terminal-based** (`src/main.ts` → `deno task start-old`)
   - Uses T-Lisp for all functionality
   - Used by UI test suite
   - Has complete save/load functionality
   - Traditional terminal UI

2. **React-based** (`src/main-ink.ts` → `deno task start`)
   - Uses Deno-ink React components
   - Direct buffer manipulation
   - File saving added (see commits)
   - Modern React architecture

**When implementing features:**
- Check which editor you're working with
- UI tests use terminal editor (`start-old`)
- Consider both editors when making changes
- Shared code in `src/core/` and `src/tlisp/`

### Common Tasks

**Adding T-Lisp Functions:**
1. Add function to `src/editor/tlisp-api.ts`
2. Update types if needed
3. Add unit tests in `test/unit/editor.test.ts`
4. Add UI tests in `test/ui/tests/`

**Adding Key Bindings:**
1. Add binding in `src/editor/editor.ts` or `src/tlisp/core-bindings.tlisp`
2. Test with UI test suite
3. Verify in both editors if applicable

**Debugging Terminal Issues:**
1. Use UI test harness: `source test/ui/lib/api.sh`
2. Enable debug mode: `tmax_debug`
3. Capture screenshots: `tmax_screenshot debug.txt`
4. Inspect state: `tmax_state`

**Testing File Operations:**
```bash
# Create test file
echo "test content" > /tmp/test.txt

# Run editor
deno task start-old /tmp/test.txt

# Manual test: Type iX<Escape>:w<Enter>:q<Enter>

# Verify
cat /tmp/test.txt
```

### Architecture Patterns

**Functional Programming:**
- Use `Task` and `TaskEither` for async operations
- Return `Result<T, E>` instead of throwing exceptions
- Immutable data structures
- Function composition over inheritance

See `functional-patterns-guidelines.md` for detailed patterns.

**T-Lisp Integration:**
- Editor state bridge: `TlispEditorState` in `src/editor/tlisp-api.ts`
- Getter/setter pattern for state synchronization
- All editor operations exposed as T-Lisp functions
- Key bindings defined in T-Lisp (`core-bindings.tlisp`)

### Testing Workflow

**TDD Approach:**
1. Write test FIRST (test fails - Red)
2. Implement feature (test passes - Green)
3. Refactor code (keep green)
4. Run ALL tests to ensure no regressions

**UI Test Workflow:**
```bash
# 1. Write UI test
bash -c 'cat > test/ui/tests/my-feature.test.sh << "EOF"
#!/bin/bash
source ../lib/api.sh
test_my_feature() {
  tmax_init
  tmax_start
  # ... test logic ...
  tmax_summary
  tmax_cleanup
}
test_my_feature
EOF'

# 2. Make executable
chmod +x test/ui/tests/my-feature.test.sh

# 3. Run test (should fail)
bash test/ui/tests/my-feature.test.sh

# 4. Implement feature

# 5. Run test again (should pass)
bash test/ui/tests/my-feature.test.sh

# 6. Run all UI tests
for test in test/ui/tests/*.sh; do bash "$test"; done
```

### Code Style Guidelines

**TypeScript:**
- Use arrow functions
- JSDoc comments on all functions
- Explicit types (no `any` without comment)
- Functional patterns over classes
- Immutability over mutation

**T-Lisp:**
- Use `defun` for functions
- Use `let` for local bindings
- Quote forms with `'` or `quote`
- Comments with `;;`
- Indent with 2 spaces

### Key Files to Understand

**Core Architecture:**
- `src/core/types.ts` - Type definitions
- `src/core/buffer.ts` - Gap buffer implementation
- `src/tlisp/interpreter.ts` - T-Lisp interpreter
- `src/editor/tlisp-api.ts` - Editor API bridge

**Editor Implementations:**
- `src/editor/editor.ts` - Terminal-based editor
- `src/frontend/components/Editor.tsx` - React-based editor

**Testing:**
- `test/ui/lib/api.sh` - UI test harness API
- `test/ui/README.md` - UI test documentation
- `test/unit/editor.test.ts` - Editor unit tests

### Common Pitfalls

**1. Command Execution in Terminal Editor:**
- Commands like `:w` must go through key binding system
- Don't call `executeCommand()` directly from handleKey()
- Let Enter key fall through to `(editor-execute-command-line)` binding

**2. Buffer State Synchronization:**
- `TlispEditorState` setter must update both `editor.buffers` and `editor.state.currentBuffer`
- Always use immutable buffer operations
- Verify buffer reference equality after operations

**3. Two Editor Confusion:**
- Check which editor you're testing against
- UI tests use `deno task start-old`
- React editor uses `deno task start`
- Features may need to be implemented twice

**4. Async Operations:**
- File operations are async - use `await`
- T-Lisp is synchronous - save operations use `Promise.then()`
- UI tests need sleep after async operations

**5. Terminal Raw Mode:**
- Terminal must be in raw mode for single-key input
- Always restore terminal state on exit
- Handle SIGINT (Ctrl+C) gracefully

### Debugging Tips

**Enable Verbose Logging:**
```bash
# Terminal editor
deno task start --dev [filename]

# Check for debug output
# Look for: [DEBUG] prefixed messages
```

**Tmux Session Inspection:**
```bash
# List tmux sessions
tmux list-sessions

# Attach to test session
tmux attach -t tmax-ui-tests

# Capture pane output
tmux capture-pane -t tmax-ui-tests:test-editor -p > output.txt
```

**State Dumps:**
```bash
# From UI test harness
source test/ui/lib/api.sh
tmax_init
tmax_start
tmax_state > state-dump.txt
tmax_dump
```

**Breakpoint Debugging:**
```typescript
// Add debug output
console.error(`[DEBUG] Variable: ${variable}`);

// Or use Deno's built-in debugger
deno test --allow-run --inspect-brk test/unit/editor.test.ts
```

### When to Ask for Help

**Clarify These Points:**
1. Which editor implementation (terminal vs React)?
2. Is this a core feature or UI enhancement?
3. Should it work in both editors or just one?
4. Are there existing tests that need updating?
5. What's the acceptance criteria?

**Provide Context:**
- "I'm working on the terminal editor (main.ts)"
- "This feature needs to be T-Lisp extensible"
- "UI test coverage is required"
- "Following functional programming patterns"

### Recent Changes

See these specs for context on recent work:
- `specs/SPEC-022-fix-character-insertion-bug.md` - Command execution bug fix
- `specs/SPEC-021-terminal_ui_final_status.md` - Terminal UI completion
- `specs/SPECS_INDEX.md` - All specs index

### Agent-Specific Tips

**Claude Code:**
- Can use UI test harness directly: `source test/ui/lib/api.sh`
- Prefers functional patterns
- Write tests before implementation (TDD)
- Use `--dev` flag for verbose logging

**GitHub Copilot:**
- Suggests code based on context
- Review suggestions for functional patterns
- Check against T-Lisp patterns in codebase
- Verify with test suite

**Other AI Assistants:**
- Read CLAUDE.md first for project context
- Check test files for usage patterns
- Follow functional programming guidelines
- Run tests before committing changes

### Quick Checklist

Before committing changes:
- [ ] All unit tests pass (`deno task test`)
- [ ] Relevant UI tests pass
- [ ] Type checking passes (`deno check`)
- [ ] JSDoc comments added/updated
- [ ] Functional patterns used (no mutations, no Promises)
- [ ] Both editors tested (if applicable)
- [ ] No console.log left in production code
- [ ] Error handling uses Result/TaskEither
- [ ] Git commit message follows conventions

### Getting Started

1. **Read this file** (AGENTS.md)
2. **Read CLAUDE.md** for project overview
3. **Run tests** to verify environment
4. **Check test/ui/README.md** for UI testing
5. **Review recent commits** for patterns
6. **Start with a small task** to understand workflow

Good luck! The tmax codebase is well-structured and heavily tested. Follow the patterns, write tests first, and ask questions when unsure.
