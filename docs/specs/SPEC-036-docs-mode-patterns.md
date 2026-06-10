# Feature: Documentation — Emacs-Style Mode Pages with Keybinding Tables

## Feature Description

Restructure the website editing documentation to follow Emacs documentation conventions: one overview page explaining the mode system mechanism, individual pages for each major mode with comprehensive keybinding tables, and a unified reference for minor modes. The current single-page approach (`website/app/docs/editing/page.tsx`, 343 lines) compresses all five modes into one file with incomplete keybinding coverage.

## User Story

As a user learning tmax
I want mode documentation organized as one page per mode with complete keybinding tables
So that I can quickly find every key available in the mode I'm currently using without scrolling through unrelated content

## Problem Statement

The editing docs page crams 5 modes, operators, and text objects into one page. Keybinding tables are incomplete — missing arrow keys, undo/redo, find-char, paragraph motion, g-prefix, z-prefix, C-w prefix, count prefix, SPC x prefix, visual mode uppercase/lowercase, swap-anchor, and more. The Emacs documentation pattern (mechanism page + per-mode pages) solves both problems: each page stays focused, and keybinding tables are exhaustive because they're scoped to one mode.

## Solution Statement

Split the monolithic editing page into 6 pages under the "Editing" sidebar section:

1. **Modes** — explains the mode mechanism (what modes are, how they activate, mode transitions, status line indicator)
2. **Normal Mode** — comprehensive keybinding table organized by category (navigation, operators, g-prefix, z-prefix, C-w prefix, etc.)
3. **Insert Mode** — keybinding table for entry keys, editing keys, and special keys
4. **Visual Mode** — keybinding table for selection, motion, and action keys
5. **Command Mode** — ex-command reference table
6. **M-x Mode** — command-by-name reference with common commands table

The Operators and Text Objects sections remain on the Normal Mode page since they are normal-mode constructs. Each page's keybinding table is derived from the actual T-Lisp binding files (`src/tlisp/core/bindings/*.tlisp`, `src/tlisp/core/commands/*.tlisp`) and TypeScript handlers to ensure completeness.

## Relevant Files

### Existing Files

- `website/app/docs/editing/page.tsx` — current monolithic editing page (343 lines), source for content to redistribute
- `website/lib/docs.ts` — sidebar navigation config, must be updated with new page entries
- `website/components/docs-page.tsx` — shared page layout component (prev/next navigation)
- `website/components/code-block.tsx` — code block component used for command examples
- `src/tlisp/core/bindings/normal.tlisp` — canonical normal mode key bindings
- `src/tlisp/core/bindings/insert.tlisp` — canonical insert mode key bindings
- `src/tlisp/core/bindings/visual.tlisp` — canonical visual mode key bindings
- `src/tlisp/core/bindings/command.tlisp` — canonical command and M-x mode key bindings
- `src/tlisp/core/commands/vim-dispatch.tlisp` — Vim state machine dispatch (normal mode)
- `src/tlisp/core/commands/motions.tlisp` — g-prefix, z-prefix, C-w prefix dispatch
- `src/tlisp/core/commands/operators.tlisp` — operator-pending dispatch (dd, dw, yy, etc.)
- `src/tlisp/core/commands/tabs.tlisp` — tab navigation bindings (gt, gT)
- `src/tlisp/core/commands/windows.tlisp` — window management bindings (C-w)
- `src/tlisp/core/commands/messages.tlisp` — messages buffer binding (C-h e)
- `src/editor/handlers/normal-handler.ts` — normal mode key routing
- `src/editor/handlers/insert-handler.ts` — insert mode key routing (hardcoded printable, Enter, Backspace, Tab, Escape)
- `src/editor/handlers/visual-handler.ts` — visual mode key routing
- `src/editor/handlers/command-handler.ts` — command mode key routing (hardcoded command line, special patterns)
- `src/editor/handlers/mx-handler.ts` — M-x mode key routing (all keys to minibuffer-dispatch-key)

### New Files

- `website/app/docs/editing-modes/page.tsx` — Modes overview page (mechanism explanation, mode transition table)
- `website/app/docs/normal-mode/page.tsx` — Normal mode page with full keybinding tables
- `website/app/docs/insert-mode/page.tsx` — Insert mode page with keybinding table
- `website/app/docs/visual-mode/page.tsx` — Visual mode page with keybinding table
- `website/app/docs/command-mode/page.tsx` — Command mode page with ex-command reference
- `website/app/docs/mx-mode/page.tsx` — M-x mode page with command reference

## Implementation Plan

### Phase 1: Update Navigation

Update `website/lib/docs.ts` to register the 6 new pages under the "Editing" section, removing the old single "Editing" entry. Add `headings` arrays for sidebar table-of-contents.

### Phase 2: Create Mode Pages

Create each page file with content extracted from the current editing page, expanded with complete keybinding tables sourced from the T-Lisp binding files and TypeScript handlers.

### Phase 3: Remove Old Page

Delete `website/app/docs/editing/page.tsx` after all content has been redistributed. Verify no broken links.

## Step by Step Tasks

### Update docs sidebar configuration

- Add 6 new `DocPage` entries to `docsPages` in `website/lib/docs.ts` under the "Editing" section
- Order: Modes (1), Normal Mode (2), Insert Mode (3), Visual Mode (4), Command Mode (5), M-x Mode (6)
- Remove the old "Editing" entry
- Add `headings` arrays for each page's sidebar TOC
- Verify `getPrevNext` produces correct links across all pages

### Create Modes overview page

- Create `website/app/docs/editing-modes/page.tsx`
- Content: what modes are, why modal editing, mode transition table (from/to matrix), status line indicator, M-x mode switching
- Transition table shows all 5 modes as columns, each row shows how to enter that mode from the current one
- No keybinding table needed — this page explains the mechanism, not the keys

### Create Normal Mode page

- Create `website/app/docs/normal-mode/page.tsx`
- Organize keybinding tables by category:
  - **Basic navigation**: h/j/k/l, arrow keys, w/b/e, 0/$/_/-/+/
  - **Scrolling**: C-f/C-b, C-d/C-u, z-prefix (zt/zz/zb)
  - **Jump**: gg/G, f/t/F/T/;/,, %, {/}
  - **Count prefix**: 1-9 (explain count + motion/operator pattern)
  - **Insert entry**: i/a/A/I/o/O
  - **Single-key operations**: x/D/C/Y/J/p/P
  - **Operators**: d/y/c with motion combos (dd/dw/dl/d$/dG/dgg, yy/yw/yl/y$, cc/cw/cl/c$)
  - **g-prefix**: gg/gt/gT/gh/gO/gx/gb
  - **C-w prefix**: C-w s/v/w/q/+/-/>/</
  - **Other**: u/C-r (undo/redo), v/V/C-v (visual entry), */# (word search), M-y (yank-pop), SPC x prefix (f/s/b/u/C-c), C-x b (switch-buffer), C-h (help prefix), C-h e (messages), q (quit)
- Move **Text Objects** section to this page (iw/aw, i"/a", ip/ap, il/al)
- Explain operator + text-object and operator + motion patterns

### Create Insert Mode page

- Create `website/app/docs/insert-mode/page.tsx`
- Two keybinding tables:
  - **Entering Insert Mode**: i/a/A/I/o/O (with descriptions)
  - **Keys in Insert Mode**: printable chars, Enter (newline + auto-indent), Backspace, Tab, Escape
- Brief note: all other keys pass through as text

### Create Visual Mode page

- Create `website/app/docs/visual-mode/page.tsx`
- Three keybinding tables:
  - **Entering Visual Mode**: v (character), V (line), C-v (block)
  - **Selection motion**: h/j/k/l, w/b/e (each calls visual-update-end)
  - **Selection actions**: d (delete), y (yank), c (change), u (lowercase), U (uppercase), o (swap anchor)
- Escape exits visual mode

### Create Command Mode page

- Create `website/app/docs/command-mode/page.tsx`
- Ex-command reference table:
  - `:q`, `:w`, `:wq`, `:q!`, `:e <file>`, `:help`, `:q`
- Special patterns:
  - `dired` / `dired <path>` — directory editor
  - `%s/find/replace/flags` — whole-buffer substitute
  - `s/find/replace` — current-line substitute
- Keybinding table for command line editing: printable chars, Backspace, Escape (cancel), Enter (execute)

### Create M-x Mode page

- Create `website/app/docs/mx-mode/page.tsx`
- Explain the M-x concept (execute any T-Lisp function by name)
- Entry: `SPC ;`
- Common commands table: cursor-position, editor-mode, quit, describe-key, apropos-command
- Keybinding table for minibuffer interaction: printable chars (narrow completion), Escape/C-g (cancel), Enter (execute), Tab (complete)
- Note on completion system (vertico-style narrowing)

### Delete old editing page

- Delete `website/app/docs/editing/page.tsx`
- Verify no imports or references to this file remain

### Verify build

- Run `cd website && npm run build` to confirm no broken imports or type errors
- Run `cd website && npm run dev` and visually verify each page loads correctly with sidebar navigation

## Testing Strategy

### Unit Tests

No unit tests needed — these are static Next.js page components.

### Integration Tests

- `npm run build` succeeds with no errors
- Each page renders at its expected URL path
- Sidebar navigation links between pages work correctly
- Prev/next navigation flows through all 6 pages in order

### Edge Cases

- Old `/docs/editing` URL should either redirect or return 404 (Next.js App Router will 404 naturally when the file is deleted)
- Long keybinding tables should render correctly on mobile (horizontal scroll or responsive layout)
- Code blocks in command mode page should render with proper syntax highlighting

## Acceptance Criteria

- 6 new page files created under `website/app/docs/`
- Old `website/app/docs/editing/page.tsx` deleted
- `website/lib/docs.ts` updated with 6 new entries, old entry removed
- Every keybinding table covers all bindings from the corresponding T-Lisp binding file and TypeScript handler
- Normal mode page includes: basic navigation, scrolling, jump, count prefix, insert entry, single-key ops, operators with combos, g-prefix, z-prefix, C-w prefix, text objects
- Insert mode page includes: entry keys and in-mode keys
- Visual mode page includes: entry, motion, and action keys
- Command mode page includes: ex-command reference and special patterns
- M-x mode page includes: common commands and minibuffer interaction keys
- `npm run build` succeeds with zero errors
- Prev/next navigation works across all pages

## Validation Commands

- `cd website && npm run build` — confirm zero build errors
- `cd website && npm run dev` — start dev server for manual visual verification
- `grep -r "docs/editing" website/ --include="*.tsx" --include="*.ts"` — confirm no references to deleted old page remain (except in git history)

## Notes

- The keybinding inventory was sourced from exhaustive analysis of all T-Lisp binding files and TypeScript handlers. If bindings are added or changed after this spec is filed, update the corresponding table.
- The Emacs documentation pattern calls this structure "Modes" (mechanism) + per-mode pages. The tmax equivalent maps directly: Normal → Fundamental, Insert → no Emacs equivalent (tmax is vim-modal), Visual → Emacs mark, Command → Emacs minibuffer ex, M-x → Emacs M-x.
- Arrow key bindings (Left/Down/Up/Right) are registered in normal.tlisp but not in the vim-dispatch state machine — they only work via the legacy keymap fallback. Include them in the normal mode navigation table with a note.
