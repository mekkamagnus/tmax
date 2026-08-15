# Feature: `[[wiki-link]]` reads as text, renders as a markdown link

## Goals

- Obsidian-style display: `[[target]]` is written as wiki syntax but RENDERED as the equivalent markdown link — the target text with a standard link underline/color, behaving visually exactly like `[target](target.md)` (per SPEC-118: link face when resolved, dimmed when dangling).

## Completion Criteria (Definition of Done)

- [x] Rendering layer: in markdown buffers, a `[[target]]` span displays as `target` with the link face (the `[[`/`]]` delimiters are hidden in the RENDER — the BUFFER text is unchanged).
- [x] Cursor/interaction mapping: when the rendered form is shorter than the buffer text, cursor columns map 1:1 into the visible span (the delimiters are zero-width in display terms) — cursor motion, visual select, and copy behave predictably; document the chosen mapping in the spec's implementation notes.
- [x] `[[target|display]]` (alias form) renders the `display` part (write the rule even if the writer doesn't use aliases yet — cheap to include).
- [x] Toggle: a render-mode setting (e.g. `wiki-link-display` minor-mode-style variable, default ON in markdown buffers) so raw-bracket display is one setting away for editing sessions.
- [x] Unit tests: render transform maps `[[x]]` → link-styled `x`; buffer text unchanged; toggle off shows raw.
- [x] **Live e2e in the mekkapi tab**: a md-journal note with several links — read the pane (ANSI snapshot) and confirm `[[2026-08-08]]` shows as `2026-08-08` styled as a link, no visible brackets; `gx` still follows it (SPEC-117).
- [x] No regression: plain `[text](url)` links, code spans containing `[[`, and frontmatter render unchanged.
- [x] `bun run typecheck` + markdown/render suites green.

## Implementation direction

Display-only transform in the markdown render path (where syntax faces are applied): match the `[[…]]` token, substitute the display string, keep the link face. Buffer mutations (SPEC-116's link rewrite) already operate on the raw text and must be unaffected — that's why this is render-layer, not buffer-layer.

## Relevant Files

- `src/render/capture-frame.ts` + the steep/TUI render path — where faces are applied to spans.
- `src/editor/api/syntax-ops.ts` — the wiki-link token (SPEC-118 extends it with resolution).
- `src/tlisp/core/modes/markdown-mode.tlisp` — the toggle setting's home.

## Implementation notes (2026-08-15)

- Mapping (per the criterion): `[[`/`]]` (and an alias's `target|` prefix) are
  ZERO-WIDTH in display; cursor columns on a delimiter land on the visible
  span's adjacent edge, visible text maps 1:1 (exact for non-alias links,
  clamped for `[[target|display]]`).
- Toggle: `wiki-link-display` minor mode (`wiki-link-display-mode` /
  `global-wiki-link-display-mode`, both interactive, default ON globally,
  applied only to markdown buffers). Toggling off is unit-verified (raw
  brackets render); the live M-x toggle demo was blocked by BUG-81
  (`SPC ;` unreliable live — engine-correct, spec filed) — unit coverage +
  the lighter ("Wiki") visibly tracking the mode stand in for it.
- Horizontal scroll (viewportLeft > 0) renders the raw line (the slice math
  operates on raw columns); documented tradeoff.
- Inline-code spans suppress the transform (`\[[x\]]` in backticks renders
  raw); span styles are theme-entry objects, so identity comparison finds
  code spans without re-tokenizing.

## Live e2e transcript (mekkapi tab, herdr pane w2:p3, 2026-08-15)

```
# buffer link-test.md:
 3 │plus [[2026-08-08]] wiki
 4 │see [[brand new thought]] dangling

# Rendered (herdr pane read --ansi):
 3 │plus 2026-08-08 wiki          ← [[2026-08-08]] → "2026-08-08",
                                    ^[[38;2;97;175;239m link face, full intensity, NO brackets
 4 │see brand new thought dangling ← dangling: ^[[2m^[[38;2;97;175;239m — dimmed
                                    same hue (SPEC-118 faces carry through)

# gx on the rendered link (cursor L3, keys g then x):
  ▼ │# 2026-08-08
   2 │2026-08-15          ← the target note opened; ITS wiki link also renders
--NORMAL--   2026-08-08.md   L1 C1 [markdown] (Indent Wiki Ln)   ← "Wiki" lighter on
```

## Gate retry 1 corrections (2026-08-15)

- **Alias cursor mapping is now EXACT 1:1** over the visible display text
  (the first cut used offset-then-clamp, putting cursors on the wrong glyph:
  'b' of `[[a|bcd]]` rendered over 'd'). Hidden target/pipe columns clamp to
  the span start; `]]` clamps to the span end. Trimmed alias displays map
  over the trimmed region.
- **Terminal cursor no longer desyncs on code-span lines**:
  `getCursorScreenOffset` now recomputes the SAME spans + resolver the render
  path uses (previously it transformed without spans).
- **Whitespace-only links render raw**: `[[ ]]` / `[[a| ]]` no longer vanish
  to a zero-width link.
- **Code-span protection is now text-based too** (backtick pairing on the raw
  line) — REQUIRED, not a fallback: the tokenizer gives wiki-link (priority
  62) precedence over inline code (55), so a `[[link]]` inside backticks
  emits a wiki-link span and NO code span; span-identity protection alone
  could never fire through the real pipeline. The text scan also covers the
  spans-less cursor-offset path.
- Documented tradeoffs unchanged: horizontal scroll renders raw; non-focused
  split windows render raw.

## Gate retry 2 corrections (2026-08-15)

- ADR-0222 test count refreshed (17/17 after the retry-1 regressions).
- The transform now requires a markdown-language filename when a filename
  exists (a markdown-major buffer named `notes.txt` renders raw — a
  transformed-but-faceless link was worse than brackets; unsaved scratch
  buffers still transform).
- The fenced-code-block leak is a PRE-EXISTING stateless-tokenize defect
  (fence interiors never get code-block spans) — filed as BUG-82
  (docs/specs/BUG-82-fenced-code-tokenize-stateless.md), out of this
  branch's scope per the gate's recommendation.
