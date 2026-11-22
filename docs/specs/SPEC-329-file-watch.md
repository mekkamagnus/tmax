# SPEC-329 — Filesystem watching (the primitive + minimal auto-revert)

## Goal

`Bun.watch`-class filesystem watching exposed to T-Lisp, with the
classic auto-revert integration: a changed-on-disk file reverts its
buffer. (Bun 1.4.4 has NO Bun.watch — `node:fs.watch` is the
verified-available primitive the implementation builds on.)

## Completion criteria

- [x] `file-watch-start <path> <callback>` → a watch id (number);
      events eval `(callback <path> <event-type>)` — the path
      HEX-ENCODED (the #224 reader boundary); a bogus path refuses
      with a named error.
- [x] `file-watch-stop <id>` (idempotent — unknown ids no-op) and
      `file-watch-list` (the live path registry, a test seam).
      Per-API-context watch tables (daemon/client isolation).
- [x] `auto-revert-mode` (global in v1): ON = scan+watch every
      file-backed buffer (one watch per DISTINCT path — buffers
      share); OFF = stop all + clear.
- [x] A change event reverts the matching buffer UNLESS modified —
      dirty buffers are never clobbered (the data-destroyer guard),
      with the named status.
- [x] Tests against the REAL fs (mkdtemp): event delivery, stop
      stops, the clean-buffer revert, the dirty-buffer guard, the
      OFF registry clear.

## Notes

- The no-consumer-today caveat stands (RFC-028 is a want): the mode
  ships OFF; buffer-local scoping rides a consumer need.
