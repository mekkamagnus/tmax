# SPEC-290 — compiled-binary info manuals (#332)

## Goal

`M-x info` works from the compiled binary: the .info manuals embed
and the docs directory resolves the $bunfs layout.

## Design

- build:tmax embeds `docs/tmax/tmax.info` + `tlisp.info` (the Info
  reader reads `<docs-dir>/tmax.info`; only the texinfo corpus was
  embedded).
- `resolveDocsTmaxDir(fromDir)` probes BOTH layouts explicitly: the
  dev checkout (`../../docs/tmax` holding tmax.texinfo) and the
  compiled binary (the `--asset` files at the BASENAME level of the
  virtual root — ADR-0271: `$bunfs` never normalizes `..`).

## Completion criteria

- [x] Unit tests cover both layouts (dev walk; basename-level probe)
- [x] The compiled-binary repro (`tmax -e '(progn (info)
      (buffer-current))'` under an isolated socket) returns `*Info*`
