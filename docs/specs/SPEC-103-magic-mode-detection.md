# Feature: Magic (content-based) major-mode detection

## Feature Description

Detect the major mode from the buffer's CONTENT when the filename doesn't match,
mirroring Emacs `magic-mode-alist` / `magic-fallback-alist`. This covers:

- **Shebangs** — `#!/bin/bash`, `#!/usr/bin/env python3`, `#!/usr/bin/env node` →
  the corresponding mode, via an interpreter map (Emacs `interpreter-mode-alist`).
- **Markup signatures** — `<?xml` → xml, `<!DOCTYPE html` → html, `%!PS-` →
  postscript, `{` JSON-ish first object (optional, conservative).
- **User-configurable magic rules** — `(magic-mode-add REGEXP MODE)` so users can
  add their own content→mode rules (mirrors `magic-mode-alist`).

Precedence: after filename detection (`auto-mode-alist`), before
`default-major-mode` (SPEC-104). Filename wins when it matches.

## Goals

- An extension-less executable script `./deploy` starting with `#!/usr/bin/env bash`
  opens in `shell-script-mode` (or the registered shell mode).
- A file `feed` starting with `<?xml version=` opens in `xml-mode`.
- A file `page` starting with `<!DOCTYPE html>` opens in `html-mode`.
- Filename detection still wins: `script.sh` → shell mode by extension regardless
  of content.
- Users can add their own magic rules via a T-Lisp API.

## User Story

As a user, I want extension-less or generically-named files to be detected from
what they actually contain (shebang, XML prolog, doctype), so I don't have to
rename or manually set the mode for scripts and generated files.

## Problem Statement

tmax detects modes only from the filename. Scripts without an extension
(`makefile`, `deploy`, `entrypoint`), config files with generic names, and
generated markup (XML/HTML feeds) all fall through to `fundamental-mode`
because their names don't match any rule. Emacs solves this by sniffing the
first line(s).

## Solution Statement

Add a content-sniffing step to the detection pipeline:

- New pure helper `detectMagicMode(firstLines: string, rules): string | undefined`
  that runs each magic regexp against the head of the buffer (first ~3 lines).
- Two rule sets:
  - `magicFallbackRules` — built-in, registered by modes themselves
    (e.g. xml-mode registers `^<\?xml`, html-mode `<!DOCTYPE html`, shell modes
    register shebang patterns). Mirrors `magic-fallback-alist`.
  - `magicUserRules` — user-added via `(magic-mode-add REGEXP MODE)`. Mirrors
    `magic-mode-alist`. User rules take precedence over fallback.
- Shebang handling: a small `interpreter-mode-alist` equivalent mapping
  interpreters (`bash`, `sh`, `python3`, `node`, etc.) to modes; the shebang
  rule extracts the interpreter and looks it up.
- `major-mode-auto-detect` resolves:
  1. file-local `mode:` (SPEC-102)
  2. `auto-mode-alist` (existing filename)
  3. **magic (this SPEC)** — only if filename detection found nothing
  4. `default-major-mode` (SPEC-104)

## Relevant Files

- `src/editor/auto-mode.ts` — `detectAutoMode`; add `detectMagicMode` alongside.
- `src/editor/mode-state.ts` — `AutoModeRule`; add a `MagicRule` type (regexp + mode + scope).
- `src/editor/api/major-mode-ops.ts` — `major-mode-auto-detect` (call magic when
  filename detection returns nothing); add `magic-mode-add` / `magic-mode-rules`.
- Mode files register their own magic signatures:
  `src/tlisp/core/modes/{xml,html,shell,…}-mode.tlisp` via a new
  `(major-mode-magic "mode" "regexp")` form.
- New: `src/editor/shebang.ts` — shebang parser + interpreter map.

### New Files
- `src/editor/shebang.ts` — `parseShebang(line): string | undefined` + interpreter map.
- `test/unit/magic-mode-detect.test.ts` — pins shebang, xml/html, user rules, precedence.

## Implementation Plan

### Phase 1: Magic rule store + detector
`MagicRule { regexp: string; mode: string; }`. `detectMagicMode(text, rules)`
compiles (cached) and matches each regexp against the first ~512 bytes.

### Phase 2: Shebang / interpreter map
`parseShebang("#!/usr/bin/env python3")` → `python3`; `#!/bin/bash` → `bash`.
Map → modes. Register as a built-in magic rule that runs first.

### Phase 3: Mode self-registration
Each mode that has a distinctive header registers it:
`xml-mode`: `^<\?xml`; `html-mode`: `<!DOCTYPE html`; shell modes: shebang via
interpreter map. Done in the mode `.tlisp` via `(major-mode-magic ...)`.

### Phase 4: Wire precedence into major-mode-auto-detect
Filename → if no match → magic → if no match → default.

### Phase 5: User API
`(magic-mode-add REGEXP MODE)` + `(magic-mode-rules)`.

## Step by Step Tasks

### Task 1: detectMagicMode + MagicRule
**User Story**: As a developer, I want a tested content matcher.
- Implement `detectMagicMode` + `MagicRule` (regexp cache, match against buffer head).
- Unit-test: `<?xml` → (when registered) xml; no-match → undefined; multiline head.

**Acceptance Criteria**:
- [ ] Registered regexp `^<\?xml` matches a buffer starting with `<?xml version=`.
- [ ] No registered rule matches → `undefined`.
- [ ] Only the head of the buffer is scanned (bounded, no catastrophic backtracking).

### Task 2: Shebang + interpreter map
**User Story**: As a user, extension-less scripts detect by shebang.
- `parseShebang` extracts the interpreter (handles `/usr/bin/env X`).
- Built-in map: `bash`/`sh`→shell-script-mode, `python3`/`python`→python-mode,
  `node`→js/ts-mode, `ruby`→ruby-mode (only for modes that exist in tmax).
- Register as a magic rule.

**Acceptance Criteria**:
- [ ] `#!/usr/bin/env bash` (extension-less file) → shell mode
- [ ] `#!/bin/bash` → shell mode
- [ ] `#!/usr/bin/env node` → js-mode (if registered)
- [ ] No shebang → falls through

### Task 3: Mode self-registration + precedence
**User Story**: As a user, filename wins; content is the fallback.
- Modes register magic signatures.
- `major-mode-auto-detect`: filename first, then magic.
- Unit-test: `script.sh` with `<?xml` content → shell (filename wins); `data`
  with `<?xml` → xml (magic).

**Acceptance Criteria**:
- [ ] Filename match beats magic (`x.sh` + xml content → shell)
- [ ] No filename match → magic applies
- [ ] No magic match → falls to default-major-mode (SPEC-104) / fundamental

### Task 4: User API + validation
- `(magic-mode-add "^---\\b" "yaml")` registers a user rule; user rules win over fallback.
- `bun run typecheck`, `bun run build`, `bun test test/unit/magic-mode-detect.test.ts`.

**Acceptance Criteria**:
- [ ] User rule takes precedence over a conflicting fallback rule
- [ ] `(magic-mode-rules)` lists all rules

## Testing Strategy

### Unit Tests
`test/unit/magic-mode-detect.test.ts` — shebang variants, xml/html signatures,
user vs fallback precedence, filename-wins, no-match.

### Edge Cases
- Shebang with args (`#!/usr/bin/env python3 -u`) → interpreter still `python3`.
- Binary/empty file → no match, no crash.
- Magic regexp that could match far into a huge file → bounded scan.

## Acceptance Criteria (Completion)
- [ ] Extension-less shebang scripts detect by interpreter.
- [ ] `<?xml` / `<!DOCTYPE html` signatures detect (for registered xml/html modes).
- [ ] Filename detection wins when it matches.
- [ ] `(magic-mode-add REGEXP MODE)` works and user rules beat fallback.
- [ ] No regression to filename-based detection.

## Validation Commands
- `bun run typecheck`
- `bun run build`
- `bun test test/unit/magic-mode-detect.test.ts`
- Manual: `echo '#!/usr/bin/env bash' > ./deploy && chmod +x ./deploy && tmax ./deploy` → shell mode.

## Notes
- Emacs reference: `(elisp) Auto Major Mode` — `magic-mode-alist`,
  `magic-fallback-alist`, `interpreter-mode-alist`.
- Keep magic rules CONSERVATIVE and anchored (`^…`) to avoid false positives.
  Only ship rules for modes tmax actually has; unknown interpreters → fall through.
- Only registers modes that exist; this naturally depends on those major modes
  being present (shell, xml, html, js, python…). File follow-ups for any mode
  that should have a magic signature but lacks one.
