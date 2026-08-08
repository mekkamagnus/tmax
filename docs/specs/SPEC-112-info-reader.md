# Feature: In-editor Info reader (`info-mode`) for the Texinfo manuals

## Feature Description
A read-only `info-mode` that browses the `.info` manuals tmax **already builds**
(`docs/tmax/tmax.info`, `tlisp.info`) *inside the editor* — Emacs `info` parity.
This is the **narrative reading** surface ("let me read the chapter on modes"),
distinct from `describe-*` (per-symbol) and `helpgrep` (flat search). Additive:
it does NOT replace `describe-*`; it reads the published `.info` artifact.

## Goals
- `M-x info` / `:info` opens the canonical `docs/tmax/tmax.info` in a read-only
  `info-mode` buffer.
- Node navigation: `Next`/`Prev`/`Up` nodes, `Top`/`Dir`, menu items, and
  `*Note:` cross-references are followable links.
- `i` index search and `s` within-node search; `q` quits.
- No external `info` binary required — a pure TS/T-Lisp `.info` reader.

## User Story
As a user, I want to read the tmax manual like a book inside the editor — jumping
from the "Editing Modes" chapter to a specific mode's section and back — instead
of leaving the terminal or grepping flat text.

## Problem Statement
tmax produces `.info` via `makeinfo` but has no in-editor reader — the `.info` is
only consumable in Emacs or the external `info` command. The narrative/manual
reading experience is missing in-editor (you can `describe-*` a symbol or
`helpgrep` a term, but you can't *browse* the manual).

## Solution Statement
1. A `.info` reader: parse the Info tag table (node → byte offset), the `Indirect:`
   file list, menus, and `*Note target` cross-references.
2. `info-mode` (read-only) renders the current node, highlights menu/*Note links,
   and binds `n`/`p`/`u`/`t`/`m`/`RET`/`i`/`s`/`q`.
3. Default target is `docs/tmax/tmax.info`; `M-x info <file>` opens another.
4. Reuse the help-mode button machinery (SPEC-110) for clickable links where
   possible; fall back to plain text otherwise.

## Relevant Files
- New: `src/editor/info-reader.ts` — parse `.info` (tag table, nodes, menus, *Note).
- New: `src/tlisp/core/modes/info-mode.tlisp` — read-only navigation mode.
- New: `src/tlisp/core/commands/info.tlisp` — `info`, `info-goto-node`, `info-index`.
- Corpus: `docs/tmax/tmax.info`, `tlisp.info` (built by SPEC-106's Makefile).
- `src/frontend/render/` — node rendering + link overlays (share with help-mode).

## Implementation Plan
### Phase 1: `.info` parser
Read tag table + node offsets; render a node's text; resolve a node name → text.

### Phase 2: navigation
Next/Prev/Up from node headers; menu (`* name::` / `* name: node.`) follow;
`*Note target:` follow; Top/Dir.

### Phase 3: index + search
`i` over the Info index; `s` regex within the current node.

## Step by Step Tasks
### Task 1: parser + node render
**Acceptance Criteria**:
- [ ] Opens `docs/tmax/tmax.info`, parses the tag table, renders the Top node.
- [ ] Reads multi-file (Indirect) `.info` correctly.

### Task 2: navigation
**Acceptance Criteria**:
- [ ] `n`/`p`/`u`/`t` move between nodes; menu items and `*Note` are followable.
- [ ] History back/forward (reuse help-mode stack, SPEC-110).

### Task 3: index + bindings
**Acceptance Criteria**:
- [ ] `i` index search; `s` within-node search; `M-x info` / `:info`.
- [ ] Read-only; no external `info` process.

## Testing Strategy
- Unit: parse a small fixture `.info`; assert node list + a menu/*Note target.
- Manual: open `tmax.info`, browse Introduction → Editing Modes → a mode section.

## Acceptance Criteria (Completion)
- [ ] `info-mode` renders `.info` nodes and navigates Next/Prev/Up/menu/*Note.
- [ ] Index + within-node search work; opens the canonical manual by default.
- [ ] Pure in-editor reader (no external binary); read-only.
- [ ] Composes with help-mode (SPEC-110) for link/history mechanics.

## Validation Commands
- `bun run typecheck`; `bun run build`
- `bun test test/unit/info-reader.test.ts` (new)
- `cd docs/tmax && make info` (ensure `tmax.info` is current per SPEC-106)
- Manual: `M-x info` → browse.

## Notes
- **Additive, not a replacement** — describe-* stays the per-symbol help; Info is
  the narrative manual. This is the *only* legitimate way Texinfo touches the
  in-editor help (it reads the artifact tmax already publishes).
- **Scope, not a trimmed target.** A real Info reader is a parser of the `.info`
  format (node headers, tag table, menus, `*Note`). The right scope is nodes +
  menus + `*Note` + index — the navigation that delivers the manual-browsing
  value. That subset is the correct design, not a cost-trim. (Browsing the
  `.texinfo`/markdown sources flatly via `helpgrep` is a *strictly lesser
  capability* — flat search, no node/hypertext navigation — so it does not
  substitute; build the reader.) The long-term cost to respect is the reader's
  **maintenance + verification surface** as the `.info` format/tmax's own manuals
  evolve — pin it with parser tests against fixture `.info` files.
- Depends on SPEC-106 (the `.info` must be current for useful reading).
