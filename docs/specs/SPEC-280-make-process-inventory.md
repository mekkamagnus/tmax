# SPEC-280 — the process-primitive inventory (#294)

## Goal

#294's premise (build async make-process) is corrected: the primitive
EXISTS. This spec's deliverable is the verified inventory, the follow-up
filings, and the dependency corrections — nothing else.

## Design

- **The as-built surface** (ADR-0306): `make-process` (argv, `:cwd`,
  `:env`, `:filter` streaming, `:sentinel` exit) + `process-write` +
  the signal surface with generation guards (#308's contract); the
  fikra claude backend is the live production consumer.
- **The gaps, each with an owner**: PTY → #293; filesystem watching →
  a new issue filed on landing; process groups → recorded "no
  consumer; do not build" (YAGNI).
- **The corrections**: #293/#295/#297's dependency references updated
  to the real dependencies (the tracking chain assumed a build).

## Completion criteria

- [x] ADR-0306 with the as-built inventory + gaps; the watch
      follow-up issue filed with context
- [x] #293/#295/#297 dependency references corrected (comments)
- [x] Nothing else implemented (a tracker, not a build)
