# Feature: `insert-file` — insert a file's contents at point

## Goals

- Add an `insert-file` command that reads another file's contents and inserts them into the **current buffer at the cursor position** (not into a new buffer) — the standard Emacs `M-x insert-file` (`C-x i`) operation.
- Reuse the existing `read-file-content` primitive (already validated for UTF-8 / binary refusal at `src/editor/api/file-ops.ts:115`) so no new filesystem read path is added.
- Make `insert-file` discoverable in `M-x` completion via a docstring, and reachable through the `SPC x i` leader binding (no `C-x i`, per SPEC-067).
- Mark the receiving buffer modified so `:w` later persists the inserted content (avoiding the silent-data-loss class of BUG-58).

## Completion Criteria (Definition of Done)

- [ ] `M-x insert-file` prompts for a path (via `completing-read` + `file-completion-table`, the same minibuffer path `find-file` uses at `find-file.tlisp:10-17`), reads that file, and inserts its full contents at the cursor in the current buffer — eval-32.
- [ ] `(insert-file "/path/to/file")` called with an explicit path does the same non-interactively (no minibuffer), returning nil on success — eval-32.
- [ ] Inserted content lands at point and pushes the cursor to the **end of the inserted text** (so repeated inserts append, and the user can immediately continue typing) — eval-32.
- [ ] After the insert, `(buffer-modified-p)` returns true for the receiving buffer (so `:w` is not a no-op) — eval-32.
- [ ] A nonexistent source file produces a clear `message` ("insert-file: no such file PATH") and leaves the buffer unchanged — eval-32.
- [ ] A binary / invalid-UTF-8 source file (for which `read-file-content` returns nil per `file-ops.ts:140-142`) is refused with a message and inserts nothing — no U+FFFD corruption — eval-32.
- [ ] `insert-file` does NOT switch buffers, change the buffer's filename, or reset the major mode — it only mutates the current buffer's text (distinct from `find-file`, which creates/switches a buffer) — eval-32.
- [ ] `insert-file` appears in `M-x` completion (docstring) and `SPC x i` is bound — eval-32.
- [ ] `bun run typecheck:src`, `bun run typecheck:test`, and `bun run typecheck` all pass.

## Description

`find-file` opens a file into its own buffer (`find-file-open` at `src/tlisp/core/commands/find-file.tlisp:23-44` creates a buffer, switches to it, sets the filename, inserts, and runs `major-mode-auto-detect`). But there is **no command to insert a file's contents into the buffer you are already editing** — a common operation for pulling in a snippet, a license header, or a generated block. This feature adds `insert-file` as a T-Lisp command layered on the existing `read-file-content` + `buffer-insert` primitives. It is a pure T-Lisp addition (no new TypeScript primitive needed — `read-file-content` and `buffer-insert` already do the work), so it lives in a new `insert.tlisp` command library.

## User Story

As a **developer composing a file in tmax**
I want **to pull another file's contents into my current buffer at the cursor without opening it as a separate buffer**
So that **I can assemble a document from pieces (insert a license header, append a generated config block, pull in a code snippet) in one keystroke instead of copy-pasting between buffers.**

## Problem Statement

The 2026-08-01 alpha audit (`alpha-audit-2026-08-01` memory) listed the missing code-editing affordances. File insertion is the file-I/O gap:

- `read-file-content` exists as a primitive (`file-ops.ts:115`) and is used by `find-file-open` (`find-file.tlisp:25`) to seed a **new** buffer — but no editor command wraps it to insert into the **current** buffer.
- There is no `insert-file` in `M-x` completion, no `C-x i` / `SPC x i` binding.
- A user wanting to merge two files today must open the second file in its own buffer, select-all, yank, switch back, paste — the very workflow `insert-file` exists to short-circuit.

So the gap is purely at the T-Lisp command layer: the primitives are present, the composing command is not.

## Solution Statement

Add `insert-file` as a T-Lisp command in a new `src/tlisp/core/commands/insert.tlisp`, composing the existing primitives (per `src/tlisp/CLAUDE.md`: when T-Lisp can compute the operation from existing primitives, no TS primitive is added):

```lisp
(defmodule editor/commands/insert
  (export insert-file insert-file-accept))

(defun insert-file (&optional path)
  "Insert the contents of PATH into the current buffer at point. Prompts via minibuffer when called without a path."
  (if path
    (insert-file-accept path)
    (completing-read
      "Insert file: "
      "file-completion-table"
      nil nil ""
      "insert-file-history"
      "insert-file-accept")))

(defun insert-file-accept (path)
  "Minibuffer accept handler / direct insert: read PATH and insert its contents at point."
  (let ((content (read-file-content path)))
    (if content
      (progn
        (buffer-insert content)
        (message (concat "Inserted " path)))
      (message (concat "insert-file: no such file (or not UTF-8): " path)))))
```

Key behaviors, derived from the primitives:
- `buffer-insert` (`buffer-ops.ts:259`) inserts at the current cursor position and leaves the cursor after the inserted text — exactly the desired landing.
- `buffer-insert` already marks the buffer modified (it routes through `setCurrentBuffer`, which re-derives the modified flag), so `:w` will not be a no-op — this is the BUG-58 lesson: any insert path mutates the live buffer and is observable through `(buffer-modified-p)`.
- `read-file-content` returns nil for a missing file (`file-ops.ts:154-156`) **and** for invalid-UTF-8/binary (`file-ops.ts:140-142`), so the `if content` guard refuses both with a single message — no new validation needed.
- No `set-buffer-filename` / `buffer-switch` / `major-mode-auto-detect` calls: this command only mutates text, distinguishing it from `find-file-open`.

**Binding:** `SPC x i` in the `SPC x` leader group (`bindings/normal.tlisp:247-252` already hosts `SPC x f`/`SPC x s`/`SPC x b`). SPEC-067 reserves `C-x` for vim decrement, so the Emacs `C-x i` binding is **not** used; the SPC leader provides the Emacs-`C-x`-compatibility surface per the comment at `normal.tlisp:247`.

## Relevant Files

Use these files to implement the feature:

- **`src/tlisp/core/commands/insert.tlisp`** *(NEW)* — the `insert-file` + `insert-file-accept` commands above, in a `(defmodule editor/commands/insert ...)`. Load it alongside the other command libraries (the loader discovers `src/tlisp/core/commands/*.tlisp`).
- **`src/tlisp/core/commands/find-file.tlisp`** — the template. `find-file` (line 6) + `find-file-accept` (line 19) + `find-file-open` (line 23) show the exact `completing-read` + `file-completion-table` + `read-file-content` pattern to mirror. `insert-file` reuses the read/minibuffer half and replaces the buffer-create/switch half with a plain `buffer-insert`.
- **`src/editor/api/file-ops.ts`** — `read-file-content` (line 115). Cited as the UTF-8-safe read primitive (returns nil on missing or binary); no change to this file.
- **`src/editor/api/buffer-ops.ts`** — `buffer-insert` (line 259), `set-buffer-filename` (line 513), `set-buffer-modified-p` (line 553). Cited to document that `insert-file` deliberately calls **only** `buffer-insert` and leaves filename/mode untouched.
- **`src/tlisp/core/bindings/normal.tlisp`** — add `(key-bind "SPC x i" "(insert-file)" "normal")` in the `SPC x` leader block (lines 247-252). No `C-x i` binding (SPEC-067).
- **`src/editor/api/documentation.ts`** — add an `insert-file` `DocumentationEntry` (matches the `buffer-save` entry style at lines 30-44).

### New Files

- `src/tlisp/core/commands/insert.tlisp`

## Implementation Plan

1. **Command** — create `insert.tlisp` with `insert-file` (+ docstring), `insert-file-accept`, mirroring `find-file.tlisp`'s minibuffer pattern but inserting into the current buffer. Verify: `bun run typecheck:src` (the command is pure T-Lisp; confirm the module loads at startup).
2. **Binding** — add `SPC x i` in the `SPC x` block of `normal.tlisp`.
3. **Document** — add the `insert-file` entry in `documentation.ts`.
4. **Test** — there is no new TS primitive, so unit testing is via the eval-32 e2e playbook + a focused integration eval asserting the modified flag and the no-such-file path.
5. **Verify** — full validation suite + eval-32 playbook.

## Test Plan

- **Assigned playbook: `eval-32`** (`tmax-use/playbooks/eval-32-insert-file.yaml`, authored separately). Key assertions:
  - Open buffer A, `M-x insert-file` (or `SPC x i`) pointing at file B → buffer A now contains A's original text followed by B's contents at the cursor; cursor lands after the inserted text.
  - `(buffer-modified-p)` is true after the insert.
  - `(insert-file "/nonexistent")` produces the "no such file" message and leaves buffer A unchanged (and still unmodified if it was unmodified before).
  - Inserting a binary file is refused with a message and inserts nothing.
  - The receiving buffer's filename and major mode are unchanged after the insert (contrast with `find-file`).
- **Integration:** the eval-32 daemon-driven playbook exercises the real minibuffer + `SPC x i` path through a live session.
- **No dedicated TS unit test** is strictly required (no new primitive), but the modified-flag assertion in eval-32 covers the BUG-58 regression class.

## M-x Discoverability

A function appears in `M-x` completion IFF it has a docstring OR a keybinding, per `command-detail-interactive-p` in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19`. `insert-file` satisfies **both**: its `(defun insert-file (&optional path) "Insert the contents of PATH ..." ...)` carries a docstring, and it is bound to `SPC x i`. So it is guaranteed to appear in `M-x` completion. The docstring is the load-bearing guarantee here (a user typing `M-x insert` should see it even before the binding is remembered), so the `defun` MUST keep its docstring.
