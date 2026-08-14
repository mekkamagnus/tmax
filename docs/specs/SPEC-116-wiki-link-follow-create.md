# Feature: Wiki-link follow-or-create with a follow-time dedup prompt

## Feature Description

Following a `[[wiki-link]]` whose target doesn't exist currently dead-ends
("Wiki link target not found"). Replace that with Obsidian-style
**follow-or-create**, with the duplicate-prevention check folded into the
follow itself:

> `RET` on `[[marcketing]]` → target missing → a minibuffer prompt lists
> existing notes that resemble `marcketing` (the dedup check), with an explicit
> `+ Create new note "marcketing"` candidate. Picking an existing note opens it
> **and rewrites the link at point to the canonical name**; picking create
> makes the note from a template and opens it.

This spec also lays the **completion-at-point plumbing** — the reusable
note-candidate source and the resolve-or-create core — factored so a future
inline-completion layer ([RFC-026](../rfcs/RFC-026-inline-completion-popup.md))
can call the same machinery instead of rebuilding it.

## User Story

As a user writing notes, when I follow a `[[link]]` I haven't created yet, I
want tmax to either connect me to the note I *meant* (if a similar one exists)
or create it cleanly from a template — so my vault converges instead of
fragmenting into typo-orphan notes.

## Problem Statement

`markdown-follow-wiki-link` (knowledge.tlisp:216) resolves the target,
checks `file-exists-p`, and on miss just prints
`"Wiki link target not found: %s"`. Two failure modes:

1. **Dead-end**: referencing a new note is the *normal* act of building a
   wiki; today it errors and the user must manually run
   `markdown-new-from-template`, re-type the name, and come back.
2. **Silent fragmentation**: nothing nudges you toward an existing note when
   you typo or half-remember a name, so every near-miss mints a new orphan —
   and follow-on-create *alone* would make that worse.

## Solution Statement

1. **Vault candidate source (the plumbing)** — a `markdown-vault-notes` TS
   primitive: scan the current buffer's directory tree for `.md` files and
   return `{name, path}` per note (name = filename without extension). This is
   the single source of note candidates that the prompt, the backlinks tooling,
   and a future capf all share.
2. **Completion table** — `markdown-note-completion-table` (T-Lisp): wraps
   vault-notes into `completing-read` candidates (display + annotation). The
   existing minibuffer filter (the M-x machinery) does the fuzzy matching.
3. **Resolve-or-create core (the plumbing)** — `markdown-resolve-or-create`:
   given a dangling target, prompt with candidates ranked by similarity to the
   target, an explicit `+ Create: <name>` entry first; dispatch the choice to
   *open existing* or *create from template*. Factored so a future
   completion-at-point layer calls it with an accepted string directly.
4. **Follow integration** — the missing-file branch of
   `markdown-follow-wiki-link` calls the core instead of messaging.
5. **Link repair** — when an existing note is chosen, rewrite the `[[typed]]`
   text at point to `[[canonical]]` (the dedup payoff: the typo is corrected
   where it lives).

Minibuffer, not popup: a follow is an occasional, deliberate, command-like
act — the right surface is the prompt that already exists. The inline popup
is a separate, later layer (RFC-026).

## Relevant Files

- `src/editor/editor.ts` (or `src/editor/api/`) — `markdown-vault-notes` TS
  primitive (recursive `.md` scan of the current buffer's dir; reuses the
  `fs` module already imported).
- `src/tlisp/core/commands/markdown/knowledge.tlisp` —
  `markdown-note-completion-table`, `markdown-resolve-or-create`,
  `markdown-note-similarity-rank`, and the `markdown-follow-wiki-link`
  missing-file branch; link-rewrite helper.
- `markdown-new-from-template` machinery (template loading +
  `{{date}}`/`{{title}}` substitution) — reused for creation, unchanged.
- `test/unit/wiki-link-follow-create.test.ts` — new.

### New Files
- None beyond the test.

## Implementation Plan

### Phase 1: the plumbing
`markdown-vault-notes` primitive (scan → name+path list) + the completion
table over it. Standalone, tested, no behavior change yet.

### Phase 2: resolve-or-create
The core: prompt (existing notes ranked by similarity to the dangling name +
`+ Create: <name>` first) → open-existing (with link rewrite at point) or
create-from-template (then open). C-g cancels with nothing created and the
buffer untouched.

### Phase 3: follow integration
Swap `markdown-follow-wiki-link`'s miss branch to call the core. Existing-link
follows are untouched.

## Step by Step Tasks

### Task 1: `markdown-vault-notes` primitive
**User Story**: As a future completion source, I want one authoritative list of
note names + paths so every surface agrees on what exists.

- TS primitive: scan the current buffer's directory (recursive) for `.md`;
  return a list of `{name, path}` (name = basename minus `.md`); empty list on
  an unsaved buffer.

**Acceptance Criteria**:
- [ ] Returns name+path for every `.md` under the buffer's dir (recursive).
- [ ] Empty list when the buffer has no file.
- [ ] Unit-tested against a fixture tree.

### Task 2: completion table + ranking
**User Story**: As the prompt, I want candidates pre-ranked so the note the
user *meant* floats to the top.

- `markdown-note-completion-table` — completing-read candidates (display =
  name, annotation = relative path).
- `markdown-note-similarity-rank` — order candidates: substring match on the
  dangling target first, then prefix, then alphabetical.

**Acceptance Criteria**:
- [ ] Table renders every vault note (metadata category).
- [ ] Ranking: substring > prefix > alphabetical, pinned for a given target.
- [ ] Unit-tested.

### Task 3: resolve-or-create core
**User Story**: As a future capf layer, I want one function that turns an
accepted name into open-or-create so the popup (RFC-026) reuses it verbatim.

- `markdown-resolve-or-create (target)` — prompt (Task 2 table +
  `+ Create: <target>` first) → dispatch:
  - existing note → `find-file-open` + rewrite the `[[…]]` at point to the
    canonical name;
  - create → new note from the blank template (`{{title}}` = target) in the
    current file's dir + open it.
- The dispatch step is a separate function taking (target, choice) so it is
  testable without driving the interactive prompt.

**Acceptance Criteria**:
- [ ] Prompt appears with `+ Create: <target>` first, ranked notes after.
- [ ] Choosing an existing note opens it AND rewrites the link text at point.
- [ ] Choosing create produces the file (template expanded) and opens it.
- [ ] C-g: no file created, buffer text unchanged.
- [ ] Dispatch function unit-testable without the prompt.

### Task 4: follow integration
**Acceptance Criteria**:
- [ ] Follow of an existing `[[link]]` behaves exactly as today (no
  regression; heading/block-ref forms still work).
- [ ] Follow of a dangling `[[link]]` opens the prompt.
- [ ] `[[link#heading]]` to a missing file still resolves through the prompt,
  then jumps to the heading once created/opened.

## Testing Strategy

- Unit: vault-notes against a fixture tree (nested dirs, non-md ignored,
  unsaved buffer → empty).
- Unit: ranking order pinned by fixtures.
- Unit: dispatch — choose-existing opens + rewrites the link at point;
  choose-create writes the file with `{{title}}` expanded and opens it;
  cancel touches nothing.
- Regression: `markdown-follow-wiki-link` on an existing target (incl.
  `#heading` / `#^block` forms).

### Edge Cases
- Unsaved buffer (no `buffer-filename`) — follow still prompts; creation
  falls back to the cwd.
- Case differences (`Goals` vs `goals`) — ranking surfaces the sibling so the
  canonical name wins.
- Create-candidate name containing `/` (nested note) — directories created.

## Acceptance Criteria (Completion)
- [ ] Following a dangling `[[wiki-link]]` never dead-ends: it resolves
      (existing + rewrite) or creates (template), or cancels cleanly.
- [ ] The dedup prompt lists similar existing notes with an explicit create
      candidate; picking an existing note rewrites the link at point.
- [ ] `markdown-vault-notes` + the completion table + the resolve-or-create
      dispatch exist as standalone, tested units (the capf plumbing).
- [ ] No regression to existing-link follows, backlinks, or template commands.
- [ ] No popup UI, no typing-time hooks, no index cache (deferred to RFC-026).

## Validation Commands
- `bun run typecheck`
- `bun test test/unit/wiki-link-follow-create.test.ts`
- `bun test test/unit/markdown*.test.ts` (regression)
- Manual: in a note, type `[[typo-of-existing]]`, `RET` → pick the existing
  note → link text is repaired; type `[[brand new]]`, `RET` → create → note
  exists with template content.

## Notes
- Methodology choice (follow-on-action + minibuffer) over completion-at-point:
      a follow is occasional, deliberate, command-like — the prompt is the
      natural surface and reuses the M-x machinery wholesale. Type-time inline
      completion (popup, capf sources, exit-hook, cached index) is specified
      as a proposal in
      [RFC-026](../rfcs/RFC-026-inline-completion-popup.md) and depends on this
      spec's plumbing.
- The dedup prompt deliberately makes creation *explicit* (`+ Create:` as a
  visible candidate) — never inferred from a non-match — so typos can't mint
  junk notes.
- Vault scan is on-demand per prompt (follows are occasional). The cached
  index + invalidation the popup layer needs is RFC-026 scope.
