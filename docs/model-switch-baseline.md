# Model switch baseline: glm-5.3 → glm-5.4

**Status:** baseline recorded 2026-11-23; the comparison is pending a post-switch sample.

**Related:** [RFC-036](rfcs/RFC-036-agent-run-benchmarking.md), [agent-ledger.md](agent-ledger.md),
[docs/burn-down-order.md](burn-down-order.md)

---

## 1. The switch

| | |
|---|---|
| Boundary | **2026-11-23T19:07:14Z** (mtime of `~/.claude/settings.json`). Every tab moved from `glm-5.3[1m]` to `glm-5.4[1m]` within minutes |
| Changed | The model driving every tab |
| Unchanged | The grader (codex), the issue specs, the burn-down order, the gates and the 5-round valve, the machine |
| Excluded from both samples | **#311**: in flight across the switch, so it was partly built on each model |

Each live ledger was given the switch as a second `run-start` event with `model: "glm-5.4[1m]"`
(appended 2026-11-23T19:33:27Z). The burn-down tab then restated its ledger (2026-11-24T04:20Z)
and that marker was dropped; it was re-appended on 2026-11-24 at 06:05Z. The fikra ledger kept
its marker. **This document, not either ledger, is the boundary of record.** The model in force
for an event is the model of the nearest `run-start` before it. The run itself did not restart;
the note on each event says so.

## 2. Sources, and why the ledger is not the primary one

**Primary: GitHub.** Each issue's `closedAt`, and its close comment, where the burn-down records the
codex grade trajectory (`5 → 7 → **9/10**`).

**Secondary: the ledgers.** Their event *content* is usable, but not their timestamps:

| Agent-written lines | Burn-down ledger | Fikra ledger |
|---|---|---|
| Total | 287 | 486 |
| Malformed JSON (raw newline inside a string) | 26 (9%) | 0 |
| Stamped more than 5 minutes into the future | 65 (24%) | 11 (2%) |
| Using an event kind outside the schema | 128 (49%), 67 distinct kinds | 328 (67%), 7 distinct kinds |
| Telemetry events with token figures | 0 of 4 | 0 of 40 |

A quarter of the burn-down ledger's events carry invented, round-numbered timestamps (for example
#332's events are stamped 2026-11-24 although the issue closed on 2026-11-22). So wall-clock
figures must come from GitHub or git, never from ledger `ts`.

## 3. Baseline: burn-down tab, pre-switch

Window: 2026-11-20T10:05Z (first close, #299) to 2026-11-23T09:37Z (last close before the switch, #313) = **2.98 days**.

| Metric | Pre-switch value |
|---|---|
| Issues closed | **28** (9.4 per day) |
| Accepted (final codex grade ≥ 8.5) | **22** (7.4 per day) |
| Closed below the threshold | **4**: #305 at 5, #307 at 7, #296 at 6, #319 at 8 |
| No grade recorded | **2**: #313 (codex outage), #327 |
| Codex grade rounds per graded issue | **mean 3.2, median 3**, range 1–8 (84 rounds over 26 issues) |
| Accepted on round 1 | **5 of 26 (19%)** |
| Reached the 5-round valve | **7 of 26 (27%)**; 2 ran past it (#321: 8 rounds, #276: 6) |
| Round-1 grade | **mean 6.9**, median 7, SD 1.9 |
| Rounds spent on issues that were never accepted | **17 of 84 (20%)** |

"Closed" overstates delivery: 4 of the 28 closed issues (14%) did not meet the valve's own bar.

**Per-issue record.** Rounds are codex grade rounds; grades are out of 10.

| Issue | Closed (UTC) | Rounds | Round 1 | Final | Outcome |
|---|---|---|---|---|---|
| #299 | 11-20 10:05 | 1 | 9 | 9 | accepted |
| #300 | 11-20 11:49 | 3 | 5 | 9 | accepted |
| #304 | 11-20 13:48 | 1 | 9 | 9 | accepted |
| #306 | 11-20 18:28 | 2 | 7 | 9 | accepted |
| #303 | 11-20 20:50 | 2 | 8 | 10 | accepted |
| #305 | 11-20 22:46 | 2 | 5 | 5 | **closed below threshold** |
| #318 | 11-21 02:29 | 5 | 3 | 9 | accepted |
| #319 | 11-21 03:38 | 5 | 6 | 8 | **closed below threshold** |
| #321 | 11-21 08:05 | 8 | 5 | 10 | accepted |
| #276 | 11-21 09:46 | 6 | 4 | 9 | accepted |
| #294 | 11-21 10:45 | 4 | 7 | 9 | accepted |
| #286 | 11-21 13:35 | 5 | 7 | 9 | accepted |
| #289 | 11-21 15:04 | 2 | 7.5 | 9 | accepted |
| #288 | 11-21 16:02 | 2 | 8 | 9 | accepted |
| #287 | 11-21 17:21 | 3 | 5 | 9 | accepted |
| #290 | 11-21 19:10 | 4 | 7 | 9 | accepted |
| #291 | 11-22 01:16 | 4 | 7 | 9 | accepted |
| #292 | 11-22 02:29 | 2 | 7 | 9 | accepted |
| #296 | 11-22 05:18 | 5 | 6 | 6 | **closed below threshold** |
| #332 | 11-22 05:59 | 4 | 8 | 10 | accepted |
| #307 | 11-22 07:33 | 5 | 4 | 7 | **closed below threshold** |
| #308 | 11-22 14:32 | 4 | 6 | 9 | accepted |
| #337 | 11-22 14:53 | 1 | 10 | 10 | accepted |
| #338 | 11-22 15:12 | 1 | 10 | 10 | accepted |
| #330 | 11-22 17:56 | 2 | 8 | 9 | accepted |
| #328 | 11-22 20:27 | 1 | 10 | 10 | accepted |
| #313 | 11-23 09:37 | — | — | — | no grade recorded |
| #327 | 11-22 10:04 | — | — | — | no grade recorded |

**Blind audit (fix tab, 3 features).** An audit the working tab did not see scored #333, #334 and #335
at **7, 5 and 4** (mean 5.3) and found a data-destroying defect in #335 that the in-loop gate had
passed. Bringing them to 9 took 2, 4 and 7 further grades. This is the only quality measure that is
blind to the working agent's own reporting.

The fikra tab has no per-issue units, so it is not part of the grade baseline.

## 4. Computing the post-switch side

Use the same procedure and the same definitions:

1. `gh api "repos/<owner>/<repo>/issues?state=closed&since=2026-11-23T19:07:14Z"` for the issues.
2. For each issue the burn-down closed, read the codex grade trajectory from its close comment.
3. Exclude #311.

## 5. What cannot be compared

- **Tokens and cost per issue.** No telemetry event written before the switch contains a token figure.
  From 2026-11-23T19:26Z the scraper (`scripts/ledger-scrapers.sh`) appends true-clock telemetry to
  both live ledgers, so the post-switch side will have it; the pre-switch side never will.
- **5-hour limit hits.** Not recorded anywhere durable (two were noticed in watchdog checks, both
  on the fikra tab).

## 6. Reading the comparison

- **Wait for at least 20 graded issues** post-switch (2–3 days at the pre-switch pace).
- **Round-1 grade:** the pre-switch spread is SD 1.9 over 26 issues, so a difference of about one
  point is roughly two standard errors. Less than that is noise.
- **Round-1 acceptance:** a proportion this small moves a lot by chance. Treat only a doubling
  (19% to about 40% or more) as a signal.
- **Known distortions:** the issue mix differs on each side of the switch (the order file walks
  through clusters of different difficulty), the sample is small, codex grades have moved by about
  a point between rounds on near-identical text, and rounds are capped at 5 by the valve.
- **Blind audit:** rerun the same audit prompt on the next 3 comparable landed features and compare
  with 7 / 5 / 4.
