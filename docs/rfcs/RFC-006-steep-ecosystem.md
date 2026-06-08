# RFC-006: The Steep Ecosystem — A TypeScript Charmbracelet

**Status:** 📋 PROPOSED
**Created:** 2026-06-08
**Updated:** 2026-06-09
**Author:** tmax Design Team
**Depends on:** Gap analysis in `docs/memos/glamour-gap-analysis.md`
**See also:** RFC-008 (Assam ↔ Bubble Tea gap analysis), RFC-009 (Elm purity gap analysis)
**Implementation specs:** [SPEC-020](../specs/SPEC-020-steep-phase1-matcha-assam.md) (Phase 1: Matcha + Assam), [SPEC-021](../specs/SPEC-021-steep-phase2-oolong.md) (Phase 2: Oolong)
**Aligned with:** [technical-vision.md](../technical-vision.md) — Pillars A (Purity) + B (Steep Independence)

## Table of Contents
- [Abstract](#abstract)
- [Motivation](#motivation)
- [Ecosystem Overview](#ecosystem-overview)
- [Package Map](#package-map)
- [Architecture](#architecture)
- [Detailed Design](#detailed-design)
- [Implementation Plan](#implementation-plan)
- [Design Decisions](#design-decisions)
- [Open Questions](#open-questions)

---

## Abstract

Build the **Steep ecosystem** — a complete, zero-dependency TypeScript equivalent of the Charmbracelet library suite. Steep provides every layer needed for rich terminal UI applications: Elm-architecture framework (Assam), ANSI styling and layout (Matcha), markdown rendering (Oolong), UI widgets (Boba), forms/prompts (Chai), and logging (Pu-erh). Each package maps 1:1 to a Charm library and uses a tea-themed name.

Steep is both the backbone of tmax's UI and a standalone library that any TypeScript/Bun terminal application could use — just as Charm libraries power thousands of Go TUI tools beyond the Charm team's own products. Per the [technical vision](../technical-vision.md), Steep is a product, not an internal detail. Its API must be generic, its interfaces must be pure, and tmax is its pressure test. The vision's Pillar B (Steep Independence) requires that Steep can be extracted and published as a standalone npm package with no tmax-specific code.

## Motivation

The Charmbracelet ecosystem proved that composable, single-purpose TUI libraries beat monolithic frameworks. Each Charm library does one thing well: Bubble Tea handles the event loop, Lip Gloss handles styling, Glamour handles markdown, Bubbles provides widgets. They compose cleanly because each has a narrow, well-defined responsibility.

tmax already follows this pattern internally — `style.ts` is a nascent Lip Gloss, `screen.ts` is terminal primitives, the renderer is a nascent Glamour — but the code is scattered, unnamed, and can't be used outside tmax. The Steep ecosystem formalizes these into distinct packages with clean APIs, making them:

1. **Reusable** — any Bun/Node terminal app can `import { style } from 'steep/matcha'`
2. **Testable** — each package has isolated unit tests independent of tmax's editor model
3. **Composable** — use Matcha alone for simple ANSI output, or Assam + Matcha + Boba for a full TUI
4. **Named** — tea-themed names create a memorable, coherent identity

## Ecosystem Overview

```
                    ┌─────────────┐
                    │    tmax     │  (editor — uses Steep as its UI backbone)
                    └──────┬──────┘
                           │
                     ┌─────┴─────┐
                     │   Steep   │  (ecosystem umbrella — like "Charmbracelet")
                     └─────┬─────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
   ┌─────┴─────┐    ┌──────┴──────┐   ┌──────┴──────┐
   │   Assam   │    │   Matcha    │   │   Oolong    │
   │ (Bubble   │    │ (Lip Gloss) │   │ (Glamour)   │
   │  Tea)     │    │             │   │             │
   │           │    │ ANSI style  │   │ Markdown →  │
   │ Elm-arch  │    │ Color/fg/bg │   │ ANSI render │
   │ TUI frame │    │ Bold/dim/   │   │ Stylesheets │
   │           │    │ italic/...  │   │ Word wrap   │
   └─────┬─────┘    └──────┬──────┘   └─────────────┘
         │                 │
   ┌─────┴─────┐          │
   │   Boba    │          │
   │ (Bubbles) │          │
   │           │          │
   │ Widgets:  │          │
   │ List      │          │
   │ Table     │          │
   │ Viewport  │          │
   │ Spinner   │          │
   └───────────┘          │
                          │
   ┌──────────┐    ┌──────┴──────┐    ┌───────────┐
   │   Chai   │    │   Pu-erh    │    │  Sencha   │
   │  (Huh)   │    │   (Log)     │    │   (Gum)   │
   │          │    │             │    │           │
   │ Forms    │    │ Structured  │    │ CLI       │
   │ Prompts  │    │ logging     │    │ pretty-   │
   │ Selects  │    │ Levels      │    │ printing  │
   └──────────┘    └─────────────┘    └───────────┘
```

## Package Map

| Charm Library | Charm Purpose | Steep Package | Steep Purpose | Status |
|---|---|---|---|---|
| **Bubble Tea** | Elm-architecture TUI framework | **Assam** | Event loop, update/render, alt screen, key input | ✅ Exists |
| **Lip Gloss** | Terminal styling, layout, borders, padding | **Matcha** | ANSI styling primitives — 24-bit color, text attributes, layout | 🔄 Extract from `style.ts` |
| **Glamour** | Markdown → styled ANSI renderer | **Oolong** | CommonMark/GFM parser, stylesheet-driven ANSI renderer, word wrap | 📋 Planned |
| **Bubbles** | Pre-built TUI components | **Boba** | List, table, viewport, spinner, progress bar widgets | 📋 Future |
| **Huh** | Interactive forms and prompts | **Chai** | Text input, select, confirm, multi-select forms | 📋 Future |
| **Log** | Structured logging | **Pu-erh** | Leveled logging, structured output, `*Messages*` integration | 📋 Future |
| **Gum** | Shell script TUI glamour | **Sencha** | CLI pretty-printing, shell-friendly styled output | 📋 Future |

### Naming rationale

- **Steep**: The umbrella name. Tea is steeped — the ecosystem that steeps everything. Like "Charmbracelet" is to Charm.
- **Assam**: The backbone tea — strong, foundational, the base of English Breakfast. A framework is the backbone of every app.
- **Matcha**: The most visually vivid tea — bright, saturated green. Styling makes things look vibrant.
- **Oolong**: Partially oxidized — an in-between state of raw markdown and rendered output.
- **Boba**: Literally "bubble tea." Maps directly to Bubbles.
- **Chai**: Interactive blending of spices. Forms/prompts blend inputs together.
- **Pu-erh**: Aged/fermented tea that keeps history. Logging keeps history.
- **Sencha**: Everyday accessible tea. Shell tooling should be simple and accessible.

## Architecture

### Dependency graph

```
tmax
 └── steep (ecosystem umbrella)
      └── assam (framework)
           ├── matcha (styling)     ← assam uses matcha for all ANSI output
           ├── boba (widgets)       ← boba uses matcha for widget styling
           │    └── matcha
           └── oolong (markdown)    ← oolong uses matcha for ANSI rendering
                └── matcha

chai (forms)       → depends on assam (event loop) + matcha (styling)
pu-erh (logging)   → depends on matcha (formatting)
sencha (CLI)        → depends on matcha (styling)
```

Matcha is the foundation — every other package depends on it for ANSI output. Assam is the framework layer that owns the terminal lifecycle. Steep is the umbrella. Higher-level packages (Oolong, Boba, Chai) compose on top.

### Purity responsibilities

RFC-009 classifies purity gaps into **Steep-layer** (framework must solve, generic for all consumers) and **tmax-layer** (application must solve, tmax-specific). Only one gap is Steep-layer:

| Gap | Layer | Steep responsibility |
|-----|-------|---------------------|
| Async → Cmd | **Steep-layer** | Assam must provide `AsyncCmd`, `BatchCmd`, etc. The Cmd system is framework infrastructure — any Steep app needs it. Blocked until RFC-008 Gap 3 is implemented. |
| Setter closures | tmax-layer | Steep's `Update` contract supports return-state, but the 120 ops functions are tmax code. |
| T-Lisp environment | tmax-layer | Persistent environments are a T-Lisp implementation detail. Steep doesn't know about T-Lisp. |
| Module registries | tmax-layer | Moving registries into state is tmax's business. Steep requires that all state is in the model. |

This distinction means **Steep's API is already pure by design** — the purity work is in tmax's adapter layer. As RFC-009 phases land, the adapter shifts from wrapping mutation to wrapping state-returning functions. The Steep API (`Update`, `Init`, `View`, `Cmd`) doesn't change.

### Package layout

```
src/steep/
├── assam.ts           # Framework: Elm arch, event loop, alt screen, key dispatch
├── matcha.ts          # Styling: ANSI colors, attributes, layout
├── screen.ts          # Terminal primitives: writeAt, moveTo, clear, cursor
├── input.ts           # Raw key input: read, normalize, dispatch
├── oolong/            # Markdown renderer
│   ├── parser.ts
│   ├── ast.ts
│   ├── renderer.ts
│   ├── themes/
│   │   ├── dark.ts
│   │   └── light.ts
│   ├── wrap.ts
│   └── table.ts
├── boba/              # Widgets (future)
│   ├── list.ts
│   ├── table.ts
│   ├── viewport.ts
│   └── spinner.ts
├── chai/              # Forms (future)
│   ├── input.ts
│   ├── select.ts
│   └── confirm.ts
├── pu-erh/            # Logging (future)
│   └── logger.ts
└── sencha/            # CLI (future)
    └── format.ts
```

### Integration with tmax

tmax imports Steep packages directly:

```typescript
import { style, fg, bg, bold, italic } from '../steep/matcha';
import { renderMarkdown } from '../steep/oolong/renderer';
import { AssamFrontend } from '../steep/assam';
```

No npm packages, no indirection. Steep lives inside tmax's source tree as `src/steep/`. The packages are directories within a monorepo, not separate npm packages — matching Charm's Go module structure where libraries live in the same GitHub org.

## Detailed Design

### Matcha (Lip Gloss) — Extract from `style.ts`

**Current location**: `src/frontend/frontends/steep/style.ts` (88 lines)
**New location**: `src/steep/matcha.ts`

Matcha owns all ANSI styling primitives:

**Existing (carry over):**
- `style()` — composite styling (fg, bg, bold, dim)
- `fg()`, `bg()` — color primitives (24-bit true-color + 256-color named)
- `bold()`, `dim()` — attribute helpers
- `stripAnsi()` — ANSI stripping for width calculations
- `reset` — reset escape constant
- Color types (`AnsiColor`, `NamedColor`, `colorCodes`, `hexToRGB`)

**New (from gap analysis):**
- `italic()` — `\x1b[3m` / `\x1b[23m`
- `underline()` — `\x1b[4m` / `\x1b[24m`
- `strikethrough()` — `\x1b[9m` / `\x1b[29m`
- `inverse()` — `\x1b[7m` / `\x1b[27m`
- Updated `style()` options to accept all attributes

**Future Lip Gloss parity:**
- Layout: `border()`, `padding()`, `margin()`, `width()`, `height()`
- Alignment: `alignLeft()`, `alignRight()`, `alignCenter()`
- Joining: `horizontalJoin()`, `verticalJoin()`
- Position: `place()`, `center()`

**Files that import from `style.ts`** (will update to `matcha.ts`):
- `src/frontend/frontends/steep/index.ts`
- `src/frontend/render/buffer-lines.ts`
- `src/frontend/render/minibuffer.ts`
- `src/frontend/render/status-line.ts`
- `src/frontend/render/gutter.ts`
- `src/render/ansi-to-html.ts`
- `src/render/capture-frame.ts`

### Oolong (Glamour) — New Module

Per the gap analysis (`docs/memos/glamour-gap-analysis.md`), Oolong is a stylesheet-driven markdown renderer:

```
src/steep/oolong/
├── parser.ts      # CommonMark + GFM recursive-descent parser (~400 lines)
├── ast.ts         # AST type definitions (~80 lines)
├── renderer.ts    # Stylesheet-driven ANSI renderer (~350 lines)
├── themes/
│   ├── dark.ts    # Dark theme (Glamour-compatible JSON format)
│   └── light.ts   # Light theme
├── wrap.ts        # Word-wrap engine with ANSI awareness (~120 lines)
└── table.ts       # GFM table formatter (~100 lines)
```

**API:**
```typescript
import { renderMarkdown } from '../steep/oolong/renderer';
import { darkTheme } from '../steep/oolong/themes/dark';

const lines = renderMarkdown(markdownText, {
  width: 80,
  theme: darkTheme,
});
// Returns string[] — one ANSI-encoded line per visual line
```

Oolong imports Matcha for ANSI output. Theme format matches Glamour's JSON stylesheet structure so existing Charm themes (dracula, catppuccin, etc.) work without modification.

### Assam (Bubble Tea) — Reorganize current frontend

**Current location**: `src/frontend/frontends/steep/` (index.ts, screen.ts, input.ts)
**New location**: `src/steep/` (assam.ts, screen.ts, input.ts)

Assam owns:
- Terminal lifecycle (alt screen enter/exit, raw mode)
- Event loop (render loop, resize handling)
- Key dispatch (raw key → normalized key events)
- Screen abstraction (writeAt, moveTo, clear, cursor)
- Component model (init/update/view — already implicit in tmax's render cycle)

**Cmd system (Steep-layer infrastructure):** Per RFC-009, the Cmd system (`AsyncCmd`, `BatchCmd`, etc.) is Steep-layer — it must be generic and available to any Steep application, not just tmax. This is the only purity gap that is Steep's responsibility; all others are tmax-layer. RFC-009 Phase 4 (async → Cmd) is blocked until RFC-008 Gap 3 is implemented. Currently, only 7 `await` expressions in tmax require this, all for infrequent operations (file save, file load, init).

### Boba, Chai, Pu-erh, Sencha — Future

No current implementation. Each follows the same pattern: standalone module with clean API, depends on Matcha for styling, integrates with Assam for terminal lifecycle when needed.

## Implementation Plan

### Phase 1: Matcha + Assam reorganization

_Implementation spec: [SPEC-020](../specs/SPEC-020-steep-phase1-matcha-assam.md)_

1. Create `src/steep/` directory
2. Move `src/frontend/frontends/steep/style.ts` → `src/steep/matcha.ts`
3. Move `src/frontend/frontends/steep/screen.ts` → `src/steep/screen.ts`
4. Move `src/frontend/frontends/steep/input.ts` → `src/steep/input.ts`
5. Reorganize `src/frontend/frontends/steep/index.ts` → `src/steep/assam.ts`
6. Add missing ANSI attributes (italic, underline, strikethrough, inverse)
7. Update all import sites across the codebase
8. Run `bun run typecheck` and `bun test` — zero breakage

### Phase 2: Oolong implementation

_Implementation spec: [SPEC-021](../specs/SPEC-021-steep-phase2-oolong.md)_

1. Build Oolong per the gap analysis (~1,050 lines across 5 files)
2. Oolong imports Matcha for ANSI styling
3. Add `markdown-preview` T-Lisp command
4. Unit tests in `test/unit/oolong/`

### Phase 3: Assam framework formalization

1. Formalize the Elm-architecture API (init/update/view) so Assam can be used outside tmax — this is RFC-008 Gap 1
2. Screen and input primitives become documented Assam internals
3. Extract tmax-specific rendering (`buffer-lines.ts`, `minibuffer.ts`, etc.) from Assam core
4. **Purity path (RFC-009):** The Assam `Update` type is designed for pure functions. Currently tmax's adapter wraps `editor.handleKey()` which mutates state. RFC-009 defines four phases ordered by deliverable value:
   - **Phase 1 (Gap C):** Move module-scoped registries into `EditorState` — makes `getEditorState()` a complete snapshot (~1,700 lines). Prerequisite for everything.
   - **Phase 2 (Gap A):** Change 120 ops functions from setter closures to return-state objects — enables snapshot testing (~4,300 lines). Combined with Phase 1, delivers `assert update(msg, state).model === expected`.
   - **Phase 3 (Gap B):** Persistent T-Lisp environments — unblocks Loom (RFC-010) package isolation (~5,600 lines). Coordinate with RFC-010 design.
   - **Phase 4 (Gap D):** Async → Cmd system — the only Steep-layer gap. Assam provides `AsyncCmd`, `BatchCmd` (~2,500 lines). Blocked on RFC-008 Gap 3.

   The Assam API doesn't change across these phases — only tmax's adapter internals shift. Phases 1+2 (~6,000 lines) deliver snapshot testing immediately. Phase 3 is Loom's foundation. Phase 4 awaits the Cmd system.

### Phase 4+: Boba, Chai, Pu-erh, Sencha

As needed. Each is a separate module with its own API and tests.

## Design Decisions

1. **Monorepo, not npm packages (for now)**: Steep packages live in `src/steep/` as directories within tmax's source tree. This matches Charm's Go module structure and tmax's zero-dependency policy. No build step, no package publishing, no versioning overhead. The vision says Steep will be its own library — when that happens, each package directory becomes its own npm package with the same API. The internal structure is designed for that extraction.

2. **Flat file for Matcha**: Start as `matcha.ts`. At ~120 lines (88 current + 4 new attributes), a single file is sufficient. Promote to `matcha/index.ts` only if Lip Gloss parity features (layout, borders, padding) push it past ~300 lines.

3. **Directory for Oolong**: Starts as `oolong/` because the gap analysis identifies ~1,050 lines across 5 files. A flat file would be unwieldy.

4. **Glamour-compatible theme format**: Oolong adopts Glamour's JSON stylesheet format directly. This gives instant access to all Charm themes and makes custom themes trivial for anyone familiar with Glamour.

5. **`src/steep/` not `src/frontend/frontends/steep/`**: The current location buries Steep three levels deep under `frontend/frontends/`. Moving to `src/steep/` reflects that Steep is a top-level ecosystem umbrella.

6. **No namespace collision**: All tea names are unique, lowercase, single-word. No overlap with tmax terminology (buffer, frame, minibuffer, etc.) or TypeScript builtins.

7. **Steep is the umbrella, Assam is the framework**: Steep is to the ecosystem what Charmbracelet is to Charm — the org-level name. Assam is the specific framework package, like Bubble Tea is the specific framework within Charmbracelet.

8. **Pure API by design, pure internals incrementally.** The Assam API (`Update`, `Init`, `View`, `Cmd`) is designed for pure functions — no tmax-specific types, no editor assumptions. tmax's current adapter wraps mutating internals, but this is temporary (RFC-009). The API stays the same as purity phases land. This is the vision's convergence point: Pillar A (purity) and Pillar B (Steep independence) both require the same thing — a framework that is pure by design and generic enough to stand alone. RFC-009 confirms the performance overhead is negligible: the buffer layer is already purely functional (proves the pattern works), EditorState is 33 shallow references (object spread is <1μs), and V8's generational GC handles short-lived objects efficiently. The real tradeoff is development time (~18,100 lines across 30+ files), not runtime performance.

## Open Questions

- **Resolved: Steep packages will be importable outside tmax.** The technical vision (Pillar B: Steep Independence) answers this: Steep will become its own standalone library. The current monorepo structure is designed for eventual extraction. Each package directory will become its own npm package with the same API. No action needed now — the internal structure is already correct.
- **Should `applyHighlights()` from `buffer-lines.ts` move to Matcha?** It wraps text regions with `style()` calls — a Lip Gloss-like layout concern. But it's coupled to the editor's `HighlightSpan` model. Keep it in the editor layer for now; extract if Matcha grows layout primitives.
- **Should `screen.ts` and `input.ts` get their own tea names?** They're terminal primitives (CSI sequences, raw mode), not styling. For now they stay as Assam internals. If they grow complex enough to warrant a standalone identity, they could become a "Darjeeling" or similar.
