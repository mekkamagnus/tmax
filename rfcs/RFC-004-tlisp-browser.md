# RFC-004: T-Lisp-First Browser

**Author:** Mekael Turner
**Date:** 2026-06-03
**Status:** DRAFT

## Abstract

A standalone, keyboard-driven, T-Lisp-extensible browser built as a separate application that connects to the tmax daemon for its programmable surface. The browser uses a real rendering engine (WebKitGTK or QtWebEngine — see Open Questions) providing full JavaScript, CSS, and modern web compatibility. T-Lisp (via the tmax daemon) replaces Common Lisp (Nyxt) or Python (qutebrowser) as the extension language. Beyond basic browsing, tmax-browser prioritizes the features that make Nyxt genuinely unique: tree-based history, composable stateful modes, custom URL schemes, internal pages with JS→T-Lisp callbacks, auto-rules, data profiles, and a headless automation mode. These are the features no other browser has, and they are the reason to build this one.

## Motivation

### Why another browser?

The extensible browser space has two serious projects, each with a limitation that tmax-browser addresses:

| Browser | Engine | Extensibility | Limitation |
|---------|--------|---------------|------------|
| **Nyxt** | WebKitGTK | Common Lisp | WebKit dependency is fragile on some distros; Lisp ecosystem is niche; single-process architecture |
| **qutebrowser** | QtWebEngine (Chromium) | Python | Python is not a Lisp; no REPL-driven live modification; config is static files, not live evaluation |

Neither delivers: a fully JS-capable, REPL-driven, Lisp-first browser where the user redefines the *entire* browsing experience live from a REPL, with the extension language shared with their text editor.

### Why standalone?

Nyxt and qutebrowser are standalone applications. This is the proven model. A standalone browser:

- Has its own rendering pipeline independent of the editor
- Can run on a different machine than the editor daemon
- Doesn't couple browser latency to editor responsiveness
- Follows the Unix principle: browser does browsing, editor does editing, daemon does coordination

### Why T-Lisp via the tmax daemon?

tmax already has a Lisp interpreter, a daemon/client architecture, and a JSON-RPC protocol. A standalone browser connects to this existing infrastructure the same way `tmaxclient` does — by sending T-Lisp expressions to the daemon for evaluation. This means:

- **One config language.** User's `init.tlisp` defines editor *and* browser behavior.
- **One daemon.** No separate T-Lisp runtime inside the browser process.
- **REPL-driven.** Every aspect of the browser is live-modifiable from any tmax client or the browser's own command line.
- **Shared concepts.** Buffers, modes, commands — the browser speaks tmax's vocabulary over the wire.

This is the Nyxt-Emacs integration model, but native and deeper: Nyxt connects to Emacs for editing; this browser connects to tmax for *everything* programmable.

## Design Principles

1. **Standalone application.** Own executable, own process, own rendering context. Not a tmax mode, not a buffer type. A separate program that connects to the tmax daemon for T-Lisp evaluation.

2. **Full web compatibility.** JavaScript, CSS3, HTML5, WebGL — whatever the rendering engine supports, tmax-browser supports. This is a real browser.

3. **T-Lisp owns all behavior.** Navigation, scrolling, tab management, bookmarking, history, content filtering, key bindings — all defined in T-Lisp evaluated on the daemon. The rendering engine provides pixels; T-Lisp defines how the user interacts with them.

4. **REPL-driven.** Every aspect of the browser is live-modifiable from the T-Lisp REPL (via any tmax client). Redefine a function, rebind a key, add a content filter — all without restart.

5. **Keyboard-first, modal.** Normal mode for navigation (hjkl, link following, history). Insert mode for form fields. Command mode for URLs, searches, bookmarks. Same modal grammar as tmax editing.

6. **Minimal GUI chrome.** No address bar, no tab bar, no toolbar by default. Status line at the bottom (like tmax). All chrome is optional and defined in T-Lisp. The web content gets the full window.

7. **Steal Nyxt's best ideas.** Tree-based history, composable modes, custom URL schemes, internal pages, auto-rules, data profiles, and headless automation are the features that make Nyxt genuinely unique among browsers. These are first-class design goals, not nice-to-haves.

## Architecture

### Application Model

```
┌──────────────────────────────────────┐         JSON-RPC 2.0          ┌──────────────────┐
│   tmax-browser (standalone)          │◄──────── over Unix socket ────►│   tmax daemon    │
│                                      │                                │   (tmaxd)        │
│  ┌────────────────────────────────┐  │   eval "(browser-open ...)"   │                  │
│  │ Rendering Engine               │  │  ────────────────────────►    │  ┌────────────┐  │
│  │ ┌────────────────────────────┐ │  │                                │  │ T-Lisp     │  │
│  │ │ Web Content                │ │  │   result: { ... }              │  │ Interpreter│  │
│  │ │ (JS, CSS, HTML — full)     │ │  │  ◄────────────────────────    │  │            │  │
│  │ │                            │ │  │                                │  │ Evaluates  │  │
│  │ │ Engine handles rendering   │ │  │   Events:                     │  │ browser-*  │  │
│  │ │ and JavaScript execution   │ │  │   browser-page-loaded         │  │ functions  │  │
│  │ └────────────────────────────┘ │  │   browser-link-followed       │  └────────────┘  │
│  │                                │  │   browser-key-pressed         │                  │
│  │ Browser shell (TypeScript):    │  │                                │  ┌────────────┐  │
│  │ - Window management            │  │                                │  │ Editor     │  │
│  │ - Key event capture            │  │                                │  │ State      │  │
│  │ - Status line                  │  │                                │  └────────────┘  │
│  │ - Tab/buffer management        │  │                                │                  │
│  │ - History tree                 │  │                                │  ┌────────────┐  │
│  │ - Mode stack per buffer        │  │                                │  │ Other      │  │
│  └────────────────────────────────┘  │                                │  │ Clients    │  │
│                                      │                                │  └────────────┘  │
│  ┌────────────────────────────────┐  │                                │                  │
│  │ Daemon Client (JSON-RPC)       │  │                                │                  │
│  └────────────────────────────────┘  │                                │                  │
└──────────────────────────────────────┘                                └──────────────────┘
```

The browser is a tmax client. It connects to the daemon via the same JSON-RPC 2.0 protocol that `tmaxclient` uses, with browser-specific methods registered on the daemon side.

### Component Map

```
tmax-browser/                    # Separate project/repository
├── src/
│   ├── main.ts                  # Entry point — window init, daemon connect, main loop
│   ├── daemon.ts                # JSON-RPC client for tmax daemon
│   ├── engine/
│   │   ├── bridge.ts            # Rendering engine C API bindings (via Bun FFI)
│   │   ├── webview.ts           # WebView lifecycle, navigation, loading
│   │   ├── settings.ts          # Engine settings (JS enable, user agent, etc.)
│   │   └── injected.ts          # JS injected into pages for DOM querying/hints
│   ├── ui/
│   │   ├── window.ts            # Window management
│   │   ├── input.ts             # Key event capture and routing
│   │   ├── statusbar.ts         # Status line
│   │   ├── hints.ts             # Link hint overlay (JS injection)
│   │   └── prompt.ts            # Universal prompt buffer (fuzzy filter, marks, actions)
│   ├── buffer/
│   │   ├── manager.ts           # Buffer management
│   │   ├── web-buffer.ts        # Web page buffer (WebView + URL + mode stack)
│   │   ├── source-buffer.ts     # Page source viewer
│   │   ├── internal-buffer.ts   # T-Lisp-generated internal pages (tmax: scheme)
│   │   └── profile.ts           # Data profile per buffer (cookies, history, cache)
│   ├── history/
│   │   ├── tree.ts              # Tree-based history model
│   │   └── store.ts             # History persistence
│   ├── modes/
│   │   ├── manager.ts           # Mode stack per buffer (composable, ordered)
│   │   ├── normal-mode.ts       # Navigation mode
│   │   ├── insert-mode.ts       # Text entry mode (passthrough to engine)
│   │   ├── hint-mode.ts         # Link following
│   │   ├── caret-mode.ts        # Caret browsing
│   │   ├── visual-mode.ts       # Visual text selection
│   │   ├── process-mode.ts      # Automation building block (repeat action)
│   │   └── auto-rules.ts        # URL-conditioned mode activation
│   ├── schemes/
│   │   ├── registry.ts          # Custom URL scheme registry
│   │   └── internal-pages.ts    # tmax: scheme handler (T-Lisp-generated pages)
│   ├── network/
│   │   ├── cookies.ts           # Cookie management
│   │   └── intercept.ts         # Request interception for content filtering
│   ├── bookmarks/
│   │   └── store.ts             # Bookmark persistence
│   └── headless/
│       └── runner.ts            # Headless mode (no GUI, script-driven)
├── tlisp/                       # Browser T-Lisp definitions
│   ├── browser.tlisp            # Core browser functions (registered on daemon)
│   ├── keybinds.tlisp           # Default key bindings
│   ├── modes.tlisp              # Browser mode definitions
│   ├── filters.tlisp            # Content filter definitions
│   ├── schemes.tlisp            # Custom URL scheme handlers
│   └── internal-pages.tlisp     # Internal page generators (tmax: URLs)
├── native/                      # C bridge (if Bun FFI insufficient)
│   ├── engine_wrap.c            # Thin C wrapper around rendering engine API
│   └── Makefile
├── package.json
└── tsconfig.json
```

### Daemon Integration

The browser registers browser-specific T-Lisp functions on the tmax daemon at connection time.

**Connection lifecycle:**

1. Browser starts, creates window and WebView
2. Browser connects to tmax daemon Unix socket
3. Browser sends `browser/register` RPC with its capabilities
4. Daemon loads `browser.tlisp` into the T-Lisp environment (if not already loaded)
5. Browser and daemon communicate via JSON-RPC for all T-Lisp evaluation

**RPC Protocol (extends existing tmax daemon protocol):**

```typescript
// Browser → Daemon: Evaluate T-Lisp expression
{
  "jsonrpc": "2.0",
  "method": "eval",
  "params": { "expression": "(browser-open \"https://example.com\")" },
  "id": 1
}

// Daemon → Browser: Execute browser command
{
  "jsonrpc": "2.0",
  "method": "browser/navigate",
  "params": { "url": "https://example.com" },
  "id": 2
}

// Browser → Daemon: Notify event
{
  "jsonrpc": "2.0",
  "method": "browser/event",
  "params": { "event": "page-loaded", "url": "https://example.com", "title": "Example" }
}
```

**Function split:**
- **Daemon-side (T-Lisp):** Logic, configuration, key bindings, hooks, filters, bookmarks, mode definitions, URL scheme handlers, internal page generators — pure computation
- **Browser-side (TypeScript + engine):** Rendering, navigation, network, DOM interaction, tree-based history storage, mode stack management — side effects

When T-Lisp calls `(browser-open "url")`, the daemon sends an RPC to the browser process. The browser navigates the WebView. When the page loads, the browser sends a `page-loaded` event to the daemon, which triggers `browser-load-hook`.

## Key Feature Designs

### 1. Tree-Based History

No other browser models navigation as a branching tree. This is the single most distinctive feature to carry over from Nyxt.

**Model:**

Every page visit creates a node in a tree. When the user navigates from page A to B, then goes back to A and navigates to C, the tree captures both branches:

```
    [A: search results]
     ├── [B: first result]
     │    └── [D: link from B]
     └── [C: second result]
          └── [E: link from C]
```

**Data structure:**

```typescript
interface HistoryNode {
  id: string;
  url: string;
  title: string;
  timestamp: number;
  parentId: string | null;
  childIds: string[];
}

interface HistoryTree {
  nodes: Map<string, HistoryNode>;
  rootId: string | null;
  currentNodeId: string | null;
}
```

**User workflows:**

```
H / L           Navigate back/forward on current branch
gh              Go back to parent node
history-tree    Open visual tree of current buffer's history
history-branch  Prompt: pick a forward branch to follow
history-all     Prompt: pick any node in the tree to jump to
```

**Hub optimization:** When the user returns to a frequently-visited node (search results, HN front page), intermediate nodes are collapsible — the tree stays clean without losing the branching structure.

**Cross-buffer history:** `global-history-p` (default true) merges history across buffers into a single tree. Opening a link in a new buffer creates a branch in the same tree.

**T-Lisp API:**

```lisp
(history-tree)                    ; Show visual tree
(history-back)                    ; Go to parent
(history-forward)                 ; Go to first child (default branch)
(history-forward-query)           ; Prompt: pick a child branch
(history-jump node-id)            ; Jump to arbitrary node
(history-node-children node-id)   ; List child branches
(history-node-parent node-id)     ; Get parent node
(history-global-p t)              ; Merge history across buffers
```

### 2. Custom URL Schemes

Users register new URL schemes handled entirely by T-Lisp code running on the daemon. The browser shell delegates URL loading for registered schemes to the daemon.

**Registration:**

```lisp
;; Define a custom URL scheme
(define-url-scheme "reading-list"
  (lambda (url buffer)
    (let ((entries (reading-list-entries)))
      (format-html
        "<h1>Reading List</h1>"
        "<ul>"
        (dolist (e entries)
          (concat "<li><a href='" (car e) "'>" (cdr e) "</a></li>"))
        "</ul>"))))
```

**How it works:**

1. User navigates to `reading-list://` or a T-Lisp command opens it
2. Browser shell sees a registered scheme, sends the URL to the daemon
3. Daemon evaluates the handler function, returns HTML as a string
4. Browser shell loads the HTML into the WebView (via `load_html()`)

This turns the browser into an application platform. Users build T-Lisp apps that render as web pages: dashboards, configuration panels, feed readers, bookmark managers.

### 3. Internal Pages (tmax: scheme)

A special case of custom URL schemes. The `tmax:` scheme generates interactive pages with JS→T-Lisp callbacks.

**Definition:**

```lisp
;; Define an internal page
(define-internal-page "bookmarks"
  (lambda (buffer)
    (let ((bookmarks (bookmark-list-data)))
      (html
        "<h1>Bookmarks</h1>"
        "<input id='search' placeholder='Filter...'>"
        "<ul id='list'>"
        (dolist (b bookmarks)
          (html-li (html-link (car b) (cdr b))))
        "</ul>")))
  :script "(document.getElementById('search').addEventListener('input', function(e) {
    tlispEval('(bookmark-filter \"' + e.target.value + '\")');
  })")
```

**JS→T-Lisp bridge:** JavaScript in internal pages calls `tlispEval("expression")`, which the browser shell intercepts and forwards to the daemon for evaluation. The result updates the page. This enables interactive internal pages where user actions trigger T-Lisp functions.

### 4. Composable Mode System

Modes are not on/off toggles. They are stateful objects with their own lifecycle, stacked in order per buffer. This is what enables Nyxt's mode composition like `process-mode` → `repeat-mode` → `cruise-control-mode`.

**Mode interface:**

```typescript
interface BrowserMode {
  name: string;
  enable(buffer: WebBuffer): void;
  disable(buffer: WebBuffer): void;
  handleKey(key: string, buffer: WebBuffer): boolean; // true = consumed
  priority: number; // higher = handles keys first
}
```

**Mode stack per buffer:**

```typescript
class ModeStack {
  private modes: BrowserMode[] = []; // ordered by priority

  push(mode: BrowserMode): void;
  pop(mode: BrowserMode): void;
  handleKey(key: string, buffer: WebBuffer): boolean;
  getActiveModes(): BrowserMode[];
}
```

**Composition example:**

```lisp
;; process-mode: building block that runs an action repeatedly
(define-browser-mode process-mode
  :interval 1000
  :action nil) ; user sets the action

;; repeat-mode: built on process-mode, repeats last command
(define-browser-mode repeat-mode
  :parent process-mode
  :action (lambda () (browser-repeat-last-command)))

;; cruise-control: auto-scroll by composing repeat-mode + scroll
(define-browser-mode cruise-control-mode
  :parent repeat-mode
  :action (lambda () (browser-scroll-down 3)))
```

**Key handling order:** The mode stack processes key events from highest to lowest priority. If a mode consumes the key, lower-priority modes don't see it. This is how normal mode intercepts hjkl before the engine sees them.

### 5. Auto-Rules

Persistent, URL-conditioned mode configurations. When the user visits a URL matching an auto-rule, modes are automatically enabled or disabled.

**Rule definition:**

```lisp
;; Define rules in config
(define-auto-rule (match-domain "github.com")
  :modes '((no-script-mode . nil)       ; ensure JS is on
            (dark-mode . t)             ; force dark mode
            (blocker-mode . t)))        ; block ads

(define-auto-rule (match-domain "reddit.com")
  :modes '((old-reddit-redirect . t)
            (reader-mode . t)))

;; Save current mode configuration for this domain
(save-modes-for-future-visits)
```

**Rule storage:** Human-readable T-Lisp lists stored at `~/.config/tmax/auto-rules.tlisp`. Users can edit this file directly or use browser commands.

**Rule matching conditions:**

```lisp
(match-domain "example.com")       ; Match by domain
(match-host "docs.example.com")    ; Match by hostname
(match-url "https://example.com/path")  ; Match exact URL
(match-regex ".*\\.example\\.com") ; Match by regex
(match-scheme "https")             ; Match by URL scheme
```

**Auto-prompt:** When the user toggles a mode, the browser can prompt to save an auto-rule for the current URL condition. This is controlled by `auto-rule-prompt-p`.

### 6. Data Profiles

Different buffers can store data (cookies, history, cache) to different filesystem locations. This enables compartmentalization: work browsing, personal browsing, and development browsing in separate profiles, all running in the same browser instance.

```lisp
;; Define a profile
(define-data-profile work
  :cookies "~/.config/tmax/profiles/work/cookies"
  :history "~/.config/tmax/profiles/work/history"
  :cache   "~/.config/tmax/profiles/work/cache")

;; Open a buffer with a specific profile
(browser-open-with-profile "work" "https://internal.company.com")

;; Set default profile for a domain
(define-auto-rule (match-domain "internal.company.com")
  :profile 'work)
```

### 7. Prompt Buffer — Universal Command Interface

The prompt buffer is the browser's universal input mechanism. It replaces `M-x`, `:`, `C-x b`, and every other command palette with a single, consistent interface. Every interaction that requires selection — commands, URLs, buffers, bookmarks, history nodes — goes through the same prompt buffer with the same key bindings and the same capabilities.

**Core concepts:**

| Concept | What it does |
|---------|-------------|
| **Sources** | One or more data providers aggregated into a single result list |
| **Fuzzy filter** | Type to narrow results across all sources simultaneously |
| **Marks** | Toggle selection on individual items; marks persist through filter changes |
| **Actions** | Default action on confirm; switchable to any applicable alternative action |
| **Attributes** | Toggle additional metadata columns in the result display |

**Workflow:**

1. Trigger a prompt (command, URL, buffer switch, etc.)
2. Prompt buffer appears with results from all configured sources
3. Type to fuzzy-filter
4. Optionally mark multiple items (marks survive filter changes — filter, mark, filter again, mark more)
5. Optionally change the action (switch from "open" to "copy URL" or "bookmark")
6. Confirm with Return

**One prompt, every use case:**

| Trigger | Sources | Default action | Alternative actions |
|---------|---------|---------------|-------------------|
| `SPC ;` / `M-x` | All defined commands | Execute command | — |
| `o` | URL history, bookmarks, open buffers | Open URL | Open in new buffer, copy URL |
| `b` | Open buffers | Switch to buffer | Close buffer, copy URL |
| `B` | Bookmarks | Open bookmark | Open in new buffer, delete, edit tags |
| `H` / `history-tree` | History tree nodes | Jump to node | Open in new buffer, copy URL |
| `/` | (inline search, not prompt) | — | — |
| T-Lisp-defined | Any custom source | Any T-Lisp function | Any T-Lisp functions |

**Key bindings inside prompt buffer:**

```
C-n / ↓     Next result
C-p / ↑     Previous result
Tab         Next result
S-Tab       Previous result
C-m / Ret   Confirm (execute default/selected action on marked/selected items)
C-u C-m     Confirm with action query (pick alternative action first)
m           Toggle mark on current item
M-m         Toggle mark and move down
M-a         Mark all visible items
M-u         Unmark all items
C-s         Toggle attribute display (show/hide metadata columns)
Escape      Cancel prompt
```

**Defining custom prompts in T-Lisp:**

```lisp
;; A custom prompt that searches across multiple sources
(define-command-global my-find ()
  "Find anything — URL, bookmark, buffer, or history."
  (prompt
    :sources '(url-source bookmark-source buffer-source history-source)
    :action 'browser-open
    :actions '(browser-open-other clipboard-set bookmark-add)))

;; A prompt with a custom source
(define-prompt-source feed-source
  "RSS feed entries from subscribed feeds."
  :items (lambda () (feed-entries))
  :actions '(browser-open browser-open-other))
```

**How it differs from Emacs M-x and qutebrowser `:`:**

- **Emacs M-x:** Single-select, fixed action, one source at a time. No mark persistence across filter changes.
- **qutebrowser `:`** Single-select, fixed action per command type. No multi-source aggregation.
- **tmax-browser prompt:** Multi-select with persistent marks, switchable actions, multiple sources aggregated into one list. The same interface handles commands, URLs, buffers, bookmarks, history, and custom sources.

### 8. Headless Mode

Run the browser without a GUI for automation, scraping, and testing. Controlled entirely by T-Lisp scripts.

```lisp
;; headless.tlisp — automation script
(defun scrape-hn ()
  (browser-open "https://news.ycombinator.com")
  (wait-for-load)
  (let* ((links (browser-query-selector ".titleline > a"))
         (results (mapcar (lambda (el)
                           (cons (browser-element-text el)
                                 (browser-element-attr el "href")))
                         links)))
    (dolist (r results)
      (message (format "%s — %s" (car r) (cdr r))))))
```

```bash
# Run headless
tmax-browser --headless --eval '(scrape-hn)' --quit
# Or with a script file
tmax-browser --headless --script scrape.tlisp
```

## T-Lisp API

All functions are registered on the tmax daemon. The browser process handles side effects via RPC.

### Navigation

```lisp
(browser-open "https://example.com")        ; Open URL in current buffer
(browser-open-other "https://example.com")  ; Open in new buffer
(browser-open-with-profile 'work "url")     ; Open with specific data profile
(browser-back)                               ; Go to parent in history tree
(browser-forward)                            ; Go to first child (default branch)
(browser-forward-query)                      ; Prompt: pick a child branch
(browser-reload)                             ; Reload current page
```

### Querying

```lisp
(browser-url)                    ; Current URL
(browser-title)                  ; Page title
(browser-links)                  ; List of (text . href) pairs from DOM
(browser-visible-text)           ; Text content of visible area
(browser-page-source)            ; Raw HTML source
(browser-query-selector "css")   ; DOM elements matching selector
(browser-element-text el)        ; Text content of element
(browser-element-attr el "href") ; Attribute value of element
```

### Interaction

```lisp
(browser-follow-link 3)          ; Follow link #3
(browser-follow-hint)            ; Enter hint mode
(browser-submit-form form-id)    ; Submit a form
(browser-evaluate-js "code")     ; Evaluate JS in current page
(browser-click-element el)       ; Click a DOM element
(browser-focus-element el)       ; Focus a DOM element
(browser-type-text "text")       ; Type text into focused element
```

### Tree-Based History

```lisp
(history-tree)                    ; Show visual tree
(history-back)                    ; Go to parent node
(history-forward)                 ; Go to first child (default branch)
(history-forward-query)           ; Prompt: pick a child branch
(history-all-query)               ; Prompt: pick any node in tree
(history-jump node-id)            ; Jump to arbitrary node
(history-node-children node-id)   ; List child branches
(history-node-parent node-id)     ; Get parent node
(history-global-p t)              ; Merge history across buffers
(history-search "query")          ; Search across all history nodes
(history-clear)
```

### Bookmarks

```lisp
(bookmark-add "https://example.com" "Example Site" :tags '("docs" "reference"))
(bookmark-list)                  ; Show bookmarks
(bookmark-remove "Example Site")
(bookmark-search "query")        ; Search bookmarks by title/URL/tag
(bookmark-filter "query")        ; Filter bookmarks (used by internal pages)
```

### Buffers

```lisp
(browser-buffer-list)             ; List open buffers
(browser-buffer-switch 2)         ; Switch to buffer #2
(browser-buffer-close)            ; Close current buffer
(browser-buffer-url)              ; Current buffer's URL
```

### Modes

```lisp
(browser-mode-enable 'dark-mode)           ; Enable a mode
(browser-mode-disable 'dark-mode)          ; Disable a mode
(browser-mode-toggle 'dark-mode)           ; Toggle a mode
(browser-modes-active)                     ; List active modes for current buffer
(define-browser-mode name :parent parent   ; Define a new mode
  :action (lambda () ...))
(define-auto-rule condition                ; URL-conditioned mode config
  :modes '((mode . t/nil))
  :profile 'profile-name)
(save-modes-for-future-visits)             ; Save current modes as auto-rule
```

### Content Filtering

```lisp
(browser-add-content-rule rule)  ; Engine-level content block rule
(browser-add-dom-filter selector action)  ; DOM element filter
(browser-add-userscript domain js)  ; Per-domain JS injection
(browser-reader-mode t)          ; Reader mode
(browser-blocker-mode domains)   ; Block specific domains
```

### Custom URL Schemes & Internal Pages

```lisp
(define-url-scheme "name" handler-fn)  ; Register custom URL scheme
(define-internal-page "name" generator-fn :script js)  ; tmax: page with JS bridge
```

### Hooks

```lisp
(add-hook 'browser-load-hook (lambda () ...))        ; After page loads
(add-hook 'browser-render-hook (lambda () ...))       ; After rendering
(add-hook 'browser-navigate-hook (lambda (url) ...))  ; Before navigation
(add-hook 'browser-mode-hook (lambda (mode) ...))     ; After mode toggle
```

### User Configuration

```lisp
;; ~/.config/tmax/init.tlisp (shared with editor)

;; Homepage
(setq browser-homepage "https://news.ycombinator.com")

;; Search engine
(setq browser-search-engine "https://duckduckgo.com/?q=")

;; Auto-filter common junk
(dolist (selector '("nav" "footer" ".ad" ".cookie-banner"))
  (browser-add-dom-filter selector 'filter-remove))

;; Per-domain behavior via auto-rules
(define-auto-rule (match-domain "github.com")
  :modes '((dark-mode . t)))

(define-auto-rule (match-domain "reddit.com")
  :modes '((reader-mode . t)))

;; Custom keybinding: open HN
(browser-key-bind "gh" "(browser-open \"https://news.ycombinator.com\")")

;; Custom URL scheme: personal dashboard
(define-url-scheme "dashboard"
  (lambda (url buffer)
    (html "<h1>Dashboard</h1>"
          "<p>" (shell-command-to-string "date") "</p>")))

;; Headless automation script
(defun morning-briefing ()
  "Open my daily reading in separate buffers."
  (dolist (url '("https://news.ycombinator.com"
                  "https://lobste.rs"
                  "https://reddit.com/r/programming"))
    (browser-open-other url)))
```

## Modes

### Built-in Modes

| Mode | Purpose | Composable |
|------|---------|-----------|
| `normal-mode` | Default navigation, hjkl, hint following | Base mode |
| `insert-mode` | Passthrough keys to engine for text entry | Overrides normal |
| `prompt-mode` | Universal prompt buffer (commands, URLs, buffers, bookmarks) | Overrides normal |
| `hint-mode` | Numbered link following | Stacks on normal |
| `caret-mode` | Keyboard-driven cursor-based text selection | Stacks on normal |
| `visual-mode` | Visual text selection (like vim visual) | Stacks on caret |
| `process-mode` | Repeated action execution (building block) | Base for automation |
| `repeat-mode` | Repeat last command at intervals | Composes on process-mode |
| `cruise-control-mode` | Auto-scroll a page | Composes on repeat-mode |
| `blocker-mode` | Domain/URL content blocking | Independent |
| `dark-mode` | Apply dark theme to web content | Independent |
| `reader-mode` | Strip page to article content | Independent |
| `no-script-mode` | Disable JavaScript | Independent |
| `watch-mode` | Monitor page for changes | Independent |
| `proxy-mode` | Per-buffer proxy configuration | Independent |
| `passthrough-mode` | Forward all keys to engine | Overrides all |

### Normal Mode Key Bindings

```
j / ↓     Scroll down
k / ↑     Scroll up
h / ←     Scroll left
l / →     Scroll right
gg        Top of page
G         Bottom of page
f         Follow link (hint mode)
F         Follow link in new buffer
o         Open URL (prompt: URL history + bookmarks)
O         Open URL in new buffer (prompt)
b         Switch buffer (prompt: open buffers)
B         Open bookmark (prompt: bookmarks)
r         Reload
H         Back (history tree: parent)
L         Forward (history tree: default child)
gh        Go back to hub node in history tree
d         Close buffer
yy        Copy current URL
p         Open URL from clipboard
/         Search within page
n         Next search result
N         Previous search result
gh        Open HN (configurable)
i         Enter insert mode
c         Enter caret mode
SPC ;     Command prompt (like M-x — all commands, fuzzy filter)
:         Quick URL/command prompt (URL history + bookmarks + search)
F12       View page source
Escape    Return to normal mode
```

## Comparison with Nyxt and qutebrowser

| Aspect | Nyxt | qutebrowser | tmax-browser |
|--------|------|-------------|--------------|
| **Standalone** | Yes | Yes | Yes |
| **Full web compat** | Yes (WebKit) | Yes (Chromium) | Yes |
| **Extension language** | Common Lisp | Python | T-Lisp (via tmax daemon) |
| **REPL-driven** | Yes (SBCL REPL) | No (config reload) | Yes (tmax daemon REPL) |
| **Tree-based history** | Yes | No (linear) | **Yes** |
| **Custom URL schemes** | Yes (`define-internal-scheme`) | No | **Yes** |
| **Internal pages with JS→Lisp bridge** | Yes (`nyxt:` pages) | No | **Yes** (`tmax:` pages) |
| **Composable stateful modes** | Yes (CLOS-based) | No (mode toggles) | **Yes** |
| **Auto-rules** | Yes (URL→mode mapping) | Limited (per-domain settings) | **Yes** |
| **Data profiles per buffer** | Yes | No | **Yes** |
| **Prompt with marks + action querying** | Yes | No (single-select) | **Yes** |
| **Headless automation** | Yes (headless + DOM) | No | **Yes** |
| **Daemon architecture** | No (single process) | No (single process) | **Yes** (daemon + client) |
| **Shared config with editor** | No (separate from Emacs) | No | **Yes** (init.tlisp) |
| **Cross-application kill ring** | No | No | **Yes** (via daemon) |

## Implementation Phases

### Phase 1: MVP — Basic Browsing + Tree History

**Goal:** Open a URL, render it, navigate with hjkl, tree-based history.

- Standalone `tmax-browser` executable with Bun
- Rendering engine bridge (C wrapper + Bun FFI)
- Window with embedded WebView
- Daemon connection (JSON-RPC client)
- Key event interception (capture before engine in normal mode)
- Navigation: `browser-open`, `browser-back`, `browser-forward`
- Scrolling: hjkl (via engine scroll API)
- **Tree-based history** (branching navigation model)
- Tab management (multiple WebView instances)
- `browser.tlisp` loaded on daemon at connection
- Basic hint mode (JS injection for link following)

**Success criteria:** Run `tmax-browser https://news.ycombinator.com`, see full rendered page. Navigate with hjkl. Follow links with `f`. History is a tree — go back, follow a different link, go back again, pick either branch. All key bindings defined in T-Lisp.

### Phase 2: Usability + Composable Modes

**Goal:** Comfortable daily browsing. Mode system that enables automation.

- Full hint mode (numbered labels, filtering)
- **Composable mode system** (mode stack per buffer, priority-based key routing)
- **Process-mode, repeat-mode, cruise-control-mode** (demonstrate composition)
- **Auto-rules** (URL-conditioned mode activation with persistence)
- Bookmarks with tags (persisted to JSON, accessible via T-Lisp)
- URL/command mode (`:` + URL with autocomplete)
- Search within page (engine find API)
- Cookie management (engine cookie jar)
- Content filtering (content block rules + DOM filters)
- Status line with URL, buffer count, mode indicator
- Minibuffer for commands
- User agent setting
- Download handling (delegate to system or T-Lisp function)

**Success criteria:** Daily browsing is comfortable. Mode composition works: toggle cruise-control-mode and the page auto-scrolls. Toggle a mode on github.com, get prompted to save the auto-rule, and next visit the mode auto-activates.

### Phase 3: Application Platform

**Goal:** The browser as a platform for T-Lisp applications. Match Nyxt's unique features.

- **Custom URL schemes** (`define-url-scheme` — T-Lisp handlers generating HTML)
- **Internal pages** (`tmax:` scheme with JS→T-Lisp bridge)
- **Prompt buffer with marks and multi-select** (persistent marks, action querying)
- **Data profiles per buffer** (different cookie/history/cache locations)
- Caret browsing and visual mode
- Per-domain userscripts (T-Lisp-defined JS injection)
- Reader mode
- Custom search engines
- History search
- Session management (save/restore buffer sets)

**Success criteria:** Users can build T-Lisp applications that render inside the browser. `reading-list://`, `dashboard://`, `feeds://` are all navigable URLs backed by T-Lisp code. Bookmarks page is an internal page with live filtering via JS→T-Lisp bridge.

### Phase 4: Deep Integration + Headless

**Goal:** Full tmax ecosystem integration. Automation power tool.

- **Headless mode** (`--headless --script` for automation/scraping)
- Send page content to tmax editor buffer (via daemon RPC)
- Open editor in browser's page source (via daemon RPC)
- `M-x browse-url` in tmax editor opens URL in browser
- Shared kill ring (copy in browser, paste in editor)
- RSS/Atom feed reader (T-Lisp mode + internal page)
- Gopher/gemini protocol support (custom URI handlers)
- Export page to org-mode / markdown
- DevTools integration (engine Web Inspector)
- Multiple browser windows
- Extensible status line in T-Lisp
- Context menu commands bound to T-Lisp functions

**Success criteria:** Seamless workflow: browse docs in tmax-browser, send code snippets to tmax editor buffers, copy URLs between them, run headless scripts that scrape pages and pipe results to the editor. All configured from a single `init.tlisp`.

## Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Rendering engine API surface | High — large C API, version differences | Thin C wrapper; target specific engine versions; follow Nyxt/qutebrowser binding patterns |
| Bun FFI stability | Medium — FFI is newer Bun feature | Fallback to compiled C bridge |
| macOS support | Medium — WebKitGTK requires GTK; QtWebEngine requires Qt | Target Linux first; macOS via Homebrew or container; consider WKWebView as alternate backend |
| Daemon latency | Medium — every key press is an RPC round-trip | Batch key sequences; cache mode state locally; only send completed commands to daemon |
| Tree-based history scalability | Medium — deep trees, many branches | Lazy loading; prune old branches; cap tree depth |
| Mode composition complexity | Medium — interacting modes can conflict | Priority-based key routing; well-defined composition contracts; mode conflict detection |
| Memory usage | Medium — real engine is not lightweight | Accept this as the cost of a real browser; same as Nyxt/qutebrowser |
| Package distribution | Medium — engine runtime dependency | AppImage/Flatpak; document system package requirements |

## Rendering Engine Options

The largest unresolved design decision. Four approaches, each with distinct tradeoffs.

### Option A: WebKitGTK (embedded)

**How:** GTK application embedding a `WebKitWebView` widget. TypeScript talks to WebKitGTK's C API via Bun FFI or a thin C bridge.

| Pro | Con |
|-----|-----|
| Lighter than Chromium | C bridge required (~30 functions for MVP) |
| Nyxt-proven for Lisp-extensible browsers | Linux-primary (macOS requires Homebrew GTK) |
| JSCore is fast | WebKitGTK version fragmentation across distros |
| GTK event loop coexists reasonably with Bun | Must maintain C bridge as WebKit API evolves |
| Process isolation (WebKit's multi-process model) | |

**MVP effort:** ~3-4 weeks. The C bridge is the hardest part. Nyxt's bindings are Common Lisp (not reusable), so we write our own.

### Option B: QtWebEngine (embedded)

**How:** Qt application embedding a `QWebEngineView` widget. TypeScript talks to Qt's C++ API via a native bridge.

| Pro | Con |
|-----|-----|
| Chromium rendering — best web compat | Qt dependency is larger than GTK |
| qutebrowser-proven for keyboard-driven browsers | **Qt event loop vs Bun event loop** — hardest integration problem |
| Native macOS support | Heavier memory footprint than WebKitGTK |
| V8 (fastest JS engine) | qutebrowser is Python; no TypeScript/Qt reference to follow |
| Stable API surface | |

**MVP effort:** ~4-5 weeks. The event loop conflict between Qt and Bun is the hardest problem. qutebrowser solves this by being pure Python (Qt *is* the event loop). With Bun, you'd need Qt to own the main loop and Bun to run embedded, or a separate-process IPC design.

### Option C: CEF — Chromium Embedded Framework

**How:** CEF provides a C/C++ API for embedding Chromium. TypeScript talks to CEF via a native bridge. Maximum control over the Chromium process lifecycle.

| Pro | Con |
|-----|-----|
| Direct V8 context access (not just string-based JS injection) | Most boilerplate-heavy initialization |
| Maximum control over process lifecycle, network stack, rendering | CEF binary distribution (~200MB) |
| Cross-platform (Linux + macOS + Windows) | CEF's multi-threaded model conflicts with Bun's event loop |
| Used by Spotify, Discord, OBS | No reference implementation for a browser shell |

**MVP effort:** ~5-6 weeks. Most upfront work, but most control long-term.

### Option D: CDP — Chrome DevTools Protocol

**How:** Instead of embedding a rendering engine, the browser shell controls an existing Chrome/Chromium instance via CDP (WebSocket on `localhost:9222`). The shell is a *controller*, not a renderer.

```
tmax-browser (TypeScript shell)
    ↕ JSON-RPC
tmax daemon (T-Lisp evaluation)
    ↕ CDP (WebSocket to localhost:9222)
Chromium (already installed on the system)
```

| Pro | Con |
|-----|-----|
| **No C bridge, no FFI, no GTK/Qt** — pure WebSocket protocol | Requires Chrome/Chromium installed on the system |
| **Fastest path to MVP** (~1-2 weeks) | Don't own the window — Chromium renders in its own process |
| Async WebSocket — no event loop conflict | Can't control Chromium's own chrome (address bar, native tab bar) |
| CDP covers all RFC features: JS injection, DOM querying, cookies, network interception, content blocking | Dependency on Chrome's CDP version stability |
| Cross-platform everywhere Chrome runs | Two-process model (shell + Chrome) |
| Proven by AI agent tools (Chrome MCP, Playwright) | Less control over rendering pipeline than embedded options |

**CDP provides every feature in the RFC:**

| RFC Feature | CDP Method |
|-------------|-----------|
| Navigate to URL | `Page.navigate` |
| Go back/forward | `Page.navigateToHistoryEntry` |
| Inject JS (hints, filters) | `Runtime.evaluate` |
| Query DOM | `DOM.getDocument`, `DOM.querySelector` |
| Intercept/block requests | `Fetch.enable`, `Fetch.requestPaused` |
| Read cookies | `Network.getCookies` |
| Set cookies | `Network.setCookie` |
| Content blocking | `Network.setRequestInterception` or `Page.setAdBlockingEnabled` |
| Create new tab | `Target.createTarget` |
| List tabs | `Target.getTargets` |
| Page load events | `Page.loadEventFired` |
| Screenshots | `Page.captureScreenshot` |
| Emulate viewport | `Emulation.setDeviceMetricsOverride` |

**Window model options for CDP:**
1. **`--app` mode:** Chromium runs with no address bar, no tab strip. The shell controls everything via CDP. Close to the embedded-engine experience.
2. **`--headless` + terminal overlay:** Chromium renders off-screen, shell displays in terminal. Loses GUI fidelity but gains SSH support.
3. **Two-window:** Terminal for prompt/status, Chromium window for web content. Maximum separation.

**MVP effort:** ~1-2 weeks. No native bridge needed. The shell is pure TypeScript communicating over WebSocket.

### Engine Comparison Summary

| | WebKitGTK | QtWebEngine | CEF | CDP |
|---|---|---|---|---|
| **C bridge/FFI required** | Yes | Yes | Yes | **No** |
| **Event loop conflict** | Manageable | **Hardest** | Complex | **None** |
| **macOS/Linux/Windows** | Linux-primary | Linux + macOS | All three | **All three** |
| **MVP effort** | ~3-4 weeks | ~4-5 weeks | ~5-6 weeks | **~1-2 weeks** |
| **Long-term control** | Full | Full | **Maximum** | High (not full) |
| **Owns the window** | Yes | Yes | Yes | **No** (Chromium does) |
| **External dependency** | WebKitGTK runtime | Qt runtime | CEF binary (~200MB) | **Chrome/Chromium** |
| **Reference for this use case** | Nyxt | qutebrowser | None | Chrome MCP, Playwright |

**Recommendation:** Start with CDP for fastest MVP. Validate the T-Lisp API, tree-based history, mode system, and prompt buffer without investing weeks in a native bridge. If CDP proves limiting (can't own the window, Chrome dependency unacceptable), migrate to an embedded engine later — the T-Lisp API and daemon integration are engine-agnostic.

## Alternatives Considered

### Custom terminal renderer (no real engine)

Building a custom HTML parser and terminal renderer. Rejected because:
- No JavaScript — limits the browser to text-only sites
- No real CSS — modern web looks broken without it
- Terminal browsers (w3m, lynx, browsh) prove this model is limiting
- Users need a second browser for JS-dependent sites

### Browser as tmax mode (embedded in daemon)

Embedding the browser inside tmax as a buffer type. Rejected because:
- Couples browser latency to editor event loop
- Prevents running browser and editor independently
- Violates the standalone model that Nyxt and qutebrowser proved works

### Electron

Using Electron (Chromium + Node.js). Rejected because:
- Electron is its own application framework — not a browser shell you control
- Opinionated about process model and IPC
- Massive bundle size
- Nothing to innovate on — any Electron app can be a browser

### Browser extension approach

Build a T-Lisp bridge to Firefox/Chrome via extension protocol. Rejected because:
- Not a standalone browser — dependent on another browser
- Extension APIs are limited and subject to vendor changes
- Doesn't control the full browsing experience
- Can't implement tree-based history or custom URL schemes

## Relationship to tmax

This browser is a **separate application** that connects to the tmax daemon. The relationship is:

- **Own executable.** `tmax-browser https://example.com` starts the browser. `tmax file.ts` starts the editor. Different processes, same daemon.
- **Daemon client.** The browser connects to `tmaxd` via the existing JSON-RPC protocol. Browser-specific methods are registered when the browser connects.
- **Shared T-Lisp environment.** Browser functions are defined in T-Lisp files loaded on the daemon. User's `init.tlisp` configures both editor and browser.
- **Shared concepts.** Buffers, modes, commands — the browser uses the same vocabulary.
- **Inter-process integration.** Via the daemon: send URLs from editor to browser, send page content from browser to editor, shared kill ring, shared config.

## Open Questions

1. **Rendering engine?** Four options evaluated in detail above. CDP is fastest to MVP (~1-2 weeks) but doesn't own the window. WebKitGTK is the best embedded option for Linux. QtWebEngine gives macOS support out of the box. CEF gives maximum long-term control. Should we start with CDP and migrate to an embedded engine later, or pick an embedded engine from day one?

2. **CDP window model?** If CDP is chosen: `--app` mode (closest to embedded experience), `--headless` + terminal overlay (SSH support), or two-window (terminal + Chromium)? This affects the entire UX.

3. **macOS support?** If an embedded engine is chosen: WebKitGTK requires GTK (Homebrew or container), QtWebEngine works natively. Should we support Apple's native WebKit (WKWebView) as an alternate macOS backend?

4. **Repository structure?** Should tmax-browser live in the tmax monorepo (simpler daemon integration, shared types) or a separate repository (cleaner separation, independent release cycle)?

5. **Offline daemon?** Should the browser work without a running tmax daemon (limited functionality, no T-Lisp, hardcoded key bindings) or require the daemon? Requiring it is simpler but adds a startup dependency.

6. **Tree history storage?** In-memory with periodic persistence, or always-on-disk (SQLite)? In-memory is simpler but doesn't survive crashes. SQLite adds a dependency but scales better.

---

*"The browser is a tmax client — not a mode, not a plugin, not an afterthought. A standalone application with a real engine, tree-based history, and T-Lisp in its bones."*
