# Feature: In-editor `apropos` command/variable search (Tier 0)

## Feature Description
Wire the dormant `apropos` machinery into reachable T-Lisp commands and bind
them under the help prefix. The TS primitive `apropos-command` already exists
(`src/editor/editor.ts` `defineRaw`), but there is **no T-Lisp command** and no
key binding — the `:help` hint advertises "M-x apropos" that isn't reachable.
Add `apropos` (search command/function/variable **names**) and
`apropos-documentation` (full-text search of **docstring bodies**) as T-Lisp
commands writing to `*Help*`, bound to `SPC h a` / `C-h a` and `M-x`.

## Goals
- `M-x apropos` (or `SPC h a`) prompts for a pattern and lists every matching
  command/function/variable name (regex), each a jump target.
- `M-x apropos-documentation` full-text-searches docstring bodies (the "I think
  there's a command that does X" tool).
- Results render in `*Help*` and reuse the existing `documentation.ts` /
  docstring metadata.
- No new doc source required — searches the live symbol/docstring table.

## User Story
As a user, I want to find a command by fuzzy name or by what it does ("search"
→ `isearch`, "save" → `save-buffer`/`write-file`), without knowing the exact name.

## Problem Statement
tmax has `describe-function` (exact symbol) and `documentation-search` (over the
curated `documentation.ts`), but no name-or-docstring search across **all** live
symbols. Users resort to grepping source. The TS `apropos-command` primitive was
started but never surfaced.

## Solution Statement
1. Add T-Lisp `apropos` and `apropos-documentation` (likely in
   `src/tlisp/core/commands/describe.tlisp` or a new `apropos.tlisp`) backed by:
   - a TS primitive enumerating callable/variable symbols + their docstrings
     (extend `describe-ops.ts` / `editor.ts` `apropos-command`).
2. Render results into `*Help*` via the existing `describe-to-help` helper,
   one entry per match (name + first docstring line), each expandable via
   `describe-function`.
3. Bind `SPC h a` → `apropos`, `SPC h A` (or `C-h a` once it's a real prefix)
   → `apropos-documentation`; expose both via `M-x`.

## Relevant Files
- `src/editor/editor.ts` — existing `apropos-command` raw primitive (extend).
- `src/editor/api/describe-ops.ts` — symbol/docstring enumeration helpers.
- `src/editor/api/documentation.ts` — curated doc DB (consult, don't replace).
- `src/tlisp/core/commands/describe.tlisp` — `describe-to-help`, `describe-function` (reuse).
- `src/tlisp/core/bindings/normal.tlisp` — `SPC h` leader bindings.

### New Files
- Possibly `src/tlisp/core/commands/apropos.tlisp` (or extend describe.tlisp).

## Implementation Plan
### Phase 1: Symbol/docstring enumeration primitive
A TS primitive returning `(name type docstring-first-line)` triples matching a
regex, over callables + variables + (for apropos-documentation) docstring bodies.

### Phase 2: T-Lisp commands + rendering
`apropos` / `apropos-documentation` → prompt → call primitive → render `*Help*`.

### Phase 3: Bindings
`SPC h a`, `M-x apropos`, `M-x apropos-documentation`.

## Step by Step Tasks
### Task 1: Enumeration primitive
**Acceptance Criteria**:
- [ ] A primitive lists callable + variable symbols with first docstring line.
- [ ] Regex match on names (`apropos`) and on docstring bodies (`apropos-documentation`).

### Task 2: T-Lisp commands + `*Help*` rendering
**Acceptance Criteria**:
- [ ] `M-x apropos` prompts for a pattern, lists matching names in `*Help*`.
- [ ] `M-x apropos-documentation` lists matches whose docstrings contain the pattern.
- [ ] Each result row is a `describe-function`/`-variable` jump target.

### Task 3: Bindings
**Acceptance Criteria**:
- [ ] `SPC h a` → apropos; both commands reachable via `M-x`.
- [ ] `:help` hint no longer lies (apropos actually exists).

## Testing Strategy
- Unit: enumerate matches for `save` (expect save-buffer/quick-save/write-file…),
  `mode` (major-mode-*), and a docstring-body query.
- Regression: existing describe-* tests unchanged.

## Acceptance Criteria (Completion)
- [ ] `apropos` searches command/function/variable names; `apropos-documentation` searches docstrings.
- [ ] Both render to `*Help*` and are reachable via `M-x` + `SPC h a`.
- [ ] Results cover the full live symbol table (not just `documentation.ts`).
- [ ] No regression to describe-*.

## Validation Commands
- `bun run typecheck`; `bun run build`
- `bun test test/unit/apropos.test.ts` (new)
- Manual: `M-x apropos RET save RET` lists the save commands.

## Notes
- This is Tier 0 from the help landscape scan — cheapest high-value gap (the TS
  primitive half-exists). Pure name/docstring search needs no new doc source.
- Full-text search over the *prose* manual is a separate concern (SPEC-111 helpgrep).
