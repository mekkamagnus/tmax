# ADR-0293 — Agent-Run commit trailers: structural attribution for agent commits

- **Status**: Accepted
- **Date**: 2026-11-20
- **Issue**: #323
- **RFC**: [RFC-036](../rfcs/RFC-036-agent-run-benchmarking.md)

## Context

Two autonomous agent tabs (`task: fikra`, `issue-burn-down`) ran on this repo for days,
both committing into the same `fix(fikra)` scope. An independent codex benchmark of the
runs flagged the result: post-hoc attribution of commits to tabs was unreliable — every
other dimension (efficiency, self-correction, test discipline) had to be reconstructed by
forensics on commit messages and issue comments, and the shared `fix(fikra)` prefix made
even that ambiguous (RFC-036 §1, item 5).

Scope-guessing from commit-message prefixes cannot survive two agents in one namespace.
Git already has a native, queryable mechanism for exactly this: message trailers.

## Decision

1. **Every agent-run commit carries `Agent-Run: <ledger-id>`** in its message trailer,
   where `<ledger-id>` is the run's ledger file stem
   (`agents/ledger/agent-infra-2026-11-20.jsonl` ⇒ `Agent-Run: agent-infra-2026-11-20`).
   Attribution becomes structural: `git log --grep='Agent-Run: <id>'` answers "what did
   this run land?" without guessing.

2. **Audit, not enforcement.** The check lives in the reader
   (`scripts/ledger-trailers.ts`): it reads every commit since a ledger's `run-start`
   timestamp and flags those missing the trailer. It is deliberately **not a git hook** —
   agent sessions run with hooks/permissions bypassed, so a hook is theater; a convention
   plus an auditable reader flag is real.

3. **Flag semantics.** An unattributed commit in the window is a review surface, not an
   accusation — humans also commit without trailers. A commit naming a *different* ledger
   id is expected (another tab sharing the window). A malformed trailer line (trailing
   prose, empty value) attributes nothing, so the commit surfaces as unattributed rather
   than being silently credited to a truncated id.

## Consequences

- Two tabs committing in the same namespace are distinguishable by trailer, resolving the
  benchmark's attribution ambiguity going forward. The ambiguous historical commits stay
  ambiguous — RFC-036 §4 explicitly rejects retroactive re-attribution.
- The audit window is timestamp-based (`git log --since=<run-start ts>`), so commits
  before a run started never alarm; commits from unrelated concurrent work appear only if
  they land after the run's start, which is exactly the window where the question "whose
  is this?" matters.
- `test/unit/ledger-trailers.test.ts` pins the behavior with fixture commits
  (with/without/malformed trailers, in- and out-of-window dates) against a throwaway git
  repo, plus pure partition tests.
- The report reader (issue #324) renders this audit as one of its alarm rows; the
  spot-checker (#325) and scraper (#326) need no trailer knowledge.
