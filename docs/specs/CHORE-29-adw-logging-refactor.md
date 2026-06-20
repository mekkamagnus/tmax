# CHORE-29: adw logging refactor — state/events split + FP pipeline for spec-review

**Status:** done
**Date:** 2026-06-19
**Depends on:** CHORE-28 (adw-plan FP refactor)

## Problem

Two issues with the existing adw logging:

1. **`adw-state.json` conflates state and events.** It wraps lifecycle events inside `{ adw_id, events: [...] }`, making it both a state file and an event log. `logState()` rewrites the entire file on every event (6 rewrites per run in adw-spec-review.ts). The envelope structure forces readers to scan `events[]` to find `spec_path`.

2. **`adw-spec-review.ts` was never FP-refactored.** It still uses `async/await`, `Promise<Either<...>>`, bare `try/catch`, and the early-return cascade pattern — all the issues CHORE-28 fixed in adw-plan.ts and agent.ts.

## Solution

### Part 1: Split state from events

**`adw-state.json`** — state only. No events. Written at most twice per run (start + result/error).

```json
// adw-plan.ts:
{ "adw_id": "01KVCMJ0QR", "description": "add undo support", "type": "feature", "status": "running" }

// adw-spec-review.ts:
{ "adw_id": "01KVCMJ0QR", "spec_path": "docs/specs/SPEC-056-browse-url.md", "source": "path", "status": "pass" }
```

**Per-agent `events.jsonl`** — lifecycle events, JSONL format, one JSON object per line. Sync `appendFileSync`, stream as they happen. Survives crashes.

```
agents/{id}/planner/events.jsonl     (adw-plan.ts)
agents/{id}/reviewer/events.jsonl    (adw-spec-review.ts)
agents/{id}/upgrader/events.jsonl    (adw-spec-review.ts, conditional)
```

### Part 2: FP refactor for adw-spec-review.ts + reviewer.ts

Same patterns as CHORE-28:

| Before | After |
|--------|-------|
| `async function reviewSpec()` → `Promise<Either<...>>` | `function reviewSpec()` → `TaskEither<...>` |
| `async function upgradeSpec()` → `Promise<Either<...>>` | `function upgradeSpec()` → `TaskEither<...>` |
| `async function ensureCodex()` → `Promise<Either<...>>` | `function ensureCodex()` → `TaskEither<...>` |
| `CodexDeps.run` → `Promise<Either<...>>` | `CodexDeps.run` → `TaskEither<string, string>` |
| 6× `try { JSON.parse/FileSync } catch` | `TaskEither.tryCatch(async () => ...)` |
| `main()` early-return cascade | `flatMap` chain with conditional upgrade branch |

## File layout per run

**adw-plan.ts:**
```
agents/{id}/
  adw-state.json              # { adw_id, description, type?, status }
  planner/
    events.jsonl               # start, classify, dispatch, result (or error)
    raw-output.jsonl           # claude subprocess output (streamed, unchanged)
```

**adw-spec-review.ts:**
```
agents/{id}/
  adw-state.json              # { adw_id, spec_path, source, status }
  reviewer/
    events.jsonl              # start, review, result/error
    raw-output.jsonl          # codex review output (streamed, unchanged)
    verdict.json              # codex validated verdict (unchanged)
    verdict.json.schema.json  # schema for codex (unchanged)
  upgrader/                   # only if verdict is "fail"
    events.jsonl              # start, upgrade (streamed)
    raw-output.jsonl          # codex upgrade output (streamed, unchanged)
```

## State shapes

### adw-plan.ts `adw-state.json`

| Field | Type | Description |
|-------|------|-------------|
| `adw_id` | string | The 10-char ULID timestamp |
| `description` | string | The plan description |
| `forcedType`? | `"feature"\|"bug"\|"chore"` | If set via CLI flag |
| `type`? | `"feature"\|"bug"\|"chore"` | Set after classify (omitted while running) |
| `status` | `"running"\|"completed"\|"failed"` | Final status |

### adw-spec-review.ts `adw-state.json`

| Field | Type | Description |
|-------|------|-------------|
| `adw_id` | string | The 10-char ULID timestamp |
| `spec_path` | string | Absolute path to the spec |
| `source` | `"path"\|"adw-id"` | How the spec was resolved |
| `status` | `"running"\|"pass"\|"upgraded"\|"unchanged"\|"failed"` | Final status |

## Event schemas (per-agent events.jsonl)

Each line is `{ ts: ISO, event: string, ...eventFields }`.

### planner/events.jsonl (adw-plan.ts)

| event | Fields |
|-------|--------|
| `start` | `description` |
| `classify` | `type`, `reason` |
| `dispatch` | `skill`, `status`, `kind`, `detail` |
| `result` | `kind`, `spec_path?`, `summary?` |
| `error` | `detail` |

### reviewer/events.jsonl (adw-spec-review.ts)

| event | Fields |
|-------|--------|
| `start` | `input`, `spec_path`, `source` |
| `review` | `verdict`, `summary`, `issue_count`, `issues` |
| `result` | `kind`, `spec_path`, `summary` |
| `error` | `detail` |

### upgrader/events.jsonl (adw-spec-review.ts, conditional)

| event | Fields |
|-------|--------|
| `start` | `spec_path` |
| `upgrade` | `status`, `spec_path`, `summary` |

## Performance impact

**CPU: negligible.** `appendFileSync` per event is ~200 bytes — faster than the old approach which parsed and rewrote the entire JSON file on every event.

**Memory: negligible.** Events are no longer accumulated in memory. Each event is written to disk immediately.

**I/O: reduced.** Old approach: 6 full file rewrites per run (read JSON → mutate → write JSON). New approach: 3-5 single-line appends + 2 state writes (start + result). Net reduction from ~6 reads + ~6 writes to ~2 writes + ~4 appends.

**Crash safety: improved.** Old approach: events between the last `logState()` call and a crash are lost. New approach: every event is on disk before the next step begins.

## `resolveInput()` change

The old `resolveInput()` scanned `state.events.find(e => e.event === "result").spec_path` — a linear search through the events array to find the result event.

New `resolveInput()` reads `state.spec_path` directly from the top-level state object. No scanning needed.

## What was removed

- `logState()` function (both files) — replaced by `appendEvent()`
- `writeLog()` function (adw-plan.ts) — replaced by `writeState()`
- `tapSnapshot` / `flushOnError` pattern (adw-plan.ts) — no longer needed since events stream to disk immediately
- `AdwState` interface with `events[]` field — replaced by simple state objects
- `LogEvent` type — events are just `Record<string, unknown>`
- `ReviewOutcome` type (reviewer.ts) — the result is constructed inline by the caller, no need for an exported type

## Validation

```bash
# Typecheck
bun run typecheck                                    # zero errors

# adw-plan.ts guards
rg -n 'logState\|writeLog\|AdwState' adws/adw-plan.ts  # zero matches
rg -n 'appendEvent\|writeState' adws/adw-plan.ts       # matches present

# adw-spec-review.ts guards
rg -n 'logState' adws/adw-spec-review.ts                  # zero matches
rg -n 'appendEvent\|writeState' adws/adw-spec-review.ts   # matches present
rg -n 'async function' adws/adw-spec-review.ts             # zero matches
rg -n 'async function' adws/adws-modules/reviewer.ts       # zero matches
rg -n 'Promise<Either' adws/adws-modules/reviewer.ts       # zero matches

# Functional tests
bun adws/adw-plan.ts --help                              # usage, exit 0
bun adws/adw-plan.ts                                     # usage error, exit 1
bun adws/adw-spec-review.ts --help                       # usage, exit 0
bun adws/adw-spec-review.ts                              # usage error, exit 1
PATH=/usr/bin:/bin bun adws/adw-plan.ts "x"              # claude error, exit 2
```
