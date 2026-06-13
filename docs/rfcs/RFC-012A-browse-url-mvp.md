# RFC-012A: browse-url MVP — URL Detection + External Dispatch

**Date:** 2026-06-11
**Status:** Proposed
**Author:** Mekael Turner
**Parent:** [RFC-012: browse-url — Terminal-Aware URL Handling](RFC-012-browse-url.md)

## Summary

The minimum viable browse-url: detect URLs in buffer text, resolve contextual references, and open them in the system's external browser. Zero heavy dependencies. This is Emacs `browse-url` parity — the foundation that later sub-RFCs build on.

## Relationship to Parent RFC

This is a sub-RFC of [RFC-012](RFC-012-browse-url.md). It implements Layers 1 (Detect) and 2 (Resolve) in full, and Layer 3 (Render) at the most basic tier — external browser dispatch. It does not depend on Playwright, terminal graphics, or any browser library.

RFC-012 sections relevant to this sub-RFC:
- [Layer Separation: TypeScript vs T-Lisp](RFC-012-browse-url.md#layer-separation-typescript-vs-t-lisp) — boundary protocol
- [URL Detection](RFC-012-browse-url.md#url-detection) — patterns and T-Lisp API
- [Security and Privacy Model → External Browser Dispatch](RFC-012-browse-url.md#security-and-privacy-model) — injection prevention

## Motivation

Before any in-terminal rendering, bookmarks, or AI browsing, tmax needs to answer one question: "There's a URL under my cursor — open it." Emacs has had this since the 1990s. Every later sub-RFC depends on this foundation.

## Scope

1. **URL detection at point:** bare URLs, Markdown links, angle-bracket URLs
2. **External browser dispatch:** `$BROWSER`, `open` (macOS), `xdg-open` (Linux)
3. **Key bindings:** `gx` (open at point), `gxg` (open at point in external browser)
4. **T-Lisp resolver registry:** extensible per-mode contextual resolvers
5. **Contextual resolvers:** RFC/spec references, GitHub issue refs
6. **Structured errors:** "no URL at point", "unsupported scheme", "external browser failed"
7. **Injection-safe dispatch:** argv array, never shell interpolation
8. **TRT tests:** URL parsing and resolution

### Out of Scope

- In-terminal rendering (see [RFC-012B](RFC-012B-in-terminal-reading.md))
- Playwright, terminal graphics, Readability
- Bookmarks, caching, link hints
- Active browsing sessions (see [RFC-012D](RFC-012D-active-browsing.md))

## Architecture

### Layer Separation

| Responsibility | Layer |
|---------------|-------|
| URL regex patterns, detection at point | T-Lisp |
| Contextual resolution logic | T-Lisp |
| Resolver registry, mode hooks | T-Lisp |
| Key bindings (`gx`, `gxg`) | T-Lisp |
| External browser dispatch (spawn process) | TypeScript |
| Structured error construction | T-Lisp (format), TypeScript (spawn failure) |

TypeScript exposes one primitive:

```lisp
(ts-call 'open-external url)  → {:ok t} | {:error reason details}
```

### URL Detection

| Pattern | Example | Detection |
|---------|---------|-----------|
| Bare URL | `https://example.com` | Regex on buffer text |
| Markdown link | `[text](url)` | Markdown syntax awareness |
| Angle-bracket URL | `<https://example.com>` | Common in plain text |
| Issue/PR reference | `#123`, `owner/repo#456` | Context-aware (inside git repo) |
| RFC/spec reference | `RFC-012`, `SPEC-039` | Context-aware (inside tmax docs) |

### Contextual Resolution

```lisp
;; Resolver registry — modes add resolvers
(define-url-resolver 'markdown-mode
  (lambda (text buffer)
    (when (string-match-p "^\\[\\[" text)
      (concat (buffer-directory buffer) "/"
              (string-replace "[[" "" (string-replace "]]" "" text))
              ".md"))))
```

Built-in resolvers:
- **Git issue resolver:** `#123` → `https://github.com/owner/repo/issues/123`
- **RFC/spec resolver:** `RFC-012` → `file:///path/to/docs/rfcs/RFC-012-browse-url.md`
- **Bare URL resolver:** `https://...` → passthrough

### External Browser Dispatch

Dispatch order:
1. `$BROWSER` environment variable (user override)
2. macOS: `open` command
3. Linux: `xdg-open` command
4. Common browsers: `firefox`, `chrome`, `chromium` (if found in `$PATH`)

Security: uses `Bun.spawn([cmd, url])` with argv array — never shell interpolation. URL scheme validated against allowlist (`http:`, `https:`, `mailto:`).

### T-Lisp API

```lisp
(browse-url "https://example.com")                    ; Open with auto-detected tier (external only in MVP)
(browse-url "https://example.com" :tier 'external)    ; Explicit external dispatch

(browse-url-at-point)           ; Open URL at cursor position
(browse-detect-at-point)        ; Return URL found at point (without opening)
(browse-resolve "RFC-012")      ; Expand contextual references

;; Resolver registration
(define-url-resolver 'markdown-mode resolver-fn)
```

### Error Model

All errors return structured diagnostics:

| Condition | Error Key | Details |
|-----------|-----------|---------|
| No URL at cursor | `no-url-at-point` | `{:buffer name :cursor [line col]}` |
| URL scheme not supported | `unsupported-scheme` | `{:scheme "ftp" :url "..."}` |
| External browser not found | `browser-not-found` | `{:tried ["$BROWSER" "open" "xdg-open"]}` |
| External browser failed | `browser-dispatch-failed` | `{:command "open" :exit-code 1 :stderr "..."}` |

## Key Bindings

```lisp
(gx  "(browse-url-at-point)")                    ; Open URL under cursor
(gxg "(browse-url-at-point :tier 'external)")    ; Open in external browser (explicit)
```

## Acceptance Tests

Daemon/TUI path — validated through `tmaxclient`:

```
# URL at point opens in external browser
tmaxclient --keys 'gx' --json
→ {:ok true :url "https://example.com" :tier "external"}

# No URL at point
tmaxclient --keys 'gx' --json
→ {:error "no-url-at-point" :buffer "example.txt" :cursor [10 5]}

# Unsupported scheme
tmaxclient --keys 'gx' --json   # cursor on ftp://...
→ {:error "unsupported-scheme" :scheme "ftp"}

# External browser fails
tmaxclient --keys 'gx' --json   # no browser available
→ {:error "browser-dispatch-failed" :command "open" :exit-code 1}

# Contextual resolution: RFC reference
tmaxclient --keys 'gx' --json   # cursor on "RFC-012" inside docs/
→ {:ok true :url "file:///path/to/docs/rfcs/RFC-012-browse-url.md" :tier "external"}

# Contextual resolution: GitHub issue
tmaxclient --keys 'gx' --json   # cursor on "#123" inside git repo
→ {:ok true :url "https://github.com/owner/repo/issues/123" :tier "external"}
```

TRT tests:

```
;; URL detection
(assert-equal (browse-detect-at-point) "https://example.com")  ; cursor on bare URL
(assert-equal (browse-detect-at-point) "https://example.com")  ; cursor inside [text](url)
(assert-nil (browse-detect-at-point))                            ; no URL at point

;; Contextual resolution
(assert-equal (browse-resolve "RFC-012") "file:///path/to/docs/rfcs/RFC-012-browse-url.md")
(assert-equal (browse-resolve "#123") "https://github.com/owner/repo/issues/123")

;; Error cases
(assert-error 'unsupported-scheme (browse-url "ftp://example.com"))
(assert-error 'no-url-at-point (browse-url-at-point))  ; when no URL under cursor
```

## Success Criteria

`gx` on any URL in any buffer opens it in the system browser. Works on macOS, Linux. Detects URLs in markdown, plain text, code comments. Zero heavy dependencies. All error paths return structured diagnostics.

## Roadmap Placement

Can be implemented after Phase 1.5 keymap infrastructure is stable. Self-contained — no dependencies on Playwright, terminal graphics, or other sub-RFCs.

## Next

[RFC-012B](RFC-012B-in-terminal-reading.md) adds in-terminal reading on top of this foundation.
