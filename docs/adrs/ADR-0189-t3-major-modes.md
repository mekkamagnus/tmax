# ADR-0189 — T3 major modes: xml, c, cpp, java, sql (`#154`)

## Status

Accepted

## Context

`docs/modes.md` lists five T3 (low-frequency) major modes as missing (❌): xml,
c, cpp, java, sql. Without them those extensions fall back to `fundamental-mode`.
This completes the registration-only major-mode rollout started by T1 (#150) and
T2 (#152).

Unlike T1/T2, the syntax tokenizer (`src/syntax/language-registry.ts`) **does**
support `c` and `cpp` (and `h`), so c-mode and cpp-mode can pass a real
`syntax-language` and get font-lock highlighting on activation. xml/java/sql have
no tokenizer → `nil` (keeps `major-mode-set` error-free).

## Decision

Add five registration-only mode files modeled on `typescript-mode.tlisp`:
- **c-mode** / **cpp-mode** — `major-mode-register` with syntax-language `"c"` /
  `"cpp"` (real font-lock) + brace indent hints `\\{$` / `^\\s*}`.
- **java-mode** — `nil` syntax-language + brace indent hints.
- **xml-mode** — `nil` syntax-language + best-effort tag hints `>$` / `^\\s*</`
  (same heuristic as html-mode; full tag text objects are ROADMAP §1.9).
- **sql-mode** — `nil` syntax-language, flat (no nested-block indent heuristic).

Extensions: xml `.xml`/`.xsd`/`.xsl`/`.svg`/`.plist`; c `.c`/`.h`; cpp
`.cpp`/`.cc`/`.cxx`/`.hpp`/`.hh`/`.hxx`; java `.java`; sql `.sql`/`.psql`.

Wire all five into startup via `(require-module editor/modes/…)` in `normal.tlisp`.

## Consequences

- 16 more file extensions now auto-detect to the right mode; C/C++ files
  additionally get real syntax highlighting on open (tokenizers existed but were
  unreachable without a mode binding them).
- xml/java/sql are registration-only (no tokenizer); full electric/tag behavior
  is Phase 1.5 (#149/#151, ROADMAP §1.9).
- This completes the major-mode registration coverage for every language listed
  in `docs/modes.md` (fundamental + typescript/python/lisp/go/markdown from
  earlier + json/yaml/shell/toml #150 + text/conf/css/html/rust/dockerfile #152
  + xml/c/cpp/java/sql here).
- Verify-gate (SPEC-091): **PASS** — all acceptance criteria met.
