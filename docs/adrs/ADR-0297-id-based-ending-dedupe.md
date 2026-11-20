# ADR-0297 — #304: turn endings dedupe by identity, not adjacency

- **Status**: Accepted
- **Date**: 2026-11-20
- **Issue**: #304
- **Spec**: SPEC-271

## Context

Replay already deduped CONSECUTIVE identical turn-ends (the probe-era
doubled markers). The residual class: non-consecutive repeats and
conflicting-status endings for the same turn.

## Decision

Endings dedupe by TURN IDENTITY: a backward scan keeps the first
turn-end per id (= the last by log order — log order is the truth for
conflicting statuses) and drops earlier sightings with a count that
replay surfaces as an N-stale-endings note. The id rule REPLACES the
adjacency rule for id'd logs — distinct adjacent turns never merge. Logs
without turn ids keep the consecutive rule (frozen history).

## Consequences

- The replay renderer's input contract is unchanged (a filtered event
  list); only the filter grew an id-aware arm.
- The count is a module defvar consumed at replay time (no wire/API
  surface change).
