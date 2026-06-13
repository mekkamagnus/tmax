# RFC-012C: Rich Rendering — Structural and Screenshot Tiers

**Date:** 2026-06-11
**Status:** Proposed
**Author:** Mekael Turner
**Parent:** [RFC-012: browse-url — Terminal-Aware URL Handling](RFC-012-browse-url.md)
**Depends On:** [RFC-012A](RFC-012A-browse-url-mvp.md), [RFC-012B](RFC-012B-in-terminal-reading.md)

## Summary

Visual rendering inside the terminal. Two tiers: structural rendering powered by Playwright's accessibility tree (works on any terminal with color), and screenshot rendering via terminal image protocols (Kitty, Sixel, iTerm2) for image-capable terminals. Includes smart features: per-URL routing, markdown live preview, doc resolution.

## Relationship to Parent RFC

This is a sub-RFC of [RFC-012](RFC-012-browse-url.md). It builds on [RFC-012B](RFC-012B-in-terminal-reading.md) (browse buffers, data model, Playwright session management) and adds two higher rendering tiers plus smart features.

RFC-012 sections relevant to this sub-RFC:
- [Rendering Tiers](RFC-012-browse-url.md#rendering-tiers) — Tier 1 (Screenshot) and Tier 2 (Structural)
- [Rendering Backends in Detail](RFC-012-browse-url.md#rendering-backends-in-detail) — screenshot, structural, Kitty/Sixel/iTerm2 protocols
- [Terminal Capability Detection](RFC-012-browse-url.md#terminal-capability-detection) — TypeScript detects image protocol support
- [Playwright Integration](RFC-012-browse-url.md#playwright-integration) — a11y tree extraction, screenshot capture
- [Smart Features](RFC-012-browse-url.md#smart-features) — markdown preview, inline image hints

## Scope

### Structural Rendering (Tier 2)

Powered by Playwright's accessibility tree dump. Works on any terminal with color support.

- Playwright a11y tree extraction
- ANSI structural renderer: bold headings, colored numbered links, form fields `[input: ___]`, buttons `[button: Submit]`
- Browse-mode keymap (j/k scroll, f follow, o open URL)
- Form interaction (fill fields, submit with confirmation)
- `gh`/`gl` for browse history back/forward
- `R` to toggle Reader / Structural / Screenshot tier
- Reader/Structural split view: left article, right outline/headings

### Screenshot Rendering (Tier 1)

Powered by Playwright screenshots transmitted via terminal image protocols. Requires image-capable terminal.

- Terminal capability detection (Kitty, Sixel, iTerm2)
- Kitty graphics protocol implementation
- Sixel encoding implementation
- iTerm2 inline image protocol implementation
- Playwright screenshot → terminal image pipeline
- Scroll by re-capturing at different offsets
- Click-to-interact (map terminal clicks to Playwright page coordinates)
- Image preview for individual images in structural rendering (`pi`)

### Smart Features

- Per-URL-pattern rendering tier routing
- Markdown live preview (split view with Playwright rendering)
- Smart link detection (wiki links, org links, contextual refs)
- `browse-docs-at-point` for npm, Bun, TypeScript, Python, Go docs
- `browse-current-package-homepage`
- Image placeholders in Reader mode, with `pi` to preview inline

### Out of Scope

- Active browsing sessions (see [RFC-012D](RFC-012D-active-browsing.md))

## Architecture

### Rendering Tier Selection

Auto-detection picks the best available tier:

```
Terminal supports Kitty/Sixel/iTerm2 images?
  └─ Yes → Screenshot tier (Tier 1)
  └─ No → Structural tier (Tier 2)
       └─ Playwright unavailable? → Reader tier (Tier 3, from RFC-012B)
            └─ Network unavailable? → Plaintext from cache (Tier 4, from RFC-012B)
                 └─ Nothing works? → External browser (Tier 5, from RFC-012A)
```

Users override with `(browse-render-tier 'structural)` or per-URL-pattern.

### Browse Buffer Data Model Extension

Extends the RFC-012B data model:

```lisp
;; Additional buffer-local variables for RFC-012C
browse-buffer-forms            ; alist — (id . field-metadata) for interactive forms
browse-buffer-images           ; alist — (number . (src-url . alt-text)) for inline images
browse-buffer-image-protocol   ; symbol — kitty | sixel | iterm2 | none
```

### Structural Rendering Flow

1. Playwright navigates to URL, waits for `networkidle`
2. `page.accessibility.snapshot()` → accessibility tree
3. Convert tree to ANSI-rendered lines:
   - Bold headings (`# `, `## `)
   - Colored, numbered links `[1] link text`
   - Form fields `[input: ___]`, buttons `[button: Submit]`
   - Indented nesting for lists, blockquotes
4. Render in read-only browse buffer
5. Link numbers interactive: `f` overlays Vimium hints, user types to follow

### Screenshot Rendering Flow

1. Playwright captures viewport-sized screenshot
2. Encode via terminal's image protocol:
   - **Kitty:** `\x1b_Ga=T,f=100,s={w},v={h};{base64}\x1b\`
   - **Sixel:** `\x1bPq{data}\x1b\`
   - **iTerm2:** `\x1b]1337;File=inline=1;...:{base64}\x07`
3. Write inline image at cursor position
4. Store page handle for scroll/click interaction

### Terminal Capability Detection

TypeScript detects at startup (see parent RFC for full detection strategy):

```typescript
interface TerminalCapabilities {
  imageProtocol: 'kitty' | 'sixel' | 'iterm2' | 'none';
  trueColor: boolean;
  unicodeWidth: 'full' | 'basic';
  terminalName: string;
}
```

### T-Lisp API Additions

```lisp
;; Tier selection
(setq browse-render-tier 'auto)  ; auto | screenshot | structural | reader | plaintext | external

;; Per-URL-pattern routing
(setq browse-url-browser-function
      '(("https?://github" . structural)
        (".*\\.pdf$" . external)
        (".*" . reader)))

;; Structural navigation
(browse-follow-link)                    ; Vimium hints
(browse-submit-form)                    ; Submit form (with confirmation)

;; Screenshot interaction
(pi  "(browse-show-all-images)")        ; Show all images inline (image-capable terminals)
(browse-show-image 3)                   ; Show image #3 inline

;; Tier toggle
(R   "(browse-toggle-rendering-tier)")  ; Cycle: reader → structural → screenshot → reader

;; History
(gh  "(browse-history-back)")           ; Browse history back
(gl  "(browse-history-forward)")        ; Browse history forward

;; Smart features
(markdown-live-preview)                 ; Open split with rendered preview
(markdown-live-preview-stop)
(browse-docs-at-point)                  ; Open docs for symbol at point
(browse-current-package-homepage)       ; Open current package's homepage
```

### Key Bindings (browse-mode additions)

```lisp
;; Navigation
(gh  "(browse-history-back)")
(gl  "(browse-history-forward)")
(R   "(browse-toggle-rendering-tier)")  ; Cycle tiers

;; Structural interaction
(TAB "(browse-next-element)")           ; Cycle focusable elements
(RET "(browse-activate-element)")       ; Activate focused element

;; Image preview
(pi  "(browse-show-all-images)")

;; Markdown preview (in markdown buffers)
(mp  "(markdown-live-preview)")
```

## Example: Structural Rendering

```
═══════════════════════════════════════
  Hacker News
═══════════════════════════════════════

  Show HN: T-Lisp – A Lisp for Text Editors
  [1] 42 comments | [2] tmax.org

  Why I Rewrote My Editor in Lisp
  [3] 18 comments | [4] blog.example.com

  The Art of Terminal Graphics
  [5] 7 comments | [6] katacarbix.xyz

───────────────────────────────────────
  [n] links loaded  |  j/k: scroll  |  f: follow  |  R: toggle tier  |  gh/gl: history
```

## Dependency Policy

| Dependency | Required | Default |
|-----------|----------|---------|
| Playwright | Yes (for structural and screenshot) | Lazy install and lazy start |
| Kitty/Sixel/iTerm2 encoders | For screenshot tier only | Bundled — pure TypeScript, no external deps |
| `@mozilla/readability` | No (used in Reader mode from RFC-012B) | Optional |

Structural rendering requires Playwright. Screenshot rendering requires Playwright + terminal image protocol support. Both degrade to Reader/Plaintext from RFC-012B if Playwright is unavailable.

## Acceptance Tests

Daemon/TUI path:

```
# Structural rendering of GitHub repo page
browse-url "https://github.com/owner/repo" :tier 'structural
→ browse buffer shows headings, links, code blocks
→ browse-buffer-tier = structural
→ browse-buffer-links has numbered entries
→ f overlays Vimium hints; typing hint number follows link

# Screenshot rendering on Kitty
browse-url "https://example.com" :tier 'screenshot
→ browse buffer shows inline screenshot via Kitty protocol
→ browse-buffer-tier = screenshot
→ browse-buffer-image-protocol = kitty
→ scrolling re-captures at different offsets

# Terminal fallback (no image support)
browse-url "https://example.com" :tier 'auto
→ on basic terminal: browse-buffer-tier = structural (not screenshot)
→ on Kitty: browse-buffer-tier = screenshot

# Tier toggle
R cycles: reader → structural → screenshot → reader
```

TRT tests:

```
;; Structural rendering produces browse buffer
(assert-equal browse-buffer-tier 'structural)
(assert-non-nil browse-buffer-links)

;; Screenshot rendering detects terminal capabilities
(assert-equal browse-buffer-image-protocol 'kitty)  ; on Kitty
(assert-equal browse-buffer-image-protocol 'none)    ; on basic terminal

;; Per-URL routing
(assert-equal (browse-render-tier-for "https://github.com/owner/repo") 'structural)
```

## Success Criteria

Opening a GitHub repo page shows structural rendering with headings, links, and code blocks. Following a link navigates within the browse buffer. On Kitty, a URL shows a full screenshot inline. On terminals without image support, falls back to structural rendering automatically. Degrades gracefully on any terminal.

## Roadmap Placement

After Phase 1.5 primitives are stable. Requires RFC-012A + RFC-012B.

## Next

[RFC-012D](RFC-012D-active-browsing.md) adds active browser sessions for interactive and AI-guided browsing.
