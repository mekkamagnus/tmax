# SPEC-211: minor-mode-set-lighter (dynamic modeline lighters)

**Issue:** #211 (fikra-p0 / RFC-027 §UI, §Phase 0)
**Status:** Implemented 2026-08-21

## Goal

A generic primitive `(minor-mode-set-lighter name lighter)` that mutates a
registered minor mode's lighter at runtime, so a mode can re-render a
persistent modeline segment per event (fikra's `fikra:<backend><state>`) —
NOT via `editor-set-status`, which is a transient message slot unrelated
commands overwrite.

## Completion Criteria

- [x] Sets the lighter on a registered mode; returns the new lighter.
- [x] The next `minor-mode-list-lighters` render reflects it (that primitive
      feeds the status line); `minor-mode-lighter` getter reflects it too.
- [x] Repeated calls per event are the intended shape (pinned: two updates
      in sequence).
- [x] Unregistered mode name → error; arity/type validation per repo
      conventions.
- [x] Does not touch the transient status-message slot (pinned:
      editor-set-status message survives a lighter change).
- [x] Tests: test/unit/minor-mode-set-lighter.test.ts (5).
- [x] `bun run typecheck` (all projects) green; adjacent minor-mode/status
      suites green (minor-mode-ops, t1-minor-modes, minor-mode-set-lighter,
      status-line: 37/37).

## Notes

- The registry record is shared mutable state — mutation is visible to every
  reader of the registry, which is precisely the render contract (compute
  Lighters reads the registry per render).
- Fully generic: no Fikra references. fikra Phase 1 wires its state →
  lighter through this primitive.
