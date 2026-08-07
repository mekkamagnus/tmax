# Feature: T1 Major modes — json, yaml, shell, toml (`#150`)

## Feature Description

Four "T1 ship-first" major modes from `docs/modes.md` are missing entirely
(❌). Each is an "S complexity" registration-only major mode — like the existing
`typescript-mode`/`python-mode` (registered, with indent hints) — so that opening
a `.json`/`.yaml`/`.toml`/`.sh` file activates the right mode and contributes
indent rules to the indent engine.

- **json-mode** — `.json`, `.jsonc`. Pure data; 2-space indent; bracket matching.
- **yaml-mode** — `.yaml`, `.yml`. Whitespace-sensitive indent (CI/CD, k8s, playbooks).
- **shell-mode (file editing)** — `.sh`, `.bash`, `.zsh`. `if`/`fi`, `case`/`esac`, `do`/`done`.
- **toml-mode** — `.toml`. `[section]` headers, `key = value`.

## User Story

As a tmax user editing config/data files,
I want the editor to recognize `.json`/`.yaml`/`.toml`/`.sh` files and indent them sensibly,
So that I get the right mode and indentation without manual setup.

## Problem Statement

These four extensions currently fall back to `fundamental-mode` (no indent rules).
`docs/modes.md` marks all four as T1 ship-first, S complexity, template
`typescript-mode`, blockers: none. They are pure registration work — the
`major-mode-register` primitive, auto-detect-on-open (`find-file.tlisp` calls
`major-mode-auto-detect`), and the indent engine all already exist.

Note: the project's syntax tokenizer (`src/syntax/language-registry.ts`) supports
only c/clj/clojure/cpp/go/h/javascript/jsx/lisp/markdown/python/tlisp/tsx/typescript
— **not** json/yaml/toml/shell. So these modes pass `nil` for `syntax-language`
(no tokenization); `major-mode-set`/`auto-detect` only call `syntax-set-language`
when a non-nil language is configured, so activation stays error-free. (Passing an
unsupported language would error in `syntax-set-language`.) This matches the
"registered with indent hints, no commands, no keymap" status of the existing
typescript/python/go/lisp modes (#151).

## Solution Statement

Add four mode files under `src/tlisp/core/modes/` modeled on `typescript-mode.tlisp`:

- `json-mode.tlisp`   — `(major-mode-register "json"   '(".json" ".jsonc") nil 'increase 'decrease)`
- `yaml-mode.tlisp`   — `(major-mode-register "yaml"   '(".yaml" ".yml")   nil 'increase 'decrease)`
- `shell-mode.tlisp`  — `(major-mode-register "shell"  '(".sh" ".bash" ".zsh") nil 'increase 'decrease)`
- `toml-mode.tlisp`   — `(major-mode-register "toml"   '(".toml")          nil 'increase 'decrease)`

Indent rules (regexes follow the existing convention: increase = matches the
PREVIOUS line → indent next line; decrease = matches the CURRENT line → dedent):

- **json**  increase `'("\\{$" "\\[$")`, decrease `'("^\\s*}" "^\\s*\\]")`.
- **yaml**  increase `'(":\\s*$" "-\\s*$")`, decrease `'()` (YAML dedent is indent-relative, not line-start-detectable).
- **shell** increase `'("\\bthen$" "\\bdo$" "\\bcase.*\\bin$" "\\{$" "\\($")`, decrease `'("^\\s*fi" "^\\s*esac" "^\\s*done" "^\\s*elif" "^\\s*else" "^\\s*then" "^\\s*\\)" "^\\s*\\}")`.
- **toml**  increase `'("\\[$")`, decrease `'("^\\s*\\]")` (arrays of tables only; key=value is flat).

Wire all four into startup via `(require-module editor/modes/json)` etc. in
`src/tlisp/core/bindings/normal.tlisp` (alongside the existing mode requires).
The module loader already maps `editor/modes/json` → `modes/json-mode.tlisp`
via its `modes/…-mode` fallback rule, so file naming follows `typescript-mode.tlisp`.

## Relevant Files

- `src/tlisp/core/modes/json-mode.tlisp` (NEW)
- `src/tlisp/core/modes/yaml-mode.tlisp` (NEW)
- `src/tlisp/core/modes/shell-mode.tlisp` (NEW)
- `src/tlisp/core/modes/toml-mode.tlisp` (NEW)
- `src/tlisp/core/bindings/normal.tlisp` — add 4 `require-module` lines.

## Implementation Plan

### Phase 1: mode files
- Create the four `*-mode.tlisp` files with `defmodule` + `major-mode-register` + `(provide "...-mode")`.

### Phase 2: startup wiring
- Add `(require-module editor/modes/json|yaml|shell|toml)` to `normal.tlisp`.

### Phase 3: tests
- `test/unit/t1-major-modes.test.ts`: for each mode, assert `(major-mode-list)` contains it, `(auto-mode-detect "<name>.<ext>")` returns it, and `(major-mode-set "<name>")` activates without error.

## Testing Strategy

### Unit Tests
- Registry presence (`major-mode-list`).
- Extension auto-detect (`auto-mode-detect`).
- Activation (`major-mode-set`) returns the mode name and does not error.

### Edge Cases
- Double extension variants (`.jsonc`, `.yml`, `.zsh`).
- Unknown extension falls back to `fundamental`.

## Acceptance Criteria

- [ ] `json-mode` is registered with `.json` + `.jsonc`; `auto-mode-detect "x.json"` → `json`.
- [ ] `yaml-mode` is registered with `.yaml` + `.yml`; `auto-mode-detect "x.yml"` → `yaml`.
- [ ] `shell-mode` is registered with `.sh` + `.bash` + `.zsh`; `auto-mode-detect "x.sh"` → `shell`.
- [ ] `toml-mode` is registered with `.toml`; `auto-mode-detect "x.toml"` → `toml`.
- [ ] All four appear in `(major-mode-list)`.
- [ ] `(major-mode-set "json"|"yaml"|"shell"|"toml")` activates without error (no `syntax-set-language` call since language is `nil`).
- [ ] Each mode file is loaded at startup (required from `normal.tlisp`) so the modes exist before any `find-file`.
- [ ] `bun run typecheck` clean; the new `t1-major-modes.test.ts` passes; `core-bindings.test.ts` still loads (no `.tlisp` parse errors).

## Validation Commands

- `bun run typecheck`
- `bun test test/unit/t1-major-modes.test.ts`
- `bun test test/unit/core-bindings.test.ts`

## Notes

- No syntax highlighting for these four (no tokenizer) — that's consistent with
  the registration-only status and out of scope (would be a separate
  language-registry addition). The indent rules are best-effort hints, exactly as
  typescript/python modes ship today.
- Buffer-local / electric-indent behavior depends on #149 (Phase 1.5 minor modes).
