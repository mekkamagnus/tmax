# ADR-0162 — withWorkspaceOverride HOF for editing handlers (#16)
## Status: Accepted
## Context
The open/eval/insert/command RPC handlers each had 4 lines of identical workspace-
override prologue (resolveFrame/isWorkspaceOverride/previous/activate) + a try/finally
with restoreWorkspaceAfterOverride — duplicated 4×. Codex flagged this as "NOT truly
behavior-preserving" with a naive HOF (eval/insert wrap activate errors differently).

## Decision
Extract `withWorkspaceOverride(params, body)` using **try/finally** (not bracket —
these handlers propagate restore errors; bracket swallows them). The 4 handlers now
call it; their bodies (including eval/insert's error-wrapping catches) are callbacks.

**Accept the relax** (maintainer decision): activate errors propagate raw instead
of being mis-leadingly wrapped as "T-Lisp evaluation error:" / "Insert error:". This
is more accurate and codex-acknowledged. keypress is NOT refactored (different
structure).

## Consequences
- 4 handlers deduplicated; the prologue/epilogue is in one place.
- Activate errors in eval/insert/command now propagate raw (the accepted relax).
- Verified: typecheck clean; 9/9 integration tests (open/eval/insert/command exercised).

Spec: [CHORE-68](../specs/CHORE-68-workspace-override-hof.md). Issue: #16.
