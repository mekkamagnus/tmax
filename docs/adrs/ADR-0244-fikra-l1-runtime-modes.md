# ADR-0244: Fikra L1 runtime modes — surface-derived expressibility

**Date:** 2026-08-22
**Status:** Accepted
**Issue:** #219
**Spec:** SPEC-219

## Context

RFC-027 §D5 defines four runtime modes ordered by strictness:
`approval-required` < `auto-accept-edits` < `auto` < `full-access`. The
issue's fixture table assumed claude could only approximate `auto`
(acceptEdits + allowlist, reported `auto*`) and codex could not express it
at all (`--ask-for-approval` on-request semantics unverifiable → degrade).
The issue also carried the governing rule: a capability probe records the
installed CLI's version + `--help` surface, and any mode whose semantics
cannot be verified from that surface degrades rather than passing by
fixture row.

## Decision

1. **Record the surfaces, derive expressibility.** `fikra-recorded-surfaces`
   (checked in: claude 2.1.195, codex-cli 0.147.0, recorded 2026-08-22) is
   the data; a mode is expressible iff its translator has an explicit case
   AND every emitted flag token appears in the backend's record. No
   expressibility table exists to go stale. The live refresher is #224's
   opt-in probe, never a CI gate.
2. **The recorded surfaces overturned the fixture assumptions.** Claude
   2.1.195 has a native `--permission-mode auto`; codex 0.147.0 removed
   `--ask-for-approval` and gained `--approve-for-me` (automatic approval
   review — the `auto` expression). Both backends express all four modes;
   the issue's own semantics rule (verifiable ⇒ expressed) resolves the
   conflict with its stale fixture. RFC-027 §D5 carries the correction.
3. **Translators return nil for unmapped modes** — never a silent default.
   Only `fikra-claude-mode-arg` keeps a defensive fallback (#214 consumer).
4. **Strictness-ordered degradation stays the rule** for what the surface
   cannot verify: nearest STRICTER expressible mode, never looser, never
   multi-step; nothing expressible → `approval-required` (unknown
   backends). Default is `approval-required` (the deliberate t3code
   divergence), with `fikra-set-default-runtime-mode` as the escape hatch
   (module defvars aren't setq-able cross-module; thread state seeds the
   field nil so modes owns the default).
5. **Honest modeline.** Effective mode always shown; `*` iff degraded; a
   one-time explain message at set time names both modes. Claude auto is
   no longer reported `auto*` — nothing is approximated on the recorded
   surfaces.
6. **Test seam, not a lie.** `fikra-set-backend-forced` sets the backend
   without the availability probe so keyless CI exercises flag translation
   for CLIs the runner doesn't have installed.
7. **Trust is groundwork.** Idempotent tool-class trust lives in thread
   state now; L2's approval flow (#220) consults it for always-allow
   promotion.

## Consequences

- Future CLI changes surface as fixture/test failures against the recorded
  records — the derivation, not a hand-maintained table, is what a
  refreshed record updates.
- The `SPC a m` prompt is a completing-read over exactly the four modes
  (module-qualified table/accept names — bare names are undefined symbols
  from other contexts, the #214 lesson).
- `fikra-thread-set-field` is the sanctioned cross-module mutator for
  thread-state fields.
