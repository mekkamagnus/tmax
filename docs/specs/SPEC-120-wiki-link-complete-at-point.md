# Feature: `[[` instantly opens the fuzzy vault-note finder (completion-at-point)

## Feature Description

Obsidian-style link autocomplete: in a markdown buffer, the moment the user
types the second `[` of `[[` in insert mode, the minibuffer immediately opens
with the fuzzy vault-note finder — every note in the vault as candidates plus
a dynamic `+ Create: <typed>` entry. Typing filters; Enter completes the link
IN PLACE (`[[chosen-name]]`, cursor after it, still in insert mode); Escape
cancels and leaves the bare `[[` in the buffer, still in insert mode. No gx,
no M-x, no leaving the writing flow.

This is the input-side counterpart of the just-landed wiki cluster:
SPEC-116/117 (follow-or-create via `gx`), SPEC-118 (dim dangling faces),
SPEC-119 (bracket-less rendering). Those all act AFTER a link exists; this
feature makes CREATING the link instant. `markdown-resolve-prepare` was
deliberately split out of the prompt in SPEC-116 "so a future
completion-at-point layer (RFC-026) can drive the dispatch without the
prompt" — this is that layer.

## User Story

As a markdown-journal writer
I want the fuzzy note finder to open the instant I type `[[` in insert mode
So that I can link notes without breaking my writing flow — no separate
command to invoke, and the correct target name is always a few keystrokes away.

## Problem Statement

Today, creating a wiki-link requires either typing the full target name from
memory (typo risk — SPEC-116 exists precisely because `[[marcketing]]`
dead-ends happen) or stopping to run `gx`/M-x after the fact. The vault scan,
similarity ranking, completion table, and accept-dispatch machinery ALL exist
(SPEC-116) but are only reachable through the follow path. The missing piece
is the trigger: fire that machinery from insert mode at the moment the link
begins.

## Solution Statement

Reuse the SPEC-116 completion machinery with a new, insert-mode-specific
prepare/table/accept trio:

- **Trigger** — `insert-char` (insert-entries.tlisp), the existing chokepoint
  that already consults electric-pair-mode: after `buffer-insert key`, when
  key is `[`, the newly-typed char's predecessor is `[`, the major mode is
  markdown, and the `wiki-link-complete` minor mode is active → call
  `markdown-complete-at-point` (which opens the completing-read prompt).
  Both `[` characters stay in the buffer, exactly as typed.
- **Finder** — a completing-read whose table returns `+ Create: <current
  input>` first, then EVERY vault note (the minibuffer's existing input
  filtering does the fuzzy matching — no re-ranking needed; the input is what
  the user is typing right now). Prime it with the same
  `markdown-vault-notes` scan SPEC-116 uses.
- **Accept** — insert `chosen]]` immediately after the typed `[[` (existing
  note: the note's name; `+ Create`: the typed text), `(editor-set-mode
  "insert")`, cursor after the closing `]]`. `+ Create` additionally writes
  the new note from the template (`markdown-create-note-for` minus the
  `find-file-open` — creating must NOT yank the user out of their note; the
  file exists by the next render, so the new link renders resolved per
  SPEC-118 immediately).
- **Cancel** — Escape/C-g in the minibuffer already returns to normal mode
  untouched; the accept wrapper's cancel path restores insert mode and the
  cursor position (the bare `[[` remains, as typed).
- **Toggle** — `wiki-link-complete` minor mode (new,
  `wiki-link-complete-mode.tlisp`), default ON globally, effective only in
  markdown buffers — the exact pattern of `wiki-link-display-mode` (SPEC-119).

## Relevant Files

Use these files to implement the feature:

- `src/tlisp/core/commands/insert-entries.tlisp` — `insert-char`: add the
  `wiki-link-complete` consult after `buffer-insert` (the electric-pair
  pattern, third consumer of the same chokepoint).
- `src/tlisp/core/commands/markdown/knowledge.tlisp` — the new
  prepare/table/accept/insert trio + `markdown-create-note-for` split into
  create-with-open (existing behavior, SPEC-116) and create-only (this
  feature). All SPEC-116 machinery it reuses lives here
  (`markdown-vault-notes`, `markdown-note-candidate`,
  `markdown-note-create-candidate`, `markdown-note-names-of`).
- `src/tlisp/core/modes/wiki-link-complete-mode.tlisp` — **new**: the minor
  mode + interactive toggle functions (copy the
  `wiki-link-display-mode.tlisp` skeleton, including `(interactive)`).
- `src/tlisp/core/bindings/normal.tlisp` — require the new mode module
  (alongside `editor/modes/wiki-link-display`).
- `src/editor/api/mode-ops.ts` — reference only: `(editor-set-mode "insert")`
  is the primitive the accept/cancel handlers call (exists, no change).
- `test/unit/wiki-link-complete.test.ts` — **new**: the test suite.

### New Files

- `src/tlisp/core/modes/wiki-link-complete-mode.tlisp`
- `test/unit/wiki-link-complete.test.ts`

## Implementation Plan

### Phase 1: Foundation (completion trio in knowledge.tlisp)

New module defvars + exported functions, mirroring the SPEC-116 resolve
state shape (module defvars are NOT set!-able from outside → exported
prepare function, same constraint ADR-0168 documented):

- `markdown-complete-notes` / `markdown-complete-line` /
  `markdown-complete-col` — prompt state (vault scan + where the typed `[[`
  begins, for the accept insert).
- `markdown-complete-prepare` — scan the vault, record line/col of the `[[`
  just typed (the trigger passes the position; accept inserts relative to it
  so intermediate minibuffer interaction can't skew the target).
- `markdown-complete-table (input action)` — `metadata` → category
  `tmax-note-complete`; candidates → `+ Create: <input>` (empty input: the
  candidate is omitted — nothing to create yet) then every vault note via the
  existing candidate builders.
- `markdown-complete-accept (choice)` — existing note → insert
  `<choice>]]` at the recorded position, cursor after, insert mode.
  `+ Create: X` → same insert, plus create-note-only (template write, no
  open). Anything else (shouldn't happen) → message.
- `markdown-create-note-for` refactor: extract
  `markdown-write-note-template (name)` (mkdir + template + write, returns
  path); SPEC-116's function calls it then opens; the accept handler calls it
  without opening. SPEC-116 behavior unchanged (its tests must stay green).

### Phase 2: Core Implementation (trigger + mode)

- `wiki-link-complete-mode.tlisp`: minor mode registration, buffer-local +
  global interactive toggles, global ON at load.
- `insert-char`: after the electric-pair block —

  ```elisp
  (if (and (string= key "[")
           (minor-mode-active-p "wiki-link-complete")
           (string= (major-mode-get) "markdown")
           (>= (cursor-column) 2)
           (string= (substring (buffer-get-line (cursor-line))
                               (- (cursor-column) 2)
                               (- (cursor-column) 1))
                    "["))
    (markdown-complete-at-point)
    nil)
  ```

- `markdown-complete-at-point` — the exported entry: prepare, then
  `completing-read` with the new table and accept handler ("Link to: "
  prompt), empty initial input (the user's next keystrokes filter).
- Cancel path: completing-read's C-g/Escape handling returns to normal mode;
  add the mode restore (insert + cursor back after the `[[`) — follow how
  mx-handler cancel currently restores, wrapping in the accept-handler
  contract ADR-0168 defines.

### Phase 3: Integration

- Require the mode module in normal.tlisp.
- Render interplay (no changes needed, verify only): a bare `[[` is not a
  wiki-link token (the regex needs content), so SPEC-119's transform and
  SPEC-118's faces leave the in-progress link alone; the completed link
  immediately gets its resolved/dangling face and bracket-less rendering.
- Keyboard interplay: the prompt is mx-mode input — normal typing (`[`, `]`,
  letters) all go to the minibuffer while it's open; the buffer is not
  touched until accept.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Refactor note creation (no behavior change)
- Extract `markdown-write-note-template` from `markdown-create-note-for`.
- Run `bun test test/unit/wiki-link-follow-create.test.ts` — 26/26 must hold.

### Step 2: The completion trio (knowledge.tlisp)
- Add defvars + `markdown-complete-prepare`, `markdown-complete-table`,
  `markdown-complete-accept` (+ export them in the defmodule export list).
- Unit tests (new file): table returns `+ Create:` first + all notes; empty
  input omits the create candidate; accept on an existing note inserts
  `name]]` at the recorded position and lands in insert mode with the cursor
  after `]]`; accept on `+ Create` inserts AND writes the file without
  opening (assert buffer unchanged + file exists).

### Step 3: The trigger (insert-char + mode file)
- Create `wiki-link-complete-mode.tlisp`; require it in normal.tlisp.
- Add the consult block to `insert-char` AFTER `buffer-insert` (so both `[`
  chars are in the buffer before the prompt opens).
- Unit tests: typing `[[` via `(insert-char "[")` twice in a markdown buffer
  opens the prompt (mode → mx) with the buffer containing `[[`; typing `[`
  after a non-`[` char does NOT prompt; non-markdown buffer does NOT prompt;
  minor mode off does NOT prompt.

### Step 4: Cancel + mode restore
- Escape/C-g from the prompt leaves the buffer exactly as typed (`[[`),
  cursor after it, insert mode.
- Unit test the full cycle: trigger → cancel → still in insert mode → buffer
  contains `[[`.

### Step 5: Accept end-to-end (the money path)
- Unit: trigger → `minibuffer-set-input "goal"` → dispatch Enter → buffer
  contains `[[goals]]`, cursor after, insert mode; the file was NOT switched.
- Unit: trigger → Enter on `+ Create: fresh` → buffer `[[fresh]]` + file
  `fresh.md` exists + buffer NOT switched; the fresh link renders RESOLVED
  (SPEC-118 non-dim face, via a captureFrame render assertion — the file
  is written before the next render).

### Step 6: Regression sweep + live e2e
- `bun run typecheck`, `bun run typecheck:test`.
- `bun test test/unit/wiki-link-follow-create.test.ts
  test/unit/wiki-link-display.test.ts test/unit/syntax/wiki-link-faces.test.ts
  test/unit/markdown-follow-link.test.ts test/unit/wiki-link-complete.test.ts`
- Render trio: `bun test test/unit/render-visual.test.ts
  test/unit/capture-frame.test.ts test/unit/viewport-scroll-wrap.test.ts`
- **Live e2e in the mekkapi tab** (herdr pane w2:p3, one keystroke at a time
  — bursts drop): open link-test.md, `i`, type `[`, type `[` → pane shows the
  "Link to:" prompt with vault candidates; type `20` (filters to
  2026-08-08/2026-08-15); Enter → pane shows `[[2026-08-08]]` completed
  in place, --INSERT--, cursor after `]]`. Capture the pane (ANSI) at each
  step for the spec transcript.
- Also verify SPEC-119 rendering of the completed link live (bracket-less,
  link face) and that a cancel leaves `[[` + insert mode.

## Testing Strategy

### Unit Tests
- Table: `+ Create:` ordering, empty-input omission, all-notes coverage,
  metadata category.
- Prepare: records the `[[` position; vault scan rooted at the buffer's dir
  (reuse the SPEC-116 vault fixture pattern).
- Accept: existing-note insert + cursor + insert-mode; create-candidate
  insert + file written + NO buffer switch; heading-suffix targets N/A here
  (finder is name-only — note in docstring).
- Trigger: fires only on `[` preceded by `[`, markdown buffers, minor on.
- Cancel: buffer unchanged, insert mode, cursor after `[[`.

### Integration Tests
- Full cycle via `handleKey`/`insert-char` (not just direct fn calls) for
  trigger → filter → accept.
- Render assertion post-accept: completed link has the SPEC-118 face and the
  SPEC-119 bracket-less display.

### Edge Cases
- `[[` typed at column 0 (col-2 substring must not underflow — the `>= 2`
  guard).
- `[[` at end-of-line vs mid-line (insert position math).
- Typing `[` `[` as the start of a NORMAL markdown link `[[text](url)` —
  v1 accepts this cost (the prompt opens; Escape dismisses; user continues).
  Document as known tradeoff; a smart suppression (code spans, existing-link
  interiors) can layer later.
- Empty vault (no .md siblings): the table is create-candidate-only.
- Cancel then immediately typing more `[` — re-trigger works (state
  re-primed each time).
- Existing SPEC-116 flows (gx dangling prompt) unchanged.

## Acceptance Criteria

- [x] In a markdown buffer with the minor mode on (default), typing the
      second `[` of `[[` in insert mode opens the vault-note completing-read
      within the same keystroke — no additional command.
- [x] The finder lists every vault note plus `+ Create: <typed input>`
      (LAST — retry 1 correction; omitted while input is blank); typing
      filters the list.
- [x] Enter on an existing note completes the link in place
      (`[[name]]`), leaves the cursor after `]]`, and stays in insert mode;
      no buffer/file switch occurs.
- [x] Enter on `+ Create: X` completes `[[X]]` in place AND writes `X.md`
      from the template WITHOUT opening it. **Retry-1 correction:** the
      file exists by the next render, so the fresh link renders RESOLVED
      immediately (not dangling as first written here).
- [x] Escape/C-g leaves the bare `[[` in the buffer, insert mode, cursor
      after `[[`.
- [x] Non-markdown buffers, and markdown buffers with the minor mode off,
      never trigger.
- [x] SPEC-116's follow-or-create behavior and tests unchanged (26/26).
- [x] **Live e2e in the mekkapi tab**: the full type-`[[`-pick-Enter cycle
      verified by reading the pane; transcript committed into this spec.
- [x] `bun run typecheck` + all wiki/markdown/render suites green.

## Validation Commands

- `bun run typecheck` — src + test projects clean
- `bun test test/unit/wiki-link-complete.test.ts` — the new suite green
- `bun test test/unit/wiki-link-follow-create.test.ts
  test/unit/wiki-link-display.test.ts test/unit/markdown-follow-link.test.ts
  test/unit/syntax/wiki-link-faces.test.ts` — the wiki cluster, zero regressions
- `bun test test/unit/render-visual.test.ts test/unit/capture-frame.test.ts` —
  render pipeline unchanged
- `bun run test:tmax-use` — e2e playbooks (pre-existing baseline)
- Live: the mekkapi-tab cycle from Step 6 (pane transcript into this spec)

## Notes

- This is RFC-026's completion-at-point layer arriving via the wiki-link use
  case; the prepare/table/accept split is deliberately the SPEC-116 shape so
  OTHER completion-at-point sources (headings? tags?) can copy it.
- No new TS primitives needed — `editor-set-mode`, `buffer-replace-range`,
  `completing-read`, and the vault scan all exist. This is pure T-Lisp
  (architecture rule: editor logic in T-Lisp, TS primitives only).
- BUG-81 (SPC ; flaky live) does NOT affect this feature — the trigger is
  insert-mode typing, not a leader chord. But if live e2e shows the
  completing-read prompt not opening, suspect the same input-tokenization
  family before suspecting this code.
- Known v1 tradeoff (documented, not fixed): `[[text](url)` — typing `[[`
  opens the prompt even when a normal-link was intended; Escape costs one
  keystroke. Smart suppression (inside-code-span check via the highlight
  spans, existing-link interior) is a natural follow-up once BUG-82's fence
  spans exist.

## Live e2e transcript (mekkapi tab, herdr pane w2:p3, 2026-08-15)

```
# line 4 of link-test.md, cursor at EOL (A → INSERT, "WikiC" lighter visible):
$ herdr pane send-text "["   →  line renders "…dangling[" (no prompt)
$ herdr pane send-text "["   →  SAME KEYSTROKE:
Link to:                                        1/5
2026-08-08
2026-08-15
fresh idea
link-test
wiki-demo
--M-X--    link-test.md    L4 C37

# type the filter into the minibuffer:
$ for ch in 2 0 2 6 - 0 8 - 0 8 …
Link to: 2026-08-08                             2/2
+ Create: 2026-08-08
2026-08-08

# Down (select the note, not create), Enter:
  4 │see brand new thought dangling2026-08-08   ← link completed IN PLACE;
                                                 SPEC-119 hides the brackets
--INSERT--  link-test.md  L4 C49                ← still INSERT, cursor after ]]

# proof the completed link is well-formed: Escape, h×5 (into the link), g x:
  ▼ │# 2026-08-08                              ← gx FOLLOWS the fresh link
--NORMAL--  2026-08-08.md  L1 C1
```

The `+ Create` accept (inserts `X]]` + writes `X.md` WITHOUT opening) is
unit-verified (`accept: + Create` test, temp vault) — not exercised live to
avoid minting junk notes in the real journal.

## Implementation notes (2026-08-15)

- Cancel needed NO new code: `completing-read` records `return-mode`
  (insert) and `minibuffer-cancel` restores it — the cursor never moved
  (right after the typed `[[`).
- `require-match t`: Enter only accepts a listed candidate; the + Create
  entry (present for any non-empty input) keeps creation reachable, and raw
  unmatched text can never silently link nothing.
- Electric-pair guard: the trigger requires the char AT the cursor not be
  `]` — with electric-pair-mode on, `[[` yields `[[\]]` and completing
  inside that would double the closing brackets.
- Fixture note: `setupMdEditor` does not run auto-mode — markdown buffers
  in tests need an explicit `(major-mode-set "markdown")` (same discovery
  as SPEC-119's live-vs-fixture differences).

## Gate retry 1 corrections (2026-08-15)

- **`+ Create` moved LAST** (was first): Enter on a non-exact input accepts
  the first listed candidate, so notes-first means a typo (`goal` + Enter)
  completes to the fuzzy best match (`goals`) and + Create takes a deliberate
  Down — or, for a genuinely-new name, is the only match left so plain Enter
  creates. SPEC-116's "typos cannot mint junk notes" philosophy now holds
  here too. (The live transcript shows Down before Enter because create was
  first at the time; the ordering fix removes the need.)
- **Blank-input guard**: the create candidate is omitted for
  whitespace-only input as well (`" "` used to mint the literal file " .md").
- **Finder candidates are annotated from the FINDER's scan**
  (`markdown-complete-path` over `markdown-complete-notes`) — the candidate
  builder no longer reads SPEC-116's `markdown-resolve-notes` defvar, which
  was never primed here (empty — or stale after a gx prompt) annotations.
- **Post-accept render assertion added**: the completed link renders
  bracket-less (SPEC-119) with the link face (SPEC-118) — now unit-pinned,
  not just live-transcript.
- **Electric-pair interplay documented precisely**: with electric-pair-mode
  ON the finder is fully disabled (the guard suppresses `[[`-before-`]`),
  and even with it off, `[[` typed immediately before a pre-existing literal
  `]` in the text does not trigger (the guard cannot distinguish an
  electric-inserted `]` from a typed one). Both accepted: electric-pair is
  off by default and the second case is self-inflicted text.

## Live ordering re-verification (retry 2, mekkapi tab, 2026-08-15)

Re-ran the finder with the retry-1 create-LAST ordering live:

```
$ … A then [ then [ :
Link to:                    1/5
2026-08-08 / 2026-08-15 / fresh idea / link-test / wiki-demo

$ typed filter "2026-08-08":
Link to: 2026-08-08         1/2
2026-08-08          ← NOTE first
+ Create: 2026-08-08        ← create LAST

$ Enter (NO Down):
  4 │see brand new thought dangling2026-08-08   ← completed to the NOTE
--INSERT--  link-test.md  L4 C49
```

The earlier transcript's Down-before-Enter was the pre-retry create-first
ordering; with create-LAST, plain Enter picks the fuzzy best match —
verified live above.
