# Bug: `V` (visual line mode) does not highlight or select a full line

## Bug Description

In real Vim, pressing `V` in normal mode enters **visual line mode**: the entire
current line is highlighted in reverse video, the status line reads
`-- VISUAL LINE --`, and moving the cursor up/down (`j`/`k`) extends the
highlight to additional **whole lines**. Operators then act linewise — `y` yanks
the full line(s) into the unnamed register, `d` deletes whole line(s), `u`/`U`
re-case whole line(s).

In tmax, pressing `V` only sets the status line to `-- VISUAL LINE --`. **Nothing
is highlighted**, and operators act on an **empty** (zero-width) range instead of
the full line:

- `V` then `y` leaves the unnamed/yank register **empty** (verified by the
  `eval-04-visual-mode.yaml` e2e playbook, which expects `result_contains: ''`
  for the line-yank step).
- `V` then `u`/`U` lower/upper-cases nothing. The existing playbook carries the
  comment: *"line-mode visual-lowercase operates on an empty selection due to an
  editor bug"* and works around it by switching to char mode.
- `V` then `d` deletes nothing meaningful (zero-width range).
- No reverse-video highlight is ever drawn for any visual mode (`v`, `V`, `C-v`),
  because the selection is never carried into the rendered frame.

**Expected**: `V` highlights the full current line; cursor movement extends the
highlight to whole lines; `y`/`d`/`u`/`U` operate on those whole lines linewise.
**Actual**: `V` shows only a status label, highlights nothing, and operators hit
an empty range.

## Problem Statement

Visual line mode (`V`) is functionally broken along two coupled axes:

1. **Selection extent** — the line-mode selection is constructed and maintained
   as a zero-width character range, never expanded to cover whole lines, so
   every operator that derives its range from the selection acts on empty input.
2. **Rendering** — the visual selection is never rendered: it lives only in a
   module-level variable with no render-path consumer, and `EditorState`/the
   serialized frame carry no selection field, so the client cannot draw it.

Both must be fixed for `V` to "highlight and select a full line".

## Solution Statement

Make line-mode selection **semantically linewise** end-to-end, and **carry the
selection through to the renderer**:

- In `visual-ops.ts`: a line-mode selection spans full lines
  `[minLine..maxLine]` (column 0 → end-of-line). `visual-enter-line-mode` seeds
  the full current line; `visual-update-end` snaps to the full extent of the
  cursor's line; and `visual-delete`/`visual-yank`/`visual-lowercase`/
  `visual-uppercase` compute their effective range from the linewise extent when
  `mode === 'line'` (delete = whole lines, linewise register; yank = whole lines
  joined by newlines, linewise register; case-ops transform each whole line).
- Thread the selection into render state: add `visualSelection` to `EditorState`
  (`core/types.ts`), populate it from `getVisualSelection()` where the state/seed
  is built, serialize it in `src/server/serialize.ts`, and apply reverse video
  (`\x1b[7m`) for the selection in the render path (`src/render/capture-frame.ts`,
  and `src/frontend/render/buffer-lines.ts` if the client re-renders locally).
  For `mode === 'line'`, highlight the **full width** of each selected row.

This is the minimal coherent change: the extent fix makes the operators correct
(the documented "editor bug" disappears), and the render fix makes the highlight
visible. Char mode (`v`) rendering is enabled by the same infrastructure at no
extra cost; block mode (`C-v`) rendering is explicitly **out of scope** for this
bug (not reported) and left as-is.

## Steps to Reproduce

1. Start the editor on a multi-line file: `bun run start <file>` (or via daemon:
   `bin/tmax <file>`).
2. Ensure normal mode (press `Escape`).
3. Press `V`.
   - **Observe**: status line shows `-- VISUAL LINE --`, but the current line is
     **not highlighted** (no reverse video).
4. Press `y` (yank), then check the register — e.g. via `tmax-use`:
   ```
   eval: '(progn (find-file "${FILE}") (visual-enter-line-mode) (visual-yank) (yank-register-get))'
   ```
   - **Observe**: register is **empty** (`''`). Expected: the full current line.
5. Press `V` then `u` / `U`.
   - **Observe**: no case change (zero-width selection).

The `eval-04-visual-mode.yaml` playbook already encodes steps 3–4 as the
current (buggy) expected behavior.

## Root Cause Analysis

### Cause 1 — Zero-width line selection (`src/editor/api/visual-ops.ts`)

`visual-enter-line-mode` (visual-ops.ts ~L128) constructs:

```ts
visualSelection = {
  start: { line: currentLine, column: 0 },
  end:   { line: currentLine, column: 0 },   // ← zero-width at col 0
  mode:  'line',
};
```

`start` and `end` are identical → the range covers **no characters**. Nothing
repairs this:

- `visual-update-end` (L218) sets `end = { line: cursorLine, column: cursorColumn }`
  — the exact cursor cell, not the line's full extent. So even after `j`/`k`,
  a line-mode selection spans `col 0` of the anchor to the cursor's *column* on
  the moved line — partial characters, never whole lines.
- The operators `visual-delete`/`visual-yank`/`visual-lowercase`/`visual-uppercase`
  (L278/L344/L405/L468) normalize the raw `start`/`end` character positions and
  call `buffer.getText`/`buffer.delete`/`buffer.replace` on that range. For a
  freshly-entered `V`, the range is empty → empty text, no-op mutation. The
  `mode === 'line'` flag is used **only** to mark the register linewise
  (`registerDelete(text, visualSelection.mode === 'line')`) — it never expands
  the operated range to full lines.

This is exactly the "empty selection" the `eval-04` workaround comment calls out.

### Cause 2 — Selection is never rendered

- `getVisualSelection()` (visual-ops.ts L53) is the only read of the module-level
  `visualSelection`. Grep confirms its **sole callers** are `editor.ts` (a
  getter) and `tlisp-api.ts` (the `visual-update-end` callback plumbing). **No
  renderer calls it.**
- `EditorState` (`src/core/types.ts` L269–313) has **no visual-selection field**
  (it has `highlightSpans` for syntax and `searchMatches`, but nothing for the
  visual selection). Consequently the daemon frame — serialized in
  `src/server/serialize.ts` from cursor position / mode / etc. — does not carry
  the selection, and the client cannot draw it.

Net effect of the two causes: `V` produces a status label and an internal
zero-width selection that neither lights up the screen nor feeds the operators
the line text. Hence "doesn't **highlight** and **select** a full line".

## Relevant Files
Use these files to fix the bug:

- **`src/editor/api/visual-ops.ts`** — PRIMARY fix target. Holds
  `visual-enter-line-mode`, `visual-update-end`, and the four operators
  (`visual-delete`/`visual-yank`/`visual-lowercase`/`visual-uppercase`). Add a
  linewise-extent helper and route line-mode selections through it. Also expose
  the selection for rendering (already done via `getVisualSelection`).
- **`src/core/types.ts`** — Add an optional `visualSelection` field to
  `EditorState` (L269) so the render path can read it: shape
  `{ start: Position; end: Position; mode: 'char' | 'line' | 'block' }`
  (matches the existing `VisualSelection` interface in visual-ops.ts).
- **`src/server/serialize.ts`** — Serialize `visualSelection` into the frame
  alongside `cursorPosition` and `mode`, and deserialize it on the client side,
  so the daemon→client transport carries the selection.
- **`src/render/capture-frame.ts`** — Apply reverse video to the selection when
  capturing a frame. For `mode === 'line'`, highlight the full width of each row
  in `[min(start.line,end.line) .. max(start.line,end.line)]` (clamped to the
  viewport). For `mode === 'char'`, highlight cells across the spanned rows.
- **`src/frontend/render/buffer-lines.ts`** — If the live client re-renders from
  `EditorState` through this module (confirm during implementation), apply the
  same reverse-video logic here so both render paths agree.

### New Files
- None required. Tests go in existing files (below).

### Test files to extend (not new)
- **`test/unit/visual-mode-selection.test.ts`** — already drives `v`/`V`/`C-v`
  + `d`/`y`/`u`/`U` through the real Editor + bindings. Add assertions that
  `V`+`y` populates the register with the full line text, `V`+`d` deletes the
  whole line, and `V`+`u`/`U` re-cases the whole line.
- **`test/unit/render-visual.test.ts`** — already uses `captureFrame(state,…)` to
  assert ANSI output. Add a test that a line-mode `visualSelection` produces a
  full-width reverse-video (`\x1b[7m`) row.
- **`tmax-use/playbooks/eval-04-visual-mode.yaml`** — remove the "editor bug"
  workaround comment and change the line-yank expectation from `''` to the actual
  line text (and re-enable the line-mode case-op step instead of the char-mode
  workaround).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Task 1 — Make line-mode selection span full lines (extent + seed)

**User Story**: As a tmax user in normal mode, when I press `V`, I want the
selection to cover the entire current line (and whole additional lines as I move
the cursor), so that subsequent operators act on full lines like in Vim.

- Add a small internal helper in `visual-ops.ts`, e.g.
  `lineWiseExtent(buffer, selection)`, returning
  `{ start: { line: lo, column: 0 }, end: { line: hi, column: lineLength(hi) } }`
  where `lo`/`hi` are the min/max of `start.line`/`end.line` and `lineLength` is
  the byte/character width of buffer line `hi` (read via the buffer primitive
  already used elsewhere in this file).
- In `visual-enter-line-mode`: set `end` to `{ line: currentLine, column: lineLength(currentLine) }`
  (keep `start` at column 0) so the seed selection is the **full** current line,
  non-empty.
- In `visual-update-end`: when `visualSelection.mode === 'line'`, set
  `end = { line: getCursorLine(), column: lineLength(getCursorLine()) }`
  (full extent of the cursor's line); leave `start` untouched (already col 0).
  Char/block behavior stays as-is.

**Acceptance Criteria**:
- [ ] After `(visual-enter-line-mode)`, `(visual-get-selection)` returns a range
  whose `end.column` equals the current line length (not 0).
- [ ] After `V` then `j` then reading the selection, the range spans whole lines
  `[L, L+1]` (end column = length of line L+1).

### Task 2 — Make operators act linewise

**User Story**: As a tmax user in visual line mode, I want `y`/`d`/`u`/`U` to
operate on the whole selected line(s), so that yanking returns the line text,
deleting removes the line, and case-ops re-case the line.

- In each of `visual-delete`, `visual-yank`, `visual-lowercase`,
  `visual-uppercase`: after the existing "normalize start/end" step, when
  `visualSelection.mode === 'line'`, replace the effective `start`/`end` with the
  output of `lineWiseExtent(buffer, visualSelection)` before computing the text
  and mutating the buffer.
- `visual-delete` (line mode): delete the full-line range; the register is
  already flagged linewise via `registerDelete(text, true)` — keep that.
  Ensure `buffer.delete` of the linewise range removes the selected lines
  (including the trailing newline so the lines collapse, matching Vim `Vd`).
- `visual-yank` (line mode): `buffer.getText` over the linewise range returns the
  line text including its newline; keep `setRegister('"', text)` and the yank
  register populated with that text (non-empty).
- `visual-lowercase`/`visual-uppercase` (line mode): `buffer.replace` over the
  linewise range with the re-cased full-line text.

**Acceptance Criteria**:
- [ ] `V` then `y`: `(get-register ")` (or `yank-register-get`) returns the full
  current line text (non-empty), not `''`.
- [ ] `V` then `d`: the current line is removed and the line below moves up.
- [ ] `V` then `u` / `U`: the entire current line is lower/upper-cased.
- [ ] `test/unit/visual-mode-selection.test.ts` extended with the three cases
  above and passing.

### Task 3 — Carry the selection into render state and serialize it

**User Story**: As the TUI client rendering a frame, I want the current visual
selection (start, end, mode) included in the editor state and serialized frame,
so I can draw the highlight.

- Add `visualSelection?: { start: Position; end: Position; mode: 'char' | 'line' | 'block' }`
  to `EditorState` in `src/core/types.ts`.
- Populate it wherever the editor builds `EditorState`/the model projection for
  rendering — read `getVisualSelection()` at that point (mirror how `mode` and
  `cursorPosition` are already projected). If the functional model (CHORE-39)
  owns state assembly, populate the field in the same place `mode` is derived.
- In `src/server/serialize.ts`, serialize and deserialize `visualSelection`
  alongside `cursorPosition`/`mode` so it survives the daemon→client transport.

**Acceptance Criteria**:
- [ ] `EditorState` type carries `visualSelection`; `bun run typecheck:src`
  passes.
- [ ] After `(visual-enter-line-mode)`, the `EditorState`/frame built for
  rendering contains a `visualSelection` with `mode: 'line'` (asserted via a
  unit test or by inspecting the serialized frame).
- [ ] `src/server/serialize.ts` round-trips the field (a frame with a selection
  deserializes back with the same selection).

### Task 4 — Render the selection highlight (reverse video)

**User Story**: As a tmax user, when I enter visual line mode, I want the
selected line(s) shown in reverse video so I can see what I have selected.

- In `src/render/capture-frame.ts` (and `src/frontend/render/buffer-lines.ts` if
  the live client renders through it), when `state.visualSelection` is present
  and `mode` is `visual`, apply ANSI reverse video (`\x1b[7m…\x1b[0m`) to the
  selected cells:
  - `mode === 'line'`: every row in
    `[min(start.line,end.line) .. max(start.line,end.line)]` (clamped to the
    viewport), **full terminal width** (pad the row to the content width before
    reversing, like Vim).
  - `mode === 'char'`: cells from `start` to `end` across the spanned rows.
  - `mode === 'block'`: leave unchanged / best-effort (out of scope; do not
    regress — if block previously rendered nothing, keep rendering nothing).
- Keep the implementation surgical: a single overlay pass that injects the
  reverse-video SGR around the affected span(s), reusing the existing ANSI
  width helpers already in `buffer-lines.ts` (`stringWidth`, `fitToWidth`, etc.).

**Acceptance Criteria**:
- [ ] `captureFrame(state, 80, 24)` with a line-mode selection produces a row
  containing `\x1b[7m` spanning the full content width — asserted in
  `test/unit/render-visual.test.ts`.
- [ ] Char-mode (`v`) selections render reverse video over the selected chars.
- [ ] Block mode is not regressed (still enters/exits cleanly; no highlight
  regression beyond the pre-existing "no highlight" behavior).

### Task 5 — Update the eval-04 e2e playbook (remove the workaround)

**User Story**: As a maintainer, I want the e2e suite to assert correct visual
line behavior rather than codify the bug, so regressions are caught.

- In `tmax-use/playbooks/eval-04-visual-mode.yaml`:
  - Change the "yank entire line" step's `yank-register-get` expectation from
    `result_contains: ''` to the actual line text (e.g. the first line of the
    fixture, `ABC DEF GHI`).
  - Remove the char-mode workaround for the case-op step; restore a genuine
    line-mode `visual-lowercase`/`visual-uppercase` step and assert the whole
    line is re-cased.
  - Delete the "editor bug" comment.

**Acceptance Criteria**:
- [ ] `eval-04-visual-mode.yaml` no longer references the "editor bug" or expects
  an empty line-yank.
- [ ] The playbook passes after Tasks 1–2 land (it can be run in isolation with
  `bin/tmax-use tmax-use/playbooks/eval-04-visual-mode.yaml --reporter junit`).

### Task 6 — Run the full validation suite

**User Story**: As a maintainer, I want the green test suite to prove the bug is
fixed with zero regressions.

- Run every command in **Validation Commands** below; all must exit 0 / report
  no failures.

**Acceptance Criteria**:
- [ ] `bun run typecheck`, `bun run typecheck:src`, `bun run typecheck:test` all
  exit 0.
- [ ] `bun run test:unit` passes (0 fail), including the extended
  `visual-mode-selection.test.ts` and `render-visual.test.ts`.
- [ ] `bun run test:tmax-use` passes, including the updated `eval-04-visual-mode`
  playbook.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

**Reproduce before the fix (baseline):**
- `bin/tmax-use tmax-use/playbooks/eval-04-visual-mode.yaml --reporter junit` —
  before the fix this passes only because it expects the buggy empty line-yank;
  after Task 5 it asserts correct behavior.

**Type checking (required):**
- `bun run typecheck:src` — source types (new `EditorState.visualSelection` field,
  visual-ops changes).
- `bun run typecheck:test` — test types.
- `bun run typecheck` — full project type check (src + test + tmax-use + bench).

**Testing (required):**
- `bun run test:unit` — full unit suite (must be 0 fail; expect the extended
  `visual-mode-selection.test.ts` + `render-visual.test.ts` to cover the fix).
- `bun test test/unit/visual-mode-selection.test.ts` — fast targeted re-run while
  iterating on Tasks 1–2.
- `bun test test/unit/render-visual.test.ts` — fast targeted re-run for Task 4.

**Build (required):**
- `bun run build` — compiles `dist/tmax`, `dist/tlisp`, `dist/tmax-use`.

**E2E (user-visible behavior affected):**
- `bun run test:tmax-use` — all tmax-use playbooks + TypeScript e2e tests,
  including the updated `eval-04-visual-mode.yaml` (asserts full-line yank) and
  `vim-operator-motion.yaml`.

**Manual verification (UI-related):**
- `bin/tmax --stop` — stop any stale daemon before manual testing.
- `bun run start <file>` — launch the editor, press `V`, confirm the current
  line is highlighted in reverse video, that `j`/`k` extend the highlight to
  whole lines, and that `y`/`d`/`u`/`U` operate on the full line.

## Notes
- **Why this bug exists**: visual line mode was wired up at the API surface
  (binding, status label, `mode: 'line'` flag) but the linewise *extent* was
  never implemented — `start`/`end` were left as a zero-width character range and
  the operators were never taught to expand to full lines. The render path was
  never given access to the selection at all (no `EditorState` field, no
  serializer entry, no render consumer), so no visual mode ever highlighted.
- **Architectural note**: `src/editor/CLAUDE.md` says TS in `src/editor/` should
  be primitives only and editor logic belongs in T-Lisp. The existing visual
  operators already live in TS (`visual-ops.ts`), so this fix follows the
  established (if technically rule-bending) pattern and keeps the change in one
  file. Moving visual logic to T-Lisp is a larger refactor and explicitly out of
  scope for this bug ("solve the bug at hand").
- **Scope guard**: only `V` (line mode) is reported broken and is the target.
  Char-mode (`v`) rendering is fixed for free by the render infrastructure;
  block-mode (`C-v`) rendering is left as a known gap (do not regress it).
- **Daemon/client split**: the selection lives in module state inside the daemon
  process; the TUI client is a separate process and cannot call
  `getVisualSelection()` directly — that is why the selection must be serialized
  into the frame (Task 3) rather than read ad hoc at render time.
- **Related spec**: this is independent of SPEC-069 (operator×motion parity) but
  lives in the same visual-mode area; the new `vim-operator-motion.yaml` e2e
  playbook should keep passing unchanged.
