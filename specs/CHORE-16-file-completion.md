# Chore: Wire file completion table into find-file

## Chore Description

`find-file` passes `"minibuffer-empty-table"` to `completing-read`, which always returns an empty candidate list. The result: typing `SPC f` (or whatever invokes find-file) shows no filesystem candidates at all. The `directory-files` and `read-dir` primitives exist but nothing bridges them into a completion table.

We need to:
1. Create a T-Lisp `file-completion-table` function that calls `directory-files` to list entries for the directory portion of the current minibuffer input
2. Add a `file` marginalia annotator showing file type/size
3. Update `find-file` to use the new table instead of `minibuffer-empty-table`
4. Add tests

## Relevant Files

- `src/tlisp/core/commands/find-file.tlisp` — the broken command; change table from `"minibuffer-empty-table"` to `"file-completion-table"`
- `src/tlisp/core/completion/minibuffer.tlisp` — defines `minibuffer-empty-table`; reference for table protocol (dispatches on `"metadata"` vs `"all-completions"`)
- `src/tlisp/core/completion/completion.tlisp` — defines `completion-table-dispatch`, `completion-all-completions`; shows how tables are called
- `src/tlisp/core/completion/marginalia.tlisp` — register a `"file"` annotator for file candidates
- `src/tlisp/core/commands/buffers.tlisp` — reference implementation for a working completion table (`buffer-completion-table`)
- `src/tlisp/core/commands/execute-extended-command.tlisp` — another reference table
- `src/tlisp/io-ops.ts` — `directory-files` builtin (line 112): takes a path string, returns list of `"name"` or `"name/"` for dirs
- `src/tlisp/stdlib.ts` — `string-split`, `string-prefix-p`, `substring`, `concat` available for T-Lisp path parsing

### New Files

- `src/tlisp/core/completion/file-table.tlisp` — new module with `file-completion-table` and `file-completion-candidate`
- `test/unit/file-completion.test.ts` — unit tests for find-file completion

## Step by Step Tasks

### Create `file-table.tlisp` completion table module

- Create `src/tlisp/core/completion/file-table.tlisp`
- Define `file-completion-candidate` that takes a name string and returns a hashmap with `"value"`, `"display"`, `"annotation"`, `"spans"`, `"metadata"` fields
- Define `file-completion-table (input action)`:
  - On `"metadata"` action: return `(hashmap "category" "file")`
  - On `"all-completions"` action:
    1. Parse the input to extract directory and prefix: if input contains `/`, split on last `/` to get `dir-part` and `file-prefix`; otherwise `dir-part` is `"."` and `file-prefix` is the full input
    2. Call `(directory-files dir-part)` to get entries
    3. Filter entries by `file-prefix` using `string-prefix-p`
    4. For each matching entry, prepend `dir-part` + `"/"` to build full-path value (unless dir-part is `"."` and entry is relative)
    5. Map results through `file-completion-candidate`
- Export `file-completion-table` and `file-completion-candidate`

### Add file marginalia annotator

- In `marginalia.tlisp`, define `marginalia-file-annotation (candidate)` that shows dir/file indicator based on whether the value ends with `/`
- Register it: `(marginalia-register-annotator "file" "marginalia-file-annotation")`
- Add both to the module export list

### Load the file-table module

- In `src/tlisp/core/bindings/normal.tlisp`, add `(require-module editor/completion/file-table)` alongside the other completion module requires (after line 20)

### Update find-file to use the new table

- In `src/tlisp/core/commands/find-file.tlisp` line 12: change `"minibuffer-empty-table"` to `"file-completion-table"`

### Add unit tests

- Create `test/unit/file-completion.test.ts`
- Test that find-file shows candidates from the current directory when invoked
- Test that typing a directory prefix (e.g. `src/`) narrows to entries in that directory
- Test that a non-matching prefix shows "No match"
- Test that selecting a candidate and pressing Enter opens the file
- Follow the pattern from `test/unit/buffer-completion.test.ts`

### Run Validation Commands

- Run typecheck and all tests to confirm zero regressions

## Validation Commands

- `bun run typecheck:src` — typecheck source files
- `bun run typecheck:test` — typecheck test files
- `bun test test/unit/file-completion.test.ts` — run new file completion tests
- `bun test test/unit/buffer-completion.test.ts` — confirm existing completion tests still pass
- `bun test test/unit/tlisp-completion-runtime.test.ts` — confirm completion runtime tests still pass
- `bun test test/unit/tlisp-completion-framework.test.ts` — confirm framework tests still pass

## Notes

- `directory-files` returns entries with trailing `/` for directories — this is ideal for display (shows the user which are dirs)
- The table should handle relative paths: `"."` as default directory when no `/` in input
- The `file-dirname` function used in `dired.tlisp` appears to be a T-Lisp function not yet visible as a builtin — verify it's available or use `string-split` on `/` instead
- For Tab insertion (`vertico-insert`), the candidate `"value"` should be the full path so insertion replaces the minibuffer input correctly
