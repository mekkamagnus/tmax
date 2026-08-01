# Bug: :e / :edit (open file) is a TODO stub

## Bug Description
`:e <file>` / `:edit <file>` did nothing — the TS stub (bindings-ops.ts:142-145)
set a status message "not implemented yet" instead of opening. The manual documents
`:e filename` as THE open command; a working opener (`find-file-open`) already exists.

## Solution
Route `:e`/`:edit` in `command-line.tlisp` to `open-file` (alias of find-file-open,
#51). Remove the TS stub (now unreachable).

## Validation
- daemon: `(editor-dispatch-command-line "e /tmp/foo.txt")` opens the file (buffer-name matches).
- typecheck clean.

## Notes
- open-file is the alias defined in #51 (buffers.tlisp).
