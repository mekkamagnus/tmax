# Browse-URL — URL Detection and Browser Dispatch

## Status

Accepted

## Context

The editor could not open URLs found in buffers. Users had to copy a URL, switch to a terminal, and paste it into a browser. There was no way to detect URLs in text (bare, markdown links, angle brackets, GitHub issue references) or dispatch them to the system browser.

## Decision

Implement URL detection and browser dispatch (SPEC-056):

1. **`src/editor/api/browse-url-ops.ts`** — TypeScript primitives: URL detection (regex-based, handles bare URLs, `[text](url)` markdown, `<url>` angle brackets, `#NNN` GitHub issues), scheme allowlist (`http`, `https`, `mailto`; `file://` restricted), `$BROWSER` environment variable parsing (colon-separated fallback chain), and injection-safe `Bun.spawn` dispatch (never shell-eval'd).
2. **`src/tlisp/core/commands/browse-url.tlisp`** — T-Lisp command layer: `browse-url-at-point` (detect + dispatch under cursor), integration with `markdown-follow-link` for markdown URL contexts, and the `gX` key binding.

## Consequences

**Easier:** Users press `gX` on any URL to open it in the system browser. Markdown links work naturally. GitHub issue references open in the browser.

**Harder:** URL detection regexes are complex and may have edge cases. The `$BROWSER` parsing assumes POSIX-style colon separation. The `file://` restriction is a security decision that may need revisiting.

**Related:** SPEC-056 (browse-url spec), ADR-0099 (expanded API — string ops used for URL detection).
