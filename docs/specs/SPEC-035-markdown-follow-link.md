# Feature: Enhanced markdown-follow-link (org-open-at-point for Markdown)

## Feature Description
Upgrade `markdown-follow-link` and `markdown-do` to handle local file links, anchor links (`#heading`), reference-style links (`[text][ref]` + `[ref]: url`), bare URLs in prose, and link-back navigation. Repoint `gx` from `markdown-follow-link` to `markdown-do` so `gx` becomes the universal "open at point" key — the Markdown equivalent of org-mode's `C-c C-o` (`org-open-at-point`).

## User Story
As a writer working across multiple markdown documents
I want to press `gx` on any link — inline, reference, file path, anchor, or even a bare URL — and have it do the right thing (open file, jump to heading, open URL)
I want to press `gb` to jump back to where I was before following a link
So that navigating markdown documents feels like navigating org-mode

## Problem Statement
`markdown-follow-link` only handles inline links `[text](url)` when the cursor is inside the `(...)` part, and only opens them via the system browser (`open`/`xdg-open`). It cannot:
- Open local file paths (`[see also](./other.md)`) in tmax
- Jump to anchor headings (`[section](#intro)`) within the buffer
- Resolve reference links (`[text][ref]` → look up `[ref]: url` definition)
- Activate when cursor is on the `[text]` portion of a link
- Detect bare URLs in prose (`https://example.com` without markdown wrapping)
- Navigate back after following a link (no position history)

## Solution Statement
1. Rewrite `markdown-follow-link` as a multi-branch resolver that detects the link type and dispatches accordingly.
2. Enhance `markdown-do` to also match when cursor is on the `[text]` part of a link (not just the URL portion), and to detect bare URLs in prose.
3. Add a lightweight position stack (`*markdown-link-ring*`) so `gb` navigates back after following links.
4. Change the `gx` binding from `markdown-follow-link` to `markdown-do`.

All changes are in T-Lisp — no new TypeScript primitives needed. The existing `find-file-open`, `cursor-move`, `buffer-filename`, and `shell-command` primitives cover everything.

## Relevant Files

- `src/tlisp/core/commands/markdown.tlisp` — Contains `markdown-follow-link`, `markdown-do`, and `markdown-insert-link`. All three functions will be modified.
- `src/tlisp/core/modes/markdown-mode.tlisp` — Contains the `gx` keybinding that will be repointed from `markdown-follow-link` to `markdown-do`.
- `src/tlisp/core/commands/find-file.tlisp` — Contains `find-file-open` used to open local file links.
- `test/unit/markdown-follow-link.test.ts` — New test file for link resolution logic.

## Implementation Plan

### Phase 1: Rewrite markdown-follow-link
Expand `markdown-follow-link` into a multi-branch resolver that:
1. Extracts the URL from whatever link type is under point
2. Classifies the URL (external URL, local file, anchor)
3. Dispatches: external → `shell-command open`, local file → `find-file-open`, anchor → `cursor-move`

### Phase 2: Add reference link resolution
Add a helper `markdown-resolve-reference` that scans the buffer for `[ref]: url` definitions and returns the resolved URL.

### Phase 3: Improve markdown-do and rebind gx
- Update `markdown-do` to match links when cursor is on the `[text]` portion
- Add bare URL detection (`https?://...` without `[...]()` wrapping) as a new branch in `markdown-do`
- Change `gx` binding from `markdown-follow-link` to `markdown-do`

### Phase 4: Link-back navigation
Add a global variable `*markdown-link-ring*` (a list of `(buffer-name line col)` triples) and a `markdown-jump-back` command bound to `gb`. Every call to `markdown-follow-link` pushes the current position onto the ring before navigating. `gb` pops the last entry and jumps back.

## Step by Step Tasks

### Add `markdown-link-at-point` helper
- [ ] Create `markdown-link-at-point` that returns the URL target under cursor regardless of link style
  - Try inline link match: `[text](url)` — return `url` if cursor is anywhere inside the `[...]` or `(...)`
  - Try reference link match: `[text][ref]` — resolve via `markdown-resolve-reference`
  - Try bare reference: `[ref]` (shorthand where text == ref)
  - Try bare URL: `https?://[^\s)>]+` — return the URL if cursor is on it
- [ ] Return nil if no link found

### Add `markdown-resolve-reference` helper
- [ ] Given a reference label, scan buffer backward from end for lines matching `^[ref]: url`
- [ ] Return the URL portion (which may be a file path, external URL, or contain an anchor fragment)

### Add `markdown-classify-url` helper
- [ ] If URL starts with `#` → anchor
- [ ] If URL matches `^https?://` or `^ftp://` → external
- [ ] Otherwise → local file path (may also contain a `#fragment` suffix)

### Add `markdown-open-anchor` helper
- [ ] Parse the anchor name (strip `#`, lowercase, replace non-alphanumeric with `-`)
- [ ] Scan buffer headings for a match
- [ ] Jump cursor to the matching heading line

### Add `markdown-open-file-link` helper
- [ ] Strip any `#fragment` suffix from the path
- [ ] Resolve relative paths against `(buffer-filename)` directory
- [ ] Call `find-file-open` with the resolved path
- [ ] If there was a `#fragment`, jump to the anchor in the new buffer

### Rewrite `markdown-follow-link`
- [ ] Call `markdown-link-at-point` to get URL
- [ ] If nil, message "No link found" and return
- [ ] Call `markdown-classify-url` on the URL
- [ ] Dispatch: `external` → `shell-command open`, `anchor` → `markdown-open-anchor`, `file` → `markdown-open-file-link`

### Update `markdown-do`
- [ ] Replace the current link-detection regex to also match when cursor is on the `[text]` part of an inline or reference link
- [ ] Add a new branch for bare URLs: if line contains `https?://` and cursor column is within the URL, call `markdown-follow-link`
- [ ] Keep existing heading-fold and checkbox-toggle branches unchanged

### Rebind `gx`
- [ ] In `markdown-mode.tlisp`, change `gx` from `(markdown-follow-link)` to `(markdown-do)`

### Add link-back navigation
- [ ] Define `*markdown-link-ring*` as a global list (max 20 entries)
- [ ] Add `markdown-push-position` — push `(buffer-name line col)` onto the ring, trim to 20
- [ ] Add `markdown-jump-back` — pop last entry from ring, switch buffer and move cursor
- [ ] Call `markdown-push-position` at the start of `markdown-follow-link` before navigating
- [ ] Bind `gb` to `markdown-jump-back` in markdown-mode

### Add tests
- [ ] Test `markdown-follow-link` with inline external URL
- [ ] Test `markdown-follow-link` with inline file path (`[other](./other.md)`)
- [ ] Test `markdown-follow-link` with anchor link (`[intro](#intro)`)
- [ ] Test `markdown-follow-link` with file + anchor (`[section](./other.md#section)`)
- [ ] Test reference link resolution (`[text][ref]` → `[ref]: url`)
- [ ] Test cursor on `[text]` portion of `[text](url)` triggers follow
- [ ] Test bare URL detection (`https://example.com` in prose)
- [ ] Test `markdown-do` dispatches to `markdown-follow-link` when on link text
- [ ] Test `markdown-do` dispatches to `markdown-follow-link` on bare URL
- [ ] Test `markdown-do` dispatches to fold on heading
- [ ] Test `markdown-do` dispatches to checkbox toggle on checkbox
- [ ] Test `gb` navigates back after `gx`
- [ ] Test `gb` across file links (returns to original buffer and position)
- [ ] Test link ring max size (21st push drops oldest)

### Validate
- [ ] Run type checks and tests

## Testing Strategy

### Unit Tests
- Link extraction: inline, reference, bare reference, bare URL
- URL classification: external, anchor, file path, file+anchor
- Reference resolution: `[ref]: url` lookup
- Anchor heading matching: slugification and heading scan
- Link ring push/pop and max-size trimming

### Integration Tests
- Full `markdown-follow-link` dispatch for each link type
- `markdown-do` context dispatch (link, heading, checkbox, bare URL, nothing)
- `gb` round-trip: follow link then jump back restores position

### Edge Cases
- Cursor on `[text]` portion of `[text](url)` (not just the URL part)
- Bare URL followed by punctuation (`https://example.com.`, `https://example.com)`)
- Bare URL in a list item or blockquote
- Reference link where label contains special characters
- Anchor with mixed case heading
- File link with relative path (`../other.md`)
- File link with `#fragment` after file path
- Multiple reference definitions (first wins)
- Self-referencing circular links (no infinite loop — just open)
- Link on a folded heading (should follow link, not fold)
- `gb` when ring is empty (message "No previous position")
- Link ring overflow (21+ entries drops oldest)

## Acceptance Criteria
1. `gx` on `[text](https://example.com)` opens URL in system browser
2. `gx` on `[other](./other.md)` opens `other.md` in tmax via `find-file-open`
3. `gx` on `[intro](#intro)` jumps cursor to the `# intro` heading
4. `gx` on `[text][ref]` resolves `[ref]: url` and follows it
5. `gx` works when cursor is on the `[text]` portion, not just the URL
6. `gx` on a bare `https://example.com` in prose opens the URL
7. `gx` on a heading line still folds (via `markdown-do` dispatch)
8. `gx` on a checkbox still toggles (via `markdown-do` dispatch)
9. File links with `#fragment` open the file then jump to the anchor
10. `gb` returns to the previous position after following any link
11. `gb` across file links returns to the original buffer at the correct line and column
12. All existing markdown tests pass with no regressions

## Validation Commands
- `bun run typecheck:src` — TypeScript type check
- `bun run typecheck:test` — Test type check
- `bun test test/unit/markdown-follow-link.test.ts` — New link resolution tests
- `bun test test/unit/` — All unit tests pass with zero regressions

## Notes
- This follows the org-mode pattern where `C-c C-o` is context-aware and handles all link types through one entry point
- No new TypeScript primitives needed — `find-file-open`, `buffer-filename`, `cursor-move`, and `shell-command` already exist
- The link ring (`*markdown-link-ring*`) is a simple list of positions, not a full mark-ring. It's scoped to markdown navigation only. A general mark-ring would be a separate feature.
- Reference link resolution scans the whole buffer (reference definitions are conventionally at the bottom). This is fine for markdown files of any reasonable size
- Bare URL detection strips trailing punctuation (`.` `,` `;` `:` `!` `?` `)` `'` `"`) that's unlikely to be part of the URL
