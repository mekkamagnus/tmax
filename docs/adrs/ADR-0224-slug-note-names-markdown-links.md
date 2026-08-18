# ADR-0224: SPEC-121 — slug note names + portable markdown links, rendered compact

- **Status**: accepted
- **Date**: 2026-08-18
- **Issues**: #200
- **Spec**: [SPEC-121](../specs/SPEC-121-slugify-note-names.md)

## Context

The user's vault was accumulating shell-hostile filenames (`fresh idea
(2026).md`) because both creation paths used typed text verbatim, and wiki
link syntax is non-portable markdown. Confirmed design with the user: the
FILE holds the full standard markdown link; the DISPLAY shows the link text
with NO brackets; applies to creation going forward; existing wiki-links
untouched. (This supersedes the first SPEC-121 draft's `[[slug|display]]`
alias approach — which would have needed alias-splitting in every follow
path that standard links get for free.)

## Decision

Four pieces, each at the narrowest layer:

1. **`markdown-note-slug`** (T-Lisp, exported): the proven
   `markdown-anchor-slug` recipe (downcase, `[^a-z0-9]+`→`-`, edge-dash
   trim) applied PER PATH SEGMENT (`sub/New Idea` → `sub/new-idea`);
   already-clean names pass byte-identical; all-punctuation falls back to
   the raw segment. `markdown-slugify-set` toggles (module defvars are not
   set!-able — ADR-0168 pattern), default ON.
2. **`markdown-write-note-template`**: slug PATH, typed-name template/H1,
   and NEVER overwrites an existing file (fixes a pre-existing silent
   clobber; dedup semantics instead).
3. **Creation wiring writes markdown links**: the SPEC-120 finder's accept
   REPLACES the recorded `[[` with `[<typed>](<target>)`; the SPEC-116 gx
   create branch rewrites its link the same way before opening. Existing
   notes link to the scan path made dir-relative
   (`markdown-relative-note-path`).
4. **Render + health**: `transformWikiLine` compacts `[label](target)` to
   the label (zero-width delimiters, 1:1 label mapping, same
   `wiki-link-display` mode); the SPEC-118 resolver re-tags file-target
   `link` spans resolved/dangling (URLs/mailto/#anchors keep the plain link
   face). Follow needed NOTHING — `gx` on inline links was already
   BUG-76-hardened.

## Consequences

- New notes are portable anywhere; the vault's reading view stays compact
  and shows link health (`[t](missing.md)` dims).
- **En-route fix (discovered live)**: typing `(` in ANY completing-read
  showed "No match" — orderless components are JS RegExps, an invalid one
  wiped the pool (`regexpSpansOf`'s catch returned no spans). Invalid regex
  patterns now degrade to LITERAL matching (`src/tlisp/stdlib.ts`) — the
  entire completion system is hostile-input-proof, not just the finder.
- Mixed-format vaults are first-class: wiki-links and markdown links
  compact, resolve, and follow identically.
- Suites with shared on-disk vaults must clean up created files (a test's
  `marcketing.md` silently un-dangled a later test's link — caught, fixed).
- Toggle-off restores the exact legacy `[[name]]` + verbatim-filename
  behavior (pinned by test).
- Suites: wiki-link-complete 22/22, follow-create 27/27, display 20/20,
  faces 12/12, orderless 13/13, render trio green; typecheck clean. Live
  mekkapi transcript in the spec (compact display, slug file, typed H1, gx
  follows).
