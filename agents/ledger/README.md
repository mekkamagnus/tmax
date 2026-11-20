# agents/ledger/ — agent run ledgers

One JSONL file per autonomous agent tab-run: the durable, committed record that makes agent
runs measurable (RFC-036). This is the **only** committed part of `agents/` — the rest is
gitignored adw workspace state; this directory is explicitly re-included in `.gitignore`.

- **Normative schema + examples:** [docs/agent-ledger.md](../../docs/agent-ledger.md)
- **Canonical validator:** `scripts/ledger-schema.ts` (imported by the readers and tests)
- **Validator test:** `test/unit/agent-ledger-schema.test.ts`

## File naming

```
<tab-label>-<YYYY-MM-DD>.jsonl        e.g. agent-infra-2026-11-20.jsonl
```

The stem is the ledger id — the value carried in `Agent-Run:` commit trailers.

## The append duty (standing rules for every agent run)

1. **Append-only, one event per line.** Never edit, reorder, or delete past lines — not to
   fix a typo, not to hide a bad round.
2. **No retro-fabrication.** Append each event when it happens, with the real timestamp.
   Never backfill invented history. (Retro-fitting an *already running* tab starts at the
   protocol message that announced the duty — everything before it stays in the issue
   comments, the historical record.)
3. **Honest nulls, never estimates.** A `telemetry` or `totals` number you cannot read is
   `null`. A string guess is a protocol violation.
4. **Pasted output, not claims.** Every `landing` carries `tests-run` entries whose `output`
   is what the runner actually printed (with its pass/fail counts). "All green" is a claim;
   the ledger does not accept claims.
5. **Corrections are new events.** If a pasted verdict turns out wrong, append the follow-up
   event (a `gate` re-run, an `escalation`, a fresh `landing`) — the trail is the point.
   Extra fields beyond the minimum schema are allowed.
6. **Commit your ledger with your work.** The file only serves benchmarks if it lands in the
   repo. Stage it like any other artifact (it is never gitignored). A `landing` event names
   the shas of the commit it describes, so append it *after* that commit exists — it rides
   with the next landing, and the run's final flush rides with `run-end`.
