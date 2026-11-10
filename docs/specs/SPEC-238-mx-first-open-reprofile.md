# SPEC-238 — M-x first-open: re-profile, warm-up NOT adopted

**Status:** in progress (branch `issue-238`) → landed (ADR-0268)
**Issue:** [#238](https://github.com/mekkamagnus/tmax/issues/238)
**Base:** `main` @ `13c0df5`

## Goal

Resolve #238 ("M-x first-open ~280ms — warm the candidate cache at session
start") against **current** measured reality rather than the issue's
BUG-78-era premise. Either land the warm-up or record a measured
not-adopted decision with corrected documentation.

## Ground truth (measured 2026-11-10, main @ 13c0df5)

The issue's premise — first M-x open pays ~280ms — is **stale by ~35×**.
Two independent measurements:

1. **Cold-build probe** (`scripts/bench-238-probe.test.ts`, scratch — boots 5
   fresh editors via `createEditorFixture` + `TmaxServer.startEditor()`, times
   the first vs second `(command-completion-refresh)`):
   - cold: min **6.3ms**, median **8.3ms**, max **22.1ms**
   - warm (second refresh): **0.1ms**
   - candidates: **234** (vs **1,164** at BUG-78 time)
2. **Official harness**: `bun run bench minibuffer` (measures the cached
   path; warmup populates the cache — the realistic M-x experience) →
   64.07k ops/sec, **0.78ms wall for N=50** (~16µs/call; second run 47.48k
   ops/sec, 1.05ms / ~21µs/call), **PASS**. (`wall_ms` is the N=50 total.)

**Why the premise went stale** — three landed changes since the number was
written down:
- **#233** Bun 1.4.4 runtime upgrade (main `cfb0968`)
- **#234** per-interpreter parse cache (ADR-0261, main `189ad50`) — parse was
  the dominant dispatch cost
- candidate count 1,164 → 234 (the interactive-only M-x source, SPEC-115)

An 8ms cold build is ~1 frame at 60fps — imperceptible behind the minibuffer
keybinding itself.

## Decision

**Warm-up NOT adopted** (measured-and-not-adopted, the ADR-0266 "--shard not
adopted" precedent):

- Pre-building at session start would optimize an imperceptible ~8ms and add
  a session-start side-effect for zero user-visible gain (CLAUDE.md §2/§3).
- The issue itself rules out the other direction (TS-side filtering) — editor
  logic lives in T-Lisp (`src/editor/CLAUDE.md`).
- The existing per-session cache (BUG-78/#182, generation-keyed) stays; it is
  a cheap win, no longer a latency fix.

**Reopen threshold:** if the cold `command-completion-refresh` build regresses
above **~50ms** (perceptibility onset; ~6× current median), reopen #238 and
reassess warm-up or build-path work.

## Corrected stale claims (present-tense "~280ms" in living code/docs)

Historical records (ADR-0211, ADR-0212, BUG-78 spec, RFC-026, ADR index rows)
are accurate history and untouched. Present-tense claims corrected:

| File | Was | Now |
|------|-----|-----|
| `src/tlisp/core/commands/execute-extended-command.tlisp` (module comment + `command-completion-refresh` docstring) | "the candidate-build is ~280ms" | "~280ms at BUG-78 time; ~8ms post-#234 (#238 / ADR-0268) — cache stays" |
| `bench/micro-minibuffer.ts` (header + `FLOOR_MS` rationale) | "cache-bust spikes ~150× toward ~14s, failing the floor loudly" | current numbers; floor recalibrated 400→100ms (see above) |
| `bench/README.md` minibuffer baseline row | "~14s (N=50, ~280ms/build)" | "~1ms (N=50 cached, ~20µs/call — #238)"; uncached history noted |
| `test/unit/mx-completion-cache.test.ts` (cache-payoff comment) | "first refresh is the ~280ms build; delta ~100–700×" | "~8ms post-#234; delta ~60–200×" |

Floor recalibration (the one behavior change, found by the re-profile):
`assertFloor` passes on `wallMs <= floorMs`, so post-#234 a full cache-bust
(~400ms for N=50 = 50 × ~8ms) sits exactly ON the old 400ms floor — the
bench's advertised loud regression detection had become a boundary coin-flip.
The cached path measures ~1ms for N=50, so cached-vs-bust separation is
~400:1: **FLOOR_MS 400 → 100** restores loud detection (bust fails 4× over,
cached path keeps ~100× headroom for CI/cold-JIT variance). Safe on two
same-day measurements because both margins are two orders of magnitude.

## Appendix — cold-build probe (verbatim, reproducible)

The scratch probe behind the Ground Truth numbers (run with `bun test <file>`;
it boots 5 fresh editors and logs cold/warm/candidate-count — record the
console output, the test itself always passes):

```ts
/**
 * Scratch probe for #238: is the M-x first-open (cold candidate build) still
 * ~280ms on current main (post-#234 parse cache, post-#236 per-key bulk ops)?
 * Boots N fresh editors and times the first vs second command-completion-refresh.
 */
import { test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createEditorFixture } from "../test/helpers/editor-fixture.ts";
import { TmaxServer } from "../src/server/server.ts";

const savedHome = process.env.HOME;

async function probeOnce(i: number): Promise<{ cold: number; warm: number; n: number }> {
  const fakeHome = mkdtempSync(join(tmpdir(), `tmax-238probe-${i}-`));
  process.env.HOME = fakeHome;
  try {
    const fixture = await createEditorFixture();
    const server = new TmaxServer(undefined, true, fixture.editor, undefined, true);
    await server.startEditor();
    try {
      const t0 = performance.now();
      const built = fixture.editor.getInterpreter().execute("(command-completion-refresh)");
      const t1 = performance.now();
      const again = fixture.editor.getInterpreter().execute("(command-completion-refresh)");
      const t2 = performance.now();
      if ((built as any)?._tag !== "Right" || (again as any)?._tag !== "Right") {
        throw new Error(`refresh => ${JSON.stringify(built).slice(0, 200)}`);
      }
      const n = (fixture.editor.getInterpreter().execute('(length (command-completion-table "" ""))') as any)?.right?.value;
      return { cold: t1 - t0, warm: t2 - t1, n: typeof n === "number" ? n : -1 };
    } finally {
      try { await server.shutdown(); } catch { /* best effort */ }
      try { await fixture.editor.dispose?.(); } catch { /* best effort */ }
    }
  } finally {
    process.env.HOME = savedHome;
    rmSync(fakeHome, { recursive: true, force: true });
  }
}

test("probe: M-x first-open cold build cost", async () => {
const samples: Array<{ cold: number; warm: number; n: number }> = [];
for (let i = 0; i < 5; i++) {
  samples.push(await probeOnce(i));
  console.log(`run ${i}: cold=${samples[i]!.cold.toFixed(1)}ms warm=${samples[i]!.warm.toFixed(1)}ms candidates=${samples[i]!.n}`);
}
const colds = samples.map((s) => s.cold).sort((a, b) => a - b);
console.log(`cold: min=${colds[0]!.toFixed(1)}ms median=${colds[2]!.toFixed(1)}ms max=${colds[4]!.toFixed(1)}ms`);
}, 300_000);
```

Output on 2026-11-10 (dev machine, load ~12). Original run (on main @
13c0df5): cold **min 6.3 / median 8.3 / max 22.1ms**, warm 0.1ms, candidates
234. Re-run on branch `issue-238` (post-docstring edits): cold per-run
12.3/7.1/21.2/5.5/6.1ms → **min 5.5 / median 7.1 / max 21.2ms**, warm
≤0.1ms, candidates 234 — same story (sub-25ms cold, ~100µs warm).

## Completion Criteria

1. **Re-profile evidence recorded** — cold/warm/candidate-count numbers and
   the official `bun run bench minibuffer` output appear in this spec and the
   ADR, attributed to #233/#234/candidate-count.
2. **Decision recorded** — warm-up explicitly NOT adopted with rationale and
   a reopen threshold (~50ms cold), in SPEC + ADR-0268 + index row.
3. **Stale claims corrected** — every present-tense ~280ms claim in living
   code/docs (the four files above) cites current measured numbers and points
   at #238/ADR-0268; historical ADRs/specs untouched.
4. **No behavior change beyond the floor constant** — the **committed branch
   diff** (`git diff main..issue-238`) shows comment/docstring text changes
   exclusively, plus the single `const FLOOR_MS = 100` recalibration (was 400)
   in `micro-minibuffer.ts`. No .tlisp logic, no test assertions changed.
   (The working tree carries a pre-existing uncommitted `docs/rfcs/index.md`
   edit that is the user's, never staged, and absent from the commit.)
5. **Verification green** — `bun run typecheck:src` and
   `bun run typecheck:test` clean; `bun test test/unit/mx-completion-cache.test.ts`
   green (the cache contract the corrected comments describe); `bun run bench
   minibuffer` PASS against the tightened 100ms floor.
