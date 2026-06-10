# Chore: Codebase simplification pass

## Chore Description

Three automated reviews (code reuse, code quality, efficiency) of the last 10 commits identified 25+ findings across `src/` and `test/`. This chore deduplicates, consolidates, and fixes them. The work is ordered by impact: correctness bugs first, then render hot-path performance, then dead code and test cleanup.

## Relevant Files

- `src/tlisp/evaluator.ts` — evalAnd/evalOr double-evaluation bug, evalWhile/evalWhileAsync duplication
- `src/editor/tlisp-api.ts` — fold API boilerplate, dead stub registrations (set-prefix, prefix-numeric-value)
- `src/editor/api/fold-ops.ts` — unnecessary Map allocations
- `src/editor/api/syntax-ops.ts` — duplicated language map
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
- `test/unit/markdown-fold.test.ts` — near-subset of markdown-commands.test.ts

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

- The fold API functions in `tlisp-api.ts` construct throwaway `{ foldRanges: state.foldRanges } as any`, call a fold-op, then manually copy `state.foldRanges = result.foldRanges` — repeated 7 times
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

**4d. Parameter sprawl** — `renderSingleWindow` now has 10 parameters. Introduce a `RenderContext` object grouping `highlightSpans`, `foldRanges`, `gutterCfg`, etc.

**Acceptance Criteria**:
- [ ] Hidden-line set built once, not per-line fold iteration
- [ ] No regex in per-line heading detection
- [ ] No state mutation in `renderBufferLines`
- [ ] `renderSingleWindow` takes a `RenderContext` object, not 10 positional params
- [ ] `bun test test/unit/render-visual.test.ts` passes

### Task 5: Remove dead stubs and unnecessary comments

**User Story**: As a developer reading the codebase, I want no dead code or spec-ticket comments that add noise.

- Remove `set-prefix` and `prefix-numeric-value` stub registrations from `tlisp-api.ts` (lines ~661-675) — they are immediately overwritten by the real implementations in `editor.ts`
- Remove spec-reference comments: `// Fold state (SPEC-018)` in `types.ts`, `// Fold operations (SPEC-018)` in `tlisp-api.ts`, `;; ... (SPEC-018)` in `markdown-mode.tlisp`
- Remove WHAT-comments in `buffer-lines.ts`: `// Check if this line is inside a collapsed fold`, `// Check if this line is the start of a fold`, etc.
- Remove `foldIsCollapsed`/`foldGetRanges` unnecessary `new Map()` allocations — use a module-level `EMPTY_MAP` constant

**Acceptance Criteria**:
- [ ] No `set-prefix`/`prefix-numeric-value` stubs in `tlisp-api.ts`
- [ ] No SPEC-ticket reference comments in `src/`
- [ ] No WHAT-comments in `buffer-lines.ts` fold section
- [ ] No throwaway `new Map()` in `foldIsCollapsed`/`foldGetRanges`

### Task 6: Consolidate duplicate test files

**User Story**: As a developer maintaining tests, I don't want two files testing the same functions.

- `test/unit/markdown-fold.test.ts` is a strict subset of `test/unit/markdown-commands.test.ts` (same `makeState`, same `foldToggle`/`foldOpen`/`foldClose`/`foldCloseAll`/`foldOpenAll`/`foldByLevel`/`foldIsCollapsed`/`foldGetRanges`/`findHeadingRanges` tests)
- Delete `markdown-fold.test.ts` — its coverage is fully covered by `markdown-commands.test.ts`
- If `markdown-fold.test.ts` has any unique test case not in `markdown-commands.test.ts`, merge it first

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

- `evalWhile`/`evalWhileAsync` sync/async duplication — systemic evaluator issue, not from this changeset
- `findHeadingRanges` caching — requires buffer-change invalidation tracking, defer to a performance-focused spec
- Website/docs changes — content files, not code
