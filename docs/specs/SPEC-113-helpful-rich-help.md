# Feature: `helpful`-style rich help layout (Tier 1.5)

## Feature Description
Upgrade the `*Help*` rendering from a plain docstring to a `helpful`-style rich
layout (the popular Emacs package `Wilfred/helpful` that supersedes built-in
`describe-*`). For a function: signature, **source location + source excerpt**,
**keybindings that invoke it**, **callers/references** (who uses it), aliases,
related, examples, and linkified cross-refs. For a variable: value, source
location, references, linkified docstring. Builds on SPEC-110 (help-mode buttons)
and reuses `documentation.ts` (examples/related).

## Goals
- `describe-function` shows: signature; docstring (first line highlighted,
  cross-refs linkified via SPEC-110); **source location (file:line) + a source
  excerpt**; **keybindings invoking the command**; **callers/references**;
  aliases; `documentation.ts` "related" + "examples".
- `describe-variable` shows: current value; source location; references;
  linkified docstring.
- A consistent section order + visual hierarchy (not the flat Emacs default).
- Cross-refs linkified (composes with SPEC-110's buttons).

## User Story
As a user, when I `describe-function save-buffer` I want one page that tells me
what it does, where its source is, which keys run it, who calls it, and a usage
example — instead of just a docstring I then have to cross-reference by hand.

## Problem Statement
tmax's `describe-*` renders the docstring (good) plus optional `documentation.ts`
entry. It lacks source location, callers/references, and the keybindings that
invoke a command — the contextual info that makes `helpful` so much more useful
than built-in help. The layout is also flat (no clear sections).

## Solution Statement
1. **Source location** — record `file:line` (and a short excerpt) for T-Lisp
   `defun`s at parse/eval time; expose via a primitive (extend `describe-ops.ts`).
2. **Reference index** — a lightweight xref over T-Lisp source + keymaps: which
   symbols reference a given symbol, and which keys bind a given command. Build
   on demand or maintain at load.
3. **Rich renderer** — `describe-*` outputs structured sections
   (`Signature / Docstring / Source / Keys / References / Related / Examples`);
   `documentation.ts` already has Related + Examples.
4. **Linkification** — cross-refs become help-mode buttons (SPEC-110).

## Relevant Files
- `src/editor/api/describe-ops.ts` — produce structured (sectioned) describe output.
- `src/editor/api/documentation.ts` — Related + Examples (already present).
- `src/tlisp/parser.ts` / `evaluator.ts` — capture `file:line` per `defun`.
- New: a reference/usage index (`src/editor/symbol-xref.ts`) — callers + key bindings.
- `src/tlisp/core/commands/describe.tlisp` — render sections into `*Help*`.

## Implementation Plan
### Phase 1: source location
Parser records `defun` source `file:line`; primitive exposes it + an excerpt.

### Phase 2: reference index
Index symbol→callers (over T-Lisp source) and command→keys (over keymaps).

### Phase 3: rich renderer + sections
describe-function/-variable emit structured sections; documentation.ts related/examples inlined.

## Step by Step Tasks
### Task 1: source location + excerpt
**Acceptance Criteria**:
- [ ] describe-function shows `file:line` + a source excerpt for any `defun`.

### Task 2: references + keybindings
**Acceptance Criteria**:
- [ ] describe-function shows which keys invoke it (for commands).
- [ ] describe-function/-variable shows referencing symbols (callers).

### Task 3: sections + examples
**Acceptance Criteria**:
- [ ] Consistent section order; documentation.ts Related + Examples inlined.
- [ ] Cross-refs linkified via help-mode (SPEC-110).

## Testing Strategy
- Unit: a `defun`'s describe output includes source loc, keys, references.
- Unit: reference index finds a caller in a fixture.

## Acceptance Criteria (Completion)
- [x] describe-function shows source location + excerpt, keybindings, callers/references, related, examples.
- [x] describe-variable shows value, source location, references.
- [x] Sectioned layout (not flat); cross-refs linkified.
- [x] No regression to existing describe-* content.

## How it was implemented
- **Source location** (`help-source-location` TS primitive, editor.ts): scans
  every loaded module's source for `(def\w* NAME` (defun/defmacro/defvar/…)
  and returns `{file, line, excerpt}`. Describe-time lookup (not captured at
  defun time) — no AST/parser changes. Works for functions AND variables.
- **References** (`help-symbol-references` TS primitive): a lightweight on-demand
  xref — the modules whose source mentions NAME as a word. Text scan, not AST
  (cheap, approximate), built from live source (never stale).
- **Key bindings**: `describe-function-data` reverses the key→command map,
  scanning each binding's command string for `(NAME` (bindings are full
  expressions like `(cursor-move …)`, not just `(name)` cells).
- **Related / Examples**: inlined from `documentation.ts` via `getDocumentation`.
- **Renderer**: `describe-function`/`-variable` emit sectioned output
  (`— Source —`, `— Key bindings —`, `— References —`, `— Related —`,
  `— Examples —`) via `help-source-section` / `help-list-section` helpers.

## Validation Commands
- `bun run typecheck`; `bun run build`
- `bun test test/unit/helpful-rich-help.test.ts`
- Manual: `SPC h f save-buffer` shows source + keys + references.

## Notes
- Composes with SPEC-110 (help-mode) for linkification and SPEC-108 (mode docs).
- The references xref is intentionally a live source scan (not a cached index)
  so it can never go stale — the tradeoff is it's approximate (text, not AST).
- TS primitives (e.g. `cursor-move`) have no `.tlisp` source, so they show Key
  bindings + References but no Source section — correct, there's no source to cite.
- Examples/Related surface only when `documentation.ts` has an entry for the
  exact function name (a pre-existing data-alignment consideration).
