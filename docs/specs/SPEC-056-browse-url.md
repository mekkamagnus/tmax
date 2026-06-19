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
Implement URL detection at point with multiple pattern recognition (bare URLs, markdown links, angle-bracket URLs), a contextual resolver registry for domain-specific references (RFC-012 → safe `file://` URL, #123 → GitHub issue), and injection-safe external browser dispatch using argv arrays (never shell interpolation). Add exact normal-mode keymap sequences `"g x"` (displayed as `gx`) and `"g X"` (displayed as `gX`), with structured user-level error values for all expected failure modes.

## Relevant Files

### Existing Files to Modify

#### `src/editor/tlisp-api.ts`
- Add `ts-open-external` primitive function for browser dispatch
- Returns `Either.right` with a structured T-Lisp hashmap result; reserve `Either.left` for interpreter/runtime errors
- Handles $BROWSER, open (macOS), xdg-open (Linux) detection
- Validates URL schemes against allowlist (http:, https:, mailto:, and restricted file:)
- Uses Bun.spawn with argv array for injection safety

#### `src/tlisp/core/commands/browse-url.tlisp` (New)
- T-Lisp command library for browse-url functionality
- Functions: browse-url, browse-url-at-point, browse-detect-at-point
- Contextual resolver: browse-resolve
- Resolver registration: define-url-resolver
- Return structured success/error hashmaps with string keys

#### `src/tlisp/core/bindings/normal.tlisp`
- Add `(require-module editor/commands/browse-url)` before any browse-url binding
- Add `"g X"` binding for direct browse-url-at-point dispatch
- Do not add `"g x g"` in this MVP; the current prefix-first dispatcher would shadow the existing complete `"g x"` binding

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

#### `src/editor/api/browse-url-ops.ts`
- Primitives for character-at-position, line-text extraction
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
   - Error reasons: `"unsupported-scheme"`, `"file-url-not-allowed"`, `"browser-not-found"`, `"browser-dispatch-failed"`, `"invalid-browser-template"`

   Async dispatch rule:
   - `ts-open-external` starts the process with `Bun.spawn` and returns immediately with the spawned pid.
   - Immediate `"browser-dispatch-failed"` is only for candidate validation failure or `Bun.spawn` throwing before a process is created.
   - Do not report an exit code in the immediate return value. If an implementation observes `proc.exited` later, it may log a message to `*Messages*`, but that asynchronous status is not part of the `ts-open-external` return contract.

   Browser candidate order and `$BROWSER` parsing:
   - Candidate order is: each valid `$BROWSER` template, platform opener (`open` on macOS, `xdg-open` on Linux), then fallback executables (`firefox`, `google-chrome`, `chromium`, `brave-browser`).
   - `$BROWSER` is parsed as one or more colon-separated command templates. Within each template, split arguments with a small shell-like parser that supports whitespace, single quotes, double quotes, and backslash escaping, but performs no shell expansion.
   - If a template contains `%s` or `%u`, substitute the URL for each placeholder and do not append another URL argument. If it has no placeholder, append the URL as the final argv element.
   - The first argv element must resolve to an executable via absolute path or `PATH`; invalid `$BROWSER` templates are recorded in `"tried"` details and dispatch continues to fallback candidates.

2. **Buffer scanning primitives**: Add character and line access functions:
   - `(buffer-line-text line)` — return line text or nil
   - `(buffer-get-char-at-position line column)` — get character at specific line/column
   - `(buffer-scan-backward-from line column stop-chars max-chars)` — return inclusive start boundary for a same-line scan
   - `(buffer-scan-forward-from line column stop-chars max-chars)` — return exclusive end boundary for a same-line scan
   - `(string-match-spans-all pattern text)` — return all non-overlapping regex matches with capture spans
   - These enable efficient URL pattern detection from T-Lisp

   Primitive contracts:
   - All line/column indexes are zero-based.
   - Line scans never cross line boundaries in the MVP.
   - `buffer-line-text` returns nil for an out-of-bounds line.
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
   - Bare URLs: scan all current-line matches for `https?://[^\s<>()\[\]{}"']+`, then trim trailing `.`, `,`, `;`, `:`, `!`, `?`, and unmatched closing `)`, `]`, `}`
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

1. **Key bindings**: Add normal mode bindings:
   - Existing `"g x"` (`gx`) remains the primary action-at-point sequence and must open external URLs by having `markdown-do`/`markdown-follow-link` delegate URL targets to `browse-url`
   - Add `"g X"` (`gX`) → `(browse-url-at-point)` as the direct external-browser command
   - Do not add `"g x g"` (`gxg`) unless the normal-mode dispatcher first gains complete-binding-versus-prefix disambiguation; with current prefix-first dispatch, `"g x g"` would prevent `"g x"` from executing

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
- Implement `buffer-get-char-at-position` primitive
- Implement `buffer-scan-backward-from` primitive
- Implement `buffer-scan-forward-from` primitive
- Implement `string-match-spans-all` primitive for all-match regex span extraction without mutating `string-match` state
- Implement `browse-doc-reference` and `browse-git-github-remote` primitives for resolver filesystem/git context without shell interpolation
- Add tests for character access and scanning
- Register functions in tlisp-api.ts createEditorAPI

### Step 3: Implement T-Lisp URL detection patterns
- Create `src/tlisp/core/commands/browse-url.tlisp`
- Implement bare URL regex pattern: `https?://[^\s<>]+`
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

### Step 6: Add gx and gX key bindings
- Add `gx` binding in `src/tlisp/core/bindings/normal.tlisp`
- Add `gX` binding for explicit external dispatch
- Do not add `gxg` in this MVP; the current prefix-first dispatcher would shadow `gx`
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
- gx key binding opens external URL targets by delegating existing follow-link behavior to browse-url
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
3. **Key Bindings**: `gx` opens URL at point through existing markdown/follow behavior, and `gX` explicitly invokes `browse-url-at-point`
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

# Manual smoke test (if TUI available)
# 1. Create test file with URLs
echo "Test https://example.com and [markdown](https://github.com)" > /tmp/test-browse.txt
# 2. Open in tmax and press gx on URL
# 3. Verify browser opens with correct URL
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
- **Which-key**: gx/gX appear in which-key popup after typing `g`
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
- Users can choose: `gx` for external browser, markdown commands for internal jumps
- **Security debt:** `src/tlisp/core/commands/markdown.tlisp` line ~499 currently dispatches external URLs via `shell-command` with string-interpolated `open`/`xdg-open` — this is the injection risk RFC-012A calls out. As part of Phase 3, refactor `markdown-follow-link` to delegate HTTP(S) links to `browse-url` (which uses argv-array dispatch), leaving only internal `.md`/anchor resolution in the markdown-specific code path. This removes the shell-interpolation call site and makes `gx` / markdown-follow share the safe dispatch primitive.
