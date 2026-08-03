# ADR-0168 — Async `completing-read` state machine for multi-prompt T-Lisp commands (#82 / #81)

## Status

Accepted

## Context

Several Emacs-M× gap commands need to ask the user more than one minibuffer
question in sequence: SPEC-072 `save-some-buffers` prompts y/n for **each**
modified buffer; SPEC-071 `kill-buffer` prompts "save modified buffer?" before
killing. In tmax, `completing-read` is **asynchronous** — it switches the
editor to `mx` mode and returns immediately; the accept handler runs later on
Enter. Only the **last** live completing-read session survives, so a single
`defun` cannot `while`-loop over multiple prompts (each iteration would
overwrite the previous session). The TS command-mode handler also resets mode
to `normal` unconditionally after a dispatch returns, so an async prompt opened
synchronously from `:wa` cannot survive.

The two escape hatches are both off-limits: adding a `run-at-time` / timer
primitive (would be new TS logic) and editing the TS command-handler (the
architecture rule reserves logic for T-Lisp).

## Decision

Implement these flows as an **async state machine in T-Lisp**, not a
synchronous loop:

1. A `defun` primes a **module-level queue** (module `defvar`s hold the chain
   state — the candidate list, the originating buffer, progress — mirroring how
   `saved-modtimes` already holds cross-call state in `save.tlisp`) and opens
   the **first** prompt, then returns.
2. A dedicated **accept handler** (`save-some-accept`, `kill-buffer-save-accept`)
   processes one answer: act on it (save / discard / kill), then either open the
   **next** prompt or, when the queue is drained, restore the originating
   buffer and `(message …)` a summary.

`save-some-buffers` uses this directly. `kill-buffer` uses it for the modified
case (deferred to the accept handler); unmodified kills stay synchronous. The
synchronous `:wa` (`save-all-buffers`, no prompt) is kept separate because
vim `:wa` semantics are non-interactive and the command-handler's mode-reset
would kill an async prompt opened from `:wa` anyway.

## Consequences

- **Easier:** multi-prompt interactive flows are expressible in pure T-Lisp
  with no new TS primitive and no change to the command-handler — consistent
  with the "logic in T-Lisp" rule.
- **Easier:** the pattern is reusable (any future per-item interactive command
  — `dired`-style mark prompts, `occur` match navigation — follows the same
  prime-queue / accept-handler / restore-and-summarize shape).
- **Harder:** the flow is split across a primer `defun` + an accept handler +
  module `defvar`s, so it is less locally readable than a synchronous loop and
  requires the accept handler to be reachable by name (it is `funcall`-able).
  State lives in module `defvar`s, so concurrent flows would clobber each other
  (acceptable: the editor is single-minibuffer).
- **Harder:** testing must drive the primer AND each accept via the harness
  (the `eval-23` / `eval-22` playbooks do this), not a single eval call.
