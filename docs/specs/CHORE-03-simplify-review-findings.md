# Chore: Consolidate Duplicated Utilities and Fix Code Review Findings

## Chore Description
Three parallel code review agents (reuse, quality, efficiency) identified duplicated utility functions, unnecessary full-buffer reads, and minor code quality issues across the editor API layer. This chore consolidates those findings into actionable fixes:

1. **Extract shared text utilities** — `isWordChar`, `findFirstNonBlankColumn`, and `findWordEnd` are copy-pasted across 6, 3, and 5 files respectively. Extract them into a single shared module.
2. **Fix `lspDiagnosticsCount`** — iterates diagnostics array 4 times when a single pass would suffice.
3. **Remove dead default state** in `RemoteEditor.cachedState`.
4. **Reuse shared render logic in Ink StatusLine** — duplicates the `modeDisplay` mapping already in `src/frontend/render/status-line.ts`.

Findings already fixed in the same session (not included): `delete-char` register mutation, dead aliases in `undo-redo-ops.ts`, unused `_displayKey` param, `any`-typed server params, unused `TLispFunctionWithEither` exports.

## Relevant Files

### New Files
- `src/editor/api/text-utils.ts` — shared utility module containing `isWordChar`, `findFirstNonBlankColumn`, `findWordEnd` (and `findWordEndWithSpace` variant)

### Files to Modify
- `src/editor/api/change-ops.ts` — remove local `isWordChar` (line 35), `findWordEnd` (line 43), import from `text-utils.ts`
- `src/editor/api/delete-ops.ts` — remove local `isWordChar` (line 67), `findWordEnd` (line 75), inline `findFirstNonBlankColumn` (line 499-502), import from `text-utils.ts`
- `src/editor/api/yank-ops.ts` — remove local `isWordChar` (line 67), `findWordEnd` (line 75), import from `text-utils.ts`
- `src/editor/api/word-ops.ts` — remove local `isWordChar` (line 43), `findWordEnd` (line 180), import from `text-utils.ts`
- `src/editor/api/search-ops.ts` — remove local `isWordChar` (line 486), import from `text-utils.ts`
- `src/editor/api/text-objects.ts` — remove local `isWordChar` (line 48), `findWordEnd` (line 87), `findWordEndWithSpace` (line 112), import from `text-utils.ts`
- `src/editor/api/jump-ops.ts` — remove local `findFirstNonBlankColumn` (line 35), import from `text-utils.ts`
- `src/editor/api/line-ops.ts` — remove local `findFirstNonBlankColumn` (line 34), import from `text-utils.ts`
- `src/editor/api/lsp-diagnostics.ts` — refactor `lspDiagnosticsCount` to single-pass iteration
- `src/editor/remote-editor.ts` — remove dead hardcoded default state in constructor (lines 20-37)
- `src/frontend/frontends/ink/components/StatusLine.tsx` — import `modeDisplay` from shared render module instead of duplicating

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Create `src/editor/api/text-utils.ts`
- Copy the canonical implementations of these functions from the existing files:
  - `isWordChar(char: string): boolean` — use the version from `word-ops.ts` (line 43)
  - `findFirstNonBlankColumn(lineText: string): number` — use the version from `line-ops.ts` (line 34)
  - `findWordEnd(text: string, line: number, column: number): Either<string, { line: number; column: number }>` — use the version from `word-ops.ts` (line 180)
  - `findWordEndWithSpace(text: string, line: number, column: number): Either<string, { line: number; column: number }>` — use the version from `text-objects.ts` (line 112), if it differs from `findWordEnd`
- Export all four functions
- Add necessary imports (`Either` from the FP module)

### Replace local definitions with imports in all 8 consumer files
- For each file in `change-ops.ts`, `delete-ops.ts`, `yank-ops.ts`, `word-ops.ts`, `search-ops.ts`, `text-objects.ts`, `jump-ops.ts`, `line-ops.ts`:
  - Add `import { ... } from "./text-utils.ts"` for the functions that file needs
  - Remove the local function definitions
  - Verify no other local code depends on the removed definitions (e.g., closures capturing local vars)

### Replace inline `findFirstNonBlankColumn` in `delete-ops.ts`
- At line ~499-502, replace the hand-rolled loop with a call to `findFirstNonBlankColumn(targetLineText)`

### Refactor `lspDiagnosticsCount` in `lsp-diagnostics.ts`
- Replace the 4 separate `.filter().length` calls with a single `reduce` or loop that counts errors, warnings, infos, and hints in one pass

### Remove dead default state in `remote-editor.ts`
- Remove or simplify the hardcoded default `cachedState` object in the constructor (lines 20-37). Since `start()` always overwrites it before any caller accesses it, the default is never observed. Initialize to `null` or a minimal placeholder and let `start()` set the real state.

### Reuse shared `modeDisplay` in Ink StatusLine
- In `src/frontend/frontends/ink/components/StatusLine.tsx`, remove the local mode-to-color mapping (lines 24-28)
- Import `modeDisplay` from `src/frontend/render/status-line.ts` and use it instead

### Run Validation Commands
- Run the validation commands below and confirm zero regressions

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bunx tsc --noEmit 2>&1 | grep -v 'scripts/' | grep -v 'debug-' | grep -v 'test-.*\.ts:' | grep -E 'error TS' | wc -l` — Count TS errors in src/ only (scripts/ and debug files have pre-existing errors). Must be 0 or match pre-existing count.
- `bun test test/unit/ 2>&1 | tail -5` — Run all unit tests. Must show same pass/fail counts as before (currently 30 pass, 5 pre-existing fails).
- `rg 'function isWordChar' src/editor/api/ --count` — Must return only `text-utils.ts` (1 definition, not 6).
- `rg 'function findFirstNonBlankColumn' src/editor/api/ --count` — Must return only `text-utils.ts` (1 definition, not 2).
- `rg 'function findWordEnd' src/editor/api/ --count` — Must return only `text-utils.ts` (1-2 definitions, not 5+).

## Notes
- The `findWordEndWithSpace` variant in `text-objects.ts` may differ slightly from `findWordEnd`. Check the implementation before merging — if the difference is meaningful, export both as named functions; if not, add an optional `includeSpace` parameter.
- The `delete-*` full-buffer reads (efficiency findings #1-3) and `editorStateToJson` full-serialization are architectural issues requiring a new `getLine()` buffer API. These are out of scope for this chore — they should be addressed in a separate feature spec.
- The `operations?` optional typing in `editor-state.ts` is a new untracked file — not touched by this chore.
- Test mock duplication across test files is a separate concern and not addressed here.
