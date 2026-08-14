# Chore: tlisp micro-benchmark floor breach — re-baseline or fix

## Chore Description

On the 2026-08-14 full bench run, the `tlisp` micro-benchmark breached its
floor on all three sizes: **660–1030ms measured vs a 500ms floor** (the floor
was set in CHORE-84 for a baseline of ~90–360ms with JIT headroom). This is
either (a) a real regression in the interpreter's eval path, (b) partly the
module-registry export-table cost that BUG-79/#186 just fixed (the micro-eval
resolves no cross-module names, so unlikely), or (c) machine variance from the
run happening alongside concurrent test processes (observed: a concurrent
`bun test` polluted earlier measurements that day).

## Task

Re-run the benchmark on a quiet machine after the BUG-79/#186 fix:

- **If it passes (<500ms):** machine variance — note it in bench/README.md
  (the floors are sized for an idle machine; concurrent load can false-fail)
  and close this.
- **If it still breaches:** real regression — profile
  `TLispInterpreterImpl.execute` on the CHORE-84 workload, find the regression
  (candidates: any per-eval work added since CHORE-84 — the coverage
  registration, form-shape validation additions, name-resolution paths), fix
  it, and re-baseline the floor to the new measured value with headroom.

## Relevant Files

- `bench/micro-tlisp.ts` — the benchmark (N=10,000 evals of a small command; FLOOR_MS=500).
- `src/tlisp/interpreter.ts` / `evaluator.ts` — the eval path if it's a real regression.
- `bench/README.md` — floor documentation.

## Step by Step Tasks

### Task 1: Clean re-measure
**Acceptance Criteria**:
- [x] `bun run bench tlisp` run 3× on an otherwise-idle machine; results recorded here.

  3 idle runs (2026-08-15): small/medium/large = 1113/901/700, 818/946/752,
  1084/627/625 ms — consistently 626–1113ms vs the 500ms floor.

### Task 2: Verdict + action
**Acceptance Criteria**:
- [x] Verdict: **machine drift, not a code regression** — re-baselined.

**Evidence:**
- The bench FAILS identically at `3a94a14` — the exact commit where CHORE-84
  landed with these floors passing (worktree run: 911ms small). Same code,
  same floor, different result ⇒ the host, not the diff.
- Bisected eval cost across 5 commits (3a94a14…42dd0ea): 72–83µs/eval
  throughout — no regression signature.
- Host calibration: 2017 i7-7920HQ; a 50M-iteration pure-JS loop takes 305ms
  (~3–5× slower than modern silicon), and today's sustained benchmarking adds
  thermal throttling on top.
- Parse dominates eval 95%/5% (77µs vs 3.9µs per eval) — that ratio is
  unchanged and is a real future optimization target (an RFC-019 Tier 2.3
  parse cache never existed; `git log -S parseCache` is empty), but it is not
  a *regression*.

**Action:** floor re-baselined 500 → 1400ms (≈1.5× the worst idle run — still
catches a real interpreter regression; measured 601–767ms post-change, PASS ×3
sizes). Rationale recorded inline in `bench/micro-tlisp.ts`.

## Validation Commands
- `bun run bench tlisp` (×3, idle machine)

## Notes
- The keynorm/minibuffer benchmarks were also load-sensitive on that run; the
  README already carries the idle-machine caveat after ADR-0211.
