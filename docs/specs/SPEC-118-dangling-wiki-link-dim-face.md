# Feature: dangling `[[wiki-links]]` render dimmed; resolved links get the link face

## Goals

- Visual link-health at a glance, Obsidian-style: `[[target]]` that resolves to an existing note renders in the link color; one that doesn't renders in a **dimmed** variant — the eye instantly finds broken/orphan links without following them.

## Completion Criteria (Definition of Done)

- [ ] The markdown syntax highlighter classifies each `[[target]]` span as `wiki-link-resolved` or `wiki-link-dangling` (resolution = the SPEC-116 rule: `.md` appended if no extension, relative to the buffer's dir).
- [ ] Dangling links render in a dimmed face (e.g. 8-bit gray / reduced-intensity variant of the link color); resolved links use the standard link face. Exactly one face per span, no flicker on unrelated edits.
- [ ] Performance guard: resolution happens per-render on VISIBLE spans only (or memoized per buffer-edit) — the highlight path must not stat the vault per keystroke; spot-measure a repaint on a large note.
- [ ] `[[target#heading]]` and `[[#heading]]` forms classified correctly (file part drives resolution; `#heading`-only counts as resolved if the heading exists in the current buffer, else dangling).
- [ ] Unit test: a fixture buffer with one resolved + one dangling link produces both face classes.
- [ ] **Live e2e in the mekkapi tab**: a note in `~/Documents/md-journal` with `[[2026-08-08]]` (exists) and `[[no-such-note]]` — read the pane render and confirm the two visually distinct intensities (ANSI snapshot shows both faces).
- [ ] `bun run typecheck` + syntax/markdown suites green.

## Implementation direction

- `src/editor/api/syntax-ops.ts` — the markdown tokenizer emits the `[[…]]` span; extend it (or a markdown-mode post-pass) to `file-exists-p`-check the resolved target and tag the token. Face mapping lives in the renderer's token→ANSI table (where existing heading/emphasis colors are chosen).

## Relevant Files

- `src/editor/api/syntax-ops.ts` — tokenizer + faces.
- `src/tlisp/core/commands/markdown/knowledge.tlisp` — the resolution rule to mirror (extension append + dir-relative).
