# ADR-0161 — malformed init.tlisp surfaces an error (#59)
## Status: Accepted
## Context
`loadInitFile` discarded the `evalCode` result — a malformed init file was silently
swallowed, the status line showed nothing, and the log falsely reported "Loaded."

## Decision
Capture the result; on `Left`, call `setStatusMessage("Init file error: <msg>")`
(user-facing status line). The "Loaded" log now only fires on `Right`.

## Consequences
- A typo'd init file shows a visible error on the status line without crashing.
- The daemon stays alive (verified).
- The internal `initLog` requires `DEBUG=tmax`; `setStatusMessage` is the durable
  user-facing surface.

Spec: [BUG-48](../specs/BUG-48-malformed-init-feedback.md). Issue: #59.
