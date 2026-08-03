# Feature: `replace-string` — standalone global replace without the query-replace loop

## Goals

- Add a `replace-string` command that performs a **non-interactive, global** find/replace in the current buffer in one shot — every match of FROM becomes TO — without entering the y/n/a/q query-replace loop.
- Reuse the existing, UTF-8/regex-safe replace primitives (`replace-find-matches`, `replace-state-init`, `replace-apply-all`, `replace-exit` in `src/editor/api/replace-ops.ts`) so no new match/replace machinery is added.
- Make `replace-string` discoverable in `M-x` via a docstring and reachable without binding (the canonical entry point is `M-x replace-string`, mirroring Emacs).
- Return the replacement count to the caller and surface it in a `message`, so the user knows how many substitutions happened.

## Completion Criteria (Definition of Done)

- [ ] `M-x replace-string` prompts for FROM then TO (two `completing-read` / minibuffer prompts), then replaces **every** match of FROM in the current buffer with TO in one step, without entering query-replace mode — eval-36.
- [ ] `(replace-string "foo" "bar")` called with both arguments non-interactively replaces all occurrences of `foo` with `bar` and returns the integer count of replacements — eval-36.
- [ ] A buffer containing `foo foo foo` after `(replace-string "foo" "bar")` reads back as `bar bar bar`, and the command reports `Replaced 3 occurrences` — eval-36.
- [ ] FROM with no matches produces the `message` "No matches found" and makes no buffer mutation (it does NOT enter query-replace mode) — eval-36.
- [ ] A regex FROM (e.g. `replace-string "f\\(o+\\)" "b\\1"`) honors the regex-to-literal translation already implemented by `translateReplacement` in `replace-ops.ts:15` (capture groups, `&`), so the existing query-replace replacement syntax works identically here — eval-36.
- [ ] After `replace-string`, `(buffer-modified-p)` is true (the buffer was mutated) and query-replace mode is NOT active (the transient replace session state is cleared via `replace-exit`) — eval-36.
- [ ] `replace-string` appears in `M-x` completion (docstring) — eval-36.
- [ ] `bun run typecheck:src`, `bun run typecheck:test`, and `bun run typecheck` all pass.

## Description

`query-replace` (`src/tlisp/core/commands/replace.tlisp:5-12`) starts an interactive y/n/a/q session: it calls `replace-state-init` then waits for the user to press `y`/`n`/`a`/`q`. The bulk-replace primitive `replace-apply-all` (`replace-ops.ts:460`) already exists, but it is only ever reached through `replace-all` (`replace.tlisp:23-26`) **after** a query-replace session is already active. There is no command that performs a straight "replace every occurrence of FROM with TO, now, no questions asked" — the standard Emacs `M-x replace-string`. This feature adds it as a T-Lisp command in the existing `replace.tlisp`, composing the same primitives `query-replace` uses but driving straight to `replace-apply-all` and cleaning up with `replace-exit`.

## User Story

As a **developer doing a bulk rename in tmax**
I want **to replace every occurrence of a string (or regex) in one shot without being prompted y/n for each match**
So that **I can rename a symbol across a file (`oldName`→`newName`) or normalize a term instantly, the way Emacs users do with `M-x replace-string`.**

## Problem Statement

The 2026-08-01 alpha audit (`alpha-audit-2026-08-01` memory) catalogued the code-editing affordance gaps. The replace gap is narrow but real:

- `replace-apply-all` exists (`replace-ops.ts:460`) and does exactly the bulk replacement wanted — but it is guarded by an "active replace session" precondition (`replace-ops.ts:466-474`) that returns a `ConstraintViolation` if no session is active. So it cannot be called directly from a clean state.
- The only command that activates a session is `query-replace` (`replace.tlisp:5`), which is interactive by design: it `message`s the y/n/a/q prompt (`replace.tlisp:11`) and waits. There is **no command** that activates the session, immediately applies all, and exits.
- `M-x replace-string` does not exist; `replace-string` does not appear in `M-x` completion.

So the gap is at the T-Lisp command layer: the bulk-replace primitive is present and tested, but no non-interactive command exposes it. The user is forced through the y/n loop even for an unambiguous global replace.

## Solution Statement

Add `replace-string` as a T-Lisp command in the **existing** `src/tlisp/core/commands/replace.tlisp` (beside `query-replace`), composing the already-tested primitives:

```lisp
(defun replace-string (find replace &optional start end)
  "Globally replace every occurrence of FIND with REPLACE in the current buffer, non-interactively (no y/n prompts). Returns the replacement count."
  (let ((matches (replace-find-matches find start end)))
    (when (null matches)
      (message "No matches found")
      (return-from replace-string 0))
    (replace-state-init find replace matches)
    (let ((count (replace-apply-all)))
      (replace-exit)
      (message (concat "Replaced " (number-to-string count) " occurrences"))
      count)))
```

Key behaviors, derived from the primitives:
- `replace-find-matches` (`replace-ops.ts:90`) accepts the same FROM (regex-then-literal fallback) + optional START/END line range as `query-replace`, so `replace-string` is a drop-in for the find half.
- `replace-state-init` (`replace-ops.ts:282`) seeds the session; `replace-apply-all` (`replace-ops.ts:460`) iterates every match applying `replaceState.replaceText` — which is TO. The replacement text honors `translateReplacement` (`replace-ops.ts:15`) for `\1`/`&` syntax, identical to query-replace.
- `replace-exit` (`replace-ops.ts:493`) clears the transient session state and returns the final count — so query-replace mode is not left dangling and the count is surfaced.
- The "no matches" branch mirrors `query-replace` (`replace.tlisp:8-10`) but returns `0` instead of leaving the session inert.

**Binding:** none added — `M-x replace-string` is the canonical entry (Emacs does not bind it by default either). The minibuffer FROM/TO prompts are added so the interactive `M-x` path works; the direct-args path `(replace-string "foo" "bar")` works for eval/playbooks.

## Relevant Files

Use these files to implement the feature:

- **`src/tlisp/core/commands/replace.tlisp`** — extend the existing module (currently exports `query-replace`/`replace-yes`/`replace-no`/`replace-all`/`replace-quit` at line 2). Add `replace-string` to the export list and define it as above, beside `query-replace` (line 5). The two share the `replace-find-matches` + "No matches" guard; `replace-string` diverges only by driving straight to `replace-apply-all` + `replace-exit`.
- **`src/editor/api/replace-ops.ts`** — the primitive layer. Cited (no change): `replace-find-matches` (line 90), `replace-state-init` (line 282), `replace-apply-all` (line 460), `replace-exit` (line 493), and `translateReplacement` (line 15) for the replacement-syntax contract. The session-state guard at line 466 is exactly why a non-interactive command must `replace-state-init` before `replace-apply-all`.
- **`src/editor/api/documentation.ts`** — add a `replace-string` `DocumentationEntry` (matches the `buffer-save` entry style at lines 30-44).
- *(optional)* **`src/tlisp/core/bindings/normal.tlisp`** — no binding added; `M-x replace-string` is the entry point. If a leader shortcut is later desired, use a `SPC` leader (e.g. `SPC x r`) rather than any `C-x` chord (SPEC-067).

### New Files

None. `replace-string` is a pure T-Lisp addition to the existing `replace.tlisp`.

## Implementation Plan

1. **Command** — add `replace-string` (+ docstring) to `replace.tlisp`, composing `replace-find-matches` → `replace-state-init` → `replace-apply-all` → `replace-exit`, with the no-matches early return. Verify the module reloads at startup: `bun run typecheck:src`.
2. **Interactive prompts (optional polish)** — if the `M-x` path should prompt for FROM/TO via `completing-read`, add an `&optional` interactive variant; otherwise the eval-36 playbook drives `(replace-string "foo" "bar")` directly, which is sufficient for the DoD. Keep the direct-args path as the primary contract.
3. **Document** — add the `replace-string` entry in `documentation.ts`.
4. **Test** — no new TS primitive, so coverage is via the eval-36 e2e playbook (count, no-matches, regex, modified-flag, session-cleared).
5. **Verify** — full validation suite + eval-36 playbook.

## Test Plan

- **Assigned playbook: `eval-36`** (`tmax-use/playbooks/eval-36-replace-string.yaml`, authored separately). Key assertions:
  - `(replace-string "foo" "bar")` on `foo foo foo` → buffer reads `bar bar bar`, command returns `3`, status shows "Replaced 3 occurrences".
  - `(buffer-modified-p)` is true after the replace.
  - No-matches case: `(replace-string "zzz" "qqq")` on an unrelated buffer → "No matches found", no mutation, returns `0`.
  - Regex case: `(replace-string "f\\(o+\\)" "b\\1")` on `foo foobar` honors capture groups per `translateReplacement`.
  - Query-replace mode is NOT active afterward (no dangling `replaceState.active`) — verified by immediately running a second `replace-string` cleanly.
  - `M-x replace-string` appears in completion.
- **Integration:** the eval-36 daemon-driven playbook exercises the command through a live session.
- **Regression note:** because `replace-string` reuses the exact `replace-apply-all` path query-replace uses, the existing query-replace tests cover the match/replace mechanics; eval-36 specifically locks the non-interactive entry + the session-cleanup behavior.

## M-x Discoverability

A function appears in `M-x` completion IFF it has a docstring OR a keybinding, per `command-detail-interactive-p` in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19`. `replace-string` is **not bound** to a key (deliberately — the canonical entry is `M-x replace-string`, as in Emacs), so it MUST carry a docstring to appear in `M-x` completion. The `defun` therefore includes the docstring `"Globally replace every occurrence of FIND with REPLACE in the current buffer, non-interactively (no y/n prompts). Returns the replacement count."` — this docstring is load-bearing for discoverability and MUST NOT be removed.
