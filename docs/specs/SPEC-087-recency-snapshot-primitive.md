# Feature: Non-self-bumping recency primitive for deterministic buffer cycling

> ## Lineage
>
> This spec is the follow-up to **SPEC-073**'s as-built deviation. SPEC-073
> shipped `next-buffer` / `previous-buffer` over a **stable insertion-order**
> rotation (`buffer-rotation-list`) because the originally-intended
> **recency-sorted** cycle is non-deterministic with the current primitives
> (`buffer-switch` bumps recency on every call → `C→B→C→B` ping-pong). See the
> "⚠️ As-built deviation" banner at the top of `SPEC-073-next-previous-buffer.md`.
>
> SPEC-087 closes that gap: add a recency primitive that does **not** bump
> recency on read/switch, then re-point `next-buffer` / `previous-buffer` at the
> **true recency** order so cycling visits every buffer before repeating.

## Goals

- Restore SPEC-073's **original** intent: `next-buffer` / `previous-buffer`
  cycle through buffers by **true recency** (most-recent-first), deterministically
  visiting every live file buffer exactly once per full rotation before
  repeating — no `C→B→C→B` ping-pong.
- Introduce a **non-self-bumping** switch path so a buffer rotation does not
  itself perturb the recency order it is iterating over. The recency order a
  rotation starts with is the order it completes with.
- Keep the existing interactive `switch-buffer` / `SPC x b` / `find-file` path
  **unchanged** — those are explicit user "I am now looking at this buffer"
  actions and MUST continue to bump recency (they drive `buffer-completion-table`
  ordering, the `*Messages*` recency hints, etc.).
- Zero new bindings, zero new M-x names. The user-facing surface (the two
  existing commands + `SPC x n` / `SPC x p`) is unchanged; only the underlying
  ordering becomes deterministic-by-recency.

## Completion Criteria (Definition of Done)

- [ ] A non-self-bumping switch primitive exists and is callable from T-Lisp
      — either `(buffer-switch-silent name)` (a new primitive) OR a documented
      `silent` path inside the existing `buffer-switch`/`setCurrentBuffer`
      mechanism. It MUST set the current buffer (so `(buffer-current)` reflects
      it) WITHOUT calling `touchBuffer` (no `recency` bump).
- [ ] `next-buffer` and `previous-buffer` (in
      `src/tlisp/core/commands/buffers.tlisp`) rotate over **recency-sorted**
      non-special buffers (using the existing `buffer-recency-list` /
      `buffer-detail-more-recent-p` / `buffer-list-details`), NOT the
      insertion-order `buffer-rotation-list`.
- [ ] A full rotation is deterministic: opening A, B, C (recency C newest → B →
      A), then calling `(next-buffer)` three times visits **B, A, C** in that
      order (each buffer exactly once before repeating) — verified by
      `buffer-current` after each step.
- [ ] The opposite direction is deterministic: from C, `(previous-buffer)` three
      times visits **A, B, C**.
- [ ] Sustained switching does NOT ping-pong: `(next-buffer)` called 6 times
      from C over a 3-buffer set yields the cycle `B, A, C, B, A, C` (not
      `B, C, B, C, B, C`).
- [ ] Interactive `switch-buffer` / `find-file` STILL bump recency (their
      `buffer-list-details` / `buffer-completion-table` ordering is unchanged) —
      a regression guard asserts this.
- [ ] `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`
      all pass; `bun run test:tmax-use` is green; the **extended** eval-24
      playbook (see Test Plan) is green.
- [ ] SPEC-073's as-built deviation banner is updated (or a "resolved by
      SPEC-087" note added) so the docs no longer claim recency cycling is
      impossible.

## Root Cause (investigated 2026-08-06)

**The original SPEC-073 framing was correct in intent but blocked by a missing
primitive — it was NOT a logic bug in the rotation math.** The rotation index
arithmetic (`mod` wrap, `buffer-index-of`) is sound; what defeats it is that
the ordering source itself is mutated on every step.

Concrete mechanism (all line numbers current as of `275a9d5`):

1. **`buffer-switch`'s setter always bumps recency.** The `buffer-switch`
   primitive (`src/editor/api/buffer-ops.ts:91-112`) calls
   `setCurrentBuffer(buffer!)` (line 110). `setCurrentBuffer` is the
   EditorContext callback wired in `src/editor/editor.ts:342-357`, whose body
   ends with:
   ```ts
   editor.applyUpdate({ type: "SetCurrentBuffer", buffer: v ?? undefined });
   if (bufferName) {
     editor.touchBuffer(bufferName);          // ← editor.ts:354 — ALWAYS runs
     editor.applyUpdate({ type: "SetCurrentFilename", ... });
   }
   ```
   `touchBuffer` (`editor.ts:2807-2809`) does
   `this.updateBufferMetadata(name, { recency: this.bufferRecency++ })` — so
   **every** `buffer-switch` promotes the just-switched-to buffer to
   most-recent.

2. **`next-buffer` recomputes the recency list on every call.** Were it to use
   `buffer-recency-list` (`buffers.tlisp:28-32`, which is
   `(stable-sort "buffer-detail-more-recent-p" (buffer-list-details))`), each
   call would re-sort, putting the buffer it just switched to at index 0. With
   the "next index = current+1" rule, the next call switches to the OLD index-0
   buffer, which then itself becomes index 0 → strict two-buffer oscillation
   `C→B→C→B…`, never visiting A.

3. **SPEC-073's workaround.** To stay deterministic with the primitives
   available, SPEC-073 shipped `buffer-rotation-list` (`buffers.tlisp:48-55`)
   over `(filter non-special (buffer-list))` — Map insertion order, which is
   stable across switches (it never re-sorts). Its `next-buffer`
   (`buffers.tlisp:100-114`) / `previous-buffer` (`buffers.tlisp:116-127`)
   consume that. This is why eval-24 (insertion order == fresh-open recency at
   step 0) passes: the divergence only appears under sustained switching, which
   the current playbook does not stress.

**The missing piece is a switch path that does not bump recency** — the recency
order then stays fixed for the duration of one rotation, making
`buffer-recency-list` safe to consume. The existing `buffer-bury` primitive
(`buffer-ops.ts:974-1036`, threaded via the `buryBuffer` Editor-owned hook at
`editor.ts:421` and implemented at `editor.ts:3073-3082`) is the proven pattern
for an Editor-owned recency mutator that the primitive layer cannot perform
locally — `buffer-switch-silent` mirrors it for the no-bump case.

## Implementation Plan

The fix has two layers: a TypeScript primitive + an Editor-owned no-bump switch
method (mirroring the `buryBuffer` hook pattern), then a T-Lisp change that
swaps the rotation's ordering source. The recommended approach is **(A)**: a
dedicated `buffer-switch-silent` primitive. It keeps the no-bump contract
explicit at the call site and avoids an implicit-flag overload of
`buffer-switch` (which every other caller expects to bump).

### Layer 1 — TypeScript: a non-bumping switch primitive (approach A)

1. **Add an Editor-owned `switchBufferSilent` method** in
   `src/editor/editor.ts`, next to `buryBuffer` (~line 3073). It performs
   everything `setCurrentBuffer`'s callback does EXCEPT the `touchBuffer` call:
   - Re-resolve the buffer name → `TextBufferImpl` (mirror lines 326-328).
   - Update the current tab's `buffer`/`bufferName` if the tab label matches
     (mirror lines 329-340).
   - Update the current window's `buffer`/`bufferName` (mirror lines 342-351).
   - `this.applyUpdate({ type: "SetCurrentBuffer", buffer })`.
   - `this.applyUpdate({ type: "SetCurrentFilename", filename:
     this.bufferMetadata.get(name)?.filename })`.
   - **Do NOT** call `this.touchBuffer(name)`.
   Return `name` (or `null` if the buffer is not live), matching `buryBuffer`'s
   return shape so the primitive's error path mirrors `buffer-bury`.

2. **Thread it through `EditorAPIContext`** (NOT the internal EditorContext at
   `editor.ts:421`). The existing `buryBuffer` hook — the exact pattern to
   mirror — is declared as an optional field on the `EditorAPIContext`
   interface (`src/editor/runtime/editor-api-context.ts:139`), bound in the
   `tlispState: EditorAPIContext` object assembled at `editor.ts:316`
   (`buryBuffer: (name) => editor.buryBuffer(name)`), and passed into
   `createBufferOps(...)` at `src/editor/tlisp-api.ts:154-166` (the
   `ctx.buryBuffer` arg). Replicate all three for `switchBufferSilent`:
   - Add `switchBufferSilent?: (name: string) => string | null` to
     `EditorAPIContext` (next to `buryBuffer`).
   - Bind it in the `editor.ts:316` `tlispState` object
     (`switchBufferSilent: (name) => editor.switchBufferSilent(name)`).
   - Pass `ctx.switchBufferSilent` as the trailing arg at the
     `createBufferOps(...)` call in `tlisp-api.ts:154-166` (after
     `ctx.buryBuffer`).

3. **Add the `buffer-switch-silent` primitive** in
   `src/editor/api/buffer-ops.ts`. Mirror `buffer-bury` (lines 974-1036)
   exactly:
   - Extend the `createBufferOps` parameter list (line 43-52) with
     `switchBufferSilent?: (name: string) => string | null` (after `buryBuffer`).
   - Add `api.set("buffer-switch-silent", (args) => { ... })`:
     - `validateArgsCount(args, 1, "buffer-switch-silent")`.
     - `validateArgType(nameArg, "string", 0, "buffer-switch-silent")`.
     - `validateBufferExists(buffers.get(name), name)`.
     - If `!switchBufferSilent`, return the same `ConstraintViolation` shape
       `buffer-bury` uses (lines 1018-1026) — there is no correct local
       fallback (the no-bump contract lives in Editor).
     - `const switched = switchBufferSilent(name);` → return
       `Either.right(createString(switched))` (or a not-found `InvalidOperation`
       if `null`, mirroring `buffer-bury`'s `buried === null` branch).
   - Pass the new hook through at the `createBufferOps(...)` call site in
     `editor.ts` (search for where `buryBuffer:` is passed — it is the same
     EditorContext assembly; add `switchBufferSilent:` alongside).

   *Why a new primitive and not a flag on `buffer-switch`*: `buffer-switch`'s
   setter is shared by every insert/delete primitive
   (`buffer-ops.ts:292,352,401,488,...`) — those legitimately need the recency
   bump (the user just typed into the buffer). A `silent` flag on the shared
   setter would be a foot-gun; a dedicated primitive makes the no-bump contract
   unmissable. (Approach B — a flag — is documented in "Alternatives" below for
   completeness but is NOT the recommended path.)

### Layer 2 — T-Lisp: re-point the rotation at true recency

4. In `src/tlisp/core/commands/buffers.tlisp`, change `next-buffer`
   (`buffers.tlisp:100-114`) and `previous-buffer` (`buffers.tlisp:116-127`):
   - Replace `(buffer-rotation-list)` with `(buffer-recency-list)` (already
     defined at `buffers.tlisp:28-32`, currently unused by the cycle).
   - Replace the `(buffer-switch ...)` call inside each with
     `(buffer-switch-silent ...)` so the rotation does not perturb the recency
     order it just read.
   - Direction semantics: `buffer-recency-list` is most-recent-first.
     `next-buffer` should go to the **next most recent** after the current
     (index `idx+1`); `previous-buffer` to the **previous most recent**
     (index `idx-1`). Recency order is newest-first, so the new formulas are
     `(mod (+ idx 1) len)` for next and `(mod (+ idx (- len 1)) len)` for
     previous. **Do NOT use `(mod (- idx 1) len)` for previous** — T-Lisp
     `mod` is the raw JS `%` operator (see `src/tlisp/evaluator.ts:3918`),
     which does NOT wrap negatives, so `(mod -1 3)` returns `-1` (verified),
     not `2`; `(mod (- idx 1) len)` would break at `idx=0`. The `(+ idx
     (- len 1))` form keeps the operand non-negative so `%` wraps correctly.
   - Keep the `(< idx 0)` fallback (current buffer filtered out / special) →
     start at index 0 for next, index `len-1` for previous.
   - Update the two docstrings: replace "stable buffer-list order" with
     "recency order (most-recent-first)".

5. **Leave `buffer-rotation-list` in the module** (do not delete) — it is
   exported and may be referenced elsewhere. Mark it with a comment that
   SPEC-087 supersedes it for `next-buffer`/`previous-buffer`. (Per CLAUDE.md
   §3: do not remove pre-existing dead code unless asked.)

### Layer 3 — docs + verification

6. Update the SPEC-073 as-built banner: add a one-line "Resolved by SPEC-087:
   `next-buffer`/`previous-buffer` now cycle by true recency via
   `buffer-switch-silent`." Do not rewrite the banner — just append.
7. Run `bun run typecheck:src` → `bun run typecheck:test` → `bun run typecheck`.
8. Run the extended eval-24 (Test Plan). Iterate until green.

### Alternatives considered (NOT chosen)

- **(B) A `silent`/`no-bump` flag on `buffer-switch`** (e.g. a 2nd optional
  arg). Rejected: the shared `setCurrentBuffer` setter serves every mutating
  primitive; a flag risks silent regressions where a caller forgets it. A
  dedicated primitive makes the contract explicit.
- **(C) A `buffer-recency-snapshot` read primitive** that returns the recency
  order as a frozen list, consumed across one rotation. Rejected on its own:
  it does not solve the bump — `buffer-switch` inside the rotation still
  perturbs the live order, so the snapshot would diverge from `(buffer-current)`
  reality mid-rotation. It only works paired with (A). If a future feature
  wants a stable recency snapshot for display, it can be added later; SPEC-087
  does not require it.

## Codex adversarial review (2026-08-06) — corrections

Two factual errors in the proposed code/wiring, both fixed in place above:

1. **`mod` does not wrap negatives — wrong reverse-cycle formula.** The spec
   originally proposed `(mod (- idx 1) len)` for `previous-buffer` and hand-waved
   "T-Lisp `mod` already wraps negatives." Verified against
   `src/tlisp/evaluator.ts:3918`: `mod` is the raw JS `%` operator, so
   `(mod -1 3)` returns `-1`, not `2`. At `idx=0` the formula yields `-1`
   (out of range for `nth`) → `previous-buffer` from the most-recent buffer
   breaks. Corrected to `(mod (+ idx (- len 1)) len)`, which keeps the operand
   non-negative so `%` wraps correctly. An `idx=0` regression step was added
   to the Test Plan.

2. **Wiring goes through `EditorAPIContext` + `tlisp-api.ts`, not
   `editor.ts:421`.** The spec conflated two context objects. `editor.ts:421`
   is the internal `EditorContext` (where the `setCurrentBuffer` *setter* lives,
   the one whose `touchBuffer` we work around) — it is NOT where `buryBuffer`
   is threaded. The real `buryBuffer` path — the exact pattern to mirror — is:
   `EditorAPIContext` interface (`editor-api-context.ts:139`) → bound in the
   `tlispState` object at `editor.ts:316` → passed as `ctx.buryBuffer` to
   `createBufferOps(...)` at `tlisp-api.ts:154-166`. Layer-1 step 2, the
   Relevant Files list, and the new `createBufferOps` param were corrected to
   this path.

   **Carry-over obligation for the implementer:** adding `buffer-switch-silent`
   raises the live primitive count from 366 → 367. Two inventory gates must be
   updated in lockstep or the build will fail the registry test: append
   `buffer-switch-silent` to `.chore44-baseline/api-names-static.txt`, and bump
   the hardcoded `366` (lines 8, 37, 45 of
   `test/unit/editor-api-registry.test.ts`) to `367`.

## Test Plan

**Extend `tmax-use/playbooks/eval-24-next-previous-buffer.yaml`** (do not remove
existing steps — add a "sustained cycling" block after the current
`previous-buffer` block, before the keybinding block):

- **Deterministic full cycle (next):** from the setup state (C newest, B, A),
  assert `(next-buffer)` × 3 yields `B`, `A`, `C` (in that order), each via
  `(buffer-current)` `result_contains`. This replaces the implicit
  insertion-order pass-through: the current playbook's `C→B→A→C` happens to
  match recency at step 0, so it stays green but now exercises the recency
  path.
- **Sustained (no ping-pong):** `(next-buffer)` × 6 from C asserts the
  sequence `B, A, C, B, A, C` — i.e. `(buffer-current)` after each call matches
  that exact rotation. This is the regression that would have caught the
  bump-on-switch bug. (Implement as 6 named steps with one `result_contains`
  each, matching the playbook's existing one-step-per-expect style.)
- **Reverse sustained:** `(previous-buffer)` × 3 from C asserts `A, B, C`.
- **idx=0 wrap regression (previous-buffer):** call `(previous-buffer)`
  exactly once from the **most-recent** buffer (index 0 in
  `buffer-recency-list`, e.g. C) and assert it lands on the **least-recent**
  buffer (index `len-1`, i.e. A), not an error / not staying on C. This is the
  case the original `(mod (- idx 1) len)` formula would have broken (T-Lisp
  `(mod -1 3)` → `-1`, out of range for `nth`).
- **Interactive bump preserved (regression guard):** after a
  `(switch-buffer)` / `(find-file)` to a non-current buffer, assert that
  buffer is now most-recent — e.g. `(buffer-recency-list)`'s first element
  (`(car (buffer-recency-list))`) `result_contains` the just-switched-to name.
  This proves the silent path did NOT leak into the interactive path.
- **Single-buffer + `*scratch*` no-error:** keep the existing one-buffer guard.

**Unit/integration (`test/unit/`):** if a T-Lisp-level unit harness exists for
`buffers.tlisp`, add an assertion that `(buffer-switch-silent "X")` does NOT
change `X`'s recency rank (compare `(buffer-recency-list)` before and after —
the relative order of the other buffers is unchanged and `X` stays at its
pre-call rank). If no such harness exists, the eval-24 sustained-cycling steps
cover it at the e2e level.

**Commands to run before reporting complete:**
```
bun run typecheck:src
bun run typecheck:test
bun run typecheck
bun run test:tmax-use     # includes the extended eval-24
```

## Relevant Files

Read these before implementing (all paths verified against `275a9d5`):

- **`src/editor/editor.ts`**
  - Lines 342-357 — the `setCurrentBuffer` EditorContext callback; line 354 is
    the unconditional `touchBuffer(bufferName)` that this spec works around.
  - Lines 2807-2809 — `touchBuffer` (the recency bump).
  - Lines 3073-3082 — `buryBuffer`, the **method to mirror** for
    `switchBufferSilent` (Editor-owned recency mutator).
  - Line 316 — the `tlispState: EditorAPIContext` object where `buryBuffer` is
    bound into the context; bind `switchBufferSilent` here (NOT line 421,
    which is the internal EditorContext, a separate object).
- **`src/editor/runtime/editor-api-context.ts`** — line 139 declares the
  optional `buryBuffer` field; add `switchBufferSilent` here (this is the
  interface the primitive layer reads).
- **`src/editor/tlisp-api.ts`** — lines 154-166, the `createBufferOps(...)`
  call site; pass `ctx.switchBufferSilent` as the trailing arg after
  `ctx.buryBuffer`.
- **`src/editor/api/buffer-ops.ts`**
  - Lines 43-52 — `createBufferOps` signature; add the `switchBufferSilent`
    optional param here (after `buryBuffer`).
  - Lines 91-112 — `buffer-switch` primitive (the bumping path; do NOT modify).
  - Lines 974-1036 — `buffer-bury` primitive, the **pattern to mirror** for
    `buffer-switch-silent` (validation + Editor-owned-hook fallback).
- **`src/tlisp/core/commands/buffers.tlisp`**
  - Lines 28-32 — `buffer-recency-list` (already defined; becomes the rotation
    source).
  - Lines 48-55 — `buffer-rotation-list` (current insertion-order source;
    superseded but left in place).
  - Lines 100-114 — `next-buffer` (swap to `buffer-recency-list` +
    `buffer-switch-silent`, fix direction arithmetic).
  - Lines 116-127 — `previous-buffer` (same).
- **`tmax-use/playbooks/eval-24-next-previous-buffer.yaml`** — extend with
  sustained-cycling + interactive-bump-preserved steps (see Test Plan).
- **`docs/specs/SPEC-073-next-previous-buffer.md`** — append a "Resolved by
  SPEC-087" line to the as-built banner.

### New Files

- None (all changes are edits to existing files).
