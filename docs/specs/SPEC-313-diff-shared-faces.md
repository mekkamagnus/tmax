# SPEC-313 — git-diff T0: shared diff faces on chat previews + viewer

## Goal

One diff-grammar face source consumed by BOTH renderer paths — the
chat's tool previews AND the viewer's patches (#289's line-class
model as the single grammar; the two renderers stop owning their
own coloring).

## Normative

- **Face mechanism**: `editor/fikra/diff-face` — `diff-face-line
  <class> <text>` (add 32 / remove 31 / hunk-header 36 /
  file-header 1 / meta 2 / context PLAIN — the add/remove palette
  byte-preserves the chat's prior inline green/red);
  `diff-classify-line` (the git-shape classifier: +/− leading
  sign, leading space = context, `@@` hunk, `diff --git`/`---`/`+++`
  file headers, else meta); `diff-face-strip` (ANSI drop — git's
  own colored output is NOT trusted intake).
- **Consumers**: (a) event.tlisp's preview path calls the helper
  (behavior-preserving); (b) the viewer spawns git `--no-color`
  and faces every rendered PATCH line through the helper —
  `fikra-diff-render-parts` composes verbatim summary/footer with
  the caller-pre-faced patch, driving `fikra-diff-render-raw`
  (the buffer lifecycle WITHOUT a re-facing wrap — re-wrapping
  would strip the viewer's own summary palette, the gate-r2
  finding).
- **Equivalence testing (content spans, not bytes)**: the parity
  test compares (class, normalized-text) sequences between the two
  paths over the same logical diff; prefixes legitimately differ.
- **Viewer keymap preservation**: the keymap/buffer-type/behaviors
  untouched; the regression suite pins the binding COMMANDS.

## Completion criteria

- [x] `diff-face-line` helper + unit matrix (each class × text incl. unicode, empty context lines)
- [x] Chat preview path renders via the helper (existing green/red output preserved); viewer uses `--no-color` + helper (no trusted ANSI intake)
- [x] Parity test over (class, normalized-text) sequences on identical logical diffs; viewer keymap regression green

## Follow-ups (advisory, from gate r3)

- Document/unexport `fikra-diff-render` (single-arg, facelines-wrapping — zero production callers; a future composed-content caller could reintroduce the r2 defect).
- The `---`-prefixed removed-line classification is a #289 grammar limitation.
