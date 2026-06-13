# Feature: Fikra — AI Coding Assistant Harness

**RFC:** RFC-013-fikra-ai-harness
**Depends on:** Daemon/client architecture (RFC-002), T-Lisp module system, minor mode system, hook system

### Prerequisites (must pass before implementation)

1. **T-Lisp module system** — Fikra modules use `defmodule`/`export`/`provide` to organize code. The module loader must correctly resolve `(require "fikra/...")` paths under `src/tlisp/core/fikra/`.
2. **Minor mode infrastructure** — `define-minor-mode`, `minor-mode-register`, `minor-mode-toggle`, `minor-mode-set` must all work (verified by existing `line-numbers-mode.tlisp`). Fikra registers as a minor mode using this exact pattern.
3. **Daemon/client with JSON-RPC** — The daemon must be able to evaluate T-Lisp expressions, manage buffers, and relay key events. Fikra's chat buffer, capture buffer, and thread management all depend on daemon-mediated buffer operations.
4. **Hook system** — `add-hook`/`remove-hook` must support `find-file-hook` so Fikra can auto-activate on file open (optional configuration).
5. **Buffer read-only support** — The `*Fikra*` chat buffer requires a read-only mode that allows programmatic insertion (streaming tokens) but blocks direct keyboard input. Verify `buffer-set-read-only` exists or add it as part of Phase 1.

## Feature Description

Fikra is a pure T-Lisp AI coding assistant built into tmax as a first-class minor mode. It provides a unified terminal-based interface to multiple AI backends (Claude Code, OpenAI Codex, Google Gemini, Pi, Ollama, custom agents) through a pluggable adapter system. The UX is chat-first: `SPC a a` opens a full-screen, read-only `*Fikra*` chat buffer where messages are composed in an Emacs org-capture-inspired popup buffer. The editor only appears when navigating to file links in AI responses.

Fikra adds minimal TypeScript — six generic primitives (`make-process`, `process-write`, `signal`, `http-request`, `json-read-from-string`, `buffer-set-read-only`) are added to the existing T-Lisp bridge via the `create*Ops()` factory pattern. All adapters, workflows, UI, checkpoints, worktree isolation, and safety confirmations are implemented entirely in T-Lisp.

## User Story

As a developer working in tmax
I want a chat-first AI assistant that lives inside my programmable editor
So that I can converse with AI, review per-turn diffs, revert mistakes, run concurrent threads in isolated worktrees, and customize every part of the interaction in T-Lisp

## Problem Statement

Every AI coding tool (Claude Code, Codex CLI, Gemini CLI) is a standalone CLI or forked IDE. None live inside a programmable editor where the user can rewrite the AI interaction itself in a scripting language. tmax already has the infrastructure — daemon/client, buffer management, mode system, T-Lisp extensibility — but no way to leverage it for AI-assisted coding.

## Solution Statement

Build Fikra as a pure T-Lisp minor mode that:
1. Adds six generic TypeScript primitives to the T-Lisp bridge (subprocess, process-write, signal, HTTP, JSON parse, buffer-read-only) via `create*Ops()` factory pattern
2. Implements all adapters, workflows, and UI in T-Lisp modules under `src/tlisp/core/fikra/`
3. Uses a chat-first UX with a read-only `*Fikra*` buffer and org-capture-style message composition
4. Provides git-based checkpoints per turn, worktree isolation per thread, and per-action safety confirmations
5. Follows existing tmax patterns (minor modes, module system, hook system, ops factories)

Each implementation phase concludes with a **patch review** that classifies issues as HIGH / MEDIUM / LOW and upgrades this spec with findings.

## Architecture Constraints

| Area | Governing Doc | Rule |
|------|--------------|------|
| C/Lisp boundary | `rules/editor.md` | TypeScript provides six I/O primitives: `make-process`, `process-write`, `signal`, `http-request`, `json-read-from-string`, `buffer-set-read-only`. Registered via `create*Ops()` factory pattern merged in `createEditorAPI()`. All adapter logic, UI, state machines, workflows, and safety checks are T-Lisp. No Fikra-specific TypeScript. |
| T-Lisp ownership | `rules/tlisp.md` | Key bindings, mode transitions, command dispatch, adapter protocol, checkpoint logic — all in `src/tlisp/core/fikra/`. TypeScript may not contain editor decisions. |
| Minor mode pattern | `src/tlisp/core/modes/line-numbers-mode.tlisp` | Fikra follows the existing `defmodule` / `define-minor-mode` / toggle function pattern. No new minor mode infrastructure. |
| Module pattern | `src/tlisp/CLAUDE.md` | Each Fikra module uses `(defmodule ...)`, `(export ...)`, `(provide "...")`. Key bindings in the same file or in `fikra-mode.tlisp`. |
| Testing gates | `rules/testing.md` | Four validation gates: `bun run typecheck`, `bun test`, `bun run test:daemon`, `bun run test:ui:renderer`. All must pass before any phase is considered complete. |
| Surgical changes | `CLAUDE.md` §3 | Touch only `src/editor/tlisp-api.ts` (add primitives via ops factory) and `src/editor/api/buffer-ops.ts` (add read-only toggle). Don't refactor adjacent code, don't modify existing ops factories beyond what's needed for registration. |
| Security | RFC-013 §Security | API keys in environment variables only. Buffer text never injected into system prompts. Per-action confirmations + checkpoint revert = two-level safety. |

## Relevant Files

### Existing Files to Modify

| File | Change | Constraints |
|------|--------|-------------|
| `src/editor/tlisp-api.ts` | Add `createProcessOps()` factory returning `Map<string, TLispFunctionImpl>` with `make-process`, `process-write`, `signal`. Add `createHttpOps()` factory with `http-request`. Add `createJsonOps()` factory with `json-read-from-string`. Merge in `createEditorAPI()`. (~250 lines total) | `rules/editor.md`: primitives answer factual questions (spawn process, send HTTP, send signal). No editor decisions. Use `api.set()` pattern matching existing ops factories. |
| `src/editor/api/buffer-ops.ts` | Add `buffer-set-read-only` primitive to toggle buffer read-only state at runtime | `rules/editor.md`: read-only is a display primitive, not an editor decision |
| `src/editor/api/minor-mode-ops.ts` | No changes expected — Fikra uses existing `define-minor-mode` / `minor-mode-register` | Verified by `line-numbers-mode.tlisp` working today |
| `src/editor/api/buffer-ops.ts` | Add `buffer-set-read-only` primitive (see above) | `rules/editor.md`: read-only is a display primitive, not an editor decision |
| `src/editor/api/tab-ops.ts` | No changes expected — capture buffer may use existing window primitives | Verify existing `window-split` / `window-delete` suffice |

### New Files

| File | Purpose | Constraints |
|------|---------|-------------|
| `src/tlisp/core/fikra/fikra-mode.tlisp` | Minor mode, `SPC a` leader group, activation | Follows `line-numbers-mode.tlisp` pattern |
| `src/tlisp/core/fikra/fikra-adapter.tlisp` | Adapter registry, protocol, backend discovery | Adapter protocol: `available-p`, `chat`, `abort` |
| `src/tlisp/core/fikra/fikra-backend-claude.tlisp` | Claude Code CLI adapter | Uses `make-process`; discovers `claude` on PATH |
| `src/tlisp/core/fikra/fikra-backend-codex.tlisp` | Codex CLI adapter | Same pattern as Claude adapter |
| `src/tlisp/core/fikra/fikra-backend-gemini.tlisp` | Gemini CLI adapter | Same pattern as Claude adapter |
| `src/tlisp/core/fikra/fikra-backend-ollama.tlisp` | Ollama HTTP adapter | Uses `http-request`; targets `localhost:11434` |
| `src/tlisp/core/fikra/fikra-backend-pi.tlisp` | Pi agent HTTP adapter | Uses `http-request`; user-configured endpoint |
| `src/tlisp/core/fikra/fikra-chat.tlisp` | `*Fikra*` buffer, streaming insert, read-only | Chat buffer is read-only; input via capture buffer |
| `src/tlisp/core/fikra/fikra-capture.tlisp` | Capture buffer popup for message composition | Org-capture pattern: `i` open, `C-c C-c` send, `C-c C-k` cancel |
| `src/tlisp/core/fikra/fikra-context.tlisp` | Context extraction (buffer, selection, project) | Uses existing T-Lisp primitives; user-overridable |
| `src/tlisp/core/fikra/fikra-workflow.tlisp` | Workflows: explain, fix, refactor, review, test, `defworkflow` | System prompts as `defvar`; overridable |
| `src/tlisp/core/fikra/fikra-ghost.tlisp` | Inline completion ghost text | Uses existing overlay pipeline; no new rendering primitives |
| `src/tlisp/core/fikra/fikra-thread.tlisp` | Thread/turn state machine, project awareness | Project → Thread → Turn hierarchy |
| `src/tlisp/core/fikra/fikra-worktree.tlisp` | Worktree isolation: create, handoff, snapshot, cleanup | Git CLI via `shell-command`; `.tmax/worktrees/` |
| `src/tlisp/core/fikra/fikra-checkpoint.tlisp` | Checkpoint views, diff buffers, revert | Git refs: `fikra/<thread-id>/<turn-count>` |
| `src/tlisp/core/fikra/fikra-safety.tlisp` | Runtime modes, per-action confirmations | Three presets + per-action Allow/Reject/Always Allow |
| `test/unit/fikra-primitives.test.ts` | Bun tests for TS primitives | `rules/testing.md`: Bun test syntax |
| `test/unit/fikra-mode.test.ts` | Bun tests for Fikra minor mode | Must include real binding files in mock filesystem |
| `test/unit/fikra-adapter.test.ts` | Bun tests for adapter registry | Test protocol compliance |
| `test/unit/fikra-capture.test.ts` | Bun tests for capture buffer lifecycle | Test open/submit/cancel/history |
| `test/unit/fikra-checkpoint.test.ts` | Bun tests for checkpoint capture/diff | Test git ref creation and revert |
| `test/unit/fikra-thread.test.ts` | Bun tests for thread/turn state machine | Test project scoping and status transitions |
| `test/unit/fikra-worktree.test.ts` | Bun tests for worktree lifecycle | Test create/snapshot/cleanup/handoff |
| `test/tlisp/fikra-*.tlisp` | T-Lisp `deftest` suites per module | `rules/testing.md`: T-Lisp test framework assertions |

## Implementation Phases

### Phase 1: Foundation — TypeScript Primitives

Add six generic primitives to the T-Lisp bridge via `create*Ops()` factory pattern merged in `createEditorAPI()`. These are not Fikra-specific — any T-Lisp package can use them.

**Constraint checkpoint:** Before starting, verify:
- [ ] `src/editor/tlisp-api.ts` registers primitives via `api.set()` in `createEditorAPI()` — confirm by reading how existing ops factories (e.g., `createBufferOps`) are merged
- [ ] `Bun.spawn` API available for subprocess management in the current Bun version
- [ ] No existing `make-process`, `http-request`, `json-read-from-string`, or `process-write` function already defined (avoid name collisions)
- [ ] `buffer-ops.ts` has internal `readonlyBuffers: Set<string>` but no runtime toggle — `buffer-set-read-only` must be added

#### Step 1.1: Add `make-process` primitive

**User story:** As a T-Lisp package author, I want to spawn subprocesses with streaming output, so that I can build CLI integrations entirely in T-Lisp.

**Description:** Add `make-process` to `src/editor/tlisp-api.ts`. Spawns a subprocess via `Bun.spawn`, streams stdout/stderr line-by-line to a T-Lisp filter function. Returns a process handle that supports stdin write, exit sentinel callback, and can be passed to `signal`. Keyword arguments: `:command` (list of strings), `:filter` (T-Lisp function name for output), `:sentinel` (T-Lisp function name for exit).

**MUST:**
- Stream stdout/stderr to the T-Lisp filter function as output arrives (no buffering until completion)
- Support `:filter` keyword for output streaming and `:sentinel` keyword for exit notification
- Return a process handle (opaque T-Lisp value) usable by `signal` and `process-write`
- Clean up process resources (close file descriptors) on exit

**MUST NOT:**
- Make any editor decisions — it's a raw I/O primitive
- Buffer output until process completion — must stream line-by-line
- Depend on any Fikra-specific code

**Convention source:** `rules/editor.md` — TypeScript provides display/I/O primitives only. Primitives registered via `api.set()` in ops factories, merged in `createEditorAPI()`.

**Acceptance criteria:**
- [ ] `(make-process :command '("echo" "hello") :filter 'my-filter)` calls `my-filter` with `"hello\n"`
- [ ] `(process-write proc "input\n")` sends input to stdin
- [ ] Sentinel function fires on process exit with the exit code
- [ ] Process handle is usable by `signal`
- [ ] File descriptors are cleaned up on process exit

#### Step 1.2: Add `process-write` primitive

**User story:** As a T-Lisp package author, I want to write to a subprocess stdin, so that I can pipe input to CLI tools.

**Description:** Add `process-write` alongside `make-process` in `createProcessOps()`. Takes a process handle and a string, writes to stdin.

**MUST:**
- Write string data to the process stdin
- Work with process handles returned by `make-process`

**Convention source:** `rules/editor.md` — I/O primitive.

**Acceptance criteria:**
- [ ] `(process-write proc "input\n")` sends data to subprocess stdin
- [ ] Works with process handles returned by `make-process`

#### Step 1.3: Add `http-request` primitive

**User story:** As a T-Lisp package author, I want to make async HTTP requests with streaming response bodies, so that I can integrate with REST APIs entirely in T-Lisp.

**Description:** Add `http-request` via `createHttpOps()` factory. Async HTTP GET/POST using Bun's `fetch`. Returns headers + status to T-Lisp, streams response body chunks to a T-Lisp filter function. Keyword arguments: `url`, `:method`, `:headers`, `:body`, `:filter`.

**MUST:**
- Stream response body chunks to the filter function as they arrive
- Return HTTP status code and headers to T-Lisp
- Support POST with body for API interactions

**MUST NOT:**
- Buffer the entire response before delivering to T-Lisp
- Depend on any Fikra-specific code

**Convention source:** `rules/editor.md` — network I/O is a display/communication primitive.

**Acceptance criteria:**
- [ ] `(http-request "http://localhost:11434/api/generate" :method "POST" :body "..." :filter 'my-filter)` delivers chunks to `my-filter` as they arrive
- [ ] Status code and headers are returned to T-Lisp on completion
- [ ] Streaming delivery — each chunk arrives as it's read from the network

#### Step 1.4: Add `json-read-from-string` primitive

**User story:** As a T-Lisp package author, I want to parse JSON strings into T-Lisp data structures, so that I can process structured output from CLI tools and HTTP APIs.

**Description:** Add `json-read-from-string` via `createJsonOps()` factory. Parses a JSON string into T-Lisp alists/lists/strings/numbers/booleans/nil. Required by all adapters that parse structured output (Claude's `stream-json`, Ollama's HTTP response).

**MUST:**
- Parse JSON objects → T-Lisp alists
- Parse JSON arrays → T-Lisp lists
- Parse JSON strings, numbers, booleans, null → T-Lisp equivalents
- Return nil on parse error (don't throw)

**MUST NOT:**
- Depend on any Fikra-specific code

**Convention source:** `rules/editor.md` — data transformation is a utility primitive.

**Acceptance criteria:**
- [ ] `(json-read-from-string "{\"type\": \"text\", \"content\": \"hello\"}")` returns `((type . "text") (content . "hello"))`
- [ ] `(json-read-from-string "[1, 2, 3]")` returns `(1 2 3)`
- [ ] `(json-read-from-string "invalid")` returns `nil`

#### Step 1.5: Add `signal` primitive

**User story:** As a T-Lisp package author, I want to send signals to running processes, so that I can abort long-running subprocess operations.

**Description:** Add `signal` alongside `make-process` in `createProcessOps()`. Takes a process handle (from `make-process`) and a signal name string (`"SIGTERM"`, `"SIGKILL"`, `"SIGINT"`). Sends the signal to the process.

**MUST:**
- Accept any signal name supported by the platform
- Work with process handles returned by `make-process`

**MUST NOT:**
- Depend on any Fikra-specific code

**Convention source:** `rules/editor.md` — process control is a system primitive.

**Acceptance criteria:**
- [ ] `(signal proc "SIGTERM")` terminates a running `sleep` process
- [ ] Works with process handles returned by `make-process`

#### Step 1.6: Add `buffer-set-read-only` primitive

**User story:** As a T-Lisp package author, I want to toggle buffer read-only state at runtime, so that I can create buffers that accept programmatic insertion but block keyboard input.

**Description:** Add `buffer-set-read-only` to `buffer-ops.ts`. Toggles whether a buffer accepts keyboard input. The internal `readonlyBuffers: Set<string>` already guards insert/delete — expose a runtime toggle.

**MUST:**
- Toggle read-only state for the current buffer
- Allow programmatic insertion even when read-only (for streaming tokens)
- Work with existing `readonlyBuffers` mechanism

**Convention source:** `rules/editor.md` — read-only is a display primitive.

**Acceptance criteria:**
- [ ] `(buffer-set-read-only t)` marks current buffer read-only
- [ ] `(buffer-set-read-only nil)` marks current buffer writable
- [ ] Read-only buffer rejects keyboard insert but accepts `buffer-insert` calls

#### Step 1.7: Write primitive tests

**User story:** As a maintainer, I want regression tests for all six primitives, so that their behavior cannot silently break.

**Description:** Create `test/unit/fikra-primitives.test.ts` covering all primitives. Use real subprocesses (not mocks) for `make-process` and `signal`. Use a local HTTP server or Bun's test server for `http-request`.

**MUST:**
- Test `make-process` spawn, stdin write, stdout streaming, sentinel on exit
- Test `process-write` sends data to stdin
- Test `signal` kills a running process
- Test `http-request` streaming, status code, headers
- Test `json-read-from-string` parsing (objects, arrays, strings, error cases)
- Test `buffer-set-read-only` toggle and enforcement
- Use Bun test syntax (`expect(x).toBe(y)`, not `assertEquals`)

**MUST NOT:**
- Mock the subprocess layer — use real processes
- Use Jest or Vitest syntax — Bun test only

**Convention source:** `rules/testing.md` — Bun test syntax, test all error paths.

**Acceptance criteria:**
- [ ] `make-process` spawn + filter + sentinel test passes
- [ ] `process-write` stdin test passes
- [ ] `signal` kills running process test passes
- [ ] `http-request` streaming + status + headers test passes
- [ ] `json-read-from-string` parse test passes
- [ ] `buffer-set-read-only` toggle test passes

#### Step 1.8: Validate Phase 1

```bash
bun run typecheck:src    # zero type errors
bun run typecheck:test   # zero type errors in tests
bun run typecheck        # zero type errors full project
bun test test/unit/fikra-primitives.test.ts  # all primitive tests pass
bun test                 # zero regressions
```

#### Step 1.6: Phase 1 Patch Review

- Review all Phase 1 changes for HIGH / MEDIUM / LOW issues
- Append findings to the "Patch Review Log" section at the end of this spec
- Fix HIGH issues before proceeding
- MEDIUM issues may be deferred with a note

---

### Phase 2: Core Mode + Chat + One Backend

Build the Fikra minor mode, chat buffer, capture buffer, Claude Code adapter, context extraction, explain workflow, and file navigation — all in T-Lisp.

**Constraint checkpoint:** Before starting, verify:
- [ ] Phase 1 validation commands all pass
- [ ] `define-minor-mode` works correctly (test via `line-numbers-mode.tlisp` activation)
- [ ] Buffer read-only mode available (if not, add `buffer-set-read-only` to `buffer-ops.ts`)
- [ ] `(require "fikra/mode")` path resolution works — confirm module loader resolves paths under `src/tlisp/core/fikra/`

#### Step 2.1: Create Fikra directory and module skeleton

**User story:** As a developer, I want `SPC a` to activate Fikra mode, so that the AI assistant keymap is available.

**Description:** Create `src/tlisp/core/fikra/` and `fikra-mode.tlisp`. Follow `line-numbers-mode.tlisp` pattern: `defmodule`, `define-minor-mode`, toggle function with optional arg, `provide`. Register `SPC a` as a leader group prefix.

**MUST:**
- Follow `defmodule`/`export`/`provide` pattern exactly
- Register `fikra` as a minor mode with lighter `"fikra"`
- Define `SPC a` as a leader key prefix

**MUST NOT:**
- Create new minor mode infrastructure — use existing system
- Put key bindings in TypeScript

**Convention source:** `src/tlisp/core/modes/line-numbers-mode.tlisp`, `src/tlisp/CLAUDE.md` module pattern.

**Acceptance criteria:**
- [ ] `(fikra-mode)` activates the minor mode
- [ ] `(fikra-mode 0)` deactivates it
- [ ] `SPC a` leader prefix is registered
- [ ] Modeline shows `fikra` lighter when active

#### Step 2.2: Create adapter registry

**User story:** As a developer, I want Fikra to discover and manage multiple AI backends, so that I can switch between them.

**Description:** Create `fikra-adapter.tlisp` with backend registry (`fikra-backends` alist), registration, switching, and protocol dispatch. Each backend implements three functions: `available-p`, `chat`, `abort`.

**MUST:**
- Store backends as alist: `(name . module)`
- `fikra-backend-call` dispatches to the current backend dynamically
- `fikra-set-backend` switches mid-conversation preserving history

**MUST NOT:**
- Hardcode any specific backend — adapters self-register
- Depend on TypeScript beyond existing primitives

**Convention source:** RFC-013 §Adapter Protocol, `src/tlisp/CLAUDE.md` command library pattern.

**Acceptance criteria:**
- [ ] `(fikra-register-backend "test" module)` adds to registry
- [ ] `(fikra-list-backends)` returns registered backends
- [ ] `(fikra-set-backend "test")` switches current backend
- [ ] `(fikra-backend-call "chat" messages options)` dispatches to current backend

#### Step 2.3: Create Claude Code adapter

**User story:** As a developer, I want Fikra to use Claude Code CLI as the default backend, so that I get a production-quality AI backend with zero configuration.

**Description:** Create `fikra-backend-claude.tlisp`. Discovers `claude` on PATH via `shell-command`. Spawns `claude --print --output-format stream-json` via `make-process`. Parses streamed JSON lines and inserts tokens. Self-registers on load.

**MUST:**
- Detect `claude` on PATH at load time
- Stream tokens via `make-process` filter
- Parse JSON output lines (type + content fields)
- Self-register with `(fikra-register-backend "claude" ...)`

**MUST NOT:**
- Make HTTP requests — Claude adapter uses CLI subprocess only
- Hardcode API keys — inherit from environment

**Convention source:** RFC-013 §CLI Adapter Pattern, RFC-013 §Adapter Protocols table.

**Acceptance criteria:**
- [ ] `(fikra-backend-claude-available-p)` returns `t` when `claude` is on PATH
- [ ] `(fikra-backend-claude-available-p)` returns `nil` when `claude` is not on PATH
- [ ] Chat spawns a `claude` subprocess with correct arguments
- [ ] Streamed tokens are parsed and inserted into `*Fikra*` buffer

#### Step 2.4: Create chat buffer management

**User story:** As a developer, I want a full-screen, read-only chat buffer that streams AI responses, so that my conversation with AI is the primary interface.

**Description:** Create `fikra-chat.tlisp`. Manages `*Fikra*` buffer: create if not exists, set read-only, stream insert, navigate file links, scroll history. Key bindings: `i` capture, `RET` follow-link, `j`/`k` scroll, `C-g` interrupt, `q` quit.

**MUST:**
- `*Fikra*` buffer is read-only for keyboard input
- Streaming tokens insert programmatically despite read-only
- File paths in responses render as navigable links
- `fikra-quit` closes buffer view but preserves thread

**MUST NOT:**
- Allow direct text input into the chat buffer — use capture buffer
- Lose conversation history on quit

**Convention source:** RFC-013 §Fikra Chat Buffer, RFC-013 §Capture Buffer.

**Acceptance criteria:**
- [ ] `(fikra-chat-open)` creates and displays `*Fikra*` full-screen
- [ ] Chat buffer rejects direct keyboard input (read-only)
- [ ] `(fikra-token-insert "text" "hello")` inserts into `*Fikra*`
- [ ] `RET` on a file path opens editor buffer
- [ ] `q` closes chat view but thread persists

#### Step 2.5: Create capture buffer

**User story:** As a developer, I want to compose messages in a small popup capture buffer, so that the chat stays read-only while I get a proper editing surface for multi-line messages.

**Description:** Create `fikra-capture.tlisp`. Popup `*Fikra-Capture*` buffer (~5 lines) in INSERT mode, created via `(split-window "horizontal")` to create a small bottom window. `C-c C-c` submits, `C-c C-k` cancels, `M-p`/`M-n` history, `RET` inserts newline.

**MUST:**
- Capture buffer opens in INSERT mode
- Submit closes capture buffer and sends message as a turn
- Cancel closes capture buffer with nothing sent
- History navigation with `M-p`/`M-n`

**MUST NOT:**
- Send empty messages — reject with status message
- Leave capture buffer open after submit/cancel

**Convention source:** RFC-013 §Capture Buffer, RFC-013 §Chat & Capture Key Bindings.

**Acceptance criteria:**
- [ ] `i` in `*Fikra*` opens `*Fikra-Capture*` popup
- [ ] `C-c C-c` sends message and closes popup
- [ ] `C-c C-k` discards and closes popup
- [ ] `M-p` inserts previous message from history
- [ ] Empty buffer submit shows status message, nothing sent

#### Step 2.6: Create context extraction

**User story:** As a developer, I want Fikra to automatically include relevant editor context, so that the AI has enough information for accurate responses.

**Description:** Create `fikra-context.tlisp`. Composes context from existing primitives: `buffer-text`, `visual-get-selection` (if visual mode active), `buffer-file-name`, `buffer-mode`. Default composition via `fikra-build-context`, overridable by `setq` in init.tlisp.

**MUST:**
- Include file name, mode, visual selection (if active), and buffer text
- Be overridable via `setq` on `fikra-build-context`
- Gracefully handle missing context (no file, no selection)

**MUST NOT:**
- Inject buffer content into system prompts — always as user message
- Depend on any TypeScript beyond existing primitives

**Convention source:** RFC-013 §Context System, `rules/editor.md` — T-Lisp owns context composition.

**Acceptance criteria:**
- [ ] `(fikra-build-context)` returns context with file, mode, visual selection (if active)
- [ ] Overriding `fikra-build-context` in init.tlisp replaces default
- [ ] No file open: context includes project directory only

#### Step 2.7: Create explain workflow

**User story:** As a developer, I want to send code to Fikra Chat and get an explanation, so that I can understand unfamiliar code within the chat interface.

**Description:** Create `fikra-workflow.tlisp`. Defines `fikra-explain`, `fikra-fix`, `fikra-refactor`, `fikra-review`, `fikra-test` — each sends context with a workflow-specific system prompt to the project's Fikra Chat. System prompts as `defvar` (user-overridable). Key bindings: `SPC a e/f/r/g/s`.

**MUST:**
- Send selection or full buffer as context
- Open `*Fikra*` full-screen with response
- Use overridable system prompts per workflow

**MUST NOT:**
- Create a new thread per workflow — use the project's main chat
- Hardcode prompts — `defvar` allows user override

**Convention source:** RFC-013 §System Prompts, `src/tlisp/CLAUDE.md` — key bindings in same file as commands.

**Acceptance criteria:**
- [ ] `SPC a e` sends selected code with explain prompt, opens `*Fikra*`
- [ ] Response labeled with `[explain]` and file/line info
- [ ] `defvar fikra-explain-prompt` is overridable via `setq`

#### Step 2.8: Wire the end-to-end flow

**User story:** As a developer, I want to press `SPC a a`, compose a message, and see a streaming AI response, so that Fikra works as a complete chat experience.

**Description:** In `fikra-mode.tlisp`, load all Phase 2 modules via `(require ...)`. Register `SPC a a` → `fikra-chat-open`, `SPC a q` → `fikra-stop`. Ensure activation loads modules, discovers backends, and creates the project's main thread.

**MUST:**
- `SPC a a` opens full-screen `*Fikra*` with auto-created main thread
- End-to-end: open → capture → submit → stream → display
- Backend auto-discovered (Claude if on PATH)

**MUST NOT:**
- Require any configuration for first-time use
- Break existing key bindings outside `SPC a` prefix

**Convention source:** `src/tlisp/core/bindings/*.tlisp` — leader key pattern.

**Acceptance criteria:**
- [ ] `SPC a a` opens `*Fikra*` full-screen
- [ ] `i` → type → `C-c C-c` sends message, streams response
- [ ] `SPC a e` on a code selection sends to chat
- [ ] `q` closes chat, `SPC a a` reopens with history intact

#### Step 2.9: Write Phase 2 tests

**User story:** As a maintainer, I want regression tests for the Fikra core, so that the mode, adapter, and capture systems cannot silently break.

**Description:** Create Bun test files and T-Lisp deftest suites covering mode activation, adapter protocol, capture lifecycle, context extraction.

**MUST:**
- Test mode activation/deactivation
- Test adapter registration and switching
- Test capture buffer open/submit/cancel
- Include real binding files in mock filesystems per `rules/testing.md`

**MUST NOT:**
- Mock the T-Lisp interpreter — use real evaluation
- Skip daemon integration tests

**Convention source:** `rules/testing.md` — Bun test syntax, mock filesystem with real bindings.

**Acceptance criteria:**
- [ ] `test/unit/fikra-mode.test.ts` — mode toggle, key bindings present
- [ ] `test/unit/fikra-adapter.test.ts` — register/list/switch backends
- [ ] `test/unit/fikra-capture.test.ts` — open/submit/cancel/history
- [ ] T-Lisp deftest suites for adapter protocol and context extraction pass

#### Step 2.10: Validate Phase 2

```bash
bun run typecheck:src    # zero type errors
bun run typecheck:test   # zero type errors in tests
bun run typecheck        # zero type errors full project
bun test test/unit/fikra-mode.test.ts       # mode tests pass
bun test test/unit/fikra-adapter.test.ts    # adapter tests pass
bun test test/unit/fikra-capture.test.ts    # capture tests pass
bun run test:daemon      # daemon integration passes
bun test                 # zero regressions
```

#### Step 2.11: Phase 2 Patch Review

- Review all Phase 2 changes for HIGH / MEDIUM / LOW issues
- Append findings to "Patch Review Log"
- Fix HIGH issues before proceeding

---

### Phase 3: Multi-Backend + Completions

Add Codex, Gemini, Ollama, Pi adapters. Backend selector popup. Ghost text completions.

**Constraint checkpoint:** Before starting, verify:
- [ ] Phase 2 validation commands all pass
- [ ] Claude adapter works end-to-end (manual test: `SPC a a` → send message → stream response)
- [ ] Adapter registry supports multiple concurrent backends

#### Step 3.1: Create Codex CLI adapter

**User story:** As a developer using OpenAI tools, I want to use Codex CLI as a Fikra backend, so that I can switch between Claude and Codex mid-conversation.

**Description:** Create `fikra-backend-codex.tlisp` — same CLI adapter pattern as Claude. Discovers `codex` on PATH, spawns subprocess, parses output, self-registers.

**MUST:**
- Follow same adapter protocol as Claude adapter
- Discover `codex` on PATH
- Self-register as `"codex"` backend

**MUST NOT:**
- Duplicate filter/sentinel logic — share common adapter helpers if possible

**Convention source:** RFC-013 §CLI Adapter Pattern.

**Acceptance criteria:**
- [ ] `codex` on PATH → adapter available
- [ ] `codex` not on PATH → adapter unavailable
- [ ] Backend switching from claude to codex preserves history

#### Step 3.2: Create Gemini CLI adapter

**User story:** As a developer using Google tools, I want to use Gemini CLI as a Fikra backend.

**Description:** Create `fikra-backend-gemini.tlisp` — same CLI adapter pattern. Discovers `gemini` on PATH.

**Acceptance criteria:**
- [ ] Discovery, streaming, abort work identically to Claude adapter
- [ ] Self-registers as `"gemini"` backend

#### Step 3.3: Create Ollama HTTP adapter

**User story:** As a developer who prefers local models, I want to use Ollama as a backend via HTTP, so that code stays on my machine.

**Description:** Create `fikra-backend-ollama.tlisp`. Uses `http-request` to POST to `localhost:11434/api/chat`. Streams response via chunked response filter.

**MUST:**
- Use `http-request` primitive (not `make-process`)
- Stream chunks as they arrive
- Detect Ollama by checking `localhost:11434` reachability

**MUST NOT:**
- Use CLI subprocess — Ollama is HTTP-only in Fikra

**Convention source:** RFC-013 §Adapter Protocols (Ollama row).

**Acceptance criteria:**
- [ ] Ollama running → adapter available
- [ ] Ollama not running → adapter unavailable
- [ ] Streaming via HTTP chunks works

#### Step 3.4: Create Pi agent HTTP adapter

**User story:** As a developer with a custom Pi agent, I want to connect it via HTTP.

**Description:** Create `fikra-backend-pi.tlisp`. Uses `http-request` for configured endpoint.

**Acceptance criteria:**
- [ ] Configured endpoint reachable → adapter available
- [ ] Streaming via HTTP works

#### Step 3.5: Build backend selector

**User story:** As a developer, I want to switch AI backends without losing the conversation, so that I can leverage different models for different tasks.

**Description:** Add backend selector popup to `fikra-adapter.tlisp`. `C-c b` in `*Fikra*` opens popup listing all registered backends. Shows `●` for available, `○` for unavailable. `RET` selects, `q` cancels.

**MUST:**
- Show availability status for each backend
- Preserve conversation history on switch
- Block selection of unavailable backends

**MUST NOT:**
- Lose conversation history on switch

**Convention source:** RFC-013 §Backend Selector.

**Acceptance criteria:**
- [ ] `C-c b` opens selector with all registered backends
- [ ] Available backends show `●`, unavailable show `○`
- [ ] Selecting a backend preserves conversation history
- [ ] `q` cancels without switching

#### Step 3.6: Build ghost text completions

**User story:** As a developer, I want to press `SPC a i` and see a dimmed code suggestion at my cursor, so that I can accept or dismiss AI completions inline.

**Description:** Create `fikra-ghost.tlisp`. Request inline completion at cursor, render as dim/faint overlay. `TAB` accepts, any other key dismisses. Uses existing overlay pipeline.

**MUST:**
- Ghost text rendered as dim/faint terminal attribute
- `TAB` inserts ghost text as real characters
- Any other key dismisses ghost text
- Uses existing overlay system

**MUST NOT:**
- Add new rendering primitives — use existing overlay pipeline
- Auto-trigger completions — only on demand via `SPC a i`

**Convention source:** RFC-013 §Inline Completions, `rules/editor.md` — rendering is a display primitive.

**Acceptance criteria:**
- [ ] `SPC a i` shows ghost text within 2 seconds
- [ ] `TAB` accepts ghost text as real text
- [ ] Any other key dismisses ghost text
- [ ] No auto-trigger — only manual request

#### Step 3.7: Write Phase 3 tests

**User story:** As a maintainer, I want tests for multi-backend support and ghost text.

**Acceptance criteria:**
- [ ] Each adapter's `available-p` detection tested
- [ ] Backend switching preserves conversation history
- [ ] Ghost text accept/dismiss lifecycle tested
- [ ] T-Lisp deftest suites for each adapter pass

#### Step 3.8: Validate Phase 3

```bash
bun run typecheck:src
bun run typecheck:test
bun run typecheck
bun test test/unit/fikra-adapter.test.ts
bun run test:daemon
bun test
```

#### Step 3.9: Phase 3 Patch Review

- Review all Phase 3 changes for HIGH / MEDIUM / LOW issues
- Append findings to "Patch Review Log"
- Fix HIGH issues before proceeding

---

### Phase 4: Threads, Turns, Checkpoints & Worktrees

Thread/turn state machine, git checkpoints, worktree isolation, per-action safety confirmations, runtime mode presets, project-aware thread grouping.

**Constraint checkpoint:** Before starting, verify:
- [ ] Phase 3 validation commands all pass
- [ ] Multi-backend switching works end-to-end
- [ ] `shell-command` can run `git worktree add` and related commands
- [ ] `.tmax/` directory pattern is established (verify with existing codebase)

#### Step 4.1: Create thread/turn state machine

**User story:** As a developer, I want each project to have a main Fikra Chat with optional additional threads, so that I can parallelize AI tasks.

**Description:** Create `fikra-thread.tlisp`. Thread data: id, backend, mode, location, status, turns. Turn data: count, status, messages, checkpoint-ref. Project awareness via working directory.

**MUST:**
- Auto-create "main" thread per project on first `SPC a a`
- Track turn status: idle/running/confirming/interrupted/error
- Scope threads by project directory
- Support `fikra-thread-new`, `fikra-thread-list`, `fikra-thread-switch`, `fikra-thread-close`

**MUST NOT:**
- Store thread state in TypeScript — T-Lisp owns all state
- Create threads until user requests Fikra (lazy initialization)

**Convention source:** RFC-013 §Project → Thread → Turn Model.

**Acceptance criteria:**
- [ ] First `SPC a a` auto-creates "main" thread for project
- [ ] Subsequent `SPC a a` reopens existing thread
- [ ] `SPC a t` creates additional thread with generated name
- [ ] `SPC a T` lists threads grouped by project
- [ ] `RET` on thread in list switches to its buffer

#### Step 4.2: Create checkpoint system

**User story:** As a developer, I want every AI turn to create a git checkpoint, so that I can review and revert any AI change.

**Description:** Create `fikra-checkpoint.tlisp`. Git refs at `fikra/<thread-id>/<turn-count>`. Baseline before turn, completion after turn. Diff display in `*Fikra-Diff*` buffer with `y`/`n`/`e`/`q` keys.

**MUST:**
- Capture baseline checkpoint before AI starts
- Capture completion checkpoint after AI finishes
- Show per-turn diff with file stats
- Support revert to any prior turn
- Support cumulative diff from thread start

**MUST NOT:**
- Use TypeScript for git operations — `shell-command` runs git CLI
- Delete checkpoint refs on revert — keep for audit trail

**Convention source:** RFC-013 §Checkpoint System, `rules/tlisp.md` — T-Lisp owns checkpoint logic.

**Acceptance criteria:**
- [ ] Baseline + completion checkpoints created per turn
- [ ] `SPC a d` shows per-turn diff in `*Fikra-Diff*`
- [ ] `n` in diff buffer reverts to baseline
- [ ] `y` in diff buffer keeps checkpoint
- [ ] `SPC a D` shows cumulative diff
- [ ] `SPC a R` reverts to any prior turn, truncates history

#### Step 4.3: Create worktree isolation

**User story:** As a developer, I want to run an AI thread in an isolated git worktree, so that concurrent threads don't conflict.

**Description:** Create `fikra-worktree.tlisp`. Git worktrees in `.tmax/worktrees/<thread-id>/`. Detached HEAD. Snapshot before cleanup. Handoff between Local ↔ Worktree modes.

**MUST:**
- Create detached HEAD worktree per thread
- Snapshot changes before cleanup
- Support bidirectional handoff (Local ↔ Worktree)
- Store in `.tmax/worktrees/` (not `.git/worktrees/`)

**MUST NOT:**
- Create branches unless user explicitly asks
- Leave orphan worktrees on thread close

**Convention source:** RFC-013 §Worktree Isolation, `rules/tlisp.md` — T-Lisp via git CLI.

**Acceptance criteria:**
- [ ] `SPC a w` creates isolated worktree, thread switches to Worktree mode
- [ ] `SPC a w` again snapshots and returns to Local mode
- [ ] Thread close cleans up worktree after snapshot
- [ ] Concurrent worktree threads don't see each other's changes
- [ ] Thread list shows `worktree` in Location column

#### Step 4.4: Create safety system

**User story:** As a developer, I want to approve or reject each AI action, so that the AI can't make changes I haven't reviewed.

**Description:** Create `fikra-safety.tlisp`. Three runtime mode presets. Per-action confirmations: Allow/Reject/Always Allow. Action types: file-write, command-exec, network-request. Per-thread trust state.

**MUST:**
- Three presets: `approval-required`, `auto-accept-edits`, `full-access`
- Inline confirmation prompt in `*Fikra*` buffer
- "Always allow" persists for thread lifetime
- `SPC a m` to change mode mid-conversation

**MUST NOT:**
- Bypass safety in any mode — even `full-access` captures checkpoints
- Store trust decisions across sessions

**Convention source:** RFC-013 §Runtime Modes, RFC-013 §Per-Action Confirmations.

**Acceptance criteria:**
- [ ] `approval-required`: file write shows `[y] Allow [n] Reject [a] Always allow`
- [ ] `y` approves one action
- [ ] `a` auto-trusts this action type for rest of thread
- [ ] `n` rejects, AI adapts approach
- [ ] `auto-accept-edits`: file writes auto-proceed, commands still confirm
- [ ] `full-access`: files + commands auto-proceed, network still confirms
- [ ] Checkpoints captured regardless of mode

#### Step 4.5: Wire thread management key bindings

**Description:** Register all Phase 4 key bindings in `fikra-mode.tlisp`.

**Acceptance criteria:**
- [ ] `SPC a t` → `fikra-thread-new`
- [ ] `SPC a T` → `fikra-thread-list` (`*Fikra-Threads*` buffer)
- [ ] `SPC a d` → `fikra-checkpoint-diff`
- [ ] `SPC a D` → `fikra-checkpoint-diff-full`
- [ ] `SPC a R` → `fikra-checkpoint-revert`
- [ ] `SPC a m` → `fikra-set-runtime-mode`
- [ ] `SPC a w` → `fikra-handoff`
- [ ] `C-c w` → `fikra-handoff`

#### Step 4.6: Write Phase 4 tests

**User story:** As a maintainer, I want regression tests for threads, checkpoints, worktrees, and safety.

**Acceptance criteria:**
- [ ] `test/unit/fikra-thread.test.ts` — create/switch/close/project scoping
- [ ] `test/unit/fikra-checkpoint.test.ts` — capture/diff/revert
- [ ] `test/unit/fikra-worktree.test.ts` — create/snapshot/cleanup/handoff
- [ ] T-Lisp deftest for safety system and runtime modes
- [ ] Daemon integration: evaluate thread operations, verify state

#### Step 4.7: Validate Phase 4

```bash
bun run typecheck:src
bun run typecheck:test
bun run typecheck
bun test test/unit/fikra-thread.test.ts
bun test test/unit/fikra-checkpoint.test.ts
bun test test/unit/fikra-worktree.test.ts
bun run test:daemon
bun test
```

#### Step 4.8: Phase 4 Patch Review

- Review all Phase 4 changes for HIGH / MEDIUM / LOW issues
- Append findings to "Patch Review Log"
- Fix HIGH issues before proceeding

---

### Phase 5: Plan Mode + Extensibility

Plan mode, custom backend registration, `defworkflow` macro, conversation history persistence.

**Constraint checkpoint:** Before starting, verify:
- [ ] Phase 4 validation commands all pass
- [ ] Thread/turn state machine handles all status transitions
- [ ] Checkpoint system works for multi-turn conversations

#### Step 5.1: Implement plan mode

**User story:** As a developer, I want to ask the AI to propose a plan before making changes, so that I can review the approach before committing.

**Description:** Add plan mode to `fikra-thread.tlisp` or new `fikra-plan.tlisp`. AI proposes markdown plan, user approves/rejects/edits. `SPC a p` starts plan-mode turn.

**MUST:**
- Plan-mode turn: AI proposes, doesn't edit files
- Approve starts implementation turn referencing plan
- Edit makes plan buffer editable
- Reject discards plan, returns to idle

**MUST NOT:**
- Allow plan-mode AI to make file edits

**Convention source:** RFC-013 §Plan Mode.

**Acceptance criteria:**
- [ ] `SPC a p` starts plan-mode turn
- [ ] AI response is a proposed plan, no file edits
- [ ] `y` approves, starts implementation turn
- [ ] `e` makes plan editable
- [ ] `n` discards plan, returns to idle

#### Step 5.2: Custom backend registration

**User story:** As a developer, I want to register custom AI backends from my init.tlisp, so that I can use private AI services.

**Description:** Add `(fikra-register-backend name config)` to `fikra-adapter.tlisp`. Config alist: `type` (http/cli), `url`, `command`, `headers`.

**Acceptance criteria:**
- [ ] `(fikra-register-backend "my-model" '((type . http) (url . "...")))` registers backend
- [ ] Custom backend appears in selector
- [ ] Chat messages sent to configured URL via `http-request`

#### Step 5.3: Custom workflow definition

**User story:** As a developer, I want to define custom AI workflows with `defworkflow`, so that I can create specialized AI interactions.

**Description:** Add `defworkflow` macro to `fikra-workflow.tlisp`. Takes `:prompt`, `:context`, `:on-response`. Auto-registers key binding.

**Acceptance criteria:**
- [ ] `(defworkflow my-doc ...)` creates callable function
- [ ] Invoking workflow extracts context, sends with prompt, applies response handler
- [ ] Workflow callable by name and via key binding

#### Step 5.4: Conversation history persistence

**User story:** As a developer, I want conversation history to persist across sessions, so that I can resume where I left off.

**Description:** Save/load thread history to `~/.config/tmax/fikra/<project>/` as T-Lisp readable data.

**Acceptance criteria:**
- [ ] Thread history saved on close
- [ ] Reopening project restores thread history
- [ ] History files are T-Lisp readable (not binary)

#### Step 5.5: Modeline integration

**User story:** As a developer, I want the modeline to show Fikra status, so that I can see backend and turn state at a glance.

**Description:** Modeline shows `fikra:<backend>●` (idle), `fikra:<backend>◉` (running), `fikra:<backend>✗` (error). Runtime mode indicator: `!` for auto-accept, `!!` for full-access.

**Acceptance criteria:**
- [ ] Idle: `fikra:claude●`
- [ ] Streaming: `fikra:claude◉`
- [ ] Error: `fikra:claude✗`
- [ ] Runtime mode shown when not `approval-required`

#### Step 5.6: Write Phase 5 tests

**Acceptance criteria:**
- [ ] Plan mode flow: propose → approve → implement
- [ ] Custom backend registration from T-Lisp evaluation
- [ ] `defworkflow` macro expansion and invocation
- [ ] History persistence round-trip

#### Step 5.7: Validate Phase 5 (Final Validation)

```bash
bun run typecheck:src
bun run typecheck:test
bun run typecheck
bun test test/unit/fikra-primitives.test.ts
bun test test/unit/fikra-mode.test.ts
bun test test/unit/fikra-adapter.test.ts
bun test test/unit/fikra-capture.test.ts
bun test test/unit/fikra-thread.test.ts
bun test test/unit/fikra-checkpoint.test.ts
bun test test/unit/fikra-worktree.test.ts
bun run test:daemon
bun run test:ui:renderer
bun test
```

#### Step 5.8: Phase 5 Patch Review

- Review all Phase 5 changes for HIGH / MEDIUM / LOW issues
- Append findings to "Patch Review Log"
- Fix HIGH issues, address MEDIUM issues or document deferrals

---

## Acceptance Criteria

1. `SPC a a` opens the project's Fikra Chat full-screen with auto-created "main" thread
2. `i` opens capture buffer; `C-c C-c` sends message; AI streams response character-by-character
3. `RET` on file links in AI responses opens editor buffer; `SPC a a` returns to chat
4. `SPC a e` sends code context to chat with explain prompt
5. Claude Code adapter works end-to-end when `claude` is on PATH
6. Backend selector (`C-c b`) lists available backends; switching preserves history
7. Ghost text completions appear dimmed; `TAB` accepts, other keys dismiss
8. Each AI turn creates baseline + completion git checkpoints
9. `SPC a d` shows per-turn diff in `*Fikra-Diff*`; `y`/`n` accepts/reverts
10. `SPC a R` reverts to any prior turn's checkpoint
11. Worktree isolation: `SPC a w` creates isolated worktree, handoff works both directions
12. Per-action confirmations appear in `approval-required` mode; "Always allow" auto-trusts
13. Runtime mode presets configure default confirmation behavior
14. Plan mode: AI proposes, user approves/rejects/edits before implementation
15. Custom backends and workflows registerable from `init.tlisp`
16. All 4 validation gates pass: `bun run typecheck`, `bun test`, `bun run test:daemon`, `bun run test:ui:renderer`

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun run typecheck:src` — zero type errors in source
- `bun run typecheck:test` — zero type errors in tests
- `bun run typecheck` — zero type errors in full project
- `bun test test/unit/fikra-primitives.test.ts` — primitive tests pass
- `bun test test/unit/fikra-mode.test.ts` — mode tests pass
- `bun test test/unit/fikra-adapter.test.ts` — adapter tests pass
- `bun test test/unit/fikra-capture.test.ts` — capture tests pass
- `bun test test/unit/fikra-thread.test.ts` — thread tests pass
- `bun test test/unit/fikra-checkpoint.test.ts` — checkpoint tests pass
- `bun test test/unit/fikra-worktree.test.ts` — worktree tests pass
- `bun run test:daemon` — daemon integration tests pass
- `bun run test:ui:renderer` — renderer E2E tests pass
- `bun test` — full test suite, zero regressions

## Design Decisions

| Decision | Rationale | Alternative rejected |
|----------|-----------|---------------------|
| Pure T-Lisp (zero Fikra TypeScript) | Follows C/Lisp boundary; enables Loom extraction; user-customizable | Mixed TS/T-Lisp — violates architecture, harder to extract |
| Three generic TS primitives (`make-process`, `http-request`, `signal`) | Shared by any T-Lisp package; Fikra doesn't monopolize I/O | Fikra-specific HTTP/subprocess modules — duplication, coupling |
| Chat-first UX with capture buffer | Read-only chat = clean history; capture = proper editing surface | Inline input in chat — mixes history with composition, no multi-line support |
| CLI subprocess adapters (not raw API) | Claude/Codex/Gemini CLIs handle prompt engineering, tool use, context management for free | Raw API integration — months of work for a worse result (RFC-013 §Alternatives) |
| Git checkpoints per turn | Every change accountable; clean revert; no custom diff engine | In-memory undo — lost on crash; no cross-session persistence |
| Worktree isolation via git CLI | No TypeScript; leverages git's proven isolation; disposable | Branch-based isolation — branch management conflicts with user's own branches |
| Per-action confirmations + checkpoint revert (two-level safety) | Action confirmations prevent bad actions in real time; checkpoints catch what slips through | Checkpoints only (t3code) or actions only (zcode) — neither alone is sufficient |
| Patch reviews between phases | Catches architectural drift early; structured issue tracking | No inter-phase review — issues compound across phases |
| `defvar` for overridable defaults | User can `setq` in init.tlisp without forking code | Hardcoded constants — not customizable |
| Files in `src/tlisp/core/fikra/` | Standard T-Lisp module location; clean Loom extraction path | `~/.config/tmax/fikra/` — outside module loader path; `src/fikra/` — wrong layer |
| `.tmax/worktrees/` in project directory (not `~/.config/tmax/`) | Worktrees are git checkouts that must live inside the project tree for `git worktree add` to work; per-project isolation is natural | `~/.config/tmax/worktrees/` — git worktrees cannot be placed outside the repo; `~/.config/tmax/fikra/<project>/` — git CLI can't reference external worktree paths |

**Deferred to follow-up:**
- Auto-trigger ghost text completions (needs debouncing + local model for latency)
- Tool use / function calling from AI responses (agent mode — see RFC-013 §Open Questions)
- Interactive auth flows (browser OAuth for backends that need it)
- Fikra over daemon protocol (tmaxclient relay to daemon holding API connections)
- Loom package extraction (awaiting Loom package manager)

## Edge Cases

- `claude` not on PATH — adapter shows unavailable (○), fallback to next registered backend or error with install instructions
- Streaming interrupted (`C-g`) mid-token — partial response preserved in chat, turn marked interrupted, modeline returns to `●`
- Empty capture buffer submitted — no turn created, status message `"Empty message"` shown
- File link to non-existent file — graceful error message `"File not found: <path>"`
- Worktree creation in non-git directory — clear error `"Not a git repository"`
- Checkpoint revert with uncommitted user changes — prompt to stash or abort; don't silently discard
- Concurrent threads in worktree mode writing same file — no conflict (isolated checkouts); merge only on handoff
- Network timeout on HTTP adapter — turn marked error, retry via `SPC a r` or new turn
- Large buffer context — context extraction respects size limits; truncate with `... [truncated]`
- Backend subprocess crash — sentinel fires, turn marked error, partial output preserved
- `SPC a a` when no backend available — error message listing detected backends with install hints
- `.tmax/worktrees/` cleanup on daemon stop — warn about unsaved worktrees before removing

## Patch Review Log

### Pre-Implementation Review — 2026-06-12

*Spec reviewed against codebase before any code written. Verified assumptions, identified missing primitives and incorrect patterns.*

---

#### HIGH (blocks implementation — must fix before Phase 1)

**H1: `defineRaw()` is not the registration pattern.**
- **Where:** Architecture Constraints table, Step 1.1, Step 1.2, Step 1.3, Relevant Files table
- **Spec says:** "Add primitives via `defineRaw()` pattern"
- **Reality:** Primitives are registered via `api.set("name", callback)` inside `createEditorAPI()` in `tlisp-api.ts`. Each ops module returns a `Map<string, TLispFunctionImpl>`, merged into a single `api` map. There is no `defineRaw()` function in `tlisp-api.ts`.
- **Fix:** Replace all `defineRaw()` references with `api.set()` / ops factory pattern. Add a new `createProcessOps()` factory returning `Map<string, TLispFunctionImpl>` and merge it in `createEditorAPI()`, matching how `createBufferOps()`, `createCursorOps()`, etc. work.
- **Affected sections:** Architecture Constraints table row "C/Lisp boundary", Relevant Files `tlisp-api.ts` row, Step 1.1 Convention source, Step 1.2 Convention source, Step 1.3 Convention source, Notes "Ops factory pattern"

**H2: No JSON parsing primitive exists in T-Lisp.**
- **Where:** Step 2.3 (Claude adapter), Step 3.3 (Ollama adapter)
- **Spec says:** "Parse JSON output lines (type + content fields)" and "Parse streamed JSON lines"
- **Reality:** No `json-read-from-string`, `json-parse`, or any JSON parsing is exposed to T-Lisp. The only JSON code is internal `JSON.stringify` in the evaluator.
- **Fix:** Add `json-read-from-string` as a fourth TS primitive in Phase 1 (or as part of Step 1.1). It's a generic utility needed by any adapter that parses structured output. Without it, the Claude adapter cannot parse `stream-json` output. This also blocks Ollama's HTTP response parsing.
- **Affected sections:** Phase 1 (add Step 1.4 or extend Step 1.1), Step 2.3 MUST list, Step 3.3, Prerequisites

**H3: `shell-command` does not exist — the primitive is `shell-command`.**
- **Where:** Step 2.3 (Claude adapter), Step 4.2 (checkpoints), Step 4.3 (worktrees), Edge Cases, Architecture Constraints, RFC-013 code references throughout
- **Spec says:** References `shell-command` for PATH detection, git operations, checkpoint capture
- **Reality:** The primitive is named `shell-command`, not `shell-command`. It executes a shell command synchronously and returns the output.
- **Fix:** Replace all `shell-command` references with `shell-command`. Verify return value semantics match what Fikra expects (the adapter needs to check if `claude` is on PATH by running `which claude` and inspecting the result).
- **Affected sections:** Step 2.3 Description, Step 4.2 Convention source note, Step 4.3 Description, Edge Cases, Design Decisions table

---

#### MEDIUM (should fix — may cause rework if deferred)

**M1: No `buffer-set-read-only` primitive exists.**
- **Where:** Prerequisite #5, Step 2.4 (chat buffer management)
- **Spec says:** "Buffer read-only support" prerequisite, "Chat buffer rejects direct keyboard input (read-only)"
- **Reality:** Buffer ops has an internal `readonlyBuffers: Set<string>` parameter checked on insert/delete, but no T-Lisp-callable `buffer-set-read-only` toggle. The read-only set is populated at construction time, not at runtime.
- **Fix:** Add `buffer-set-read-only` as a T-Lisp-callable primitive in Phase 1 or Phase 2. The internal mechanism exists; it just needs a runtime toggle exposed. Add to `buffer-ops.ts` as a new op in the existing factory.
- **Impact:** Without this, the chat buffer cannot enforce read-only — users could accidentally type into the conversation history.

**M2: `buffer-selection` does not exist — only `visual-get-selection` in visual mode.**
- **Where:** Step 2.6 (context extraction), RFC-013 §Context System
- **Spec says:** "Uses existing primitives: `buffer-text`, `buffer-selection`, `buffer-file-name`, `buffer-mode`"
- **Reality:** No `buffer-selection` primitive exists. `visual-get-selection` exists but only returns data when visual mode is active. There's no way to get the selection from normal mode (e.g., after selecting and returning to normal).
- **Fix:** Either: (a) add a `buffer-selection` primitive that works in any mode, or (b) have Fikra capture the selection while in visual mode before sending to chat (workflow sends `visual-get-selection` if active, otherwise sends full buffer). Option (b) is more aligned with the C/Lisp boundary since it uses existing primitives.
- **Impact:** Context extraction from selection won't work without this.

**M3: `process-write` is referenced in acceptance criteria but not defined as a step.**
- **Where:** Step 1.1 acceptance criteria
- **Spec says:** `(process-write proc "input\n")` sends input to stdin
- **Reality:** `process-write` is listed as an acceptance criterion but there's no step that implements it. It's a companion to `make-process` but needs to be called out as a separate primitive or documented as part of the `make-process` return value.
- **Fix:** Either make `process-write` part of the `make-process` step explicitly, or document that the process handle returned by `make-process` includes a write method exposed as a separate T-Lisp function.
- **Impact:** Without `process-write`, adapters cannot send stdin to CLI subprocesses (needed for Claude's `--print` mode with piped input).

**M4: Capture buffer popup mechanism is unspecified.**
- **Where:** Step 2.5 (capture buffer)
- **Spec says:** "Popup `*Fikra-Capture*` buffer (~5 lines)"
- **Reality:** `split-window` exists in `window-ops.ts` (accepts "horizontal" or "vertical"), but the spec doesn't specify whether the capture buffer uses `split-window` or the which-key overlay approach. The which-key overlay is a full-screen popup panel, not a small inline window. These are fundamentally different rendering mechanisms.
- **Fix:** Specify the rendering mechanism: use `split-window "horizontal"` to create a small bottom window for the capture buffer, or define a new overlay type. Document which approach and why.
- **Impact:** Unclear implementation path; may require new rendering primitives if split-window doesn't produce the desired UX.

**M5: `.tmax/` directory doesn't exist in the codebase.**
- **Where:** Step 4.3 (worktree isolation), RFC-013 §Worktree Isolation
- **Spec says:** Worktrees stored in `.tmax/worktrees/<thread-id>/`
- **Reality:** No code creates project-local `.tmax/` directories. The XDG config dir is `~/.config/tmax/`. RFC-014B references `.tmax.project` as a future project marker but it's not implemented.
- **Fix:** Decide: project-local `.tmax/worktrees/` or global `~/.config/tmax/worktrees/<project-hash>/`. Project-local is simpler and matches RFC-013, but needs a directory-creation step. Document the choice in Design Decisions.
- **Impact:** Worktree cleanup and discovery depend on the chosen location.

---

#### LOW (noted for future consideration — does not block implementation)

**L1: `SPC a` is available — confirmed, no conflict.**
- Current `SPC` bindings are `SPC ;` (M-x) and `SPC x <subkey>` (Emacs compatibility). The `a` key is free for Fikra's use.

**L2: Module path resolution confirmed — `(require-module fikra/mode)` will work.**
- The actual function is `require-module` (not `require`). Example: `(require-module editor/modes/typescript)`. The spec should use `require-module` consistently.

**L3: `split-window` exists, not `window-split`.**
- Minor naming difference. The primitive is `split-window` with arg "horizontal" or "vertical".

**L4: Leader group registration mechanism unspecified.**
- The spec says "Register `SPC a` as a leader group prefix" but doesn't show how. Looking at `normal.tlisp`, leader bindings are just multi-character `(key-bind "SPC" "...")` entries — there's no explicit "leader group" registration. The `a` subkey needs a new binding entry like `(key-bind "a" "(fikra-leader-dispatch)" "SPC")` or similar.

**L5: History file format choice.**
- Step 5.4 says "T-Lisp readable data" but doesn't specify the format. Options: T-Lisp s-expression file, JSON file, or custom format. S-expression is the natural choice since T-Lisp can `(read)` it back.

---

#### Summary

| Severity | Count | Action |
|----------|-------|--------|
| HIGH | 3 | Must fix before Phase 1. H1 (registration pattern), H2 (JSON parsing), H3 (shell-command name) |
| MEDIUM | 5 | Should fix before affected phase. M1 (read-only), M2 (selection), M3 (process-write), M4 (capture popup), M5 (.tmax dir) |
| LOW | 5 | Note for implementation. L1-L5 |

#### Required Spec Updates

1. **H1:** Replace `defineRaw()` with `api.set()` / ops factory pattern throughout
2. **H2:** Add `json-read-from-string` as Phase 1 primitive (Step 1.4 or extend 1.1)
3. **H3:** Replace `shell-command` with `shell-command` throughout
4. **M1:** Promote `buffer-set-read-only` from prerequisite to Phase 1 step
5. **M2:** Specify context extraction uses `visual-get-selection` or add `buffer-selection` primitive
6. **M3:** Add `process-write` as explicit Phase 1 deliverable alongside `make-process`
7. **M4:** Specify capture buffer uses `split-window` or new overlay type
8. **M5:** Document `.tmax/` directory choice in Design Decisions table

### Phase 1+2 Post-Implementation Review — 2026-06-13

*Code review of implemented TypeScript primitives (Phase 1) and T-Lisp modules (Phase 2). Typecheck passes, 68 tests pass with zero regressions. Review found 5 Critical, 4 Required, 5 Nit, 3 FYI issues.*

---

#### CRITICAL (blocks merge — must fix)

**C1: `alist-get` is not defined anywhere — Claude adapter will fail at runtime.**
- **Where:** `fikra-backend-claude.tlisp:34-35`
- **Code:** `(alist-get "type" json)` and `(alist-get "content" json)`
- **Reality:** `alist-get` is not a T-Lisp stdlib function, not a TypeScript primitive, and not defined in any `.tlisp` file. Additionally, `json-read-from-string` returns objects as lists of two-element lists `("key" value)`, not dotted alist pairs `("key" . value)` — so even if `alist-get` were defined, it would need to handle the list-of-lists format.
- **Fix:** Add `alist-get` to T-Lisp stdlib. It should accept a key string and a list of two-element lists, returning the value of the first matching pair. Alternatively, rewrite the Claude adapter to use car/cdr directly.

**C2: `intern` and `fboundp` are not defined — adapter registry will fail at runtime.**
- **Where:** `fikra-adapter.tlisp:26-28`, `fikra-adapter.tlisp:65-66`
- **Code:** `(intern (concat "fikra-backend-" name "-available-p"))` and `(fboundp fn)`
- **Reality:** Neither `intern` nor `fboundp` exist in the T-Lisp runtime. The entire dynamic dispatch mechanism (`fikra-backend-available-p`, `fikra-backend-call`) depends on these. `funcall` exists in stdlib, but `intern` and `fboundp` do not.
- **Fix:** Add `intern` (converts string to symbol) and `fboundp` (checks if symbol is bound to a function) as T-Lisp stdlib functions. These are essential for the adapter pattern.

**C3: `http-request` hardcodes Fikra-specific callback — violates C/Lisp boundary.**
- **Where:** `tlisp-api.ts:1288`
- **Code:** `state._evalTlisp(\`(fikra-http-complete ${requestId} ...)\`)`
- **Reality:** A generic HTTP primitive should not know about `fikra-http-complete`. The Architecture Constraints say "no Fikra-specific TypeScript." The `make-process` primitive correctly uses `:sentinel` keyword for its completion callback — `http-request` should follow the same pattern.
- **Fix:** Accept a `:complete` or `:sentinel` keyword argument and call that function instead of hardcoding `fikra-http-complete`.

**C4: `split-string` doesn't exist — the builtin is `string-split`.**
- **Where:** `fikra-backend-claude.tlisp:30`
- **Code:** `(split-string output "\n")`
- **Reality:** The T-Lisp stdlib defines `string-split` (in `stdlib.ts:239`), not `split-string`.
- **Fix:** Replace `split-string` with `string-split` in fikra-backend-claude.tlisp.

**C5: `string-match-p` doesn't exist — only `string-match` is defined.**
- **Where:** `fikra-chat.tlisp:70-72`
- **Code:** `(string-match-p "src/[^ \t\n]+" line)`
- **Reality:** `string-match` exists as a TypeScript primitive (in `tlisp-api.ts`), but `string-match-p` does not. `string-match` returns the match index or nil — it can be used as a predicate since any number is truthy.
- **Fix:** Replace `string-match-p` with `string-match` in fikra-chat.tlisp. The return value semantics are compatible (number = truthy, nil = falsy).

---

#### REQUIRED (must fix before merge)

**R1: `buffer-mode` doesn't exist — `fikra-build-context` will fail.**
- **Where:** `fikra-context.tlisp:11`
- **Code:** `(mode (buffer-mode))`
- **Reality:** No `buffer-mode` function exists. The mode getter is `editor-mode` (in `mode-ops.ts`).
- **Fix:** Replace `buffer-mode` with `editor-mode` in fikra-context.tlisp.

**R2: `buffer-current-line-text` doesn't exist — `fikra-follow-link` will fail.**
- **Where:** `fikra-chat.tlisp:61`
- **Code:** `(buffer-current-line-text)`
- **Reality:** No such function exists. Existing primitives: `buffer-line` (takes line number) and `cursor-line` (returns current line number).
- **Fix:** Replace `(buffer-current-line-text)` with `(buffer-line (cursor-line))`.

**R3: `buffer-exists-p` doesn't exist — `fikra-capture` and `fikra-chat-open` will fail.**
- **Where:** `fikra-capture.tlisp:22`, `fikra-chat.tlisp:26`
- **Code:** `(buffer-exists-p fikra-capture-buffer-name)`, `(buffer-exists-p fikra-chat-buffer-name)`
- **Reality:** No `buffer-exists-p` function exists. `buffer-list` returns all buffer names.
- **Fix:** Add `buffer-exists-p` to `buffer-ops.ts`, or define a T-Lisp helper that checks `(member name (buffer-list))`.

**R4: Claude adapter extracts wrong JSON field for stream-json format.**
- **Where:** `fikra-backend-claude.tlisp:35`
- **Code:** `(alist-get "content" json)`
- **Reality:** Claude's `--output-format stream-json` produces `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}`. The text content is in `delta.text` (nested), not a top-level `content` field.
- **Fix:** Extract content from the nested path: get `delta` from the top-level object, then get `text` from delta.

---

#### NIT (minor, optional)

**N1: Global `RET` and `C-g` bindings in `fikra-chat.tlisp:118-119` are not buffer-scoped.**
- These `(key-bind "RET" ...)` and `(key-bind "C-g" ...)` are registered unconditionally when the module loads, not scoped to the `*Fikra*` buffer. They will override `RET` and `C-g` in all normal-mode buffers.
- **Fix:** Scope these bindings to when the `*Fikra*` buffer is active (e.g., via buffer-local keymap or conditional check).

**N2: `fikra-extract-file-path` has potentially incorrect regex escaping in T-Lisp strings.**
- `fikra-chat.tlisp:76-80` uses `[^\s\t\n,;)\"]+` inside T-Lisp string literals. The `\s` escape semantics in T-Lisp strings need verification.

**N3: `fikra-turn-send` lacks visual separator between user message and AI response.**
- `fikra-chat.tlisp:94` inserts "You: message" but AI response tokens are appended without a prefix. Consider adding "\nAI: " before the first token of each turn.

**N4: `fikra-backends` alist values are always `t` — misleading.**
- `fikra-adapter.tlisp:22` pushes `(name . t)` on registration, but actual availability is checked dynamically. The `t` value is never read.

**N5: Process table ID counter never wraps.**
- `nextProcessId` in `tlisp-api.ts:1127` increments indefinitely. Low risk for practical sessions.

---

#### FYI (informational only)

**FYI1: Tests verify file contents, not T-Lisp evaluation.**
- Both `fikra-mode.test.ts` and `fikra-primitives.test.ts` check file existence and TypeScript primitive behavior. No test evaluates the T-Lisp modules through the interpreter, so the 7+ missing runtime functions were not caught.

**FYI2: `SPC a i` bound to unimplemented `fikra-complete`.**
- `fikra-mode.tlisp:78` binds `SPC a i` to `fikra-complete` which is a Phase 3 feature (ghost text). Pressing it will produce a "not defined" error until Phase 3.

**FYI3: `fikra-chat-open` loads the Claude adapter on every call.**
- `fikra-chat.tlisp:33` does `(require-module fikra/backend-claude)` inside `fikra-chat-open`. The module system should handle duplicate loads, but loading typically happens once during `fikra-start`.

---

#### Summary

| Severity | Count | Action |
|----------|-------|--------|
| CRITICAL | 5 | Must fix. C1–C2 (missing stdlib), C3 (boundary violation), C4–C5 (wrong function names) |
| REQUIRED | 4 | Must fix. R1–R3 (missing functions), R4 (wrong JSON path) |
| NIT | 5 | Optional. N1 (global bindings), N2–N5 (minor) |
| FYI | 3 | Informational. FYI1 (test coverage gap), FYI2–FYI3 (future considerations) |

#### Required Fixes

1. **C1:** Add `alist-get` to T-Lisp stdlib (or rewrite Claude adapter field extraction)
2. **C2:** Add `intern` and `fboundp` to T-Lisp stdlib
3. **C3:** Change `http-request` to accept `:complete` keyword instead of hardcoding `fikra-http-complete`
4. **C4:** Replace `split-string` with `string-split` in fikra-backend-claude.tlisp
5. **C5:** Replace `string-match-p` with `string-match` in fikra-chat.tlisp
6. **R1:** Replace `buffer-mode` with `editor-mode` in fikra-context.tlisp
7. **R2:** Replace `buffer-current-line-text` with `(buffer-line (cursor-line))` in fikra-chat.tlisp
8. **R3:** Add `buffer-exists-p` primitive or T-Lisp helper
9. **R4:** Fix Claude adapter JSON extraction to use nested `delta.text` path
