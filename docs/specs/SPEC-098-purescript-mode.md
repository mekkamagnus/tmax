# Feature: purescript-mode — major mode for PureScript (.purs) (`#166`)

## Feature Description

A major mode for editing PureScript files (`.purs`). PureScript is a
strongly-typed, purely-functional language that compiles to JavaScript with
Haskell-derived syntax (significant whitespace, `::` type annotations, `where`
clauses, `do` notation, type classes).

Registration-only: extensions + indent rules + auto-detect. Syntax highlighting
requires a tokenizer (deferred — `nil` syntax-language). Follows the established
major-mode pattern (#150, #152, #154, ADR-0186/0188/0189).

## Acceptance Criteria

- [ ] `(auto-mode-detect "Main.purs")` → `"purescript"`
- [ ] `(major-mode-set "purescript")` activates without error
- [ ] purescript-mode appears in `(major-mode-list)`
- [ ] Loaded at startup (required from normal.tlisp)
- [ ] Indent rules (4-backslash escaped per ADR-0193): increase after `where`/`do`/`let`/`=`/`::`/`{`; decrease for `}`/`in`/`else`/`then`
- [ ] `bun run typecheck` clean; test passes; core-bindings green

## Validation Commands

- `bun run typecheck`
- `bun test test/unit/purescript-mode.test.ts`
- `bun test test/unit/core-bindings.test.ts`
