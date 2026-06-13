# RFC-012: browse-url — Terminal-Aware URL Handling Package

**Date:** 2026-06-11
**Status:** Proposed
**Author:** Mekael Turner
**Scope:** Umbrella RFC — defines long-term architecture; implementation staged via sub-RFCs

## Summary

An umbrella RFC defining the long-term browse-url architecture for tmax: detect URLs in buffer text, resolve contextual references, render web content using the best available method, and (optionally) maintain active browser sessions for interactive and AI-guided web tasks. All dispatch logic lives in T-Lisp; all I/O (HTTP, subprocess management, terminal graphics) lives in TypeScript.

The shippable **MVP** is URL detection plus external browser dispatch — no Playwright, no browser profiles, no terminal graphics, no cache. In-terminal rendering and active browsing are staged extensions gated by diagnostics, security review, dependency policy, and daemon/TUI acceptance tests.

### Sub-RFCs

This RFC is too large to implement as a single unit. It is split into separately reviewable sub-RFCs:

| Sub-RFC | Scope | Dependencies | Status |
|---------|-------|-------------|--------|
| **[RFC-012A](RFC-012A-browse-url-mvp.md): browse-url MVP** | URL detection, external dispatch, `gx`, contextual resolvers, structured errors, TRT tests | None beyond editor core | Ready to implement after Phase 1.5 keymap infrastructure |
| **[RFC-012B](RFC-012B-in-terminal-reading.md): in-terminal reading** | Plaintext renderer, Reader mode, read-only browse buffers, link-following, cache policy | RFC-012A, `@mozilla/readability` (optional), Playwright (optional) | After Phase 0.9 diagnostics stable |
| **[RFC-012C](RFC-012C-rich-rendering.md): rich rendering** | Structural a11y-tree rendering, terminal-image screenshot rendering, Kitty/Sixel/iTerm2 protocols | RFC-012B, Playwright, terminal graphics encoders | After Phase 1.5 primitives |
| **[RFC-012D](RFC-012D-active-browsing.md): active browsing** | Persistent browser sessions, form interaction, browser automation, `browse-ai` | RFC-012B, `@playwright/cli` or `browser-use` | Experimental — gated by security review |

Each sub-RFC gets its own design depth, risk review, and acceptance criteria.

## Motivation

Emacs `browse-url` is the reference design for editor URL handling: detect links, dispatch to a configurable handler. But it was designed in the 1990s. Three things have changed since then:

1. **Modern terminals can display images inline.** Kitty's graphics protocol, Sixel, and iTerm2 image support mean a terminal editor can render web content — screenshots, article text, even interactive previews — without leaving the terminal or spawning a GUI window.

2. **Headless browsers are programmable.** Playwright gives complete control over a real browser engine via a clean API. You can take screenshots, extract accessibility trees, run JavaScript, and intercept network requests — all from TypeScript. Emacs never had this.

3. **Article extraction is a solved problem.** `@mozilla/readability` extracts clean article text from any web page. Combined with Playwright (for JS execution first), you get clean content from any modern site.

tmax is positioned to combine all three into something Emacs can't: a `browse-url` where the default experience renders web content *inside the terminal*, with automatic fallback for less capable terminals.

## Design Principles

1. **Layered, not monolithic.** URL detection, resolution, rendering, and interaction are separate T-Lisp-generic layers. Users override per layer, per mode, per URL pattern, per terminal capability.

2. **Terminal-aware rendering.** Auto-detect terminal capabilities (Kitty graphics, Sixel, iTerm2 images, true color) and pick the best available rendering tier. No manual configuration required.

3. **Playwright as first-class backend.** Not just "open in browser." Playwright powers inline rendering: screenshots for image-capable terminals, accessibility tree dumps for structural rendering, Readability extraction for article text.

4. **Graceful degradation.** Every feature works on every terminal. Image-capable terminals get screenshots. Capable terminals get structural ANSI. Minimal terminals get plaintext. Any terminal can delegate to an external browser.

5. **T-Lisp dispatch, TypeScript I/O.** All routing logic, configuration, and extensibility live in T-Lisp. TypeScript provides HTTP fetching, Playwright control, terminal graphics protocols, and terminal capability detection.

6. **Incremental dependency.** The MVP (RFC-012A) has zero heavy runtime dependencies. Playwright, terminal graphics encoders, and browser-use are optional, lazy-installed, and gated behind sub-RFCs. External dispatch remains the universal fallback. Adding browse-url must not make the base editor heavier.

7. **Security by default.** Page content is untrusted. Prompt before destructive actions. Isolate browser contexts. Restrict sensitive URL schemes. Never let page text become trusted T-Lisp code or agent instructions.

## PRD Alignment / Roadmap Placement

This RFC is **not on the Phase 1.5 critical path.** The current PRD focus is:

- **Phase 0.9:** Diagnostics and debugging infrastructure
- **Phase 1.5:** Editor primitives — auto-indent, electric pairs, show-paren, comment-dwim, indent engine, syntax highlighting pipeline

Browse-url's relationship to the roadmap:

| Sub-RFC | Earliest Start | Rationale |
|---------|---------------|-----------|
| RFC-012A (MVP) | After Phase 1.5 keymap infrastructure | Needs stable key binding APIs, but is otherwise self-contained |
| RFC-012B (Reader) | After Phase 0.9 diagnostics stable | Read-only browse buffers need diagnostic error paths |
| RFC-012C (Rich rendering) | After Phase 1.5 primitives | Terminal graphics and structural rendering are enhancements, not prerequisites |
| RFC-012D (Active browsing) | Phase 3+ (experimental) | Requires security review, session isolation, and diagnostics before any implementation |

**RFC-012A can be implemented opportunistically** alongside Phase 1.5 work — it's small, self-contained, and gives immediate value. The later sub-RFCs should wait until their dependencies are stable.

## Dependency Policy

| Dependency | Required By | Default | Install Model |
|-----------|-------------|---------|--------------|
| None | RFC-012A | Yes | Ships with tmax |
| `@mozilla/readability` | RFC-012B (Reader mode) | Optional | Lazy npm install on first use |
| Playwright (Node library) | RFC-012B/C (inline rendering) | Optional | Lazy install; or use `@playwright/cli` subprocess |
| `@playwright/cli` | RFC-012D (active browsing) | Optional | External tool, must be in `$PATH` |
| `browser-use` | RFC-012D (AI browsing) | Experimental / off by default | Python package, user installs separately |
| Terminal graphics encoders | RFC-012C (screenshot tier) | Optional | Bundled — Kitty/Sixel/iTerm2 protocols are pure TypeScript, no external deps |

**Constraints:**
- Core `browse-url` (RFC-012A) has **no heavy runtime dependency** — only the URL detection regex and external browser dispatch (`open`/`xdg-open`).
- Playwright is **lazy-installed and lazy-started.** The editor works perfectly without it. First use of Reader/Structural/Screenshot mode triggers a one-time setup prompt.
- `browser-use` is **experimental and off by default.** It requires explicit opt-in via `(setq browse-active-backend 'browser-use)`.
- External dispatch (`$BROWSER`, `open`, `xdg-open`) is the universal fallback and requires zero dependencies.
- Packaging must not increase base editor startup time or memory footprint.

## Layer Separation: TypeScript vs T-Lisp

A core design question: which responsibilities belong in the TypeScript core and which in T-Lisp? The boundary is drawn at I/O vs. logic.

### Rule: TypeScript Owns I/O and Capability Detection

TypeScript handles everything that touches the filesystem, network, terminal hardware, or external processes:

| Responsibility | Why TypeScript |
|---------------|----------------|
| Terminal capability detection | Reads `$TERM`, `$TERM_PROGRAM`, queries terminal via escape sequences — raw I/O |
| Image protocol encoding | Kitty/Sixel/iTerm2 binary protocols — raw bytes to terminal |
| HTTP fetching | Network I/O, redirects, headers |
| Playwright / subprocess management | Process spawning, IPC, lifecycle management |
| File caching | Disk I/O for rendered content cache |
| Screenshot capture | Coordinates with Playwright process |
| Bookmarks persistence | File I/O for `~/.config/tmax/bookmarks.tlisp` |

### Rule: T-Lisp Owns Dispatch, Configuration, and Extensibility

T-Lisp handles everything that users should be able to override, extend, or configure without touching TypeScript:

| Responsibility | Why T-Lisp |
|---------------|------------|
| URL detection patterns | Users add new URL patterns per mode (wiki-links, issue refs) |
| Rendering tier selection | Users configure auto-detection rules, per-URL overrides |
| Contextual resolution | Mode-specific resolvers (git refs in code, wiki links in markdown) |
| Key bindings | Standard tmax modal keymap extensibility |
| Bookmark commands | User-facing API surface |
| Per-URL routing rules | Configuration alists, pattern matching |
| Active browsing orchestration | Click/type/navigate dispatch — users define browsing scripts |
| AI-guided browsing prompts | Prompt construction, goal management, result extraction |

### The Boundary Protocol

TypeScript exposes capabilities as a small set of async functions registered in the T-Lisp environment. T-Lisp calls these functions but never implements them:

```lisp
;; TypeScript registers these primitives
(ts-call 'terminal-capabilities)           → TerminalCapabilities
(ts-call 'http-fetch url)                  → string
(ts-call 'playwright-screenshot url opts)  → Buffer
(ts-call 'playwright-a11y-tree url)        → A11yNode
(ts-call 'playwright-reader url)           → Article
(ts-call 'image-render buffer protocol)    → void
(ts-call 'browser-session-create opts)     → session-id
(ts-call 'browser-session-navigate id url) → void
(ts-call 'browser-session-click id sel)    → void
(ts-call 'browser-session-type id text)    → void
(ts-call 'browser-session-screenshot id)   → Buffer
(ts-call 'browser-session-close id)        → void
```

All higher-level functions in T-Lisp compose these primitives. Users override the T-Lisp layer; they never need to touch TypeScript.

### Terminal Capability Detection: Decision

Terminal capability detection lives in **TypeScript**, not T-Lisp. Reasons:

1. **It requires raw terminal I/O.** Detection involves sending escape sequences and reading responses — this is fundamentally a TypeScript core responsibility (like raw key input handling).

2. **It must be deterministic and fast.** Detection runs once at startup. It's not user-extensible logic — a terminal either supports Kitty graphics or it doesn't.

3. **T-Lisp consumes the result, not the process.** T-Lisp calls `(terminal-capabilities)` and gets a data structure. It decides what to *do* with that information (which tier to pick), but doesn't perform the detection itself.

4. **Consistent with existing patterns.** tmax already detects terminal dimensions, color support, and raw mode capabilities in TypeScript. Terminal image support is the same category.

T-Lisp can override the *consequences* of detection (forcing a tier via `browse-render-tier`), but not the detection mechanism itself.

### Bookmarks: T-Lisp Owns the Model

Bookmarks persistence was originally listed as a TypeScript responsibility. This is corrected: TypeScript provides generic file I/O primitives (`read-file`, `write-file`); T-Lisp owns bookmark data format, migration, validation, and commands. The bookmark file (`~/.config/tmax/bookmarks.tlisp`) is T-Lisp data read and written through standard file primitives — no browse-specific TypeScript code for bookmarks.

### T-Lisp Generic Functions

This RFC references "T-Lisp generic functions" for layered dispatch. This requires either:

1. **Existing support** — if tmax's T-Lisp already has `defgeneric`/`defmethod` or equivalent multimethod dispatch, browse-url uses it directly.
2. **Minimal dispatch mechanism** — if not yet implemented, browse-url needs a simple method table: `(browse-register-render-method 'screenshot 'kitty handler-fn)`, called via `(browse-call-render-method 'screenshot (terminal-capabilities) url)`. This is a lookup, not a full CLOS-style system.

The MVP (RFC-012A) does not need generic dispatch — it uses a single handler function. Generic dispatch is introduced in RFC-012B when multiple rendering tiers require selection logic.

## Security and Privacy Model

Browse-url opens arbitrary URLs, may execute JavaScript, stores rendered content in cache, handles forms, and eventually allows AI-guided browser interaction. This section defines mandatory security constraints.

### Untrusted Content

All page content is **untrusted by default.** This means:

- Page text is never evaluated as T-Lisp code.
- Page text passed to AI agents is treated as untrusted input — agents must not execute extracted content as instructions.
- HTML/JS from pages is only executed inside the Playwright sandbox, never in the tmax process.
- Structural rendering sanitizes text before display (no ANSI injection from page content).

### Destructive Action Confirmation

Active browsing (RFC-012D) must prompt before performing destructive actions:

| Action | Confirmation Required |
|--------|----------------------|
| Submit a form | Yes — show form data, ask confirm |
| Make a purchase | Yes — always |
| Delete content | Yes — always |
| Post / send email | Yes — always |
| Download files | Yes — show filename, size, ask confirm |
| Navigate to a new URL | No — unless on a sensitive page (banking, email) |
| Click a non-destructive element | No — standard browsing |
| Type into a text field | No — no data submitted yet |

Destructive action classification is configurable via T-Lisp:

```lisp
(setq browse-destructive-actions
      '(("submit" . confirm)
        ("purchase" . confirm-always)
        ("delete" . confirm-always)))
```

### Browser Context Isolation

Each tmax workspace gets a **separate browser profile** by default:

```lisp
(setq browse-session-profile 'per-workspace)  ; default
;; 'shared      — one profile for all sessions (convenient, less isolated)
;; 'private     — incognito/private context per session (most isolated)
;; 'per-workspace — separate profile per tmax workspace
```

Cookies, local storage, and session data are scoped to the profile. Default: `per-workspace`.

### Sensitive URL Restrictions

Certain URL schemes and patterns require explicit confirmation or are blocked by default:

| Pattern | Default Behavior |
|---------|-----------------|
| `file://` | Blocked — prompt to confirm, warn about local file access |
| `localhost` / `127.0.0.1` / `::1` | Warn — "This is a local server" |
| Private network (`10.*`, `192.168.*`, `172.16-31.*`) | Warn — "This is a private network address" |
| URLs with credentials (`user:pass@host`) | Blocked — strip credentials, warn |
| `javascript:` | Blocked in tmax context — only executed in Playwright sandbox |
| `data:` | Blocked — potential for XSS/encoding abuse |

### Cache Privacy

```lisp
(setq browse-cache-policy 'private)  ; default
;; 'none       — no caching
;; 'private    — cache locally, respect Cache-Control headers
;; 'public     — cache everything (for offline reading workflows)
```

- Cache is **opt-in** for anything beyond the current session.
- Cache directory (`~/.cache/tmax/browse/`) is user-private (`chmod 700`).
- `browse-cache-clear` command removes all cached content.
- Cache entries are labeled: `public`, `private`, `no-store` (from HTTP headers).
- No credentials, cookies, or form data are stored in cache.

### AI Browsing Safety

When `browse-ai` delegates to an AI agent:

1. **Agent must ask before destructive actions** — the confirmation policy above applies.
2. **Step log** — every navigate/click/type/screenshot is recorded as inspectable T-Lisp data: `(browse-ai-log)` returns the full action history.
3. **Redaction hooks** — before page content is sent to the LLM, T-Lisp hooks can redact sensitive content (passwords, tokens, PII).
4. **No autonomous form submission** — AI agent can fill forms but cannot submit without user confirmation.
5. **Timeout** — AI browsing loops time out after configurable duration (`browse-ai-timeout`).

### External Browser Dispatch: Injection Prevention

External browser dispatch uses `Bun.spawn()` with an explicit argv array — never shell interpolation of URL strings:

```typescript
// Correct — no shell injection
Bun.spawn([browserCmd, url], { detached: true });

// Wrong — shell injection risk
Bun.spawn(`open "${url}"`, { shell: true });  // NEVER do this
```

URLs are validated before dispatch: must match `https?://`, `mailto:`, or other allowed schemes.

## Architecture

### Layer Model

```
URL in buffer text
  │
  ▼
┌─────────────────┐
│   1. Detect      │  Find URLs, markdown links, org links, contextual refs
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   2. Resolve     │  Expand shortlinks, follow redirects, contextual expansion
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   3. Render      │  Terminal-aware content display (passive: one-shot)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   4. Interact    │  Navigate links, scroll, click (for in-editor rendering)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   5. Automate    │  Active browsing: session-based click/type/navigate + AI-guided tasks
└─────────────────┘
```

Each layer is a T-Lisp generic function with multiple dispatch methods. Users can override any layer independently. Layers 1-4 are passive (render a URL and display it). Layer 5 is active (maintain a browser session and interact with it programmatically).

### Rendering Tiers

| Tier | Method | Terminal Requirement | Experience |
|------|--------|---------------------|------------|
| **Screenshot** | Playwright screenshot → Kitty/Sixel/iTerm2 | Image-capable terminal | Full visual rendering inline |
| **Structural** | Playwright accessibility tree → ANSI with clickable regions | Any terminal with color | Headings, links, forms — like `eww` but powered by a real engine |
| **Reader** | Playwright + Readability → clean text in tmax buffer | Any terminal | Article text only, no ads/JS/chrome |
| **Plaintext** | HTTP fetch + HTML→text conversion | Any terminal | Raw text extraction, no JS execution |
| **External** | `$BROWSER`, `open`, `xdg-open` | GUI environment | Delegate to system browser |

Auto-detection picks the best tier for the current terminal. User can override with `(browse-render-tier 'reader)` or per-URL-pattern.

### Terminal Capability Detection

As established in the Layer Separation section, detection lives in TypeScript. T-Lisp consumes the result via `(terminal-capabilities)` and uses it for tier selection.

```typescript
// TypeScript core provides detection
interface TerminalCapabilities {
  imageProtocol: 'kitty' | 'sixel' | 'iterm2' | 'none';
  trueColor: boolean;
  unicodeWidth: 'full' | 'basic';  // for chafa/block char rendering
  terminalName: string;            // kitty, wezterm, ghostty, alacritty, iterm2, etc.
}
```

Detection strategy:
- **Kitty:** `kitty +kitten query_terminal` or check `$TERM=xterm-kitty`
- **Sixel:** Send Sixel DA query, check response
- **iTerm2:** Check `$TERM_PROGRAM=iTerm.app` or iTerm2 escape response
- **WezTerm:** Check `$TERM_PROGRAM=WezTerm` (supports both Sixel and iTerm2 protocol)
- **Ghostty:** Check `$TERM_PROGRAM=ghostty` (emerging graphics support)
- **Fallback:** `$TERM`, `$TERM_PROGRAM`, `$COLORTERM`

### Component Map

```
src/
├── browse/                      # TypeScript browse-url core (I/O layer)
│   ├── detect.ts                # Terminal capability detection
│   ├── protocols/
│   │   ├── kitty.ts             # Kitty graphics protocol (transmit + display inline)
│   │   ├── sixel.ts             # Sixel image encoding
│   │   └── iterm2.ts            # iTerm2 inline image protocol
│   ├── render/
│   │   ├── screenshot.ts        # Playwright screenshot → terminal image
│   │   ├── structural.ts        # Playwright a11y tree → ANSI rendering
│   │   ├── reader.ts            # Playwright + Readability → clean text
│   │   └── plaintext.ts         # HTTP fetch + HTML→text fallback
│   ├── resolve.ts               # URL resolution (shortlinks, redirects)
│   ├── external.ts              # External browser dispatch ($BROWSER, open, xdg-open)
│   └── session.ts               # Browser session management (subprocess lifecycle)
├── tlisp/core/commands/
│   ├── browse.tlisp             # T-Lisp browse-url commands and dispatch
│   └── browse-session.tlisp     # T-Lisp active browsing commands (Layer 5)
├── tlisp/core/modes/
│   └── browse-mode.tlisp        # Browse minor modes (view, interact, automate)
```

**Package boundaries:**
- `browse.tlisp` is the passive URL handling package (Layers 1-4). It works standalone.
- `browse-session.tlisp` is the active browsing package (Layer 5). It depends on `browse.tlisp` for rendering but adds session management and interaction.
- Both share the TypeScript I/O layer in `src/browse/`. The TS layer doesn't know about layers — it just exposes primitives.
- `browse-mode.tlisp` defines three minor modes that compose functionality from both packages.

### Browse Buffer Data Model

Every rendered URL creates a browse buffer with this state model, stored as T-Lisp buffer-local variables:

```lisp
;; Buffer-local state for browse buffers
browse-buffer-url              ; string — canonical URL after redirects
browse-buffer-title            ; string — page title
browse-buffer-tier             ; symbol — external | plaintext | reader | structural | screenshot
browse-buffer-source-kind      ; symbol — how content was obtained
browse-buffer-history          ; list — (url . timestamp) navigation history
browse-buffer-links            ; alist — (number . (url . text)) for numbered links
browse-buffer-forms            ; alist — (id . field-metadata) for interactive forms
browse-buffer-scroll-position  ; integer — current scroll offset
browse-buffer-session-id       ; integer | nil — active browser session (Layer 5 only)
browse-buffer-diagnostics      ; alist — warnings, errors, load time
browse-buffer-cache-key        ; string | nil — cache lookup key if cached
browse-buffer-safe-mode        ; boolean — whether security restrictions are active
```

This data model makes later features straightforward:
- **Link hints** read from `browse-buffer-links`
- **Reload** uses `browse-buffer-url` and `browse-buffer-tier`
- **History navigation** walks `browse-buffer-history`
- **Bookmarks** snapshot the data model
- **AI handoff** serializes the data model as agent-visible JSON via `(browse-buffer-state :json)`
- **Structural navigation** uses `browse-buffer-forms` and `browse-buffer-links`

```lisp
;; Agent-visible state (for browse-ai and external tools)
(browse-buffer-state :json)
;; → { "url": "...", "title": "...", "tier": "structural",
;;     "links": [...], "headings": [...], "forms": [...],
;;     "scrollPosition": 0, "sessionId": null }
```

## Rendering Backends in Detail

### Tier 1: Screenshot Rendering

For image-capable terminals. Uses Playwright to take a viewport-sized screenshot, then transmits it inline via the terminal's image protocol.

**Flow:**

1. Playwright navigates to URL (headless)
2. Waits for `load` event (or `networkidle` for JS-heavy pages)
3. Captures screenshot at viewport dimensions
4. Encodes image via appropriate protocol (Kitty, Sixel, or iTerm2)
5. Writes inline image to terminal at cursor position
6. Stores page handle for subsequent interactions (scroll, click)

**Kitty graphics protocol:**

The Kitty protocol supports both file-based and direct transmission. For browse-url:

```
# Transmit image data
\x1b_Ga=T,f=100,s={width},v={height};{base64_data}\x1b\

# Place image at cursor (Unicode placeholder for precise positioning)
\x1b_Ga=p,U=1\x1b\
```

Key features:
- **Scrolling:** Re-transmit screenshot with `page.screenshot({ clip: { y: scrollOffset, ... } })`
- **Click mapping:** Store page coordinates, translate terminal click → Playwright `page.click()`
- **Zoom:** Adjust viewport size and re-capture

**Sixel:**

Older but widely supported. Encode PNG as Sixel sequence:

```
\x1bPq
{Sixel encoded image data}
\x1b\
```

Supported by: xterm (with `-ti 340`), mlterm, WezTerm, mintty, and others.

**iTerm2 protocol:**

```
\x1b]1337;File=inline=1;width={width}px;height={height}px:{base64_data}\x07
```

Supported by: iTerm2, WezTerm (partial), others.

### Tier 2: Structural Rendering

For terminals without image support but with color and Unicode. Powered by Playwright's accessibility tree dump.

**Flow:**

1. Playwright navigates to URL
2. Dumps the accessibility tree via `page.accessibility.snapshot()`
3. Converts the tree into ANSI-rendered lines with:
   - Bold headings (`# `, `## ` style)
   - Colored, numbered links `[1] link text`
   - Form fields rendered as `[input: ___]`
   - Buttons as `[button: Submit]`
   - Indented nesting for lists, blockquotes
4. Renders in a read-only tmax buffer
5. Link numbers are interactive: `g1` follows link 1, `gf` enters hint-follow mode

**Accessibility tree advantage over HTML parsing:**
- Browser has already executed JavaScript — dynamic content is included
- Semantic structure is clean — no `<div>` soup to parse
- Built-in roles (heading, link, button, textbox) map directly to rendering
- Much simpler than parsing HTML+CSS

**Example output:**

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
  [n] links loaded  |  j/k: scroll  |  f: follow  |  o: open URL
```

### Tier 3: Reader Mode

Uses `@mozilla/readability` (the same library powering Firefox Reader View) to extract clean article content.

**Flow:**

1. Playwright navigates to URL, waits for content to load
2. Extracts rendered HTML via `page.content()`
3. Passes HTML through Readability
4. Renders extracted article as clean text in a tmax buffer
5. Optionally renders as markdown for syntax highlighting

**What gets stripped:**
- Navigation, footers, sidebars
- Ads, popups, cookie banners
- Social sharing widgets
- Comments (configurable)

**What gets kept:**
- Article title and byline
- Body text with paragraph structure
- Images (optionally, if terminal supports them)
- Code blocks
- Links (preserved as numbered references)

### Tier 4: Plaintext

No Playwright, no JavaScript execution. Pure HTTP fetch + HTML-to-text conversion.

**Flow:**

1. `fetch(url)` — HTTP GET
2. Parse HTML (basic parser, no JS execution)
3. Extract `<body>` text content
4. Render in read-only tmax buffer

**Use case:** SSH sessions, minimal environments, quick text extraction where Playwright is unavailable or overkill.

### Tier 5: External Browser

The Emacs `browse-url` model. Detect the system's default browser and open the URL in it.

**Dispatch order:**
1. `$BROWSER` environment variable (user override)
2. macOS: `open` command
3. Linux: `xdg-open` command
4. Windows: `start` command
5. Common browsers: `firefox`, `chrome`, `chromium` (if found in `$PATH`)

Non-blocking — spawned via `Bun.spawn()` with no waiting.

## URL Detection

### Patterns Detected

| Pattern | Example | Detection |
|---------|---------|-----------|
| Bare URL | `https://example.com` | Regex on buffer text |
| Markdown link | `[text](url)` | Markdown syntax awareness |
| Angle-bracket URL | `<https://example.com>` | Common in plain text |
| Issue/PR reference | `#123`, `owner/repo#456` | Context-aware (inside git repo) |
| RFC/spec reference | `RFC-012`, `SPEC-039` | Context-aware (inside tmax docs) |
| DOI | `10.1000/xyz123` | Regex |
| Email | `user@example.com` | Regex, opens `mailto:` |

### T-Lisp API

```lisp
(browse-url "https://example.com")                    ; Open with auto-detected tier
(browse-url "https://example.com" :tier 'screenshot)  ; Force specific tier
(browse-url "https://example.com" :tier 'external)    ; Open in system browser
(browse-url "https://example.com" :tier 'reader)      ; Reader mode

(browse-url-at-point)           ; Open URL at cursor position
(browse-url-of-buffer)          ; Open current buffer's file (if HTML) in browser
(browse-url-of-region)          ; Render selected region as HTML

(browse-detect-at-point)        ; Return URL found at point (without opening)
(browse-resolve "gh:tmax")      ; Expand contextual references

(browse-render-tier)            ; Current rendering tier (auto/screenshot/structural/reader/plaintext/external)
(setq browse-render-tier 'auto) ; Set rendering tier

(browse-terminal-capabilities)  ; Return detected terminal capabilities
```

### Contextual Resolution

```lisp
;; Inside a git repo, on "tmax" text
(browse-resolve "tmax")
;; → "https://github.com/user/tmax"

;; Inside tmax docs, on "RFC-012"
(browse-resolve "RFC-012")
;; → "file:///path/to/docs/rfcs/RFC-012-browse-url.md"

;; On "#123" in a git repo
(browse-resolve "#123")
;; → "https://github.com/owner/repo/issues/123"

;; On a DOI
(browse-resolve "10.1000/xyz123")
;; → "https://doi.org/10.1000/xyz123"
```

Resolution handlers are T-Lisp functions registered by major modes:

```lisp
;; In markdown-mode, resolve wiki links
(define-url-resolver 'markdown-mode
  (lambda (text buffer)
    (when (string-match-p "^\\[\\[" text)
      (concat (buffer-directory buffer) "/"
              (string-replace "[[" "" (string-replace "]]" "" text))
              ".md"))))
```

## Smart Features

### URL Proxy / Archive

```lisp
(setq browse-dead-link-handler 'archive-org)
;; When a URL returns 404, automatically try web.archive.org

(setq browse-cache-rendered t)
;; Cache rendered content (screenshot + text) locally for offline access
;; Stored in ~/.cache/tmax/browse/
```

### Bookmark System

```lisp
(bookmark-add "https://example.com"
              :title "Example Site"
              :tags '("docs" "reference"))

(bookmark-list)                  ; Open bookmark browser (prompt buffer)
(bookmark-search "rust")         ; Fuzzy search bookmarks
(bookmark-remove "Example Site")

;; Bookmarks stored as T-Lisp data
;; ~/.config/tmax/bookmarks.tlisp
```

### Markdown Preview

When editing markdown, a split-view preview renders the content via Playwright:

```lisp
(markdown-live-preview)          ; Open split with rendered preview
(markdown-live-preview-stop)     ; Close preview split
```

Uses Playwright to render markdown→HTML→screenshot, displayed via Kitty/Sixel protocol. Updates on save (or on keystroke with debouncing).

### Inline Image Hints

In structural rendering, images from the page can be previewed inline:

```lisp
(browse-show-image 3)            ; Show image #3 inline (if terminal supports it)
(browse-show-all-images)         ; Show all images inline
```

Uses Playwright to fetch image data, then renders via Kitty/Sixel/iTerm2 protocol.

## Configuration

### User Config (init.tlisp)

```lisp
;; Default rendering tier
(setq browse-render-tier 'auto)  ; auto | screenshot | structural | reader | plaintext | external

;; Default external browser
(setq browse-browser-function 'browse-url-default)
;; 'browse-url-default      — auto-detect ($BROWSER, open, xdg-open)
;; 'browse-url-firefox      — Firefox
;; 'browse-url-chrome       — Google Chrome
;; 'browse-url-safari       — Safari (macOS)
;; 'browse-url-generic      — custom command via browse-url-generic-program

;; Per-URL-pattern routing (alist)
(setq browse-url-browser-function
      '(("https?://github" . screenshot)
        (".*\\.pdf$" . external)
        (".*" . structural)))

;; Screenshot settings
(setq browse-screenshot-width 1200)
(setq browse-screenshot-height 800)

;; Reader mode settings
(setq browse-reader-include-images t)  ; Include images (if terminal supports)

;; Caching
(setq browse-cache-rendered t)
(setq browse-cache-dir "~/.cache/tmax/browse/")

;; Dead link handling
(setq browse-dead-link-handler 'archive-org)  ; nil | 'archive-org

;; Contextual resolvers (per mode)
(add-hook 'markdown-mode-hook
          (lambda () (setq-local browse-resolvers '(wiki-link-resolver url-resolver))))
```

### Key Bindings

```lisp
;; Normal mode (in any buffer with URLs)
(gx  "(browse-url-at-point)")                    ; Open URL under cursor
(gxg "(browse-url-at-point :tier 'external)")    ; Open in external browser

;; In browse-mode (structural/reader rendering buffer)
(j   "(browse-scroll-down 5)")                   ; Scroll rendered content
(k   "(browse-scroll-up 5)")
(f   "(browse-follow-link)")                     ; Enter link-follow mode
(F   "(browse-follow-link-new-buffer)")          ; Follow in new buffer
(r   "(browse-reload)")                          ; Reload rendered content
(R   "(browse-toggle-reader-mode)")              ; Toggle reader mode
(oo  "(browse-open-url)")                        ; Prompt for URL
(bb  "(browse-bookmarks)")                       ; Open bookmarks
(yy  "(browse-copy-url)")                        ; Copy current URL to kill ring
(pi  "(browse-show-all-images)")                 ; Show all images inline
(q   "(browse-quit)")                            ; Close browse buffer
```

## Playwright Integration

### Session Management

Playwright browser instances are expensive to start. The browse-url package manages a shared browser context:

```typescript
// Singleton browser instance, lazily started
let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}
```

- **Lazy start:** No Playwright process until first URL is opened
- **Reuse:** One browser instance, multiple pages (one per browse buffer)
- **Timeout:** Auto-close after configurable idle period (`browse-playwright-idle-timeout`)
- **Cleanup:** Close all pages and browser on tmax exit

### Accessibility Tree Extraction

```typescript
async function extractA11yTree(url: string): Promise<A11yNode> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  const snapshot = await page.accessibility.snapshot();
  await page.close();
  return snapshot;
}
```

The accessibility tree is a nested structure with roles (heading, link, button, textbox, text) and names. This maps directly to structural ANSI rendering — no HTML parsing needed.

### Screenshot Capture

```typescript
async function captureScreenshot(
  url: string,
  opts: { width: number; height: number; scrollY?: number }
): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewportSize({ width: opts.width, height: opts.height });
  await page.goto(url, { waitUntil: 'networkidle' });
  if (opts.scrollY) {
    await page.evaluate((y) => window.scrollTo(0, y), opts.scrollY);
  }
  const screenshot = await page.screenshot({ type: 'png' });
  await page.close();
  return screenshot;
}
```

### Readability Extraction

```typescript
import { Readability } from '@mozilla/readability';

async function extractArticle(url: string): Promise<Article> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  const html = await page.content();
  const doc = new JSDOM(html).window.document;
  const reader = new Readability(doc);
  const article = reader.parse();
  await page.close();
  return article; // { title, byline, content, textContent, excerpt }
}
```

## Active Browsing (Layer 5)

Layers 1-4 are passive: render a URL, display the result. Layer 5 is active: maintain a persistent browser session, interact with page elements, and optionally delegate complex browsing tasks to an AI agent.

### API

```lisp
;; Session management
(browse-session-create :url "https://example.com" :mode 'headless)
;; → session-id (integer)

(browse-session-list)
;; → ((1 "https://example.com" headless) (2 "https://github.com" headed) ...)

(browse-session-focus 1)           ; Switch tmax's active session
(browse-session-close 1)           ; Close session, kill browser tab

;; Navigation
(browse-navigate 1 "https://github.com")
(browse-back 1)
(browse-forward 1)
(browse-reload 1)

;; Page inspection (reuses passive rendering)
(browse-screenshot 1)              ; Render current page via Kitty/Sixel
(browse-a11y-tree 1)               ; Dump a11y tree → temp buffer
(browse-reader 1)                  ; Readability extraction → temp buffer
(browse-url-current 1)             ; Current page URL

;; Interaction
(browse-click 1 "button.submit")
(browse-click-at 1 150 300)        ; Click at coordinates
(browse-type 1 "input#search" "tmax editor")
(browse-select 1 "select#country" "US")
(browse-press-key 1 "Enter")
(browse-wait-for 1 ".results")     ; Wait for selector to appear

;; AI-guided browsing
(browse-ai "Find the latest release version")
;; → LLM reads a11y tree, decides actions, loops until done
;; → result appears in *browser-result* buffer

(browse-ai-step)                   ; Show current AI browsing state
(browse-ai-intervene "click the second link")  ; Override AI decision
(browse-ai-stop)                   ; Stop AI browsing loop
```

### Minor Modes

| Mode | Keymap | Purpose |
|------|--------|---------|
| `browse-view-mode` | j/k scroll, f follow, r reload, q quit | Passive viewing of rendered content |
| `browse-interact-mode` | TAB next element, RET activate, s screenshot | Active element-level interaction |
| `browse-ai-mode` | shows goal + progress, allows intervention | AI-guided browsing with override |

All three compose on top of the rendering tiers. You can use any tier with any mode.

### Active Browsing Backend Evaluation

Three backends could power Layer 5. The choice affects the TypeScript I/O layer only — T-Lisp API is identical regardless.

#### Option A: Playwright Node Library (Inline)

Use the Playwright Node library directly in the tmax TypeScript process.

| Aspect | Assessment |
|--------|------------|
| **Integration** | Deep — full async API, event listeners, network interception |
| **Performance** | Fast — no IPC overhead, direct API calls |
| **Crash isolation** | None — browser crash can destabilize the editor process |
| **Dependency cost** | Medium — adds `playwright` as a dependency (~50MB download for browsers) |
| **Headed mode** | Supported — can show visible browser window for user oversight |
| **Zero-dependency philosophy** | Violated — `playwright` is a heavy external package |

This is what RFC-012's passive rendering tiers already use (the Playwright Integration section assumes the Node library). For active browsing, it's the most powerful but also the most coupled.

#### Option B: `@playwright/cli` (Subprocess)

Use the `@playwright/cli` command-line tool as a subprocess. tmax spawns it, sends commands, parses output.

| Aspect | Assessment |
|--------|------------|
| **Integration** | Shallow — CLI commands only, no event listeners, no streaming |
| **Performance** | Good — subprocess per command, but browser stays alive across calls |
| **Crash isolation** | Full — browser crash kills the subprocess, not the editor |
| **Dependency cost** | Low — standalone binary, no Node import, already on the system |
| **Headed mode** | Supported — `--headed` flag |
| **Zero-dependency philosophy** | Compatible — external tool, not a library dependency |
| **Protocol gap** | CLI doesn't expose full Playwright API (no network interception, no event listeners) |

Best fit for the tmax philosophy: external tool, process isolation, zero import. But limited to what the CLI exposes. Complex operations (network interception, wait-for-condition loops) would need workarounds.

#### Option C: browser-use (Python CLI Subprocess)

Use the `browser-use` Python library via its CLI (`browser-use open/state/click/type/screenshot/close`). tmax spawns Python subprocesses.

| Aspect | Assessment |
|--------|------------|
| **Integration** | Medium — higher-level than raw Playwright, includes AI agent loop |
| **Performance** | Slowest — Python process startup + Rust core + browser, multiple hops |
| **Crash isolation** | Full — Python process crash doesn't affect editor |
| **Dependency cost** | Heavy — Python runtime + browser-use package + Rust core |
| **AI integration** | Built-in — agent loop with LLM, custom tools, goal management |
| **Zero-dependency philosophy** | Borderline — adds Python runtime dependency |
| **Maturity** | Rapidly evolving — API may change between versions |

Best for AI-guided browsing specifically, but adds the heaviest dependency chain and the most latency per command.

#### Recommendation: Hybrid Approach

Use **Option B (`@playwright/cli`) as the primary backend** for Layers 1-4 and basic Layer 5 interaction. This aligns with tmax's zero-dependency philosophy and process isolation goals.

For **AI-guided browsing specifically** (the `browse-ai` command), support **Option C (browser-use)** as an optional plugin. Users who want AI browsing install `browser-use` separately. The T-Lisp API is the same; TypeScript detects which backend is available:

```lisp
;; Auto-detection (T-Lisp queries TypeScript)
(browse-backend-available 'playwright-cli)    ; t — always expected
(browse-backend-available 'browser-use)        ; nil — optional install

;; AI browsing requires browser-use
(defun browse-ai (goal)
  (unless (browse-backend-available 'browser-use)
    (error "browse-ai requires browser-use: pip install browser-use"))
  (browse-ai--run goal))

;; Manual override
(setq browse-active-backend 'playwright-cli)   ; or 'browser-use
```

**Option A (inline Playwright)** remains available as an optimization for users who want the deepest integration and are willing to accept the dependency. It's not the default but is supported as a configuration option.

```lisp
(setq browse-active-backend 'playwright-inline)  ; deepest integration, adds dependency
```

The TypeScript session manager abstracts over all three backends:

```typescript
interface BrowserBackend {
  createSession(url: string, opts: SessionOpts): Promise<SessionId>;
  navigate(id: SessionId, url: string): Promise<void>;
  click(id: SessionId, selector: string): Promise<void>;
  type(id: SessionId, selector: string, text: string): Promise<void>;
  screenshot(id: SessionId): Promise<Buffer>;
  a11yTree(id: SessionId): Promise<A11yNode>;
  closeSession(id: SessionId): Promise<void>;
}
```

Each backend implements this interface. T-Lisp dispatch doesn't know or care which backend is running.

## Related Work

| Project | What It Does | Relevance |
|---------|-------------|-----------|
| **Emacs `browse-url`** | URL detection + external browser dispatch | Core design pattern, but terminal-only, no inline rendering |
| **Emacs `eww` / `shr`** | Inline HTML rendering in Emacs buffers | Structural rendering reference, but no real browser engine |
| **browsh** | Firefox → terminal screenshot rendering | Proof of concept for screenshot approach, but heavy (full Firefox) |
| **w3m** | Terminal text browser | Gold standard for structural rendering, but no JS, limited CSS |
| **carbonyl** | Chromium in terminal (Rust) | Full engine in terminal, but not embeddable as a library |
| **chafa** | Image → ANSI/Unicode art | Potential rendering tier for terminals without image protocols |
| **Kitty `icat`** | Kitty image display protocol | Protocol reference for inline image rendering |
| **`@mozilla/readability`** | Article content extraction | Reader mode backend — proven, maintained by Mozilla |
| **Playwright** | Headless browser automation | Core rendering engine for screenshot, structural, and reader tiers |
| **`@playwright/cli`** | CLI interface to Playwright | Primary active browsing backend — subprocess isolation, zero-import, already on system |
| **browser-use** | AI-guided browser automation (Python + Rust) | Optional AI browsing backend — agent loop, LLM integration, goal-driven web tasks |
| **nb** | Terminal note-taking with link handling | UX reference for link management in terminal apps |

## Implementation Phases (Sub-RFCs)

### [RFC-012A: browse-url MVP](RFC-012A-browse-url-mvp.md)

**Goal:** Emacs `browse-url` parity — detect URLs, resolve contextual references, open in external browser. Zero heavy dependencies.

**Scope:**
1. URL detection at point: bare URLs, Markdown links, angle-bracket URLs
2. External browser dispatch only (`$BROWSER`, `open`, `xdg-open`)
3. `gx` and `gxg` keybindings
4. T-Lisp resolver registry (extensible per mode)
5. Contextual resolvers for RFC/spec references and GitHub issue refs
6. Structured errors for "no URL at point", "unsupported scheme", "external browser failed"
7. Injection-safe dispatch (argv array, never shell interpolation)
8. TRT tests for URL parsing and resolution

**Acceptance tests (daemon/TUI path):**
- `tmaxclient --keys 'gx' --json` on a buffer with a URL returns structured success state
- `browse-url-at-point` on a buffer with no URL returns structured diagnostic: `{:error "no-url-at-point" :buffer "example.txt" :cursor [10 5]}`
- `browse-url-at-point` on an unsupported scheme (`ftp://`, `file://`) returns `{:error "unsupported-scheme" :scheme "ftp"}`
- `browse-url-at-point` when external browser fails returns `{:error "browser-dispatch-failed" :command "open" :exit-code 1}`
- Contextual resolution: cursor on `RFC-012` inside `docs/` opens the RFC file, on `#123` in a git repo opens the GitHub issue

**Success criteria:** `gx` on any URL in any buffer opens it in the system browser. Works on macOS, Linux. Detects URLs in markdown, plain text, code comments. Zero heavy dependencies. All error paths return structured diagnostics.

### [RFC-012B: in-terminal reading](RFC-012B-in-terminal-reading.md)

**Goal:** Open URLs inside tmax without leaving the terminal. Read content, follow links.

**Scope:**
- Plaintext renderer: HTTP fetch + HTML→text (no Playwright needed)
- Reader mode: Playwright + Readability → clean article text (Playwright optional, lazy-started)
- Read-only browse buffers with browse buffer data model
- Link detection and following in rendered content
- Link hints (Vimium-style): `f` overlays number hints, user types hint to follow
- `browse-render-tier` configuration
- Playwright session management (lazy start, reuse, timeout)
- Bookmarks (T-Lisp data model, prompt-buffer search, generic file I/O)
- Rendered content caching with privacy policy
- Dead link archive.org fallback

**Copy commands:**
- `yy` copies canonical URL to kill ring
- `yt` copies page title
- `ym` copies Markdown-formatted link `[title](url)`

**Acceptance tests:**
- Reader mode creates a read-only browse buffer with `browse-buffer-url`, `browse-buffer-title`, `browse-buffer-links`, and `browse-buffer-tier` set
- Link hints: `f` overlays numbered hints; typing a hint number follows the link
- Cache: second visit to same URL loads from cache; cache respects privacy headers
- Bookmarks: `(bookmark-add ...)` persists across sessions via T-Lisp data file
- Error: Playwright unavailable → falls back to plaintext renderer without error

**Success criteria:** `browse-url` on a blog article renders clean readable text in a tmax buffer. Links are followable with `f` + hint. Works on any terminal. Playwright starts lazily if available; plaintext works without it.

**Product direction:** This is "web as editor buffer" — the killer workflow is reading docs, GitHub issues/PRs, articles, and RFCs without leaving the editor.

### [RFC-012C: rich rendering](RFC-012C-rich-rendering.md)

**Goal:** Visual rendering inside the terminal — structural (a11y tree) and screenshot (terminal image protocols).

**Scope:**

*Structural rendering:*
- Playwright a11y tree extraction
- ANSI structural renderer (headings, links, forms, buttons)
- Browse-mode keymap (j/k scroll, f follow, o open URL)
- Form interaction (fill fields, submit with confirmation)
- `gh`/`gl` for browse history back/forward
- `R` to toggle Reader / Structural / Screenshot tier

*Screenshot rendering (image-capable terminals):*
- Terminal capability detection
- Kitty graphics protocol implementation
- Sixel encoding implementation
- iTerm2 inline image protocol implementation
- Playwright screenshot → terminal image pipeline
- Scroll by re-capturing at different offsets
- Click-to-interact (map terminal clicks to Playwright page coordinates)
- Image preview for individual images in structural rendering (`pi`)
- Reader/Structural split view: left article, right outline/headings

*Smart features:*
- Per-URL-pattern rendering tier routing
- Markdown live preview (split view with Playwright rendering)
- Smart link detection (wiki links, org links, contextual refs)
- `browse-docs-at-point` for npm, Bun, TypeScript, Python, Go docs
- `browse-current-package-homepage`

**Acceptance tests:**
- Structural: GitHub repo page shows headings, links, and code blocks. `f` + hint follows a link.
- Screenshot: On Kitty, opening a URL shows a full screenshot inline. Scrolling re-renders.
- Fallback: On terminals without image support, falls back to structural rendering automatically.
- Terminal detection is accurate for Kitty, WezTerm, Ghostty, iTerm2, and unknown terminals.

**Success criteria:** Opening a GitHub repo page shows structural rendering. On Kitty, a URL shows a full screenshot. Degrades gracefully on any terminal.

### [RFC-012D: active browsing](RFC-012D-active-browsing.md) (experimental)

**Status: Experimental** — gated by security review, session isolation, and diagnostics.

**Goal:** Interactive browser sessions with element-level interaction and AI-guided browsing.

**Scope:**
- `@playwright/cli` subprocess session manager (create, navigate, click, type, screenshot, close)
- `BrowserBackend` TypeScript interface with playwright-cli implementation
- `browse-session-create/close/list` T-Lisp commands
- `browse-interact-mode` minor mode (TAB cycle elements, RET activate, s screenshot)
- `browse-click`, `browse-type`, `browse-navigate` T-Lisp commands
- Headed mode support — visible browser window for user oversight
- Destructive action confirmation (form submit, purchase, delete, post)
- Browser context isolation (separate profile per workspace by default)
- Sensitive URL restrictions (`file://`, `localhost`, private networks)
- Optional `browser-use` backend for AI-guided browsing (`browse-ai`)
- AI browsing safety: step log, redaction hooks, no autonomous form submission, timeout
- Backend auto-detection and manual override

**AI-native workflows:**
- "Research buffer" mode where every opened URL becomes a cited note
- Agent-visible `(browse-buffer-state :json)` with title, URL, links, headings, forms, extracted text
- `browse-ai-summarize-page` grounded in Reader/structural extraction
- Step log: every navigate/click/type/screenshot recorded as inspectable T-Lisp data

**Acceptance tests:**
- `browse-session-create` opens a URL in a persistent browser session
- `browse-click "button.submit"` triggers confirmation prompt before submitting
- `browse-ai "find the download link"` delegates to browser-use and returns result
- Session cleanup: closing tmax kills all browser sessions; orphan detection on startup
- Security: `file://` URL blocked by default; `localhost` shows warning; credentials in URL stripped
- Diagnostics: active browsing errors surface through `--diagnostics --json`

**Success criteria:** Persistent browser sessions work. Destructive actions require confirmation. AI browsing completes goals with inspectable step log. All backends implement the same `BrowserBackend` interface.

### Package Ecosystem

The resolver and backend system is designed for Loom package distribution:

| Package | Scope | Depends On |
|---------|-------|------------|
| `browse-resolver-github` | GitHub issue/PR/commit resolution | RFC-012A |
| `browse-resolver-rfc` | RFC/SPEC/ADR contextual resolution | RFC-012A |
| `browse-resolver-doi` | DOI → publisher URL resolution | RFC-012A |
| `browse-resolver-npm` | npm package name → docs/registry resolution | RFC-012A |
| `browse-reader` | Readability + Playwright Reader mode | RFC-012B |
| `browse-playwright` | Playwright integration (lazy install) | RFC-012B/C |
| `browse-terminal-images` | Kitty/Sixel/iTerm2 protocol support | RFC-012C |
| `browse-ai` | browser-use AI-guided browsing backend | RFC-012D (experimental) |

## Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Playwright startup latency | Medium — first URL open is slow (~2-3s) | Lazy start, persistent browser instance, loading indicator |
| Kitty/Sixel protocol edge cases | Medium — different terminals handle images differently | Test against Kitty, WezTerm, iTerm2; fall back to structural rendering |
| Memory usage | Low-Medium — Playwright browser process ~100-200MB | Single shared instance, idle timeout, warn on memory-constrained systems |
| Accessibility tree completeness | Low — not all pages have clean a11y trees | Fall back to HTML parsing for broken trees; manual structural extraction |
| `@mozilla/readability` edge cases | Low — some sites resist extraction | Fall back to structural or plaintext rendering; log failures for improvement |
| Terminal detection accuracy | Low — some terminals misreport capabilities | Provide manual override (`browse-render-tier`); test common terminals |
| `@playwright/cli` API coverage | Medium — CLI doesn't expose full Playwright API | Wrap common operations; fall back to inline Playwright for advanced features |
| browser-use API stability | Low-Medium — rapidly evolving library | Pin version, abstract behind `BrowserBackend` interface, optional dependency |
| Active session resource leaks | Low — orphaned browser processes | Session registry, cleanup on editor exit, idle timeout for sessions |
| AI browsing reliability | Medium — LLM may misinterpret pages, loop, or fail | Allow manual intervention (`browse-ai-intervene`), timeout, step-by-step mode |
| External browser command injection | High — malicious URL could execute arbitrary commands | Use argv array (never shell interpolation), validate URL scheme, sanitize |
| Untrusted page content | Medium — page text could contain ANSI escape sequences or T-Lisp injection | Sanitize all page text before rendering; never evaluate page content as code |
| Credential leakage | Medium — URLs with credentials, cookies in cached content | Strip credentials from URLs, isolate browser profiles, private-by-default cache |
| AI agent prompt injection | Medium — page content fed to LLM could contain adversarial instructions | Treat page content as untrusted input to AI; redaction hooks; no autonomous destructive actions |

## Alternatives Considered

### Embedding a browser engine (RFC-004)

RFC-004 proposes a standalone browser application with an embedded rendering engine (WebKitGTK, QtWebEngine, or CDP). This RFC is complementary, not competing:

- **RFC-004** is a full standalone browser (separate application, own window, own rendering engine)
- **RFC-012** is an in-editor URL handler (renders inside tmax, uses Playwright as backend)

Both can coexist. `browse-url` could delegate to the RFC-004 browser as one of its rendering backends.

### Custom HTML parser + terminal renderer

Building our own HTML parser and ANSI renderer (like `eww`/`shr`). Rejected because:
- No JavaScript execution — many modern sites are blank without JS
- Huge maintenance burden to keep up with web standards
- Playwright already gives us a real engine — reinventing the wheel

### Browsh model (always-screenshot)

Always rendering via screenshots, like browsh. Rejected as the sole approach because:
- Screenshots are bandwidth-heavy for terminal protocols
- No text selection, copy, or search in screenshot mode
- Structural rendering is more useful for text-heavy content (docs, articles)
- Better as one tier among many, not the only option

### Terminal-only (never use GUI browser)

Refusing to ever open a GUI browser. Rejected because:
- Some content genuinely needs a full browser (complex web apps, video)
- External browser dispatch is the proven fallback
- The goal is best-available rendering, not terminal purism

### Native browser automation package (no external tools)

Building browser automation directly into the tmax TypeScript process using the Playwright Node library as a first-class dependency. This would give the deepest integration but was rejected as the default because:
- Violates zero-dependency philosophy — Playwright is a heavy package (~50MB+ browsers)
- No crash isolation — browser crash can destabilize the editor
- Tight coupling — tmax core becomes dependent on Playwright's release schedule
- Better as an optional optimization (`browse-active-backend 'playwright-inline`) for users who want it

### browser-use as the sole active backend

Using browser-use (Python) as the only active browsing backend. Rejected because:
- Adds Python runtime dependency — heavy for a TypeScript/Bun project
- Higher latency per command (Python → Rust → browser chain)
- API evolving rapidly — stability risk
- Better as an optional plugin for AI-guided browsing specifically, not for basic session management

## Relationship to Other RFCs

- **RFC-004 (T-Lisp Browser):** browse-url can use the standalone browser as a rendering backend when available. The native engine in RFC-004 would implement the same `BrowserBackend` interface, replacing the playwright-cli subprocess with zero-IPC overhead.
- **RFC-011 (Markdown Enhancements):** URL detection in markdown buffers, markdown live preview
- **RFC-010 (Loom):** browse-url could be distributed as a Loom package once the package manager exists. The optional browser-use backend would be a separate Loom package with its own dependency declaration.

### Migration Path to RFC-004

The T-Lisp API and `BrowserBackend` TypeScript interface are designed to migrate cleanly to RFC-004's native engine. When RFC-004 ships:

1. RFC-004 implements `BrowserBackend` with its native rendering engine
2. T-Lisp dispatch adds the native backend as highest-priority option
3. Users set `(setq browse-active-backend 'native)` or auto-detection uses it when the RFC-004 browser daemon is running
4. All T-Lisp functions (`browse-session-create`, `browse-click`, etc.) work unchanged

The playwright-cli and browser-use backends remain as fallbacks for environments without the RFC-004 browser installed.

---

*"`browse-url` for the 2020s: detect links like Emacs, render like a browser, interact like an agent, degrade like a citizen."*
