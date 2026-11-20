# The Agent Run Ledger

**Status:** Active (RFC-036 / issue #322)

**Related:** [RFC-036](rfcs/RFC-036-agent-run-benchmarking.md) (the charter — problem, derived
benchmarks, protocol amendments), [agents/ledger/README.md](../agents/ledger/README.md) (the
append duty), `scripts/ledger-schema.ts` (the canonical validator),
`test/unit/agent-ledger-schema.test.ts` (validates every example below)

---

## 1. What this is

A repo-local, append-only JSONL record of an autonomous agent run — one file per tab-run:

```
agents/ledger/<tab-label>-<start-date>.jsonl     # e.g. agents/ledger/issue-burn-down-2026-11-20.jsonl
```

The ledger exists because agent runs were unmeasurable: token grades were "provisional — no
telemetry exists", efficiency was reconstructed by commit forensics, and "suite 3728/0" was a
claim, not a fact (RFC-036 §1). The ledger makes those measurable at run time, by the agent
itself, as a protocol duty. Reader tooling (RFC-036 §5, issues #324–#326) renders scorecards and
spot-checks claims from these files.

**Ledger files are committed** — they are the durable record. (The rest of `agents/` is
gitignored adw workspace state; `agents/ledger/` is explicitly re-included.)

## 2. Common rules

- **One event per line**, valid JSON, UTF-8, no pretty-printing.
- **Append-only.** Never edit, reorder, or delete past lines. Corrections are *new* events
  (extra fields are allowed — this schema is the minimum viable set, evolved additively).
- **No retro-fabrication.** Events are appended when they happen, with the real timestamp.
  Never backfill invented history.
- **Every event** carries `event` (the kind) and `ts` (ISO-8601 date-time **with timezone** —
  escalation-latency math depends on it).
- **Telemetry honesty:** numeric fields you cannot read are `null` — **never estimated, never
  a string** (`"about 40"` is a protocol violation; `null` is honest).
- **Pasted output, not claims** (RFC-036 §3.3 rule 4): `tests-run` entries carry the runner's
  actual output. A landing without pasted output is unverified by definition. The validator
  enforces presence and non-emptiness; the spot-checker (issue #325) re-runs and compares.

The canonical machine definition lives in `scripts/ledger-schema.ts`. Every example in this
document is validated by `test/unit/agent-ledger-schema.test.ts` — valid examples must pass,
invalid examples must fail — so the doc can never silently drift from the validator.

## 3. Event reference

### `run-start`

When the tab launches. Opens the run.

| field | type | rule |
|---|---|---|
| `label` | string | the tab label (`agent-infra`, `issue-burn-down`, …) — also the ledger filename stem |
| `goal` | string | what this run is trying to achieve |
| `model` | string | the model driving the run |
| `order-file-ref` | string | path (or URL) of the ordered backlog this run works |

**Valid:**

```json
{"event":"run-start","ts":"2026-11-20T09:03:11Z","label":"issue-burn-down","goal":"burn the alpha-blocker board to zero","model":"claude-sonnet-5-5","order-file-ref":"docs/burn-down-order.md"}
```

**Invalid — `goal` is missing:**

```json
{"event":"run-start","ts":"2026-11-20T09:03:11Z","label":"issue-burn-down","model":"claude-sonnet-5-5","order-file-ref":"docs/burn-down-order.md"}
```

### `unit-start`

When a work unit begins (an issue, a fix iteration, a spec).

| field | type | rule |
|---|---|---|
| `unit` | string | unit id — issue number (`"#322"`) or iteration (`"iter-3"`) |

**Valid:**

```json
{"event":"unit-start","ts":"2026-11-20T09:05:00Z","unit":"#322"}
```

**Invalid — `unit` is empty:**

```json
{"event":"unit-start","ts":"2026-11-20T09:05:00Z","unit":""}
```

### `telemetry`

**Every unit boundary and every 30 minutes**, read from the CLI footer. Honest `null` for
anything unreadable — never estimated.

| field | type | rule |
|---|---|---|
| `wall-minutes` | number \| null | minutes since run-start (wall clock) |
| `active-minutes` | number \| null | minutes with actual agent activity |
| `in-tokens` | number \| null | context/prompt tokens consumed so far |
| `out-tokens` | number \| null | output tokens produced so far |
| `ctx-remaining-pct` | number \| null | integer 0–100, remaining context headroom |

**Valid (all fields readable):**

```json
{"event":"telemetry","ts":"2026-11-20T09:35:00Z","wall-minutes":42,"active-minutes":31,"in-tokens":23700,"out-tokens":5120,"ctx-remaining-pct":62}
```

**Valid (tokens unreadable — honest nulls, not estimates):**

```json
{"event":"telemetry","ts":"2026-11-20T10:05:00Z","wall-minutes":72,"active-minutes":null,"in-tokens":null,"out-tokens":null,"ctx-remaining-pct":41}
```

**Invalid — `wall-minutes` estimated as a string:**

```json
{"event":"telemetry","ts":"2026-11-20T09:35:00Z","wall-minutes":"about 40","active-minutes":31,"in-tokens":23700,"out-tokens":5120,"ctx-remaining-pct":62}
```

### `gate`

Every gate invocation — verify-gate, codex grade, or self-check (RFC-036 §6: any external
grader's rounds are standard ledger events).

| field | type | rule |
|---|---|---|
| `kind` | string | `verify-gate` \| `codex-grade` \| `self-check` |
| `verdict` | string | as the gate prints it (`"PASS"`, `"GAPS"`, `"8.5/10"`, …) — non-empty |
| `rounds` | number | integer ≥ 1 — which round of this gate this invocation was |
| `reviewed-sha` | string | the exact commit sha the gate reviewed (round receipts, RFC-036 §3.3 rule 2) |
| `findings-count` | number | non-negative integer — findings this round produced |

**Valid:**

```json
{"event":"gate","ts":"2026-11-20T10:12:44Z","kind":"verify-gate","verdict":"GAPS","rounds":2,"reviewed-sha":"f308bd1","findings-count":3}
```

**Invalid — `kind` is not a gate kind:**

```json
{"event":"gate","ts":"2026-11-20T10:12:44Z","kind":"ci","verdict":"PASS","rounds":1,"reviewed-sha":"f308bd1","findings-count":0}
```

### `landing`

Every commit (or commit series) that lands a unit. The claim record — which is why
`tests-run` is pasted output, not a claim.

A landing event names the shas of the commit(s) it describes — so it is appended **after**
that commit exists (a line cannot contain its own commit's sha). The event then rides with
the next landing; the run's final flush rides with `run-end`.

| field | type | rule |
|---|---|---|
| `unit` | string | the unit id this landing belongs to |
| `shas` | string[] | ≥ 1 commit sha (short is fine) |
| `files-staged-count` | number | integer ≥ 1 — files staged for this landing |
| `tests-run` | `{name, output}[]` | ≥ 1 entry; `output` is the runner's pasted output with its pass/fail counts |
| `adr-spec` | string[] | ADR/SPEC paths this landing produced (may be empty) |

**Valid:**

```json
{"event":"landing","ts":"2026-11-20T10:20:00Z","unit":"#322","shas":["a1b2c3d"],"files-staged-count":4,"tests-run":[{"name":"bun test test/unit/agent-ledger-schema.test.ts","output":"✓ docs examples > all valid examples pass [0.12ms]\n5 pass\n0 fail"}],"adr-spec":[]}
```

**Invalid — `tests-run` output is a claim, not pasted output:**

```json
{"event":"landing","ts":"2026-11-20T10:20:00Z","unit":"#322","shas":["a1b2c3d"],"files-staged-count":4,"tests-run":[{"name":"unit tests","output":""}],"adr-spec":[]}
```

### `escalation`

Every escalation. Log it *when you take the action* — benchmark 5 measures whether the
escalation precedes ctx < 25%, not follows it.

| field | type | rule |
|---|---|---|
| `reason` | string | `stalled` \| `valve-fired` \| `ctx<25%` \| `blocked` |
| `action` | string | what you actually did |

**Valid:**

```json
{"event":"escalation","ts":"2026-11-20T11:02:00Z","reason":"ctx<25%","action":"summarized state, stopped, posted handoff for a fresh-context session"}
```

**Invalid — `reason` is not an escalation class:**

```json
{"event":"escalation","ts":"2026-11-20T11:02:00Z","reason":"tired","action":"kept grinding"}
```

### `run-end`

Tab conclusion. Closes the run.

| field | type | rule |
|---|---|---|
| `units-accepted` | number | non-negative integer |
| `units-blocked` | number | non-negative integer |
| `totals` | object | cumulative counts; every value a non-negative number or honest null. Conventional keys: `wall-minutes`, `active-minutes`, `in-tokens`, `out-tokens` |

**Valid:**

```json
{"event":"run-end","ts":"2026-11-20T18:40:00Z","units-accepted":5,"units-blocked":0,"totals":{"wall-minutes":577,"active-minutes":412,"in-tokens":2814000,"out-tokens":402000}}
```

**Invalid — `totals` value estimated as a string:**

```json
{"event":"run-end","ts":"2026-11-20T18:40:00Z","units-accepted":5,"units-blocked":0,"totals":{"wall-minutes":"9ish hours"}}
```

### Common-field violations

These examples are invalid regardless of event kind.

**Invalid — `ts` is not an ISO-8601 date-time with timezone:**

```json
{"event":"unit-start","ts":"earlier today","unit":"#322"}
```

**Invalid — `event` is not a ledger event kind:**

```json
{"event":"nap","ts":"2026-11-20T12:00:00Z"}
```

## 4. Commit trailers (`Agent-Run:`)

Every agent-run commit carries a trailer naming its ledger:

```
Agent-Run: <ledger-id>
```

`<ledger-id>` is the ledger file's stem — `agents/ledger/agent-infra-2026-11-20.jsonl` ⇒
`Agent-Run: agent-infra-2026-11-20`. With this, attribution is structural (queryable via
`git log --grep='Agent-Run: <id>'`), not scope-guessed from commit prefixes — two tabs
committing in the same namespace stay distinguishable. Motivation and the audit-not-hook
decision: [ADR-0293](adrs/ADR-0293-agent-run-commit-trailers.md).

The reader-side audit (`scripts/ledger-trailers.ts`) reads every commit since a ledger's
`run-start` and flags those **missing** the trailer:

- **Unattributed** is a flag, not an accusation — humans commit without trailers too. The
  run's owner answers for the flagged commits that are theirs.
- A trailer line must be exactly `Agent-Run: <token>`; a malformed line attributes nothing
  (the commit surfaces as unattributed rather than being silently credited to a truncated id).
- A commit naming a *different* ledger id is fine — that's another tab's commit in the same
  window, precisely the disambiguation the trailer exists for.

## 5. Protocol duties (summary)

The full protocol amendments are RFC-036 §3.3. The ledger-enforced subset:

1. **Load-checks-early** — the `gate` event records that the module-load check + relevant e2e
   ran *before* the root-cause claim.
2. **Round receipts** — every `gate` names the exact reviewed sha and findings count.
3. **`Agent-Run:` trailer** — every commit carries `Agent-Run: <ledger-id>` (§4);
   attribution is structural, not scope-guessed.
4. **Pasted output or it didn't happen** — `landing.tests-run` carries runner output.
5. **Honest nulls, never estimates** — `telemetry` and `totals` numeric fields.
6. **The valve is mandatory** — 5 gate rounds on one unit fires the escalation valve.
