# Feature: Note creation writes portable markdown links with slug filenames, rendered compact

## Feature Description

When a note is CREATED from a typed name — via the `[[` finder's `+ Create`
candidate (SPEC-120) or the `gx` follow-or-create prompt (SPEC-116) — two
things change:

1. **The filename is slugified** (kebab-case): `fresh idea (2026)` becomes
   `fresh-idea-2026.md`, never `fresh idea (2026).md`. Parens, quotes,
   apostrophes, slashes — shell/URL/filesystem-hostile characters cannot
   reach the filesystem. The created note's H1 keeps the human title
   (`# fresh idea (2026)`).
2. **The link written into the buffer is a standard markdown link**:
   `[fresh idea (2026)](fresh-idea-2026.md)` — portable to GitHub, Obsidian,
   and every markdown renderer. No `[[...]]` lock-in for new links.

And the reading experience stays compact: tmax's renderer (the SPEC-119
transform family) now also compacts INLINE markdown links —
`[text](url)` displays as `text` (link face, **no brackets**, consistent
with how `[[wiki-links]]` already render). What you SEE is `fresh idea
(2026)`; what's IN the file is the full portable link. Existing wiki-links
in the vault are untouched and keep rendering as they do today.

Creation is collision-safe: if `slug.md` already exists it is never
overwritten — the link points at the existing note (dedup, SPEC-116
philosophy). `markdown-write-note-template` gains the same no-overwrite
guard (today a create silently CLOBBERS an existing note — pre-existing
data-loss hazard).

## User Story

As a markdown-journal writer
I want note creation to produce safe kebab-case files linked with standard
markdown links, displayed compactly without brackets
So that my vault is portable to any renderer, my filesystem stays
shell-friendly, and my reading view stays clean.

## Problem Statement

1. Both creation paths use the typed string verbatim as a filename:
   `[[Bob's idea (v2!)]]` → `Bob's idea (v2!).md`. Apostrophes break shell
   globbing, parens break shell commands, spaces break every pipeline.
2. `markdown-write-note-template` has no existence check — creating an
   existing name overwrites the note.
3. Wiki-links are non-standard markdown: a vault of `[[...]]` renders as
   plain text everywhere outside tmax/Obsidian.
4. The renderer compacts `[[wiki-links]]` (SPEC-119) but not inline
   `[text](url)` links — if creation writes markdown links, they'd render
   with their full syntax without a matching display transform.

## Solution Statement

- **Slug (T-Lisp, pure)**: `markdown-note-slug` — downcase → `[^a-z0-9]+`→`-`
  → trim edge dashes (the proven `markdown-anchor-slug` recipe);
  already-clean names pass through byte-identical; empty-slug fallback to
  the raw trimmed name.
- **No-overwrite creation**: `markdown-write-note-template` slugs the PATH,
  keeps the typed name for the template, and returns the existing path
  without writing when the file is already there.
- **Markdown-link completion (SPEC-120)**: the finder's accept REPLACES the
  typed `[[` (position already recorded in `markdown-complete-line/col`)
  with `[<typed>](<slug>.md)`; cursor lands after the `)`.
- **Markdown-link rewrite (SPEC-116)**: the gx create branch rewrites the
  `[[...]]` at point to `[<typed>](<slug>.md)` (mirroring the
  existing-choice rewrite).
- **Compact inline-link rendering**: extend the SPEC-119 display transform
  (`wiki-display.ts`) so `[text](url)` renders as `text` with the link
  face — delimiters `[`, `](url)` zero-width (same column-mapping rules:
  visible text 1:1). Gated by the SAME `wiki-link-display` minor mode (one
  toggle for compact link rendering; the name stays for continuity).
- **Link health for file links**: extend the SPEC-118 resolver to inline
  links whose target is a relative file path (`[t](note.md)` →
  resolved/dangling face; `http(s)`/`#anchor`/mailto stay plain link face)
  so newly created links keep the visual dangling feedback wiki-links have.
- **Follow**: NOTHING new — `gx` already follows `[text](file.md)` inline
  links (the BUG-76-hardened `markdown-link-at-point` path).

## Relevant Files

Use these files to implement the feature:

- `src/tlisp/core/commands/markdown/knowledge.tlisp` — `markdown-note-slug`
  (new, exported), `markdown-write-note-template` (slug + no-overwrite),
  `markdown-complete-accept` (markdown-link insert replacing the typed `[[`),
  `markdown-resolve-dispatch` create branch (link rewrite).
- `src/frontend/render/wiki-display.ts` — inline-link compaction in
  `transformWikiLine` (+ its activation predicate gains nothing — same mode).
- `src/syntax/wiki-link-faces.ts` + `src/syntax/highlight-buffer.ts` —
  re-tag `link` spans (file targets) resolved/dangling via the existing
  resolver; `computeHighlightSpans` already passes it through.
- `test/unit/wiki-link-complete.test.ts`, `test/unit/wiki-link-follow-create.test.ts`
  — creation-path tests extend.
- `test/unit/wiki-link-display.test.ts` — inline-link compaction tests.

### New Files

(none)

## Implementation Plan

### Phase 1: Foundation — slug + no-overwrite creation

- `markdown-note-slug` with the table of cases below; unit tests.
- `markdown-write-note-template`: slug path, typed-name template, exists →
  return path without writing. Unit tests (content survives, H1 keeps the
  typed name, path returned both ways).

### Phase 2: Creation writes markdown links

- `markdown-complete-accept`: replace the recorded `[[` span with
  `[<typed>](<slug>.md)` via `buffer-replace-range` (the recorded
  line/col + 2), cursor after `)`, insert mode.
- `markdown-resolve-dispatch` create branch: same replacement at the
  `markdown-wiki-link-range-at-point` span.
- Toggle defvar `markdown-slugify-note-names` (default t): off → today's
  verbatim wiki-link behavior.
- Tests: dangerous name → slug file + markdown link in buffer; clean name →
  `[name](name.md)`; toggle off → legacy `[[name]]`.

### Phase 3: Compact rendering + link health

- `transformWikiLine` also matches `\[([^\]]*)\]\(([^)]*)\)` (skip matches
  inside code spans per the existing backtick/§protection); display text =
  the `[...]` label only; zero-width `[` and `](url)`; spans re-mapped
  (the whole link span collapses onto the label, keeping the link face).
- Resolver: a `link` span whose parsed target is a relative non-URL path →
  resolved/dangling classification (reuse the SPEC-116 rule: `.md` append,
  dir-relative); http(s)/#/mailto untouched.
- Tests: `[t](u)` renders `t` link-faced no brackets; file-target dim when
  missing, full when present; cursor mapping over the label; wiki-link
  behavior unchanged (existing 18 tests stay green).

### Phase 4: Live e2e

- mekkapi tab: type `[[Fresh Idea (2026` → Enter on `+ Create` → buffer
  SHOWS `Fresh Idea (2026)` (compact), file on disk is `fresh-idea-2026.md`,
  `gx` follows it; `ls` the vault; capture-pane transcript into this spec.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: `markdown-note-slug`

**User Story**: As a vault owner, I want one tested rule turning any typed
name into a safe filename, shared by every creation path.

- Implement + export; slug table tests.

**Acceptance Criteria**:
- [x] `fresh idea (2026)`→`fresh-idea-2026`; `Bob's idea (v2!)`→`bob-s-idea-v2`;
      `2026-08-08`→`2026-08-08`; `brand new thought`→`brand-new-thought`;
      `  spaced  `→`spaced`; all-punctuation → raw trimmed fallback.
- [x] Already-clean names byte-identical (existing journal dates unaffected).

### Step 2: no-overwrite `markdown-write-note-template`

**User Story**: As a journal writer, I want creating an existing name to
link to my note, not destroy it.

- Exists guard + tests (pre-existing content survives; new-file path
  unchanged; H1 uses the typed name).

**Acceptance Criteria**:
- [x] Existing content unchanged; returned path correct in both cases.

### Step 3: markdown-link creation wiring

**User Story**: As the reporter, I want the typed `[[` to become a portable
markdown link to a slug file, displayed compactly.

- SPEC-120 accept + SPEC-116 create-branch rewrite per Phase 2; toggle
  defvar; tests for all three cases + cursor/mode after accept.

**Acceptance Criteria**:
- [x] `+ Create: fresh idea (2026)` → buffer `[fresh idea (2026)](fresh-idea-2026.md)`,
      file `fresh-idea-2026.md`, H1 `# fresh idea (2026)`, cursor after `)`,
      insert mode.
- [x] Clean name → `[brand-new-thought](brand-new-thought.md)`.
- [x] Toggle off → today's `[[name]]` + verbatim filename.
- [x] gx dangling-create rewrites the link the same way.

### Step 4: compact inline-link render + file-link health

**User Story**: As a reader, I want markdown links to render like wiki-links
— text only, link face, dim when the file is missing.

- Phase 3 transforms; render + resolver tests; existing display suite green.

**Acceptance Criteria**:
- [x] `[t](u)` renders `t`, link face, no brackets, under the SAME
      `wiki-link-display` toggle (off shows raw).
- [x] `[t](missing.md)` dims; `[t](2026-08-08.md)` full; `[t](https://x)`
      plain link face.
- [x] Wiki-link display tests (18) unchanged; cursor mapping pinned.

### Step 5: verification + live e2e

**Acceptance Criteria**:
- [x] Wiki cluster + render trio + typecheck green.
- [x] Live mekkapi transcript committed (Phase 4 sequence).

## Testing Strategy

### Unit Tests
- Slug table; no-overwrite; markdown-link accept/rewrite forms; toggle-off
  legacy; inline-link compaction (text/face/no-brackets/cursor); file-target
  dim/full classification; http/#/mailto untouched; code-span protection
  for inline links.

### Integration Tests
- Full SPEC-120 cycle with a dangerous name: trigger → accept → file +
  buffer + render assertions in one test.

### Edge Cases
- All-punctuation name (raw fallback); Unicode slugs to empty (raw
  fallback, documented); slug collision with a different existing note
  (dedup link, no overwrite); label containing `]`-adjacent syntax;
  empty-label `[]()` renders raw; links inside inline code; multi-link
  lines; existing spacey filenames untouched (creation-only change).

## Acceptance Criteria

- [x] Creating from a name with spaces/parens/quotes writes a kebab-case
      `.md`; hostile characters never reach the filesystem.
- [x] The buffer holds `[<typed>](<slug>.md)`; tmax displays `<typed>`
      (link face, no brackets) under the existing `wiki-link-display` mode.
- [x] H1 of the new note is the typed name.
- [x] `gx` follows the created link (existing inline-link path — no new
      follow code).
- [x] Existing notes never overwritten by a create.
- [x] `[t](missing.md)` renders dim; `[t](note.md)` full; URLs unaffected.
- [x] Toggle off restores today's verbatim wiki-link creation.
- [x] Wiki cluster + render trio + typecheck green; live transcript here.

## Validation Commands

- `bun run typecheck`
- `bun test test/unit/wiki-link-complete.test.ts
  test/unit/wiki-link-follow-create.test.ts
  test/unit/wiki-link-display.test.ts
  test/unit/syntax/wiki-link-faces.test.ts
  test/unit/markdown-follow-link.test.ts`
- `bun test test/unit/render-visual.test.ts test/unit/capture-frame.test.ts`
- Live (mekkapi tab): Phase 4 sequence; `ls ~/Documents/md-journal` for the
  slug file; pane capture into this spec.

## Notes

- **Design confirmation (user, 2026-08-18)**: display shows the link text
  with NO brackets; the FILE holds the full `[text](target)` markdown link;
  applies to links created going forward — existing wiki-links untouched.
- **Why this beats the wiki-alias form** (the prior SPEC-121 draft):
  standard-markdown portability, zero new follow plumbing (inline links
  already follow via `gx`), and no alias-splitting work in at-point/follow.
- The `[[`-finder TRIGGER stays (the habit is the point) — only what it
  INSERTS changes; the typed `[[` is replaced by the full link (its
  position was already recorded for exactly this kind of rewrite).
- The inline-link regex `\]\(([^)]*)\)` and the slug regex `[^a-z0-9]+`
  are both in the string layer's PROVEN forms; avoid escaped-bracket-
  adjacent multi-char classes (BUG-74/120 notes).
- Dangling markdown links get no follow-or-create prompt yet (gx messages;
  the finder's `+ Create` is the creation path) — natural follow-up.
- `markdown-rename-note` / `markdown-new-from-template` slugification:
  follow-ups (creation paths only, as asked).
- No TS syntax-layer changes beyond the resolver hook; everything else is
  T-Lisp + the existing render transform.

## Live e2e transcript (mekkapi tab, herdr pane w2:p3, 2026-08-18)

```
# link-test.md, G then A (INSERT at EOL), type [ then [ :
Link to:                                      1/5  ← finder opens on 2nd [

# typed: F r e s h   I d e a   ( 2 0 2 6
Link to: Fresh Idea (2026                     1/1
+ Create: Fresh Idea (2026
--M-X--   link-test.md   L5 C3
   ↑ the "(" survives — see the en-route fix below

# Enter:
  5 │Fresh Idea (2026          ← DISPLAY: compact, no brackets, no url
--INSERT--  link-test.md  L5 C39
$ ls ~/Documents/md-journal | grep fresh
fresh idea.md               ← pre-slug era file, untouched
fresh-idea-2026.md          ← the new SLUG file
$ head -1 fresh-idea-2026.md
# Fresh Idea (2026          ← H1 keeps the typed name

# Esc, h×8 (into the link), g x:
  ▼ │# Fresh Idea (2026
--NORMAL--  fresh-idea-2026.md  L1 C1    ← gx follows the created link
```

The buffer's raw text `[Fresh Idea (2026](fresh-idea-2026.md)` is pinned by
the unit tests (`accept: + Create`, toggle-off legacy, gx create-branch
rewrite); the live pane shows its compact rendering.

## En-route fix: invalid-regex completion components (discovered live)

Typing "(" into the finder showed **"No match"** — the orderless matcher
treats each input component as a JS RegExp, and `(2026` is an invalid one;
`regexpSpansOf`'s catch returned [] (no spans → candidate dropped), wiping
the whole candidate pool. Fixed in `src/tlisp/stdlib.ts`: an invalid regex
pattern now degrades to a **literal** span match (spans-level regression in
`orderless-bulk-filter.test.ts`). This hardens every completing-read
against hostile input, not just the finder.

## Implementation notes (2026-08-18)

- Module defvars are not set!-able from outside (ADR-0168): the toggle is
  set via exported `(markdown-slugify-set value)`.
- Link targets for EXISTING notes use the scan's path made dir-relative
  (`markdown-relative-note-path`) — vault-rooted/absolute scan paths would
  otherwise bake absolute paths into links (caught by the tests).
- The gx create-branch rewrite runs BEFORE the create opens the new note
  (the buffer switch would invalidate the at-point range otherwise).
- Test-order hygiene: suites with a shared on-disk vault must clean up
  files they create — a created `marcketing.md` silently turned a later
  test's "dangling" link resolved.
