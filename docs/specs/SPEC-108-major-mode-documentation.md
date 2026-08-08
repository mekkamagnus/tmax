# Feature: Major-mode documentation (Tier 0)

## Feature Description
Give every major mode a docstring describing what it's for, and make
`describe-mode` show it. Today `describe-mode` (`SPC h m`) lists the mode's
keybindings but doesn't say **what the mode is** — major modes are registered
without docstrings, so `describe-mode`'s header is empty for them. Add a
docstring/`description` slot to major-mode registration, populate it for every
shipped mode, and render it as the first line(s) of `describe-mode` output.

## Goals
- Every registered major mode (c, conf, cpp, css, dockerfile, fikra, fundamental,
  go, html, java, json, lisp, markdown, purescript, python, rust, shell, sql,
  text, toml, typescript) carries a one-to-three-sentence purpose doc.
- `describe-mode` shows the active major mode's doc at the top, then its keys.
- Minor modes that have docs (which-key, snippet, comint) surface too.
- The mode doc also feeds `apropos-documentation` (SPEC-107).

## User Story
As a user, when I press `SPC h m` I want to learn what the current mode *does*
("markdown-mode: editing for Markdown — headings, lists, export"), not just see a
list of keys whose meanings I then have to look up individually.

## Problem Statement
`major-mode-register` takes `(NAME EXTENSIONS SYNTAX-LANGUAGE INDENT-INCREASE
INDENT-DECREASE)` — no documentation slot. `MajorModeConfig` (mode-state.ts) has
no `description` field. `describe-mode` therefore renders an empty mode header.
Modes are effectively undocumented to the help system.

## Solution Statement
1. Add an optional `description?: string` to `MajorModeConfig` and a 6th
   `major-mode-register` arg (or a separate `(major-mode-doc "name" "...")` form
   — pick whichever is least invasive). Store it on the config.
2. Populate a purpose doc for every shipped mode in its `*-mode.tlisp`.
3. `describe-mode` prints the active major mode's `description` first, then its
   keybindings (as today).
4. `apropos-documentation` (SPEC-107) includes mode descriptions in its corpus.

## Relevant Files
- `src/editor/mode-state.ts` — `MajorModeConfig` (add `description`).
- `src/editor/api/major-mode-ops.ts` — `major-mode-register` (accept description).
- `src/tlisp/core/modes/*-mode.tlisp` — add a description per mode.
- `src/tlisp/core/commands/describe.tlisp` — `describe-mode` (render description).
- `src/editor/api/describe-ops.ts` — exposes config to describe-mode.

## Implementation Plan
### Phase 1: Schema
Add `description?` to `MajorModeConfig`; thread it through `major-mode-register`.

### Phase 2: Populate
Write a concise doc for each shipped mode (~20 modes).

### Phase 3: Render
`describe-mode` shows "MODE — description" before the bindings block.

## Step by Step Tasks
### Task 1: Schema + registration
**Acceptance Criteria**:
- [ ] `MajorModeConfig` has a `description` field.
- [ ] `major-mode-register` accepts (and stores) a description.

### Task 2: Document every shipped mode
**Acceptance Criteria**:
- [ ] Every `src/tlisp/core/modes/*-mode.tlisp` registers a non-empty description.
- [ ] Descriptions are accurate (grep the mode's actual features).

### Task 3: describe-mode renders it
**Acceptance Criteria**:
- [ ] `describe-mode` output begins with the active mode's description.
- [ ] Fallback "(no description)" only when the field is absent.

## Testing Strategy
- Unit: register a test mode with a description → `describe-mode` includes it.
- Coverage test: every shipped mode file sets a description (grep guard).

## Acceptance Criteria (Completion)
- [ ] All registered major modes carry a purpose doc.
- [ ] `describe-mode` shows it ahead of the keybinding list.
- [ ] Mode docs are queryable (and feed apropos-documentation).

## Validation Commands
- `bun run typecheck`; `bun run build`
- `bun test test/unit/describe-mode.test.ts` (new/extended)
- `rg 'major-mode-register' src/tlisp/core/modes` ↔ description coverage check.

## Notes
- Pairs with SPEC-107 (apropos-documentation searches these) and SPEC-108's
  describe-mode. Pure metadata work — no runtime behavior change beyond help.
