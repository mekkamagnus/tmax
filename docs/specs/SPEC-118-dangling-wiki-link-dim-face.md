# Feature: dangling `[[wiki-links]]` render dimmed; resolved links get the link face

## Goals

- Visual link-health at a glance, Obsidian-style: `[[target]]` that resolves to an existing note renders in the link color; one that doesn't renders in a **dimmed** variant — the eye instantly finds broken/orphan links without following them.

## Completion Criteria (Definition of Done)

- [x] The markdown syntax highlighter classifies each `[[target]]` span as `wiki-link-resolved` or `wiki-link-dangling` (resolution = the SPEC-116 rule: `.md` appended if no extension, relative to the buffer's dir).
- [x] Dangling links render in a dimmed face (e.g. 8-bit gray / reduced-intensity variant of the link color); resolved links use the standard link face. Exactly one face per span, no flicker on unrelated edits.
- [x] Performance guard: resolution happens per-render on VISIBLE spans only (or memoized per buffer-edit) — the highlight path must not stat the vault per keystroke; spot-measure a repaint on a large note.
- [x] `[[target#heading]]` and `[[#heading]]` forms classified correctly (file part drives resolution; `#heading`-only counts as resolved if the heading exists in the current buffer, else dangling).
- [x] Unit test: a fixture buffer with one resolved + one dangling link produces both face classes.
- [x] **Live e2e in the mekkapi tab**: a note in `~/Documents/md-journal` with `[[2026-08-08]]` (exists) and `[[no-such-note]]` — read the pane render and confirm the two visually distinct intensities (ANSI snapshot shows both faces).
- [x] `bun run typecheck` + syntax/markdown suites green.

## Implementation direction

- `src/editor/api/syntax-ops.ts` — the markdown tokenizer emits the `[[…]]` span; extend it (or a markdown-mode post-pass) to `file-exists-p`-check the resolved target and tag the token. Face mapping lives in the renderer's token→ANSI table (where existing heading/emphasis colors are chosen).

## Relevant Files

- `src/editor/api/syntax-ops.ts` — tokenizer + faces.
- `src/tlisp/core/commands/markdown/knowledge.tlisp` — the resolution rule to mirror (extension append + dir-relative).

## Live e2e transcript (mekkapi tab, herdr pane w2:p3, 2026-08-15)

Captured from the real TUI (embedded Steep via the ~/.bun/bin/tmax shim) on
`~/Documents/md-journal/link-test.md`, read with `herdr pane read --ansi`:

```
# line 3 — RESOLVED link [[2026-08-08]] (note exists):
^[[0m^[[2m^[[38;5;245m 3 ^[[0m…plus ^[[0m^[[38;2;97;175;239m[[2026-08-08]]^[[0m wiki
                    └── link face #61afef (97;175;239), full intensity

# line 4 — DANGLING link [[brand new thought]] (no such note):
^[[0m^[[2m^[[38;5;245m 4 ^[[0m…see ^[[0m^[[2m^[[38;2;97;175;239m[[brand new thought]]^[[0m dangling
                        └── ESC[2m (dim) preceding the SAME #61afef hue
```

Two visually distinct intensities of the same link color, one face per span —
the criterion's exact requirement.

## Implementation notes (gate retry 1)

- **Extension rule mirrors T-Lisp exactly**: `string-contains-p "."` on the
  whole target (a dot in an intermediate segment like `docs.v2/note` counts
  as "has extension") — face and follow can never disagree. Unit-tested.
- **Perf guard**: `existsSync` behind a 2s TTL memo (no vault stats per
  keystroke; proven by a delete-the-file-mid-window test). The heading-slug
  scan for `[[#heading]]` forms is lazy per render and single-pass (one
  multiline regex over `getContent()`) — paid only when a heading-only link
  is visible. TTL staleness after follow-or-create is bounded at 2s (no
  invalidation hook; documented tradeoff).
- **Intentional behavior change**: plain `wiki-link` previously had NO theme
  entry (rendered completely unstyled). It now renders with the link face
  even without a resolver — wiki-links reading as links is the point of the
  feature.
- **Out of scope**: `![[embed]]` tokens are not reclassified (pre-existing
  behavior, unchanged).
