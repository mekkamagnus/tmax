# Feature: Daily Driver Blocking Features — Window Splits, Relative Line Numbers, Tabs

## Feature Description
Two blocking features required before tmax can serve as a daily driver text editor, following the Emacs architecture where T-Lisp owns editor logic and TypeScript owns display primitives:
1. **Window splitting and tabs** — visible multi-window layouts in the terminal, plus tab bar for buffer switching
2. **Relative line numbers** — line number gutter with relative mode (like vim's `relativenumber`) for efficient navigation

## User Story
As a **developer using tmax as my primary editor**
I want **split windows to view multiple files, relative line numbers for fast navigation, and tabs for buffer switching**
So that **tmax supports real editing workflows and matches vim/Emacs muscle memory**

## Problem Statement
- **Window splits**: The TypeScript API exists (`window-ops.ts`) but all logic is in TypeScript, contradicting tmax's architecture. The frontend renders only one window. No visual split rendering, no tab bar. Following Emacs: window logic should be T-Lisp (`window.el`), TypeScript should be a dumb display primitive (`window.c`).
- **Relative line numbers**: `EditorConfig.showLineNumbers` exists, `line-numbers-mode.tlisp` exists as a minor mode, but nothing renders a gutter. The TypeScript rendering layer doesn't read minor mode state. Following Emacs: the minor mode toggle is already T-Lisp, TypeScript just needs to render based on it.
- **Tabs**: No tab support exists. Following Emacs (`tab-bar.el`): tabs should be a T-Lisp abstraction over window configurations, with TypeScript only rendering the tab bar string.

## Architecture Principle

Following the Emacs C/Lisp split:
- **T-Lisp owns**: commands, modes, key bindings, tab management, window layout logic, configuration
- **TypeScript owns**: display primitives (render gutter, render window region, render tab bar string), terminal I/O

| Feature | Emacs Lisp % | T-Lisp (target) | TypeScript (target) |
|---|---|---|---|
| Window layout rules | ~90% | `commands/windows.tlisp` | `render/window-layout.ts` (cell math only) |
| Window split/close/navigate | ~90% | Calls TS primitives via API | Display primitives: allocate, render, resize |
| Tab management | ~99% | `commands/tabs.tlisp` | `components/TabBar.tsx` (render only) |
| Tab bar rendering | ~95% | Provides tab data, active index | Renders the string to terminal |
| Line number mode | ~40% | `modes/line-numbers-mode.tlisp` (exists!) | `render/gutter.ts` (exists!) |
| Gutter rendering | ~60% C | N/A | `render/gutter.ts` reads mode state |

## What Already Exists

### Done (from previous partial implementation)
- `src/frontend/render/gutter.ts` — Gutter renderer with absolute + relative modes
- `src/frontend/render/buffer-lines.ts` — Gutter integrated into buffer rendering
- `src/frontend/render/window-layout.ts` — Layout cell computation + separator rendering
- `src/frontend/components/TabBar.tsx` — Tab bar component (Ink + ANSI)
- `src/editor/api/tab-ops.ts` — Tab API (needs migration to T-Lisp)
- `src/editor/api/window-ops.ts` — Window API (needs migration to T-Lisp)
- `src/tlisp/core/modes/line-numbers-mode.tlisp` — Minor mode definition (exists)
- `src/core/types.ts` — `Tab` interface, `relativeLineNumbers` config, `Window` interface
- `src/editor/editor.ts` — `toggle-line-numbers`, `toggle-relative-line-numbers` T-Lisp functions

### Needs Fixing
- Line number rendering reads `state.config.showLineNumbers` instead of checking minor mode state
- Window/tab ops are TypeScript API files — should be T-Lisp libraries calling TS display primitives
- Multi-window rendering not wired into frontends
- TabBar not wired into frontends
- No `relative-line-numbers-mode.tlisp`
- No T-Lisp command libraries for windows or tabs

## Relevant Files

### TypeScript Display Primitives (keep/enhance)
- `src/frontend/render/gutter.ts` — Gutter rendering (exists, needs to read minor mode state)
- `src/frontend/render/buffer-lines.ts` — Buffer line rendering with gutter (exists)
- `src/frontend/render/window-layout.ts` — Window cell computation + separators (exists)
- `src/frontend/components/TabBar.tsx` — Tab bar rendering (exists)
- `src/core/types.ts` — `Window`, `Tab`, `EditorConfig` types (exists)

### T-Lisp Libraries (create)
- `src/tlisp/core/commands/windows.tlisp` — Window split/close/navigate commands
- `src/tlisp/core/commands/tabs.tlisp` — Tab management commands
- `src/tlisp/core/modes/relative-line-numbers-mode.tlisp` — Relative line numbers minor mode

### TypeScript API Surface (create)
- `src/editor/api/display-ops.ts` — Display primitives T-Lisp calls: `render-gutter`, `window-set-layout`, `tab-bar-render`

### Frontends (modify)
- `src/frontend/components/Editor.tsx` — Wire multi-window rendering
- `src/frontend/frontends/ink/components/Editor.tsx` — Wire multi-window rendering
- `src/frontend/frontends/steep/index.ts` — Wire multi-window rendering

### Key Bindings (T-Lisp)
- `src/tlisp/core/commands/windows.tlisp` — Contains `C-w s/v/w/q` bindings

## Implementation Plan

### Phase 1: Connect Line Numbers Mode to Rendering
Wire the existing `line-numbers-mode` T-Lisp minor mode to the existing gutter renderer. Add `relative-line-numbers-mode`.

### Phase 2: Window Display Primitives + T-Lisp Commands
Refactor window-ops.ts into thin display primitives. Create T-Lisp command library for window management. Wire multi-window rendering into frontends.

### Phase 3: Tab T-Lisp Commands + Display
Create T-Lisp tab library. Wire TabBar into frontends. Add key bindings.

## Step by Step Tasks

### Phase 1: Wire line-numbers-mode to gutter rendering
- Modify `renderBufferLines` in `src/frontend/render/buffer-lines.ts` to check `state.activeMinorModes` for `"line-numbers"` instead of `state.config.showLineNumbers`
- Modify `renderGutterLine` in `src/frontend/render/gutter.ts` to check `state.activeMinorModes` for `"relative-line-numbers"` instead of `state.config.relativeLineNumbers`
- Remove `toggle-line-numbers` and `toggle-relative-line-numbers` from `editor.ts` defineRaw calls (replaced by minor modes)
- Ensure `line-numbers-mode.tlisp` is loaded at startup (add to core mode loading)

### Phase 1: Create relative-line-numbers-mode.tlisp
- Create `src/tlisp/core/modes/relative-line-numbers-mode.tlisp`
- Define minor mode: `(define-minor-mode "relative-line-numbers" "Relative line numbers" "Rln" t)`
- Define toggle function following `line-numbers-mode.tlisp` pattern
- When enabled, also enable `line-numbers` mode

### Phase 1: Test
- Add unit test: enable `line-numbers` minor mode, verify gutter renders
- Add unit test: enable `relative-line-numbers` minor mode, verify relative gutter
- Run `bun test`

### Phase 2: Create display primitives API
- Create `src/editor/api/display-ops.ts`
- Expose `window-set-layout` — takes window cells from T-Lisp, stores in state
- Expose `window-get-cell` — returns cell dimensions for current window
- Expose `render-tab-bar` — returns rendered tab bar string
- Register in `editor.ts` alongside existing ops

### Phase 2: Refactor window-ops.ts
- Keep `window-ops.ts` but thin it to display primitives only: allocate window struct, set dimensions
- Move split/close/navigate logic to T-Lisp (`commands/windows.tlisp`)
- The TypeScript ops become: `window-allocate`, `window-deallocate`, `window-set-size`, `window-focus`

### Phase 2: Create T-Lisp window commands
- Create `src/tlisp/core/commands/windows.tlisp`
- Implement: `split-window-below`, `split-window-right`, `other-window`, `delete-window`, `balance-windows`
- These call the TypeScript display primitives via the T-Lisp API
- Add key bindings:
  ```lisp
  (key-bind "C-w s" "(split-window-below)" "normal")
  (key-bind "C-w v" "(split-window-right)" "normal")
  (key-bind "C-w w" "(other-window)" "normal")
  (key-bind "C-w q" "(delete-window)" "normal")
  ```
- Implement `editor-window-prefix` handler or use the key binding prefix mechanism

### Phase 2: Wire multi-window rendering
- Modify `renderBufferLines` to accept `WindowCell[]` and render each cell
- When `state.windows` has >1 window, use `computeLayout` to partition space
- Render each window's buffer into its cell with its own gutter and viewport
- Draw separators between cells
- Only focused window shows cursor highlight
- Update `Editor.tsx`, `ink/Editor.tsx`, `steep/index.ts` to pass window state to rendering

### Phase 2: Test
- Unit test: `computeLayout` with 1, 2, 3+ windows
- Unit test: multi-window rendering output with separators
- Integration test: `split-window-below` → visible split → `other-window` → focus changes → `delete-window`
- Run `bun test`

### Phase 3: Create T-Lisp tab commands
- Create `src/tlisp/core/commands/tabs.tlisp`
- Implement: `tab-new`, `tab-close`, `tab-next`, `tab-prev`, `tab-switch`, `tab-list`
- Each tab stores: name, associated buffer, window configuration
- Add key bindings:
  ```lisp
  (key-bind "gt" "(tab-next)" "normal")
  (key-bind "gT" "(tab-prev)" "normal")
  ```
- Remove `src/editor/api/tab-ops.ts` logic, replace with thin display primitive if needed

### Phase 3: Wire TabBar into frontends
- In each frontend, render `TabBar` when `state.tabs.length > 1`
- Subtract 1 row from editor area for tab bar
- TabBar reads `state.tabs` and `state.currentTabIndex`

### Phase 3: Test
- Unit test: tab API operations via T-Lisp interpreter
- Unit test: tab bar rendering
- Integration test: `tab-new` → tab bar shows → `tab-next` → switches → `tab-close`
- Run `bun test`

### Validation
- Run `bun test` — all tests pass, 0 failures
- Run `bun run start` — verify editor launches, line numbers visible
- Manual test: `M-x line-numbers-mode` toggles gutter on/off
- Manual test: `M-x relative-line-numbers-mode` switches to relative
- Manual test: `C-w s` creates visible horizontal split
- Manual test: `gt`/`gT` cycle tabs
- Manual test: open two files, split window, verify both visible

## Testing Strategy

### Unit Tests
- **Gutter renderer**: absolute mode, relative mode, gutter width, cursor line highlighting
- **Layout engine**: single window, horizontal split, vertical split, resize
- **Multi-window rendering**: correct cell rendering, separators, focused window highlight
- **Tab bar rendering**: active/inactive styling, label truncation, overflow

### Integration Tests
- Line numbers mode toggle → gutter appears/disappears
- Window split/close/navigate cycle via T-Lisp commands
- Tab create/close/navigate cycle via T-Lisp commands
- Multi-window rendering with gutters and separators

### Edge Cases
- Terminal resize with multiple windows
- Very long filenames in tab bar
- Buffer with 10,000+ lines (gutter width grows)
- Split with no buffer loaded
- Close last window / close last tab (no-op)
- Relative line numbers with cursor on first/last line

## Acceptance Criteria
- [ ] `line-numbers-mode` T-Lisp minor mode controls gutter visibility
- [ ] `relative-line-numbers-mode` T-Lisp minor mode switches gutter to relative
- [ ] Gutter width adapts to file size
- [ ] `C-w s` creates a visible horizontal split
- [ ] `C-w v` creates a visible vertical split
- [ ] `C-w w` cycles focus between windows
- [ ] `C-w q` closes the current window
- [ ] Window separators render (`─` and `│`)
- [ ] Window split/close/navigate logic is in T-Lisp (`commands/windows.tlisp`)
- [ ] Tab bar renders when >1 tab open
- [ ] Active tab visually distinct (inverse video)
- [ ] Tab operations are T-Lisp commands (`commands/tabs.tlisp`)
- [ ] `gt`/`gT` cycle tabs
- [ ] All existing tests still pass
- [ ] TypeScript provides only display primitives, not editor logic

## Validation Commands
- `bun test` — all tests pass, 0 failures
- `bun run start` — editor launches and is interactive
- `grep -r "split-window\|other-window\|delete-window" src/tlisp/core/` — window commands in T-Lisp
- `grep -r "tab-new\|tab-close\|tab-next" src/tlisp/core/` — tab commands in T-Lisp

## Notes
- `line-numbers-mode.tlisp` already exists at `src/tlisp/core/modes/line-numbers-mode.tlisp` — just needs wiring
- Window split API (`window-ops.ts`) already exists — refactor to thin primitives, move logic to T-Lisp
- `gutter.ts` and `window-layout.ts` already exist as display primitives — keep them
- The `Frame` interface (daemon/client architecture) may need window/tab state for multi-client support
- Consider `tab-bar-mode` as a minor mode for toggling tab bar visibility
- Follow the pattern in `src/tlisp/core/commands/isearch.tlisp` for T-Lisp command libraries
