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
- `src/editor/utils/which-key.ts` — module-level mutable singleton, 12/17 dead exports
- `src/editor/auto-mode.ts` — regex recompiled per detectAutoMode call
- `src/editor/keymap-sync.ts` — debug logging in key dispatch hot path
- `src/editor/message-log.ts` — splice eviction contradicts ring-buffer design
- `src/editor/mode-loader.ts` — synchronous fs API, unused `feature` field
- `src/editor/mode-state.ts` — full spread copy on already-active minor mode
- `src/editor/remote-editor.ts` — double error handler during socket connect
- `src/syntax/highlight-buffer.ts` — duplicated language map
- `src/frontend/render/buffer-lines.ts` — linear fold scan, regex per line, state mutation in render, parameter sprawl
- `src/frontend/render/gutter.ts` — stringly-typed fold state
- `src/frontend/render/tab-bar.ts` — label.length counts UTF-16 not visible columns (BUG-09 regression)
- `src/frontend/render/window-layout.ts` — SplitNode type defined but unused, string slice+concat per row
- `src/steep/oolong/wrap.ts` — O(N²) stripAnsi in word wrapping
- `src/server/server.ts` — double frame sync, (this.editor as any) ×7, kill-buffer bypasses frame sync, direct globalEnv access, throwaway FileSystemImpl per RPC
- `src/core/filesystem.ts` — new FunctionalFileSystemImpl per isFile/isDirectory call
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

### Task 10: Fix tab-bar Unicode width regression

**User Story**: As a user with CJK/emoji filenames, I want the tab bar to align correctly.

- `src/frontend/render/tab-bar.ts` uses `label.length` (UTF-16 code units) and `display.length` for width calculations — this is the same bug fixed in BUG-09 for buffer-line rendering but missed in tab-bar
- Replace with `visualWidth()` (or the same width function used in buffer-lines) before truncation and segment width calculation

**Acceptance Criteria**:
- [ ] Tab bar uses visual width, not `.length`, for truncation and layout
- [ ] Wide-character filenames render without overflow

### Task 11: Fix server state mutation and frame sync correctness

**User Story**: As a developer, I want all server mutations to go through frame sync so clients stay consistent.

- `handleOpen`, `handleEval`, `handleInsert` call `syncEditorToFrame(frame)` then `syncEditorToAllFrames()` — the targeted frame gets synced twice (redundant deep clone). Skip the targeted frame in the all-frames sync, or remove the per-frame sync and rely on sync-all.
- `handleCommand` for `kill-buffer` retrieves `this.editor.getState().buffers` and calls `.delete()` directly, bypassing `setEditorState` and frame sync. After killing a buffer, frame-local state may still reference the deleted buffer.

**Acceptance Criteria**:
- [ ] No double-sync of the target frame in handleOpen/handleEval/handleInsert
- [ ] `kill-buffer` goes through setEditorState so frames are synced
- [ ] `bun test test/unit/` passes

### Task 12: Remove server `as any` casts and globalEnv coupling

**User Story**: As a developer, I want the server to go through typed interfaces so refactors don't silently break RPC handlers.

- `server.ts` has 7 instances of `(this.editor as any)` accessing `logMessage`, `ensureCoreBindingsLoaded`, `loadInitFile`, `messageLog` — add these to the Editor's public interface
- `server.ts` accesses `interpreter.globalEnv.lookup(...)` and `interpreter.globalEnv.bindings.forEach(...)` directly (lines ~1223, 1345, 1363, 1432) — expose typed query methods instead
- `handleOpen` creates a throwaway `new FileSystemImpl()` per call (line ~852) instead of reusing the server's existing `filesystem` instance

**Acceptance Criteria**:
- [ ] No `(this.editor as any)` in `server.ts`
- [ ] No direct `interpreter.globalEnv` access in `server.ts`
- [ ] `handleOpen` reuses existing `filesystem` instance
- [ ] `bun run typecheck:src` passes

### Task 13: Remove dead code from recent modules

**User Story**: As a developer, I want no dead exports, unused types, or stale variables in the codebase.

- `src/editor/utils/which-key.ts` — 12 of 17 exports are never imported (`getWhichKeyState`, `setWhichKeyTimeout`, `activateWhichKey`, `enableWhichKey`, `disableWhichKey`, `getWhichKeyTimeout`, `findNextLevelBindings`, `isPrefixKey`, `getDisplayKey`, `truncateDocumentation`, `getCommandDocumentation`, `findBindingsForPrefix`). Remove unused exports.
- `src/frontend/render/window-layout.ts` — `SplitNode` / `LayoutNode` type hierarchy (lines 10-18) is defined but `computeLayout` never uses it. Remove or connect.
- `src/editor/mode-loader.ts` — `ModeLoadResult.feature` field is never populated or read. Remove it.
- `src/server/server.ts` — `handleOpen` reads `const wait = params.wait ?? true` (line ~844) but never uses `wait`. Remove.

**Acceptance Criteria**:
- [ ] No unused exports in `which-key.ts`
- [ ] `SplitNode` type either used or removed
- [ ] `ModeLoadResult.feature` removed
- [ ] Dead `wait` variable removed from `server.ts`

### Task 14: Optimize hot-path allocations and regex

**User Story**: As a user, I want keystroke dispatch and mode detection to be fast with minimal GC pressure.

- `src/editor/auto-mode.ts` — `new RegExp(rule.pattern)` on every `detectAutoMode` call. Pre-compile regexp rules into `RegExp` objects at load time (store in `AutoModeRule`).
- `src/editor/keymap-sync.ts` — `logger.debug(...)` on every return path of `lookupKeyBinding` (lines 73, 89, 99, 107). Guard behind a log-level check so the string formatting and object allocation are skipped when not debugging.
- `src/core/filesystem.ts` — `isFile`/`isDirectory` create `new FunctionalFileSystemImpl()` per call. Use a module-level singleton or accept instance as parameter.
- `src/editor/message-log.ts` — `splice(0, n)` eviction is O(N). Replace with index-based ring buffer or at minimum use `shift()` (though that's also O(N), the real fix is a ring buffer index).

**Acceptance Criteria**:
- [ ] Auto-mode rules store pre-compiled `RegExp` objects
- [ ] Keymap-sync debug logging guarded behind level check
- [ ] `isFile`/`isDirectory` don't allocate per call
- [ ] Message log eviction is documented or improved

### Task 15: Fix which-key module-level mutable state

**User Story**: As a developer, I want which-key state scoped per editor, not shared globally via module singleton.

- `src/editor/utils/which-key.ts` stores `whichKeyState` as a module-level `let` variable (line 34). In the server's multi-frame architecture, multiple editor contexts share this singleton, causing state corruption.
- Move state into the Editor class or accept it as a parameter, so each editor instance has its own which-key state.

**Acceptance Criteria**:
- [ ] No module-level mutable state in `which-key.ts`
- [ ] Which-key state scoped to editor instance
- [ ] `bun test test/unit/` passes

## Out of Scope

- `evalWhile`/`evalWhileAsync` sync/async duplication — systemic evaluator issue requiring async architecture decision; same pattern as Task 1 but touches the async evaluation path
- `findHeadingRanges` caching — requires buffer-change invalidation tracking, defer to a performance-focused spec
- `evaluator.ts` decomposition — at 4,916 lines it's the largest file by 2x; extracting stdlib method dispatch would improve maintainability but is a larger refactoring effort
- Incremental syntax highlighting — currently re-highlights entire viewport on every keystroke; would require line-state propagation tracking
- `message-log.ts render()` full reformat on each call — minor unless called per-render; defer to render optimization pass
- `remote-editor.ts` double error handler during socket connect — minor, does not cause user-visible bugs
- `mode-state.ts` full spread copy on already-active minor mode — minor allocation, not on hot path
- `window-layout.ts` string slice+concat per row for separators — minor, O(height) small constant
- `mode-loader.ts` synchronous fs API — startup-only, consistent with Bun's sync-friendly model
- Website/docs changes — content files, not code
