# RFC-012B: In-Terminal Reading — Plaintext, Reader Mode, and Bookmarks

**Date:** 2026-06-11
**Status:** Proposed
**Author:** Mekael Turner
**Parent:** [RFC-012: browse-url — Terminal-Aware URL Handling](RFC-012-browse-url.md)
**Depends On:** [RFC-012A: browse-url MVP](RFC-012A-browse-url-mvp.md)

## Summary

Open URLs inside tmax without leaving the terminal. Plaintext rendering via HTTP fetch (no dependencies), Reader mode via Playwright + Readability (optional), read-only browse buffers, Vimium-style link hints, bookmarks, and content caching.

## Relationship to Parent RFC

This is a sub-RFC of [RFC-012](RFC-012-browse-url.md). It builds on [RFC-012A](RFC-012A-browse-url-mvp.md) (URL detection, resolution, external dispatch) and adds Layer 3 (Render) at the plaintext and reader tiers. It introduces the browse buffer data model.

RFC-012 sections relevant to this sub-RFC:
- [Rendering Tiers](RFC-012-browse-url.md#rendering-tiers) — Tier 3 (Reader) and Tier 4 (Plaintext)
- [Browse Buffer Data Model](RFC-012-browse-url.md#browse-buffer-data-model) — buffer-local state
- [Dependency Policy](RFC-012-browse-url.md#dependency-policy) — Playwright and Readability are optional
- [Security and Privacy Model → Cache Privacy](RFC-012-browse-url.md#security-and-privacy-model) — cache policy
- [Bookmarks](RFC-012-browse-url.md#bookmark-system) — T-Lisp data model

## Motivation

Opening a URL in an external browser leaves the terminal. For reading docs, articles, GitHub issues, and RFCs, staying in the editor is better. Plaintext rendering works everywhere with zero dependencies. Reader mode (when Playwright is available) gives clean article extraction. Both should degrade gracefully.

## Scope

### Rendering Tiers

| Tier | Method | Dependencies | Terminal Requirement |
|------|--------|-------------|---------------------|
| **Plaintext** | HTTP fetch + HTML→text | None | Any terminal |
| **Reader** | Playwright + Readability → clean text | Playwright, `@mozilla/readability` (optional) | Any terminal |

### Features

- Plaintext renderer: HTTP fetch + HTML→text conversion (no Playwright needed)
- Reader mode: Playwright navigates, waits for JS, extracts HTML, Readability parses → clean text
- Read-only browse buffers with full data model
- Link detection and Vimium-style link hints (`f` overlays numbers, type hint to follow)
- `browse-render-tier` configuration (`auto | plaintext | reader | external`)
- Playwright session management (lazy start, reuse, idle timeout)
- Bookmarks (T-Lisp data model, prompt-buffer search, stored via generic file I/O)
- Rendered content caching with privacy policy
- Dead link archive.org fallback
- Copy commands: `yy` (URL), `yt` (title), `ym` (Markdown link)

### Out of Scope

- Structural rendering via a11y tree (see [RFC-012C](RFC-012C-rich-rendering.md))
- Screenshot rendering via terminal image protocols (see [RFC-012C](RFC-012C-rich-rendering.md))
- Active browsing sessions (see [RFC-012D](RFC-012D-active-browsing.md))

## Architecture

### Browse Buffer Data Model

Every rendered URL creates a browse buffer with buffer-local variables:

```lisp
browse-buffer-url              ; string — canonical URL after redirects
browse-buffer-title            ; string — page title
browse-buffer-tier             ; symbol — external | plaintext | reader
browse-buffer-source-kind      ; symbol — http-fetch | playwright-reader
browse-buffer-history          ; list — (url . timestamp) navigation history
browse-buffer-links            ; alist — (number . (url . text)) for numbered links
browse-buffer-scroll-position  ; integer — current scroll offset
browse-buffer-diagnostics      ; alist — warnings, errors, load time
browse-buffer-cache-key        ; string | nil — cache lookup key if cached
```

### Rendering Flow

**Plaintext (always available):**
1. `(ts-call 'http-fetch url)` → raw HTML
2. T-Lisp HTML→text conversion (strip tags, extract `<body>`)
3. Render in read-only browse buffer
4. Extract and number links

**Reader mode (Playwright optional):**
1. Check if Playwright is available: `(ts-call 'playwright-available)`
2. If yes: `(ts-call 'playwright-reader url)` → `{:title, :byline, :content, :textContent}`
3. If no: fall back to plaintext
4. Render extracted article in browse buffer
5. Code blocks preserved, links numbered, images optionally noted as placeholders

### Playwright Session Management

Playwright is lazy-started and optional:

```typescript
let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}
```

- **Lazy start:** No process until first Reader mode request
- **Reuse:** One browser, multiple pages
- **Timeout:** Auto-close after `browse-playwright-idle-timeout` (default 5 minutes)
- **Fallback:** If Playwright unavailable or launch fails, fall back to plaintext without error

### Bookmarks

T-Lisp owns the bookmark data model. TypeScript provides generic file I/O:

```lisp
(bookmark-add url :title title :tags tags)
(bookmark-list)                  ; Open bookmark browser (prompt buffer)
(bookmark-search "query")        ; Fuzzy search
(bookmark-remove title)

;; Stored as T-Lisp data via standard file I/O
;; ~/.config/tmax/bookmarks.tlisp
```

### Caching

```lisp
(setq browse-cache-policy 'private)  ; default: respect Cache-Control, no credentials
(setq browse-cache-dir "~/.cache/tmax/browse/")
(browse-cache-clear)                  ; Remove all cached content
```

Cache directory is `chmod 700`. No credentials, cookies, or form data stored.

### T-Lisp API

```lisp
;; Rendering
(browse-url "https://example.com" :tier 'reader)     ; Reader mode (falls back to plaintext)
(browse-url "https://example.com" :tier 'plaintext)  ; Plaintext only (no Playwright)
(setq browse-render-tier 'auto)                       ; auto: reader if Playwright available, else plaintext

;; Buffer inspection
(browse-buffer-state)            ; Return current browse buffer state
(browse-buffer-state :json)      ; Agent-visible JSON export

;; Link navigation (in browse buffer)
(browse-follow-link)             ; Enter hint-follow mode
(browse-follow-link-hint "3")    ; Follow link hint #3

;; Copy commands (in browse buffer)
(yy  "(browse-copy-url)")        ; Copy canonical URL
(yt  "(browse-copy-title)")      ; Copy page title
(ym  "(browse-copy-md-link)")    ; Copy [title](url)

;; Bookmarks
(bookmark-add url :title title :tags tags)
(bookmark-list)
(bookmark-search query)
(bookmark-remove title)
```

### Key Bindings (browse-mode)

```lisp
;; In browse-mode (read-only browse buffer)
(j   "(browse-scroll-down 5)")
(k   "(browse-scroll-up 5)")
(f   "(browse-follow-link)")             ; Enter Vimium hint mode
(F   "(browse-follow-link-new-buffer)")  ; Follow in new buffer
(r   "(browse-reload)")
(R   "(browse-toggle-reader-mode)")      ; Toggle reader/plaintext
(o   "(browse-open-url)")                ; Prompt for URL
(bb  "(browse-bookmarks)")
(yy  "(browse-copy-url)")
(yt  "(browse-copy-title)")
(ym  "(browse-copy-md-link)")
(q   "(browse-quit)")
```

## Dependency Policy

| Dependency | Required | Default |
|-----------|----------|---------|
| None (plaintext) | Yes | Ships with tmax |
| `@mozilla/readability` | Optional | Lazy npm install on first Reader use |
| Playwright | Optional | Lazy install and lazy start |

Plaintext mode works with zero dependencies. Reader mode degrades to plaintext if Playwright is unavailable.

## Acceptance Tests

Daemon/TUI path:

```
# Reader mode creates browse buffer with data model
browse-url "https://example.com/article" :tier 'reader
→ browse buffer opens with:
  browse-buffer-url = "https://example.com/article"
  browse-buffer-title = "Article Title"
  browse-buffer-links = ((1 "https://..." "link text") ...)
  browse-buffer-tier = reader | plaintext

# Link hints: f overlays numbered hints
tmaxclient --keys 'f' --json
→ {:ok true :hints ((1 "https://..." "[1] link text") ...)}

# Cache: second visit loads from cache
browse-url "https://example.com/article" :tier 'reader
→ loads from cache, no network request

# Bookmarks persist across sessions
(bookmark-add "https://example.com" :title "Example")
;; restart tmax
(bookmark-search "Example")
→ finds bookmark

# Playwright unavailable → falls back to plaintext
(setq browse-render-tier 'reader)
;; with Playwright not installed
browse-url "https://example.com"
→ browse-buffer-tier = plaintext  (no error)

# Cache privacy
(browse-cache-clear)
→ cache directory emptied
```

TRT tests:

```
;; Plaintext rendering
(assert-non-nil (browse-url "https://example.com" :tier 'plaintext))
(assert-equal browse-buffer-tier 'plaintext)

;; Reader mode
(assert-equal browse-buffer-title "Expected Title")
(assert-non-nil browse-buffer-links)

;; Bookmarks
(bookmark-add "https://example.com" :title "Test")
(assert-equal (bookmark-search "Test") '(("Test" . "https://example.com")))
```

## Success Criteria

`browse-url` on a blog article renders clean readable text in a tmax buffer. Links are followable with `f` + hint. Works on any terminal. Playwright starts lazily if available; plaintext works without it. Bookmarks persist across sessions. Cache respects privacy headers.

## Product Direction

This is "web as editor buffer" — the killer workflow is reading docs, GitHub issues/PRs, articles, and RFCs without leaving the editor. Not a terminal browser clone.

## Roadmap Placement

After Phase 0.9 diagnostics are stable. Requires RFC-012A. Does not block or require RFC-012C.

## Next

[RFC-012C](RFC-012C-rich-rendering.md) adds structural and screenshot rendering on top of this foundation.
