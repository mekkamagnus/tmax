# ADR-0326: the standard-grep fallback backend

- **Status**: Proposed (landing with #309)
- **Date**: 2026-11-23
- **Issue**: #309 · **Spec**: SPEC-309 · **Context**: RFC-031 §2.2, on #307's producer interface + #308's matrix

## Decision

When rg is unavailable (explicit `grep-backend` = `"grep"`, or `auto`
falling through a missing rg), searches run a **one-grep-per-file
sequential transport** over `project-files-walk` enumeration, on
#307's generation-scoped producer interface:

- `["grep", "-n", "-I", "-e", pattern, "--", file]` per file — a
  single operand means grep omits the filename; output is
  `linenum:text` with the **first** colon terminating the number.
- Exit aggregation per file: 0 = matched, 1 = no match (both
  chain); ≥2 stops enumeration with `complete "error"` naming the
  file, exit, and grep's stderr. Final: any matched → `done` (the
  `K of N files matched` diagnostic when K < N); none →
  `no-matches`; empty enumeration → `no-matches` without spawning.
- #308's process discipline reused verbatim: kill-first
  (cross-backend), pid-attributed pending stash for the spawn→setq
  race, stranger-pid drops, spawn-failure rollback.

## Recorded divergences (deliberate, not claimed as parity)

1. **Regex flavor**: grep BRE vs rg's engine — the pattern is
   backend-flavored (unchanged from RFC-031).
2. **Unicode case-folding NOT attempted**: rg folds `É`→`é` under
   smart-case; the fallback's ASCII-only emulation (no `A`-`Z` →
   `-i`, via a char-code scan) does not. Live-verified during the
   gate: `É` matches differ (rg 1 hit, fallback 2). The parity
   tests use ASCII fixtures only.
3. **col = 1** always (grep reports no column).
4. **Synchronous editor-loop blocks**: the one-time `-I` probe
   (Bun.spawnSync via shell-exec-argv) and — only where grep lacks
   `-I` — a per-file first-line NUL check (`head -n 1`) block the
   editor thread. Accepted for a fallback that runs only when rg
   is absent; the alternative (async probe/head machinery) adds
   state complexity to a rare path.

## The ignore list (named here per the spec)

Enumeration ignores come from `project-files-walk`'s internal
`DEFAULT_IGNORES` (src/editor/api/project-ops.ts) — **exposed
read-only as the `project-ignore-dirs` builtin** so callers can
reason about what the walk skips (`node_modules`, `.git`, `dist`,
build artifacts, …).

## `-I` feature detection

Probed once per executable: `grep -I -n -e x -- /dev/null` — exit
0 **or 1** (the probe pattern matches nothing in /dev/null; a
no-match is still a successful flag run) means supported; ≥2 (the
usage error) drops the flag, and binary skipping falls to the
first-line NUL check. NULs later in a file leak and are handled by
the hit-text truncation rule (truncate at the NUL, count as
binary-skipped).

## Portability

BSD grep (dev machine) and GNU grep (CI) both verified for
`-n -e --` single-operand runs; tests record which answered via
`grep --version`.

## Consequences

- `auto` never strands the user without a backend: rg → grep →
  the named both-missing error.
- The dispatch ordering matters: detection runs BEFORE the
  backend branch (the first-search-went-to-fallback bug — gate r1).
- Progress rendering never re-inserts a header once hits streamed
  (render-append n=1 clears the placeholder; a re-added header
  would shift the cursor-line==hit-index mapping) — after the
  first hit, progress rides the status line.
- Glob filters (#311's consult layer) filter the enumerated list
  in T-Lisp before invocation — `--include` is never used.
