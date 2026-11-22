# SPEC-290 — compiled-binary info manuals (#332)

## Goal

`M-x info` works from the compiled binary: the .info manuals embed
and the docs directory resolves the $bunfs layout.

## Design

- build:tmax embeds `docs/tmax/tmax.info` + `tlisp.info` (the Info
  reader reads `<docs-dir>/tmax.info`; only the texinfo corpus was
  embedded).
- `resolveDocsTmaxDir(fromDir)` short-circuits the `/$bunfs` virtual
  root FIRST (the `--asset` files embed at the basename level —
  ADR-0271; a normalize()d walk would collapse to a HOST path); the
  dev checkout walks `../../docs/tmax`.

## Completion criteria

- [x] Unit tests cover both layouts (dev walk; basename-level probe)
- [x] The compiled-binary repro (`tmax -e '(progn (info)
      (buffer-current))'` under an isolated socket) returns `*Info*`
