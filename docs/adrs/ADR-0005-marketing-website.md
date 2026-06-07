# ADR 0005: Marketing Website

**Date**: 2026-06-08
**Status**: Accepted

## Context

tmax needs a public-facing website at tmux.mekaelturner.com. No branding assets or existing website exist. The target audience is developers who prefer keyboard-driven terminal workflows.

## Decision

Build a Next.js 14 static site with Tailwind CSS, colocated in `./website/` within the tmax repository.

### Tech stack

- **Next.js 14** (App Router) — static export, SSR, good DX
- **Tailwind CSS** — utility-first styling
- **Framer Motion** — scroll animations
- **TypeScript** — consistent with tmax project

### Design

- Dark terminal aesthetic (near-black background, cyan/violet accents)
- JetBrains Mono + Inter fonts
- 7 sections: Navbar, Hero, Terminal Demo, Features, T-Lisp Showcase, Architecture, Footer
- CSS-animated terminal mockup (no real terminal or images needed)
- Responsive, mobile-friendly

### Sections

1. **Navbar** — Fixed, transparent-to-solid on scroll
2. **Hero** — Headline, subtitle, install command with copy-to-clipboard
3. **Terminal Demo** — Animated terminal showing file editing, T-Lisp eval, mode switching
4. **Features** — 3 cards: Modal Editing, T-Lisp Extensibility, Daemon/Client
5. **T-Lisp Showcase** — Syntax-highlighted init.tlisp example
6. **Architecture** — Visual diagram (TypeScript Core ↔ T-Lisp Engine ↔ Your Config)
7. **Footer** — GitHub, MIT License, version

## Consequences

- Website is a static build — can deploy to any static host (Vercel, Cloudflare Pages, S3)
- No external image dependencies (all CSS/SVG graphics)
- `./website/` has its own package.json and node_modules, independent from the editor build
- Build: `cd website && npm run build` → static HTML in `website/.next/`
