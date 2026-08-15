# Feature: `[[wiki-link]]` reads as text, renders as a markdown link

## Goals

- Obsidian-style display: `[[target]]` is written as wiki syntax but RENDERED as the equivalent markdown link — the target text with a standard link underline/color, behaving visually exactly like `[target](target.md)` (per SPEC-118: link face when resolved, dimmed when dangling).

## Completion Criteria (Definition of Done)

- [ ] Rendering layer: in markdown buffers, a `[[target]]` span displays as `target` with the link face (the `[[`/`]]` delimiters are hidden in the RENDER — the BUFFER text is unchanged).
- [ ] Cursor/interaction mapping: when the rendered form is shorter than the buffer text, cursor columns map 1:1 into the visible span (the delimiters are zero-width in display terms) — cursor motion, visual select, and copy behave predictably; document the chosen mapping in the spec's implementation notes.
- [ ] `[[target|display]]` (alias form) renders the `display` part (write the rule even if the writer doesn't use aliases yet — cheap to include).
- [ ] Toggle: a render-mode setting (e.g. `wiki-link-display` minor-mode-style variable, default ON in markdown buffers) so raw-bracket display is one setting away for editing sessions.
- [ ] Unit tests: render transform maps `[[x]]` → link-styled `x`; buffer text unchanged; toggle off shows raw.
- [ ] **Live e2e in the mekkapi tab**: a md-journal note with several links — read the pane (ANSI snapshot) and confirm `[[2026-08-08]]` shows as `2026-08-08` styled as a link, no visible brackets; `gx` still follows it (SPEC-117).
- [ ] No regression: plain `[text](url)` links, code spans containing `[[`, and frontmatter render unchanged.
- [ ] `bun run typecheck` + markdown/render suites green.

## Implementation direction

Display-only transform in the markdown render path (where syntax faces are applied): match the `[[…]]` token, substitute the display string, keep the link face. Buffer mutations (SPEC-116's link rewrite) already operate on the raw text and must be unaffected — that's why this is render-layer, not buffer-layer.

## Relevant Files

- `src/render/capture-frame.ts` + the steep/TUI render path — where faces are applied to spans.
- `src/editor/api/syntax-ops.ts` — the wiki-link token (SPEC-118 extends it with resolution).
- `src/tlisp/core/modes/markdown-mode.tlisp` — the toggle setting's home.
