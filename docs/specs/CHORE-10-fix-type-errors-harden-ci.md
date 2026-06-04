# Chore: Fix All Type Errors and Harden Against Future Leaks

## Chore Description

tmax has **621 TypeScript errors across 75 source files** (`bunx tsc --noEmit`), yet all 1575 tests pass. This happened because:

1. **Bun ignores TypeScript errors.** Bun strips types at runtime without checking them. `bun test` and `bun run start` work perfectly despite type errors.
2. **No CI pipeline exists.** There are no GitHub Actions workflows, no pre-commit hooks, no Makefile lint targets.
3. **No `typecheck` script in package.json.** The only scripts are `start`, `test`, `dev`, `tui` — none run `tsc --noEmit`.
4. **`tsconfig.json` includes test files.** The `include` glob catches `test/**/*` and `scripts/**/*`, inflating the error count with test-only issues. These should be excluded from the production typecheck.

The errors fall into 4 categories:

| Category | Count | Root Cause | Fix |
|---|---|---|---|
| `TLispFunctionImpl` signature mismatch | 306 | API files return `Either<AppError, ...>` but type expects `Either<EvalError, ...>` | Widen `TLispFunctionImpl` to use `AppError` |
| `LogContext` missing `data` property | 40 | Code passes `{ data: ... }` but `LogContext` has no `data` field | Add `data` to `LogContext` interface |
| Missing imports / wrong names | 29 | `TLispValue`, `valueToString`, `createChild`, `docstring` not imported or not on type | Add missing imports, fix property access |
| Real type errors (wrong args, missing properties, etc.) | 246 | Various: unknown casts, wrong enum variants, missing overloads | Fix individually per file |

**This chore:**
1. Fixes all 621 errors in `src/`
2. Adds a `typecheck` script to `package.json`
3. Creates a GitHub Actions CI workflow
4. Adds a pre-commit hook via `bun run typecheck`
5. Documents the lesson in `docs/learnings.md`

## Relevant Files

### Root Cause Files
- `src/tlisp/types.ts:84` — `TLispFunctionImpl` defined as `(args: TLispValue[]) => Either<EvalError, TLispValue>` but API files return `Either<AppError, TLispValue>`
- `src/utils/logger.ts:25` — `LogContext` interface missing `data` property that 40 call sites pass
- `src/error/types.ts:69` — `AppError` is a superset of `EvalError` (the fix: use `AppError` in `TLispFunctionImpl`)
- `package.json` — Missing `typecheck` script, no lint/typecheck hooks
- `tsconfig.json` — `include` catches test files (should exclude for production typecheck)

### API Files (all use the wrong `Either<AppError>` pattern — fixed by root cause change)
- `src/editor/api/*.ts` (all 30+ files) — Register T-Lisp API functions with `Either<AppError, TLispValue>` return type

### Files with Remaining Real Errors (246 errors across 51 files)
- `src/core/filesystem.ts` — wrong error variants, overload mismatches
- `src/core/terminal.ts` — `readOnce` missing on type, implicit `any`
- `src/core/mod.ts` — duplicate re-exports
- `src/constants/index.ts` — duplicate export `MAX_UNDO_LEVELS`
- `src/editor/editor.ts` — unknown casts, LogContext issues, position type mismatches
- `src/editor/tlisp-api.ts` — `TLispInterpreterImpl` not assignable to `TLispInterpreter`
- `src/editor/handlers/*.ts` — various type mismatches
- `src/frontend/**/*.tsx` — React component prop type issues
- `src/lsp/client.ts` — unknown property access
- `src/server/server.ts` — unknown property access
- `src/tlisp/*.ts` — evaluator/interpreter type issues, missing imports
- `src/utils/*.ts` — utility type issues (lens, option, pipeline, etc.)

### New Files
- `.github/workflows/ci.yml` — GitHub Actions CI workflow
- `.husky/pre-commit` — Pre-commit hook (or simple git hook script)

## Step by Step Tasks

### 0. Document the Lesson

- Add to `docs/learnings.md`:
  ```
  ## Type Safety: Bun does not enforce TypeScript

  Bun strips types at runtime without checking them. `bun test` and `bun run start`
  pass even with hundreds of type errors. ALWAYS run `bunx tsc --noEmit` (or the
  `typecheck` script) after changes. The CI pipeline enforces this, but run it
  locally before pushing.

  **Rule:** Every PR must pass `bun run typecheck` with zero errors.
  ```

### 1. Fix Root Cause #1: Widen `TLispFunctionImpl`

- In `src/tlisp/types.ts:84`, change:
  ```typescript
  // FROM:
  export type TLispFunctionImpl = (args: TLispValue[]) => Either<EvalError, TLispValue>;
  // TO:
  export type TLispFunctionImpl = (args: TLispValue[]) => Either<AppError, TLispValue>;
  ```
- Add `import type { AppError } from "../error/types.ts";` to the imports
- This fixes ~306 errors across all API files in one change
- Run `bunx tsc --noEmit 2>&1 | grep "error TS" | grep "^src/" | grep -v "TS5097" | wc -l` to verify the drop

### 2. Fix Root Cause #2: Add `data` to `LogContext`

- In `src/utils/logger.ts:25`, add to the `LogContext` interface:
  ```typescript
  /** Arbitrary data payload */
  data?: unknown;
  ```
- This fixes ~40 errors across editor and API files

### 3. Fix Remaining Import/Name Errors

- `src/editor/api/documentation.ts` — add missing import for `TLispValue` from `../../tlisp/types.ts`
- `src/tlisp/test-framework.ts` — add missing import for `valueToString` (find where it's exported)
- `src/editor/api/evil-integration.ts` — fix `createChild` property access on `TLispEnvironment` (check the actual method name)
- `src/editor/api/documentation.ts`, `src/editor/api/plugin-ops.ts`, etc. — fix `.docstring` access on `TLispValue` (need type guard or cast through `TLispFunction`)

### 4. Fix `src/core/filesystem.ts` Errors

- Fix error variant names: add missing variants to the relevant error types, or use the correct existing variants
  - `"CreateDirError"` → use a valid `FileSystemError` variant or add it
  - `No overload matches` calls → fix function signatures to match overloads
- Fix the `fileExists` chain that returns incompatible union types

### 5. Fix `src/core/terminal.ts` Errors

- Fix `readOnce` property — check if this is a Bun-specific API that needs `@types/bun` or a type assertion
- Fix implicit `any` parameters — add explicit types
- Fix `boolean` not assignable to `Interface` — correct the argument types

### 6. Fix `src/core/mod.ts` and `src/constants/index.ts` Duplicate Exports

- `src/core/mod.ts` — Remove duplicate re-exports of `FunctionalTerminalIO`, `TerminalError`, `FunctionalFileSystem`, `BufferError` (export from one source only)
- `src/constants/index.ts` — Remove duplicate `MAX_UNDO_LEVELS` export

### 7. Fix `src/editor/editor.ts` Errors

- Fix `unknown` type assertions — add type guards or explicit casts where the type is genuinely known
- Fix position type mismatches (`string` vs `Position`)
- Fix `LogContext` usage (already addressed in step 2 for the `data` property)

### 8. Fix `src/editor/tlisp-api.ts` Interface Compatibility

- Fix `TLispInterpreterImpl` not assignable to `TLispInterpreter` — the `eval()` return types differ. Either:
  - Update `TLispInterpreter` interface to match the impl, or
  - Update `TLispInterpreterImpl` to satisfy the interface

### 9. Fix `src/tlisp/` Internal Errors

- `src/tlisp/evaluator.ts` and `evaluator-refactored.ts` — fix `Either<string, TLispValue>` vs `Either<AppError, TLispValue>` mismatch
- `src/tlisp/interpreter.ts` — fix `TLispValue` not assignable to `Either<EvalError, TLispValue>`
- `src/tlisp/parser.ts` — fix type errors
- `src/tlisp/stdlib.ts` — fix type errors
- `src/tlisp/test-*.ts` — fix missing method names (`getSuiteDefinition` → `getTestDefinition`), missing imports

### 10. Fix `src/utils/` Errors

- `src/utils/lens.ts` — fix `OptionWithMethods<never>` not assignable to `Option<T>`
- `src/utils/option.ts` — fix type parameter issues
- `src/utils/pipeline.ts` — fix `ReaderTaskEither` not matching `TaskEither`
- `src/utils/reader.ts` — fix type errors
- `src/utils/save-operations.ts` — fix `TaskEither<SaveError, unknown>` not assignable to `TaskEither<never, unknown>`
- `src/utils/state.ts` — fix type errors
- `src/utils/validation.ts` — fix type errors

### 11. Fix `src/frontend/` Errors

- `src/frontend/components/Editor.tsx` and `StatusLine.tsx` — fix React prop type issues
- `src/frontend/frontends/ink/` — fix Ink component prop types
- `src/frontend/render/status-line.ts` — fix type mismatches

### 12. Fix `src/lsp/client.ts` and `src/server/server.ts` Errors

- Fix `unknown` type property access — add type guards or interfaces for request/response shapes
- Fix missing property access patterns

### 13. Fix `src/main.tsx` Errors

- Fix any remaining import or type issues in the entry point

### 14. Add `typecheck` Script to `package.json`

- Add to `scripts`:
  ```json
  "typecheck": "bunx tsc --noEmit",
  "typecheck:src": "bunx tsc --noEmit --project tsconfig.src.json"
  ```
- Create `tsconfig.src.json` that includes only `src/**/*` (excludes test files) for fast source-only checking:
  ```json
  {
    "extends": "./tsconfig.json",
    "include": ["src/**/*"],
    "exclude": ["test/**/*", "scripts/**/*"]
  }
  ```

### 15. Create GitHub Actions CI Workflow

- Create `.github/workflows/ci.yml`:
  ```yaml
  name: CI
  on: [push, pull_request]
  jobs:
    typecheck:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: oven-sh/setup-bun@v2
        - run: bun install
        - run: bun run typecheck
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: oven-sh/setup-bun@v2
        - run: bun install
        - run: bun test
  ```

### 16. Add Pre-Commit Typecheck Hook

- Create a simple git hook at `.git/hooks/pre-commit` (or use a setup script):
  ```bash
  #!/bin/sh
  echo "Running typecheck..."
  bun run typecheck:src
  if [ $? -ne 0 ]; then
    echo "Type errors found. Fix them before committing."
    exit 1
  fi
  ```
- Add a `setup-hooks` script to `package.json`:
  ```json
  "postinstall": "cp .githooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit"
  ```
- Create `.githooks/pre-commit` with the typecheck command

### 17. Final Validation

- Run validation commands below and confirm zero errors

## Validation Commands

- `bunx tsc --noEmit 2>&1 | grep "error TS" | grep "^src/" | grep -v "TS5097" | wc -l` — Must output `0` (zero source type errors, excluding the Bun import extension issue)
- `bunx tsc --noEmit --project tsconfig.src.json 2>&1 | grep "error TS" | wc -l` — Must output `0` (source-only typecheck passes clean)
- `bun test` — All 1575+ tests pass with zero failures
- `bun run typecheck` — Exits with code 0
- `bun run typecheck:src` — Exits with code 0

## Notes

### Why this happened

Bun is a TypeScript runtime that strips types without checking them. This is by design — Bun prioritizes speed. But it means `bun test` and `bun run start` work perfectly even when `tsc --noEmit` shows hundreds of errors. The project never had a CI pipeline or pre-commit hook to run `tsc`, so errors accumulated silently across many development sessions.

### The `.ts` import extension issue (TS5097)

~1,800 errors are `TS5097: An import path can only end with a '.ts' extension`. These are a Bun convention (Bun requires `.ts` extensions in imports) that `tsc` doesn't support by default. These are NOT real errors — Bun handles them. The `tsconfig.src.json` approach (or adding `"allowImportingTsExtensions": true` to tsconfig) resolves this. Do NOT remove `.ts` extensions from imports — Bun needs them.

### Strategy for the fix

The fix is structured as:
1. **Two root cause changes** (steps 1-2) that eliminate ~346 errors (56%) in two line changes
2. **Import/name fixes** (step 3) that eliminate ~29 more errors
3. **Per-file fixes** (steps 4-13) for the remaining ~246 errors — these are individual type mismatches
4. **Hardening** (steps 14-16) to prevent regression

### Error count budget

| Step | Errors Fixed | Remaining |
|---|---|---|
| Start | 621 | 621 |
| Step 1: TLispFunctionImpl | -306 | 315 |
| Step 2: LogContext data | -40 | 275 |
| Step 3: Import/name fixes | -29 | 246 |
| Steps 4-13: Per-file fixes | -246 | 0 |

### Estimated effort

- Steps 1-3 (root causes): ~1 hour
- Steps 4-13 (per-file): ~4-6 hours (mechanical but numerous)
- Steps 14-16 (hardening): ~1 hour
- **Total: ~6-8 hours**
