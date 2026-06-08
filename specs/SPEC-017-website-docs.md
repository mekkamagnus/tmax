# Feature: Website Documentation Section

## Feature Description

Add a `/docs` route to the tmax marketing website (Next.js 14 App Router) that serves as the public documentation hub. Docs content is authored in MDX, processed at build time, and rendered with a zcode.z.ai-style sidebar layout. Includes Cmd+K search powered by the `cmdk` library.

## User Story

As a developer evaluating tmax
I want to browse well-organized documentation with search on the website
So that I can learn how to install, configure, and extend tmax without cloning the repo

## Problem Statement

tmax has comprehensive documentation in texinfo format (`docs/tmax/tmax.texinfo`, `docs/tmax/tlisp.texinfo`) and markdown (`README.md`, `docs/INSTALLATION.md`), but none of it is accessible from the marketing website. Users must visit the GitHub repo and read raw files to learn how to use the editor.

## Solution Statement

Build a docs section using MDX for content authoring, `@next/mdx` for processing, `cmdk` for Cmd+K search, and a sidebar layout matching zcode.z.ai/en/newdocs/welcome. Content is sourced from texinfo manuals converted to MDX, ensuring the website always reflects the latest editor behavior.

## Tech Stack

| Concern | Tool | Why |
|---------|------|-----|
| Content format | MDX (`.mdx` files) | Rich React components inside prose. Industry standard for docs sites (Vercel, Stripe, Linear) |
| MDX processing | `@next/mdx` | Native Next.js App Router integration, static generation |
| Search | `cmdk` | Industry-standard Cmd+K component (used by Vercel, Linear, Raycast). Lightweight, composable |
| Styling | `@tailwindcss/typography` | `prose` classes for beautiful long-form docs without custom CSS |
| Syntax highlighting | Custom `<CodeBlock>` component | JetBrains Mono, dark background, line numbers |
| Layout | Sidebar + content | Matches zcode.z.ai pattern: fixed sidebar nav, scrollable content area |

## Layout Reference

Matching the zcode.z.ai/en/newdocs/welcome pattern:

```
┌─────────────────────────────────────────────────┐
│  Navbar: [tmax]  Features  Docs  GitHub  Install │
├──────────┬──────────────────────────────────────┤
│ Sidebar  │  Content Area                         │
│          │                                       │
│ Getting  │  # Page Title                         │
│ Started  │                                       │
│  Install │  Page content in prose...             │
│  First   │                                       │
│  Run     │  ```tlisp                             │
│          │  (defun hello () ...)                 │
│ Editing  │  ```                                   │
│  Modes   │                                       │
│  Keys    │  ┌─────────────────────────┐          │
│  Ops     │  │ ← Prev      Next →     │          │
│          │  └─────────────────────────┘          │
│ T-Lisp   │                                       │
│  Types   │                                       │
│  Forms   │                                       │
│  Stdlib  │                                       │
│          │                                       │
│ Config   │                                       │
│  init    │                                       │
│  Keys    │                                       │
│  Plugins │                                       │
├──────────┴──────────────────────────────────────┤
│  Footer                                          │
└─────────────────────────────────────────────────┘
```

- **Sidebar**: 260px fixed width on desktop, collapsible drawer on mobile
- **Content**: max-width 800px, prose-styled
- **Search**: Cmd+K opens a modal overlay (like Vercel docs, Linear)

## Relevant Files

### Existing files to modify

- `website/app/layout.tsx` — Root layout (may need metadata overrides for docs pages)
- `website/components/navbar.tsx` — Add "Docs" link to navigation
- `website/app/globals.css` — Extend with docs-specific styles (search modal, sidebar)
- `website/tailwind.config.ts` — Add typography plugin for prose styling
- `website/next.config.js` — Add `@next/mdx` plugin and MDX loader config
- `docs/tmax/tmax.texinfo` — Source content for editing modes, key bindings, commands
- `docs/tmax/tlisp.texinfo` — Source content for T-Lisp language and API reference
- `docs/INSTALLATION.md` — Source content for Getting Started page
- `docs/examples/basic-config.tlisp` — Source content for Configuration page
- `docs/examples/programming.tlisp` — Source content for Configuration page
- `README.md` — Source content for multiple pages (usage, key bindings, architecture)

### New files

```
website/
├── app/
│   └── docs/
│       ├── layout.tsx              # Docs shell: sidebar + content + search
│       ├── page.tsx                # Redirects to /docs/getting-started
│       ├── getting-started/
│       │   └── page.tsx            # Renders MDX content
│       ├── editing/
│       │   └── page.tsx
│       ├── tlisp/
│       │   └── page.tsx
│       └── configuration/
│           └── page.tsx
├── components/
│   ├── docs-sidebar.tsx            # Sidebar navigation with active page highlight
│   ├── docs-page.tsx               # Page wrapper: title, description, prev/next
│   ├── code-block.tsx              # Syntax-highlighted code block
│   ├── docs-search.tsx             # Cmd+K search modal (cmdk)
│   └── search-provider.tsx         # Search index provider
├── content/
│   └── docs/
│       ├── getting-started.mdx     # MDX content files
│       ├── editing.mdx
│       ├── tlisp.mdx
│       └── configuration.mdx
└── lib/
    └── docs.ts                     # MDX loader, sidebar config, search index
```

## Implementation Plan

### Phase 0: Update Documentation

Run the `/update-tmax-documentation` skill to regenerate texinfo manuals, HTML output, and README from the current codebase. This ensures all docs content reflects the latest API, features, and behavior before converting to MDX.

### Phase 1: Foundation — Dependencies and Config

Add MDX support, typography plugin, and search library to the website.

```bash
cd website
npm install @next/mdx @mdx-js/loader @mdx-js/react @tailwindcss/typography cmdk
```

Update `next.config.js`:
```js
const withMDX = require('@next/mdx')({
  extension: /\.mdx?$/,
})
module.exports = withMDX({
  pageExtensions: ['js', 'jsx', 'ts', 'tsx', 'md', 'mdx'],
})
```

Update `tailwind.config.ts` — add typography plugin:
```ts
plugins: [require("@tailwindcss/typography")]
```

### Phase 2: Content — Convert Docs to MDX

Convert the 4 core documentation pages from texinfo/markdown sources into MDX files under `website/content/docs/`. Each MDX file includes frontmatter for metadata and uses the custom `<CodeBlock>` component.

Example MDX frontmatter:
```yaml
---
title: "Getting Started"
description: "Install tmax and run your first editing session"
order: 1
section: "Getting Started"
---
```

The MDX files can import React components:
```mdx
import CodeBlock from '@/components/code-block'

## Install

<CodeBlock language="bash" filename="terminal">
{`curl -fsSL tmux.mekaelturner.com/install.sh | bash`}
</CodeBlock>
```

### Phase 3: Layout — Sidebar + Content

Create the docs layout matching the zcode pattern:

- `website/app/docs/layout.tsx` — Two-column layout with `<DocsSidebar>` and content area
- `website/components/docs-sidebar.tsx` — Hierarchical navigation with:
  - Active page highlighting using `usePathname()`
  - Collapsible sections
  - Mobile: hamburger toggle → slide-in drawer
- `website/components/docs-page.tsx` — Wrapper with title, description, prose content, prev/next links

### Phase 4: Search — Cmd+K

Implement search using `cmdk` (the library behind Vercel's Cmd+K, Linear's search, Raycast):

- `website/components/docs-search.tsx` — Search dialog triggered by Cmd+K / Ctrl+K
- `website/components/search-provider.tsx` — Builds a static search index from MDX frontmatter at build time
- Search index: array of `{ title, description, href, section }` entries generated from sidebar config
- Full-text search on page load (no external service needed for v1 — the docs are small enough)
- Keyboard shortcut: `Cmd+K` (Mac) / `Ctrl+K` (Windows/Linux)

### Phase 5: Core Pages — 4 Documentation Pages

Create the 4 documentation pages with content sourced from texinfo and markdown docs:

1. **Getting Started** (`/docs/getting-started`)
   - Source: `docs/INSTALLATION.md`, README installation section
   - Sections: Prerequisites, Install (binary), First Run, Basic Commands, Daemon/Client

2. **Editing** (`/docs/editing`)
   - Source: `docs/tmax/tmax.texinfo` chapters 4-6
   - Sections: Modes Overview, Normal Mode, Insert Mode, Visual Mode, Command Mode, M-x, Operators, Text Objects

3. **T-Lisp** (`/docs/tlisp`)
   - Source: `docs/tmax/tlisp.texinfo` chapters 1-8
   - Sections: Language Overview, Data Types, Special Forms, Standard Library, Macro System, Module System

4. **Configuration** (`/docs/configuration`)
   - Source: `docs/examples/basic-config.tlisp`, `programming.tlisp`, README config section
   - Sections: init.tlisp, Key Bindings, Custom Functions, Macros, Plugin System

### Phase 6: Navbar and Navigation

- Add "Docs" link to `website/components/navbar.tsx` (between "Features" and "GitHub")
- Wire sidebar links, prev/next navigation
- Verify responsive layout on mobile

### Phase 7: CI/CD Pipeline — Docs

Add a documentation pipeline triggered by `docs-*` tags.

## Step by Step Tasks

### Phase 0: Update documentation
- Run `/update-tmax-documentation` skill to regenerate all docs from current codebase
- Verify `docs/tmax/tmax.html` and `docs/tmax/tlisp.html` are up to date
- Verify `README.md` reflects current features and API

### Install dependencies
- `cd website && npm install @next/mdx @mdx-js/loader @mdx-js/react @tailwindcss/typography cmdk`
- Update `next.config.js` to enable MDX
- Add `require("@tailwindcss/typography")` to `plugins` in `tailwind.config.ts`

### Create docs utility module
- Create `website/lib/docs.ts`
- Define sidebar navigation structure (hierarchical sections with titles, hrefs, order)
- Define prev/next navigation helper
- Export search index (array of `{ title, description, href, section }`)

### Create MDX content files
- Create `website/content/docs/getting-started.mdx` from `docs/INSTALLATION.md` and README
- Create `website/content/docs/editing.mdx` from `docs/tmax/tmax.texinfo` chapters 4-6
- Create `website/content/docs/tlisp.mdx` from `docs/tmax/tlisp.texinfo` chapters 1-8
- Create `website/content/docs/configuration.mdx` from `docs/examples/*` and README config section

### Create code block component
- Create `website/components/code-block.tsx`
- Props: `code` (string children), `language?`, `filename?`
- Renders with JetBrains Mono, dark background, line numbers
- Supports `tlisp`, `typescript`, `bash` language hints

### Create docs sidebar component
- Create `website/components/docs-sidebar.tsx`
- Renders hierarchical navigation from sidebar config
- Highlight active page using `usePathname()`
- Collapsible on mobile (hamburger → slide-in drawer)

### Create docs page wrapper
- Create `website/components/docs-page.tsx`
- Props: `title`, `description`, `children`, `prevPage?`, `nextPage?`
- Renders title, description, content in `prose` class, prev/next navigation

### Create Cmd+K search
- Create `website/components/search-provider.tsx` — Static search index from sidebar config
- Create `website/components/docs-search.tsx` — `cmdk` dialog with Cmd+K/Ctrl+K trigger
- Searchable fields: title, description, section
- Style matches the dark theme (dark surface background, cyan accents)

### Create docs layout
- Create `website/app/docs/layout.tsx` — Two-column: sidebar (260px) + content
- Include `<DocsSearch>` trigger button in layout header
- Include `<DocsSidebar>` component
- Content area: scrollable, max-width 800px

### Create docs pages
- Create `website/app/docs/page.tsx` — Redirects to `/docs/getting-started`
- Create `website/app/docs/getting-started/page.tsx` — Renders MDX content
- Create `website/app/docs/editing/page.tsx` — Renders MDX content
- Create `website/app/docs/tlisp/page.tsx` — Renders MDX content
- Create `website/app/docs/configuration/page.tsx` — Renders MDX content

### Add "Docs" link to navbar
- Update `website/components/navbar.tsx` to add "Docs" link pointing to `/docs`

### Verify build and test
- Run `cd website && npm run build` — must succeed with zero errors
- Run `npm run dev` — verify all docs pages load at `/docs/*`
- Verify Cmd+K search opens and filters correctly
- Verify sidebar navigation highlights active page
- Verify prev/next navigation links between pages
- Verify responsive layout (sidebar collapses on mobile)

## Testing Strategy

### Build Verification
- `npm run build` confirms all routes compile and generate static HTML
- All MDX files parse without errors
- Search index builds correctly

### Manual Verification
- All 4 docs pages render styled content
- Cmd+K search modal opens, filters, and navigates
- Sidebar highlights active page
- Prev/next links navigate between pages in order
- Code blocks render with monospace font and line numbers
- Responsive: sidebar visible on desktop, collapsible on mobile

### Edge Cases
- Cmd+K works on all pages (not just docs)
- Search returns no results gracefully
- Sidebar collapse/expand on mobile breakpoints
- Code blocks with very long lines (horizontal scroll)
- Prev/next navigation at first/last pages

## Acceptance Criteria

- `/docs` route exists and redirects to `/docs/getting-started`
- `/docs/getting-started`, `/docs/editing`, `/docs/tlisp`, `/docs/configuration` all render MDX content with prose styling
- Sidebar navigation highlights the active page
- Prev/next links navigate between docs pages in order
- "Docs" link appears in the navbar
- **Cmd+K opens a search modal that filters all docs pages by title and navigates to the selected result**
- Code blocks render with monospace font, dark background, and line numbers
- Responsive layout: sidebar visible on desktop, collapsible on mobile
- `npm run build` succeeds with zero errors
- All pages are statically generated

## Validation Commands

- `cd website && npm run build` — Build succeeds, all docs routes appear in output
- `cd website && npm run dev` — Dev server starts, all `/docs/*` routes return HTTP 200

## Notes

- **Phase 0 is critical.** Always run `/update-tmax-documentation` before writing docs pages.
- **MDX is the content format.** Docs are authored as `.mdx` files with frontmatter and can use React components inline. This is the standard used by Vercel, Stripe, and Linear for their docs.
- **`cmdk` is the standard for Cmd+K.** It's the same library used by Vercel, Linear, and Raycast. No need to build a custom search component.
- **Static search index for v1.** The docs are small (4 pages). A JSON array of titles/descriptions/hrefs is sufficient. No Algolia or external service needed yet.
- Content is authored in MDX for v1. A future phase could automate texinfo → MDX conversion as part of the docs build pipeline.
- The typography plugin provides `prose` classes for beautiful long-form content without custom CSS.
- The existing texinfo HTML output can be referenced for content accuracy but should NOT be embedded — docs pages use native React components via MDX.

## CI/CD: Documentation Pipeline

### Pipeline 4: Docs — on `docs-*` tag push

```yaml
# .github/workflows/docs.yml
name: Update Docs
on:
  push:
    tags: ["docs-*"]

jobs:
  rebuild-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      # Regenerate texinfo manuals from codebase
      - run: bun run docs:build
      # Rebuild and deploy website with fresh docs content
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - working-directory: website
        run: npm install && npm run build
      - uses: cloudflare/pages-action@v1
        with:
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          apiToken: ${{ secrets.CF_API_TOKEN }}
          projectName: tmax
          directory: website/.next
```

### Full CI/CD Summary

| Pipeline | Trigger | What it does |
|----------|---------|-------------|
| **CI** | Every push/PR | typecheck, test, build verification |
| **Release** | `v*` tag push | Build 3 binaries → GitHub Release + deploy website |
| **Website** | Push to main (`website/**` only) | Deploy website to Cloudflare Pages |
| **Docs** | `docs-*` tag push | Regenerate texinfo manuals + redeploy website |

### Usage

```bash
# Update documentation and deploy
git tag docs-v0.2.1 && git push origin docs-v0.2.1
```
