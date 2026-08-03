# Feature: `eval-expression` (M-:) — evaluate a T-Lisp form from the minibuffer

## Goals

- Add an interactive `M-:` (`eval-expression`) command that prompts for a single T-Lisp form in the minibuffer, evaluates it in the live editor interpreter, and echoes the printed result to the `*Messages*` buffer.
- Reuse the existing minibuffer string-collection path (`read-from-minibuffer`) so the new command gets history, cancellation, and editing for free — no new input state machine.
- Surface the result (or error) through the existing `*Messages*` log channel so the user can inspect a non-string return value (e.g. a list or hashmap) the same way they inspect `:marks` output.
- Bind the command to `M-:` (Meta-colon) and expose it through M-x so it is discoverable per the project's interactive-command rule.

## Completion Criteria (Definition of Done)

- [ ] `M-:` opens the minibuffer with the prompt `Eval: `; typing `(+ 1 2)` and pressing `Enter` evaluates it and appends a line like `=> 3` to the `*Messages*` buffer, and the status line shows the result — eval-26.
- [ ] `M-:` evaluating a non-trivial form (`(buffer-list)`, `(hashmap "a" 1)`) echoes a readable rendering of the result to `*Messages*` (not just numbers) — eval-26.
- [ ] A T-Lisp error in the entered form (e.g. `(car)` or `(+ 1 "x")`) is caught: the error message is written to `*Messages*` at error level, the editor does not crash, and the user returns to normal mode — eval-26.
- [ ] `C-g` / `Escape` in the minibuffer cancels `M-:` (calls no eval, restores prior mode) exactly like cancelling M-x — eval-26.
- [ ] Typed forms are remembered: invoking `M-:` a second time lets `M-p` / `M-n` (the existing minibuffer history keys) recall the previous form, because the command adds to a dedicated `eval-expression-history` — eval-26.
- [ ] `eval-expression` is reachable two ways: the `M-:` key binding in normal mode, AND by name through M-x completion (it appears in the M-x candidate list because it has a docstring) — eval-26.
- [ ] The eval runs in the **same** interpreter the daemon `eval` RPC uses (the live `Editor` interpreter via the existing `executeCommand`/`interpreter.execute` path), so a form that mutates editor state — e.g. `(set-buffer-filename "/tmp/x")` — actually changes state observable by the next `M-x` / `:w`.
- [ ] `bun run typecheck`, `bun run build`, and the targeted unit + eval-26 tmax-use e2e all pass with no regressions.

## Description

`tmax -e '(+ 1 2)'` (the CLI) and the daemon `eval` JSON-RPC method both prove that arbitrary T-Lisp can be evaluated against the live editor. But once you are **inside** the editor, there is no equivalent of Emacs' `M-:` — the only in-editor ways to run T-Lisp are (a) M-x, which only invokes a *named* command, or (b) editing `~/.config/tmax/init.tlisp`. There is no ad-hoc REPL surface.

This feature adds `eval-expression` (bound to `M-:`) that opens the minibuffer with a plain-string read (no completion table, free input), evaluates the entered form with the same interpreter the rest of the editor uses, and echoes the result to `*Messages*`. It is tmax's headline extensibility story made interactive: inspect `(buffer-text)`, prototype a `(defun ...)` before committing it to the config, or call a primitive that has no key binding.

## User Story

**As a** tmax user (or someone writing a T-Lisp extension)
**I want** to press `M-:`, type a T-Lisp form, and see its result without leaving the editor or writing it to a config file
**So that** I can explore the editor API, prototype customizations, and invoke unbound primitives interactively — the same way `tmax -e` works, but from inside a running session.

## Problem Statement

The 2026-08-01 alpha audit named T-Lisp as tmax's headline extensibility story, yet the in-editor evaluation surface is incomplete: `M-:` does not exist. The only T-Lisp entry points are:

- **CLI only**: `tmax -e '<form>'` (shells out to the daemon `eval` RPC via `bin/tmax` / `bin/tmaxclient`). Not available from inside an editing session.
- **M-x** (`SPC ;` → `execute-extended-command`): invokes a *named* command only (`invoke-command` at `src/editor/editor.ts:1155`); it cannot evaluate an arbitrary literal form like `(+ 1 2)` or `(buffer-text)`.
- **`init.tlisp`**: requires editing a file and restarting.

So there is no ad-hoc, in-editor REPL surface. The minibuffer machinery to support one already exists (`read-from-minibuffer` at `src/tlisp/core/completion/minibuffer.tlisp:116`), and the eval engine is the same `TLispInterpreter` the daemon `eval` handler drives (`interpreter.execute(code)` at `src/server/rpc/handlers/editing.ts:151-154`). The gap is purely the absence of the command that wires the minibuffer to the interpreter.

## Solution Statement

Implement `eval-expression` as a T-Lisp command in a new `src/tlisp/core/commands/eval.tlisp` module that mirrors the established `execute-extended-command.tlisp` shape:

1. **Read** the form with `read-from-minibuffer` (`minibuffer.tlisp:116`), which already sets mode `mx`, focuses the command line, stores a serializable session, and hands the accepted string to an `accept-function`. Use a dedicated history key `"eval-expression-history"` (the existing `minibuffer-history-add-to` at `minibuffer.tlisp:16` keys histories by name, and `M-p`/`M-n` recall them).
2. **Evaluate** the accepted string with a new thin native primitive `editor-eval-tlisp` (registered alongside the other editor raw primitives in `src/editor/editor.ts`, near `invoke-command` at `editor.ts:1155`). It takes one string argument, calls `this.executeCommand(expr)` (which already routes through `interpreter.execute` and renders eval errors via the diagnostic path at `editor.ts:1860-1899`), and returns a structured result: a hashmap `{ ok: boolean, value: <printed string>|nil, error: <message>|nil }`. Printing the value reuses the same `valueToString` rendering the daemon uses (so `(hashmap "a" 1)` is readable, not `[object Object]`). Returning a hashmap — rather than throwing — lets the T-Lisp accept function branch cleanly on success vs error without a try/catch.
3. **Echo** the result: on success, `(log-message :info (concat "=> " value))`; on error, `(log-message :error error)`. `log-message` is the existing `*Messages*` primitive (used at `execute-extended-command.tlisp:36`). Also set the status line to the same short result so a quick `(+ 1 2)` shows `=> 3` inline.
4. **Bind** `M-:` in normal mode (`src/tlisp/core/bindings/normal.tlisp`, alongside the existing `M-y` at line 201) to `(eval-expression)`. Add a docstring so `command-detail-interactive-p` (`execute-extended-command.tlisp:15-19`) admits it to the M-x candidate list. Provide `"eval.tlisp"`.

The command is deliberately a thin T-Lisp wrapper over one new TS primitive, following the `src/tlisp/CLAUDE.md` rule: TypeScript provides the raw "evaluate this string" primitive; T-Lisp owns the minibuffer flow, history, and result formatting.

## Relevant Files

Read these files before implementing — paths and line citations are accurate as of this spec.

- **`src/tlisp/core/commands/execute-extended-command.tlisp`** — the template to mirror: `completing-read` + an `*-accept` callback + a docstring. Note line 15-19 (`command-detail-interactive-p`) is the discoverability gate the new command must satisfy, and line 36 (`(log-message :debug ...)`) confirms `log-message` is the result channel.
- **`src/tlisp/core/completion/minibuffer.tlisp`** — `read-from-minibuffer` (line 116-118) is the exact entry point; `minibuffer-accept` (line 201-214) calls the `accept-function` with the raw input string and `minibuffer-history-add-to` keys history by name (line 16-19). `minibuffer-cancel` (line 197) handles `C-g`/`Escape` — free.
- **`src/editor/editor.ts`** — `invoke-command` raw primitive (line 1155-1170) and `executeCommand` (line 1860-1900) are the model for the new `editor-eval-tlisp` primitive; `executeCommand` already routes eval errors through `logMessage`/diagnostic rendering (line 1873-1878). `defineRaw(...)` is how raw primitives are registered (used throughout, e.g. line 1113, 1155, 1172).
- **`src/editor/message-log.ts`** — the `MessageLog` ring buffer behind `*Messages*`; `log(level, text, command)` (line 35) is what `(log-message ...)` ultimately calls.
- **`src/tlisp/core/commands/messages.tlisp`** — `view-messages` (line 6) switches to `*Messages*`; the e2e playbook uses it to assert the echoed result.
- **`src/server/rpc/handlers/editing.ts`** — `evalHandler` (line 137-183) is the *reference implementation* of "evaluate a T-Lisp string and convert the result": it calls `interpreter.execute(code)` (line 152-154), checks `Either.isLeft`, and converts via `ctx.tlispValueToJson` (line 177). The new primitive reuses the same interpreter and the same Either handling, in-process.
- **`src/tlisp/core/bindings/normal.tlisp`** — where the `M-:` binding goes (existing `M-y` at line 201 is the precedent for Meta bindings in normal mode).
- **`src/editor/runtime/binding-runtime.ts`** — the fallback keymap (line 56-79) lists the must-survive bindings; no change needed, but confirm the new binding loads via the normal `loadBindingsFromFile` path.

### New Files

- **`src/tlisp/core/commands/eval.tlisp`** — the `eval-expression` command module (mirrors `execute-extended-command.tlisp`), ending in `(provide "eval")`.

## Implementation Plan

### Step 1 — Add the `editor-eval-tlisp` raw primitive

- In `src/editor/editor.ts`, near `invoke-command` (line 1155), add a `defineRaw("editor-eval-tlisp", ...)` that:
  - Validates it received exactly one `string` argument (mirror `invoke-command`'s guard at line 1156-1158).
  - Calls `this.executeCommand(expr)` (line 1860). Because `executeCommand` *throws* on `EDITOR_QUIT_SIGNAL` and *returns the Either on eval error* (it does not throw for a normal T-Lisp eval error — see line 1864-1888), branch on the return shape:
    - If the returned object is an `Either` and `Either.isLeft` (an eval error already logged by `executeCommand`), return `{ ok: false, value: nil, error: <err.message> }`.
    - Otherwise the result is an `Either.right` whose `.right` is the `TLispValue`; render it to a string with the interpreter's value printer (the same `valueToString` the daemon path uses — import/inline it) and return `{ ok: true, value: <printed>, error: nil }`.
  - Returns a `createHashmap(...)` so the T-Lisp caller can `(hashmap-get result "ok")` / `"value"` / `"error"`.
- This is the **only** TypeScript change. It follows the `src/editor/CLAUDE.md` rule: a raw primitive that answers a factual question ("what does this string evaluate to?"), with no editor-decision logic.

### Step 2 — Write the `eval.tlisp` command module

Create `src/tlisp/core/commands/eval.tlisp`:

```lisp
(defmodule editor/commands/eval
  (export eval-expression)

;; eval.tlisp --- M-: evaluate a T-Lisp form from the minibuffer.

(defun eval-expression-accept (form)
  "Evaluate FORM (a string) and echo the result to *Messages*."
  (let ((result (editor-eval-tlisp form)))
    (if (hashmap-get result "ok")
        (let ((value (hashmap-get result "value")))
          (progn
            (editor-set-status (concat "=> " value))
            (log-message :info (concat "=> " value))))
        (let ((err (hashmap-get result "error")))
          (progn
            (editor-set-status (concat "Eval error: " err))
            (log-message :error (concat "eval-expression: " err)))))))

(defun eval-expression ()
  "Read a T-Lisp form from the minibuffer (M-:) and evaluate it.
The result (or error) is echoed to *Messages*. History is kept under
`eval-expression-history`, recallable with M-p / M-n."
  (read-from-minibuffer
    "Eval: "
    ""
    "eval-expression-history"
    "eval-expression-accept"))

(key-bind "M-:" "(eval-expression)" "normal")
(provide "eval")
```

Notes for the implementer (verify against the live interpreter, do not assume):
- Confirm the exact `editor-set-status` primitive name (`(editor-set-status ...)` is used elsewhere; if the codebase uses `editor-set-status-message` instead, match it).
- Confirm `read-from-minibuffer`'s signature in `minibuffer.tlisp:116` is `(prompt initial-input history accept-function)` — it is, so the call above is in order.
- The accept function is passed as a **string name** (the existing `execute-extended-command` passes `"execute-extended-command-accept"` the same way at line 49), and `minibuffer-accept` does `(funcall accept-function value)` (line 213).

### Step 3 — Ensure the module loads

- Confirm `eval.tlisp` is picked up by the command-module loader (the same mechanism that loads `execute-extended-command.tlisp`, `messages.tlisp`, etc.). If the loader enumerates `src/tlisp/core/commands/*.tlisp`, no registration change is needed; if it has an explicit list, add `"eval.tlisp"`. Verify with `bun run start` and `M-:`.

### Step 4 — Binding + discoverability

- The `M-:` binding lives inside `eval.tlisp` (Step 2). Confirm it loads in normal mode alongside the other `key-bind` calls (the binding files are loaded by `binding-runtime.ts`).
- The docstring on `eval-expression` (Step 2) is what makes `command-detail-interactive-p` (`execute-extended-command.tlisp:15-19`) admit it to the M-x list — no extra registration needed.

### Step 5 — Tests

- Unit: in `test/unit/editor.test.ts` (or a new `test/unit/eval-expression.test.ts`), drive `editor-eval-tlisp` directly: `(+ 1 2)` → `{ ok: true, value: "3" }`; `(undefined-symbol)` → `{ ok: false, error: <non-empty> }`; wrong arg count → validation error.
- e2e: the eval-26 tmax-use playbook drives a live editor: `M-:` → `(+ 1 2)` → `Enter`, then `(view-messages)` (or read the `*Messages*` buffer) and assert `=> 3` appears; then a malformed form and assert the error is logged; then `M-p` recalls the prior form.

## Test Plan

- **Assigned playbook: eval-26.** Key assertions the playbook must encode:
  - `M-:` opens a minibuffer with prompt `Eval: `.
  - `(+ 1 2)` → `Enter` → `*Messages*` gains a line containing `=> 3`; status line shows `=> 3`.
  - `(buffer-list)` → `Enter` → `*Messages*` gains a line whose `=> ` prefix is followed by a readable list rendering (not `[object Object]`).
  - A malformed form (e.g. `(car)`) → `Enter` → `*Messages*` gains an error-level line; editor stays alive; mode returns to normal.
  - `M-:` then `C-g` (or `Escape`) → no eval, prior mode restored (mirrors M-x cancel).
  - `M-:` a second time → `M-p` recalls the previously entered form.
  - `SPC ;` (M-x) lists `eval-expression` as a candidate (discoverability).
- **Unit coverage:** `editor-eval-tlisp` primitive — success path returns `{ ok: true, value: <printed> }`; eval-error path returns `{ ok: false, error: <msg> }`; arg-count/type guard rejects non-string / multi-arg.
- **Integration:** none beyond the e2e + unit (the eval path is the same one the daemon `eval` RPC already exercises, so the wire-level integration is covered by existing `test:integration`).
- **Validation commands:** `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`, `bun run build`, `bun test test/unit/eval-expression.test.ts` (or extended `editor.test.ts`), `bun run test:tmax-use` (runs the eval-26 playbook), `bun run test:unit`.

## M-x Discoverability

A function appears in M-x completion IFF it has a docstring OR a keybinding, per `command-detail-interactive-p` in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19`. `eval-expression` satisfies **both** (it has a docstring in `eval.tlisp` and is bound to `M-:`), so it will appear in the M-x candidate list. The implementer MUST ensure the docstring is non-empty (it is, in Step 2) so discoverability holds even before the binding is considered.
