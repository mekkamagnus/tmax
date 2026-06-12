# Software Requirements Specification (SRS)

**Product:** tmax — T-Lisp Powered Terminal Editor  
**Version:** 0.2.0  
**Date:** 2026-06-10  

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Overall Description](#2-overall-description)
3. [Functional Requirements — User Stories](#3-functional-requirements)
   - [Phase 0: Infrastructure](#30-phase-0-infrastructure)
   - [Phase 1: Core Editing](#31-phase-1-core-editing)
   - [Phase 2: Extensibility](#32-phase-2-extensibility)
   - [Phase 3: Advanced Features](#33-phase-3-advanced-features)
   - [Phase 4: Community](#34-phase-4-community)
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [Constraints](#5-constraints)

---

## 1. Introduction

tmax is a terminal-based text editor with an Emacs-style split-brain architecture: TypeScript handles low-level operations (terminal I/O, file system, buffer management) while T-Lisp (tmax Lisp) handles all editor logic including commands, modes, key bindings, and extensibility.

**Interchangeable Frontends:** Two rendering backends:
- **Steep** (default) — Elm Architecture with direct ANSI output, zero dependencies
- **Ink** (`--ink` flag) — React/Ink reconciler

**Target Users:** Developers, system administrators, and power users who prefer keyboard-driven terminal workflows with unlimited customization.

---

## 2. Overall Description

### System Architecture

```
User Input → Frontend (Steep or Ink)
  → Editor.handleKey(key) → EditorState
  → T-Lisp interpreter → editor API (25+ ops modules)
  → Frontend renders new state
```

### Editor Modes

Five modes: **normal**, **insert**, **visual**, **command**, **M-x**

### Key Components

| Component | Location | Responsibility |
|-----------|----------|---------------|
| T-Lisp Interpreter | `src/tlisp/` | Parse, evaluate, macro-expand |
| Editor Core | `src/editor/` | State machine, key dispatch, API registry |
| Editor API | `src/editor/api/` | 25+ operation modules (buffer, cursor, delete, yank, etc.) |
| Core | `src/core/` | Terminal I/O, filesystem, buffer (gap buffer) |
| Frontend | `src/frontend/` | Steep (direct ANSI) and Ink (React) renderers |
| Shared Render | `src/frontend/render/` | Pure render functions used by both frontends |

---

## 3. Functional Requirements

### Status Key
- ✅ Implemented
- 🚧 Partially implemented
- 📋 Planned

---

### 3.0 Phase 0: Infrastructure

#### US-0.4.1: T-Lisp Keymap Data Structures
**As a** power user  
**I want** key bindings stored as T-Lisp data structures  
**So that** I can inspect, modify, and understand the entire key binding system  

**Status:** ✅ Implemented (`src/editor/api/bindings-ops.ts`, `src/editor/api/keymap-ops.ts`, `src/editor/keymap-sync.ts`)

**Acceptance Criteria:**
- ✅ Given the T-Lisp environment is initialized, when I query `*normal-mode-keymap*`, then I should see a hash-map of key bindings
- ✅ Given a keymap hash-map exists, when I call `(get-binding "i" "normal")`, then I should receive the bound command as a T-Lisp function
- ✅ Given the keybinding system, when I inspect keymap inheritance, then I should see context → mode → global precedence

#### US-0.4.2: Core Bindings in T-Lisp Files
**As a** developer  
**I want** default key bindings defined in T-Lisp files  
**So that** I can understand and modify default behavior  

**Status:** 🚧 Partially implemented (bindings load from T-Lisp, some fallback to TypeScript)

**Acceptance Criteria:**
- ✅ Given a fresh tmax installation, when tmax starts, then it should load core T-Lisp bindings
- ✅ Given the core bindings file, when I read its contents, then I should see all default bindings in T-Lisp syntax
- 🚧 Given a modified core-bindings file, when I restart tmax, then my modifications should be active

#### US-0.4.3: Pure T-Lisp Key Bind Function
**As a** power user  
**I want** the `(key-bind)` function implemented in pure T-Lisp  
**So that** I can customize it or extend it  

**Status:** ✅ Implemented (`src/editor/api/bindings-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I evaluate `(key-bind "zz" "(center-cursor)" "normal")`, then pressing `zz` should execute my custom function
- ✅ Given a custom key binding, when I call `(remove-binding "zz" "normal")`, then the binding should be removed
- ✅ Given multiple key bindings, when I call `(list-bindings "normal")`, then I should see all active bindings for that mode

#### US-0.5.1: Core Testing Framework MVP
**As a** developer  
**I want** a basic T-Lisp testing framework  
**So that** I can write and run tests in T-Lisp itself  

**Status:** ✅ Implemented (`src/tlisp/test-registry.ts`, `src/tlisp/test-coverage.ts`)

**Acceptance Criteria:**
- ✅ Given the TRT framework is loaded, when I define a test with `(deftest test-name ...)`, then it should be registered and executable
- ✅ Given a TRT test, when I use `(should-equal expected actual)`, then it should pass if values are equal, fail otherwise
- ✅ Given the test runner CLI, when I run tests, then all test files should be discovered and executed
- ✅ Given test execution completes, when tests pass, then exit code should be 0
- ✅ Given test execution completes, when tests fail, then exit code should be 1
- ✅ Given test execution, when tests complete, then I should see summary: "Passed: X, Failed: Y, Total: Z"

#### US-0.5.2: Essential Assertions
**As a** developer  
**I want** basic assertion helpers  
**So that** I can validate test behavior  

**Status:** ✅ Implemented

**Acceptance Criteria:**
- ✅ Given a test with values, when I use `(should-equal expected actual)`, then it should pass if values are equal, fail with clear message otherwise
- ✅ Given a test with truthy value, when I use `(should-be-truthy value)`, then it should pass if value is truthy
- ✅ Given a test with falsy value, when I use `(should-be-falsy value)`, then it should pass if value is nil/false
- ✅ Given a test with error-throwing code, when I use `(should-throw ...)`, then it should pass if error is thrown

#### US-0.5.3: Basic Test Isolation
**As a** developer  
**I want** tests isolated from each other  
**So that** tests don't interfere  

**Status:** ✅ Implemented (`clearTestRegistry()`)

**Acceptance Criteria:**
- ✅ Given two tests that modify global state, when tests run sequentially, then second test should not see state from first test
- ✅ Given a test with setup hook, when I define before-test, then setup code should run before test executes
- ✅ Given a test with teardown hook, when I define after-test, then cleanup code should run after test completes

#### US-0.6.6: Basic Coverage
**As a** developer  
**I want** code coverage reporting  
**So that** I can measure test completeness  

**Status:** ✅ Implemented (`src/tlisp/test-coverage.ts`)

**Acceptance Criteria:**
- ✅ Given running tests with coverage, when I execute tests, then I should see line coverage percentage for each function
- ✅ Given coverage report, when tests complete, then I should see summary with total coverage percentage
- ✅ Given coverage thresholds, when coverage is below threshold, then build should report warning

#### US-0.9.1: Strong T-Lisp Diagnostics and Debugging
**As a** T-Lisp author
**I want** source-aware errors, structured diagnostics, and lightweight debugging tools
**So that** I can fix editor logic, modules, plugins, init files, and REPL experiments without guessing where a failure came from

**Status:** 📋 Planned ([SPEC-009: Strong T-Lisp Diagnostics and Debugging](../specs/SPEC-009-tlisp-diagnostics-debugging.md), LD-1)

**Architecture Priority:** TypeScript may provide only primitive facts and transport for diagnostics: source spans, parser/runtime metadata capture, host primitive error wrapping, JSON serialization, daemon/client transport, frame state, and rendering primitives. T-Lisp owns diagnostic policy and user-facing behavior: error classification, help text, suggestions, stack/backtrace commands, trace/untrace, diagnostic-list behavior, jump commands, package reload workflows, and editor command integration.

**Acceptance Criteria:**
- 📋 Given T-Lisp source has a tokenizer or parser error, when it is evaluated from a file, REPL, CLI eval, init file, or editor buffer, then the diagnostic should include source name, line, column, source excerpt, and caret label
- 📋 Given T-Lisp evaluation fails, when the error reaches the user, then it should include a stable error code, severity, concise message, primary span when available, help text or suggestion when useful, and a T-Lisp stack trace
- 📋 Given a module load or module access fails, when the diagnostic is rendered, then it should include module name, searched paths or export context, and related locations when available
- 📋 Given diagnostics exist for a `.tlisp` buffer, when the editor lists or queries diagnostics, then T-Lisp diagnostics should be available through editor commands and LSP-compatible diagnostic records
- 📋 Given a user is debugging a T-Lisp function, when they use trace/backtrace/last-error helpers, then they should see logical T-Lisp frames rather than raw JavaScript stack noise
- 📋 Given parsed T-Lisp values carry source metadata, when existing value equality and serialization tests run, then metadata should not change visible value shape or successful evaluation results
- 📋 Given a diagnostic or debugging feature is user-facing, when it can be expressed using existing primitives, then it should be implemented in T-Lisp rather than TypeScript
- 📋 Given TypeScript adds diagnostics support, when the change is reviewed, then it should expose only low-level primitives, data capture, serialization, daemon/client transport, or rendering hooks required by T-Lisp

#### US-0.9.2: Agent-as-User Diagnostic Workflow
**As an** AI agent developing T-Lisp packages or editor behavior
**I want** to drive a real daemon frame through `tmaxclient` key and command APIs
**So that** I can test tmax the way a user experiences it, observe structured diagnostics, self-correct, and avoid false confidence from raw eval-only tests

**Status:** 📋 Planned ([SPEC-009: Strong T-Lisp Diagnostics and Debugging](../specs/SPEC-009-tlisp-diagnostics-debugging.md), priority standard)

**Acceptance Criteria:**
- 📋 Given an agent validates user-facing behavior, when it runs acceptance checks, then it should drive a daemon-backed frame with `tmaxclient --key`, `tmaxclient --keys`, or `tmaxclient --command --json` rather than relying on raw `--eval` alone
- 📋 Given key-driven or command-driven execution fails, when the daemon responds, then the JSON-RPC error should include `error.data.diagnostic` with source span, stack, suggestions, request ID, client ID, and frame ID
- 📋 Given an error occurs from TUI-originated behavior, when the agent queries `tmaxclient --diagnostics --json`, `--last-error --json`, or `--backtrace --json`, then it should receive structured diagnostic state without scraping terminal output
- 📋 Given an agent develops a package such as an org-mode-like extension, when it claims completion, then the package should be loaded, exercised, and verified through the daemon/TUI client path that a user would use
- 📋 Given raw T-Lisp eval is used, when the work is user-facing, then raw eval should be treated only as a narrow parser/library unit check and not as acceptance validation

#### US-0.9.3: Source Spans on T-Lisp Values (GAP 5)
**As a** T-Lisp user or agent
**I want** runtime errors to include exact source locations
**So that** I can locate the failing form without guessing, even in multi-form files, modules, and init files

**Status:** 📋 Planned ([SPEC-009](../specs/SPEC-009-tlisp-diagnostics-debugging.md), Phase 1)

**Acceptance Criteria:**
- 📋 Given a T-Lisp value is parsed from source, when it is evaluated, then it should carry source span metadata (line, column, offset) through a non-enumerable WeakMap side store
- 📋 Given a runtime type, arity, or undefined-symbol error occurs, when the diagnostic is rendered, then it should include the primary span from the originating parsed form
- 📋 Given `parseProgram(source, sourceName)` is used, when a multi-form file has an error in the second or later form, then the error should report the original file line/column, not a reparsed offset
- 📋 Given parsed values carry source metadata, when existing value equality and serialization tests run, then metadata should not change visible value shape or successful evaluation results

#### US-0.9.4: Structured Diagnostics in JSON-RPC Responses (GAP 2)
**As an** AI agent using daemon eval
**I want** JSON-RPC eval failures to return structured diagnostic payloads
**So that** I can programmatically inspect errors for self-correction without losing information at the transport boundary

**Status:** 📋 Planned ([SPEC-009](../specs/SPEC-009-tlisp-diagnostics-debugging.md), Phase 3)

**Acceptance Criteria:**
- 📋 Given a daemon eval fails because of T-Lisp code, when the JSON-RPC response is returned, then it should include `error.data.kind = "tlisp-diagnostic"` and `error.data.diagnostic` with severity, code, message, source, primarySpan, expected, actual, suggestions, and stack
- 📋 Given a daemon command or keypress fails because of T-Lisp code, when the JSON-RPC response is returned, then it should use the same structured diagnostic shape
- 📋 Given a T-Lisp eval succeeds, when the response is returned, then it should not include any diagnostic payload
- 📋 Given `tmaxclient --eval CODE --json` fails, when the CLI prints output, then it should print the full JSON-RPC error object and exit nonzero

#### US-0.9.5: Diagnostic Event History and Querying (GAP 3, 4, 7)
**As an** AI agent or maintainer
**I want** to query recent diagnostics filtered by request, client, frame, and time
**So that** I can trace what happened after a specific action without keeping my own log

**Status:** 📋 Planned ([SPEC-009](../specs/SPEC-009-tlisp-diagnostics-debugging.md), Phase 3)

**Acceptance Criteria:**
- 📋 Given the daemon processes requests, when a T-Lisp diagnostic is created, then it should be stored in a bounded event history with requestId, correlationId, clientId, frameId, operation, bufferName, moduleName, timestamp, and the serialized diagnostic
- 📋 Given a JSON-RPC request carries a correlationId, when the daemon processes it, then the correlationId should be echoed in the response and in any diagnostic events generated by that request
- 📋 Given a JSON-RPC request does not carry a correlationId, when the daemon processes it, then the daemon should auto-generate one
- 📋 Given `tmaxclient --diagnostics --json` is called, when the daemon responds, then it should return the bounded diagnostic event history
- 📋 Given `tmaxclient --diagnostics --since-request ID --json` is called, when the daemon responds, then it should return only diagnostics created after that request
- 📋 Given `tmaxclient --last-error --json` is called, when the daemon responds, then it should return the most recent structured diagnostic
- 📋 Given `tmaxclient --backtrace --json` is called, when the daemon responds, then it should return the latest T-Lisp stack frames

#### US-0.9.6: T-Lisp Backtrace Capture (GAP 6)
**As a** T-Lisp user or agent
**I want** logical T-Lisp call frames on every error
**So that** I can trace the call chain leading to a failure without seeing TypeScript host stack noise

**Status:** 📋 Planned ([SPEC-009](../specs/SPEC-009-tlisp-diagnostics-debugging.md), Phase 2)

**Acceptance Criteria:**
- 📋 Given a T-Lisp function call fails, when the error is captured, then the backtrace should include logical frames for function name, module name, source span, and call-site span
- 📋 Given tail-call optimization is active, when a tail-recursive function fails, then the backtrace should remain useful and bounded, not grow unbounded
- 📋 Given macro expansion fails, when the backtrace is rendered, then it should show both the expansion site and the call site
- 📋 Given a backtrace is rendered, when it is displayed, then it should show T-Lisp frames only, not TypeScript host frames

#### US-0.9.7: Client-Exposed Key and Command Driving (GAP 1)
**As an** AI agent testing tmax as a user
**I want** to drive a real daemon frame through `tmaxclient` key and command APIs
**So that** I can exercise the same input path as a user typing in the TUI

**Status:** 📋 Planned ([SPEC-009](../specs/SPEC-009-tlisp-diagnostics-debugging.md), Phase 4)

**Acceptance Criteria:**
- 📋 Given `tmaxclient --key KEY --json` is called, when the daemon processes it, then it should send a keypress to the active frame and return a structured response with frame mode, cursor position, buffer name, status message, and any diagnostics
- 📋 Given `tmaxclient --keys 'i hello<Escape>' --json` is called, when the daemon processes it, then it should replay the key sequence on the active frame and return the same structured response shape
- 📋 Given `tmaxclient --command NAME --json` is called, when the daemon processes it, then it should execute the named editor command and return a structured response with state snapshot and diagnostics
- 📋 Given a key or command response includes diagnostics, when the agent reads the response, then diagnostics should use the same structured shape as eval error responses
- 📋 Given a `--frame` argument is provided, when the daemon processes the request, then the key or command should target the specified frame

---

### 3.1 Phase 1: Core Editing

#### US-1.15.1: Auto-Indent on Enter
**As a** developer
**I want** the editor to automatically indent the new line when I press Enter
**So that** I don't have to manually indent every line

**Status:** 📋 Planned

**Acceptance Criteria:**
- 📋 Given I'm in insert mode in a TypeScript buffer with indent rules, when I press Enter after `{`, then the new line should be indented one level deeper
- 📋 Given I'm in insert mode, when I press Enter on a line with content after the cursor, then the new line should be indented to the correct level
- 📋 Given I close a block with `}`, when the line is re-indented, then the closing brace should outdent
- 📋 Given `indent-apply-region` is called, when it processes lines, then it should actually apply the calculated indentation (currently a no-op in `indent-ops.ts`)

#### US-1.16.1: Electric Pair Mode
**As a** developer
**I want** the editor to automatically insert closing delimiters
**So that** I never have unmatched brackets, quotes, or parentheses

**Status:** 📋 Planned

**Acceptance Criteria:**
- 📋 Given `electric-pair-mode` is active, when I type `(`, then `)` should be inserted automatically and cursor placed between them
- 📋 Given `electric-pair-mode` is active, when I type `"` and the next character is already `"`, then the cursor should skip over the existing quote instead of inserting a new pair
- 📋 Given `electric-pair-mode` is active, when I press Backspace after an auto-inserted pair, then both delimiters should be deleted
- 📋 Given a major mode defines `electric-pair-pairs`, when the mode activates, then only the configured pairs should be electric
- 📋 Given `electric-pair-mode` is a minor mode, when I toggle it with `M-x electric-pair-mode`, then it should activate/deactivate per the standard mode toggle semantics

#### US-1.17.1: Show Paren Mode
**As a** developer
**I want** matching delimiters visually highlighted
**So that** I can immediately see mismatched or unmatched brackets

**Status:** 📋 Planned

**Acceptance Criteria:**
- 📋 Given `show-paren-mode` is active, when the cursor is adjacent to `(`, then the matching `)` should be highlighted
- 📋 Given `show-paren-mode` is active, when the cursor is adjacent to an unmatched delimiter, then it should be highlighted with an error color
- 📋 Given `show-paren-mode` is active, when the matching delimiter is off-screen, then some indicator should show direction
- 📋 Given multi-line expressions, when the matching delimiter is on a different line, then it should still be highlighted

#### US-1.18.1: Comment Commands
**As a** developer
**I want** to toggle comments on lines and regions
**So that** I can quickly comment/uncomment code in any language

**Status:** 📋 Planned

**Acceptance Criteria:**
- 📋 Given I'm in normal mode in a TypeScript buffer, when I press `gcc`, then the current line should be toggled between commented and uncommented
- 📋 Given I'm in visual mode with lines selected, when I press `gc`, then the selection should be toggled
- 📋 Given I'm in a Python buffer, when I toggle comment, then `#` should be used
- 📋 Given I'm in a Lisp buffer, when I toggle comment, then `;` should be used
- 📋 Given `(comment-dwim)` is called, when the region is active, then it should comment or uncomment the region
- 📋 Given `(comment-region start end)`, when called, then the region should be commented with the major mode's comment syntax

#### US-1.19.1: Indent Engine Improvements
**As a** developer
**I want** context-aware indentation
**So that** multi-line expressions, function calls, and nested structures indent correctly

**Status:** 📋 Planned

**Acceptance Criteria:**
- 📋 Given a multi-line function call in TypeScript, when I press Enter after an opening `(`, then the next line should indent to align with the first argument
- 📋 Given Python code, when I press Enter after a line ending in `:`, then the next line should indent one level; after `return`, `break`, `pass`, it should dedent
- 📋 Given Lisp code, when I press Enter inside a `let` or `if` form, then indentation should follow special-form rules, not just previous-line regex
- 📋 Given `indent-apply-region` is called, when it processes multiple lines, then each line should actually be re-indented (currently the loop body is a no-op)

#### US-1.20.1: Syntax Highlighting Pipeline
**As a** developer
**I want** syntax highlighting to be visible in the terminal
**So that** I can distinguish keywords, strings, comments, and other tokens

**Status:** 🚧 Partially implemented (tokenizer and span computation work, render pipeline wiring incomplete)

**Acceptance Criteria:**
- 🚧 Given a TypeScript buffer, when `syntax-set-language` is called, then tokens should be computed
- 📋 Given highlight spans are computed, when the renderer draws the buffer, then spans should be rendered with appropriate ANSI colors
- 📋 Given `syntax-apply-highlights` is called, when it executes, then it should return highlight spans rather than nil (currently a placeholder)
- 📋 Given a large file, when only the visible viewport changes, then only affected lines should be re-tokenized

#### US-1.1.1: Word Navigation
**As a** developer  
**I want** to navigate by words using `w`, `b`, `e`  
**So that** I can quickly move through code  

**Status:** ✅ Implemented (`src/editor/api/word-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode on any line, when I press `w`, then cursor should move to start of next word
- ✅ Given I'm in normal mode, when I press `b`, then cursor should move to start of previous word
- ✅ Given I'm in normal mode, when I press `e`, then cursor should move to end of current word
- ✅ Given I'm in normal mode, when I press `3w`, then cursor should move forward 3 words
- ✅ Given word navigation keys, when I reach the end of a line, then navigation should continue to next line

#### US-1.1.2: Line Navigation
**As a** developer  
**I want** to navigate to line start/end using `0`, `$`, `^`  
**So that** I can quickly position cursor on a line  

**Status:** ✅ Implemented (`src/editor/api/line-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `0`, then cursor should move to column 0
- ✅ Given I'm in normal mode, when I press `$`, then cursor should move to last character of line
- ✅ Given I'm in normal mode, when I press `^`, then cursor should move to first non-whitespace character

#### US-1.2.1: Delete Operator
**As a** developer  
**I want** to delete text using `d`, `dd`, `dw`, `x`  
**So that** I can remove unwanted text  

**Status:** ✅ Implemented (`src/editor/api/delete-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `dd`, then current line should be deleted
- ✅ Given I'm in normal mode, when I press `dw`, then word under cursor should be deleted
- ✅ Given I'm in normal mode, when I press `x`, then character under cursor should be deleted
- ✅ Given I'm in normal mode, when I press `3dd`, then 3 lines starting from current should be deleted
- ✅ Given deleted text, when I delete more text, then previous deletions should be stored in kill ring

#### US-1.2.2: Yank (Copy) Operator
**As a** developer  
**I want** to yank (copy) text using `yy`, `yw`  
**So that** I can duplicate text  

**Status:** ✅ Implemented (`src/editor/api/yank-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `yy`, then current line should be yanked to register
- ✅ Given I'm in normal mode, when I press `yw`, then word under cursor should be yanked
- ✅ Given yanked text, when I move cursor and press `p`, then yanked text should be pasted after cursor
- ✅ Given yanked text, when I press `P`, then yanked text should be pasted before cursor

#### US-1.2.3: Undo/Redo
**As a** developer  
**I want** to undo and redo changes using `u`, `C-r`  
**So that** I can correct mistakes  

**Status:** ✅ Implemented (`src/editor/api/undo-redo-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I've made text changes, when I press `u` in normal mode, then last change should be undone
- ✅ Given undone changes, when I press `C-r` in normal mode, then undone change should be redone
- ✅ Given multiple edits, when I press `5u`, then last 5 changes should be undone
- ✅ Given undo history, when I make new changes after undo, then redo history should be cleared

#### US-1.3.1: Count Prefix
**As a** developer  
**I want** to prefix commands with counts  
**So that** I can repeat operations efficiently  

**Status:** ✅ Implemented (`src/editor/api/count-ops.ts`, `src/editor/editor.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `3j`, then cursor should move down 3 lines
- ✅ Given I'm in normal mode, when I press `5dd`, then 5 lines should be deleted
- ✅ Given I'm in normal mode, when I press `10x`, then 10 characters should be deleted
- ✅ Given a count prefix, when I press a command without count, then command should execute once (default count of 1)

#### US-1.4.1: Change Operator
**As a** developer  
**I want** to change text using `c`, `cw`, `cc`, `C`  
**So that** I can delete and enter insert mode in one action  

**Status:** ✅ Implemented (`src/editor/api/change-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `cw`, then word under cursor should be deleted and insert mode entered
- ✅ Given I'm in normal mode, when I press `cc`, then entire line should be cleared and insert mode entered
- ✅ Given I'm in normal mode, when I press `C`, then from cursor to end of line should be deleted and insert mode entered
- ✅ Given change operator, when I complete typing and press Escape, then I should return to normal mode with changes applied

#### US-1.5.1: Search Forward/Backward
**As a** developer  
**I want** to search using `/pattern` and `?pattern`  
**So that** I can find text in my buffer  

**Status:** ✅ Implemented (`src/editor/api/search-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `/` and type a pattern, then cursor should jump to first match after current position
- ✅ Given I'm in normal mode, when I press `?` and type a pattern, then cursor should jump to first match before current position
- ✅ Given an active search, when I press `n`, then cursor should jump to next match
- ✅ Given an active search, when I press `N`, then cursor should jump to previous match
- 🚧 Given search results, when multiple matches exist, then they should be highlighted in the buffer

#### US-1.5.2: Word Under Cursor Search
**As a** developer  
**I want** to search for word under cursor using `*` and `#`  
**So that** I can quickly find other occurrences  

**Status:** ✅ Implemented (`src/editor/api/search-ops.ts`)

**Acceptance Criteria:**
- ✅ Given cursor is on a word in normal mode, when I press `*`, then search should start for that word forward
- ✅ Given cursor is on a word in normal mode, when I press `#`, then search should start for that word backward
- ✅ Given word search active, when I press `n` or `N`, then cursor should jump to next/previous occurrence

#### US-1.6.1: Jump Commands
**As a** developer  
**I want** to jump to specific lines using `gg`, `G`, `:line_number`  
**So that** I can quickly navigate large files  

**Status:** ✅ Implemented (`src/editor/api/jump-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `gg`, then cursor should jump to first line of buffer
- ✅ Given I'm in normal mode, when I press `G`, then cursor should jump to last line of buffer
- ✅ Given I'm in normal mode, when I press `:50` and Enter, then cursor should jump to line 50
- ✅ Given jump commands, when I jump to a line, then viewport should scroll to show that line

#### US-1.7.1: Visual Mode Selection
**As a** developer  
**I want** to select text in visual mode using `v`, `V`  
**So that** I can perform operations on selected regions  

**Status:** ✅ Implemented (`src/editor/api/visual-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `v`, then characterwise visual mode should start
- ✅ Given I'm in normal mode, when I press `V`, then linewise visual mode should start
- ✅ Given visual mode active, when I navigate with hjkl, then selection should expand from start position
- ✅ Given visual selection active, when I press `d`, then selected text should be deleted
- ✅ Given visual selection active, when I press `y`, then selected text should be yanked
- ✅ Given visual selection active, when I press `c`, then selected text should be deleted and insert mode entered

#### US-1.8.1: Basic Text Objects
**As a** developer  
**I want** to operate on text objects like `iw`, `aw`, `is`, `as`  
**So that** I can edit with semantic precision  

**Status:** ✅ Implemented (`src/editor/api/text-objects-ops.ts`, `src/editor/api/text-objects.ts`)

**Acceptance Criteria:**
- ✅ Given cursor is on a word in normal mode, when I press `diw`, then inner word (excluding surrounding space) should be deleted
- ✅ Given cursor is on a word in normal mode, when I press `daw`, then outer word (including trailing space) should be deleted
- ✅ Given cursor is in a sentence, when I press `dis`, then inner sentence should be deleted
- ✅ Given cursor is in a sentence, when I press `das`, then outer sentence (including trailing space) should be deleted
- ✅ Given text object commands, when I use `ciw` instead of `diw`, then text object should be deleted and insert mode entered

#### US-1.9.1: Kill Ring Storage
**As a** power user  
**I want** deleted and yanked text stored in a kill ring  
**So that** I can access recent kills  

**Status:** ✅ Implemented (`src/editor/api/kill-ring.ts`)

**Acceptance Criteria:**
- ✅ Given I delete or yank text, when the operation completes, then text should be added to kill ring
- ✅ Given kill ring with 10 items, when I kill new text, then oldest kill should be removed if ring is full
- ✅ Given kill ring state, when I query `(kill-ring-latest)`, then I should receive the most recent kill

#### US-1.9.2: Yank Pop
**As a** power user  
**I want** to cycle through kills using `M-y` after yanking  
**So that** I can access previous kills  

**Status:** ✅ Implemented (`src/editor/api/yank-pop-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I just yanked text, when I press `M-y`, then yanked text should be replaced with previous kill
- ✅ Given I'm cycling kills, when I press `M-y` multiple times, then I should cycle through older kills
- ✅ Given I cycle past oldest kill, when I press `M-y` again, then I should wrap around to newest kill

#### US-1.9.3: Evil Integration
**As a** user familiar with both Emacs and Vim  
**I want** Evil delete/yank operations to use kill ring  
**So that** both paradigms work together  

**Status:** ✅ Implemented (`src/editor/api/evil-integration.ts`)

**Acceptance Criteria:**
- ✅ Given I delete with `dd` or `dw`, when I check kill ring, then deleted text should be in kill ring
- ✅ Given I yank with `yy` or `yw`, when I check kill ring, then yanked text should be in kill ring
- ✅ Given Evil and Emacs operations mixed, when I kill then delete, then both should be accessible via kill ring

#### US-1.10.1: Minibuffer Input
**As a** user  
**I want** a dedicated minibuffer for command input  
**So that** I have a consistent interface for commands  

**Status:** ✅ Implemented (`src/editor/api/minibuffer-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I press `SPC ;` (M-x), when minibuffer appears, then it should show prompt "M-x:" at bottom of screen
- ✅ Given minibuffer is active, when I type a command name, then my input should appear in minibuffer
- ✅ Given minibuffer with input, when I press `C-g`, then minibuffer should close without executing
- ✅ Given minibuffer with input, when I press Enter, then command should execute and minibuffer close

#### US-1.10.2: Fuzzy Command Completion
**As a** power user  
**I want** fuzzy matching for command names  
**So that** I can quickly find commands without exact typing  

**Status:** 🚧 Partially implemented (command history exists, fuzzy matching planned)

**Acceptance Criteria:**
- 🚧 Given I'm in M-x mode, when I type "sw", then I should see commands matching "save-window", "switch-window"
- 🚧 Given fuzzy matches found, when multiple matches exist, then they should be ranked by prefix matches first
- 📋 Given completion list, when I press Tab, then first match should be selected
- 📋 Given selected completion, when I press Enter, then selected command should execute

#### US-1.10.3: Which-key Popup
**As a** user learning tmax  
**I want** to see available keybindings after pressing a prefix  
**So that** I can discover bindings without memorizing  

**Status:** ✅ Implemented (`src/editor/utils/which-key.ts`)

**Acceptance Criteria:**
- ✅ Given I press `SPC` (leader key), when I wait 0.5 seconds, then which-key popup should show available bindings
- ✅ Given which-key popup visible, when I see "f File operations", then I should understand `f` is a prefix key
- ✅ Given I press `SPC f`, when submenu popup appears, then I should see file operation bindings
- ✅ Given which-key popup, when I press any bound key, then popup should disappear and command execute
- ✅ Given which-key popup, when I press `C-g`, then popup should cancel and return to normal mode

#### US-1.10.4: Command Documentation Preview
**As a** user  
**I want** to see command documentation in completion  
**So that** I understand what commands do  

**Status:** ✅ Implemented (`src/editor/api/documentation.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in M-x mode, when I select a command in completion list, then its first docstring line should be visible
- ✅ Given command with documentation, when I view it in M-x completion, then I should see docstring
- ✅ Given command with keybinding, when I view it in M-x completion, then I should see "Binding: X" if it has one

#### US-1.11.1: Describe Key
**As a** user  
**I want** to see what function a key runs using `describe-key`  
**So that** I can understand keybindings  

**Status:** ✅ Implemented

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I execute M-x `describe-key` and press a key, then I should see the function bound to that key
- ✅ Given I describe `w` in normal mode, when help buffer appears, then I should see it runs the forward-word function
- ✅ Given describe-key output, when function has documentation, then I should see its docstring

#### US-1.11.2: Describe Function
**As a** user  
**I want** to see function documentation using `describe-function`  
**So that** I can learn what functions do  

**Status:** ✅ Implemented

**Acceptance Criteria:**
- ✅ Given I execute M-x `describe-function`, when I enter a function name, then I should see its full documentation
- ✅ Given function documentation, when I view it, then I should see signature, docstring, and keybindings

#### US-1.11.3: Apropos Command
**As a** power user  
**I want** to search commands by regex using `apropos-command`  
**So that** I can discover relevant commands  

**Status:** ✅ Implemented

**Acceptance Criteria:**
- ✅ Given I execute M-x `apropos-command`, when I enter "save", then I should see all commands with "save" in their name
- ✅ Given I enter "save.*buffer", then I should see commands matching both words
- 📋 Given apropos results, when I select a command, then I should view its documentation

#### US-1.21.1: Horizontal Scrolling
**As a** developer  
**I want** to scroll the viewport horizontally using `zl`, `zh`, `zs`, `ze`  
**So that** I can read and edit long lines that extend past the terminal width

**Status:** ✅ Implemented (`src/frontend/render/buffer-lines.ts`, `src/editor/api/jump-ops.ts`, `src/tlisp/core/commands/motions.tlisp`)

**Acceptance Criteria:**
- ✅ Given a line longer than the terminal width, when I press `zl`, then the viewport scrolls right by half screen width and `«` appears at the left edge
- ✅ Given a scrolled viewport, when I press `zh`, then the viewport scrolls left by half screen width (clamped to 0)
- ✅ Given I press `zs`, then the viewport scrolls so the cursor column is at the left edge
- ✅ Given I press `ze`, then the viewport scrolls so the cursor column is at the right edge
- ✅ Given the cursor moves past the right edge of the viewport, when I move the cursor right, then the viewport auto-scrolls to keep the cursor visible
- ✅ Given the cursor moves past the left edge of the viewport, when I move the cursor left, then the viewport auto-scrolls to keep the cursor visible
- ✅ Given which-key is active with `z` prefix, when the popup shows, then `l`, `h`, `s`, `e` bindings are listed

#### US-1.21.2: Word Wrap Display
**As a** developer  
**I want** to toggle word wrap so long lines display across multiple screen rows  
**So that** I can read all content without horizontal scrolling

**Status:** ✅ Implemented (`src/frontend/render/buffer-lines.ts`, `src/editor/api/minor-mode-ops.ts`)

**Acceptance Criteria:**
- ✅ Given `auto-fill-mode` is active, when I view a long line, then it wraps across multiple screen rows instead of truncating
- ✅ Given word wrap is active, when I press `j`/`k`, then cursor moves by logical line (not screen row)
- ✅ Given word wrap is active, when the cursor is on a wrapped line, then the cursor renders at the correct screen row and column
- ✅ Given word wrap is toggled on, then `viewportLeft` is forced to 0 and horizontal scroll is disabled
- ✅ Given word wrap is toggled off, then long lines truncate with `...` as before (no regression)
- ✅ Given CJK characters in a long line, when word wrap is active, then characters wrap without splitting mid-character

---

### 3.2 Phase 2: Extensibility

#### US-2.0.1: Built-In Mode Loading and Feature Registry
**As a** tmax user using daemon and direct editor workflows  
**I want** built-in mode libraries loaded before user init files and before client eval requests  
**So that** major modes, minor modes, hooks, and mode commands are available consistently everywhere  

**Status:** ✅ Implemented for built-in mode loading and truthful feature tracking (`src/tlisp/core/modes/`, `src/editor/api/load-ops.ts`)

**Acceptance Criteria:**
- ✅ Given tmax starts in daemon mode, when the daemon reports ready, then `(major-mode-list)` includes `fundamental`, `python`, `typescript`, `lisp`, and `go`
- ✅ Given tmax starts in daemon mode, when I query `(featurep "python-mode")` and `(featurep "line-numbers-mode")`, then both should be true without first calling `require`
- ✅ Given a mode file fails to parse or evaluate, when tmax starts, then startup diagnostics and tests should expose the failure instead of silently accepting partial mode state
- ✅ Given I call `(require FEATURE)`, when the feature is missing or the file does not call `(provide FEATURE)`, then `require` should fail and `(featurep FEATURE)` should remain false
- ✅ Given direct editor, daemon, TUI, and tests initialize the editor runtime, when they query loaded features, then they should see the same built-in mode registry

#### US-2.0.2: Buffer-Local Major Modes and Auto-Mode Detection
**As a** developer editing files in different languages  
**I want** each buffer to have its own major mode selected by file rules  
**So that** language-specific behavior does not leak between buffers  

**Status:** ✅ Implemented for buffer-local major modes and extension/regexp auto-mode rules (`src/editor/api/major-mode-ops.ts`, `src/editor/auto-mode.ts`)

**Acceptance Criteria:**
- ✅ Given I open a `.py`, `.ts`, `.tlisp`, or `.go` file, when the buffer becomes current, then the expected major mode should activate for that buffer
- ✅ Given I switch between two buffers with different file types, when I query current major mode, then each buffer should restore its own major mode
- ✅ Given a mode registers extensions with or without a leading dot, when auto-mode detection runs, then both forms should match correctly
- ✅ Given a major mode activates, when it has an activation hook, then that hook should execute through the live interpreter
- ✅ Given a file has no matching rule, when it opens, then the buffer should use `fundamental` mode

#### US-2.0.3: Minor Mode Definition and Generated Commands
**As a** T-Lisp extension author  
**I want** to define minor modes in T-Lisp with generated toggle commands  
**So that** editor features can be composed without TypeScript changes  

**Status:** ✅ Implemented for low-level minor-mode API, built-in line-numbers/auto-fill modes, and generated command semantics (`src/editor/api/minor-mode-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I call `define-minor-mode` or the documented fallback sequence, when the mode file loads, then the minor mode should register with name, description, lighter, hooks, and optional keymap
- ✅ Given a generated mode command is called with no argument, `t`, `nil`, a positive number, `0`, or a negative number, then it should follow Emacs-style enable/disable semantics
- ✅ Given `line-numbers` is activated, when the buffer renders, then line number state should actually change and the `Ln` lighter should appear
- ✅ Given `line-numbers` is deactivated, when line numbers were already enabled before activation, then the previous buffer-local setting should be restored
- ✅ Given `auto-fill` is activated or deactivated, when the buffer config is inspected, then real wrap/fill state should change and restore predictably

#### US-2.0.4: Global Minor Modes and Local Overrides
**As a** tmax user  
**I want** global minor modes with explicit buffer-local overrides  
**So that** session-wide features apply broadly while individual buffers can opt out or back in  

**Status:** ✅ Implemented for existing/future buffers and explicit local disable/re-enable semantics

**Acceptance Criteria:**
- ✅ Given I enable a global minor mode, when existing buffers are inspected, then the mode should be active in each buffer unless explicitly disabled
- ✅ Given I enable a global minor mode, when I create or open a future buffer, then the buffer should inherit the global mode
- ✅ Given I locally disable a globally enabled minor mode in one buffer, when I switch buffers, then only that buffer should remain disabled
- ✅ Given I locally re-enable a mode after global activation, when the global mode is later disabled, then the locally re-enabled buffer should preserve its explicit local state
- ✅ Given global minor mode state is serialized, when a client queries status or full state, then active global modes and current buffer modes should be observable

#### US-2.0.5: Callable Mode Hooks
**As a** T-Lisp extension author  
**I want** mode hooks to accept function names, symbols, and lambdas  
**So that** modes can customize buffers using normal Lisp functions  

**Status:** ✅ Implemented for string, symbol, and lambda hooks through live editor/daemon eval paths

**Acceptance Criteria:**
- ✅ Given I add a string function-name hook, when `run-hooks` executes, then the named function should run
- ✅ Given I add a symbol hook, when `run-hooks` executes, then the symbol should resolve to a callable function and run
- ✅ Given I add a lambda hook, when `run-hooks` executes through `tmaxclient --eval`, then the lambda body should run and produce an observable state change
- ✅ Given I append a hook, when multiple hooks run, then default/prepend and append ordering should be deterministic
- ✅ Given I inspect hooks with `hook-list`, when callable hooks are present, then the output should be readable and must not contain `"[object Object]"`

#### US-2.0.6: Mode-Aware Key Resolution and Discovery
**As a** keyboard-driven editor user  
**I want** active minor-mode and major-mode keymaps to participate in one resolver  
**So that** key precedence and key discovery are predictable  

**Status:** 🚧 Partially implemented (`src/editor/key-resolution.ts` has precedence rules; handler/which-key routing remains a follow-up)

**Acceptance Criteria:**
- ✅ Given a key is bound by two active minor modes, when resolved through the central resolver, then the most recently activated minor mode should win
- ✅ Given a key is bound by an active minor mode and the current major mode, when resolved through the central resolver, then the minor-mode binding should win
- ✅ Given a key is not handled by active minor or major modes, when resolved through the central resolver, then mode-specific and global bindings should continue to work
- 📋 Given I run `describe-key`, `key-binding`, or which-key, when a binding comes from a minor or major mode, then the source mode should be visible
- 📋 Given modal editing behavior uses direct primitives, when key resolution is centralized, then existing normal, insert, visual, command, and M-x behavior should not regress

#### US-2.0.7: Mode Observability in Daemon and Renderers
**As an** AI harness, client author, or tmax user  
**I want** mode metadata exposed through daemon state and rendered status lines  
**So that** clients and tests can verify mode behavior without fragile screen scraping  

**Status:** ✅ Implemented for daemon status, frame/full-state metadata, and ANSI/Ink status lines

**Acceptance Criteria:**
- ✅ Given I run `tmaxclient --json --status`, when a major mode or minor mode is active, then the JSON should include `currentMajorMode`, `activeMinorModes`, and `activeMinorModeLighters`
- ✅ Given a client queries frame, render-state, or full-state data, when mode state is active, then the same mode metadata should be present
- ✅ Given daemon-tmux renders the editor, when a Python buffer has line numbers active, then the status line should show a compact form such as `NORMAL [python] (Ln)`
- 📋 Given many minor modes are active, when the status line is narrower than the full mode string, then text should remain width-safe and not overlap
- ✅ Given the Ink renderer is used, when mode metadata changes, then its status line should match the direct ANSI renderer's mode display

#### US-2.0.8: Lisp-First Command and Policy Ownership
**As a** tmax maintainer  
**I want** user-facing editor policy to live in T-Lisp by default  
**So that** tmax grows as a Lisp editor with a TypeScript substrate  

**Status:** 🚧 Partially implemented (`docs/lisp-ownership-map.md`, representative command libraries exist; broader migration remains ongoing)

**Acceptance Criteria:**
- 📋 Given a new user-facing command is added, when it does not need a missing primitive, then it should be implemented in T-Lisp
- 📋 Given TypeScript exposes a low-level primitive, when user-facing behavior composes that primitive, then the composition, keybinding, docs, and command metadata should live in T-Lisp
- 📋 Given command metadata is needed for M-x, which-key, or `describe-key`, when a Lisp-owned command is loaded, then metadata should be registered from T-Lisp through `defcommand`, `command-register`, or equivalent
- 📋 Given the ownership map is updated, when it reports progress, then it should use the runtime TypeScript/TSX-to-T-Lisp ratio and mark partial work honestly
- 📋 Given representative editing, search, replace, buffer/file/window, help/discovery, and dired workflows are migrated, when tests run, then each category should have at least one Lisp-owned command validated through the interpreter or daemon

#### US-2.0.9: Native T-Lisp Tests for Lisp-Owned Behavior
**As an** AI harness implementing tmax behavior
**I want** Lisp-owned behavior covered by native T-Lisp tests
**So that** the Lisp layer has first-class regression coverage instead of relying only on TypeScript unit tests

**Status:** ✅ Implemented for mode-system native tests and Python daemon/daemon-tmux coverage

**Acceptance Criteria:**
- ✅ Given mode behavior is implemented in T-Lisp, when tests are added, then native T-Lisp tests should cover loaded features, generated mode commands, hook forms, and command metadata where possible
- ✅ Given native T-Lisp tests exist, when the daemon loads the test file and runs `(test-run-all)`, then failures should be reported clearly to the harness
- ✅ Given the Python UI suite runs, when mode-system coverage exists, then daemon-first mode tests should run by default
- ✅ Given daemon-tmux is used by mode tests, when assertions are made, then tmux should be limited to renderer/status-line behavior and not general command validation
- 📋 Given a behavior cannot yet be expressed in native T-Lisp tests, when the spec is implemented, then the gap should be documented and covered by Bun or Python daemon tests

#### US-2.0.10: Programming Mode Keymaps and Commands
**As a** developer editing code
**I want** programming modes to provide language-specific keybindings and commands
**So that** I can use editor features tailored to the language I'm editing

**Status:** 📋 Planned (blocked by Phase 1.5 editor primitives)

**Acceptance Criteria:**
- 📋 Given I open a `.ts` file, when I press the mode-specific keymap prefix, then I should see language-appropriate bindings in which-key
- 📋 Given I open a `.tlisp` file, when I evaluate `(eval-defun)`, then the function at cursor should be evaluated
- 📋 Given I open a `.go` file, when I execute the format command, then `gofmt` should be applied
- 📋 Given I open a `.py` file, when I execute the run command, then the script should run in a terminal
- 📋 Given any programming mode is active, when I press `gcc`, then the line should be commented/uncommented with the correct syntax

#### US-2.0.11: Special Buffer Modes
**As a** tmax user
**I want** editor UI buffers (help, messages, dired) to have proper major modes
**So that** they behave consistently with navigation, read-only protection, and mode-specific keybindings

**Status:** 📋 Planned

**Acceptance Criteria:**
- 📋 Given I open a `*Help*` buffer, when it displays, then `help-mode` should be active with navigation keybindings
- 📋 Given I open a `*Messages*` buffer, when it displays, then `special-mode` should be active and the buffer should be read-only
- 📋 Given I open `dired`, when the directory listing displays, then `dired-mode` should be active with file operation keybindings
- 📋 Given a special buffer is read-only, when I try to edit, then the edit should be rejected with a message

#### US-2.0.12: Additional Minor Modes
**As a** tmax power user
**I want** quality-of-life minor modes like hl-line, whitespace, and rainbow-delimiters
**So that** I can customize my editing experience

**Status:** 📋 Planned

**Acceptance Criteria:**
- 📋 Given `hl-line-mode` is active, when I move the cursor, then the current line should have a background highlight
- 📋 Given `whitespace-mode` is active, when I view a buffer, then tabs, trailing spaces, and hard newlines should be visually indicated
- 📋 Given `rainbow-delimiters-mode` is active, when I view nested parentheses, then each nesting level should use a different color
- 📋 Given `outline-mode` is active, when I collapse a heading, then all sub-headings should be hidden

#### US-2.1.1: Plugin Directory Structure
**As a** plugin developer  
**I want** a standard plugin directory structure  
**So that** my plugins can be discovered and loaded  

**Status:** ✅ Implemented (`src/editor/api/plugin-ops.ts`)

**Acceptance Criteria:**
- ✅ Given I install a plugin, when I place it in `~/.config/tmax/tlpa/plugin-name/`, then tmax should discover it on startup
- ✅ Given a plugin directory, when it contains `plugin.tlisp`, then tmax should load it automatically
- 📋 Given plugin with dependencies, when I specify them in manifest, then tmax should load dependencies first

#### US-2.1.2: Plugin Lifecycle Hooks
**As a** plugin developer  
**I want** lifecycle hooks for initialization  
**So that** my plugin can set up properly  

**Status:** 🚧 Partially implemented (load/unload works, enable/disable hooks planned)

**Acceptance Criteria:**
- ✅ Given a plugin defines `(plugin-init)`, when plugin loads, then init function should execute
- 📋 Given a plugin defines `(plugin-enable)`, when I enable the plugin, then enable hook should execute
- 📋 Given a plugin defines `(plugin-disable)`, when I disable the plugin, then cleanup code should execute
- 📋 Given a plugin defines `(plugin-unload)`, when plugin is unloaded, then resources should be freed

#### US-2.4.1: Macro Recording
**As a** power user  
**I want** to record keyboard macros  
**So that** I can automate repetitive tasks  

**Status:** ✅ Implemented (`src/editor/api/macro-recording.ts`)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I press `qa` (q followed by register name), then recording should start for register `a`
- ✅ Given recording is active, when I execute commands, then they should be recorded
- ✅ Given recording active, when I press `q`, then recording should stop and save to register
- ✅ Given recorded macro in register `a`, when I press `@a`, then macro should execute
- ✅ Given I just executed a macro, when I press `@@`, then last macro should execute again

#### US-2.4.2: Macro Persistence
**As a** power user  
**I want** macros to persist across sessions  
**So that** I don't lose recorded macros  

**Status:** ✅ Implemented (`src/editor/api/macro-persistence.ts`)

**Acceptance Criteria:**
- ✅ Given I recorded a macro in register `a`, when I quit and restart tmax, then macro in register `a` should still be available
- ✅ Given persistent macros, when I edit `~/.config/tmax/macros.tlisp`, then I should be able to modify recorded macros
- ✅ Given edited macro file, when I restart tmax, then my edits should be loaded

---

### 3.3 Phase 3: Advanced Features

#### US-3.1.1: LSP Client Connection
**As a** developer  
**I want** tmax to connect to language servers  
**So that** I can have IDE features  

**Status:** 🚧 Partially implemented (`src/lsp/client.ts` — framework exists, not production-ready)

**Acceptance Criteria:**
- 🚧 Given I open a TypeScript file, when tmax starts, then it should attempt to connect to language server
- 🚧 Given LSP server running, when connection succeeds, then "LSP connected" should appear in status line
- ✅ Given LSP connection fails, when server is not available, then error should be logged but editor remain functional

#### US-3.1.2: LSP Diagnostics
**As a** developer  
**I want** to see LSP diagnostics (errors, warnings)  
**So that** I can fix problems in my code  

**Status:** 🚧 Partially implemented (`src/editor/api/lsp-diagnostics.ts` — state tracking exists, display incomplete)

**Acceptance Criteria:**
- 🚧 Given LSP connected and file has errors, when I open the file, then error indicators should appear in gutter
- 🚧 Given diagnostics available, when I navigate to line with error, then error message should appear in status line
- 🚧 Given multiple diagnostics, when I list diagnostics, then I should see all errors and warnings

#### US-3.2.1: Window Splitting
**As a** developer  
**I want** to split windows horizontally and vertically  
**So that** I can view multiple files simultaneously  

**Status:** ✅ Implemented (`src/editor/api/window-ops.ts` — data structures and management, rendering in progress)

**Acceptance Criteria:**
- ✅ Given I'm in normal mode, when I execute `:split`, then window should split horizontally
- ✅ Given I'm in normal mode, when I execute `:vsplit`, then window should split vertically
- ✅ Given split windows, when I press `C-w w`, then focus should move to next window
- ✅ Given split windows, when I press `C-w q`, then current window should close

#### US-3.2.2: Window Resizing
**As a** developer  
**I want** to resize split windows  
**So that** I can adjust the layout  

**Status:** 📋 Planned

**Acceptance Criteria:**
- 📋 Given two horizontal windows, when I press `C-w +` multiple times, then current window height should increase
- 📋 Given two horizontal windows, when I press `C-w -` multiple times, then current window height should decrease
- 📋 Given two vertical windows, when I press `C-w >` multiple times, then current window width should increase
- 📋 Given two vertical windows, when I press `C-w <` multiple times, then current window width should decrease

#### US-3.4.1: Undo Tree
**As a** developer  
**I want** a branching undo tree  
**So that** I can explore alternative edit histories  

**Status:** ✅ Implemented (`src/editor/api/undo-tree.ts`)

**Acceptance Criteria:**
- ✅ Given I make edits A, B, C, undo to A, then make D, when I view undo tree, then I should see branch: A → B → C and A → D
- ✅ Given undo tree with branches, when I navigate to a branch point, then I can choose which branch to follow
- 🚧 Given undo tree visualization, when I open it, then I should see a visual representation of branches

---

### 3.4 Phase 4: Community

#### US-4.1.1: Plugin Repository
**As a** user
**I want** to discover plugins in a central repository
**So that** I can find useful extensions

**Status:** 📋 Planned — See [RFC-010: Loom Package Manager](../rfcs/RFC-010-loom-package-manager.md)

**Acceptance Criteria:**
- 📋 Given I execute M-x `list-packages`, when command runs, then I should see available plugins from the Loom registry
- 📋 Given plugin list, when I select a plugin, then I should see description, author, and version
- 📋 Given selected plugin, when I press `i` to install and `x` to execute, then it should clone to `~/.config/tmax/packages/`
- 📋 Given installed plugin, when I add `(require-module "author/plugin")` to init.tlisp, then the plugin loads on startup

#### US-4.1.2: Package Installation (CLI)
**As a** user
**I want** to install packages from the command line
**So that** I can set up tmax quickly in scripts and dotfiles

**Status:** 📋 Planned — See [RFC-010: Loom Package Manager](../rfcs/RFC-010-loom-package-manager.md)

**Acceptance Criteria:**
- 📋 Given `loom install author/plugin`, when command runs, then package is cloned to `~/.config/tmax/packages/author/plugin/`
- 📋 Given `loom install github.com/user/tmax-plugin`, when command runs, then package is cloned from the git URL
- 📋 Given `loom list`, when command runs, then installed packages are shown with name and version
- 📋 Given `loom update`, when command runs, then all installed packages are updated to latest
- 📋 Given `loom remove author/plugin`, when command runs, then package directory is deleted

#### US-4.1.3: Package Submission
**As a** plugin developer
**I want** to submit my plugin to the Loom registry
**So that** others can discover and use it

**Status:** 📋 Planned (v2 — post-adoption)

**Acceptance Criteria:**
- 📋 Given I've created a plugin with `plugin.tlisp` and `(defmodule ... (export ...))`, when I submit a PR to the recipes repo, then it should undergo review
- 📋 Given submitted recipe, when review passes, then plugin should appear in the package index
- 📋 Given published plugin, when users run `loom search`, then my plugin should appear in results

#### US-4.2.1: Documentation Website
**As a** user  
**I want** comprehensive online documentation  
**So that** I can learn tmax features thoroughly  

**Status:** 📋 Planned

**Acceptance Criteria:**
- 📋 Given I visit documentation website, when I navigate to API reference, then I should see all T-Lisp functions documented
- 📋 Given documentation site, when I search for "key bindings", then I should find relevant tutorials and guides
- 📋 Given API documentation, when I view a function, then I should see signature, description, examples, and related functions

#### US-4.3.1: Test Coverage Metrics
**As a** developer  
**I want** to see test coverage metrics  
**So that** I can ensure code quality  

**Status:** ✅ Implemented (`src/tlisp/test-coverage.ts`)

**Acceptance Criteria:**
- ✅ Given I run tests with coverage, when tests complete, then I should see percentage coverage for each module
- ✅ Given coverage report, when I view it, then I should see which functions are covered
- ✅ Given coverage below threshold, when tests run, then build should report warning

---

### Phase 0.8: Server/Client Architecture

#### US-0.8.1: Basic Server/Client Infrastructure
**As a** developer  
**I want** to control a running tmax instance from the command line  
**So that** I can open files instantly and execute T-Lisp commands  

**Status:** ✅ Implemented (`src/server/server.ts`, `tmax --daemon`)

**Acceptance Criteria:**
- ✅ Given I want to start tmax as a server, when I execute `tmax --daemon`, then server should start listening
- ✅ Given the server is running, when I connect, then file operations should work instantly
- 🚧 Given I want to evaluate T-Lisp code from command line, when I execute eval command, then I should receive output
- 📋 Given I open a file with wait mode, when I execute client command, then client should block until buffer is closed
- 📋 Given server is not running, when I execute client command, then I should see error message

#### US-0.8.2: Advanced Client Commands
**As a** power user  
**I want** advanced client commands  
**So that** I can use tmaxclient in scripts and integrations  

**Status:** 📋 Planned

**Acceptance Criteria:**
- 📋 Given I want to list all buffers, when I execute `tmaxclient --list-buffers`, then I should see list of buffers
- 📋 Given I want to kill a buffer, when I execute `tmaxclient --kill-buffer name`, then buffer should be closed
- 📋 Given I want to use tmax as git editor, when I set `GIT_EDITOR`, then commit message should open in tmax

#### US-0.8.3: AI Agent Control
**As an** AI agent  
**I want** full programmatic control over the tmax editor  
**So that** I can explore codebases and make changes  

**Status:** 📋 Planned

**Acceptance Criteria:**
- 📋 Given I want to query full editor state, when I send query, then I should receive JSON with buffers, cursor, variables
- 📋 Given I want to understand a function, when I send describe command, then I should receive documentation
- 📋 Given I want to execute and verify changes, when I send T-Lisp code, then I should receive results

---

## 4. Non-Functional Requirements

### Performance
- ✅ Fast startup (<500ms cold start)
- ✅ Responsive editing with efficient gap buffer implementation
- ✅ Steep frontend renders in ~1-2ms per keystroke (no React overhead)

### Security
- ✅ Zero external runtime dependencies (Steep frontend)
- ✅ Sandboxed T-Lisp execution environment
- ✅ No network access from editor core

### Portability
- ✅ Cross-platform: macOS, Linux (Windows planned)
- ✅ Bun runtime and Node.js compatibility (via tsx)
- ✅ Standard ANSI terminal support

### Reliability
- ✅ Comprehensive error handling with graceful degradation
- ✅ Terminal state restored on exit (alternate screen buffer cleanup)
- ✅ 1230+ passing tests across 118 test files

### Extensibility
- ✅ 25+ T-Lisp API modules for complete editor control
- ✅ 31 built-in T-Lisp standard library functions
- ✅ Macro system with quasiquote support
- ✅ Plugin loading from `~/.config/tmax/tlpa/`

---

## 5. Constraints

### Technical Constraints
- **Runtime:** Bun (primary) or Node.js with tsx (secondary)
- **Terminal:** Requires alternate screen buffer and raw mode support
- **Language:** TypeScript core with T-Lisp scripting layer
- **Frontend:** Steep (default, direct ANSI) or Ink (optional, React/Ink)

### Design Constraints
- T-Lisp handles all editor logic; frontends are thin view layers
- Editor API operations mutate state through `EditorStateAccess` proxy
- `Editor.handleKey()` returns `EditorState` (Elm Architecture bridge)
- All T-Lisp functions are registered via `createEditorAPI()` factory

### Development Constraints
- Sequential phase development (architecture before features)
- Zero breaking changes to T-Lisp API
- All new key bindings must go through T-Lisp keymaps
- UI tests via tmux harness for terminal behavior validation
