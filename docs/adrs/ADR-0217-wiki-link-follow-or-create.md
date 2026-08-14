# ADR-0217 — Wiki-link follow-or-create: dedup prompt over completion plumbing (#185 / SPEC-116)

## Status

Accepted

## Context

Following a `[[wiki-link]]` to a missing note dead-ended ("Wiki link target
not found"), and nothing nudged near-miss typos toward existing notes —
every half-remembered name mints an orphan. SPEC-116 asks for Obsidian-style
follow-or-create: resolve-or-create at follow time, with the dedup check
folded into the follow, plus the completion-at-point plumbing a future
inline layer (RFC-026) reuses verbatim.

Two methodology constraints shaped the design: (1) a follow is occasional,
deliberate, command-like — the minibuffer (the M-x machinery reused
wholesale via `completing-read`) is the right surface, not a popup;
(2) creation is always an EXPLICIT `+ Create:` candidate, never inferred
from a non-match, so typos cannot mint junk notes.

## Decision

Three-layer plumbing, all behind `markdown-follow-wiki-link`'s miss branch:

1. **`markdown-vault-notes` TS primitive** (`src/editor/api/file-ops.ts`) —
   recursive `.md` scan of the current buffer's dir → `{name, path}` list,
   sorted by name; empty for unsaved buffers. Filesystem fact ⇒ TS, per the
   architecture rule. On-demand per prompt — the cached index the popup
   needs is RFC-026 scope.
2. **T-Lisp ranking + table** (`knowledge.tlisp`) —
   `markdown-note-rank` (2 substring > 1 prefix > 0, via
   `string-match-spans-all`'s `(PATTERN TEXT)` + its `{ok, matches}` hashmap
   shape), bucket-concat ranking that preserves the scan's alphabetical
   order within equal ranks (`markdown-rank-note-names` — pure, exported),
   and `markdown-note-completion-table` emitting PROPER candidate hashmaps
   (`value/display/annotation/spans/metadata`) — the completion machinery
   `hashmap-set`s spans on candidates, so raw strings are not valid.
3. **`markdown-resolve-dispatch (target choice)`** — the unit-testable core
   (no prompt): choose-existing opens + rewrites the `[[…]]` at point to the
   canonical name (`markdown-wiki-link-range-at-point` +
   `buffer-replace-range`); choose-create persists via `write-file-content`
   THEN `find-file-open` (find-file-open is a no-op for missing files);
   replays `#heading`/`#^block` suffixes on open. `markdown-resolve-prepare`
   splits state-priming from the prompt so tests + a future capf drive the
   dispatch without `completing-read`.

Conventions hit along the way (each cost a test iteration): the fixture's
sync interpreter does not resolve string-name higher-order calls
(`mapcar`/`stable-sort` predicates) — all list work is explicit loops;
module defvars are not `set!`-able from outside — hence the exported
prepare function; every `markdown-*` defun must be exported by exactly one
feature module (CHORE-44 AC11.2) and both the markdown-fns baseline
(`.chore44-baseline/markdown-fns.txt`, regenerated: 96→113) and the
API-name inventory (408→409, + `markdown-vault-notes`) are re-baselined.

## Consequences

- **Easier:** dangling links never dead-end; typo links get repaired at the
  source; the vault-scan + ranking + dispatch are standalone, tested units
  the RFC-026 popup layer calls verbatim.
- **Easier:** the dedup prompt surfaces near-miss notes (substring over
  prefix over alphabetical) before creation is offered.
- **Harder:** two more frozen inventories to re-baseline when markdown
  commands change (markdown-fns.txt + api-names-static.txt + the hardcoded
  counts in editor-api-registry.test.ts and markdown-module-boundaries.test.ts).
- **Deferred (RFC-026):** inline popup, capf sources, cached vault index +
  invalidation, typing-time hooks — explicitly out of scope here.

## Verify-gate findings (retry 1 — all addressed)

The adversarial gate caught two blocking gaps + a PRE-EXISTING bug, all fixed:

1. **Regex-metachar targets crashed the prompt** — the ranking fed the raw
   target to `string-match-spans-all`, which compiles it as a JS RegExp
   (`[[note(v2]]` → error). Now `string-contains-p` (plain substring) —
   the same unescaped-re-embed lesson as the indent-engine bug.
2. **Nested-dir create failed silently** — `markdown-create-note-for` only
   mkdir'd the buffer's dir; now mkdirs the FULL note dirname
   (`[[sub/new-note]]` with a missing `sub/` creates it).
3. **Follow-guard rework (empirically justified, mechanism unproven)**:
   an instrumented run showed the old `(not (string-match …))` guards
   failing in practice (`resolved` reached `file-exists-p` with no `.md`
   appended, so extension-less `[[wiki-file]]` links hit the miss branch).
   The gate correctly notes `string-match` returns nil on no-match
   (tlisp-api.ts:1157), so the simple "always false" story is wrong — the
   precise mechanism remains undiagnosed. Replaced with boolean predicates
   (`string-contains-p` / `string-prefix-p`), which are unambiguous and
   verified end-to-end by a real extension-less follow test. (Retry-2 gate
   also caught `return` vs `continue` in the vault-walk's directory skip —
   `return` truncated the whole scan; fixed + tested.)
4. Link rewrite now preserves `#heading` suffixes; duplicate note names
   resolve to the first (sorted) path; the vault walk skips `.git` and
   `node_modules`.
