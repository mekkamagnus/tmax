# RFC-012D: Active Browsing — Interactive Sessions and AI-Guided Browsing

**Date:** 2026-06-11
**Status:** Proposed (Experimental)
**Author:** Mekael Turner
**Parent:** [RFC-012: browse-url — Terminal-Aware URL Handling](RFC-012-browse-url.md)
**Depends On:** [RFC-012A](RFC-012A-browse-url-mvp.md), [RFC-012B](RFC-012B-in-terminal-reading.md)

## Summary

Interactive browser sessions: maintain a persistent browser, click elements, type into forms, navigate programmatically, and (optionally) delegate web tasks to an AI agent. Experimental — gated by security review, session isolation, and diagnostics.

## Relationship to Parent RFC

This is a sub-RFC of [RFC-012](RFC-012-browse-url.md). It builds on [RFC-012B](RFC-012B-in-terminal-reading.md) (browse buffers, rendering) and adds Layer 5 (Automate) — active, session-based browser interaction.

RFC-012 sections relevant to this sub-RFC:
- [Active Browsing (Layer 5)](RFC-012-browse-url.md#active-browsing-layer-5) — API, backend evaluation, `BrowserBackend` interface
- [Security and Privacy Model](RFC-012-browse-url.md#security-and-privacy-model) — destructive actions, context isolation, AI safety
- [Dependency Policy](RFC-012-browse-url.md#dependency-policy) — playwright-cli, browser-use are optional
- [Component Map](RFC-012-browse-url.md#component-map) — `session.ts`, `browse-session.tlisp`

## Motivation

Passive rendering (open a URL, view the result) covers reading. Active browsing covers interaction: fill a search form, click through a multi-step flow, extract data from a dynamic page, or let an AI agent complete a web task while you watch. This is the layer that makes tmax a web interaction tool, not just a web viewer.

## Experimental Status

This sub-RFC is marked **experimental** because:

1. **Security surface area** — active browsing can submit forms, make purchases, delete content. Requires thorough security review before implementation.
2. **Session isolation** — browser sessions must be isolated from the editor process and from each other. Requires diagnostics to verify.
3. **Backend maturity** — `@playwright/cli` doesn't expose the full Playwright API; `browser-use` is evolving rapidly. Backend abstraction needs real-world validation.
4. **AI agent safety** — LLM-driven browsing introduces prompt injection risks and requires redaction hooks, step logging, and confirmation policies.

**Implementation should not begin until:** Phase 0.9 diagnostics are stable, security review is complete, and RFC-012B is shipped.

## Scope

### Session Management

- `@playwright/cli` subprocess session manager (create, navigate, click, type, screenshot, close)
- `BrowserBackend` TypeScript interface with playwright-cli implementation
- `browse-session-create/close/list` T-Lisp commands
- Session registry with cleanup on editor exit and orphan detection on startup

### Interaction

- `browse-click`, `browse-type`, `browse-navigate` T-Lisp commands
- `browse-interact-mode` minor mode (TAB cycle elements, RET activate, s screenshot)
- Headed mode support — visible browser window for user oversight
- Form filling and submission with destructive action confirmation

### AI-Guided Browsing

- Optional `browser-use` backend for AI-guided browsing (`browse-ai`)
- "Research buffer" mode where every opened URL becomes a cited note
- Agent-visible `(browse-buffer-state :json)` with title, URL, links, headings, forms, extracted text
- `browse-ai-summarize-page` grounded in Reader/structural extraction
- Step log: every navigate/click/type/screenshot recorded as inspectable T-Lisp data

### Security

- Destructive action confirmation (form submit, purchase, delete, post, download)
- Browser context isolation (separate profile per workspace by default)
- Sensitive URL restrictions (`file://`, `localhost`, private networks, credential-bearing URLs)
- AI browsing safety: step log, redaction hooks, no autonomous form submission, timeout
- Backend auto-detection and manual override

### Out of Scope

- Native browser engine (see [RFC-004](RFC-004-tlisp-browser.md))

## Architecture

### Backend Evaluation

Three backends can power active browsing. T-Lisp API is identical regardless.

**Option A: `@playwright/cli` (recommended default)**

| Aspect | Assessment |
|--------|------------|
| Integration | Shallow — CLI commands only |
| Performance | Good — browser stays alive across calls |
| Crash isolation | Full — subprocess crash doesn't affect editor |
| Dependency cost | Low — external binary, already on system |
| Zero-dep philosophy | Compatible |

**Option B: Playwright Node library (optional optimization)**

| Aspect | Assessment |
|--------|------------|
| Integration | Deep — full async API, event listeners |
| Performance | Fast — no IPC overhead |
| Crash isolation | None — browser crash can destabilize editor |
| Dependency cost | Medium — adds `playwright` as dependency |
| Zero-dep philosophy | Violated |

**Option C: browser-use Python CLI (AI browsing only)**

| Aspect | Assessment |
|--------|------------|
| Integration | Medium — includes AI agent loop |
| Performance | Slowest — Python → Rust → browser chain |
| Crash isolation | Full |
| Dependency cost | Heavy — Python runtime + browser-use + Rust core |
| Zero-dep philosophy | Borderline |
| AI integration | Built-in — agent loop with LLM |

**Recommendation:** Default to `@playwright/cli` for basic session interaction. Support `browser-use` as optional plugin for `browse-ai`. Support inline Playwright as optimization for users who opt in.

### BrowserBackend Interface

TypeScript abstracts over all three backends:

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

### Browse Buffer Data Model Extension

```lisp
;; Additional buffer-local variables for RFC-012D
browse-buffer-session-id       ; integer | nil — active browser session
browse-buffer-safe-mode        ; boolean — security restrictions active
```

### T-Lisp API

```lisp
;; Session management
(browse-session-create :url "https://example.com" :mode 'headless)
(browse-session-list)
(browse-session-focus 1)
(browse-session-close 1)

;; Navigation
(browse-navigate 1 "https://github.com")
(browse-back 1)
(browse-forward 1)
(browse-reload 1)

;; Page inspection (reuses RFC-012B/C rendering)
(browse-screenshot 1)              ; Render current page via Kitty/Sixel
(browse-a11y-tree 1)               ; Dump a11y tree → temp buffer
(browse-reader 1)                  ; Readability extraction → temp buffer
(browse-url-current 1)             ; Current page URL

;; Interaction
(browse-click 1 "button.submit")
(browse-click-at 1 150 300)
(browse-type 1 "input#search" "tmax editor")
(browse-select 1 "select#country" "US")
(browse-press-key 1 "Enter")
(browse-wait-for 1 ".results")

;; AI-guided browsing (requires browser-use backend)
(browse-ai "Find the latest release version")
(browse-ai-step)                   ; Show current AI browsing state
(browse-ai-intervene "click the second link")
(browse-ai-stop)
(browse-ai-log)                    ; Full action history

;; Backend configuration
(browse-backend-available 'playwright-cli)
(browse-backend-available 'browser-use)
(setq browse-active-backend 'playwright-cli)  ; or 'browser-use, 'playwright-inline
```

### Minor Modes

| Mode | Keymap | Purpose |
|------|--------|---------|
| `browse-view-mode` | j/k scroll, f follow, r reload, q quit | Passive viewing (from RFC-012B) |
| `browse-interact-mode` | TAB next element, RET activate, s screenshot | Active element-level interaction |
| `browse-ai-mode` | shows goal + progress, allows intervention | AI-guided browsing with override |

### Destructive Action Confirmation

| Action | Confirmation |
|--------|-------------|
| Submit a form | Yes — show form data, ask confirm |
| Make a purchase | Yes — always |
| Delete content | Yes — always |
| Post / send email | Yes — always |
| Download files | Yes — show filename, size, confirm |
| Navigate to a new URL | No (unless sensitive page) |
| Click a non-destructive element | No |
| Type into a text field | No |

```lisp
(setq browse-destructive-actions
      '(("submit" . confirm)
        ("purchase" . confirm-always)
        ("delete" . confirm-always)))
```

### Browser Context Isolation

```lisp
(setq browse-session-profile 'per-workspace)  ; default
;; 'shared      — one profile for all (convenient, less isolated)
;; 'private     — incognito per session (most isolated)
;; 'per-workspace — separate profile per workspace
```

### AI Browsing Safety

1. Agent must ask before destructive actions
2. Step log: every action recorded as inspectable T-Lisp data
3. Redaction hooks: T-Lisp functions strip sensitive content before LLM submission
4. No autonomous form submission — AI can fill, user confirms submit
5. Timeout: `browse-ai-timeout` (default 60 seconds)

```lisp
;; Redaction hook example
(add-hook 'browse-ai-pre-submit-hook
  (lambda (content)
    (replace-regexp-in-string "password\\s-*[:=]\\s-*\\S-+" "password=***" content)))
```

### Sensitive URL Restrictions

| Pattern | Default Behavior |
|---------|-----------------|
| `file://` | Blocked — prompt to confirm |
| `localhost` / `127.0.0.1` / `::1` | Warn |
| Private network (`10.*`, `192.168.*`) | Warn |
| Credentials in URL (`user:pass@`) | Blocked — strip, warn |
| `javascript:` | Blocked in tmax context |
| `data:` | Blocked |

### Component Map Additions

```
src/browse/
└── session.ts               # BrowserBackend interface + playwright-cli impl

src/tlisp/core/commands/
└── browse-session.tlisp     # Session management + interaction commands

src/tlisp/core/modes/
└── browse-mode.tlisp        # browse-interact-mode, browse-ai-mode
```

## Dependency Policy

| Dependency | Required | Default |
|-----------|----------|---------|
| `@playwright/cli` | Yes (basic sessions) | External tool, must be in `$PATH` |
| `browser-use` | No (AI browsing only) | Experimental, off by default, user installs separately |
| Playwright Node library | No (optional optimization) | Opt-in via `browse-active-backend` |

## Acceptance Tests

Daemon/TUI path:

```
# Session creation
(browse-session-create :url "https://example.com")
→ {:ok true :session-id 1 :url "https://example.com"}

# Click triggers confirmation for destructive action
(browse-click 1 "button.submit")
→ confirmation prompt: "Submit form with fields: name=foo, email=bar?"

# AI browsing
(browse-ai "find the download link")
→ step log shows: navigate → click → extract → result
→ *browser-result* buffer contains answer

# Session cleanup
;; close tmax
→ all browser sessions killed
;; restart tmax
(browse-session-list)
→ () — no orphaned sessions

# Security
(browse-session-create :url "file:///etc/passwd")
→ {:error "blocked-scheme" :scheme "file" :message "file:// URLs blocked by default"}

(browse-session-create :url "https://user:pass@example.com")
→ {:warning "credentials-stripped" :url "https://example.com"}

# Diagnostics
(browse-session-create :url "https://unreachable.invalid")
→ {:error "navigation-failed" :details "..."} surfaced via --diagnostics --json
```

TRT tests:

```
;; Session lifecycle
(assert-non-nil (browse-session-create :url "https://example.com"))
(assert-equal (length (browse-session-list)) 1)
(browse-session-close 1)
(assert-equal (length (browse-session-list)) 0)

;; Backend detection
(assert-equal (browse-backend-available 'playwright-cli) t)
;; browser-use may or may not be installed

;; Destructive action confirmation
(mock-confirm 'yes)
(browse-click 1 "button.submit")
;; → submitted

(mock-confirm 'no)
(browse-click 1 "button.submit")
;; → not submitted

;; AI step log
(browse-ai "find the version")
(assert-non-nil (browse-ai-log))
;; log contains navigate/click/extract steps
```

## Success Criteria

Persistent browser sessions work. Destructive actions require confirmation. AI browsing completes goals with inspectable step log. All backends implement the same `BrowserBackend` interface. Session cleanup is reliable. Security restrictions prevent access to sensitive URL schemes.

## Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `@playwright/cli` API coverage gaps | Medium — CLI doesn't expose full Playwright | Wrap common ops; fall back to inline Playwright for advanced features |
| browser-use API instability | Medium — rapidly evolving library | Pin version, abstract behind `BrowserBackend` interface |
| Session resource leaks | Low — orphaned browser processes | Session registry, cleanup on exit, idle timeout, orphan detection |
| AI browsing reliability | Medium — LLM misinterprets, loops, fails | Manual intervention, timeout, step-by-step mode |
| AI prompt injection | Medium — page content could contain adversarial instructions | Untrusted input treatment, redaction hooks, no autonomous destructive actions |
| Command injection via URLs | High — malicious URL could execute commands | argv array dispatch, scheme validation, URL sanitization |

## Roadmap Placement

Phase 3+ (experimental). Gated by: security review completion, Phase 0.9 diagnostics stability, RFC-012B shipped. This is a separate product surface — it should not compete with Phase 1.5 primitives.

## Relationship to Other RFCs

- **[RFC-004](RFC-004-tlisp-browser.md):** When RFC-004's native browser ships, it implements `BrowserBackend` and becomes the highest-priority backend. All T-Lisp APIs work unchanged.
- **[RFC-010](RFC-010-loom-package-manager.md):** `browse-ai` should be distributed as a separate Loom package with its own dependency declaration (`browser-use`).
- **[RFC-012A](RFC-012A-browse-url-mvp.md):** URL detection and external dispatch foundation.
- **[RFC-012B](RFC-012B-in-terminal-reading.md):** Browse buffers, rendering tiers, Playwright session management.

## Migration Path

When RFC-004 ships, the `BrowserBackend` interface allows transparent migration:

1. RFC-004 implements `BrowserBackend` with its native engine
2. T-Lisp dispatch adds native backend as highest-priority option
3. Users set `(setq browse-active-backend 'native)` or auto-detection uses it
4. All T-Lisp functions work unchanged — only the TypeScript backend swaps
