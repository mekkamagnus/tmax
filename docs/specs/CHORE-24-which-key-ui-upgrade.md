# Feature: Upgrade Which-Key Popup UI to RFC-013 Design Standard

**Depends on:** SPEC-038 (unified T-Lisp keymap system), RFC-013 (Fikra AI Harness — which-key popup mockup)

### Prerequisites (must pass before implementation)

1. **SPEC-038** — Unified keymap system must be complete so which-key reads bindings from live T-Lisp keymaps
2. **RFC-013 Section 5** — Defines the target visual design for the which-key popup (CSS mockup lines 347-368, HTML mockup lines 1106-1126)
3. **Steep `matcha.ts`** — `style()` function with 24-bit hex color support must be available in `src/steep/matcha.ts`

## Feature Description

Upgrade the which-key overlay renderer from raw ANSI escape codes to the Steep `style()` system, matching the RFC-013 visual design. The popup gains a dark blue background, three-part binding format (key + command + description), prefix header row, and accent-colored top border — consistent with how `status-line.ts` and `minibuffer.ts` render.

## User Story

As a tmax user,
I want the which-key popup to display bindings in a visually rich, multi-column overlay with styled keys and command names,
So that I can quickly identify the right key without squinting at a flat status-line dump.

## Problem Statement

The current which-key overlay (`which-key-overlay.ts`) uses raw `\x1b[` ANSI escapes with a basic blue-bg/cyan-fg scheme. It outputs flat text with no visual hierarchy — keys, commands, and descriptions all look the same. RFC-013 defines a richer design with distinct styling per element, but the renderer doesn't support it. Additionally, the which-key overlay is the only renderer in `src/frontend/render/` that bypasses the Steep `style()` system.

## Solution Statement

1. Replace raw ANSI escapes with `style()` calls from `matcha.ts`, using 24-bit hex colors matching the RFC-013 CSS palette.
2. Restructure the popup data model to carry per-binding metadata (key, command name, description) so the renderer can apply distinct styling to each part.
3. Add a prefix header row and accent top border matching the RFC-013 `.wk-popup` design.
4. Update the TUI compositor and handler callbacks to use the new structured data.
5. Add renderer unit tests verifying ANSI output correctness.

## Architecture Constraints

| Area | Governing Doc | Rule |
|------|--------------|------|
| Renderer styling | `src/frontend/render/status-line.ts`, `src/frontend/render/minibuffer.ts` | All renderers use `style()` from `matcha.ts` — no raw ANSI escapes |
| Handler responsibility | `src/editor/CLAUDE.md` | Handlers are routing only, no logic; which-key popup data flows through `EditorState` |
| Type changes | `src/core/types.ts` | `WhichKeyBinding` already has `documentation` field — use it, don't add new fields |
| Test validation | `CLAUDE.md` §8, `rules/testing.md` | Run typecheck, build, and full test suite before reporting complete |
| Render testing | `rules/ui-testing.md` | Renderer tests must verify actual ANSI output strings |

## Relevant Files

### Existing Files to Modify

| File | Change | Constraints |
|------|--------|-------------|
| `src/frontend/render/which-key-overlay.ts` | Rewrite renderer to use `style()`, add prefix header, three-part binding format, dark blue bg | Use `matcha.ts` — no raw ANSI escapes |
| `src/editor/handlers/normal-handler.ts` | Update which-key activation callbacks to pass prefix label to `computeWhichKeyPopup` | Handlers are routing only — data flows through state |
| `test/unit/which-key-popup.test.ts` | Update popup assertions to check `whichKeyPopup` structure with new fields | `rules/testing.md` — bun test commands |
| `demos/which-key.yaml` | Update demo to verify new visual format and capture output | Demo must pass at speed 0 |

### New Files

| File | Purpose | Constraints |
|------|---------|-------------|
| `test/unit/which-key-overlay.test.ts` | Unit tests for overlay renderer ANSI output | `rules/testing.md` — verify actual styled strings |

### Reference Files (read-only)

| File | Why |
|------|-----|
| `docs/rfcs/RFC-013-fikra-ai-harness.html` (lines 347-368, 1106-1126) | Target visual design: `.wk-popup` CSS and HTML mockup |
| `src/steep/matcha.ts` | `style()`, `fg()`, `bg()` with 24-bit hex color support |
| `src/frontend/render/status-line.ts` | Reference for `style()` usage pattern in renderers |
| `src/frontend/render/minibuffer.ts` | Reference for popup rendering with `style()` |
| `src/core/types.ts` (line 171-176) | `WhichKeyBinding` interface with `key`, `command`, `mode`, `documentation` |

## Implementation Phases

### Phase 1: Steep Migration — Replace raw ANSI with `style()` calls

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] `src/steep/matcha.ts` exports `style()` with `bg` option supporting hex colors
- [ ] `src/frontend/render/status-line.ts` uses `style()` — confirms the pattern

#### Step 1: Rewrite `which-key-overlay.ts` to use Steep styling

**User story:** As a developer, I want all renderers to use the same styling system so colors are consistent and maintainable.

**Description:** Replace raw ANSI constants with `style()` imports from `matcha.ts`. Apply the RFC-013 color palette using 24-bit hex colors.

**MUST:**
- Import `style` and `stripAnsi` from `../../steep/matcha.ts`
- Use `style(text, { bg: "#1a3a6a" })` for popup background
- Use `style(key, { fg: "#58a6ff", bold: true })` for binding keys
- Use `style(cmd, { fg: "#c9d1d9" })` for command names
- Use `style(desc, { fg: "#8b949e" })` for descriptions
- Use `style(prefix, { fg: "#f0883e", bold: true })` for header
- Use `style("─"×width, { fg: "#58a6ff" })` for top border
- Remove all raw `\x1b[` escape sequences

**MUST NOT:**
- Keep any raw ANSI escape constants
- Change the `computeWhichKeyPopup` function signature (backward compat during this step)
- Change how the TUI client calls the overlay

**Convention source:** `src/frontend/render/status-line.ts` — all other renderers use `style()` from `matcha.ts`

**Acceptance criteria:**
- [ ] No `\x1b[` sequences remain in `which-key-overlay.ts`
- [ ] `style()` imported from `matcha.ts`
- [ ] `bun run typecheck:src` passes
- [ ] Existing which-key tests still pass

#### Step 2: Restructure popup data model for three-part bindings

**User story:** As a developer, I want the popup data to carry per-binding metadata so the renderer can style each part independently.

**Description:** Change `WhichKeyPopupData.rows` from `string[][]` to structured binding arrays. Add a `prefixLabel` field for the header row.

**MUST:**
- Add `prefixLabel: string` to `WhichKeyPopupData` (e.g. `"z — scroll/viewport"`)
- Change each row entry from `string` to `{ key: string, command: string, description?: string }`
- `computeWhichKeyPopup` accepts a `prefixLabel` parameter
- Extract command function name from T-Lisp expression (e.g. `"(scroll-cursor-top)"` → `"scroll-cursor-top"`)
- `renderWhichKeyOverlay` renders header row, border, then binding rows with per-part styling

**MUST NOT:**
- Add new fields to `WhichKeyBinding` in `types.ts` — use the existing `documentation` field
- Change the `EditorState.whichKeyPopup` type signature in `types.ts` beyond updating `WhichKeyPopupData`

**Convention source:** `src/core/types.ts` — keep type changes minimal

**Acceptance criteria:**
- [ ] `WhichKeyPopupData` has `prefixLabel` field
- [ ] `renderWhichKeyOverlay` produces header row as first line
- [ ] Each binding row has three visually distinct styled parts
- [ ] `bun run typecheck:src` passes

### Phase 2: Integration — Wire new popup into handler and TUI

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] Phase 1 complete — renderer uses `style()`, structured data model works
- [ ] `src/client/tui-client.ts` already renders which-key overlay (SPEC-038 Phase 4)

#### Step 3: Update normal-handler to pass prefix labels

**User story:** As a user pressing a prefix key, I want the popup to show a descriptive header so I know what group of commands I'm looking at.

**Description:** Add a prefix label mapping in `normal-handler.ts` so each known prefix gets a human-readable label passed to `computeWhichKeyPopup`.

**MUST:**
- Map known prefixes to labels: `"z"` → `"z — scroll/viewport"`, `"g"` → `"g — goto"`, `"C-w"` → `"C-w — window"`, others → prefix as-is
- Pass label to `computeWhichKeyPopup` in both which-key activation callbacks (legacy prefix path and vim prefix path)
- Labels are derived in the handler callback, not stored in T-Lisp

**MUST NOT:**
- Store labels in T-Lisp keymaps (deferred — labels are a display concern for now)
- Change the T-Lisp keymap data structures

**Convention source:** `src/editor/CLAUDE.md` — display logic in TypeScript is acceptable when it's about rendering primitives

**Acceptance criteria:**
- [ ] `z` prefix popup header shows `"z — scroll/viewport"`
- [ ] `g` prefix popup header shows `"g — goto"`
- [ ] `C-w` prefix popup header shows `"C-w — window"`
- [ ] Unknown prefixes show the raw prefix key as label
- [ ] All which-key tests pass

#### Step 4: Verify TUI overlay rendering

**User story:** As a user watching the TUI, I want the popup to render with the new styling over the buffer area.

**Description:** The TUI client already overlays which-key on bottom buffer rows. Verify it works with the new structured output.

**MUST:**
- Popup renders header row, border, then binding rows
- Popup does not overwrite the status line
- Popup clears immediately on any key press (already works from SPEC-038)

**MUST NOT:**
- Change how `tui-client.ts` positions the overlay (already correct from SPEC-038)
- Add new render zones

**Convention source:** `src/client/tui-client.ts` — existing overlay pattern

**Acceptance criteria:**
- [ ] Visual demo shows styled popup with header and three-part bindings
- [ ] `python3 demos/demo-runner.py demos/which-key.yaml --speed 0` passes

### Phase 3: Tests — Renderer unit tests and full validation

**Constraint checkpoint:** Before starting this phase, verify:
- [ ] Phase 2 complete — popup renders correctly in TUI
- [ ] `rules/ui-testing.md` — renderer tests verify actual output

#### Step 5: Add renderer unit tests

**User story:** As a developer, I want unit tests for the renderer so visual regressions are caught automatically.

**Description:** Create `test/unit/which-key-overlay.test.ts` testing the renderer output.

**MUST:**
- Test `computeWhichKeyPopup` produces correct row count and structure for 7 bindings at 80-width
- Test `renderWhichKeyOverlay` produces ANSI strings containing `style()`-generated sequences
- Test prefix header row appears as first output line
- Test empty bindings returns empty array
- Test column layout adjusts for narrow terminals

**MUST NOT:**
- Test raw ANSI byte sequences — test for presence of styled content (hex color codes are sufficient)

**Convention source:** `rules/testing.md` — bun test patterns

**Acceptance criteria:**
- [ ] `bun test test/unit/which-key-overlay.test.ts` — all tests pass
- [ ] Tests verify at least 5 distinct behaviors

#### Step 6: Final validation

**User story:** As a developer, I want zero regressions so the chore is safe to merge.

**Description:** Run full validation suite.

**MUST:**
- All typecheck commands pass
- All build commands pass
- Full test suite passes
- Demo playbook passes

**MUST NOT:**
- Skip any validation command

**Convention source:** `CLAUDE.md` §8 — verify before reporting complete

**Acceptance criteria:**
- [ ] `bun run typecheck:src` — zero errors
- [ ] `bun run typecheck:test` — zero errors
- [ ] `bun run build` — succeeds
- [ ] `bun test` — full suite passes (2100+ tests, 0 fail)
- [ ] `python3 demos/demo-runner.py demos/which-key.yaml --speed 0` — passes

## Acceptance Criteria

1. No raw `\x1b[` ANSI escapes in `which-key-overlay.ts` — all styling via `style()` from `matcha.ts`
2. Popup background is `#1a3a6a` (dark blue) matching RFC-013 `.wk-popup`, filling the full terminal width (no trailing unstyled padding)
3. Each binding shows three styled parts: key (bright blue, bold), command (light gray), description (muted, deferred)
4. Prefix header row with accent-colored label (e.g. `z — scroll/viewport`)
5. Top accent border line before binding rows
6. `status-line.ts` and `minibuffer.ts` unchanged — no regressions
7. All 2100+ tests pass, typecheck clean, build succeeds
8. Demo playbook runs without errors

## Validation Commands

- `bun run typecheck:src` — zero TypeScript errors in source
- `bun run typecheck:test` — zero TypeScript errors in tests
- `bun run build` — build compiles without errors
- `bun test test/unit/which-key-overlay.test.ts` — new renderer tests pass
- `bun test test/unit/which-key-popup.test.ts` — existing which-key tests pass
- `bun test test/unit/command-documentation-preview.test.ts` — doc-preview tests pass
- `bun test` — full suite passes (2100+ tests, 0 fail)
- `python3 demos/demo-runner.py demos/which-key.yaml --speed 0` — demo playbook passes

## Design Decisions

| Decision | Rationale | Alternative rejected |
|----------|-----------|---------------------|
| `style()` from `matcha.ts` | Consistent with all other renderers; 24-bit hex colors for `#1a3a6a`; automatic reset handling | Raw ANSI — inconsistent, no hex color support, leaked styling risk |
| BG-fill padding via reset injection | `padToWidth` inserts spaces before `\x1b[0m` so background fills full row width; without this, trailing padding would be unstyled | Pad after styling — leaves bg-colored content with plain-white padding tail |
| Prefix labels derived in handler | Display concern, not keymap data; avoids changing T-Lisp keymap structures | Store in T-Lisp keymaps — requires changing `key-bind` signature, deferred |
| Extract function name from command expression | `(scroll-cursor-top)` → `scroll-cursor-top` is the most useful display text | Show raw T-Lisp expression — unreadable to users |
| Description deferred to follow-up | `WhichKeyBinding.documentation` exists but isn't populated by keymap system; populating it requires docstring support in `key-bind` | Add descriptions now — scope creep, requires changes across all binding files |

**Deferred to follow-up:**
- Full description support — populate `WhichKeyBinding.documentation` from T-Lisp docstrings via `(key-bind "z t" "(scroll-cursor-top)" "normal" "scroll to top")`
- Theme/color constants file — share RFC-013 palette across all renderers
- Configurable which-key colors via T-Lisp variable

## Edge Cases

- Terminal without 24-bit color support — `style()` falls back gracefully; text remains readable without background
- Row padding bg gap — `padToWidth` must insert padding before the trailing `\x1b[0m` reset; padding after reset leaves unstyled whitespace
- More bindings than popup height — `computeWhichKeyPopup` already truncates to `maxRows`; truncation indicator not added (deferred)
- Empty prefix label — display raw prefix key as fallback
- Single binding — popup still shows header + one binding row
- Very narrow terminal (< 40 cols) — single column layout, binding text truncated to fit width
- Command expression is not a function call (e.g. `"save-current-file"`) — display the string as-is
