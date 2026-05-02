---
scope: src/**/*.ts
---

# TypeScript Code Rules

Applies to all TypeScript source files in `src/`.

## Code Style

- Prefer arrow functions
- Include JSDoc comments for all functions
- Use TypeScript throughout
- Write simple, verbose code over terse, dense code
- Use the standard library where possible. Avoid external dependencies
- No external dependencies beyond Bun runtime

## Functional Programming

See `rules/functional-programming.md` for full FP patterns (Task, TaskEither, Result, Option, Pipeline, Reader/State monads, Validation).

Quick reference:
- Use `Option<T>`, `Either<L, R>`, `Result<T, E>`, `TaskEither<E, T>` — never raw throws or null
- Favor composition over inheritance
- Prefer immutable data and pure functions

## Bun Runtime

- Use `Bun.file()` instead of Deno/Node file APIs
- Use `fs/promises` for filesystem operations
- Use relative import paths (not Deno.land URLs)
- Use Bun-specific features: `Bun.spawn`, `Bun.write`
- Test syntax: `bun:test` (`describe`, `test`, `expect`)
- Replace `assertEquals` with `expect().toBe()`, `assertThrows` with `expect().toThrow()`
