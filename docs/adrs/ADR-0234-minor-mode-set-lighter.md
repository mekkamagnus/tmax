# Dynamic minor-mode lighters

## Status

Accepted (2026-08-21, #211 / [SPEC-211](../specs/SPEC-211-minor-mode-set-lighter.md))

## Context

A mode that wants a live modeline segment (fikra's `fikra:<backend><state>`,
recomputed on every streaming event) had only `editor-set-status` — a
transient message slot that any unrelated command overwrites. Minor-mode
lighters are the persistent status-line mechanism, but they were fixed at
registration time.

## Decision

`(minor-mode-set-lighter name lighter)` mutates the registered mode record's
lighter at runtime. The registry record is shared state read per render
(computeLighters/minor-mode-list-lighters), so the next status-line render
reflects the change with no redraw plumbing. Unregistered names error;
validation follows the file's conventions; the transient status slot is
untouched.

## Consequences

- Modes own persistent modeline segments they can update per event; message
  chatter and mode state stop competing for one slot.
- Mutation is global to the mode (the registry is not per-buffer) — correct
  for mode-level state; per-buffer lighters would need the buffer-local
  machinery from #206.
