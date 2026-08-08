# Feature: File-local `mode:` variable detection

## Feature Description

Honor a file's explicit major-mode declaration, the way Emacs does, so a file
can say which mode it wants regardless of its name. Two forms:

1. **First-line magic comment** — `-*- mode: NAME; -*-` (optionally embedded in
   a line comment, e.g. `# -*- mode: python; -*-`, `<!-- -*- mode: markdown; -*- -->`).
2. **`Local Variables:` block** at the end of the file:
   ```
   Local Variables:
   mode: markdown
   End:
   ```

This is the highest-priority mode signal: it OVERRIDES filename-based
(`auto-mode-alist`) and content-based (magic) detection, because the file itself
declares its mode.

## Goals

- A file containing `-*- mode: markdown; -*-` opens in `markdown-mode` even if
  its name is `notes.txt` (or has no extension).
- A file ending in a `Local Variables: … mode: foo … End:` block opens in `foo-mode`.
- File-local `mode:` overrides filename- and content-based detection.
- The feature is gated by a user setting (mirroring Emacs
  `enable-local-variables`), defaulting to ON for `mode:` (the `mode:` variable
  is safe; only `eval:`-style locals are risky).

## User Story

As a user, I want files to declare their own major mode via a `mode:` local
variable, so that a file's mode is determined by its content's intent — not just
its extension. (e.g. a `.txt` daily-note that is really markdown, or a
generated/templated file whose name doesn't reflect its language.)

## Problem Statement

tmax today only detects modes from the filename (`auto-mode-alist` equivalent:
extension + regexp rules — `src/editor/auto-mode.ts::detectAutoMode`). There is
no mechanism for a file to override that. So a markdown file named
`2026-08-08.txt`, or an extension-less file with `-*- mode: markdown; -*-`,
opens in the wrong mode and the user must set it manually.

## Solution Statement

Extend the mode-resolution pipeline so that, **before** filename detection, the
editor reads the file's local variables and, if a `mode:` entry is present (and
local variables are enabled), activates that mode.

- Add `hack-local-variables-mode` (T-Lisp, or a TS primitive) that scans the
  first line for `-*- ... mode: NAME ... -*-` and the last page for a
  `Local Variables:` block, returning the `mode:` value (or nil).
- `major-mode-auto-detect` resolves in this precedence order:
  1. file-local `mode:` variable (this SPEC) — if present and enabled, use it.
  2. `auto-mode-alist` (existing `detectAutoMode`).
  3. magic content detection (SPEC-103, when present).
  4. `default-major-mode` (SPEC-104, when present).
- Add a user setting `enable-local-variables` (default `t`); when off, skip the
  file-local scan entirely. Exposed via primitives `(set-enable-local-variables FLAG)`
  + `(enable-local-variables-p)` (NOT a setq-able variable — T-Lisp is Lisp-1,
  same idiom as `set-default-major-mode`, SPEC-104).

## Relevant Files

- `src/editor/local-variables.ts` (NEW) — pure scanner `findFileLocalMode(text)`.
- `src/editor/api/major-mode-ops.ts` — `major-mode-auto-detect` (file-local check
  first via a new `resolveFileLocal` helper); `(set-enable-local-variables FLAG)`
  + `(enable-local-variables-p)` primitives.
- `src/editor/functional/domain-state.ts` — `enableLocalVariables` field on
  `MajorModeDomainState` (default `true`).

### New Files
- `src/editor/local-variables.ts` — the scanner.
- `test/unit/file-local-mode.test.ts` — pins the scanner + precedence + the gate.

## Implementation Plan

### Phase 1: Scanner
Pure function `findFileLocalMode(bufferText: string): string | undefined` that:
- Matches `-*- ... mode: NAME ... -*-` on the first line (allow surrounding
  comment syntax). Also supports the bare `-*- NAME -*-` shorthand.
- Scans the last ~3000 chars for a `Local Variables:` … `End:` block and
  extracts `mode: NAME`.

### Phase 2: Wire into detection
In `major-mode-auto-detect`, FIRST check the file-local mode (when enabled) and
prefer it; only then try `detectAutoMode` (filename), then the default.

### Phase 3: Setting + gating
`enableLocalVariables` on `MajorModeDomainState` (default `true`); toggled via
`(set-enable-local-variables FLAG)`. When off, `resolveFileLocal` short-circuits.

## Step by Step Tasks

### Task 1: Local-variable scanner
**User Story**: As a developer, I want a tested pure scanner, so detection is
deterministic and side-effect-free.
- Implement `findFileLocalMode` in `src/editor/local-variables.ts`.
- Unit-test: first-line `-*- mode: X; -*-`, embedded-in-comment form, bare
  `-*- X -*-` shorthand, `Local Variables:` block, no-declaration → undefined,
  malformed → undefined.

**Acceptance Criteria**:
- [ ] `findFileLocalMode("# -*- mode: python; -*-\n…")` → `"python"`
- [ ] Embedded comment form (`<!-- -*- mode: markdown; -*- -->`) → `"markdown"`
- [ ] `Local Variables:` block `mode: ruby` → `"ruby"`
- [ ] No declaration → `undefined`
- [ ] Malformed (`-*- mode: ; -*-`) → `undefined`

### Task 2: Precedence in major-mode-auto-detect
**User Story**: As a user, a file's `mode:` declaration should win over its name.
- In `major-mode-auto-detect`, check file-local mode first; if present, use it.
- Else fall through to `detectAutoMode` (existing).

**Acceptance Criteria**:
- [ ] `notes.txt` whose content has `-*- mode: markdown; -*-` → `markdown-mode`
- [ ] `README.md` (matches `.md`) with `-*- mode: text; -*-` → `text-mode`
  (file-local overrides filename)
- [ ] No file-local → unchanged (filename detection)

### Task 3: enable-local-variables gate
**User Story**: As a security-conscious user, I can disable file-local variables.
- `enableLocalVariables` (default `true`) on `MajorModeDomainState`; toggled via
  `(set-enable-local-variables FLAG)` (accepts `t`/`nil`/boolean); queried via
  `(enable-local-variables-p)`. When off, `resolveFileLocal` skips the scan.

**Acceptance Criteria**:
- [ ] `(set-enable-local-variables nil)` → `-*- mode: X; -*-` is ignored
- [ ] Default `t` → honored

### Task 4: Validation
- `bun run typecheck`, `bun run build`
- `bun test test/unit/file-local-mode.test.ts`

## Testing Strategy

### Unit Tests
`test/unit/file-local-mode.test.ts` — scanner forms + precedence + gate, using
the `startedEditor` fixture (real modes registered).

### Edge Cases
- Magic comment not on line 1 (ignored).
- `Local Variables:` without `End:` (ignored — must be well-formed).
- `mode:` value naming an unregistered mode → fall through (don't error).
- Very large file (scan only first line + last ~3 KB).

## Acceptance Criteria (Completion)
- [ ] First-line `-*- mode: X; -*-` activates `X-mode`, overriding the filename.
- [ ] `Local Variables:` block `mode:` is honored.
- [ ] Precedence: file-local > filename (auto-mode-alist) > magic (SPEC-103) > default (SPEC-104).
- [ ] (set-enable-local-variables nil) disables the feature.
- [ ] No regression: files without a declaration detect exactly as before.

## Validation Commands
- `bun run typecheck`
- `bun run build`
- `bun test test/unit/file-local-mode.test.ts`
- Manual: create `note.txt` with `# -*- mode: markdown; -*-` as line 1, `tmax note.txt` → markdown-mode.

## Notes
- Emacs reference: `(elisp) File Local Variables`, `(elisp) Specifying File Variables`.
- Only the `mode:` variable is in scope here. Other file-local variables
  (`eval:`, `coding:`, etc.) are out of scope — `eval:` especially is a security
  non-starter and must NOT be implemented without a trust prompt.
- Depends on the existing `major-mode-auto-detect` primitive; composes with
  SPEC-103 (magic) and SPEC-104 (default-major-mode) via the documented precedence.
