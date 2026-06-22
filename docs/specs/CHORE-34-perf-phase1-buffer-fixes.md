# Chore: Performance Phase 1 — Buffer Incremental-Update Layer (RFC-019 §1.1–1.3)

## Chore Description

Land the three highest-ROI buffer fixes from [RFC-019](../rfcs/RFC-019-performance-audit.md) Tier 1: make `FunctionalTextBufferImpl` stop re-deriving whole-buffer line metadata on every keystroke by adding the missing incremental-update layer. This is the first production-code change in the RFC-019 phased plan and **requires CHORE-33 (the benchmark harness) to be landed first** so before/after numbers can be measured.

**Why these three, and why together:** They share one root cause and one fix surface. Today, every `insert`/`delete` on `FunctionalTextBufferImpl` (`src/core/buffer.ts:284-331`) calls `newGapBuffer.right.toString()` (rebuilds the entire buffer text from a char-per-cell array) then `splitLines(...)` (re-splits the entire text into lines), and the underlying `FunctionalGapBuffer.moveGap`/`insertIntoGap` clone the entire backing array via `[...this.buffer]` even for a 1-char edit. On a 10k-line file that's ~tens of thousands of unnecessary allocations per keystroke. Fixing any one of the three in isolation gives little benefit; the three together remove the full-text rebuild/resplit path, make position lookup O(1), and reduce avoidable gap-buffer clone overhead. This chore does **not** claim the whole edit path is O(edited line length) unless the optional copy-on-write gap-buffer design in §1.3 is fully implemented; the conservative path still has an O(buffer capacity) array copy when a new immutable gap-buffer instance is produced.

**Scope — three coupled fixes, all in `src/core/buffer.ts`:**

1. **§1.1 — Maintain `lines` incrementally.** Stop calling `toString()` + `splitLines()` on the whole buffer in `FunctionalTextBufferImpl.insert` (`:295`, `:300`) and `delete` (`:324`, `:329`). Compute the new `lines` array by splicing only the affected line range and reusing the unchanged prefix/suffix by reference.

2. **§1.2 — Cache cumulative line offsets (prefix sums).** `positionToOffset` (`:384-406`) currently walks from line 0 on every call. Add a `cumulativeLineOffsets: number[]` field to `FunctionalTextBufferImpl` so `positionToOffset` becomes `cumulativeLineOffsets[line] + clampedColumn` in O(1). Recompute offsets only from the first edited line onward.

3. **§1.3 — Reduce avoidable gap-array cloning without breaking immutable snapshots.** `FunctionalGapBuffer.moveGap` (`:168`) and `insertIntoGap` (`:224`) do `const newBuffer = [...this.buffer]` — a full O(n) copy even when the gap is already at the right position (the common case: typing at the cursor). Skip the clone when no movement is needed (already partly true — see Notes), replace spread clones with `slice()` where the conservative immutable implementation still needs a new backing array, and do not mutate any array that can still be observed by an older `FunctionalGapBuffer` instance. A true copy-on-write / region-copy implementation is acceptable only if it includes explicit ownership tracking as described in the §1.3 task.

**Target outcome:** Buffer-edit throughput on the 10k-line fixture improves by ≥2× (measured by `bun run bench buffer large` before and after), with zero regressions in the existing `test/unit/buffer.test.ts` correctness suite. The primary expected win is removing whole-content `toString()` + `splitLines()` and linear `positionToOffset`; §1.3 is a clone-pressure reduction unless the implementer chooses the optional ownership-tracked copy-on-write design.

**Non-goals (explicitly deferred to later CHOREs):**
- Network/serialize/diff-render fixes (RFC-019 §1.4, §1.5, §1.6, §1.7) — separate Phase 1b CHORE.
- Interpreter fixes (RFC-019 Tier 2) — separate Phase 2 CHORE.
- Do NOT change the buffer's public API (`FunctionalTextBuffer` interface in `src/core/types.ts`). All changes are internal to `FunctionalTextBufferImpl` / `FunctionalGapBuffer`.
- Do NOT change the immutable/functional style. The classes stay `readonly`-field immutable; the optimization is *incremental derivation*, not mutation of observable prior buffer instances.

## Relevant Files
Use these files to resolve the chore:

**Primary target — make all three fixes here:**
- `src/core/buffer.ts` — The entire fix surface.
  - `FunctionalGapBuffer` (lines 23-237): fix §1.3 in `moveGap` (`:159-193`) and `insertIntoGap` (`:219-236`).
  - `FunctionalTextBufferImpl` (lines 242-416): fix §1.1 in `insert` (`:284-302`) and `delete` (`:307-331`); fix §1.2 by adding `cumulativeLineOffsets` and rewriting `positionToOffset` (`:384-406`).
  - The `FunctionalTextBufferImpl.create` static (`:251-255`) must also seed `cumulativeLineOffsets` for the initial content.

**Public API — must remain unchanged (verify, do not edit):**
- `src/core/types.ts` — The `FunctionalTextBuffer` interface. Every method signature stays as-is.

**Existing tests — must still pass unchanged:**
- `test/unit/buffer.test.ts` — Correctness suite for `FunctionalTextBuffer`. The test cases at lines 16-45 (create / insert / delete) are direct regression guards for this chore. Do NOT modify them — they assert the public behavior this chore must preserve.
- `test/unit/buffer-completion.test.ts` — Buffer completion; depends on `getContent` / `getLine`. Must still pass.
- `test/unit/buffer-metadata.test.ts` — Buffer metadata; depends on `getLineCount` / `getLine`. Must still pass.

**Benchmark harness — the before/after measurement tool (must already exist via CHORE-33):**
- `bench/micro-buffer.ts` — `runBufferBench("small" | "medium" | "large")`. Run before edits to capture the baseline; run after to verify the ≥2× target.

### New Files
- `test/unit/buffer-perf-invariants.test.ts` — New correctness test asserting the *incremental invariants* introduced by this chore:
  1. After an edit, `lines.length`, `getContent()`, `getLineCount()`, and `getText(range)` produce the same results as a fresh `FunctionalTextBufferImpl.create(editedContent)` constructed from scratch. (Equivalence with the source of truth — guards against incremental-derivation bugs.)
  2. Prefix-sum behavior is tested through public APIs, because `positionToOffset` is private. For every valid `(L, C)`, assert that `getText({ start: { line: 0, column: 0 }, end: { line: L, column: C } }).length` equals the from-scratch offset calculation `Array.from({length: L}, (_, i) => lines[i].length + 1).reduce((a, b) => a + b, 0) + Math.min(C, lines[L].length)`. Also cover columns past end-of-line and assert they clamp to the line length. If a direct private-method check is needed, use an explicit typed test-only cast such as `(buffer as unknown as { positionToOffset(p: Position): number })`; document in the test that the cast is only for validating the cache against the existing private implementation.
  3. Inserting then deleting the same text at the same position returns a buffer whose `getContent()` equals the original. (Round-trip invariant.)
  4. The same invariants hold after 1000 sequential edits at random positions (stress test for the incremental layer).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Capture the baseline
- Run `bun run bench buffer large` and save the output row where `name` is `buffer` and `size` is `large` (e.g. paste into the chore commit message or `bench/baselines.md` if one exists). Record the exact `ops/sec` value from that row as `baseline_large_ops_per_sec`. This is the "before" number the ≥2× target is measured against. **Do not proceed without a recorded baseline** — without it the validation step at the end cannot be evaluated.

### Fix §1.3 — Reduce avoidable gap-array cloning
- In `src/core/buffer.ts`, audit `moveGap` (`:159-193`): the early-return at `:164-166` already skips the clone when `position === this.gapStart`. Confirm that's the common case (typing at cursor) and that it's hit.
- When movement IS needed (`position !== this.gapStart`), the current code does `const newBuffer = [...this.buffer]` (full clone) then mutates only `moveCount` cells in the moved region. The conservative required change is to use `this.buffer.slice()` instead of spread before mutating the moved cells. This is still O(buffer capacity), but it preserves immutable snapshot semantics because the new instance owns the cloned array and older instances continue to reference the old array.
- Do not implement "copy only the moved region" by sharing `this.buffer` and mutating selected cells. With the current `ReadonlyArray` backing store and immutable returned instances, that would corrupt older buffer versions. A true region-copy optimization is allowed only if `FunctionalGapBuffer` gains explicit ownership tracking, for example a private mutable backing object that is never shared with older published instances, plus a `detachForWrite()`/`ensureOwned()` helper that returns an owned array before any cell mutation. The required invariant is: after `const b2 = b1.insert(...)`, every method on `b1` returns exactly the same results it returned before the edit, regardless of later edits to `b2`.
- In `insertIntoGap` (`:219-236`): the `[...this.buffer]` clone at `:224` is needed in the conservative implementation because the result must be a new immutable instance. Replace it with `const newBuffer = this.buffer.slice(); for (let i = 0; i < text.length; i++) newBuffer[gapStart + i] = text[i];`. (`slice()` is still O(n), so do not describe this as O(edited line length); it is a lower-overhead full copy that avoids spread iteration and preserves snapshot validity.) If implementing the optional ownership-tracked copy-on-write path instead, the test suite must include an old-snapshot validity check.
- Verify the existing buffer tests still pass after this change before moving on.

### Fix §1.2 — Add cumulative line-offset cache
- Add a `private readonly cumulativeLineOffsets: ReadonlyArray<number>` field to `FunctionalTextBufferImpl` (constructor at `:243-246`).
- In `FunctionalTextBufferImpl.create` (`:251-255`), seed `cumulativeLineOffsets` from the initial `lines` array: `offsets[i] = offsets[i-1] + lines[i-1].length + 1` (the `+1` is for the newline).
- Rewrite `positionToOffset` (`:384-406`) to read `cumulativeLineOffsets[position.line] + clampedColumn` in O(1), preserving the existing negative and line bounds checks at `:385-391` **and** preserving the existing column clamp behavior: `clampedColumn = Math.min(position.column, this.lines[position.line].length)`. Columns past end-of-line must continue to resolve to the line end unless this public behavior is intentionally changed with dedicated tests; this chore does not change it.
- Add a private helper `private static computeOffsets(lines: ReadonlyArray<string>): number[]` that both `create` and the new incremental-update paths (next step) call. Single source of truth for the prefix-sum computation.

### Fix §1.1 — Maintain `lines` and `cumulativeLineOffsets` incrementally
- In `FunctionalTextBufferImpl.insert` (`:284-302`): remove the `toString()` (`:295`) and full `splitLines()` (`:300`) calls. Instead:
  1. Compute the new gap buffer as before (`:290`).
  2. Determine the line range affected by the insert: start at `position.line`; for an insert, the original affected range is exactly the current line at `position.line`, regardless of how many newlines are inserted.
  3. Rebuild the inserted line segments with correct prefix/suffix attachment:
     - Let `originalLine = this.lines[position.line] ?? ""`, `clampedColumn = Math.min(position.column, originalLine.length)`, `prefix = originalLine.slice(0, clampedColumn)`, and `suffix = originalLine.slice(clampedColumn)`.
     - Let `segments = splitLines(text)` using the same trailing-newline semantics as `FunctionalTextBufferImpl.create`.
     - If `text` contains no newline, replace the current line with `prefix + text + suffix`.
     - If `text` contains one or more newlines, the first replacement line is `prefix + segments[0]`, the last replacement line is `segments[segments.length - 1] + suffix`, and any middle `segments` become whole lines unchanged. This rule is required to avoid losing the original line prefix/suffix.
  4. Splice the new lines into a copy of `this.lines`: `const newLines = [...this.lines.slice(0, position.line), ...rebuiltAffectedLines, ...this.lines.slice(position.line + 1)]`. The prefix and suffix arrays may be copied by `slice`, but only the affected line content is rebuilt.
  5. Rebuild `cumulativeLineOffsets` for the suffix starting at `position.line` (the prefix offsets are unchanged).
  6. Construct the new `FunctionalTextBufferImpl` with the new gap buffer, new lines, and new offsets.
- In `FunctionalTextBufferImpl.delete` (`:307-331`): the same incremental approach. Determine the line range spanned by `[range.start, range.end]`, splice out / rebuild only that range, reuse the prefix and suffix.
- For deletes spanning lines, concatenate the start-line prefix with the end-line suffix: let `startLine = this.lines[range.start.line] ?? ""`, `endLine = this.lines[range.end.line] ?? ""`, `startColumn = Math.min(range.start.column, startLine.length)`, `endColumn = Math.min(range.end.column, endLine.length)`, `prefix = startLine.slice(0, startColumn)`, and `suffix = endLine.slice(endColumn)`. Replace lines `range.start.line` through `range.end.line` inclusive with one line `prefix + suffix`. For same-line deletes, replace only that line with `line.slice(0, startColumn) + line.slice(endColumn)`.
- The incremental line computation is the trickiest part. For inserts that contain no newlines, only `lines[position.line]` changes — single-line fast path. For inserts that contain K newlines, K+1 lines are affected. Handle both paths explicitly.
- Add a private helper `private spliceLines(oldLines, startLine, newContentForRange): { lines, offsets }` that both `insert` and `delete` use. Keep the line-rebuild logic in one place.
- Explicitly preserve equivalence with `FunctionalTextBufferImpl.create(content)` for these edge cases: empty buffers, content ending in a trailing newline, insertion at EOF, zero-length deletes (must return equivalent content and caches), deletion through EOF, and columns beyond line length (must use the same clamp behavior as `positionToOffset`). Add targeted cases for each to `test/unit/buffer-perf-invariants.test.ts`.

### Write the incremental-invariants test
- Create `test/unit/buffer-perf-invariants.test.ts` with the four assertions listed in New Files.
- The equivalence test (assertion 1) is the critical regression guard: it constructs the buffer two ways (incremental edits vs. `create` from full content) and asserts `getContent()` matches. Any incremental-derivation bug will fail this.
- The round-trip test (assertion 3) catches offset/line corruption from §1.2 and §1.1 interacting.
- The 1000-random-edits stress test (assertion 4) is the integration guard. Use a simple LCG seeded with a constant (no `Math.random()` — must be deterministic) to pick edit positions.

### Re-run the benchmark and verify the ≥2× target
- Run `bun run bench buffer large` again.
- Compare the `ops/sec` value from the output row where `name` is `buffer` and `size` is `large` against `baseline_large_ops_per_sec` captured in the first step. Compute and record `ratio = after_large_ops_per_sec / baseline_large_ops_per_sec`.
- The target is ≥2× throughput on `large` (the 10k-line fixture). On `small` (500 lines) the improvement may be marginal — that's expected and fine, because the O(file size) cost is small there.
- The benchmark harness enforces wall-time floors, but it does not assert this ratio for you. The completion report must print `baseline_large_ops_per_sec`, `after_large_ops_per_sec`, and `ratio`, and the chore is incomplete if `ratio < 2.0`.
- If the target is NOT met, do NOT relax the floor — investigate which of the three fixes didn't land cleanly (most likely culprit: §1.1's `lines` splice is accidentally still doing full work, or §1.3's optimization isn't being hit because `moveGap` is being called with a moving position every keystroke).

### Run the Validation Commands
- Execute every command in the Validation Commands section, top to bottom, and confirm each passes with zero errors before declaring the chore complete.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run typecheck:src` — Confirm no TypeScript errors after the buffer changes. The new `cumulativeLineOffsets` field and the rewritten `positionToOffset` must typecheck cleanly.
- `bun run typecheck:test` — Confirm `test/unit/buffer-perf-invariants.test.ts` typechecks.
- `bun run typecheck` — Full typecheck (src + test + tmax-use).
- `bun test test/unit/buffer.test.ts` — Existing correctness suite passes UNCHANGED. The create/insert/delete tests at lines 16-45 are the direct regression guards.
- `bun test test/unit/buffer-completion.test.ts` — Buffer completion still works.
- `bun test test/unit/buffer-metadata.test.ts` — Buffer metadata still works.
- `bun test test/unit/buffer-perf-invariants.test.ts` — New incremental-invariants test passes: equivalence with `create`, prefix-sum correctness, round-trip, and 1000-random-edits stress all green.
- `bun test test/unit/` — Full unit suite; zero regressions across the codebase (buffer is used by editor, search, file-ops — a bug here surfaces broadly).
- `bun run bench buffer large` — Harness runs cleanly; the `buffer | large` row shows `after_large_ops_per_sec / baseline_large_ops_per_sec >= 2.0` using the recorded `ops/sec` field. Print baseline, after, and ratio in the chore completion report.
- `bash -lc 'set -euo pipefail; bin/tmax --stop 2>/dev/null || true; rm -f /tmp/tmax-$(id -u)/server.lock; bin/tmax --daemon >/tmp/tmax-chore34.log 2>&1 & for i in $(seq 1 100); do bin/tmaxclient --ping >/dev/null 2>&1 && break; sleep 0.1; done; bin/tmaxclient --ping >/dev/null; echo "daemon-up"; bin/tmaxclient --eval "(buffer-text)" >/dev/null; trap "bin/tmax --stop 2>/dev/null || true" EXIT; echo OK'` — Daemon starts cleanly with the modified buffer and a basic buffer op round-trips. Catches integration regressions the unit tests might miss.

## Notes

- **CHORE-33 is a hard prerequisite.** This chore's final validation step (`bun run bench buffer large`) requires the benchmark harness to exist. If CHORE-33 has not landed, do not start this chore — there is no way to verify the ≥2× target without it.
- **The buffer is already immutable / functional — keep it that way.** `FunctionalGapBuffer` uses `readonly` fields and returns new instances per edit. This chore preserves that discipline: the optimization is *incremental derivation* (compute the new state from the old state's parts without re-deriving from scratch), not mutation of observable prior instances. Local mutation of newly allocated arrays or private owned temporaries is acceptable when it keeps the code simple and no older buffer instance can observe it. The FP discipline (`rules/functional-programming.md`) is authoritative.
- **`moveGap` already has the common-case fast path.** Line `:164-166` returns `this` when `position === gapStart`. Verify this is actually hit on the keystroke path — cursor moves call `moveGap` with a moving position, but typing at the cursor (the dominant case) calls it with `position === gapStart` and should hit the fast path. If profiling shows it isn't being hit, the bug is in the caller, not `moveGap`.
- **The ideal §1.3 fix is ownership-tracked copy-on-write, not bare shared-array mutation.** This chore requires the conservative `slice()` improvement unless the implementer chooses to fully design and test copy-on-write ownership. Sharing `ReadonlyArray` storage and mutating part of it is forbidden because it violates immutable snapshot semantics. A follow-up could back the gap buffer with persistent chunks or another owned backing representation and only allocate the touched region — but that's a larger refactor and should be its own CHORE if the conservative path is insufficient.
- **Equivalence-with-`create` is the strongest correctness guard.** `FunctionalTextBufferImpl.create(content)` builds `lines` from a fresh `splitLines(content)` — it's the source of truth. The incremental paths in `insert`/`delete` MUST produce identical `lines`, `getContent()`, and offset-observable public API results. The new test asserts this for every edit pattern. Any incremental-derivation bug fails this assertion immediately.
- **The ≥2× target is conservative.** On a 10k-line file the current per-keystroke cost is dominated by `toString()` + `splitLines()` over the whole buffer; eliminating that should yield well over 2× in theory. The 2× floor leaves headroom for CI variance and for the `slice()` improvement in §1.3 being less impactful than §1.1/§1.2.
- **Do not relax benchmark floors to manufacture a pass.** If the ≥2× target isn't met, the fix is incomplete — investigate, don't fudge. AGENTS.md §8 is explicit on this.
