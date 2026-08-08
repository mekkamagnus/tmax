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

- `(setq default-major-mode "text")` makes new/undetected buffers open in
  `text-mode` instead of `fundamental-mode`.
- Default value is `"fundamental"` (unchanged behavior).
- Applies to: brand-new buffers, files whose name+content match no rule.

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

- Add a T-Lisp variable `default-major-mode` (string, default `"fundamental"`).
- In `major-mode-auto-detect`, when filename (and magic, SPEC-103) detection
  both return nothing, activate `default-major-mode` instead of hard-coded
  `"fundamental"`.
- If `default-major-mode` names an unregistered mode, fall back to
  `fundamental` and log a warning (don't crash).
- Expose via the init file: `(setq default-major-mode "text")`.

## Relevant Files

- `src/editor/api/major-mode-ops.ts` — `major-mode-auto-detect` (replace the
  hard-coded `"fundamental"` fallback with the variable's value + existence check).
- `src/tlisp/core/commands/major-mode.tlisp` (or wherever mode vars live) —
  register `(defvar default-major-mode "fundamental …)`.
- New: `test/unit/default-major-mode.test.ts`.

### New Files
- `test/unit/default-major-mode.test.ts` — pins the variable + fallback safety.

## Implementation Plan

### Phase 1: Variable
Register `default-major-mode` (defvar, default `"fundamental"`).

### Phase 2: Use it as the fallback
In `major-mode-auto-detect`, on no-match: read the variable; if the named mode
is registered, activate it; else activate `fundamental` and log a warning.

## Step by Step Tasks

### Task 1: Register + read the variable
**User Story**: As a user, I can set the default mode.
- Register `(defvar default-major-mode "fundamental" …)`.
- `major-mode-auto-detect` reads it on no-match.

**Acceptance Criteria**:
- [ ] Default value is `"fundamental"` → behavior unchanged.
- [ ] `(setq default-major-mode "text")` → undetected buffers open in `text-mode`.

### Task 2: Unregistered-mode safety
**User Story**: As a user, a typo in the variable doesn't break the editor.
- If the named mode is unregistered → fall back to `fundamental` + warn.

**Acceptance Criteria**:
- [ ] `(setq default-major-mode "nosuchmode")` → undetected buffer is
      `fundamental-mode`, a warning is logged, no exception.

### Task 3: Validation
- `bun run typecheck`, `bun run build`, `bun test test/unit/default-major-mode.test.ts`.

## Testing Strategy

### Unit Tests
- Default → fundamental on an extension-less, no-shebang, no-`-*-` buffer.
- `setq default-major-mode "text"` → text-mode (assuming text-mode registered;
  if not, substitute a registered prose mode or skip that assertion).
- Unregistered name → fundamental + warn.

### Edge Cases
- Variable set to `"fundamental"` explicitly (idempotent).
- Variable set mid-session applies to the NEXT detection, not retroactively.

## Acceptance Criteria (Completion)
- [ ] `default-major-mode` variable exists, defaults to `"fundamental"`.
- [ ] Undetected buffers use the variable's mode.
- [ ] Unregistered mode name → safe fallback + warning.
- [ ] Default behavior unchanged when the variable is at its default.

## Validation Commands
- `bun run typecheck`
- `bun run build`
- `bun test test/unit/default-major-mode.test.ts`
- Manual: `(setq default-major-mode "text")` in init.tlisp, then `tmax scratch-file`.

## Notes
- Emacs reference: variable `default-major-mode` (default `fundamental-mode`).
- This is the lowest-precedence step; it composes with SPEC-102 (file-local) and
  SPEC-103 (magic) — both must be checked first.
- Keep the change tiny: this is a one-spot fallback swap plus a variable.
