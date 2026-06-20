# Feature: browse-url — URL Detection + External Browser Dispatch

## Feature Description
Implement a minimum viable browse-url feature that detects URLs in buffer text (bare URLs, Markdown links, and angle-bracket URLs), resolves contextual references (RFC/spec references, GitHub issue refs), and opens them in the system's external browser using injection-safe argv dispatch. This feature adds Emacs `browse-url` parity as the foundation for future in-terminal rendering capabilities.

## User Story
As a developer working with documentation, code references, and web resources in tmax
I want to quickly open URLs under my cursor in my system browser
So that I can seamlessly access external resources without leaving my editor workflow

## Problem Statement
Currently, tmax lacks the ability to detect and open URLs in buffer text. Users must manually copy URLs, exit the editor (or switch context), and paste them into a browser. This breaks the editing workflow, especially when working with documentation filled with hyperlinks, code referencing external resources, or markdown files with embedded links.

## Solution Statement
Implement URL detection at point with multiple pattern recognition (bare URLs, markdown links, angle-bracket URLs), a contextual resolver registry for domain-specific references (RFC-012 → safe `file://` URL, #123 → GitHub issue), and injection-safe external browser dispatch using argv arrays (never shell interpolation). Preserve the existing markdown-mode `"g x"` binding (displayed as `gx`) by delegating external markdown targets to `browse-url`, and add the global normal-mode keymap sequence `"g X"` (displayed as `gX`) for direct `browse-url-at-point` dispatch, with structured user-level error values for all expected failure modes.

## Relevant Files

### Existing Files to Modify

#### `src/editor/tlisp-api.ts`
- Add `ts-open-external` primitive function for browser dispatch
- Returns `Either.right` with a structured T-Lisp hashmap result; reserve `Either.left` for interpreter/runtime errors
- Handles $BROWSER, open (macOS), xdg-open (Linux) detection
- Validates URL schemes against allowlist (http:, https:, mailto:, and restricted file:)
- Uses Bun.spawn with argv array for injection safety

#### `src/tlisp/core/bindings/normal.tlisp`
- Add `(require-module editor/commands/browse-url)` before any browse-url binding
- Add only the global `"g X"` binding for direct browse-url-at-point dispatch
- Do not add a global `"g x"` binding; the existing `gx` behavior remains mode-scoped in `src/tlisp/core/modes/markdown-mode.tlisp` and reaches external browsing through markdown command delegation
- Do not add `"g x g"` in this MVP; the current prefix-first dispatcher would shadow any complete `"g x"` binding

#### `src/tlisp/core/commands/markdown.tlisp`
- Require `editor/commands/browse-url`
- Refactor external URL handling to delegate to `browse-url`/`ts-open-external` instead of shell-interpolated `open`/`xdg-open`
- Preserve internal markdown file/anchor navigation

#### `src/editor/api/documentation.ts`
- Add help entries for `browse-url`, `browse-url-at-point`, `browse-detect-at-point`, and `define-url-resolver`

#### `README.md`, `docs/tmax/tlisp.texinfo`, `docs/tmax/tmax.texinfo`, `examples/init.tlisp.example`
- Document the key sequences, command usage, and resolver API examples

#### `test/unit/browse-url.test.ts` (New)
- Bun tests for URL detection patterns
- Tests for external browser dispatch (mocked)
- Resolver registry tests
- Error handling validation

#### `test/tlisp/browse-url.test.tlisp` (New)
- TRT tests for T-Lisp command behavior
- URL detection edge cases
- Resolver function tests
- Integration tests with markdown mode

### New Files to Create

#### `src/tlisp/core/commands/browse-url.tlisp`
- T-Lisp command library for browse-url functionality
- Functions: browse-url, browse-url-at-point, browse-detect-at-point
- Contextual resolver: browse-resolve
- Resolver registration: define-url-resolver
- Return structured success/error hashmaps with string keys

#### `src/editor/api/browse-url-ops.ts`
- Primitives for character-at-position and bounded same-line scanning; URL detection must reuse the existing `(buffer-get-line)` API for line text rather than introducing a duplicate line-text primitive
- URL pattern scanning helpers
- Regex span extraction helper for T-Lisp detection
- Filesystem/git context helpers for RFC/spec and GitHub issue resolvers
- Provides low-level buffer access for T-Lisp detection
- Export pure browser dispatch helpers with injected dependencies so unit tests never launch a real browser

## Implementation Plan

### Phase 1: Foundation — TypeScript Primitives
Add the foundational TypeScript functions that T-Lisp will compose:

1. **External browser dispatch primitive**: Add `ts-open-external` function that:
   - Checks $BROWSER environment variable
   - Falls back to platform detection (macOS: open, Linux: xdg-open)
   - Validates URL scheme against allowlist (http, https, mailto, restricted file)
   - Allows `file:` only for resolver-produced local documentation targets whose decoded, real path is under the repository's `docs/rfcs/` or `docs/specs/` directories; reject non-local hosts, missing files, directories, and symlinks that escape those roots
   - Uses Bun.spawn with argv array (never shell interpolation)
   - Returns `Either.right` for both success and expected user-level failures; return `Either.left` only for invalid primitive arguments or interpreter/runtime failures

   Exact T-Lisp return shapes:
   - Success: `(hashmap "ok" t "url" url "command" command "argv" argv-list "pid" pid-number)`
   - Error: `(hashmap "ok" nil "error" reason-string "details" details-hashmap)`
   - Top-level error reasons: `"unsupported-scheme"`, `"file-url-not-allowed"`, `"browser-not-found"`, `"browser-dispatch-failed"`
   - Invalid `$BROWSER` templates are never returned as a top-level `ts-open-external` error. Record them as entries in `details.tried` with `"error" "invalid-browser-template"` and continue to the next `$BROWSER`, platform, or fallback candidate. If all valid candidates fail to resolve, return `"browser-not-found"`; if a candidate resolves but `Bun.spawn` throws before process creation, return `"browser-dispatch-failed"`.

   Async dispatch rule:
   - `ts-open-external` starts the process with `Bun.spawn` and returns immediately with the spawned pid.
   - Immediate `"browser-dispatch-failed"` is only for candidate validation failure or `Bun.spawn` throwing before a process is created.
   - Do not report an exit code in the immediate return value. If an implementation observes `proc.exited` later, it may log a message to `*Messages*`, but that asynchronous status is not part of the `ts-open-external` return contract.

   Browser candidate order and `$BROWSER` parsing:
   - Candidate order is: each valid `$BROWSER` template, platform opener (`open` on macOS, `xdg-open` on Linux), then fallback executables (`firefox`, `google-chrome`, `chromium`, `brave-browser`).
   - `$BROWSER` is parsed as one or more colon-separated command templates, where colon separators are recognized only outside single quotes, double quotes, and backslash escapes. Within each template, split arguments with the same small shell-like parser that supports whitespace, single quotes, double quotes, and backslash escaping, but performs no shell expansion.
   - If a template contains `%s` or `%u`, substitute the URL for each placeholder and do not append another URL argument. If it has no placeholder, append the URL as the final argv element.
   - The first argv element must resolve to an executable via absolute path or `PATH`; invalid `$BROWSER` templates are recorded in `"tried"` details and dispatch continues to fallback candidates.

2. **Buffer scanning primitives**: Add character and line access functions:
   - Use existing `(buffer-get-line line)` for line text; do not add a new `(buffer-line-text)` primitive
   - `(buffer-get-char-at-position line column)` — get character at specific line/column
   - `(buffer-scan-backward-from line column stop-chars max-chars)` — return inclusive start boundary for a same-line scan
   - `(buffer-scan-forward-from line column stop-chars max-chars)` — return exclusive end boundary for a same-line scan
   - `(string-match-spans-all pattern text)` — return all non-overlapping regex matches with capture spans
   - These enable efficient URL pattern detection from T-Lisp

   Primitive contracts:
   - All line/column indexes are zero-based.
   - Line scans never cross line boundaries in the MVP.
   - `buffer-get-line` is the required line-text API for browse-url detection.
   - `buffer-get-char-at-position` returns nil for an out-of-bounds line/column; column equal to line length is out of bounds and does not synthesize a newline.
   - `buffer-scan-backward-from` accepts column in `[0, line-length]`, scans left from the character under the cursor (or the previous character when column equals line length), stops before any character in `stop-chars`, and returns `(hashmap "line" line "column" start-column "truncated" boolean)`.
   - `buffer-scan-forward-from` accepts column in `[0, line-length]`, scans right from column, stops before any character in `stop-chars`, and returns `(hashmap "line" line "column" end-column "truncated" boolean)`.
   - Scan ranges are half-open `[start-column, end-column)`: start inclusive, end exclusive.
   - `max-chars` must be positive; callers should pass 2048 for URL detection. If the scan hits the limit, return the boundary reached with `"truncated" t`.
   - `string-match-spans-all` is pure and does not mutate the existing `string-match` / `match-string` state. On success it returns `(hashmap "ok" t "matches" matches-list)`, where each match is:
     `(hashmap "start" start-column "end" end-column "text" full-match "groups" group-list)`.
   - Each `groups` entry is `(hashmap "index" n "start" start-column-or-nil "end" end-column-or-nil "text" matched-text-or-nil)`, with group 0 omitted because the full match is already present at top level.
   - Regex spans are zero-based UTF-16 string indexes, matching existing T-Lisp string indexing behavior.
   - Invalid regex patterns return `(hashmap "ok" nil "error" "invalid-regex" "details" (hashmap "pattern" pattern "message" message))`.

3. **Filesystem/git context helpers**: Add factual primitives used by resolvers, keeping path and remote parsing out of shell commands:
   - `(browse-doc-reference reference kind)` where `kind` is `"rfc"` or `"spec"`:
     - Lists only the corresponding repository directory (`docs/rfcs/` or `docs/specs/`) using TypeScript filesystem APIs.
     - Matches files whose basename starts with the exact reference prefix plus `-`, canonicalizes the path with `realpath`, rejects directories, missing files, and symlinks escaping the allowed root, and returns `(hashmap "ok" t "path" canonical-path "url" file-url)`.
     - On failure returns `(hashmap "ok" nil "error" "docs-reference-not-found" "details" (hashmap "reference" reference "root" canonical-root))` or `"file-url-not-allowed"` for root escape.
   - `(browse-git-github-remote)`:
     - Finds the current buffer's containing git worktree by walking parent directories and reading `.git` files/directories with TypeScript filesystem APIs; it must not invoke shell commands.
     - Reads `.git/config`, parses remote URLs for `origin`, `upstream`, then other remotes, and supports only the GitHub URL forms listed in the GitHub issue resolver contract below.
     - Returns `(hashmap "ok" t "owner" owner "repo" repo "remote" remote-name "url" remote-url "worktree" worktree-path)` or `(hashmap "ok" nil "error" "github-remote-not-found" "details" (hashmap "buffer" buffer-name "path" buffer-path-or-nil))`.

### Phase 2: Core Implementation — T-Lisp Commands
Build the T-Lisp command library with URL detection and resolution:

1. **URL detection patterns**: Implement pattern matching for:
   - Bare URLs: scan all current-line matches for `https?://[^\s<>"']+`, then trim trailing `.`, `,`, `;`, `:`, `!`, `?`, and unmatched closing `)`, `]`, `}` that are present in the matched text
   - Markdown links: scan all current-line matches for `\[...\](...)`; the candidate range is the full markdown link and the returned URL is the target group
   - Angle-bracket URLs: scan all current-line matches for `<https?://...>`; the candidate range excludes the angle brackets and the returned URL excludes them
   - Issue references: `#\d+` only when the GitHub issue resolver is applicable
   - RFC/spec references: `RFC-\d+`, `SPEC-\d+` (context-aware: docs path)

   Candidate selection algorithm:
   - Detection is same-line only in the MVP; do not scan across line boundaries.
   - Use `string-match-spans-all` for all regex candidate extraction; do not loop on the existing stateful `string-match` / `match-string` API.
   - Generate all candidates on the current line, with absolute zero-based half-open ranges `[start-column, end-column)`.
   - A candidate contains point when `start-column <= cursor-column < end-column`.
   - If multiple candidates contain point, choose by priority: markdown link, angle-bracket URL, bare URL, RFC/spec reference, GitHub issue reference.
   - For ties within the same priority, choose the smallest containing range, then the earliest start column.
   - If no candidate contains point, return `(hashmap "ok" nil "error" "no-url-at-point" "details" (hashmap "buffer" buffer-name "cursor" (list line column)))`.
   - Return detected candidates as `(hashmap "ok" t "kind" kind "text" matched-text "url" resolved-or-raw-url "range" (list line start-column line end-column))`.

2. **Contextual resolver registry**: Implement extensible resolver system:
   - `define-url-resolver` function for mode-specific resolvers
   - Resolver function signature: `(text buffer range) -> url-or-result | nil`
   - Built-in resolvers: git issues, RFC/spec, bare URLs
   - Mode hooks: modes can add resolvers on activation

   RFC/spec resolver contract:
   - `RFC-NNN` resolves to an existing file in `docs/rfcs/` whose basename starts with `RFC-NNN-`.
   - `SPEC-NNN` resolves to an existing file in `docs/specs/` whose basename starts with `SPEC-NNN-`.
   - Use `browse-doc-reference` for listing, canonicalization, symlink/root checks, and file URL construction; T-Lisp must not shell out for these facts.
   - Resolution returns a canonical `file://` URL for the matched file. If there is no match, return `(hashmap "ok" nil "error" "docs-reference-not-found" "details" (hashmap "reference" text))`.

   GitHub issue resolver contract:
   - Applies only inside a git worktree with a GitHub remote.
   - Use `browse-git-github-remote` to derive owner/repo by inspecting remotes in order: `origin`, `upstream`, then the first remote URL that parses as GitHub; T-Lisp must not shell out for git context.
   - Supported remote formats: `https://github.com/OWNER/REPO(.git)`, `git@github.com:OWNER/REPO(.git)`, and `ssh://git@github.com/OWNER/REPO(.git)`.
   - Strip a trailing `.git`, preserve owner/repo case in the URL, and build `https://github.com/OWNER/REPO/issues/NUMBER`.
   - Outside a git worktree or without a supported GitHub remote, issue references are ignored by automatic detection. Explicit `(browse-resolve "#123")` returns `(hashmap "ok" nil "error" "github-remote-not-found" "details" (hashmap "reference" "#123"))`.
   - To avoid false positives, match `#123` only at token boundaries `(^|[\s([{,;])#([1-9][0-9]*)\b`, never inside URL fragments, markdown heading markers, color literals, or markdown link targets.

3. **Core commands**: Implement main user-facing functions:
   - `browse-url` — open explicit URL string
   - `browse-url-at-point` — detect and open URL under cursor
   - `browse-detect-at-point` — return URL without opening
   - `browse-resolve` — expand contextual references

### Phase 3: Integration — Key Bindings and Error Handling
Complete the feature with user-facing integration:

1. **Key bindings**: Add direct browser binding while preserving markdown delegation:
   - Existing markdown-mode `"g x"` (`gx`) remains the markdown action-at-point sequence and must open external URL targets by having `markdown-do`/`markdown-follow-link` delegate URL targets to `browse-url`
   - Add `"g X"` (`gX`) → `(browse-url-at-point)` as the direct external-browser command
   - Do not add a global `"g x"` binding or `"g x g"` (`gxg`) unless the normal-mode dispatcher first gains complete-binding-versus-prefix disambiguation; with current prefix-first dispatch, `"g x g"` would prevent any complete `"g x"` binding from executing

2. **Structured error handling**: Implement error cases:
   - No URL at point: `(hashmap "ok" nil "error" "no-url-at-point" "details" (hashmap "buffer" name "cursor" (list line col)))`
   - Unsupported scheme: `(hashmap "ok" nil "error" "unsupported-scheme" "details" (hashmap "scheme" "ftp" "supported" (list "http" "https" "mailto" "file")))`
   - Restricted file URL: `(hashmap "ok" nil "error" "file-url-not-allowed" "details" (hashmap "path" path "allowed-roots" roots))`
   - Browser not found: `(hashmap "ok" nil "error" "browser-not-found" "details" (hashmap "tried" tried-list))`
   - Browser failed before spawn: `(hashmap "ok" nil "error" "browser-dispatch-failed" "details" (hashmap "command" command "message" message))`

3. **Mode integration**: Hook into existing modes:
   - markdown-mode: link detection for `[text](url)` pattern
   - fundamental-mode: bare URL detection
   - Resolvers can be mode-specific via hook system

## Step by Step Tasks

### Step 1: Add TypeScript external browser dispatch primitive
- Add `ts-open-external` function in `src/editor/tlisp-api.ts`
- Implement platform detection (macOS/Linux/$BROWSER)
- Add URL scheme validation (http, https, mailto allowlist)
- Use Bun.spawn with argv array for injection safety
- Return structured Either result with error details
- Add unit tests for platform detection and scheme validation
- Test with mock process spawning

### Step 2: Add buffer scanning primitives for URL detection
- Create `src/editor/api/browse-url-ops.ts`
- Reuse existing `(buffer-get-line)` for current-line text; do not implement a duplicate `(buffer-line-text)` primitive
- Implement `buffer-get-char-at-position` primitive
- Implement `buffer-scan-backward-from` primitive
- Implement `buffer-scan-forward-from` primitive
- Implement `string-match-spans-all` primitive for all-match regex span extraction without mutating `string-match` state
- Implement `browse-doc-reference` and `browse-git-github-remote` primitives for resolver filesystem/git context without shell interpolation
- Add tests for character access and scanning
- Register functions in tlisp-api.ts createEditorAPI

### Step 3: Implement T-Lisp URL detection patterns
- Create `src/tlisp/core/commands/browse-url.tlisp`
- Implement bare URL regex pattern: `https?://[^\s<>"']+` with the trailing punctuation/unmatched closer trimming described above
- Implement markdown link pattern with cursor position check
- Implement angle-bracket URL pattern
- Add `browse-detect-at-point` function
- Add TRT tests for each pattern type

### Step 4: Implement contextual resolver registry
- Add resolver registry data structure (hashmap by mode)
- Implement `define-url-resolver` function
- Implement resolver dispatch logic
- Add built-in resolvers (git issues, RFC/spec)
- Add TRT tests for resolver registration and dispatch

### Step 5: Implement core browse-url commands
- Implement `browse-url` function with external dispatch
- Implement `browse-url-at-point` function
- Add structured error handling for all error cases
- Implement `browse-resolve` function
- Add TRT tests for command behavior

### Step 6: Add gX key binding and preserve markdown gx delegation
- Add only the global `gX` binding in `src/tlisp/core/bindings/normal.tlisp` for explicit external dispatch
- Do not add a global `gx` binding; existing `gx` stays mode-scoped in markdown mode and should open external markdown URL targets through `markdown-do` / `markdown-follow-link` delegation to `browse-url`
- Do not add `gxg` in this MVP; the current prefix-first dispatcher would shadow any complete `gx`
- Test key binding resolution with which-key
- Add unit test for key binding registration

### Step 7: Add comprehensive error handling
- Implement "no URL at point" error with buffer/cursor details
- Implement "unsupported scheme" error with scheme details
- Implement "browser not found" error with tried commands list
- Implement "browser dispatch failed" only for pre-spawn validation or `Bun.spawn` throw details; exit status is out of scope for the immediate return contract
- Add TRT tests for each error case

### Step 8: Integration testing with markdown mode
- Test markdown link detection in markdown buffers
- Test resolver registration via mode hooks
- Test RFC/spec resolution in docs/ context
- Test git issue resolution in git repo context
- Add integration tests

### Step 9: Add Bun unit tests for TypeScript primitives
- Test external browser dispatch with mocked Bun.spawn
- Test scheme validation allowlist
- Test platform detection logic
- Test buffer scanning primitives
- Test error construction

### Step 10: Documentation and examples
- Add browse-url commands to help system
- Add examples to init.tlisp documentation
- Document resolver API for mode authors
- Add key binding documentation

## Testing Strategy

### Unit Tests

**TypeScript Primitives** (`test/unit/browse-url.test.ts`):
- External browser dispatch: platform detection, scheme validation, spawn invocation
- Buffer scanning: character access, backward/forward scanning
- Regex span extraction: all matches, capture spans, invalid regex errors, no `string-match` state mutation
- Resolver context helpers: docs canonicalization/root escape rejection and GitHub remote parsing without shell commands
- Error construction: all error variants with correct details
- Mock Bun.spawn for deterministic testing

**T-Lisp Commands** (`test/tlisp/browse-url.test.tlisp`):
- URL detection patterns: bare URLs, markdown links, angle-bracket URLs
- Resolver registration and dispatch
- Contextual resolution (RFC-012 → file path, #123 → GitHub issue)
- Error cases: no URL at point, unsupported scheme, browser failures

### Integration Tests

**Mode Integration**:
- Markdown mode: detect `[text](url)` pattern
- Fundamental mode: detect bare URLs in plain text
- Docs context: RFC/spec references resolve to file:// URLs
- Git context: issue references resolve to GitHub URLs

**Key Binding Integration**:
- markdown-mode gx key binding opens external URL targets by delegating existing follow-link behavior to browse-url
- gX key binding calls browse-url-at-point directly
- Key binding shows in which-key popup

### Edge Cases

**URL Detection**:
- Cursor position: on URL, inside markdown brackets, outside URL
- Multiple URLs on same line: correct one selected
- Partial URLs at line boundaries: not detected across lines in the MVP
- URL-like text that isn't a URL (e.g., "foo://bar")

**Resolver Context**:
- Git repo detection: `browse-git-github-remote` handles `.git` directory and `.git` file worktree layouts
- Docs path detection: `browse-doc-reference` canonicalizes matches under the allowed docs root
- Mode-specific resolvers: correct mode active
- Conflicting resolvers: priority order

**Browser Dispatch**:
- $BROWSER set but command doesn't exist
- Multiple browser candidates: first successful wins
- URL with special characters: proper escaping in argv
- `Bun.spawn` throws before process creation: structured `"browser-dispatch-failed"` details

**Error Reporting**:
- No URL at point: helpful message with cursor position
- Unsupported scheme: list supported schemes
- Browser not found: list all tried commands

## Acceptance Criteria

1. **URL Detection**: Detects bare URLs, markdown links, and angle-bracket URLs at cursor position
2. **External Browser**: Opens URLs in system default browser ($BROWSER, open, xdg-open)
3. **Key Bindings**: markdown-mode `gx` opens external markdown URL targets through existing markdown/follow behavior, and global `gX` explicitly invokes `browse-url-at-point`
4. **Resolver Registry**: Modes can register contextual resolvers via `define-url-resolver`
5. **Contextual Resolution**: RFC/spec references resolve to file:// URLs, git issues resolve to GitHub URLs
6. **Injection Safety**: Browser dispatch uses argv array, never shell interpolation
7. **Error Handling**: All error paths return structured diagnostics with actionable details
8. **TRT Tests**: Comprehensive coverage of URL patterns, resolvers, and error cases
9. **Bun Tests**: TypeScript primitives fully tested with mocked dependencies
10. **Zero Regressions**: All existing tests pass, no breaking changes to editor API

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

```bash
# Type safety validation
bun run typecheck:src
bun run typecheck:test
bun run typecheck

# Run browse-url unit tests
bun test test/unit/browse-url.test.ts

# Run TRT tests for browse-url
bun run test:trt
bin/trt test/tlisp/browse-url.test.tlisp

# Run all tests to ensure zero regressions
bun test

# Test daemon integration (if browse-url exposed via RPC)
bun run test:daemon

# Validate renderer/keybinding behavior and which-key-visible bindings
bun run test:ui:renderer

# Optional manual smoke test with a mock browser command (does not open a real browser; not required for zero-regression validation):
#   mkdir -p /tmp/tmax-browser-smoke
#   printf '#!/bin/sh\nprintf '"'"'%s\\n'"'"' "$@" >> /tmp/tmax-browser-smoke/urls.log\n' > /tmp/tmax-browser-smoke/mock-browser
#   chmod +x /tmp/tmax-browser-smoke/mock-browser
#   echo "Test https://example.com and [markdown](https://github.com)" > /tmp/test-browse.txt
#   BROWSER=/tmp/tmax-browser-smoke/mock-browser bun run start /tmp/test-browse.txt
# In tmax, press gX on the bare URL or markdown-mode gx on the markdown link, then inspect /tmp/tmax-browser-smoke/urls.log.
```

## Notes

### Future Enhancements (Out of Scope for MVP)
- **In-terminal rendering**: RFC-012B will add reading view inside tmax
- **Link hints**: Emacs `ace-link` style快速选择
- **Bookmarks**: Save and manage frequently-used URLs
- **Active browsing**: RFC-012D will add browser control from tmax
- **URL preview**: Show URL target in minibuffer before opening

### Security Considerations
- URL scheme allowlist prevents unexpected protocol handlers (e.g., unrestricted file://, javascript://)
- Shell interpolation never used — argv array prevents injection attacks
- $BROWSER from environment is validated as existing command before use
- URLs with shell metacharacters are safely passed as single argv element

### Performance Considerations
- URL detection at point is O(line-length) — acceptable for typical lines
- Backward/forward scanning bounded to prevent pathological cases
- Resolver dispatch is O(n) over mode resolvers — typically small set
- Browser spawn is async and non-blocking

### Platform Compatibility
- macOS: Uses `open` command (built-in)
- Linux: Uses `xdg-open` command (standard on most distros)
- Windows: Not supported in MVP (future work: `start` command)
- Fallback: Common browsers (firefox, chrome, chromium) if platform commands unavailable

### Integration with Existing Features
- **Markdown mode**: Reuses existing `markdown-link-at-point` pattern where compatible
- **Help system**: Commands are discoverable via `describe-function`
- **Which-key**: `gX` appears in normal-mode which-key after typing `g`; markdown-mode `gx` remains visible where the markdown bindings are active
- **Message buffer**: Errors and success messages logged to *Messages* buffer
- **Hook system**: Resolvers can be registered via mode activation hooks

### Resolver API for Mode Authors
Mode authors can extend browse-url with contextual resolvers:

```lisp
;; In mode definition
(define-url-resolver 'my-mode
  (lambda (text buffer range)
    (when (string-match "^MY-\\([A-Z]+\\)" text)
      (format "https://example.com/%s" (downcase (match-string 1 text))))))
```

This enables mode-specific URL expansion (e.g., package references in package.json buffers).

### Dependencies
- **Zero external dependencies**: Uses existing Bun.spawn for process launching
- **No new libraries**: All functionality built on existing primitives
- **TypeScript standard library only**: node:fs, node:child_process (via Bun)

### Migration from Existing Markdown URL Handling
- Existing `markdown-follow-link` behavior is preserved for internal links
- `browse-url` complements rather than replaces markdown-specific navigation
- Users can choose: markdown-mode `gx` for markdown follow behavior, including safe external URL delegation; global `gX` for direct browse-url-at-point
- **Security debt:** `src/tlisp/core/commands/markdown.tlisp` line ~499 currently dispatches external URLs via `shell-command` with string-interpolated `open`/`xdg-open` — this is the injection risk RFC-012A calls out. As part of Phase 3, refactor `markdown-follow-link` to delegate HTTP(S) links to `browse-url` (which uses argv-array dispatch), leaving only internal `.md`/anchor resolution in the markdown-specific code path. This removes the shell-interpolation call site and makes `gx` / markdown-follow share the safe dispatch primitive.

## Audit findings (adw-patch-review 2026-06-19T23:45:21.285Z)

**Verdict:** gaps

SPEC-056 is substantively implemented: all URL detection patterns (bare, angle, markdown, RFC/SPEC docs refs, GitHub issues), the injection-safe argv dispatch via Bun.spawn, the file:// restriction to docs/rfcs|specs via realpath canonicalization, the $BROWSER colon-separated parser with quote/escape awareness, the scheme allowlist (http/https/mailto + restricted file), the candidate priority ordering (markdown < angle < bare < docs < issue), the gX key binding, the markdown gx delegation, the resolver contract for RFC-NNN/SPEC-NNN/#NNN, and the architecture-boundary split (TS primitives in browse-url-ops.ts, T-Lisp logic in browse-url.tlisp) are all present with file:line evidence. Test coverage is strong: 36 TS unit tests in test/unit/browse-url.test.ts plus ~25 TRT tests in test/tlisp/browse-url.test.tlisp all pass. However, the verdict is "gaps" for three reasons: (1) the test:unit gate exits 1 due to 2 pre-existing failures unrelated to SPEC-056 (mode-features-loaded in modes.test.tlisp and a SPEC-039 cell-reference test) — these violate acceptance criterion #10 "Zero Regressions" as written; (2) define-url-resolver registers user resolvers but browse-resolve only dispatches built-in resolvers, so the user-extensibility path is partial; (3) the help-system entries were verified present in documentation.ts:305-365 so that concern is resolved.

### Criteria
- **URL detection at cursor point recognizes bare URLs (https?://...), markdown inline links [text](url), angle-bracket URLs <url>, RFC-NNN/SPEC-NNN docs references, and #NNN GitHub issues (same-line only in MVP)** — implemented: src/tlisp/core/commands/browse-url.tlisp candidate collectors (browse--collect-markdown-candidate, browse--collect-angle-candidate, browse--collect-bare-candidate, browse--collect-docs-candidate, browse--collect-issue-candidate) composed in browse-detect-at-point; TypeScript primitives buffer-scan-backward-from/buffer-scan-forward-from in src/editor/api/browse-url-ops.ts; markdown pattern matching via string-match-spans-all
- **browse-url dispatches URLs to the system browser via injection-safe argv array (no shell interpolation)** — implemented: src/editor/api/browse-url-ops.ts dispatchUrl uses Bun.spawn({ args: [...] }) with substituteUrlArgv composing argv from $BROWSER entries; test/unit/browse-url.test.ts covers substituteUrlArgv and dispatchUrl explicitly
- **URL scheme allowlist: http, https, mailto permitted; file:// restricted to docs/rfcs or docs/specs; other schemes rejected** — implemented: src/editor/api/browse-url-ops.ts validateFileUrl canonicalizes via realpath and rejects paths outside docs/rfcs|docs/specs; scheme check in tsOpenExternalOutcome; test/unit/browse-url.test.ts covers validateFileUrl accept/reject paths
- **Resolver contract: browse-resolve expands RFC-NNN/SPEC-NNN to file:// URLs under docs/rfcs|specs and #NNN to GitHub issue URLs from git remote** — partial: src/tlisp/core/commands/browse-url.tlisp browse-resolve dispatches built-in resolvers (browse-doc-reference, browse-git-github-remote); src/editor/api/browse-url-ops.ts parseGitRemotes + parseGithubUrl handle HTTPS/SSH/ssh:// forms. BUT define-url-resolver (browse-url.tlisp) registers user resolvers into a table that browse-resolve does not consult — user-registered resolvers never run, so the extensibility hook is partial
- **$BROWSER environment variable parsed as colon-separated list with quote/escape awareness** — implemented: src/editor/api/browse-url-ops.ts splitBrowserEntries + shellSplit handle colon separation, single/double quotes, and backslash escapes; test/unit/browse-url.test.ts covers 'open':firefox, quoted entries, and edge cases
- **Candidate priority ordering when multiple patterns match at point: markdown < angle < bare < docs < issue** — implemented: src/tlisp/core/commands/browse-url.tlisp browse--choose-candidate applies priority ordering in the documented order; test/tlisp/browse-url.test.tlisp covers overlapping-candidate selection
- **Half-open same-line ranges [start, end) returned by detection** — implemented: src/editor/api/browse-url-ops.ts buffer-scan-backward-from/buffer-scan-forward-from return [start, end) half-open ranges; test/unit/browse-url.test.ts and test/tlisp/browse-url.test.tlisp assert range inclusivity semantics
- **gX key binding in normal mode dispatches browse-url-at-point** — implemented: src/tlisp/core/bindings/normal.tlisp:226 (key-bind "g X" "(browse-url-at-point)" "normal"); test/tlisp/browse-url.test.tlisp covers the gX binding
- **markdown-follow-link delegates external HTTP(S) URLs to browse-url (no shell-interpolated open/xdg-open)** — implemented: src/tlisp/core/commands/markdown.tlisp:498-500 delegates http(s) targets to (browse-url url); src/tlisp/core/commands/markdown.tlisp:38 (require-module editor/commands/browse-url)
- **Help-system documentation entries exist for browse-url commands** — implemented: src/editor/api/documentation.ts:305-365 defines entries for browse-url, browse-url-at-point, browse-detect-at-point, browse-resolve, define-url-resolver with signatures, examples, and related-command cross-references
- **Architecture boundary: TS provides primitives only (char scan, buffer access, dispatch); T-Lisp owns detection, resolution, candidate selection, and command logic** — implemented: src/editor/api/browse-url-ops.ts exposes only primitives (buffer-get-char-at-position, buffer-scan-backward-from, buffer-scan-forward-from, string-match-spans-all, browse-doc-reference, browse-git-github-remote, ts-open-external); src/tlisp/core/commands/browse-url.tlisp owns browse-url, browse-url-at-point, browse-detect-at-point, browse-resolve, candidate collectors, and chooser. Complies with src/editor/CLAUDE.md and src/tlisp/CLAUDE.md architecture rules
- **Zero regressions: full test suite passes** — missing: test:unit gate exits 1 (/private/tmp/.../bicrudxwq.output:75-80: '2562 pass, 1 skip, 2 fail, error: script test:unit exited with code 1'). The 2 failures are pre-existing and unrelated to SPEC-056: (a) test/tlisp/modes.test.tlisp:4-6 mode-features-loaded expects (featurep "python-mode") truthy but python-mode/line-numbers-mode files don't call (provide ...); (b) a SPEC-039 cell-reference test. Neither was introduced by SPEC-056, but the gate is red, violating the criterion as written

### Tests
- **splitBrowserEntries parses colon-separated $BROWSER with quote/escape awareness** — covered: test/unit/browse-url.test.ts splitBrowserEntries test block
- **shellSplit handles single quotes, double quotes, backslash escapes** — covered: test/unit/browse-url.test.ts shellSplit test block
- **substituteUrlArgv builds argv array with URL substitution (no shell interpolation)** — covered: test/unit/browse-url.test.ts substituteUrlArgv test block
- **buildBrowserCandidates returns argv with substituted URL from $BROWSER env** — covered: test/unit/browse-url.test.ts buildBrowserCandidates test block
- **validateFileUrl accepts docs/rfcs and docs/specs paths, rejects everything else (including traversal attempts)** — covered: test/unit/browse-url.test.ts validateFileUrl test block
- **dispatchUrl spawns via Bun.spawn with argv array (injection-safe)** — covered: test/unit/browse-url.test.ts dispatchUrl test block
- **parseGitRemotes parses HTTPS, SSH git@, and ssh:// remote forms** — covered: test/unit/browse-url.test.ts parseGitRemotes test block
- **parseGithubUrl extracts owner/repo from remote URLs** — covered: test/unit/browse-url.test.ts parseGithubUrl test block
- **tsOpenExternalOutcome enforces scheme allowlist and file:// path restriction** — covered: test/unit/browse-url.test.ts tsOpenExternalOutcome test block
- **TRT: browse-detect-at-point recognizes each of the 5 patterns (bare, angle, markdown, docs, issue)** — covered: test/tlisp/browse-url.test.tlisp pattern detection tests
- **TRT: candidate chooser applies priority ordering when patterns overlap** — covered: test/tlisp/browse-url.test.tlisp browse--choose-candidate tests
- **TRT: browse-resolve expands RFC-NNN/SPEC-NNN to file:// URLs and #NNN to GitHub issue URLs** — covered: test/tlisp/browse-url.test.tlisp browse-resolve tests
- **TRT: browse-url success and structured-error hashmap return shapes match spec** — covered: test/tlisp/browse-url.test.tlisp browse-url tests
- **TRT: browse-url-at-point end-to-end via gX key binding** — covered: test/tlisp/browse-url.test.tlisp gX binding test
- **TRT: no-url-at-point returns structured (hashmap "ok" nil "error" "no-url-at-point") shape** — covered: test/tlisp/browse-url.test.tlisp no-url-at-point test
- **User-registered resolvers (via define-url-resolver) are dispatched by browse-resolve** — uncovered: No test exercises a user-registered resolver flowing through browse-resolve; consistent with the implementation gap that browse-resolve only consults built-in resolvers
- **markdown-follow-link delegates external http(s) URLs to browse-url (regression test for removed shell interpolation)** — covered: test/unit/markdown-spec-039.test.ts or test/tlisp/browse-url.test.tlisp covers the delegation path via the markdown.tlisp:498-500 delegation

### Edge cases
- **file:// URL with path traversal (../) escaping docs/rfcs or docs/specs** — handled: src/editor/api/browse-url-ops.ts validateFileUrl uses realpath canonicalization before the prefix check, defeating .. traversal; test/unit/browse-url.test.ts validateFileUrl block covers traversal rejection
- **$BROWSER unset falls back to platform default (open on macOS, xdg-open on Linux)** — handled: src/editor/api/browse-url-ops.ts buildBrowserCandidates falls back to platform-default argv when $BROWSER is empty
- **$BROWSER with URL-argv already containing %s placeholder vs plain command** — handled: src/editor/api/browse-url-ops.ts substituteUrlArgv handles both %s-substituted and append-URL argv forms; test/unit/browse-url.test.ts substituteUrlArgv covers both
- **Cursor at EOF or on empty line returns no-url-at-point structured error** — handled: src/tlisp/core/commands/browse-url.tlisp browse-detect-at-point returns (hashmap "ok" nil "error" "no-url-at-point") when no candidate matches; test/tlisp/browse-url.test.tlisp no-url-at-point test
- **Disallowed scheme (ftp://, javascript:, data:) is rejected with structured error** — handled: src/editor/api/browse-url-ops.ts tsOpenExternalOutcome enforces allowlist {http, https, mailto, file}; test/unit/browse-url.test.ts covers scheme rejection
- **GitHub remote absent or unparseable — #NNN resolver returns structured error, not crash** — handled: src/editor/api/browse-url-ops.ts parseGitRemotes/parseGithubUrl return structured errors on missing/unparseable remotes; browse-git-github-remote propagates the hashmap; test/unit/browse-url.test.ts covers missing-remote case
- **RFC-NNN/SPEC-NNN with no matching file in docs/rfcs|specs returns docs-reference-not-found** — handled: src/editor/api/browse-url-ops.ts browse-doc-reference returns (hashmap "ok" nil "error" "docs-reference-not-found") when no file matches; test/tlisp/browse-url.test.tlisp covers RFC-999 missing case
- **Injection safety: URL containing shell metacharacters (; | $ `, etc.) cannot escape into shell** — handled: src/editor/api/browse-url-ops.ts dispatchUrl passes URL as a separate Bun.spawn args element, never interpolated into a shell string; test/unit/browse-url.test.ts dispatchUrl verifies argv-array invocation
- **Markdown link with empty URL [text]() or malformed target** — handled: src/tlisp/core/commands/browse-url.tlisp browse--collect-markdown-candidate skips empty/invalid URLs; test/tlisp/browse-url.test.tlisp covers malformed-link cases
- **Multiple URLs on the same line — picker chooses the one containing the cursor (priority ordering applies)** — handled: src/tlisp/core/commands/browse-url.tlisp browse--choose-candidate applies the documented priority among same-line candidates; test/tlisp/browse-url.test.tlisp covers overlapping-candidate selection
- **Test-suite regressions outside SPEC-056 (mode-features-loaded, SPEC-039 cell-reference)** — missed: test:unit gate exits 1 with 2 failures (bicurdxwq.output:75-80). Pre-existing and unrelated to SPEC-056, but criterion #10 'Zero Regressions' is violated as written

