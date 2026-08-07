# ADR-0186 — T1 major modes: json, yaml, shell, toml (`#150`)

## Status

Accepted

## Context

`docs/modes.md` lists four "T1 ship-first" major modes as missing (❌): json,
yaml, shell (file editing), and toml. Each is "S complexity", template
`typescript-mode`, blockers: none. Without them, opening `.json`/`.yaml`/`.toml`/
`.sh` files falls back to `fundamental-mode` (no indent rules, no recognition).

The infrastructure already exists: `major-mode-register` (registry + auto-mode
rules), `find-file.tlisp` calls `(major-mode-auto-detect)` on open, and the
indent engine consumes `indent-set-rules`. So the work is pure registration,
exactly the shape of the existing `typescript-mode.tlisp` / `python-mode.tlisp`
(registered with indent hints, no commands, no keymap).

One constraint surfaced: the syntax tokenizer
(`src/syntax/language-registry.ts`) only supports c/clj/clojure/cpp/go/h/
javascript/jsx/lisp/markdown/python/tlisp/tsx/typescript — **not** json/yaml/
toml/shell. `syntax-set-language` errors on an unknown language, and
`major-mode-set`/`auto-detect` call it whenever a mode's `syntaxLanguage` is set.
So all four modes pass `nil` for `syntax-language`; activation then skips
tokenization entirely and stays error-free.

## Decision

Add four registration-only mode files under `src/tlisp/core/modes/`, each calling
`(major-mode-register NAME EXTENSIONS nil INDENT-INCREASE INDENT-DECREASE)` with
`nil` syntax-language, plus a `(provide "<name>-mode")`. Wire them into startup
with `(require-module editor/modes/{json,yaml,shell,toml})` in `normal.tlisp`.
The module loader's `modes/…-mode` fallback rule resolves
`editor/modes/json` → `modes/json-mode.tlisp`, so file naming follows
`typescript-mode.tlisp`.

Indent rules follow the existing convention (increase = match PREVIOUS line →
indent next; decrease = match CURRENT line → dedent):

- **json** — `\\{$`/`\\[$` increase; `^\\s*}`/`^\\s*\\]` decrease.
- **yaml** — `:\\s*$`/`-\\s*$` increase; no decrease (YAML dedent is
  indent-relative, not line-start-detectable — left to manual `<<`/`<BS>`).
- **shell** — `\\bthen$`/`\\bdo$`/`\\bcase.*\\bin$`/`\\{$`/`\\($` increase;
  `^\\s*fi`/`esac`/`done`/`elif`/`else`/`then`/`\\)`/`\\}` decrease.
- **toml** — `\\[$` increase; `^\\s*\\]` decrease (arrays of tables only).

These are best-effort hints — identical in status to the indent regexes
typescript/python modes already ship.

## Consequences

- `.json`/`.jsonc`/`.yaml`/`.yml`/`.sh`/`.bash`/`.zsh`/`.toml` files now
  auto-detect to the right mode and contribute indent hints.
- No syntax highlighting for these four (no tokenizer); consistent with their
  registration-only status. Adding tokenizers is a separate language-registry
  task, out of scope.
- The real electric-indent / show-paren / electric-pair behavior for code modes
  still depends on #149 (Phase 1.5 minor modes).
- **Latent naming hazard (tracked, not blocking):** this file-editing mode is
  registered as `"shell"`. The interactive terminal-emulator mode (#155) is also
  referred to as "shell-mode". If #155 registers a major mode named `"shell"`,
  `mm.registry.set(name, …)` would overwrite this one. When #155 lands it should
  use a distinct name (e.g. `shell-script-mode` here, or `term-shell-mode` there).
- Verify-gate (SPEC-089): **PASS** — all 8 acceptance criteria met.
