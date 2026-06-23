# Chore: tmax-use dogfood slice — cross-repo modal edit → save → disk assertion

## Chore Description

Build a **vertical slice** that proves the workflow: an agent drives tmax via
tmax-use to author a real file using genuine modal gestures (append, open-line,
insert, escape, write), saves it, and asserts the **on-disk** file changed.

This is the first run of an unproven workflow, so the slice is intentionally
narrow: one file authored in the `../weibo-assistant` repo tree through modal
editing, with the on-disk proof as the headline. Real edits to weibo-assistant's
empty source files (`summarizer.ts`, `ideaGen.ts`, `drafts.ts`) and the broader
MVP build are explicitly **out of scope** — decided after seeing how the slice
feels.

Two deliverables:

1. **A small tmax-use runner extension** so a YAML playbook can assert against
   a file on disk — the capability tmax-use is currently missing (every existing
   `expect` field is in-buffer or on-screen; `setup_file` writes fixtures but
   nothing reads a file back). New expect field: `file_contains`, an object with
   `path` (relative to the tmax project root, `${VAR}`-substituted) and `text`.
2. **A YAML playbook** that opens a scratch file inside the weibo-assistant repo
   tree, authors a small function via modal gestures, saves with `:w`, and
   asserts the on-disk file contains the authored text.

The slice targets a **scratch file**
(`../weibo-assistant/src/services/_tmax_slice_scratch.ts`) rather than a real
empty source file, so the playbook is repeatable: `setup_file` writes it fresh
each run and `cleanup: true` deletes it after. This exercises the cross-repo
open boundary (the headline of the workflow) without corrupting weibo-assistant
source on re-runs.

## Relevant Files
Use these files to resolve the chore:

- **`tmax-use/test/playbook.ts`** — YAML playbook parser + Validation-based
  linter. Defines `PlaybookAssert` (line ~40), `ASSERT_KEYS` (line ~86), and
  `validateAssert` (line ~140). The new `file_contains` field is added here:
  type field, allow-key, and a type-check that it's a mapping with string
  `path` + string `text`.
- **`tmax-use/test/runner.ts`** — test runner. `evaluateExpect` (line ~354)
  resolves each `PlaybookAssert` field against the live frame/host. The new
  `file_contains` branch goes here: `${VAR}`-resolve `path`, `fs.readFile` the
  file (already imported at line 19), substring-check `text`, push an outcome.
  Mirrors the structure of the `result_contains` branch (line ~413).
- **`test/unit/tmax-use/playbook.test.ts`** — parser unit tests. Add cases for
  `file_contains` accepted (valid mapping) and rejected (wrong shape / missing
  field / wrong type).
- **`test/unit/tmax-use/runner.test.ts`** — runner unit tests. Add cases for
  `evaluateExpect` passing when the file contains `text` and failing when it
  does not (or the file is absent).
- **`tmax-use/playbooks/README.md`** — playbook schema docs. Document
  `file_contains` in the Expect fields table so future playbook authors know it
  exists.
- **`tmax-use/src/keys.ts`** — read-only reference. Confirms `<Enter>` parses
  to `\r` (so multi-line insert via `o...<Esc>` works) and modal key sequences
  (`A`, `o`, `i`, `:w<CR>`) dispatch through the headless JSON-RPC path. No
  changes here.

### New Files

- **`tmax-use/playbooks/weibo-slice.yaml`** — the slice playbook. Opens
  `../weibo-assistant/src/services/_tmax_slice_scratch.ts` (fresh empty file via
  `setup_file`), authors `export function summarize(text: string) { ... }` using
  `A` (append) + `o` (open-below) + insert + `<Esc>`, saves with `:w<CR>`, and
  asserts `file_contains` on the saved file. `cleanup: true` deletes it after.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Verify the cross-repo open resolves correctly

Before building the choreography on top of it, confirm that a playbook `open:`
and `setup_file` with a `../weibo-assistant/...` relative path resolve against
the tmax project root (not the daemon's working directory). Write a one-off
scratch playbook that opens an empty file across the boundary and asserts
`line_text: ""` with the cursor on the first line (or capture to confirm it's
empty). Do not use `buffer_contains: ""`; every string contains the empty
string. If the relative path does NOT resolve, fall back to an absolute path in
`weibo-slice.yaml` and note this in the Notes section. Either way, delete the
probe afterward.

### Step 2: Add `file_contains` to the playbook type and validator

- In `tmax-use/test/playbook.ts`, add to `PlaybookAssert`:
  ```ts
  readonly file_contains?: { readonly path: string; readonly text: string };
  ```
- Add `'file_contains'` to the `ASSERT_KEYS` set.
- In `validateAssert`, handle `file_contains` inside the existing known-field
  type-check loop before the generic non-cursor string branch; otherwise the
  generic branch will also reject a valid `{ path, text }` mapping as
  `file_contains must be a string`. When `k === 'file_contains'`, require it to
  be a mapping with string `path` and string `text`; push clear errors otherwise
  (e.g.
  `${label}: file_contains.path must be a string`,
  `${label}: file_contains must be a mapping with path and text`). Mirror the
  precision of the existing field checks.

### Step 3: Evaluate `file_contains` in the runner

- In `tmax-use/test/runner.ts` `evaluateExpect`, add a new branch after the
  `screen_not_contains` branch (before the final `return`):
  - Resolve `${VAR}` references in `expect.file_contains.path` via the existing
    `resolveVars(value, ctx)` helper (line ~165).
  - Resolve that substituted path through
    `resolveProjectPath(path, ctx.options.projectRoot ?? DEFAULT_PROJECT_ROOT)`
    before reading it, so non-absolute `file_contains.path` values follow the
    documented schema and are relative to the tmax project root.
  - `fs.readFile` the resolved absolute path as utf-8. If the read throws (file
    absent), push an outcome
    `{ pass: false, detail: 'file_contains: could not read <path>: <err>' }`.
  - Substring-check `text`. Push
    `{ pass: ok, detail: 'file_contains: <text> ... found | NOT found in <path>' }`.
  - Use `TaskEither.from(async () => ...)` so the read composes with the
    existing `chain` (the branch is async, unlike `result_contains`). The async
    callback must return `rightE<void>(undefined)` after pushing the assertion
    outcome; reserve `leftE(...)` for transport-level failures only. Do not
    return a raw `void` or raw outcome from `TaskEither.from`.

### Step 4: Unit tests for the parser

- In `test/unit/tmax-use/playbook.test.ts`, add cases:
  - `file_contains` with valid `{ path, text }` parses successfully.
  - `file_contains` that is not a mapping is rejected.
  - `file_contains` missing `path` or `text` is rejected.
  - `file_contains.path` / `.text` that are non-strings are rejected.
- Run `bun test test/unit/tmax-use/playbook.test.ts` — green.

### Step 5: Unit tests for the runner

- In `test/unit/tmax-use/runner.test.ts`, add cases using
  `__runnerInternals.evaluateExpect`:
  - Writes a temp file containing `export function summarize`, calls
    `evaluateExpect` with `file_contains: { path: <tempfile>, text: 'export function summarize' }`
    → outcome `pass: true`.
  - Same file, `text: 'nope'` → outcome `pass: false`.
  - `path` pointing at a non-existent file → outcome `pass: false` with a
    readable detail.
- Run `bun test test/unit/tmax-use/runner.test.ts` — green.

### Step 6: Write the slice playbook

- Create `tmax-use/playbooks/weibo-slice.yaml` with the choreography from the
  approved design:
  ```yaml
  name: weibo-assistant slice (cross-repo modal edit → save → disk)
  description: |
    Vertical slice: open a scratch file in the weibo-assistant repo tree from a
    tmax daemon, author a small function via modal gestures (A append, o
    open-below, i insert, <Esc>), save with :w, and assert the file on disk
    contains the authored text via the new file_contains expect field.
    setup_file writes the scratch file fresh and cleanup deletes it, so this
    playbook is repeatable and CI-safe.
  setup:
    - action: setup_file
      var: TARGET
      name: ../weibo-assistant/src/services/_tmax_slice_scratch.ts
      content: ""
  steps:
    - name: open the scratch file across the repo boundary
      open: ${TARGET}
    - name: append a function signature at end of line (A → insert mode)
      keys: "Aexport function summarize(text: string) {<Esc>"
      expect:
        buffer_contains: "export function summarize"
    - name: open a line below + insert the body (o → insert mode)
      keys: "o    return text;<Esc>"
      expect:
        buffer_contains: "return text;"
    - name: close the brace on the next line (o → insert mode)
      keys: "o}<Esc>"
      expect:
        buffer_contains: "}"
    - name: write the buffer to disk via the command line
      keys: ":w<CR>"
    - name: the file on disk now contains the authored function
      expect:
        file_contains:
          path: ${TARGET}
          text: "export function summarize(text: string)"
  cleanup: true
  ```
- If Step 1 found the relative path does not resolve, use the absolute path
  `/Users/mekael/Documents/programming/typescript/weibo-assistant/src/services/_tmax_slice_scratch.ts`
  in both `setup_file.name` and `open` / `file_contains.path`, and record the
  finding in Notes.

### Step 7: Document `file_contains` in the playbook README

- In `tmax-use/playbooks/README.md`, add a row to the Expect fields table:
  `| file_contains | {path,text} | File on disk at path contains text (post-save check) |`
- Add a one-line note under the table that `path` is resolved against the
  tmax project root and supports `${VAR}` substitution.

### Step 8: Run typecheck + the full validation suite

- Run the Validation Commands below. Every command must pass with zero errors.
- Confirm after the `tmax-use` run that
  `../weibo-assistant/src/services/_tmax_slice_scratch.ts` does NOT exist
  (cleanup worked cross-repo).

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run typecheck:src` — source typecheck, zero errors.
- `bun run typecheck:test` — test typecheck, zero errors.
- `bun run typecheck` — full project typecheck, zero errors.
- `bun test test/unit/tmax-use/playbook.test.ts` — new `file_contains` parser
  tests pass.
- `bun test test/unit/tmax-use/runner.test.ts` — new `file_contains` runner
  tests pass.
- `bun test test/unit/tmax-use/` — full tmax-use unit suite, no regressions.
- `bin/tmax-use tmax-use/playbooks/weibo-slice.yaml` — the slice playbook passes,
  exit 0; the final `file_contains` step confirms the on-disk file changed.
- `test ! -e ../weibo-assistant/src/services/_tmax_slice_scratch.ts` — cleanup
  worked cross-repo after the playbook run.

## Notes

- **Why a scratch file, not the real empty sources.** The real
  `summarizer.ts` / `ideaGen.ts` / `drafts.ts` are empty (0 bytes) today and
  are the intended target of the post-slice dogfood build. But a playbook that
  edits real source is not repeatable — re-runs append again and dirty the
  weibo-assistant tree. The scratch file under the same `src/services/` path
  exercises the cross-repo boundary (the whole point) while staying CI-safe via
  `setup_file` + `cleanup`.
- **Why `file_contains` over `file_equals`.** Substring is enough to prove
  "the file on disk changed," robust to incidental trailing-newline or
  whitespace differences in how the buffer serializes. Exact equality would be
  brittle for a first slice.
- **Cross-repo path resolution risk.** The runner resolves `setup_file.name`
  and `open:` against the tmax project root (`resolveProjectPath`, line ~170),
  so `../weibo-assistant/...` should resolve. Step 1 verifies this empirically
  before the rest of the choreography is built on it; if it fails, the fallback
  is an absolute path (loses relative-path purity, keeps the slice honest).
- **Why only `A`/`o`/`i`, no `dd`/`cw` operators.** The slice keeps moving parts
  minimal for the first run of an unproven workflow. Operators (delete-line,
  change-word) are added in the post-slice build once the basic open→edit→save
  →disk loop is confirmed.
- **Out of scope (post-slice).** Real edits to weibo-assistant's empty sources,
  operators, multi-buffer work, `deno check`/tests on authored code, the 4–6
  file MVP. These are a separate effort decided after this slice lands.
