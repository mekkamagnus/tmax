# Feature: `helpgrep` — full-text search over the doc corpus (Tier 1)

## Feature Description
A `:helpgrep`/`M-x helpgrep` command that full-text-searches the **prose doc
corpus** (the Texinfo manuals `docs/tmax/*.texinfo`/`.info`, the cheatsheet, and
optionally the `documentation.ts` curated entries) and shows matches in an
occur-style results buffer with jump-to-source. This complements
`apropos-documentation` (SPEC-107, which searches live docstrings): helpgrep
searches the **written manuals** — the "I read about this somewhere in the
manual" tool, Vim's `:helpgrep` analogue.

## Goals
- `M-x helpgrep <pattern>` (or `:helpgrep <pattern>`) greps the doc corpus and
  lists matches in a `*Helpgrep*` buffer (like occur: file + line + matched text).
- Each result jumps to the doc location (open the manual/cheatsheet at the match).
- Regex + case options (mirror occur's `occur-search`).
- Corpus = the canonical Texinfo sources + cheatsheet (+ optionally docs/specs
  and `documentation.ts` as a toggleable scope).

## User Story
As a user, I want to find every place the manual mentions "daemon" or "snippet"
and jump to it — searching across the whole written manual, not just symbol names.

## Problem Statement
`occur` searches the current buffer; `apropos-documentation` (SPEC-107) searches
docstrings. Nothing searches the **prose manual corpus** end-to-end. Users
reading the Texinfo manual have no in-editor way to grep it.

## Solution Statement
1. A `helpgrep` T-Lisp command that runs a regex over a configurable corpus list
   (default: `docs/tmax/*.texinfo`, `docs/cheatsheet.md`) using the existing
   search primitives (reuse occur's engine).
2. Render results in `*Helpgrep*` (reuse the occur buffer UI), each line a jump
   target opening the source file at the match.
3. Optional scope argument: `C-u` includes `documentation.ts`/specs.

## Relevant Files
- `src/tlisp/core/commands/occur.tlisp` — occur engine + `*Occur*` UI (reuse/extend).
- New: `src/tlisp/core/commands/helpgrep.tlisp` (or extend occur).
- Corpus: `docs/tmax/tmax.texinfo`, `docs/tmax/tlisp.texinfo`, `docs/cheatsheet.md` (after SPEC-109).
- `src/editor/api/documentation.ts` — optional scope.

## Implementation Plan
### Phase 1: Corpus enumeration + grep
List corpus files; regex-grep each; collect (file, line, text) hits.

### Phase 2: Results buffer + jump
Reuse the occur results renderer; `RET` opens the source at the line.

### Phase 3: Scope options + binding
Default corpus; `C-u` widens; bind `:helpgrep` / `M-x helpgrep`.

## Step by Step Tasks
### Task 1: Corpus grep
**Acceptance Criteria**:
- [ ] `helpgrep <re>` returns matches across the Texinfo + cheatsheet corpus.
- [ ] Regex + case options mirror occur.

### Task 2: Results + jump
**Acceptance Criteria**:
- [ ] `*Helpgrep*` lists file:line:text; `RET` opens the source at the line.

### Task 3: Binding + scope
**Acceptance Criteria**:
- [ ] `:helpgrep` / `M-x helpgrep`; `C-u` widens to documentation.ts/specs.
- [ ] Works after SPEC-106 (corpus is current) and SPEC-109 (cheatsheet exists).

## Testing Strategy
- Unit: grep a fixture corpus; assert hits + jump target.
- Regression: occur unchanged.

## Acceptance Criteria (Completion)
- [ ] `helpgrep` full-text-searches the prose doc corpus → occur-style results.
- [ ] Each result jumps to its source location.
- [ ] Distinct from `apropos-documentation` (live docstrings) — documented split.

## Validation Commands
- `bun run typecheck`; `bun run build`
- `bun test test/unit/helpgrep.test.ts` (new)
- Manual: `:helpgrep daemon` lists manual mentions of daemon.

## Notes
- Splits cleanly from SPEC-107: apropos searches **live symbol metadata**
  (docstrings); helpgrep searches **written prose** (manual/cheatsheet). Both are
  Emacs/Vim-standard.
- Depends on SPEC-106 (current manual content) for useful results; reuses the
  occur engine, so the new code is just corpus enumeration + binding (small
  verification surface — the search/jump mechanics are already proven by occur).
