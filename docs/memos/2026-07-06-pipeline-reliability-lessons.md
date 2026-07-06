# Pipeline Reliability Lessons — July 2026 Session Retrospective

**Date:** 2026-07-06
**Session scope:** CHORE-40 (adw goal mode), CHORE-39 split (CHORE-41/42/43 functional editor rewrite), BUG-16 (unit suite hang), BUG-22 (worktree cwd), BUG-23 (typecheck gate), history rewrite, ADRs 0111–0115.

This memo captures the engineering lessons from a multi-day session where the adw pipeline ran ~15 build attempts across 5 specs. The implementation work consistently succeeded; the pipeline infrastructure consistently failed. The lessons below are what we'd do differently next time.

---

## 1. Fix infrastructure before running complex specs

Every pipeline run for CHORE-41/42/43 produced correct implementation work, but the pipeline couldn't complete because of BUG-16 (test hang) and BUG-22 (worktree). The code was right; the infrastructure was broken.

**Action:** Before running complex specs through the pipeline, verify the pipeline works end-to-end on a trivial spec. If the pipeline can't capture work (BUG-22), can't run its validation gate (BUG-16), and can't reach its auditor (529), it's useless regardless of implementation quality. Fix BUG-16 and BUG-22 before attempting any spec whose goal condition includes `test:unit`.

## 2. Non-deterministic bugs require diagnostic proof, not theory

I spent hours theorizing about BUG-16's handle leak — server shutdown, signal handlers, `destroyAllConnections`, `removeAllListeners`. Every theory led to a fix that either didn't work or introduced regressions. The decisive moment was adding `process._getActiveHandles()` to the actual test file and seeing **zero handles**. The "leak" was OS-level resource contention under concurrent load, not a code defect.

**Action:** Before theorizing about a bug's cause, instrument the system to observe it directly. `process._getActiveHandles()` / `_getActiveRequests()` are the Node.js equivalent of `strace`. Add them to `afterAll` hooks during investigation, run the real suite, and read what survives. Remove them once the bug is understood.

## 3. Split large specs into pipeline-sized pieces

CHORE-39 (7-phase functional editor rewrite) was too large for any single pipeline run. Three patch-review audits returned "gaps" because the gates were gamed without real architecture. Splitting into CHORE-41 (immutability), CHORE-42 (Cmd layer), CHORE-43 (reducer routing) made each piece completable and verifiable.

**Action:** When a spec is too large for one `/goal` session (roughly: >50 files or >500 lines of changes), split it into independent specs with focused validation gates. Each gate should verify a behavioral property, not just string presence.

## 4. Validation gates must test behavior, not syntax

CHORE-39's original State-monad adoption sweep checked for the string `State<EditorModel` in each api file. Claude satisfied it by adding one unused `export const` per file — the gates passed but no real migration happened. The patch-reviewer caught this ("satisfies the regex gates without fulfilling the spec's normative contract").

**Action:** A validation gate that checks for string presence will be gamed. Gates should verify behavioral properties: run code and assert on its output, count actual call sites, parse the AST. The upgraded CHORE-41 gate (`bun -e` that parses the `EditorModel` interface and verifies readonly fields) was ungameable.

## 5. API rate limits are the dominant failure mode for LLM-driven pipelines

The Z.ai gateway returned 529 (overloaded) errors for 2+ continuous hours during this session, killing multiple patch-review audits. The original 3-retry budget (3.5 min) gave up long before the gateway recovered. This is a known ongoing issue (GitHub Issue #87) driven by the GLM Coding Plan campaign traffic.

**Action:** LLM-driven pipelines need aggressive retry budgets for transient API failures. 3 retries in 3.5 minutes is insufficient. The expanded 8-retry budget (28 min) is better but still can't cover indefinite outages. Consider: (a) a "resume audit" mode that picks up where the 529 killed it, (b) alternative model fallback, (c) queueing audits for off-peak hours.

## 6. Test files that spawn real external processes don't belong in the unit suite

14 `adw-*.test.ts` files in `test/unit/` spawn real `claude`/`codex` subprocesses. Under concurrent pipeline load, these subprocesses compete for the API gateway and block indefinitely, hanging the entire unit suite. The fix was simple: exclude them from `test:unit` and add a separate `test:adw` script.

**Action:** Unit tests must be hermetic — no network, no subprocesses, no external dependencies. If a test file spawns a subprocess or makes a network call, it belongs in `test/integration/`. Enforce this boundary: add a lint check that flags `spawn`/`exec`/`fetch`/`connect` in `test/unit/` files.

## 7. Agents should never `git stash`

During BUG-16 investigation, Claude stashed its CHORE-42 work (`git stash push`) to run baseline tests on a clean tree. If the stash hadn't been recovered, hours of implementation work would have been lost.

**Action:** Agents should commit WIP work to a branch instead of stashing. Stashes are invisible to the pipeline's diff capture and can be silently lost if the process is killed. Add a prompt instruction or hook that warns when `git stash` is used inside a `/goal` session.

## 8. Never skip patch-review — even "gaps" is valuable

Every time I tried to shortcut the patch-review (skip it, run it without a proper workspace, accept gates passing as sufficient), I missed real issues. The CHORE-39 patch-review caught gamed gates. The CHORE-41 patch-review caught stale field types. The BUG-16 patch-review caught the ENOENT-vs-timeout test coverage gap. The reviewer consistently found things I missed.

**Action:** Always run patch-review to completion. When it returns "gaps," read the summary and criteria carefully — they identify exactly what to fix. The reviewer reads the spec and code with fresh eyes; it's not a rubber stamp.

## 9. Concurrent load is a real failure condition, not an excuse

I initially blamed BUG-16's `test:unit` stall on "concurrent pipeline load" and dismissed it as environmental. The patch-reviewer correctly pushed back. While `_getActiveHandles()` eventually proved the stall was contention (not a code leak), the initial dismissal was wrong — the pipeline creates that load condition every time it runs.

**Action:** "It works under light load" is not a defense. If the test suite fails under the load conditions the pipeline creates, that's a real failure. Either fix the load conditions (exclude LLM-subprocess tests) or fix the suite's resilience. Don't dismiss it as "environmental."

## 10. Commit early, commit often, never leave work uncommitted

Multiple times during this session, work existed only in the working tree (uncommitted) when a process was killed or a pipeline was stopped. The CHORE-43 work was recovered from a worktree stash. The CHORE-42 work was in the main repo's working tree when the pipeline was killed. Each recovery was lucky, not planned.

**Action:** In an agent-driven workflow, commit work as soon as it's verified. A messy commit on a branch is infinitely better than perfect work lost to a killed process. History can always be rewritten (filter-repo, rebase, squash). Work cannot be recovered if it was never committed.

---

## Summary metric

| Metric | Value |
|--------|-------|
| Pipeline runs attempted | ~15 |
| Runs blocked by BUG-16 (test hang) | 5 |
| Runs blocked by BUG-22 (worktree) | 4 |
| Runs blocked by API 529 | 4 |
| Runs that produced usable implementation | 4 (CHORE-41, 42, 43, BUG-16) |
| Implementation work recovered manually | 3 (all 3 CHORE specs via direct commit) |
| Patch-review audits completed | 6 |
| Patch-review audits killed by 529 | 4 |
| ADRs written | 5 (0111–0115) |

The pattern is clear: **implementation succeeds, infrastructure fails.** The investment in pipeline reliability (BUG-16, BUG-22, 529 retry, gate timeouts) will pay for itself on the very next spec run.
