# Chore: e2e coverage for indent / syntax / LSP / AST commands (multi-part playbook)

## Goals

- Lock the indent, syntax-highlighting, LSP-diagnostics, AST, and code-nav
  T-Lisp/M-x command surfaces with end-to-end coverage (`eval-46`) so
  regressions in indentation rules, tokenization, diagnostics counting, AST
  parsing, and go-to-definition fail loudly in `test:tmax-use`.
- Because the surface spans five otherwise-independent modules, the playbook is
  multi-part (clearly fenced sections) but ships as ONE `eval-46` file
  (the runner discovers one YAML); if it grows too large, it may be split into
  `eval-46a`/`eval-46b` later — out of scope here.
- Capture any defect surfaced while writing assertions as a `BUG-##` spec
  referenced inline. The chore ships no new implementation, only the playbook
  (+ any trivial runner tweak a missing matcher forces).

## Completion Criteria (Definition of Done)

- [ ] Playbook `eval-46` exists at `tmax-use/playbooks/eval-46-indent-syntax-lsp-ast.yaml`
  and passes green via `bun run test:tmax-use` (or a scoped
  `bun tmax-use/test/cli.ts playbooks/eval-46-indent-syntax-lsp-ast.yaml`).
- [ ] `(indent-set-rules '("{") '("}"))` then `(indent-get-rules)` round-trips
  the rules — eval-46. And `(indent-calculate-column 2 '("{") '("}"))` on a
  buffer where the previous line is `function f() {` returns `>= tabSize`
  (`result_contains` of the tabSize, default 2) — eval-46.
- [ ] `(indent-apply-region 0 3)` returns without error after rules are set
  — eval-46 (the op is currently a column *calculator* loop, see Relevant
  Files; assert it does not error and returns nil).
- [ ] `(syntax-set-language "typescript")` then `(syntax-get-language)` reflects
  it; `(syntax-highlight-toggle)` flips `highlightEnabled` and returns the new
  boolean — eval-46.
- [ ] `(syntax-tokenize-line 0)` on a `.ts` fixture returns a non-empty token
  list (`result_contains` of a known keyword token type like `keyword` or a
  value like `function`) — eval-46. `syntax-apply-highlights` with a sample
  span list returns nil (placeholder wiring) — eval-46.
- [ ] `(lsp-diagnostics-list)` returns a list (possibly empty initially);
  `(lsp-diagnostics-count)` returns an alist containing `("total" . N)`;
  `(lsp-diagnostics-clear)` returns `t` and a following `lsp-diagnostics-count`
  shows total 0 — eval-46. (Diagnostics are seeded via the JSON-RPC layer in
  setup, or the assertion tolerates an initially-empty set; see Implementation
  Plan.)
- [ ] `(ast-parse-buffer "typescript")` returns a string containing `ast:`;
  `(ast-count-nodes)` returns a number `> 0` for a real `.ts` fixture — eval-46.
- [ ] With cursor inside a function body, `(ast-enclosing-function)` returns a
  hashmap with `kind` containing `function` (or the parser's function kind) —
  eval-46. And `(ast-node-at-cursor)` returns a non-nil hashmap with a `kind`
  field — eval-46.
- [ ] `(go-to-definition)` on a cursor over a locally-defined symbol moves the
  cursor to its definition line (assert via `cursor_line` change) OR returns
  nil/sets a status message when no AST is present — eval-46 (assert the
  no-AST path sets the documented `"No AST — run ast-parse-buffer first"`
  status message, and the with-AST path on a `(defun ...)`-style fixture moves
  the cursor).
- [ ] `(document-symbols)` after `ast-parse-buffer` returns a non-empty list
  whose entries contain a known top-level symbol name — eval-46.
- [ ] `(find-references "fixtureFn")` returns a list including at least the
  definition site — eval-46.
- [ ] Any defect uncovered is filed as `BUG-##` and listed here (write
  `None found.` if the surface is clean). Given this is the largest surface in
  the cluster, expect at least one defect in the placeholder paths
  (`indent-apply-region`, `syntax-apply-highlights`).
- [ ] `bun run typecheck:src` and `bun run typecheck:test` unchanged.

## Description

Five editor-API modules — indent (`indent-ops.ts`), syntax highlighting
(`syntax-ops.ts`), LSP diagnostics (`lsp-diagnostics.ts`), AST structural
editing (`ast-ops.ts`), and code navigation (`navigation-ops.ts`) — ship a
large T-Lisp primitive surface that is **entirely uncovered** by the current
e2e playbook set (`eval-01`…`eval-21`; `eval-11` only checks a `.ts` file
*loads*). This chore adds `eval-46`, a single (sectioned) playbook that
exercises the real commands against the real daemon. It is a TEST-ONLY chore:
no feature code, no behavioral change. Where a primitive is a documented
placeholder (e.g. `syntax-apply-highlights` is wired to return nil pending
render-pipeline integration; `indent-apply-region` computes columns but does
not yet apply them), the playbook asserts the *current* contract (returns nil
/ no error) and a `TODO(BUG-##)` note flags the gap so a future feature spec
can flip the assertion.

## User Story

As a **tmax maintainer about to ship indentation, syntax, and structural
editing improvements** I want **a green e2e playbook covering every indent /
syntax / LSP / AST / navigation primitive** So that **a regression in
indent-rule storage, tokenization, diagnostic counting, AST caching, or
go-to-definition is caught in `test:tmax-use` before it lands, and the known
placeholder paths are pinned so we notice when they finally get implemented.**

## Problem Statement

Per the prior alpha audit (`alpha-audit-2026-08-01` in user memory), the
indent/syntax/LSP/AST/nav command surface is implemented at the T-Lisp/M-x
layer but has **no e2e coverage**. The existing `eval-11` playbook asserts
only that keyword substrings survive loading a `.ts` file — it never calls
`syntax-tokenize-line`, `indent-calculate-column`, `ast-parse-buffer`,
`go-to-definition`, or `lsp-diagnostics-count`. Worse, two of these primitives
are documented placeholders (`syntax-apply-highlights` returns nil pending
render wiring per `syntax-ops.ts:198-208`; `indent-apply-region` loops
calling `indent-calculate-column` but does not yet write the column back per
`indent-ops.ts:368-378`), so a future implementer has no pinned contract to
flip. This chore closes that blind spot and turns the placeholders into
assertable checkpoints.

## Solution Statement

Write one e2e playbook `eval-46` (this is a chore, so "solution" = "write the
playbook + wire it into the runner"). The runner at
`tmax-use/test/runner.ts:737` (`discoverTargets`) auto-discovers every
`*.yaml` under `tmax-use/playbooks/`, so wiring is just authoring the file.
The playbook is organized into five fenced sections (indent / syntax / lsp /
ast / nav) with a comment banner per section so it is easy to follow and easy
to split later. Use `.ts` fixtures (the TypeScript parser is registered — see
Relevant Files) so `ast-parse-buffer "typescript"` succeeds and the
navigation/symbol queries have real data to return. Diagnostics are read-only
from the model; the playbook asserts the count alist shape and the
clear→count-zero round-trip rather than depending on a live language server.
Read-after-write round-trips and `result_contains` on returned alists/lists
are the primary assertion shapes; `cursor_line` is used for `go-to-definition`.

## Relevant Files

Read these before designing assertions (paths are real, verified):

- **`src/editor/api/indent-ops.ts`** — indent surface.
  - `indent-calculate-column` (line 90): `(line increase-patterns
    decrease-patterns)`; gets previous non-blank line's indent; for each
    increase pattern that the previous line matches, adds `tabSize`; for each
    decrease pattern the current line matches, subtracts `tabSize`; clamps to
    0. Returns the number. Invalid regex → `FormatError`.
  - `indent-set-rules` / `indent-get-rules` (lines 216/253): stored per-buffer
    in a `WeakMap` keyed by buffer reference; `get` returns `(increase
    decrease)` or nil.
  - `indent-apply-line` (line 283): `(line)` → delegates to calculate-column
    with stored rules; errors if no rules.
  - `indent-apply-region` (line 329): `(start end)` → loops calculate-column
    per line; **does not yet write the column back** (comment at line 374);
    returns nil. Assert "no error + nil".
- **`src/editor/api/syntax-ops.ts`** — syntax surface (SPEC-035).
  - `syntax-set-language` (line 58): lowercases and validates against
    `languageMap`; unknown → `ConstraintViolation` listing available langs.
  - `syntax-get-language` (line 89).
  - `syntax-highlight-enable` / `-disable` / `-toggle` (lines 102/116/130);
    toggle returns the new boolean.
  - `syntax-tokenize-line` (line 145): `(line)` → list of
    `(type value line startCol endCol)`; requires a language set, else
    `ConstraintViolation`.
  - `syntax-highlight-line` (line 229): `(line)` → list of
    `(start end style-alist)` spans.
  - `syntax-apply-highlights` (line 200): **placeholder, returns nil** — pin
    this contract.
  - `syntax-clear-highlights` (line 214): clears `storedSpans`.
  - `src/syntax/language-registry.ts` (`languageMap`) — the available language
    names (used to pick a valid one for `syntax-set-language`).
- **`src/editor/api/lsp-diagnostics.ts`** — LSP diagnostics surface.
  - `lsp-diagnostics-list` (line 36): list of diagnostic alists (range,
    severity, message, optional source/code).
  - `lsp-diagnostics-for-line` (line 39) / `-current-line` (line 46).
  - `lsp-diagnostics-count` (line 50): alist `(("errors" . n) ("warnings" . n)
    ("info" . n) ("hints" . n) ("total" . n))`.
  - `lsp-diagnostics-clear` (line 53): clears the model field, returns `t`.
  - `lsp-diagnostics-has-errors` (line 59).
  - Diagnostics live on `EditorModel.lspDiagnostics` (read/written via the
    State monad); the playbook cannot seed them via T-Lisp, so assert the
    shape + clear→zero round-trip on whatever the model holds.
- **`src/editor/api/ast-ops.ts`** — AST structural surface.
  - `ast-parse-buffer` (line 63): `(lang?)` → parses via the registered parser
    (see registry below), caches per buffer by source hash; returns
    `ast:<name>` (or `cached-ast:<name>` on cache hit).
  - `ast-node-at-cursor` (line 117): hashmap `kind/startLine/.../childCount`
    or nil if no cache.
  - `ast-enclosing-function` (line 191) / `ast-enclosing-block` (line 215).
  - `ast-goto-node` (line 398): `(offset)` → hashmap `line/column` (does NOT
    move the cursor itself; returns the position).
  - `ast-count-nodes` (line 476) / `ast-root-kinds` (line 461).
  - `ast-invalidate` (line 424) — call after edits to drop the cache.
  - Note: every AST op returns nil if no cached AST exists — so
    `ast-parse-buffer` MUST run first in the AST section.
- **`src/editor/api/navigation-ops.ts`** — code navigation surface (this is
  where `go-to-definition` / `find-references` / `document-symbols` actually
  live — NOT in `lsp-diagnostics.ts`).
  - `go-to-definition` (line 57): if no AST → sets status `"No AST — run
    ast-parse-buffer first"` and returns nil; else looks up the symbol, moves
    the cursor via `gotoPosition`, returns the symbol name.
  - `find-references` (line 87): `(name?)` → list of `line/column/endLine/endColumn`
    hashmaps; no-AST → status message + nil.
  - `document-symbols` (line 133): list of `name/kind/line/column` hashmaps.
  - `symbol-at-cursor` (line 157) / `symbols-in-scope` (line 192) /
    `scope-at-cursor` (line 224).
- **`src/syntax/ast/registry.ts`** — confirms which languages have parsers +
  scope builders: `tlisp`, `typescript` (`.ts/.tsx/.js/.jsx`), `python`, `c`,
  `go` (registry.ts:69-73). Use `typescript` for the fixture so
  `ast-parse-buffer "typescript"` and language auto-detection both work.
- **`src/editor/runtime/caches.ts`** — the per-editor AST/parse caches that
  `ast-ops` and `navigation-ops` read from (`deps.caches.ast`).
- **`tmax-use/test/runner.ts:737`** — `discoverTargets` auto-discovers
  `*.yaml` in `tmax-use/playbooks/`.
- **`tmax-use/playbooks/README.md`** — playbook schema + the backslash lint
  guard (avoid `\` in `eval`; regex patterns with backslashes must use `keys`
  or be re-expressed — relevant because indent rules and regex patterns often
  contain backslashes).
- **`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`** —
  `command-detail-interactive-p`: a function shows in M-x IFF it has a
  docstring OR a keybinding. All primitives under test are present regardless;
  the rule only matters if the playbook introduces a T-Lisp wrapper.

### New Files

- **`tmax-use/playbooks/eval-46-indent-syntax-lsp-ast.yaml`** — the playbook.

## Implementation Plan

1. **Pick the fixture.** A small `.ts` file with a function definition, a
   reference to it, and nested braces — e.g.:
   ```ts
   function fixtureFn(x: number): number {
     if (x > 0) {
       return x;
     }
     return 0;
   }
   fixtureFn(1);
   ```
   This single fixture feeds the indent (braces), syntax (keywords), AST
   (function/if/return nodes), and nav (definition + reference) sections.
2. **Indent section.** `(indent-set-rules (list "{") (list "}"))` →
   `(indent-get-rules)` round-trip; `(indent-calculate-column 2 (list "{")
   (list "}"))` on the fixture (line 2 is `if (x > 0) {`, previous non-blank
   is `function fixtureFn... {`) → expect a number `>= tabSize`. Then
   `(indent-apply-region 0 4)` → assert nil + no error. Avoid backslashes in
   `eval` (the patterns `{` and `}` do not need them).
3. **Syntax section.** `(syntax-set-language "typescript")` →
   `(syntax-get-language)`; `(syntax-highlight-toggle)` (assert boolean
   round-trip); `(syntax-tokenize-line 0)` → `result_contains: function`;
   `(syntax-apply-highlights (list (list 0 7 (list (list "fg" "blue")))))` →
   `result_contains: nil` (pin placeholder).
4. **LSP section.** `(lsp-diagnostics-count)` → `result_contains: total`;
   `(lsp-diagnostics-clear)` → `result_contains: t`; re-run count →
   `result_contains: ("total" . 0)` shape. If the model starts empty, the
   clear→0 assertion is the meaningful one.
5. **AST section.** `(ast-parse-buffer "typescript")` →
   `result_contains: ast:`; `(ast-count-nodes)` → a number `> 0`; place cursor
   inside the function body (use `setup_cursor` or a `cursor-move`), then
   `(ast-enclosing-function)` → `result_contains: function` (or the parser's
   function-kind symbol); `(ast-node-at-cursor)` → non-nil hashmap.
6. **Nav section.** With the AST cached, place cursor on `fixtureFn` at the
   *call site* (last line), then `(go-to-definition)` → assert `cursor_line`
   moved to the definition line (line 1) OR `result_contains: fixtureFn`.
   Then `(find-references "fixtureFn")` → `result_contains: fixtureFn` is not
   the right shape (it returns position hashmaps, not names); assert the list
   is non-empty via `(length (find-references "fixtureFn"))` →
   `result_contains` of a positive number. Then `(document-symbols)` →
   `result_contains: fixtureFn`.
7. **Iterate to green.** Run scoped: `bun tmax-use/test/cli.ts
   playbooks/eval-46-indent-syntax-lsp-ast.yaml`.
8. **File defects.** Expect the placeholder paths to be the likely defect
   sources. For each gap, file `BUG-##`, soften the assertion to the current
   contract, add `# TODO(BUG-##)` in the YAML, list the BUG above.

## Test Plan

- **Primary:** `tmax-use/playbooks/eval-46-indent-syntax-lsp-ast.yaml`.
  Section-by-section key assertions are enumerated in the Completion Criteria
  and Implementation Plan above.
- **Regression:** `eval-11` (syntax file-load) and `eval-07` (long-file
  scrolling) must remain green — both share the syntax/viewport code paths.
- **Edge cases to pin:**
  - Calling `ast-node-at-cursor` BEFORE `ast-parse-buffer` → returns nil (no
    crash). Assert this explicitly — it is the most common user mistake.
  - Calling `go-to-definition` with no AST → status message
    `"No AST — run ast-parse-buffer first"`. Assert via `status_message`.
  - `syntax-tokenize-line` with no language set →
    `ConstraintViolation`/error result. Assert the error is observable
    (the playbook's `eval` surfaces errors as the result string).
- **No unit tests are added or changed.**

## M-x Discoverability

All commands under test are TypeScript primitives registered by
`createIndentOps` / `createSyntaxOps` / `createLSPDiagnosticsOps` /
`createAstOps` / `createNavigationOps`; primitives are always callable. Per
`command-detail-interactive-p` in
`src/tlisp/core/commands/execute-extended-command.tlisp:15-19`, a function
appears in **M-x completion** IFF it has a docstring OR a keybinding. The
chore adds no new commands and no bindings, so M-x visibility is unchanged.
No SPEC-067 concern: no `C-x <key>` bindings are proposed (C-x is the vim
decrement prefix per SPEC-067, not an Emacs-style prefix). If a future feature
wants keybindings for indent/syntax/nav, it must use SPC-led or Meta bindings
and is out of scope here.
