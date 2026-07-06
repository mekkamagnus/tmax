# TUI Rendering, Display, and Interaction Hardening — BUG-05 through BUG-12, SPEC-067

## Status

Accepted — implemented across BUG-05 through BUG-12 fixes and SPEC-067 vim parity.

## Context

The tmax TUI had seven rendering and interaction defects that degraded the user experience for daily editing. Each was a distinct subsystem failure: the syntax highlighter had no markdown theme, the which-key popup didn't work for vim prefix keys, emoji/wide characters broke line alignment, markdown mode wasn't auto-detected on open, C-g didn't cleanly cancel vim prefixes, `0` didn't reset horizontal scroll, and the demo system output text instead of showing features visually. Separately, SPEC-067 identified that many core vim keys were either unbound (implemented as T-Lisp commands but not reachable via keystroke) or genuinely missing.

## Decision

### BUG-09: Display-width-aware rendering (emoji/wide characters)

The renderer's `fitToWidth` and `padAnsiToWidth` functions in `buffer-lines.ts` used `string.length` (JavaScript code units) for column-width calculations. Emoji and CJK wide characters occupy 2 terminal columns but count as 1-2 code units, causing lines to overflow the viewport and cursor positioning to drift.

**Fix:** Replace `string.length` with a display-width calculation that accounts for wide characters (East Asian Width property). The block cursor renderer (`renderWithBlockCursorAnsi`) also advances `visiblePos` by the character's display width, not by 1.

### BUG-06: Markdown syntax highlighting theme mapping

The markdown tokenizer (`src/syntax/languages/markdown.ts`) produced token types like `"heading"`, `"bold"`, `"italic"`, `"link"`, `"code"`, `"blockquote"`, etc. But `defaultDarkTheme` in `src/syntax/types.ts` only mapped programming-language token types (`keyword`, `string`, `comment`, `number`, `function`). All markdown tokens fell through to `theme.default = {}` (no styling).

**Fix:** Add markdown-specific token type entries to `defaultDarkTheme` following the One Dark palette. Each markdown construct gets an appropriate ANSI style: headings bold+colored, bold/italic styled, code blocks dimmed, links underlined, etc.

### BUG-10: Major mode auto-detection on buffer open

When opening a file, `main.tsx` loaded the file in Phase 4 (before core bindings loaded in Phase 5). Major modes (including markdown) are registered via T-Lisp `require-module` calls in `normal.tlisp`, which loads lazily during `ensureCoreBindingsLoaded()`. By the time the mode registry was populated, the file was already open with `[fundamental]` and no retroactive detection ran.

**Fix:** After `server.startEditor()` completes in Phase 5 (which loads core bindings and registers all major modes), call `activateMajorModeForFile(filename)` if a file was loaded in Phase 4. This ensures mode auto-detection runs after the mode registry is populated.

### BUG-07 + BUG-11: Which-key popup for vim prefix keys

The which-key popup only worked for "legacy" TypeScript keymap bindings (`C-c`, `SPC`). Vim prefix keys (`z`, `g`, `C-w`) live entirely in T-Lisp (`motions.tlisp`) and had no representation in the TypeScript `keyMappings` Map. The handler dispatched them to T-Lisp and returned immediately, never reaching the which-key scheduling code.

Additionally, C-g cancellation only cleared the TypeScript-side which-key state — the T-Lisp `vim-pending-prefix` variable remained set, causing the next key to be misrouted as a continuation of the cancelled prefix.

**Fix:** Precompute which-key popup bindings server-side (querying T-Lisp's `vim-prefix-bindings` for all known prefixes) and pass them through workspace state. The C-g handler calls `vim-reset-pending` to clear both TypeScript and T-Lisp state. The `vim-prefix-bindings` function in `motions.tlisp` was updated to include all `g` prefix bindings (h, O, x, b in addition to g, t, T).

### BUG-12: Zero-key viewport reset + multi-part keymap nesting

The `0` key called `(line-first-column)` which set cursor column to 0 but never reset `viewportLeft`. After horizontal scrolling (`zl`, `zh`, `zs`, `ze`), the cursor appeared at the viewport's left edge (offset), not the line's actual beginning.

Separately, `keymap-set-key` in `keymaps.tlisp` only created one level of prefix nesting, so 3-part keys like `"SPC x f"` collapsed — only the last binding survived.

**Fix:** Add `(viewport-left-set 0)` to the `0` key binding. Rewrite `keymap-set-key` to use recursive nesting for multi-part keys; update `keymap-prefix-p`, `keymap-prefix-bindings`, and `keymap-all-bindings` to walk the nested structure.

### BUG-05: Visual demo system

The `/demo` skill ran bash scripts that called `tmaxclient` and dumped RPC text output. Users read about features instead of seeing them work live.

**Fix:** Replace the bash-centric approach with a YAML playbook + runner system (`demos/` directory). Playbooks define demo steps declaratively (action, parameters, narration, pacing). The runner ensures daemon + TUI are running, executes each step with visual pacing via keystrokes, so the user watches the editor operating live in tmux.

### SPEC-067: Vim parity — bind every core vim normal-mode key

Many vim features were implemented as T-Lisp commands with passing unit tests but were not reachable via the vim keystroke — only callable via M-x or eval. Other core vim keys had no implementation at all.

**Decision:** Three-track approach:
1. **Bind already-implemented features** — marks (`m{a-z}`/`` `{a-z} ``), macros (`q{a-z}`/`@{a-z}`), replace-char (`r{char}`), replace-mode (`R`), repeat (`.`), search next/prev (`n`/`N`), indent (`>>`/`<<`), `gg`, `gi`, jumplist (`C-o`/`C-i`). These have T-Lisp commands; add key bindings in `normal.tlisp`.
2. **Implement genuinely-missing features** — toggle-case (`~`), scroll-to-cursor (`zt`/`zz`/`zb`/`z.`), window-position jumps (`H`/`M`/`L`), increment/decrement (`C-a`/`C-x`). New T-Lisp command implementations + bindings.
3. **Test coverage** — every bound or implemented key gets a unit test (real keypresses, assert end state) plus a tmax-use e2e playbook (drives through the daemon/client stack).

## Consequences

**Easier:**
- Emoji, CJK, and other wide characters render correctly — no more viewport overflow or cursor drift on lines containing them.
- Markdown files show proper syntax highlighting (headings, bold, italic, code, links, blockquotes all styled).
- Markdown mode auto-detects on open — no more `[fundamental]` for `.md` files.
- Which-key popup works for all prefix keys (vim and legacy), with clean C-g cancellation.
- `0` correctly resets both cursor and viewport.
- Multi-part key sequences (`SPC x f`) work reliably.
- Vim users' muscle memory works — every core vim key is bound and tested.

**More difficult / open:**
- The display-width calculation adds per-character overhead to every render line. For very long lines this is measurable but acceptable given the correctness gain.
- The which-key precomputation adds startup cost (querying T-Lisp for all prefix bindings) but only runs once per editor session.
- SPEC-067 is an ongoing effort — new vim keys added in future T-Lisp command files need corresponding bindings and tests.

**Related:** BUG-05, BUG-06, BUG-07, BUG-09, BUG-10, BUG-11, BUG-12, SPEC-067, [ADR-0076](ADR-0076-syntax-highlighting-in-render-pipeline.md), [ADR-0080](ADR-0080-major-mode-auto-detect-on-open.md), [ADR-0085](ADR-0085-horizontal-viewport-scrolling.md), [ADR-0086](ADR-0086-which-key-per-instance-state.md), [ADR-0087](ADR-0087-keymap-mutable-set.md), [ADR-0091](ADR-0091-unified-keymap-dispatch.md), [ADR-0095](ADR-0095-browse-url-detection-dispatch.md).
