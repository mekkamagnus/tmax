# ADR-0316 — #332: the .info manuals in the compiled binary

- **Status**: Accepted
- **Date**: 2026-11-24
- **Issue**: #332
- **Spec**: SPEC-290

## Context

`M-x info` worked from source but failed from the compiled binary
("node 'Top' not found"). Root cause: the Info reader reads
`<docs-dir>/tmax.info`, but the `--asset` list embedded only the
texinfo corpus — the .info files were never in the binary.

## Decision

- build:tmax embeds `docs/tmax/tmax.info` + `tlisp.info`.
- `resolveDocsTmaxDir(fromDir)` short-circuits the `/$bunfs` virtual
  root BEFORE any normalized walk: `--asset` files embed at the
  basename level of the root (ADR-0271), and a `normalize()`d
  `../../` walk from the virtual root collapses to a literal HOST
  path — the gate's host-FS escape. The dev checkout walks
  `../../docs/tmax` as before. Exposed as a function for layout
  unit tests.

## Consequences

- Follow-ups (gate-named, untracked): an automated `--asset`
  regression gate (unit tests cover resolution only; a live rebuild
  catches asset-list drift); helpgrep's silent catch→continue (the
  same class that hid #332).
