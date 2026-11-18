# ADR-0286: #257 Closed as Verified-Fixed (No New Decision)

## Status

Accepted

## Context

Issue #257 (codex saw the status line name `*scratch*` after the nested M-x describe path, rounds 2–3 of the grading arc; a harness flake where the nested prompt sometimes never opened) could not be reproduced on main.

## Decision

Close as **verified-fixed by #253** (the status-line special-buffer naming cluster, `edeef60`) rather than landing a speculative change. Evidence: headless 18/18 (3-round repeated pin + 15-run probe) asserting state AND rendered status line; live 5/5 in an embedded tmux session driven via `tmaxclient --keys` (the issue's own repro recipe), comparing `tmax -e '(buffer-current)'` against the captured pane. A repeated-round regression pin (`test/unit/mx-nested-describe-status.test.ts`) guards the behavior permanently — the observation was on the SECOND and THIRD invocation, which a single-run pin would miss.

The triage "hang" was the 5s default bun test timeout against a ~5.6s first-run sequence (describe module lazy-load), not a deadlock — recorded to prevent a future misdiagnosis.

## Consequences

- The nested M-x path is pinned: `*Help*` in state and in the rendered status line, three rounds running.
- Verification-only dispositions still carry a spec + this ADR + a regression pin — "cannot reproduce" alone does not close an issue.
- Harness gotcha recorded: `src/client/cli.ts` is a library module — running it directly no-ops (exit 0, no output); the entry is `bun bin/tmaxclient` or the `tmax` launcher verbs.

## Related

- [SPEC-260](../specs/SPEC-260-nested-describe-verification.md), issue #257
- #253 (the fix — describe/*Help* status-line cluster), #256 (completing-read tables), BUG-81 (the synthetic-key-delivery flake class)
