# SPEC-231 — Yank/cut/paste flash feedback (vim-goggles)

Issue: #231 `vim-goggles feedback: flash the yanked/deleted region on copy and cut`
Status: planned (implementation pending — next burn-down cycle)
Date: 2026-08-29

## Goal

Every register mutation gives visible feedback: the affected region **flashes** (subtle inverse/dim) for ~300 ms so success is unmistakable. Scope (user-resolved): **yank + delete + paste**. Style: **subtle inverse/dim**, terminal-agnostic.

## Researched facts that shape the design (all verified in-repo)

1. **Highlights are the vehicle**: `HighlightSpan` (`src/core/contracts/editor.ts:60-64`), state field `EditorState.highlightSpans` via `SetHighlightSpans` (`src/editor/functional/update.ts:114`, `model.ts:116`), applied per-line at render in `applyHighlights` (`src/frontend/render/buffer-lines.ts:164-196`). Both frontends render through `renderBufferLines`/`captureFrame` — one merge point covers Steep + TUI.
2. **Syntax spans are recomputed per render** — a flash written into `highlightSpans` would be clobbered. The flash needs its OWN state field merged at render time.
3. **The TUI client polls every 200 ms** (`src/client/tui-client.ts:230`) and its change-detection (`:232-239`) compares revision/mode/viewport/status/cursor only. Consequences: (a) flash TTL must exceed one poll interval — **300 ms**; (b) the change-detection must also react to flash presence or the flash never renders in the TUI.
4. **T-Lisp timer primitives are off-limits** (learnings.md / architecture split). TS-side `setTimeout` driving transient UI is established precedent (`which-key-state.ts` `schedule(prefix, bindings, callback)` with a module-level `timerId`). The TTL lives in the TS primitive; T-Lisp only *decides when/where* to flash (editor logic).
5. `visual-delete`/`visual-yank` are TS primitives invoked directly from T-Lisp bindings — hooks belong in the BINDINGS (`(progn (flash-region …) (visual-yank))`), keeping TS primitives pure.

## Design decisions

- **New state**: `EditorState.flashSpans?: readonly (readonly HighlightSpan[])[]` + `SetFlashSpans` update message (mirror `SetHighlightSpans`). Render merges `flashSpans` AFTER syntax spans in `applyHighlights`' call site in `renderBufferLines` (clamp per line, skip when unset).
- **New TS primitive** `(flash-region START-LINE START-COL END-LINE END-COL [TTL-MS])` in a new `src/editor/api/flash-ops.ts`: builds inverse-style spans per line for the region, `applyUpdate(SetFlashSpans…)`, `setTimeout` clears (single in-flight flash — a new flash cancels the prior timer, like which-key). Default TTL 300 ms; the optional 5th arg exists for tests. Style: `inverse` in the existing `ANSIStyle`.
- **Client visibility**: add flash presence to the TUI poll's change-detection (`current.flashSpans !== lastState.flashSpans` shape — check what `refreshState`/render-state serializes; extend the mapping so flashSpans reaches the client).
- **Delete semantics** (terminal reality — the text is gone before a frame can show a flash ON it): flash at the deletion site **after** the mutation — start of the removed region, spanning the removed length where it still makes sense on the joined line. Document as "cut-here" feedback, not "what-was-cut" (vim-goggles in terminal vim has the same constraint).
- **T-Lisp hooks** (editor logic stays in T-Lisp; wrap call sites):
  - `operators.tlisp` `vim-operator-apply`: y case flashes the yanked region (text still present — flash shows WHAT was copied); d/c cases flash the deletion site post-cut.
  - `vim-delete-line-range` (dd): flash line range at the collapse site.
  - `edit-commands.tlisp`: `vim-delete-char` (x) flashes the removed char position; `vim-paste-after`/`vim-paste-before` flash the pasted range; `vim-visual-paste` flashes the inserted range.
  - `bindings/visual.tlisp`: `d` → `(progn (visual-delete) (flash …))` at the site; `y` → flash the selection (before or after — text persists, either works); `p` → the pasted range (vim-visual-paste already knows it).
- **Baseline duty** (learnings): adding a `createEditorAPI` name regenerates `.chore44-baseline/api-names-static.txt` + bumps the count in `editor-api-registry.test.ts`. No Editor methods added.

## Completion criteria

1. `yy`/`yiw`/`vi"y` set a flash over the yanked range; visible in Steep's render (escape codes present) and in the TUI client's state (flashSpans reaches the client and its poll re-renders on flash onset/clear).
2. `dd`/`x`/`diw`/visual `d` flash the cut site after the deletion.
3. `p`/`P` (normal) and visual `p` flash the inserted range.
4. Flash clears after ~300 ms with no keypress required; a new flash supersedes an in-flight one; stale flashes never leak into later captures.
5. `flash-region` is the single primitive; TTL in TS (which-key precedent); T-Lisp owns when/where.
6. Unit tests: primitive set/clear (short injected TTL), render merge produces inverse codes in both render paths, supersede behavior, and one end-to-end T-Lisp hook (yank sets flash; after TTL it clears).
7. Baselines regenerated (`api-names-static.txt`, registry count).

## Out of scope

A `setq` duration knob (constant for now), blockwise-specific flash shaping (treated as its bounding region), clipboard-put flashes, and any T-Lisp timer machinery.
