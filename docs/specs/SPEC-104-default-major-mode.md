# Feature: Configurable `default-major-mode`

## Feature Description

Make the fallback major mode (used when no detection rule matches) configurable,
mirroring Emacs `default-major-mode`. Today tmax hard-codes `fundamental-mode`
as the fallback. This spec makes it a user-settable variable defaulting to
`fundamental-mode`, so a user can say "unknown/new buffers are
`text-mode`" (or `markdown-mode`).

Precedence: the FINAL fallback, after file-local (SPEC-102), filename
(`auto-mode-alist`), and magic (SPEC-103) all fail to match.

## Goals

- `(set-default-major-mode "text")` makes new/undetected buffers open in
  `text-mode` instead of `fundamental-mode`.
- Default value is `"fundamental"` (unchanged behavior).
- Applies to: brand-new buffers, files whose name+content match no rule.
- NOTE: the API is a setter primitive, not `(setq default-major-mode …)`, because
  T-Lisp is Lisp-1 (see Solution Statement).

## User Story

As a user who mostly writes prose, I want new scratch buffers and unrecognized
files to open in `text-mode` (or `markdown-mode`) by default, so I get word
wrapping / fill / heading niceties without manually setting the mode each time.

## Problem Statement

`detectAutoMode` returns `undefined` when nothing matches, and
`major-mode-auto-detect` falls back to the literal string `"fundamental"`. There
is no way to change that fallback. Users who want a non-fundamental default
(e.g. for plain-text notes) cannot configure it.

## Solution Statement

- Add a per-editor `defaultMajorMode` field to the major-mode session state
  (`domain-state.ts`), default `"fundamental"`.
- In `major-mode-auto-detect`, when filename (and magic, SPEC-103) detection
  both return nothing, activate `defaultMajorMode` (if registered) instead of
  hard-coded `"fundamental"`.
- If it names an unregistered mode, fall back to `fundamental` and warn.
- **API**: `(set-default-major-mode "text")` (setter) and
  `(default-major-mode-get)` (getter). NOT `(setq default-major-mode …)`:
  T-Lisp is Lisp-1 (one namespace for variables and functions), so a setq-able
  variable named `default-major-mode` would collide with / shadow a same-named
  function. tmax therefore uses the setter/getter-primitive idiom — the same
  pattern as `set-expand-tabs` / `set-tab-width` (#144). (Emacs is Lisp-2, so
  its `setq` parity is not directly expressible in T-Lisp today.) A user
  `(setq default-major-mode "text")` errors cleanly ("variable not defined" —
  T-Lisp `setq` requires a prior `defvar`) instead of corrupting the session;
  the configured default is unchanged.

## Relevant Files

- `src/editor/api/major-mode-ops.ts` — `major-mode-auto-detect` (no-match path
  → `resolveDefault`); `activateConfig`/`resolveDefault` helpers; the
  `(set-default-major-mode NAME)` setter + `(default-major-mode-get)` getter.
- `src/editor/functional/domain-state.ts` — `defaultMajorMode` field on
  `MajorModeDomainState` (default `"fundamental"`) + its initialization.
- New: `test/unit/default-major-mode.test.ts`.

### New Files
- `test/unit/default-major-mode.test.ts` — pins the fallback, setter/getter,
  precedence, unregistered-safety, and setq-non-corruption.

## Implementation Plan

### Phase 1: State + primitives
Add `defaultMajorMode` (default `"fundamental"`) to major-mode session state;
add `(set-default-major-mode NAME)` setter + `(default-major-mode-get)` getter.

### Phase 2: Use it as the fallback
In `major-mode-auto-detect`, on no-match: read `defaultMajorMode`; if the named
mode is registered, activate it; else activate `fundamental` and log a warning.

## Step by Step Tasks

### Task 1: Setter/getter primitives + fallback wiring
**User Story**: As a user, I can set the default mode for undetected buffers.
- Add `defaultMajorMode` (default `"fundamental"`) to the major-mode session state.
- Wire `major-mode-auto-detect`'s no-match path to it (via a `resolveDefault` helper).
- Add `(set-default-major-mode NAME)` setter + `(default-major-mode-get)` getter.

**Acceptance Criteria**:
- [ ] Default value is `"fundamental"` → behavior unchanged.
- [ ] `(set-default-major-mode "text")` → undetected buffers open in `text-mode`
      (for a registered prose mode).
- [ ] `(setq default-major-mode "text")` errors cleanly + non-corrupting (Lisp-1).
- [ ] Unregistered configured default → `fundamental` + warning, no exception.

### Task 2: Validation
- `bun run typecheck`, `bun run build`, `bun test test/unit/default-major-mode.test.ts`.

## Testing Strategy

### Unit Tests
- Default → fundamental on an extension-less, no-shebang, no-`-*-` buffer.
- `(set-default-major-mode "markdown")` → undetected buffer resolves to markdown.
- Filename detection beats the default (precedence).
- Unregistered name → fundamental + warn.
- `(setq default-major-mode …)` errors cleanly + non-corrupting (Lisp-1 guard).

### Edge Cases
- Set to `"fundamental"` explicitly (idempotent).
- Set mid-session applies to the NEXT detection, not retroactively.

## Acceptance Criteria (Completion)
- [ ] `(set-default-major-mode NAME)` + `(default-major-mode-get)` exist; default `"fundamental"`.
- [ ] Undetected buffers use the configured default mode.
- [ ] Unregistered mode name → safe fallback + warning.
- [ ] `(setq default-major-mode …)` errors cleanly + non-corrupting (T-Lisp Lisp-1).
- [ ] Default behavior unchanged when at the default.

## Validation Commands
- `bun run typecheck`
- `bun run build`
- `bun test test/unit/default-major-mode.test.ts`
- Manual: `(set-default-major-mode "text")` (e.g. in init.tlisp), then `tmax scratch-file`.

## Notes
- Emacs reference: variable `default-major-mode` (default `fundamental-mode`).
- This is the lowest-precedence step; it composes with SPEC-102 (file-local) and
  SPEC-103 (magic) — both must be checked first.
- Keep the change tiny: this is a one-spot fallback swap plus a variable.
