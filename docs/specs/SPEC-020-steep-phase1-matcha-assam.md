# Feature: Steep Phase 1 — Matcha + Assam Reorganization

**Vision alignment:** Pillar B (Steep Independence) — primary. Establishes the `src/steep/` top-level directory structure. Pillar A (Purity) — pure API surfaces from the start.
**RFC source:** [RFC-006 Phase 1](../rfcs/RFC-006-steep-ecosystem.md) (implementation plan)
**See also:** [RFC-008](../rfcs/RFC-008-steep-bubbletea-gap-analysis.md) (Assam ↔ Bubble Tea gaps), [RFC-009](../rfcs/RFC-009-elm-purity-gap-analysis.md) (purity phases), [glamour-gap-analysis](../memos/glamour-gap-analysis.md) (Gap 6: missing ANSI attributes)
**Blocks:** [SPEC-021](./SPEC-021-steep-phase2-oolong.md) (Oolong depends on Matcha), [SPEC-018](./SPEC-018-markdown-major-mode.md) (markdown mode depends on Steep structure)
**Aligned with:** [technical-vision.md](../technical-vision.md) — Pillars A + B

## Feature Description

Reorganize tmax's existing Steep-adjacent code into the formal `src/steep/` package structure defined in RFC-006. Move style primitives to Matcha, reorganize the frontend index to Assam, and add missing ANSI text attributes identified in the glamour gap analysis.

This is RFC-006 Phase 1 — the foundational reorganization that all subsequent Steep work depends on.

## User Story

As a tmax developer
I want Steep packages organized under `src/steep/` with clean import paths
So that the Steep ecosystem has a clear, named package structure independent of tmax's editor internals

## Problem Statement

tmax's Steep-equivalent code is scattered across `src/frontend/frontends/steep/` (three levels deep), unnamed, and cannot be used outside tmax. The `style.ts` file is a nascent Lip Gloss but lacks key ANSI attributes. The frontend index file doesn't identify as "Assam." There is no top-level `src/steep/` directory reflecting Steep's status as an ecosystem umbrella.

## Solution Statement

1. Create `src/steep/` directory as the top-level Steep package home
2. Extract `style.ts` → `matcha.ts` with 4 new ANSI attribute functions
3. Move `screen.ts` and `input.ts` into `src/steep/`
4. Reorganize `index.ts` → `assam.ts`
5. Update all import sites across the codebase
6. Verify zero breakage with typecheck + tests

## Implementation Steps

### Step 1: Create directory structure

```
mkdir -p src/steep
```

### Step 2: Move and rename files

| Source | Destination | Purpose |
|--------|-------------|---------|
| `src/frontend/frontends/steep/style.ts` | `src/steep/matcha.ts` | Lip Gloss equivalent |
| `src/frontend/frontends/steep/screen.ts` | `src/steep/screen.ts` | Terminal primitives |
| `src/frontend/frontends/steep/input.ts` | `src/steep/input.ts` | Raw key input |
| `src/frontend/frontends/steep/index.ts` | `src/steep/assam.ts` | Bubble Tea equivalent |

### Step 3: Add missing ANSI attributes to Matcha

Per glamour-gap-analysis Gap 6, add these functions:

```typescript
export const italic = (text: string): string =>
  `\x1b[3m${text}\x1b[23m`;

export const underline = (text: string): string =>
  `\x1b[4m${text}\x1b[24m`;

export const strikethrough = (text: string): string =>
  `\x1b[9m${text}\x1b[29m`;

export const inverse = (text: string): string =>
  `\x1b[7m${text}\x1b[27m`;
```

Update `style()` options to accept all attributes.

### Step 4: Update import sites

Files that import from `style.ts` (per RFC-006):
- `src/frontend/frontends/steep/index.ts` → now `src/steep/assam.ts`
- `src/frontend/render/buffer-lines.ts`
- `src/frontend/render/minibuffer.ts`
- `src/frontend/render/status-line.ts`
- `src/frontend/render/gutter.ts`
- `src/render/ansi-to-html.ts`
- `src/render/capture-frame.ts`

Files that import from `index.ts` (assam):
- `src/main.tsx`
- Any frontend factory or entry point

Update all paths from `../steep/style` or `./style` to `../steep/matcha` or `./matcha`. Update assam imports similarly.

### Step 5: Clean up old directory

After all imports are updated and tests pass:
- Remove `src/frontend/frontends/steep/` if empty
- Verify no lingering references to old paths

## Acceptance Criteria

- [ ] `src/steep/matcha.ts` exists with all existing + 4 new ANSI attribute functions
- [ ] `src/steep/assam.ts` exists (moved from `src/frontend/frontends/steep/index.ts`)
- [ ] `src/steep/screen.ts` and `src/steep/input.ts` exist at new location
- [ ] `bun run typecheck:src` passes with zero errors
- [ ] `bun test` passes — all existing tests still pass
- [ ] `bun run typecheck` passes (full check)
- [ ] No imports reference `src/frontend/frontends/steep/` anywhere in the codebase
- [ ] `italic()`, `underline()`, `strikethrough()`, `inverse()` all produce correct ANSI escape sequences (verified by unit tests)

## Test Plan

### Unit tests: Matcha attributes (`test/unit/steep/matcha.test.ts`)

```typescript
describe('matcha', () => {
  test('italic wraps with \\x1b[3m / \\x1b[23m');
  test('underline wraps with \\x1b[4m / \\x1b[24m');
  test('strikethrough wraps with \\x1b[9m / \\x1b[29m');
  test('inverse wraps with \\x1b[7m / \\x1b[27m');
  test('style() accepts all new attributes in options');
  test('existing style functions (fg, bg, bold, dim) still work');
  test('stripAnsi removes all attribute escapes');
});
```

### Regression tests

- `bun test` — all existing tests pass after import path changes
- `bun run typecheck` — no type errors from moved files

## Files Changed

| File | Change |
|------|--------|
| `src/frontend/frontends/steep/style.ts` | Move → `src/steep/matcha.ts`, add 4 attribute functions |
| `src/frontend/frontends/steep/index.ts` | Move → `src/steep/assam.ts` |
| `src/frontend/frontends/steep/screen.ts` | Move → `src/steep/screen.ts` |
| `src/frontend/frontends/steep/input.ts` | Move → `src/steep/input.ts` |
| `src/frontend/render/buffer-lines.ts` | Update imports |
| `src/frontend/render/minibuffer.ts` | Update imports |
| `src/frontend/render/status-line.ts` | Update imports |
| `src/frontend/render/gutter.ts` | Update imports |
| `src/render/ansi-to-html.ts` | Update imports |
| `src/render/capture-frame.ts` | Update imports |
| `src/main.tsx` | Update imports |
| `test/unit/steep/matcha.test.ts` | New — attribute function tests |

## Notes

**Design decisions:**

- **Flat file for Matcha.** At ~120 lines (88 current + 4 new attributes + updated style()), a single file is sufficient. Promote to `matcha/index.ts` only if Lip Gloss parity features push past ~300 lines.
- **`src/steep/` not `src/frontend/frontends/steep/`.** Steep is a top-level ecosystem umbrella per RFC-006 DD#5. The old location buried it three levels deep.
- **No functional changes.** This is purely a reorganization + attribute addition. No behavior changes to the editor, renderer, or T-Lisp engine.
