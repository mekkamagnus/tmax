# RFC-006: The Steep Ecosystem — A TypeScript Charmbracelet

**Status:** 📋 PROPOSED
**Created:** 2026-06-08
**Author:** tmax Design Team
**Depends on:** Gap analysis in `docs/memos/glamour-gap-analysis.md`

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

Build the **Steep ecosystem** — a complete, zero-dependency TypeScript equivalent of the Charmbracelet library suite. Steep provides every layer needed for rich terminal UI applications: Elm-architecture framework, ANSI styling and layout, markdown rendering, UI widgets, forms/prompts, and logging. Each package maps 1:1 to a Charm library and uses a tea-themed name.

Steep is both the backbone of tmax's UI and a standalone library that any TypeScript/Bun terminal application could use — just as Charm libraries power thousands of Go TUI tools beyond the Charm team's own products.

## Motivation

The Charmbracelet ecosystem proved that composable, single-purpose TUI libraries beat monolithic frameworks. Each Charm library does one thing well: Bubble Tea handles the event loop, Lip Gloss handles styling, Glamour handles markdown, Bubbles provides widgets. They compose cleanly because each has a narrow, well-defined responsibility.

tmax already follows this pattern internally — `style.ts` is a nascent Lip Gloss, `screen.ts` is terminal primitives, the renderer is a nascent Glamour — but the code is scattered, unnamed, and can't be used outside tmax. The Steep ecosystem formalizes these into distinct packages with clean APIs, making them:

1. **Reusable** — any Bun/Node terminal app can `import { style } from 'steep/matcha'`
2. **Testable** — each package has isolated unit tests independent of tmax's editor model
3. **Composable** — use Matcha alone for simple ANSI output, or Steep + Matcha + Boba for a full TUI
4. **Named** — tea-themed names create a memorable, coherent identity

## Ecosystem Overview

```
                    ┌─────────────┐
                    │    tmax     │  (editor — uses Steep as its UI backbone)
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
   ┌─────┴─────┐    ┌──────┴──────┐   ┌──────┴──────┐
   │   Steep   │    │   Matcha    │   │   Oolong    │
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
| **Bubble Tea** | Elm-architecture TUI framework | **Steep** | Event loop, update/render, alt screen, key input | ✅ Exists |
| **Lip Gloss** | Terminal styling, layout, borders, padding | **Matcha** | ANSI styling primitives — 24-bit color, text attributes, layout | 🔄 Extract from `style.ts` |
| **Glamour** | Markdown → styled ANSI renderer | **Oolong** | CommonMark/GFM parser, stylesheet-driven ANSI renderer, word wrap | 📋 Planned |
| **Bubbles** | Pre-built TUI components | **Boba** | List, table, viewport, spinner, progress bar widgets | 📋 Future |
| **Huh** | Interactive forms and prompts | **Chai** | Text input, select, confirm, multi-select forms | 📋 Future |
| **Log** | Structured logging | **Pu-erh** | Leveled logging, structured output, `*Messages*` integration | 📋 Future |
| **Gum** | Shell script TUI glamour | **Sencha** | CLI pretty-printing, shell-friendly styled output | 📋 Future |

### Naming rationale

- **Steep**: Tea is steeped. The framework that steeps everything.
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
 └── steep (framework)
      ├── matcha (styling)     ← steep uses matcha for all ANSI output
      ├── boba (widgets)       ← boba uses matcha for widget styling
      │    └── matcha
      └── oolong (markdown)    ← oolong uses matcha for ANSI rendering
           └── matcha

chai (forms)       → depends on steep (event loop) + matcha (styling)
pu-erh (logging)   → depends on matcha (formatting)
sencha (CLI)        → depends on matcha (styling)
```

Matcha is the foundation — every other package depends on it for ANSI output. Steep is the framework layer that owns the terminal lifecycle. Higher-level packages (Oolong, Boba, Chai) compose on top.

### Package layout

```
src/steep/
├── steep.ts           # Framework: event loop, alt screen, key dispatch
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
import { SteepFrontend } from '../steep/steep';
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

### Steep (Bubble Tea) — Reorganize current frontend

**Current location**: `src/frontend/frontends/steep/` (index.ts, screen.ts, input.ts)
**New location**: `src/steep/` (steep.ts, screen.ts, input.ts)

Steep owns:
- Terminal lifecycle (alt screen enter/exit, raw mode)
- Event loop (render loop, resize handling)
- Key dispatch (raw key → normalized key events)
- Screen abstraction (writeAt, moveTo, clear, cursor)
- Component model (init/update/view — already implicit in tmax's render cycle)

### Boba, Chai, Pu-erh, Sencha — Future

No current implementation. Each follows the same pattern: standalone module with clean API, depends on Matcha for styling, integrates with Steep for terminal lifecycle when needed.

## Implementation Plan

### Phase 1: Matcha + Steep reorganization

1. Create `src/steep/` directory
2. Move `src/frontend/frontends/steep/style.ts` → `src/steep/matcha.ts`
3. Move `src/frontend/frontends/steep/screen.ts` → `src/steep/screen.ts`
4. Move `src/frontend/frontends/steep/input.ts` → `src/steep/input.ts`
5. Reorganize `src/frontend/frontends/steep/index.ts` → `src/steep/steep.ts`
6. Add missing ANSI attributes (italic, underline, strikethrough, inverse)
7. Update all import sites across the codebase
8. Run `bun run typecheck` and `bun test` — zero breakage

### Phase 2: Oolong implementation

1. Build Oolong per the gap analysis (~1,050 lines across 5 files)
2. Oolong imports Matcha for ANSI styling
3. Add `markdown-preview` T-Lisp command
4. Unit tests in `test/unit/oolong/`

### Phase 3: Steep framework formalization

1. Formalize the Elm-architecture API (init/update/view) so Steep can be used outside tmax
2. Screen and input primitives become documented Steep internals
3. Extract tmax-specific rendering (`buffer-lines.ts`, `minibuffer.ts`, etc.) from Steep core

### Phase 4+: Boba, Chai, Pu-erh, Sencha

As needed. Each is a separate module with its own API and tests.

## Design Decisions

1. **Monorepo, not npm packages**: Steep packages live in `src/steep/` as directories within tmax's source tree. This matches Charm's Go module structure and tmax's zero-dependency policy. No build step, no package publishing, no versioning overhead.

2. **Flat file for Matcha**: Start as `matcha.ts`. At ~120 lines (88 current + 4 new attributes), a single file is sufficient. Promote to `matcha/index.ts` only if Lip Gloss parity features (layout, borders, padding) push it past ~300 lines.

3. **Directory for Oolong**: Starts as `oolong/` because the gap analysis identifies ~1,050 lines across 5 files. A flat file would be unwieldy.

4. **Glamour-compatible theme format**: Oolong adopts Glamour's JSON stylesheet format directly. This gives instant access to all Charm themes and makes custom themes trivial for anyone familiar with Glamour.

5. **`src/steep/` not `src/frontend/frontends/steep/`**: The current location buries Steep three levels deep under `frontend/frontends/`. Moving to `src/steep/` reflects that Steep is a top-level ecosystem, not just a frontend implementation detail.

6. **No namespace collision**: All tea names are unique, lowercase, single-word. No overlap with tmax terminology (buffer, frame, minibuffer, etc.) or TypeScript builtins.

## Open Questions

- **Should Steep packages be importable outside tmax?** Technically yes (`import from '../steep/matcha'`), but there's no package.json export map today. If external use matters, add exports later — don't design for it now.
- **Should `applyHighlights()` from `buffer-lines.ts` move to Matcha?** It wraps text regions with `style()` calls — a Lip Gloss-like layout concern. But it's coupled to the editor's `HighlightSpan` model. Keep it in the editor layer for now; extract if Matcha grows layout primitives.
- **Should `screen.ts` and `input.ts` get their own tea names?** They're terminal primitives (CSI sequences, raw mode), not styling. For now they stay as Steep internals. If they grow complex enough to warrant a standalone identity, they could become a "Darjeeling" or similar.
