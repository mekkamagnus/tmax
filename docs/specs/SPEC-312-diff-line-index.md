# SPEC-312 — git-diff T0: the chat line-index (source map) + RET resolution

## Goal

RFC-032 §3.1 — the chat-side line-index: while the FAEP renderer
emits diff-bearing lines (tool previews, `±` rows), it records a
per-line **link target** (`path`, optional `line`/`side`/`hunk`)
into a buffer-scoped registry. RET consults the index first;
regex extraction stays as fallback. Written during BOTH live
append and replay (one code path). The VIEWER (`fikra/diff.tlisp`)
is a separate product with its OWN index population — this issue
owns the chat buffer's index only and provides the shared registry
PRIMITIVE (data structure + invalidation) that the viewer's
rebuild path (#314) consumes.

## Normative

- **Registry (the shared primitive)**: `diff-line-index` —
  per-buffer-name hashmap `line → target`; stored in a
  mutation-shared hashmap carrier (#306's state-model rules).
  **Population (chat)**: the FAEP renderer records on emit;
  **population (viewer)**: #314's rebuild records its own rows
  into its own buffer's slot — one structure, two writers, no
  shared mutation of one buffer's entries. **Invalidation**:
  buffer-kill drops its slot; buffer content changes (append)
  never rewrite EXISTING entries (line numbers are append-stable
  in a log buffer); replay repopulates from scratch on render.
  **Line-number convention**: 0-based, matching `buffer-line`/
  cursor-line (recorded).
- **Path resolution**: targets carry the path AS EMITTED (relative
  to the thread's working root — #298's persisted root); RET
  resolves against that root. **Deleted files** (old-side-only
  targets): RET reports `file deleted in worktree` unless the
  target carries a historical source (v1: plain refusal with the
  path echoed — honest, no phantom open).
- **RET behavior (this issue's consumer)**: index hit → open at
  (path, line) — NEW-side lines only in v1 (an old-side target
  resolves to its recorded line IF the file still contains ≥ that
  many lines; landing is approximate and status-notes `old-side
  line — approximate`); index miss → the existing regex fallback.

## Completion criteria

- [ ] Registry unit tests: record/invalidate (buffer-kill), append-stability, replay repopulation, per-buffer isolation
- [ ] RET via index: new-side exact landing; old-side approximate + note; deleted-file refusal; fallback path on miss
- [ ] Path resolution against the thread root (#298) incl. relative and absolute emitted paths

## Dependencies

#298 (thread root) — landed. #306 (state-model rules) — landed.
#314 (viewer-side deep jumps) CONSUMES this primitive.
