# Chore: Codebase simplification pass

## Chore Description

Three automated reviews (code reuse, code quality, efficiency) of the last 10 commits identified 25+ findings across `src/` and `test/`. This chore deduplicates, consolidates, and fixes them. The work is ordered by impact: correctness bugs first, then render hot-path performance, then dead code and test cleanup.

## Relevant Files

- `src/tlisp/evaluator.ts` — evalAnd/evalOr double-evaluation bug, evalWhile/evalWhileAsync duplication
- `src/tlisp/evaluator-refactored.ts` — 2,414-line dead file, zero imports anywhere
- `src/editor/tlisp-api.ts` — fold API boilerplate, dead stub registrations (set-prefix, prefix-numeric-value)
- `src/editor/api/fold-ops.ts` — unnecessary Map allocations
- `src/editor/api/syntax-ops.ts` — duplicated language map
- `src/editor/api/text-objects.ts.bak` — stale backup file in source tree
- `src/editor/editor.ts` — duplicate set-prefix/prefix-numeric-value registrations
- `src/editor/handlers/insert-handler.ts` — ungated markdown-list-continue dispatch
- `src/editor/handlers/normal-handler.ts` — (editor as any) leaky abstraction
- `src/editor/handlers/visual-handler.ts` — (editor as any) leaky abstraction
- `src/editor/handlers/command-handler.ts` — (editor as any) leaky abstraction
- `src/syntax/highlight-buffer.ts` — duplicated language map
- `src/frontend/render/buffer-lines.ts` — linear fold scan, regex per line, state mutation in render, parameter sprawl
- `src/frontend/render/gutter.ts` — stringly-typed fold state
- `src/steep/oolong/wrap.ts` — O(N²) stripAnsi in word wrapping
- `src/core/types.ts` — unnecessary SPEC-reference comments, FoldState type
- `test/unit/markdown-commands.test.ts` — duplicate fold test coverage
- `test/unit/markdown-fold.test.ts` — partially overlapping with markdown-commands.test.ts (6 unique tokenizer tests)
- `test/unit/functional-patterns.test.ts.disabled` — dead test file alongside active version

## Step by Step Tasks

### Task 1: Fix evalAnd/evalOr double-evaluation bug

**User Story**: As a developer, I want `and`/`or` to evaluate each expression exactly once, so that side effects (like `set!`) are not silently doubled.

- In `src/tlisp/evaluator.ts`, find `evalAnd` and `evalOr`
- Both currently call `this.eval(expr, env)` then `this.evalInternal(expr!, env, false)` on the same expression — the first result is checked for errors but discarded, the second produces the value
- Fix: use a single `this.evalInternal` call, check the `EvalResult` for errors and TailCall, and trampoline TailCall results without re-evaluating the source expression
- Ensure `(and (progn (set! x (+ x 1)) true) x)` increments `x` exactly once

**Acceptance Criteria**:
- [ ] `evalAnd` and `evalOr` call `evalInternal` once per expression, not twice
- [ ] Existing `and`/`or` tests pass
- [ ] New test: side-effect expression in `and`/`or` executes exactly once

### Task 2: Extract shared language registry

**User Story**: As a developer adding a new language, I want to register it in one place, not update two identical maps in lockstep.

- Create `src/syntax/language-registry.ts` exporting a single `Map<string, SyntaxRule[]>` and the `extToLang` mapping
- Move language registrations from both `src/syntax/highlight-buffer.ts` and `src/editor/api/syntax-ops.ts` into the registry
- Both files import from the registry instead of building their own maps

**Acceptance Criteria**:
- [ ] Single canonical language map in `src/syntax/language-registry.ts`
- [ ] `highlight-buffer.ts` and `syntax-ops.ts` import from registry
- [ ] `bun run typecheck:src` passes
- [ ] `bun test test/unit/syntax/` passes

### Task 3: Consolidate fold state management

**User Story**: As a developer, I want fold state to live in one place without `as any` casts and manual copy-back.

- The fold API functions in `tlisp-api.ts` construct throwaway `{ foldRanges: state.foldRanges } as any`, call a fold-op, then manually copy `state.foldRanges = result.foldRanges` — repeated 8 times (fold-toggle, fold-open, fold-close, fold-close-all, fold-open-all, fold-by-level, fold-is-collapsed, fold-get-ranges)
- Extract a `withFoldState(fn)` helper that handles the inject-call-extract pattern
- Or: make fold-op functions accept `TlispEditorState` directly and operate on `state.foldRanges` in place, eliminating the intermediate object

**Acceptance Criteria**:
- [ ] No `as any` casts in fold API registrations
- [ ] Fold API registrations are one-liners delegating to helper
- [ ] All fold tests pass

### Task 4: Optimize render hot-path for fold checking

**User Story**: As a user editing a large markdown file, I want folding to not slow down rendering.

Currently three issues on the render hot path in `buffer-lines.ts`:

**4a. Linear fold scan per rendered line** — For each visible line, all fold ranges are iterated. Convert to O(1) by building a `Set<number>` of hidden lines once before the render loop.

**4b. Regex per rendered line** — `/^#{1,6}\s/.test(rawLine)` runs on every visible line. Replace with a manual prefix check (count 1-6 `#` chars followed by space).

**4c. State mutation in render** — `renderBufferLines` calls `.delete(foldStart)` on `state.foldRanges` to auto-expand folds. Move this logic to the cursor-movement handler so the render function is side-effect-free.

**4d. Parameter sprawl** — `renderSingleWindow` has 11 parameters (10 required + 1 optional). Introduce a `RenderContext` object grouping `highlightSpans`, `foldRanges`, `gutterCfg`, etc.

**Acceptance Criteria**:
- [ ] Hidden-line set built once, not per-line fold iteration
- [ ] No regex in per-line heading detection
- [ ] No state mutation in `renderBufferLines`
- [ ] `renderSingleWindow` takes a `RenderContext` object, not 11 positional params
- [ ] `bun test test/unit/render-visual.test.ts` passes

### Task 5: Remove dead stubs and unnecessary comments

**User Story**: As a developer reading the codebase, I want no dead code or spec-ticket comments that add noise.

- Remove `set-prefix` and `prefix-numeric-value` stub registrations from `tlisp-api.ts` (lines ~1012-1026) — they are immediately overwritten by the real implementations in `editor.ts`
- Remove spec-reference comments: SPEC-004, SPEC-035, SPEC-018, SPEC-025 in `types.ts`; SPEC-003 (×3), SPEC-035 (×5), SPEC-007, SPEC-013 (×2), SPEC-018 in `tlisp-api.ts`
- Remove `foldIsCollapsed`/`foldGetRanges` unnecessary `new Map()` allocations — use a module-level `EMPTY_MAP` constant
- Delete `src/tlisp/evaluator-refactored.ts` — 2,414 lines of dead code, zero imports anywhere in the codebase
- Delete `src/editor/api/text-objects.ts.bak` — stale backup alongside the active file
- Delete `test/unit/functional-patterns.test.ts.disabled` — dead test file alongside the active version

**Acceptance Criteria**:
- [ ] No `set-prefix`/`prefix-numeric-value` stubs in `tlisp-api.ts`
- [ ] No SPEC-ticket reference comments in `src/`
- [ ] No throwaway `new Map()` in `foldIsCollapsed`/`foldGetRanges`
- [ ] `evaluator-refactored.ts` deleted
- [ ] `.bak` and `.disabled` files removed from `src/` and `test/`

### Task 6: Merge and deduplicate markdown test files

**User Story**: As a developer maintaining tests, I don't want two files testing the same functions.

- `test/unit/markdown-fold.test.ts` has overlapping fold-ops tests with `test/unit/markdown-commands.test.ts`, plus 6 unique tokenizer tests ("tokenizes ATX headings", "tokenizes code fences", "tokenizes inline formatting", "tokenizes links", "tokenizes list items", "tokenizes blockquotes") that test `src/syntax/languages/markdown.ts` and `src/syntax/tokenizer.ts`
- Merge the 6 unique tokenizer tests into `markdown-commands.test.ts` (or a new `test/unit/markdown-tokenizer.test.ts` if keeping test files focused)
- Delete `markdown-fold.test.ts` after merge

**Acceptance Criteria**:
- [ ] `test/unit/markdown-fold.test.ts` deleted
- [ ] All unique test cases preserved in `markdown-commands.test.ts`
- [ ] `bun test test/unit/markdown-commands.test.ts` passes

### Task 7: Extract FoldState type and fix leaky abstraction

**User Story**: As a developer, I want typed fold states and no `as any` casts for major mode access.

- Define `type FoldState = "collapsed" | "expandable"` in `src/core/types.ts` and use it in `renderGutterLine` and `buffer-lines.ts` instead of inline string literals
- Add `getCurrentMajorMode(): string | undefined` to the Editor class's public interface (or the handler facade), and update all four handlers (`normal-handler.ts`, `insert-handler.ts`, `visual-handler.ts`, `command-handler.ts`) to use the typed method instead of `(editor as any).getCurrentMajorMode?.()`

**Acceptance Criteria**:
- [ ] `FoldState` type defined and used in render functions
- [ ] No `(editor as any).getCurrentMajorMode` in any handler
- [ ] `bun run typecheck:src` passes

### Task 8: Optimize word wrapping O(N²) stripAnsi

**User Story**: As a user, I want word wrapping to be fast even on long lines with ANSI codes.

- In `src/steep/oolong/wrap.ts`, `visualWidth(currentLine)` calls `stripAnsi(text).length` with a regex on each word-wrapping iteration, and `currentLine` grows — O(N²) total
- Fix: track accumulated visual width as a running integer. Compute each word's visual width once and add to the running total instead of recomputing from scratch

**Acceptance Criteria**:
- [ ] No `visualWidth(currentLine)` call inside the word-wrapping loop
- [ ] Running width tracked as integer
- [ ] `bun test test/unit/oolong/` passes

### Task 9: Gate markdown-list-continue behind mode check

**User Story**: As a user editing a non-markdown file, I want Enter to not dispatch a T-Lisp command through the full eval pipeline.

- In `insert-handler.ts`, the Enter key unconditionally calls `(markdown-list-continue)` which goes through full T-Lisp eval, only to early-return nil in non-markdown modes
- Add a TypeScript-level check: if current major mode is not `"markdown"`, skip the T-Lisp dispatch entirely

**Acceptance Criteria**:
- [ ] `(markdown-list-continue)` only dispatched when major mode is markdown
- [ ] Enter in non-markdown buffers skips T-Lisp eval
- [ ] `bun test test/unit/` passes

## Out of Scope

- `evalWhile`/`evalWhileAsync` sync/async duplication — systemic evaluator issue requiring async architecture decision; same pattern as Task 1 but touches the async evaluation path
- `findHeadingRanges` caching — requires buffer-change invalidation tracking, defer to a performance-focused spec
- `evaluator.ts` decomposition — at 4,916 lines it's the largest file by 2x; extracting stdlib method dispatch would improve maintainability but is a larger refactoring effort
- Incremental syntax highlighting — currently re-highlights entire viewport on every keystroke; would require line-state propagation tracking
- Website/docs changes — content files, not code
