# RFC-013: Fikra — AI Harness

**Date:** 2026-06-12
**Status:** Proposed
**Author:** Mekael Turner

## Summary

Fikra is an AI coding assistant built into tmax as a first-class minor mode. It provides a unified, fully terminal-based interface to multiple AI backends — Claude Code, OpenAI Codex, Google Gemini, Pi, Ollama, and custom agents — through a pluggable adapter system. Users activate it with `SPC a`, chat with AI in a dedicated buffer, manage agent sessions as threads, review per-turn diffs with git checkpoints, request inline completions, explain and refactor code, and switch backends mid-conversation — all without leaving the terminal.

Fikra combines the best of t3code and zcode. From t3code: a **thread → turn** model where each conversation is a thread, each AI interaction is a turn, and every turn gets a **git checkpoint** for revert-any-time accountability. From zcode: **project-aware organization** where threads are grouped by project directory, **per-action safety confirmations** (Allow / Reject / Always Allow per action type), and seamless **backend switching mid-conversation**. Three **runtime mode presets** (`approval-required`, `auto-accept-edits`, `full-access`) configure default safety behavior, while individual actions can still be confirmed or auto-trusted granularly. A **plan mode** lets the AI propose before implementing. Unlike those tools, Fikra's threads, turns, and diffs live in tmax buffers — navigable, searchable, and scriptable via T-Lisp.

Unlike standalone AI tools, Fikra runs inside a **programmable editor**: T-Lisp can customize prompts, define new AI workflows, compose multi-step agent chains, and hook AI responses into editor commands. The AI doesn't just generate text — it generates T-Lisp that runs against a live interpreter.

> **Future extraction.** Fikra is built into tmax now so it ships immediately. Because it is written entirely in T-Lisp, extraction to a Loom package is trivial — the files already follow Loom conventions. Once the Loom package manager ships, Fikra will be extracted into `tmax/fikra` as the first Loom package with zero restructuring.

## Name

**Fikra** — Swahili for "thought" or "idea" (from *kufikiri*, to think). Works as a mode name (`fikra-mode`), a T-Lisp namespace (`fikra-*`), and a buffer name (`*Fikra*`).

## Motivation

Three trends converge:

1. **AI coding tools are converging on the same shape.** Claude Code, Codex CLI, Gemini CLI, zcode, t3code — they all do the same thing: gather context, call an API, stream a response, apply edits. The differentiation is increasingly in the wrapper, not the model.

2. **None of them live inside a programmable editor.** Every AI coding tool is either a standalone CLI or a forked IDE. None give the user a scripting language to customize the AI interaction itself. Emacs has `gptel` and `claude-code.el`, but they're plugins fighting against a C core.

3. **tmax already has the infrastructure.** Daemon/client architecture, JSON-RPC protocol, `*Messages*` observability, buffer management, mode system, T-Lisp extensibility. The pieces are on the board.

The gap analysis in `docs/memos/ai-subscription-gap-analysis.md` correctly identified that most AI toolting is "generic harness work." Fikra embraces that: it *is* a generic harness, but one where the user can rewrite every part of it in T-Lisp. That's the differentiator — not the AI, but the programmability of the AI.

### Why Built-In (For Now)

1. **Ship immediately.** Fikra is useful today. Waiting for Loom adds months of dependency. Building it into tmax means the AI harness ships with the next release.

2. **Co-develop the interfaces.** The T-Lisp API, adapter functions, and thread/turn model need real usage to stabilize. A built-in mode gets exercised by every developer immediately, exposing design problems fast.

3. **Extraction is trivial.** Fikra lives entirely in `src/tlisp/core/fikra/` — pure T-Lisp with no TypeScript. When Loom ships, moving these files into a package is a file copy + `loom.toml`. No hybrid packaging needed.

## Design Principles

1. **Adapter, not implementation.** Fikra doesn't implement any AI logic. Each backend is an adapter that translates Fikra's standard protocol into whatever the backend speaks.

2. **T-Lisp all the way down.** Every part of Fikra — adapters, workflows, prompts, context extraction, response post-processing, UI — is T-Lisp. The TypeScript core provides three generic primitives (`make-process`, `http-request`, `signal`) that any T-Lisp package can use. Fikra adds zero TypeScript to the core.

3. **Terminal-native UX.** No GUI. No web views. Chat in a buffer, completions as ghost text, status in the modeline. Every AI tool interaction looks like editing.

4. **Backend-agnostic conversations.** Switch backends mid-conversation. Chat with Claude, then ask Gemini to review its answer, then send both responses to Codex for a synthesis.

5. **Zero mandatory dependencies.** Fikra is built into tmax but inactive until the user enables it. Backends are discovered at runtime — if `claude` is on PATH, the Claude Code adapter is available.

6. **Streaming-first.** All backends stream tokens into the chat buffer as they arrive. No spinner-then-wall-of-text.

7. **Git-based accountability.** Every AI turn gets a git checkpoint. The user can diff, review, and revert any turn. The AI is accountable to the repository.

## Architecture

### TypeScript Core Prerequisites

Fikra requires three generic primitives added to the TypeScript→T-Lisp bridge. These are not Fikra-specific — they benefit any T-Lisp package that needs subprocess or network access (like Emacs' `make-process` and `url-retrieve`):

1. **`make-process`** — spawn a subprocess, stream stdout/stderr line-by-line to a T-Lisp filter function. Supports stdin write, signal/kill, exit status callback.
2. **`http-request`** — async HTTP with streaming response body. Returns headers + status to T-Lisp, streams chunks to a filter function.
3. **`signal`** — send a signal (SIGTERM, SIGKILL, SIGINT) to a running process. Used to abort streaming turns.

These are small (~50-100 lines each) additions to the existing T-Lisp runtime in `src/editor/tlisp-api.ts`. No new TypeScript files.

### Source Structure (Built-In)

Fikra is entirely T-Lisp. It lives in `src/tlisp/core/fikra/` and is loaded when `fikra-mode` is activated. Zero TypeScript files in Fikra itself.

```
src/tlisp/core/fikra/
├── fikra-mode.tlisp                  ; Minor mode, key bindings, activation
├── fikra-chat.tlisp                  ; *Fikra* buffer management, input area
├── fikra-context.tlisp               ; Context extraction (buffer, selection, project)
├── fikra-workflow.tlisp              ; Workflows: explain, fix, refactor, review, test
├── fikra-ghost.tlisp                 ; Inline completion rendering
├── fikra-thread.tlisp                ; Thread/turn state machine, checkpoint manager
├── fikra-worktree.tlisp              ; Worktree isolation: create, handoff, snapshot, cleanup
├── fikra-checkpoint.tlisp            ; Checkpoint views, diff buffers, revert
├── fikra-adapter.tlisp               ; Adapter registry, base protocol functions
├── fikra-backend-claude.tlisp        ; Claude Code adapter (make-process)
├── fikra-backend-codex.tlisp         ; Codex CLI adapter (make-process)
├── fikra-backend-gemini.tlisp        ; Gemini CLI adapter (make-process)
├── fikra-backend-ollama.tlisp        ; Ollama adapter (http-request)
├── fikra-backend-pi.tlisp            ; Pi agent adapter (http-request)
└── fikra-safety.tlisp                ; Per-action confirmations, runtime modes
```

### Project → Thread → Turn Model

Fikra uses a three-level hierarchy inspired by the best of zcode and t3code.

**Project** — the current working directory (or git repository root). All threads created within a session are grouped under their project. The `*Fikra-Threads*` buffer groups threads by project, like zcode's sidebar. Switching projects (opening a different directory) scopes the thread list accordingly.

**Thread** — a conversation with a backend. Each project auto-creates a "main" thread when the user presses `SPC a a` to open Fikra Chat. Additional threads can be created with `SPC a t` (`fikra-thread-new`). Each thread has its own message history, model selection, runtime mode, and git branch. Threads run in **Local mode** (working directory, foreground) or **Worktree mode** (isolated git checkout, background). Multiple threads can exist concurrently within a project, each in its own isolated worktree. Threads can seamlessly switch between Local and Worktree mode via Handoff (`SPC a w`).

**Turn** — a single interaction within a thread. The user sends a message (or the system sends a context-enriched prompt), the AI responds (possibly making file edits), and a checkpoint is captured. Each turn tracks: status, messages exchanged, tool calls made, and the git checkpoint ref.

**Checkpoint** — a git ref (`fikra/<thread-id>/<turn-count>`) captured at the boundary of each turn. Before the AI starts, a baseline checkpoint is captured. When the AI finishes, a completion checkpoint is captured. The diff between consecutive checkpoints is the per-turn change set.

The lifecycle:

1. **Open project** — tmax's working directory defines the project scope
2. **Open Fikra Chat** — `SPC a a` opens the project's main chat thread full-screen (auto-created if first time)
3. **Send a turn** — user types a message, AI responds via streaming; tool calls appear inline
4. **Navigate files** — file references in AI responses are navigable links; `RET` opens an editor, `SPC a a` returns to chat
5. **Safety confirmations** — each AI action (file write, command run, network request) triggers a confirmation based on runtime mode and per-action trust settings
6. **Checkpoint** — git ref captured automatically at turn boundary
7. **Review diff** — `SPC a d` shows the per-turn diff in `*Fikra-Diff*`; accept/revert with `y`/`n`
8. **Continue or revert** — next turn continues from the checkpoint; `SPC a R` reverts to any prior turn

### Runtime Modes + Per-Action Confirmations

Runtime modes are **presets** that configure default confirmation behavior. Individual actions can still be confirmed or auto-trusted independently.

**Mode presets:**

| Mode | File edits | Commands | Network | Use case |
|------|-----------|----------|---------|----------|
| `approval-required` | Confirm each | Confirm each | Confirm each | Default, safe exploration |
| `auto-accept-edits` | Auto | Confirm each | Confirm each | Code-heavy iterations |
| `full-access` | Auto | Auto | Confirm each | Autonomous agent mode |

Mode is set per-thread and can be changed mid-conversation with `SPC a m`.

**Per-action confirmation** — when an AI action requires approval, a confirmation appears inline in the `*Fikra*` buffer:

```
  AI wants to: write to src/editor/handlers/normal-handler.ts
  [y] Allow  [n] Reject  [a] Always allow file writes
```

- **Allow** — approve this one action only
- **Reject** — deny this action; the AI adapts its approach
- **Always allow** — auto-trust this action type (file writes, command execution, etc.) for the rest of the thread

This is inspired by zcode's action-level safety, combined with t3code's checkpoint-level revert as a safety net. Even if you "always allow" file writes and the AI makes a mistake, you can still revert the entire turn via `SPC a R`.

### Plan Mode

A thread can be started in **plan mode** (`SPC a p`). In plan mode:
1. The AI proposes a markdown plan instead of making edits
2. The plan appears in the `*Fikra*` buffer as a proposed plan
3. User approves the plan (`y`) or requests changes (`e` to edit the plan)
4. On approval, a new turn starts in implementation mode, referencing the plan

This separates thinking from doing — the AI lays out its approach before touching files.

### Backend Adapters

Every adapter is a T-Lisp module that implements the adapter protocol through three functions:

```lisp
;; Adapter protocol — each backend must provide these
(defun fikra-backend-<name>-available-p ()
  "Return t if this backend is installed and ready.")

(defun fikra-backend-<name>-chat (messages options)
  "Send MESSAGES to the backend, streaming tokens into *Fikra*.
MESSAGES is a list of (role . content) pairs.
OPTIONS is an alist of backend-specific settings.
Tokens are appended to the current thread's buffer via fikra-token-insert.")

(defun fikra-backend-<name>-abort ()
  "Abort the current streaming request.")
```

The adapter registry in `fikra-adapter.tlisp` manages backend discovery and routing:

```lisp
;; Adapter registry
(defvar fikra-backends '())   ; alist of (name . backend-module)

(defun fikra-register-backend (name module)
  "Register a backend module under NAME."
  (push (cons name module) fikra-backends))

(defun fikra-backend-call (method &rest args)
  "Call METHOD on the current backend with ARGS."
  (let ((fn (intern (concat "fikra-backend-" (fikra-current-backend) "-" method))))
    (apply fn args)))
```

### Adapter Protocols

| Backend | Protocol | Discovery | T-Lisp Primitive |
|---------|----------|-----------|-------------------|
| Claude Code | CLI subprocess | `claude` on PATH | `make-process` |
| OpenAI Codex | CLI subprocess | `codex` on PATH | `make-process` |
| Google Gemini | CLI subprocess | `gemini` on PATH | `make-process` |
| Pi Agent | Custom (HTTP/WS) | Configured endpoint | `http-request` |
| Ollama | HTTP REST | `ollama` + `localhost:11434` | `http-request` |
| Custom | HTTP or CLI | User-configured | Either |

### CLI Adapter Pattern

Most adapters follow the same pattern — spawn a subprocess, pipe messages in, stream tokens out:

```lisp
;; fikra-backend-claude.tlisp (representative CLI adapter)
(defun fikra-backend-claude-available-p ()
  "Return t if claude CLI is on PATH."
  (not (string= (shell-command-to-string "which claude 2>/dev/null") "")))

(defun fikra-backend-claude-chat (messages options)
  "Stream chat via claude CLI subprocess."
  (let* ((args (list "--print" "--output-format" "stream-json"))
         (proc (make-process
                 :command (cons "claude" args)
                 :stdin (json-encode `((messages . ,messages)
                                       (options . ,options)))
                 :filter 'fikra-backend-claude-filter
                 :sentinel 'fikra-backend-claude-sentinel)))
    (fikra-set-current-process proc)))

(defun fikra-backend-claude-filter (proc output)
  "Parse streamed JSON lines from claude, insert tokens into *Fikra*."
  (dolist (line (split-string output "\n"))
    (when (not (string= line ""))
      (let* ((json (json-read-from-string line))
             (type (alist-get 'type json))
             (content (alist-get 'content json)))
        (fikra-token-insert type content)))))

(defun fikra-backend-claude-abort ()
  "Kill the running claude process."
  (signal (fikra-current-process) 'SIGTERM))
```

### Checkpoint System

Every turn gets two git checkpoints:
- **Baseline**: captured before the AI starts working (`fikra/<thread-id>/<turn>-baseline`)
- **Completion**: captured after the AI finishes (`fikra/<thread-id>/<turn>`)

The diff between consecutive checkpoints gives the per-turn file changes. The diff from thread creation to any checkpoint gives the cumulative changes.

Checkpoints are stored as T-Lisp alists in the thread state:

```lisp
;; Checkpoint data structure
((thread-id . "main")
 (turn-count . 3)
 (ref . "fikra/main/3")
 (baseline-ref . "fikra/main/3-baseline")
 (status . ready)
 (files . ((("path" . "tlisp-api.ts")
            ("kind" . modified)
            ("additions" . 8)
            ("deletions" . 0))))
 (completed-at . "2026-06-12T14:32:00Z"))
```

Checkpoint capture uses the existing `shell-command-to-string` bridge to run `git add -A && git commit`:

```lisp
(defun fikra-checkpoint-capture (thread-id turn-count kind)
  "Capture a git checkpoint. KIND is 'baseline or 'completion."
  (let ((ref (format "fikra/%s/%s%s" thread-id turn-count
                     (if (eq kind 'baseline) "-baseline" ""))))
    (shell-command-to-string
      (format "git add -A && git commit -m 'fikra checkpoint: %s' --allow-empty"))
    (shell-command-to-string
      (format "git update-ref refs/heads/%s HEAD" ref))
    ref))
```

Reverting a checkpoint restores the filesystem to that ref, truncates the thread's message history to that turn, and cleans up stale checkpoint refs.

### Worktree Isolation

Each thread operates in one of two modes, inspired by Codex's Local/Worktree runtime model:

**Local mode** — the thread works directly in the project's working directory. This is the default for the first thread. Edits affect the user's actual files immediately.

**Worktree mode** — the thread works in an isolated git worktree — a separate checkout of the repository. Concurrent threads in worktree mode never conflict with each other or with the user's working directory.

**Handoff** — threads can seamlessly switch between Local and Worktree mode mid-session. A thread starts in Local, hands off to Worktree to run in the background, then hands off back to Local to inspect results in the working directory. State is preserved across handoffs: the worktree is snapshotted before removal and restored on re-entry.

```lisp
;; Worktree lifecycle (pure T-Lisp via git CLI)

(defun fikra-worktree-create (thread-id)
  "Create an isolated worktree for THREAD-ID."
  (let ((path (format ".tmax/worktrees/%s" thread-id)))
    (shell-command-to-string
      (format "git worktree add --detach %s HEAD" path))
    path))

(defun fikra-worktree-snapshot (thread-id)
  "Snapshot worktree state before cleanup."
  (let ((path (format ".tmax/worktrees/%s" thread-id)))
    (shell-command-to-string
      (format "cd %s && git add -A && git commit -m 'fikra snapshot: %s' --allow-empty"
              path thread-id))))

(defun fikra-worktree-cleanup (thread-id)
  "Remove worktree after snapshotting."
  (let ((path (format ".tmax/worktrees/%s" thread-id)))
    (fikra-worktree-snapshot thread-id)
    (shell-command-to-string
      (format "git worktree remove %s" path))))

(defun fikra-handoff ()
  "Switch current thread between Local ↔ Worktree mode.
Local → Worktree: create isolated checkout, copy state.
Worktree → Local: snapshot worktree, merge/leave changes, remove tree."
  (if (fikra-thread-worktree-p (fikra-current-thread))
      (fikra-handoff-to-local (fikra-current-thread))
    (fikra-handoff-to-worktree (fikra-current-thread))))
```

Worktree properties:
- **Detached HEAD** by default — worktrees don't create branches unless the user explicitly asks
- **Disposable** — worktrees are auto-created per thread and auto-cleaned up when the thread closes or when the count exceeds a configurable limit (default: 10)
- **Snapshot + restore** — before cleanup, all changes are committed to a snapshot ref. If the user re-opens the thread in worktree mode, the snapshot is restored
- **Stored in `.tmax/worktrees/`** — not in `.git/worktrees/`, keeping tmax's worktree management separate from the user's own worktrees

## Context System

### What Fikra sends to the AI

Context extraction uses existing T-Lisp editor primitives — no Fikra-specific TypeScript needed.

**Editor primitives** (already in T-Lisp API):
- `buffer-text` — full buffer text
- `buffer-selection` — selected text with line range
- `cursor-line`, `cursor-column` — cursor position
- `buffer-file-name` — file path of current buffer
- `buffer-mode` — active major mode (language)
- `shell-command-to-string` — project file listing (lazy)

**Fikra context composition** (user-customizable):
```lisp
(defun fikra-build-context ()
  "Build context for AI request. Users can override this."
  (let ((buf (buffer-text))
        (sel (buffer-selection))
        (file (buffer-file-name))
        (mode (buffer-mode)))
    (concat
      (when sel (concat "Selected code:\n```\n" sel "\n```\n"))
      (when file (concat "File: " file " (" mode ")\n"))
      (when buf (concat "Buffer content:\n```\n" buf "\n```\n")))))
```

Users can override `fikra-build-context` to include project-specific context, inject documentation, or strip sensitive data.

### System Prompts

Each workflow has a default system prompt (in T-Lisp), overridable by the user:

```lisp
(defvar fikra-explain-prompt
  "You are a code explainer. Explain the following code clearly and concisely.
  Focus on: what it does, why, and any non-obvious patterns.")

(defvar fikra-fix-prompt
  "You are a bug fixer. Analyze the following code and suggest a fix.
  Explain the bug, then provide the corrected code.")

(defvar fikra-refactor-prompt
  "You are a code refactorer. Improve the following code for clarity and efficiency.
  Preserve all existing behavior.")
```

## T-Lisp API

### Core Functions

```lisp
;; Start/stop
(fikra-start &optional backend)       ; Start fikra-mode, optionally with specific backend
(fikra-stop)                          ; Stop fikra, close buffers

;; Project awareness
(fikra-project-current)               ; Get current project root path
(fikra-project-threads)               ; List threads for current project
(fikra-project-switch path)           ; Switch to a different project's threads

;; Thread management
(fikra-thread-new &optional backend)  ; Create a new thread (new *Fikra* buffer)
(fikra-thread-list)                   ; List all threads with status (grouped by project)
(fikra-thread-switch thread-id)       ; Switch to a different thread's buffer
(fikra-thread-close thread-id)        ; Close a thread, clean up checkpoints
(fikra-thread-archive thread-id)      ; Archive a thread (soft delete)

;; Turn management
(fikra-turn-send message)             ; Send message → starts a new turn
(fikra-turn-interrupt)                ; Cancel the current in-progress turn
(fikra-turn-status)                   ; Get current turn status (idle/running/completed/error)

;; Capture buffer (message composition)
(fikra-capture)                       ; Open capture buffer for message composition
(fikra-capture-submit)                ; Submit capture buffer contents as a new turn
(fikra-capture-cancel)                ; Discard capture buffer contents

;; Chat (convenience wrappers around turn-send)
(fikra-chat message)                  ; Send message to current backend
(fikra-chat-with-context message)     ; Send message with buffer context
(fikra-chat-region)                   ; Send selection to chat

;; Checkpoints & diffs
(fikra-checkpoint-list)               ; List checkpoints for current thread
(fikra-checkpoint-diff turn-count)    ; Show diff for a specific turn
(fikra-checkpoint-diff-full)          ; Show cumulative diff from thread start
(fikra-checkpoint-revert turn-count)  ; Revert filesystem + thread to a checkpoint
(fikra-accept-edits)                  ; Accept current turn's edits (in approval mode)
(fikra-reject-edits)                  ; Reject current turn's edits, revert to baseline

;; Safety confirmations (per-action)
(fikra-action-allow)                  ; Allow this one action
(fikra-action-reject)                 ; Reject this action
(fikra-action-always-allow action-type) ; Auto-trust this action type for the thread

;; Runtime mode (presets for confirmation behavior)
(fikra-set-runtime-mode mode)         ; Set mode: approval-required, auto-accept-edits, full-access
(fikra-runtime-mode)                  ; Get current runtime mode

;; Plan mode
(fikra-plan-start)                    ; Start a plan-mode turn (AI proposes, doesn't edit)
(fikra-plan-approve)                  ; Approve proposed plan, start implementation turn
(fikra-plan-edit)                     ; Edit the proposed plan before approving
(fikra-plan-reject)                   ; Reject proposed plan

;; Completions
(fikra-complete)                      ; Request inline completion at cursor
(fikra-accept)                        ; Accept ghost text completion
(fikra-dismiss)                       ; Dismiss ghost text completion

;; Workflows (single-shot — create thread, send turn, show result)
(fikra-explain)    (fikra-fix)    (fikra-refactor)
(fikra-review)     (fikra-test)

;; Worktree isolation
(fikra-handoff)                        ; Switch thread between Local ↔ Worktree mode
(fikra-thread-worktree-p thread-id)    ; Is this thread in a worktree?
(fikra-worktree-status)                ; Show current thread's worktree path and status

;; Backend management
(fikra-set-backend name)              ; Switch to named backend (mid-conversation)
(fikra-list-backends)                 ; List available backends
(fikra-register-backend name config)  ; Register custom backend

;; History & config
(fikra-history)                       ; Show conversation history
(fikra-clear-history)                 ; Clear conversation history
(fikra-set-option key value)          ; Set option (model, temperature, etc.)
```

### Custom Workflow Definition

```lisp
(defworkflow fikra-document
  "Generate documentation for the function at point."
  :prompt "Generate T-Lisp docstring for the following function.
           Follow tmax docstring conventions."
  :context '(selection buffer-metadata)
  :on-response 'fikra-insert-above)
```

### Custom Backend Registration

```lisp
(fikra-register-backend "my-local-model"
  '((type . http)
    (url . "http://localhost:8080/v1/chat")
    (model . "my-model")
    (headers . (("Authorization" . "Bearer my-key")))))
```

## UI

### Fikra Chat Buffer

`*Fikra*` is a special buffer with its own keymap. Each thread gets its own `*Fikra*` buffer (named `*Fikra-<id>*` for additional threads; the first is just `*Fikra*`):

```
 ┌─ *Fikra* ── tmax ── claude ─────────────────────────────┐
 │                                                           │
 │ You: Explain the gap buffer implementation                │
 │                                                           │
 │ Claude: The gap buffer splits text into two segments      │
 │ with a gap in between. Insertions happen at the gap       │
 │ edge, so they're O(1). When the cursor moves, the        │
 │ gap moves with it — characters are copied across the      │
 │ gap boundary. This gives amortized O(1) insert at the     │
 │ cost of O(n) cursor movement across the gap.              │
 │                                                           │
 │ The key insight is that most editing happens near the     │
 │ cursor, so the gap stays in the "hot zone" most of the    │
 │ time.                                                     │
 │                                                           │
 │ You: Can you optimize the gap movement?                   │
 │                                                           │
 │ Claude: ▊                                                 │
 └───────────────────────────────────────────────────────────┘
```

### Capture Buffer (Message Input)

Inspired by Emacs' `org-capture`, Fikra uses a **capture buffer** for composing messages — a small temporary buffer that pops up over the chat. The chat buffer itself is read-only (conversation history + streaming output). To compose a message:

1. Press `i` in the `*Fikra*` buffer → a capture buffer pops up (small window, ~5 lines)
2. Type your message freely (multi-line, full editing)
3. `C-c C-c` to submit → capture buffer closes, message is sent as a new turn
4. `C-c C-k` to cancel → capture buffer closes, nothing sent

```
 ┌─ *Fikra* ── tmax ── claude ─────────────────────────────┐
 │                                                           │
 │ Claude: The gap buffer splits text into two segments      │
 │ with a gap in between...                                  │
 │                                                           │
 │ The key insight is that most editing happens near the     │
 │ cursor, so the gap stays in the "hot zone"...             │
 │                                                           │
 │ Claude: ▊                                                 │
 │                                                           │
 │ ┌─ *Fikra-Capture* ──────────────────────────────────┐   │
 │ │ How would you optimize gap relocation? Consider     │   │
 │ │ both the pointer-based approach and a block-copy     │   │
 │ │ ▊                                                   │   │
 │ └─────────────────────────────────────────────────────┘   │
 │  C-c C-c: send  C-c C-k: cancel                           │
 └───────────────────────────────────────────────────────────┘
```

Chat buffer key bindings:

| Key | Command | Description |
|-----|---------|-------------|
| `i` | `fikra-capture` | Open capture buffer to compose a message |
| `RET` | `fikra-follow-link` | Follow file link under cursor |
| `j` / `k` | scroll | Navigate chat history |
| `C-g` | `fikra-turn-interrupt` | Cancel current in-progress turn |
| `C-c b` | `fikra-set-backend` | Switch AI backend |
| `C-c d` | `fikra-checkpoint-diff` | Show diff for last turn |
| `C-c c` | `fikra-copy-code` | Copy last code block |
| `C-c m` | `fikra-set-runtime-mode` | Change runtime mode |
| `C-c n` | `fikra-thread-new` | Create a new thread |
| `C-c w` | `fikra-handoff` | Switch thread Local ↔ Worktree |
| `q` | `fikra-quit` | Close chat buffer |

Capture buffer key bindings:

| Key | Command | Description |
|-----|---------|-------------|
| `C-c C-c` | `fikra-capture-submit` | Submit message and close capture buffer |
| `C-c C-k` | `fikra-capture-cancel` | Discard message and close capture buffer |
| `M-p` | `fikra-history-prev` | Previous input from history |
| `M-n` | `fikra-history-next` | Next input from history |
| `RET` | newline | Insert newline (multi-line messages) |

### Inline Completions (Ghost Text)

Ghost text appears as dimmed characters after the cursor:

```
function calculateTotal(items: Item[]) {
  const total = items.reduce▊(sum, item) => sum + item.price, 0);
  return total;
}
```

The ghost text `(sum, item) => sum + item.price, 0)` is rendered in a dimmed color (terminal dim/faint attribute). `TAB` accepts, any other key dismisses.

Ghost text uses the existing overlay/rendering pipeline — no new rendering primitives needed, just a new overlay type.

### Modeline

When fikra-mode is active, the modeline shows the current backend and turn status:

```
 --NORMAL--  fikra:claude●         L12 C5 [typescript]
```

Status indicators:
- `●` — idle, ready for input
- `◉` — turn running, streaming response
- `○` — disconnected
- `✗` — error
- `?` — awaiting approval (in `approval-required` mode)

Runtime mode indicator (when not `approval-required`):
- `!` — `auto-accept-edits`
- `!!` — `full-access`

### Backend Selector

`C-c b` in the chat buffer opens a backend selector popup:

```
 ┌─ Fikra Backend ─────────┐
 │ ● claude       (CLI)     │
 │ ● codex        (CLI)     │
 │ ○ gemini       (CLI)     │
 │ ● ollama       (HTTP)    │
 │ ○ pi           (HTTP)    │
 └───────────────────────────┘
```

● = available, ○ = not detected. `RET` selects, `q` cancels.

### Thread List

`SPC a T` opens a `*Fikra-Threads*` buffer listing all threads grouped by project:

```
  tmax (~/projects/tmax)
    Thread  Backend   Mode              Location  Status    Turns
    main    claude    approval-required local     ● idle     4
    fix-11  codex    auto-accept       worktree  ◉ running  2

  gomoku-ai (~/projects/gomoku-ai)
    Thread  Backend   Mode              Location  Status    Turns
    docs    ollama    approval-required local     ● idle     1
```

Navigate with `j`/`k`, `RET` to switch to a thread, `d` to archive, `n` to create new.

## Threads, Turns & Checkpoints

The project/thread/turn/checkpoint model combines t3code's git-based accountability with zcode's project-aware organization and action-level safety. Every AI action is accountable at two levels: per-action confirmation and per-turn checkpoint revert.

### Comparison with t3code / zcode

| Aspect | t3code | zcode | Fikra |
|--------|--------|-------|-------|
| Organization | Flat thread list | Project → Task grouping | Project → Thread grouping |
| Session unit | Thread | Task | Thread |
| Interaction unit | Turn | Turn | Turn |
| Change tracking | Git checkpoint per turn | Diff panel | Git checkpoint per turn |
| Safety | Runtime modes (3) | Per-action confirmations (Allow/Reject/Always Allow) | **Both**: runtime mode presets + per-action confirmations |
| Revert | Checkpoint revert | Manual | Checkpoint revert (git-based) |
| Plan mode | Yes | Yes | Yes, T-Lisp customizable |
| Backend switching | No | Yes, mid-conversation | Yes, mid-conversation |
| Worktree isolation | No | No | **Yes**: Local/Worktree modes with Handoff |
| Diff view | Inline diff (GUI) | Diff panel (GUI) | `*Fikra-Diff*` buffer |
| Thread list | Sidebar (GUI) | Sidebar (GUI) | `*Fikra-Threads*` buffer |
| Navigation | Mouse | Mouse | Vim-style: `j`/`k`, `RET` |
| Extensibility | None | None | T-Lisp: override context, add workflows |

### Thread States

A thread's session status tracks the current turn:

| Status | Indicator | Meaning |
|--------|-----------|---------|
| `idle` | `●` | Ready for user input |
| `running` | `◉` | Turn in progress, AI is working |
| `confirming` | `?` | AI action awaiting user confirmation (Allow/Reject/Always Allow) |
| `interrupted` | `◈` | User cancelled the current turn |
| `error` | `✗` | Turn failed with an error |

### Checkpoint Diff Buffer

`*Fikra-Diff*` shows the diff for a turn. The header shows the thread, turn number, and file stats. Changes are rendered with ANSI colors (green for additions, red for deletions).

```
  Thread: main  Turn: 3  fikra/main/3
  tlisp-api.ts  +8 -0

  @@ -42,6 +42,14 @@ export function registerAPI(env: Environment): void {
    env.define("buffer-delete", bufferDelete);
+   env.define("editor-undo", editorUndo);
+   env.define("editor-redo", editorRedo);
    env.define("cursor-line", cursorLine);
    env.define("cursor-column", cursorColumn);
+ }
+
+ function editorUndo(args: SExpression[]): SExpression {
+   const editor = getCurrentEditor();
+   editor.undo();
+   return symbol("t");
+ }

  Accept these changes? (y/n/e/q)
```

Diff buffer key bindings:

| Key | Command | Description |
|-----|---------|-------------|
| `y` | `fikra-accept-edits` | Accept and keep the checkpoint |
| `n` | `fikra-reject-edits` | Reject, revert to baseline checkpoint |
| `e` | edit | Open the changed file at the first hunk |
| `j` / `k` | scroll | Navigate the diff |
| `q` | quit | Close diff buffer |

## Key Bindings (fikra-mode)

Fikra is a minor mode. It adds a leader group under `SPC a` (a for AI):

| Key | Command | Description |
|-----|---------|-------------|
| `SPC a a` | `fikra-chat` | Open project chat full-screen (auto-created main thread) |
| `SPC a t` | `fikra-thread-new` | Create a new thread |
| `SPC a T` | `fikra-thread-list` | List all threads |
| `SPC a d` | `fikra-checkpoint-diff` | Show diff for last turn |
| `SPC a D` | `fikra-checkpoint-diff-full` | Show cumulative diff |
| `SPC a R` | `fikra-checkpoint-revert` | Revert to a checkpoint |
| `SPC a m` | `fikra-set-runtime-mode` | Change runtime mode |
| `SPC a p` | `fikra-plan-start` | Start plan-mode turn |
| `SPC a s` | `fikra-chat-region` | Send selection to Fikra |
| `SPC a i` | `fikra-complete` | Request inline completion |
| `SPC a e` | `fikra-explain` | Explain code at point |
| `SPC a f` | `fikra-fix` | Suggest fix |
| `SPC a r` | `fikra-refactor` | Refactor code at point |
| `SPC a g` | `fikra-test` | Generate tests |
| `SPC a b` | `fikra-set-backend` | Switch AI backend |
| `SPC a w` | `fikra-handoff` | Switch thread Local ↔ Worktree |
| `SPC a h` | `fikra-history` | Browse conversation history |
| `SPC a q` | `fikra-stop` | Stop fikra-mode |

## Configuration

In `~/.config/tmax/init.tlisp`:

```lisp
;; Default backend
(setq fikra-default-backend "claude")

;; Default runtime mode
(setq fikra-default-runtime-mode "approval-required")

;; Default model per backend
(setq fikra-models
  '((claude . "claude-sonnet-4-6")
    (codex . "codex-mini")
    (gemini . "gemini-2.5-pro")
    (ollama . "devstral")))

;; Custom system prompt
(setq fikra-system-prompt
  "You are a helpful coding assistant inside the tmax editor.
   The user is editing a file in <LANGUAGE>. Be concise.

   When generating code, prefer T-Lisp idioms when editing
   .tlisp files and TypeScript idioms when editing .ts files.")

;; Enable fikra-mode globally
(add-hook 'find-file-hook 'fikra-mode)
```

## Implementation Phases

### Phase 0: TypeScript Primitives (2-3 days)

Add three generic primitives to the T-Lisp runtime in `src/editor/tlisp-api.ts`:

- `make-process` — spawn subprocess with streaming stdout/stderr filter, stdin write, exit sentinel (~80 lines)
- `http-request` — async HTTP GET/POST with streaming response body (~80 lines)
- `signal` — send signal to a running process handle (~20 lines)

These are not Fikra-specific. Any T-Lisp package can use them (shell-mode, browse-url, etc.).

**Verify:** Write TRT tests for `make-process` (spawn `echo`, read output), `http-request` (hit local server), `signal` (kill a sleep process).

### Phase 1: Core Mode + One Backend (1 week)

All T-Lisp, no new TypeScript:

- `fikra-mode.tlisp` — minor mode, key bindings, activation
- `fikra-adapter.tlisp` — adapter registry, protocol functions
- `fikra-backend-claude.tlisp` — Claude Code adapter using `make-process`
- `fikra-chat.tlisp` — `*Fikra*` buffer management, streaming insert
- `fikra-context.tlisp` — context extraction using existing editor primitives
- `fikra-workflow.tlisp` — explain, fix, refactor workflows
- `fikra-ghost.tlisp` — ghost text overlay rendering
- `fikra-chat` + `fikra-turn-send` working end-to-end with Claude Code

**Verify:** Open `*Fikra*` buffer, send message to Claude Code, stream response. Explain workflow on a code selection.

### Phase 2: Multi-Backend + Completions (1 week)

- `fikra-backend-codex.tlisp` — Codex CLI adapter
- `fikra-backend-gemini.tlisp` — Gemini CLI adapter
- `fikra-backend-ollama.tlisp` — Ollama HTTP adapter using `http-request`
- Backend selector popup, mid-conversation switching
- Ghost text completions with TAB accept

**Verify:** Switch between backends mid-conversation. Ghost text accepted via TAB. Ollama completion with local model.

### Phase 3: Threads, Turns, Checkpoints & Worktrees (1-2 weeks)

- `fikra-thread.tlisp` — thread/turn state machine, checkpoint capture via `git`
- `fikra-checkpoint.tlisp` — checkpoint views, diff buffers, revert
- `fikra-worktree.tlisp` — worktree isolation: create, handoff, snapshot, cleanup
- `fikra-safety.tlisp` — runtime modes, per-action confirmations
- Git checkpoint capture: baseline before turn, completion after turn
- Worktree isolation: Local/Worktree thread modes with Handoff between them
- Disposable worktrees: auto-created per thread, auto-cleaned up, snapshot+restore on removal
- `*Fikra-Diff*` buffer for reviewing per-turn changes
- `*Fikra-Threads*` buffer for listing/switching threads, grouped by project, showing Local/Worktree mode
- Project awareness: thread scoping by working directory, `fikra-project-*` functions
- Per-action confirmations: Allow / Reject / Always Allow prompt inline in `*Fikra*` buffer
- Per-thread action trust state: "always allow" decisions persist for the thread lifetime
- Revert: restore filesystem + truncate thread history to checkpoint

**Verify:** Create thread, send turns, review per-turn diffs in `*Fikra-Diff*`, revert a turn, handoff thread between Local and Worktree modes, run concurrent threads in separate worktrees, list threads grouped by project showing mode, switch projects, confirm/reject individual AI actions.

### Phase 4: Plan Mode + Extensibility (1 week)

- Plan mode: AI proposes plan, user approves/rejects, implementation turn follows
- `fikra-backend-pi.tlisp` — Pi agent adapter
- `fikra-register-backend` for custom backends
- `defworkflow` macro, overridable context builder
- Conversation history persistence
- Modeline integration with runtime mode indicator
- Error handling, TRT tests for all T-Lisp functions, documentation

**Verify:** Plan-mode workflow end-to-end. User-defined backend and workflow in init.tlisp.

## User Stories

User stories organized by implementation phase. Each story follows the SRS format: role, want, so-that, acceptance criteria in Given/When/Then form.

---

### Phase 0: TypeScript Prerequisites

#### US-F0.1: Subprocess Execution
**As a** T-Lisp package author
**I want** to spawn subprocesses with streaming output
**So that** I can build CLI integrations (AI backends, shell-mode, build tools) entirely in T-Lisp

**Acceptance Criteria:**
- Given a T-Lisp environment, when I evaluate `(make-process :command '("echo" "hello") :filter 'my-filter)`, then `my-filter` should be called with `"hello\n"` as output
- Given a running process, when I call `(process-write proc "input\n")`, then the input should be sent to stdin
- Given a running process, when it exits, then the sentinel function should be called with the exit code
- Given a running process, when I call `(signal proc 'SIGTERM)`, then the process should be terminated

#### US-F0.2: HTTP Requests
**As a** T-Lisp package author
**I want** to make async HTTP requests with streaming response bodies
**So that** I can integrate with REST APIs (Ollama, custom backends) entirely in T-Lisp

**Acceptance Criteria:**
- Given a running HTTP server, when I evaluate `(http-request "http://localhost:11434/api/generate" :method "POST" :body "..." :filter 'my-filter)`, then `my-filter` should be called with each response chunk
- Given an HTTP request, when the response completes, then status code and headers should be returned to T-Lisp
- Given a streaming HTTP response, when the filter function processes chunks, then each chunk should be delivered as it arrives (no buffering until completion)

---

### Phase 1: Core Mode + Chat

#### US-F1.1: Open Project Chat (Fikra Chat)
**As a** developer
**I want** to press `SPC a` and see the Fikra Chat for my project as the full-screen view
**So that** the AI conversation is my primary interface — I only see an editor when I navigate to a file

**Acceptance Criteria:**
- Given I'm in a project directory, when I press `SPC a a`, then the `*Fikra*` buffer should open full-screen as the project's main chat thread (auto-created if it doesn't exist)
- Given the `*Fikra*` buffer is full-screen, when the modeline renders, then it should show `fikra:<backend>●` with the current backend and project name
- Given Fikra Chat is open, when I press `SPC a q`, then I should return to the previous buffer (the `*Fikra*` thread is preserved, not destroyed)
- Given the project has no existing thread, when I open Fikra Chat, then a thread named "main" should be auto-created for the project directory

#### US-F1.2: Chat with AI
**As a** developer
**I want** to type a message in the full-screen Fikra Chat and get a streaming AI response
**So that** I can have a conversation with AI without an editor taking up screen space

**Acceptance Criteria:**
- Given the `*Fikra*` buffer is full-screen, when I type a message and press `RET`, then the message should appear as "You: <message>" and the AI should begin streaming a response
- Given the AI is streaming, when tokens arrive, then they should appear character-by-character in the `*Fikra*` buffer as "Claude: <text>" (no spinner-then-wall-of-text)
- Given the AI is streaming, when the modeline renders, then it should show `fikra:claude◉` (streaming indicator)
- Given the AI is streaming, when I press `C-g`, then the stream should stop immediately and the modeline should return to `●`

#### US-F1.3: Claude Code Adapter
**As a** developer
**I want** Fikra to use Claude Code CLI as the default backend
**So that** I get a production-quality AI backend with zero configuration

**Acceptance Criteria:**
- Given `claude` is on PATH, when fikra-mode activates, then the Claude adapter should be detected and set as the default backend
- Given `claude` is not on PATH, when fikra-mode activates, then the backend selector should show `claude` as unavailable (○)
- Given the Claude adapter is active, when I send a message, then it should spawn a `claude` subprocess with `--print --output-format stream-json` and stream the response

#### US-F1.4: Explain Workflow
**As a** developer
**I want** to send code to Fikra Chat and get an explanation
**So that** I can understand unfamiliar code within the chat interface

**Acceptance Criteria:**
- Given I have a file open in an editor buffer, when I press `SPC a e`, then the selected code (or entire buffer if no selection) should be sent to the project's Fikra Chat with the explain system prompt, and the `*Fikra*` buffer should become full-screen
- Given the explain workflow is running, when the AI responds, then the response should appear in `*Fikra*` with a `[explain]` label showing the file and line range
- Given the response mentions a file, when I press `RET` on the file reference, then an editor buffer for that file should open

#### US-F1.5: Context Extraction
**As a** developer
**I want** Fikra to automatically include relevant editor context (file name, language mode, selection)
**So that** the AI has enough information to give accurate responses

**Acceptance Criteria:**
- Given I'm editing `buffer.ts` in typescript-mode with lines 5-10 selected, when I send a chat message, then the context should include the file name, mode, and selected text
- Given I've overridden `fikra-build-context` in my init.tlisp, when I send a chat message, then my custom context should be used instead of the default
- Given I'm in the `*Fikra*` buffer with no editor open, when I send a message, then the context should include the project directory and any files mentioned earlier in the conversation

#### US-F1.6: File Navigation from Chat
**As a** developer
**I want** to navigate from chat to a file mentioned in an AI response
**So that** I can review or edit files without manually finding them

**Acceptance Criteria:**
- Given an AI response references `src/editor/api.ts`, when the file path appears in the chat, then it should be rendered as a navigable link
- Given a file link in the chat, when I press `RET` on it, then an editor buffer for that file should open (replacing the full-screen chat view)
- Given an editor buffer opened from chat, when I press `SPC a a`, then I should return to the full-screen Fikra Chat
- Given the AI edited a file during a turn, when the turn completes, then the affected file paths should appear as navigable links in the response

#### US-F1.7: Capture Buffer (Message Composition)
**As a** developer
**I want** to compose messages in a small popup capture buffer, not inline in the chat
**So that** the chat buffer stays read-only (conversation + streaming) while I get a proper editing surface for composing multi-line messages

**Acceptance Criteria:**
- Given the `*Fikra*` chat buffer is open, when I press `i`, then a capture buffer (`*Fikra-Capture*`) should pop up as a small overlay (~5 lines) with the hint `C-c C-c: send  C-c C-k: cancel`
- Given the capture buffer is open, when I type a multi-line message and press `C-c C-c`, then the capture buffer should close, the message should be sent as a new turn, and the chat buffer should show the streaming response
- Given the capture buffer is open, when I press `C-c C-k`, then the capture buffer should close and nothing should be sent
- Given the capture buffer is open, when I press `M-p`, then the previous message from history should be inserted into the capture buffer
- Given the AI is streaming a response, when the capture buffer is not open, then I should not be able to accidentally type into the chat buffer (it is read-only)

---

### Phase 2: Multi-Backend + Completions

#### US-F2.1: Switch Backends Mid-Conversation
**As a** developer
**I want** to switch AI backends without losing the conversation
**So that** I can ask Claude to code, then ask Gemini to review it, then ask Codex to synthesize

**Acceptance Criteria:**
- Given I'm chatting with Claude, when I press `C-c b` and select Gemini, then the next message should be sent to Gemini with the full conversation history
- Given I switch backends, when the backend responds, then the response label should show the new backend name (e.g., "Gemini:")
- Given a backend is unavailable, when I try to select it, then the selector should show it as ○ and prevent selection

#### US-F2.2: Ollama Local Backend
**As a** developer who prefers local models
**I want** to use Ollama as a backend via HTTP
**So that** I can use AI without sending code to external services

**Acceptance Criteria:**
- Given Ollama is running on `localhost:11434`, when fikra-mode activates, then the Ollama adapter should be detected and available
- Given the Ollama adapter is selected, when I send a message, then it should make an HTTP POST to `/api/chat` and stream the response
- Given Ollama is not running, when fikra-mode activates, then the Ollama adapter should show as unavailable (○)

#### US-F2.3: Inline Completions (Ghost Text)
**As a** developer
**I want** to press `SPC a i` in an editor buffer and see a dimmed code suggestion at my cursor
**So that** I can accept or dismiss AI completions inline without switching to the chat

**Acceptance Criteria:**
- Given I'm editing a file buffer opened from Fikra Chat, when I press `SPC a i`, then ghost text should appear as dimmed characters after the cursor within 2 seconds
- Given ghost text is showing, when I press `TAB`, then the ghost text should be inserted as real text
- Given ghost text is showing, when I press any key other than `TAB`, then the ghost text should disappear
- Given ghost text was dismissed, when I continue typing, then no new ghost text should appear until I request it again

---

### Phase 3: Threads, Turns, Checkpoints & Worktrees

#### US-F3.1: Project Chat and Additional Threads
**As a** developer
**I want** each project to have a main Fikra Chat (auto-created), with the option to spawn additional threads for parallel tasks
**So that** the primary flow is seamless (one chat per project) while power users can parallelize

**Acceptance Criteria:**
- Given I open a project directory for the first time, when I press `SPC a a`, then a "main" thread should be auto-created for the project and the `*Fikra*` buffer should open full-screen
- Given the project already has a main thread, when I press `SPC a a`, then the existing `*Fikra*` buffer should open full-screen with its conversation history
- Given the project's main chat is open, when I press `SPC a t`, then a new additional thread should be created with a generated name (e.g., "fix-11")
- Given multiple threads exist, when I press `SPC a T`, then the `*Fikra-Threads*` buffer should list all threads grouped by project with name, backend, mode, location, status, and turn count
- Given the thread list is open, when I navigate to a thread and press `RET`, then I should switch to that thread's chat buffer full-screen

#### US-F3.2: Git Checkpoint per Turn
**As a** developer
**I want** every AI turn to create a git checkpoint
**So that** I can review and revert any AI change without losing work

**Acceptance Criteria:**
- Given a thread in Local mode, when I send a turn, then a baseline checkpoint should be captured before the AI starts and a completion checkpoint after it finishes
- Given a turn has completed, when I press `SPC a d`, then the `*Fikra-Diff*` buffer should show the diff between the baseline and completion checkpoints with file stats
- Given a turn's diff is showing, when I press `n`, then the filesystem should revert to the baseline checkpoint and the turn should be marked as reverted
- Given a turn's diff is showing, when I press `y`, then the checkpoint should be kept and the next turn should proceed from this state
- Given a thread with 5 turns, when I press `SPC a D`, then the diff should show cumulative changes from thread creation to the latest checkpoint

#### US-F3.3: Revert to Any Prior Turn
**As a** developer
**I want** to revert to any previous turn's checkpoint
**So that** I can undo a chain of bad AI changes

**Acceptance Criteria:**
- Given a thread with turns 1-5, when I press `SPC a R` and select turn 2, then the filesystem should restore to turn 2's checkpoint, turns 3-5 should be removed from the thread history, and stale checkpoint refs should be cleaned up

#### US-F3.4: Per-Action Safety Confirmations
**As a** developer
**I want** to approve or reject each AI action (file write, command run, network request)
**So that** the AI can't make changes I haven't reviewed

**Acceptance Criteria:**
- Given my thread is in `approval-required` mode, when the AI tries to write to a file, then a confirmation should appear inline: `[y] Allow  [n] Reject  [a] Always allow file writes`
- Given I press `y`, then this one action should proceed
- Given I press `a`, then all subsequent file writes in this thread should auto-proceed without confirmation
- Given I press `n`, then the AI should be told the action was rejected and should adapt its approach

#### US-F3.5: Runtime Mode Presets
**As a** developer
**I want** to set a runtime mode that configures default confirmation behavior
**So that** I can trade safety for speed based on the task

**Acceptance Criteria:**
- Given my thread is in `approval-required` mode, when the AI writes a file, then I should be asked to confirm
- Given I press `SPC a m` and select `auto-accept-edits`, when the AI writes a file, then it should auto-proceed, but commands should still require confirmation
- Given I press `SPC a m` and select `full-access`, when the AI writes files or runs commands, then both should auto-proceed, but network requests should still require confirmation
- Given any runtime mode, when a checkpoint is captured, then the checkpoint should be available for revert regardless of whether actions were confirmed or auto-accepted

#### US-F3.6: Worktree Isolation
**As a** developer
**I want** to run an AI thread in an isolated git worktree
**So that** concurrent threads don't conflict on the same branch

**Acceptance Criteria:**
- Given a thread in Local mode, when I press `SPC a w`, then an isolated git worktree should be created in `.tmax/worktrees/<thread-id>/` and the thread should switch to Worktree mode
- Given a thread in Worktree mode, when I press `SPC a w` (handoff to Local), then the worktree should be snapshotted, changes should be available in the working directory, and the worktree should be cleaned up
- Given a thread in Worktree mode, when I close the thread, then the worktree should be snapshotted and removed
- Given concurrent threads in Worktree mode, when both write to the same file, then neither should see the other's changes until handoff
- Given a thread in Worktree mode, when the thread list renders, then the Location column should show `worktree`

#### US-F3.7: Project-Aware Chat Auto-Assignment
**As a** developer
**I want** Fikra Chat to automatically belong to the project I'm working in
**So that** opening `SPC a a` always gives me the right conversation for my project

**Acceptance Criteria:**
- Given I'm working in `~/projects/tmax`, when I press `SPC a a`, then the Fikra Chat should be scoped to the "tmax" project with its own "main" thread
- Given threads exist in multiple projects, when I press `SPC a T`, then the `*Fikra-Threads*` buffer should show project headers with directory paths, each containing its threads (with "main" always present)
- Given I switch to a different project directory, when I press `SPC a a`, then a new Fikra Chat should open scoped to that project (or the existing one if I've chatted there before)

---

### Phase 4: Plan Mode + Extensibility

#### US-F4.1: Plan Mode
**As a** developer
**I want** to ask the AI to propose a plan before making changes
**So that** I can review the approach before committing to it

**Acceptance Criteria:**
- Given a thread, when I press `SPC a p`, then a plan-mode turn should start where the AI proposes a markdown plan instead of editing files
- Given a proposed plan, when I press `y`, then a new implementation turn should start referencing the plan
- Given a proposed plan, when I press `e`, then the plan should become editable in the `*Fikra*` buffer for me to modify before approval
- Given a proposed plan, when I press `n`, then the plan should be discarded and the thread should return to idle

#### US-F4.2: Custom Backend Registration
**As a** developer
**I want** to register a custom AI backend from my init.tlisp
**So that** I can use private or specialized AI services

**Acceptance Criteria:**
- Given my init.tlisp, when I evaluate `(fikra-register-backend "my-model" '((type . http) (url . "http://localhost:8080/v1/chat")))`, then the backend should appear in the backend selector
- Given my custom backend is registered, when I select it, then chat messages should be sent to the configured URL via `http-request`

#### US-F4.3: Custom Workflow Definition
**As a** developer
**I want** to define custom AI workflows with `defworkflow`
**So that** I can create specialized AI interactions for my project

**Acceptance Criteria:**
- Given my init.tlisp, when I evaluate a `defworkflow` form with `:prompt`, `:context`, and `:on-response`, then the workflow should be callable by name
- Given a custom workflow, when I invoke it, then it should extract the specified context, send it with the custom prompt, and apply the response handler

## Security Considerations

1. **No prompt injection from buffer text.** Buffer content is always sent as user messages, never as system prompts. The system prompt is T-Lisp-controlled, never influenced by file content.

2. **API keys in environment variables only.** API keys live in environment variables (e.g., `ANTHROPIC_API_KEY`) or backend-specific config files, not in T-Lisp code. The `make-process` and `http-request` primitives pass through environment without exposing it to T-Lisp evaluation.

3. **Backend subprocess isolation.** CLI adapters spawn subprocesses via `make-process`. They can't access tmax internals — they receive stdin and return stdout, filtered through T-Lisp.

4. **Ghost text is inert.** Completions are plain text overlays until the user explicitly accepts them. No automatic code execution.

5. **Opt-in telemetry.** No data is sent anywhere the user didn't configure. Fikra doesn't phone home.

6. **Two-level safety.** Per-action confirmations (Allow/Reject/Always Allow) prevent bad actions in real time. Git checkpoints provide a revert safety net for anything that slips through. Even in `full-access` mode, every change is captured in a checkpoint.

## Alternatives Considered

### Distribute as Loom package from day one
Deferred. Fikra is useful immediately; Loom doesn't exist yet. Because Fikra is pure T-Lisp, extraction to a Loom package is trivial — the files already follow Loom conventions. The built-in version is structured for clean extraction from `src/tlisp/core/fikra/`.

### Workspace → Task decomposition model
Rejected after studying t3code's architecture. Real AI coding tools use thread/turn models where the conversation is the unit of work, not decomposed tasks. The "AI breaks goal into subtasks" model is project management, not agent interaction. Threads and turns match how backends (Claude Code, Codex CLI) actually work — each already has its own conversation loop with tool use and streaming. Checkpoints provide per-turn accountability without the overhead of a task scheduler. Plan mode gives the "think first, then do" benefit without a formal task decomposition system.

### Checkpoint-only safety (t3code model) or action-only safety (zcode model)
Neither alone is sufficient. Checkpoints without action confirmations mean the AI can make many unwanted changes before you catch them in review. Action confirmations without checkpoints mean once you approve a bad action, there's no clean undo. Fikra combines both: action-level confirmations prevent bad actions in real time, and checkpoint-level revert provides a safety net when something slips through.

### Build a SaaS AI product (subscription model)
The gap analysis concluded this is 4-6 months of mostly generic work. Fikra ships faster by reusing CLI tools as backends rather than building API integrations, billing, and accounts from scratch. The SaaS model can be layered on later if warranted.

### Single-backend (Claude only)
Rejected. Users have different AI preferences and some run local models. Multi-backend costs little extra — the adapter interface abstracts the differences.

### API-only (no CLI backends)
Rejected. Claude Code, Codex, and Gemini all ship excellent CLIs that handle prompt engineering, tool use, and context management. Reimplementing all of that via raw API calls would be months of work for a worse result. The CLI adapters get 90% of the functionality for 10% of the effort.

### Emacs gptel-style (Elisp plugin)
That's what gptel is. Fikra differs by being a first-class mode in an editor designed for it, with a runtime that can validate and execute AI-generated code (T-Lisp eval).

## Open Questions

- Should Fikra support tool use / function calling from AI responses (e.g., the AI can directly invoke `buffer-insert`)? This would make it an agent, not just a chat. Risk: prompt injection. Mitigated by runtime modes.
- Should conversation history persist across sessions? If so, where? `~/.config/tmax/fikra-history/`?
- Should ghost text completions trigger automatically (like Copilot) or only on demand? Auto-trigger needs debouncing and a local model (Ollama) to avoid latency.
- How to handle backends that need interactive auth flows (browser-based OAuth)?
- Should Fikra work over the daemon protocol, so `tmaxclient` can relay AI requests to a daemon that holds the API connections?
- How to handle tool-call tokens in the streaming UI? Show them inline, collapsed, or hidden?

## References

- RFC-010: Loom — T-Lisp Package Manager
- ADR-0020: AI Agent Control
- RFC-002: Server/Client Architecture
- `docs/memos/ai-subscription-gap-analysis.md`
- `docs/memos/business-model-overview.md`
- Emacs `gptel` — Emacs AI integration reference
- Claude Code CLI — CLI subprocess adapter reference
- Codex CLI — CLI subprocess adapter reference
- Gemini CLI — CLI subprocess adapter reference
- t3code — Thread/turn/checkpoint architecture reference
- zcode — Project→task organization, per-action safety confirmations, multi-agent framework reference
