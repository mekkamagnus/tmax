# Feature: `eval-last-sexp` / `eval-buffer` — live T-Lisp development inside tmax

## Goals

- Add `eval-last-sexp` (evaluate the T-Lisp sexp immediately before point) and `eval-buffer` (evaluate the entire buffer as a T-Lisp program), echoing each result (or error) to the `*Messages*` buffer.
- Treat any buffer as a scratch/REPL surface — no markdown fencing required — so a user can prototype `(defun ...)` / `(key-bind ...)` forms and apply them to the live editor without restarting or editing `init.tlisp`.
- Reuse the new `editor-eval-tlisp` primitive from SPEC-075 (the same interpreter path the daemon `eval` RPC uses) so the two features share one evaluation code path and one result-rendering rule.
- Bind both commands under the `SPC e` leader prefix (`SPC e e` for last-sexp, `SPC e b` for buffer) — deliberately NOT `C-x C-e`, which is unusable because `C-x` is the vim decrement prefix (SPEC-067).

## Completion Criteria (Definition of Done)

- [ ] With point after a balanced sexp such as `(+ 1 2)`, pressing `SPC e e` evaluates that sexp and appends `=> 3` to the `*Messages*` buffer; the status line shows `=> 3` — eval-27.
- [ ] `SPC e e` correctly extracts the *enclosing/preceding* top-level sexp when point is on a nested form (e.g. point after the `2` in `(foo (bar 1 2))` evaluates `(bar 1 2)`, and point after the final `)` evaluates the whole `(foo ...)`), proving the sexp-boundary scan works — eval-27.
- [ ] `SPC e e` with no balanced sexp before point reports a clear message (e.g. `No sexp before point`) to `*Messages*` and does not crash — eval-27.
- [ ] `SPC e b` evaluates the entire current buffer as a T-Lisp program and logs a summary line (e.g. `Evaluated buffer <name> (N forms)`) to `*Messages*`; side effects (a `(defun ...)` in the buffer) become live — verifiable by then running the just-defined function via M-x — eval-27.
- [ ] A T-Lisp error anywhere in the evaluated region (last-sexp or buffer) is caught and logged to `*Messages*` at error level; the editor stays alive and returns to normal mode — eval-27.
- [ ] `eval-last-sexp` and `eval-buffer` are both reachable by name through M-x completion (each has a docstring) AND via the `SPC e e` / `SPC e b` bindings — eval-27.
- [ ] Evaluation runs in the live editor interpreter (the same one `M-:` / SPEC-075 uses), so `(set-buffer-filename "/tmp/x")` in a buffer and `SPC e b` actually changes editor state.
- [ ] The bindings do NOT use `C-x` anywhere; the spec respects SPEC-067 (C-x is vim decrement). `:w`, M-x, and existing C-x decrement behavior are unaffected.
- [ ] `bun run typecheck`, `bun run build`, and the targeted unit + eval-27 tmax-use e2e all pass with no regressions.

## Description

`eval-last-sexp` and `eval-buffer` are the classic Emacs scratch-development commands: evaluate the form before point, or evaluate the whole file. tmax already has a fenced-block execution path (`markdown-execute-block` at `src/tlisp/core/commands/markdown/execution.tlisp:38`), but that is block-scoped to markdown fences and shells out to `bun`/`python3` — it is not a general T-Lisp eval and it cannot prototype editor commands. This feature adds the general T-Lisp variants that turn any buffer into a live scratchpad for editor customization.

Both commands reuse the `editor-eval-tlisp` primitive introduced by SPEC-075 (which itself wraps the same `TLispInterpreter.execute` the daemon `eval` RPC uses), so there is exactly one evaluation path in the editor. The only new logic is **sexp-boundary extraction** for `eval-last-sexp` (scanning backward for the matching open paren) and whole-buffer text retrieval for `eval-buffer`.

## User Story

**As a** tmax user writing or prototyping a T-Lisp customization
**I want** to type a `(defun ...)` or `(key-bind ...)` form in any buffer, press one key to evaluate just that form (or the whole buffer), and see the result / apply it to my live editor
**So that** I can iterate on editor extensions interactively — defining a function and immediately M-x-ing it — without restarting tmax or editing `init.tlisp`.

## Problem Statement

The 2026-08-01 alpha audit flagged the in-editor T-Lisp evaluation surface as incomplete, and SPEC-075 adds the `M-:` minibuffer path. But `M-:` requires retyping a form into the minibuffer; it cannot evaluate a form that is already in the buffer you are editing. The existing buffer-aware eval is `markdown-execute-block` (`src/tlisp/core/commands/markdown/execution.tlisp:38`), which:

- is **block-scoped** to ```` ``` ````-fenced regions (it scans for fences at `execution.tlisp:10-36`), not general T-Lisp;
- **shells out** to `bun`/`python3` (`execution.tlisp:53-60`) rather than evaluating T-Lisp in the live editor interpreter; and
- only supports `sh`/`bash`/`ts`/`tsx`/`js`/`jsx`/`py`/`python` — T-Lisp itself is not a recognized language, so a ```` ```lisp ```` block cannot be evaluated.

So there is no path to say "evaluate the form before my cursor as T-Lisp, in this editor, right now." The interpreter (`src/tlisp/parser.ts`, `src/tlisp/interpreter.ts`) and the buffer-text primitives (`buffer-text`, `buffer-line`) already exist; the gap is the two commands that wire buffer text to the interpreter.

## Solution Statement

Add `eval-last-sexp` and `eval-buffer` to the `eval.tlisp` module introduced by SPEC-075 (or a sibling `src/tlisp/core/commands/eval-buffer.tlisp` if the maintainer prefers to keep minibuffer-eval and buffer-eval separate). Both reuse SPEC-075's `editor-eval-tlisp` primitive.

### `eval-buffer`

Simple: call `(buffer-text)` (primitive at `src/editor/api/buffer-ops.ts:143`) to get the whole buffer, hand it to `editor-eval-tlisp`, and echo the result. Because the T-Lisp parser's `parseProgram` (`src/tlisp/parser.ts:84-113`) already handles multiple top-level forms, evaluating the whole buffer string evaluates every form in sequence; the result reported is the last form's value (matching `eval`-buffer semantics in Emacs). Log a summary line naming the buffer and noting success/error.

### `eval-last-sexp`

Scan **backward** from point to find the sexp immediately before it. Concretely:

1. Read the current line text with `(buffer-line)` (primitive at `src/editor/api/buffer-ops.ts:165`, which returns the line at the cursor or at an optional index) and the column with `(cursor-column)`.
2. Walk left over the chars of the current line (and, if the sexp started on an earlier line, upward) maintaining a paren-depth counter: each `)` increments depth, each `(` decrements it; the sexp starts at the `(` where depth returns to 0. This is plain T-Lisp string arithmetic over `(buffer-line N)` for the relevant line range. (If a TS `char-before`/`scan-sexp` primitive turns out to be cleaner, add ONE raw primitive following the `src/editor/CLAUDE.md` rule — character scanning is explicitly listed there as a legitimate TS primitive — but prefer the T-Lisp scan first to minimize new TS surface.)
3. Once the open-paren offset is found, slice the text from there through point and hand it to `editor-eval-tlisp`.
4. Echo the result with the same `=> <value>` / error rule as SPEC-075.

A simpler first cut restricts the scan to the **current line** (find the matching `(` to the left of point on the same line); multi-line sexps are a follow-on. The completion criteria above require the nested-but-single-line case `(foo (bar 1 2))`, which the current-line scan satisfies. Multi-line is called out in Notes as a known follow-on, not a DoD item.

### Bindings (SPEC-067 aware)

`C-x C-e` is the Emacs convention for `eval-last-sexp`, but it is **unusable in tmax**: per SPEC-067, `C-x` is bound to `vim-decrement-number` (`src/tlisp/core/bindings/normal.tlisp:224`), so a `C-x C-e` chord would never reach eval — the first `C-x` is consumed as a count/decrement. The memory note `SPEC-067 C-x reassigned` records this explicitly. Therefore:

- **`SPC e e`** → `eval-last-sexp`
- **`SPC e b`** → `eval-buffer`

Both are SPC-led, consistent with the existing `SPC x ...` family (`normal.tlisp:248-252`). No `C-x <anything>` binding is proposed.

## Relevant Files

Read these files before implementing — paths and line citations are accurate as of this spec.

- **`docs/specs/SPEC-075-eval-expression.md`** — defines `editor-eval-tlisp` (the shared eval primitive) and `eval.tlisp`. This spec adds to that module / reuses that primitive. SPEC-075 should land first (or in the same batch).
- **`src/tlisp/parser.ts`** — `parseProgram` (line 84-113) proves multi-form buffer eval already works at the parser level; `parse` (line 44) handles a single form. The new commands do NOT call the parser directly from T-Lisp — they pass the string to `editor-eval-tlisp`, which routes through `Editor.executeCommand` → `interpreter.execute` (`src/editor/editor.ts:1860-1863`). Cited to prove the capability exists.
- **`src/editor/api/buffer-ops.ts`** — `buffer-text` (line 143, whole-buffer text), `buffer-line` (line 165, line text by optional index), `buffer-line-count` (line 238). These are the primitives the T-Lisp sexp scan consumes.
- **`src/editor/api/cursor-ops.ts`** — `cursor-line` / `cursor-column` (registered generically) give the scan start position.
- **`src/tlisp/core/commands/markdown/execution.tlisp`** — `markdown-find-code-block` (line 10-36) is the **reference** for buffer-scanning logic in T-Lisp: it walks lines with `(buffer-get-line i)` (note: the live primitive is `buffer-line`; see Notes), uses `string-match` to find delimiters, and returns `(start end lang)`. The eval-last-sexp scan is structurally similar but scans leftward for parens. `markdown-execute-block` (line 38) is the reference for "evaluate something and report a result."
- **`src/editor/editor.ts`** — `editor-eval-tlisp` (added by SPEC-075, near `invoke-command` at line 1155) and `executeCommand` (line 1860-1900, the interpreter path with diagnostic rendering).
- **`src/tlisp/core/bindings/normal.tlisp`** — where the `SPC e e` / `SPC e b` bindings go. Lines 248-252 (`SPC x f/s/b/u/C-c`) are the precedent for SPC-led two-key chords; line 224 (`C-x` decrement) is the SPEC-067 constraint that rules out `C-x C-e`.
- **`src/tlisp/core/commands/messages.tlisp`** — `view-messages` (line 6) for the e2e assertion.
- **`docs/specs/SPEC-067-vim-parity-implementation.md`** — the binding-collision authority: `C-x` is decrement, full stop.

### New Files

- **`src/tlisp/core/commands/eval-buffer.tlisp`** (preferred) OR an extension of SPEC-075's `src/tlisp/core/commands/eval.tlisp`. Either is acceptable; the maintainer picks one. Ends in `(provide "eval-buffer")` (or merges into `(provide "eval")`).

## Implementation Plan

> NOTE: SPEC-075 introduces `editor-eval-tlisp`. If these two specs land together, implement SPEC-075 Step 1 first; this spec then consumes the primitive.

### Step 1 — `eval-buffer`

In the chosen module file:

```lisp
(defun eval-buffer ()
  "Evaluate the entire current buffer as a T-Lisp program.
Side effects (defun, key-bind, setq) become live in the editor.
Result or error is echoed to *Messages*."
  (let ((source (buffer-text))
        (buf (buffer-current)))
    (let ((result (editor-eval-tlisp source)))
      (if (hashmap-get result "ok")
          (progn
            (editor-set-status "=> (buffer evaluated)")
            (log-message :info (concat "eval-buffer: " buf " evaluated")))
          (let ((err (hashmap-get result "error")))
            (progn
              (editor-set-status (concat "Eval error: " err))
              (log-message :error (concat "eval-buffer (" buf "): " err))))))))
```

- Confirm `(buffer-current)` returns the buffer name string (primitive at `buffer-ops.ts:111`).
- The "last form's value" is intentionally NOT echoed as `=> <value>` for `eval-buffer` (the value is usually meaningless for a `(defun ...)` file); a summary line is clearer. The DoD requires the summary line + side-effect liveness, not the printed value.

### Step 2 — `eval-last-sexp` sexp-boundary scan (current-line first cut)

```lisp
(defun eval-last-sexp--line-prefix ()
  "Return the text on the current line up to (and including) the cursor column,
as the substring to scan leftward for an open paren. Returns \"\" if empty."
  (let ((line (buffer-line))
        (col (cursor-column)))
    (substring line 0 (+ col 1))))

(defun eval-last-sexp--find-open (text depth i)
  "Walk TEXT leftward from index I tracking paren DEPTH.
Returns the index of the open paren that opens the sexp before point,
or nil if none."
  (if (< i 0)
      (if (= depth 0) nil nil)   ; ran off the start, no enclosing sexp on this line
      (let ((ch (substring text i (+ i 1))))
        (cond
          ((string= ch ")") (eval-last-sexp--find-open text (+ depth 1) (- i 1)))
          ((string= ch "(")
             (if (= depth 0)
                 i
                 (eval-last-sexp--find-open text (- depth 1) (- i 1))))
          (t (eval-last-sexp--find-open text depth (- i 1)))))))

(defun eval-last-sexp ()
  "Evaluate the balanced sexp immediately before point (SPC e e).
Result or error is echoed to *Messages*."
  (let ((prefix (eval-last-sexp--line-prefix)))
    (let ((start (eval-last-sexp--find-open prefix 0 (- (length prefix) 1))))
      (if (not start)
          (progn
            (editor-set-status "No sexp before point")
            (log-message :warn "eval-last-sexp: no sexp before point"))
          (let ((sexp (substring prefix start (length prefix))))
            (let ((result (editor-eval-tlisp sexp)))
              (if (hashmap-get result "ok")
                  (let ((value (hashmap-get result "value")))
                    (progn
                      (editor-set-status (concat "=> " value))
                      (log-message :info (concat "=> " value))))
                  (let ((err (hashmap-get result "error")))
                    (progn
                      (editor-set-status (concat "Eval error: " err))
                      (log-message :error (concat "eval-last-sexp: " err)))))))))))
```

Notes for the implementer (verify against the live interpreter, do not assume):
- The recursive scan uses T-Lisp tail positions; confirm the interpreter's TCO handles a long line, or convert to a `(while ...)` loop with mutable `(set! i ...)` / `(set! depth ...)` (the `markdown-find-code-block` loop at `execution.tlisp:18-25` is the precedent for `while` + `set!`).
- The scan includes the cursor's own character (`(+ col 1)` in the prefix slice) so point immediately after `)` evaluates the whole form; point on the `2` in `(bar 1 2)` evaluates `(bar 1 2)` because the scan reaches the `(` before `bar` at depth 0.
- Multi-line sexps (sexp starts on an earlier line) are out of scope for this cut; see Notes.

### Step 3 — Bindings (SPEC-067 compliant)

In the module file:

```lisp
(key-bind "SPC e e" "(eval-last-sexp)" "normal")
(key-bind "SPC e b" "(eval-buffer)" "normal")
```

- These join the existing `SPC x ...` family (`normal.tlisp:248-252`). Confirm `SPC e` is not already a prefix (grep `src/tlisp/core/bindings/normal.tlisp` for `"SPC e` — it is unused as of this spec).
- Do NOT add any `C-x ...` binding. SPEC-067 (`normal.tlisp:224`) reserves `C-x` for `vim-decrement-number`.

### Step 4 — Discoverability

Both functions get docstrings (above), so `command-detail-interactive-p` (`execute-extended-command.tlisp:15-19`) admits them to M-x. The `SPC e e` / `SPC e b` bindings are a second discoverability path.

### Step 5 — Tests

- Unit: drive `editor-eval-tlisp` with a multi-form buffer string (`(defun foo () 1)(foo)`) → `{ ok: true, value: "1" }` (proves `eval-buffer` evaluates all forms and returns the last value); with an unbalanced form → `{ ok: false, error: ... }`. The sexp-scan helpers (`eval-last-sexp--find-open`) are pure T-Lisp and can be unit-tested directly: `") (+ 1 2"` from the right → finds the `(` before `+`; `") foo"` → returns nil (no enclosing sexp).
- e2e: the eval-27 tmax-use playbook drives a live editor: open a scratch buffer, type `(+ 1 2)`, leave point after the `)`, press `SPC e e`, assert `=> 3` in `*Messages*`; type `(defun my-test () 42)` on a line, press `SPC e e` then `SPC ; my-test` → M-x runs the freshly-defined function; press `SPC e b` and assert the summary line; type malformed and assert error logged.

## Test Plan

- **Assigned playbook: eval-27.** Key assertions the playbook must encode:
  - Point after `(+ 1 2)` + `SPC e e` → `*Messages*` gains `=> 3`; status shows `=> 3`.
  - Nested single-line: point inside `(foo (bar 1 2))` evaluates the inner or outer form depending on cursor position (DoD criterion 2).
  - `SPC e e` with no sexp before point → `No sexp before point` logged, no crash.
  - A buffer containing `(defun live-fn () 99)` + `SPC e b` → summary line logged; then M-x `live-fn` works (side effect is live) — DoD criterion 4.
  - Malformed region → error logged at error level; editor alive; normal mode restored.
  - `SPC ;` lists both `eval-last-sexp` and `eval-buffer`.
- **Unit coverage:** `editor-eval-tlisp` multi-form + error paths (extends SPEC-075's unit tests); the pure T-Lisp `eval-last-sexp--find-open` helper over representative inputs.
- **SPEC-067 regression:** the playbook should assert `C-x` still decrements a number (e.g. cursor on `5`, `C-x` → `4`) to prove the new bindings did not steal the `C-x` prefix.
- **Validation commands:** `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`, `bun run build`, `bun test test/unit/eval-buffer.test.ts` (or extended `editor.test.ts`), `bun run test:tmax-use` (runs the eval-27 playbook), `bun run test:unit`.

## M-x Discoverability

A function appears in M-x completion IFF it has a docstring OR a keybinding, per `command-detail-interactive-p` in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19`. Both `eval-last-sexp` and `eval-buffer` satisfy **both** (each has a docstring in Step 1/Step 2 AND is bound to `SPC e e` / `SPC e b`), so both will appear in the M-x candidate list. The implementer MUST ensure each docstring is non-empty so discoverability holds independent of the binding.

## Notes

- **SPEC-067 constraint (load-bearing).** `C-x` is `vim-decrement-number` (`src/tlisp/core/bindings/normal.tlisp:224`; memory `SPEC-067 C-x reassigned`). Any `C-x C-e` / `C-x`-prefixed binding is unreachable and MUST NOT be proposed. `SPC e e` / `SPC e b` are the chosen replacements, consistent with the existing `SPC x ...` leader family. The DoD explicitly forbids `C-x` in the new bindings and requires a regression check that `C-x` decrement still works.
- **Multi-line sexp scan is a follow-on, not DoD.** The current-line scan satisfies every DoD criterion (including the nested `(foo (bar 1 2))` case, which is single-line). Multi-line backward scan (sexp starts on an earlier line) can be added later by extending the scan to walk upward through `(buffer-line (- line 1))` until depth balances; out of scope here.
- **`markdown-execute-block` uses `(buffer-get-line i)` but the live primitive is `buffer-line`.** The markdown command's `(buffer-get-line i)` calls (`src/tlisp/core/commands/markdown/execution.tlisp:20,49`) appear to rely on a name that does not match the registered primitive (`buffer-line` at `src/editor/api/buffer-ops.ts:165`). This is a pre-existing latent inconsistency in the markdown command, NOT something this spec introduces; the implementer should use `(buffer-line i)` (the real primitive) for any line-indexed reads, and may file a separate bug for the markdown discrepancy. Do not "fix" it as part of this spec (surgical-changes rule).
- **No new TS surface beyond SPEC-075.** `eval-buffer` and the current-line `eval-last-sexp` need only `buffer-text`, `buffer-line`, `cursor-column`, and SPEC-075's `editor-eval-tlisp`. A TS `scan-sexp` primitive is explicitly NOT required for this cut (per `src/editor/CLAUDE.md`, prefer T-Lisp for logic); only fall back to a TS char-scan primitive if the T-Lisp scan proves unwieldy, and even then add exactly one primitive.
- **Result rendering.** Both commands echo through `editor-eval-tlisp`'s printed value, which reuses the same value printer as the daemon `eval` RPC — so `(hashmap ...)` and list results are readable, not `[object Object]`. This is shared with SPEC-075 and is the reason the two specs should share the primitive.
