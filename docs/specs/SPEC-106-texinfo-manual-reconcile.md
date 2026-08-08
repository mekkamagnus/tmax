# Feature: Reconcile + refresh the Texinfo manuals

## Feature Description
tmax already has a Texinfo manual system (`docs/tmax/tmax.texinfo` +
`tlisp.texinfo`, compiled by `docs/tmax/Makefile` → `.info` + `.html`). It has
drifted in two ways: (1) the **legacy** `docs/manual/tmax.texi` (Deno-era) still
exists and contradicts the canonical manual; (2) the **canonical** manual is
stale vs the codebase — it omits recently-shipped features (shell/comint/snippet
modes, terminal + project modes, and the SPEC-102/103/104/105 mode-detection
chain + save-as detection).

## Goals
- The canonical `docs/tmax/tmax.texinfo` documents every registered major mode
  and the current command/mode-detection surface accurately.
- The Deno-era legacy `docs/manual/tmax.texi` is either removed or reduced to a
  one-line redirect to `docs/tmax/` (no stale, contradictory content remains).
- `make info` and `make html` rebuild cleanly from `docs/tmax/`.
- The manual and the in-editor `describe-*` agree (cross-reference each other).

## User Story
As a user (or contributor), I want the published manual to match the editor I'm
running, so I'm not misled by mentions of Deno, "planned" visual mode, or a
25-function API when there are 100+.

## Problem Statement
CHORE-09 created `docs/tmax/` as a fresh rewrite but kept `docs/manual/` "for
backward compatibility." Since then many features shipped without manual updates,
so both the legacy file (Deno, wrong counts) and the canonical file (missing
modes/detection) now mislead. Two sources of truth for one manual is the root
cause of the drift.

## Solution Statement
1. **Canonical refresh** — update `docs/tmax/tmax.texinfo` (+ `tlisp.texinfo` if
   needed) to cover: all registered major modes; minor modes (snippet, comint,
   which-key); terminal + project modes; the mode-detection precedence chain
   (file-local > filename > magic > default, SPEC-102/103/104); save-as mode
   detection (BUG-77 / SPEC-105); `default-major-mode` / `set-enable-local-variables`.
2. **Legacy fate** — remove `docs/manual/tmax.texi` (and `docs/manual/*.html`
   etc.), or replace with a stub redirecting to `docs/tmax/`. Update `docs/Makefile`
   (which references "the legacy manual in docs/manual/") and any pointers.
3. **Build check** — `make info && make html` in `docs/tmax/`; commit regenerated
   `.info`/`.html`.
4. **Drift guard** — add a short checklist/comment (or test) that the manual's
   "Editing Modes" node list matches the registered major modes.

## Relevant Files
- `docs/tmax/tmax.texinfo`, `docs/tmax/tlisp.texinfo` — canonical sources (refresh).
- `docs/tmax/Makefile` — build (`make info`, `make html`).
- `docs/tmax/index.md` — inventory of the canonical manuals.
- `docs/manual/tmax.texi` (+ any `docs/manual/*.html`) — legacy (remove/redirect).
- `docs/Makefile`, `docs/specs/CHORE-09-texinfo-docs.md` — references to the legacy path.
- Source of truth for modes: `src/tlisp/core/modes/*.tlisp` (`major-mode-register` calls).

## Implementation Plan
### Phase 1: Legacy reconciliation
Decide remove-vs-redirect for `docs/manual/`; remove the contradictory content;
fix `docs/Makefile` + `TODO.org` references.

### Phase 2: Canonical refresh
Walk the registered modes (grep `major-mode-register`) + recent specs
(SPEC-098..105) and add/refresh nodes in `tmax.texinfo`.

### Phase 3: Rebuild + verify
`cd docs/tmax && make info && make html`; commit artifacts; confirm no Deno refs.

## Step by Step Tasks
### Task 1: Remove/redirect the legacy manual
**Acceptance Criteria**:
- [ ] No file under `docs/manual/` references Deno or "planned" visual mode.
- [ ] `docs/Makefile` no longer builds a stale manual (or builds the redirect).

### Task 2: Refresh the canonical manual against current features
**Acceptance Criteria**:
- [ ] Every registered major mode (c, conf, cpp, css, dockerfile, fikra,
      fundamental, go, html, java, json, lisp, markdown, purescript, python,
      rust, shell, sql, text, toml, typescript) has a manual entry.
- [ ] Minor modes (snippet, comint, which-key) + terminal/project modes covered.
- [ ] Mode-detection precedence documented (file-local > filename > magic > default).
- [ ] Save-as mode detection (`:w <file>`, `write-file`) documented.
- [ ] No Deno references anywhere in `docs/tmax/`.

### Task 3: Rebuild + drift guard
**Acceptance Criteria**:
- [ ] `cd docs/tmax && make info && make html` succeeds; `.info`/`.html` regenerated.
- [ ] A drift-guard note/checklist maps manual mode entries ↔ registered modes.

## Testing Strategy
- Manual: read the regenerated `.info`/`.html`; spot-check 3 recent features.
- Grep guard: `rg -i deno docs/` returns nothing; `rg 'major-mode-register' src/tlisp/core/modes`
  modes all appear in the manual.

## Acceptance Criteria (Completion)
- [ ] Canonical manual documents every registered major mode + the mode-detection chain + save-as detection.
- [ ] Legacy `docs/manual/` no longer contradicts it (removed or redirect-only).
- [ ] `make info && make html` succeed; artifacts committed.
- [ ] No Deno/"planned visual" references remain in `docs/`.
- [ ] Drift guard in place.

## Validation Commands
- `cd docs/tmax && make info && make html`
- `rg -i 'deno' docs/` (expect none)
- `rg 'major-mode-register' src/tlisp/core/modes` (modes ↔ manual cross-check)

## Notes
- Texinfo is the right tool for this external/manual job (multi-output: `.info`
  for Emacs + `.html` for the site) — this issue is about *content drift*, not
  format choice. Do NOT wire Texinfo into the in-editor help (that stays
  docstrings + describe-*).
- `makeinfo` is an external dependency (already accepted via the Makefile).
