# RFC-019: Performance Audit — Hot-Path and Allocation Hotspot Remediation

**Status:** Proposed
**Date:** 2026-06-21
**Related:** [CHORE-33-perf-benchmark-harness](../specs/CHORE-33-perf-benchmark-harness.md), [CHORE-34-perf-phase1-buffer-fixes](../specs/CHORE-34-perf-phase1-buffer-fixes.md), [RFC-009](RFC-009-elm-purity-gap-analysis.md) (the FP/Elm-purity layer these results sit behind), [rules/functional-programming.md](../../rules/functional-programming.md)

## Summary

A static-analysis performance audit across six subsystems — buffer, T-Lisp interpreter, daemon/client RPC, syntax highlighting, rendering, and search — found a single root cause repeated everywhere: **every keystroke currently does O(file size) work when only one line changed.** The keystroke path (key → daemon → T-Lisp → buffer edit → serialize → socket → re-tokenize → repaint) re-materializes the whole buffer, re-splits it into lines, re-tokenizes the viewport, ships the full text over JSON, and clears + repaints the entire screen.

On a 10k-line file, each keystroke currently performs roughly 10,000 unnecessary string operations. None of this is required by the editor's functional style — the regression is caused by a missing incremental-update layer, not by FP itself.

This RFC catalogues **all 30 findings**, groups them by subsystem, ranks them by ROI, and proposes a phased remediation. It is **not approved for implementation**; it documents the candidate direction. Two follow-on CHOREs are pre-filed to act as the entry points: CHORE-33 (the benchmark harness, prerequisite for any before/after measurement) and CHORE-34 (Phase 1 — the highest-leverage buffer fixes).

## Motivation

### The measurement gap

Right now every claim below is static analysis. There are no perf numbers in the repo. The only perf-shaped test (`test/unit/tail-call-performance.test.ts`) is a stack-overflow check, not a throughput benchmark. Before touching anything we need a benchmark harness (CHORE-33) so each fix can show a real before/after.

### Why this matters

- **Latency over SSH.** Full-screen repaint + per-keystroke full-buffer serialization dominate remote-editing latency. This is the most user-visible cost.
- **GC pressure.** Per-keystroke allocation of whole-buffer strings, `Either[]` arrays, and rule-sort arrays produces steady GC churn that compounds on large files.
- **Scalability ceiling.** tmax currently feels fine on a 500-line file and degrades sharply on a 10k-line file, with no inherent reason it should — the gap buffer is already the right data structure; the surrounding incremental bookkeeping is just missing.

## Design

The remediation is grouped into five tiers. Tiers 1–3 are on the per-keystroke hot path; Tiers 4–5 are off the hot path but affect daemon responsiveness and long-running memory.

### Tier 1 — Per-keystroke hot path (highest ROI)

These seven findings together account for the bulk of the per-keystroke O(file size) cost.

#### 1.1 Maintain `lines` incrementally; stop re-splitting on every edit
**Location:** `src/core/buffer.ts:295, 300, 324, 329`

Every `insert`/`delete` on `FunctionalTextBufferImpl` calls `newGapBuffer.right.toString()` (`:295`, `:324`) then `splitLines(...)` (`:300`, `:329`) on the **entire buffer**. For a 100k-char file this is ~100k single-char string allocations + a full string split, per keystroke.

**Fix:** Re-split only the affected line range; keep the unchanged prefix/suffix of `lines` by reference. Alternatively, back the gap buffer with a `string` + gap offsets rather than `Array<string|undefined>`.

#### 1.2 Cache cumulative line offsets (prefix sums)
**Location:** `src/core/buffer.ts:393-405`

`positionToOffset` loops from line 0 on every call. Cursor on line 10k → ~10k string-length reads per insert. `delete` calls it twice (start + end).

**Fix:** Maintain a `cumulativeOffset[]` prefix-sum array; `positionToOffset` becomes `cumulativeOffset[line] + column` in O(1). Invalidate the suffix on edit.

#### 1.3 Stop cloning the whole gap array on every edit
**Location:** `src/core/buffer.ts:168` (`moveGap`), `:224` (`insertIntoGap`)

`const newBuffer = [...this.buffer]` copies the entire backing array even for a 1-char insert at the current gap position — the common case.

**Fix:** In-place mutation when uniquely referenced (copy-on-write), or structural head/tail sharing.

#### 1.4 Stop shipping full buffer text per keystroke
**Location:** `src/server/server.ts:1493` + `src/server/serialize.ts:73`

`editorStateToJson` embeds `buffer.getContent()` (full `lines.join`) **plus every window/tab's content**. The client `JSON.parse`s it (`src/client/remote-editor.ts:118`) and re-splits it into a new buffer (`serialize.ts:100`) — all per keystroke.

**Fix:** Return deltas or a dirty-region descriptor; client applies the patch to its cached buffer.

#### 1.5 Remove `clearScreen()` + full repaint; diff-render instead
**Location:** `src/client/tui-client.ts:67`

Every keystroke writes `\x1b[2J` and rewrites every row with a separate cursor-position escape. Over SSH this is the dominant latency.

**Fix:** Keep a `string[]` of the last frame; only write rows that changed, using `\x1b[K` per row. Drop `clearScreen()` once diffing is in place.

#### 1.6 Memoize viewport syntax highlighting
**Location:** `src/client/tui-client.ts:62` + `src/syntax/tokenizer.ts:207`

`computeHighlightSpans` re-tokenizes the whole visible viewport every frame, and `tokenizer.ts:207` allocates + sorts a fresh `rules` array **per line tokenized**. Multi-line constructs (block comments, template strings) force re-tokenization from the top of the viewport each frame.

**Fix:** Cache spans keyed by `(filename, lineNumber, lineText, incomingParseState)`; invalidate only lines whose text changed. Sort rules once at language registration, store on the language module.

#### 1.7 Make the post-render `sendEvent("render")` fire-and-forget
**Location:** `src/client/tui-client.ts:205`

`await remote.sendEvent("render", ...)` adds a second blocking RPC per keystroke, serializing input. For pasted keys this doubles latency.

**Fix:** Drop the `await` (or remove the call if the daemon doesn't need it for correctness).

### Tier 2 — Interpreter (per-keystroke)

#### 2.1 Make tail-call optimization actually work
**Location:** `src/tlisp/evaluator.ts:194-195, 248-249, 1471, 1516`

TCO is implemented (trampolines at `:204`, `:255-267`) but **dead** — `eval`/`evalAsync` never seed `inTailPosition=true`, so `evalFunctionCall` (`:2227`) takes the `else` branch and lambda bodies recurse via plain JS recursion. Stack-overflow risk + slower than necessary.

**Fix:** Seed `inTailPosition=true` when evaluating lambda bodies; route returned tail calls through the trampoline.

#### 2.2 Cache module-export resolution
**Location:** `src/tlisp/module-registry.ts:108-183`

Every `/`-qualified symbol (`trt/assert`, etc.) triggers `listExports()` (`:108-136`) which builds fresh `Array.from(modules.values())`, filters, builds `exportCounts` map, and walks every export of every module — every call. `resolveUniqueExport` (`:151-156`) does the same.

**Fix:** Maintain a `Map<publicName, ModuleExportRecord>` updated incrementally on `register`/`setLoaded`.

#### 2.3 Add a parse cache for repeated T-Lisp commands
**Location:** `src/tlisp/interpreter.ts:149-172` (`execute`), `:174-198` (`executeAsync`); `src/editor/handlers/normal-handler.ts:48`

Every keystroke runs `interp.execute("(vim-reset-pending)")` etc., which re-tokenizes and re-parses the same source string. Same string → same AST.

**Fix:** Memoize `parseProgram` by source-string hash. The strings are small and heavily repeated on the keystroke path.

#### 2.4 Collapse symbol-lookup scope walks
**Location:** `src/tlisp/evaluator.ts:355-431`

`evalSymbol` can walk the env parent chain **up to four times** per name (qualified-alias walk, selective-import walks for qualified and unqualified, then the final `env.lookup` at `:431`).

**Fix:** Single pass checking bindings + moduleImports together; or cache resolved import→value bindings on the environment.

#### 2.5 Skip per-call `Either` allocation for builtins
**Location:** `src/tlisp/evaluator.ts:2215-2248`, `src/utils/task-either.ts:25-29`

Each function call allocates an `Either[]` of arg results then `.map(r => r.right)` to unwrap — two arrays + N wrappers per call, several calls per keystroke.

**Fix:** Have builtins return `TLispValue | EvalError` directly (tagged union), skipping the wrapper and the post-call `.map`.

#### 2.6 Hoist tokenizer char-class regexes to module constants
**Location:** `src/tlisp/tokenizer.ts:230-244`, `src/tlisp/parser.ts:293`

`/\s/.test(char)`, `/^-?\d+.../.test(token)` compiled/re-tested per character of the source.

**Fix:** Module-level regex constants, or char-code comparisons (`c >= 97 && c <= 122`).

### Tier 3 — Rendering & Search (per-frame)

#### 3.1 Eliminate redundant `stringWidth` walks per line
**Location:** `src/frontend/render/buffer-lines.ts:180-185, 563-565`

For each visible line the renderer computes visible width 4–5 times: `stringWidth(rawLine)` in `fitToWidth`, again after stripping ANSI in `padAnsiToWidth`, again in the multi-window merge, again in the cursor-row scan.

**Fix:** Compute once per line; thread it through.

#### 3.2 Stop re-stripping ANSI codes with regex per padded line
**Location:** `src/frontend/render/buffer-lines.ts:180, 563`

A global `/\x1b\[[0-9;]*m/g` runs on every highlighted line, every frame, just to re-measure width that was known pre-styling.

**Fix:** Carry the pre-styling visible width into the padding step.

#### 3.3 Replace char-by-char row rebuild for window separators
**Location:** `src/frontend/render/buffer-lines.ts:570-582`

`row.slice(0, x) + ch + row.slice(x+1)` inside a loop → O(cells × width) per row, and the index can land inside an ANSI escape.

**Fix:** Build rows as `string[]` once, overlay separators by index, join at the end.

#### 3.4 Fuse the per-line `map().filter().map()` span chain
**Location:** `src/frontend/render/buffer-lines.ts:332-335`

Three fresh arrays per highlighted line per frame (`clampSpans`, then `.map().filter().map()`).

**Fix:** Single-pass reduce, or cache the styled output keyed by `(line, lineText, viewportLeft, cw)`.

#### 3.5 Search ops: operate on lines, not re-joined buffer
**Location:** `src/editor/api/search-ops.ts:68, 124, 475, 659, 754, 818`

Every search builtin calls `getContent()` (O(n) join) then `text.split('\n')` (O(n) split). Incremental search re-runs this per character typed.

**Fix:** Iterate `buffer.getLine(i)` directly against a cached line array invalidated on edit.

#### 3.6 Incremental search: only highlight the visible viewport
**Location:** `src/editor/api/search-ops.ts:754-767, 818-828`

Builds **all** match ranges across every line on each keystroke. O(file) per char just for highlighting.

**Fix:** Compute viewport ranges lazily on scroll.

#### 3.7 Use `lastIndexOf` instead of the O(n×m) find-previous loop
**Location:** `src/editor/api/search-ops.ts:131-158`

A broken first pass (early `break` at `:136-144` — dead code) plus a collect-all-then-take-last pattern.

**Fix:** `lineText.lastIndexOf(pattern, currentColumn - 1)`.

### Tier 4 — Async & I/O (not per-keystroke, but stall the daemon)

#### 4.1 Force async FS builtins in the daemon
**Location:** `src/editor/api/file-ops.ts:123, 151, 174, 212, 248, 277, 304, 331, 379-392`

Sync `readFileSync`/`existsSync`/`statSync`/`copyFileSync` block the single-threaded daemon during any `(read-file-content …)`. Async branches already exist alongside each one.

**Fix:** Use the async path unconditionally on the daemon.

#### 4.2 Cache file reads for hot paths
**Location:** `src/core/filesystem.ts:48`

Init files, mode files, and stdlib get re-read from disk on every access.

**Fix:** LRU/mtime cache for `.tlisp` reads.

#### 4.3 Coalesce workspace capture + dirty save
**Location:** `src/server/server.ts:1486-1487`

Every keystroke runs `captureActiveWorkspace()` (full `exportWorkspace` → three Map rebuilds) then `scheduleDirtyWorkspaceSave`.

**Fix:** Capture only on a debounce fire, not per key.

#### 4.4 Stop per-keystroke O(buffers) identity scan
**Location:** `src/server/server.ts:552`

`Array.from(buffers.entries()).find(([, b]) => b === currentBuffer)` runs when `currentBufferName` is unset.

**Fix:** Store `currentBufferName` authoritatively on the frame.

#### 4.5 Replace client poll `JSON.stringify` comparison with a version counter
**Location:** `src/client/tui-client.ts:184`

Every 200ms: two full JSON serializations of the entire EditorState (including buffer text) just for an equality check.

**Fix:** Monotonic `version` integer on the server; compare ints.

### Tier 5 — Long-running / memory

#### 5.1 Append-only `*Messages*` updates
**Location:** `src/editor/editor.ts:2360`

Every `logMessage` re-renders the entire log view and constructs a fresh `FunctionalTextBufferImpl`, splitting all log text into lines.

**Fix:** Append-only edit to the existing `*Messages*` buffer.

#### 5.2 Make `*Messages*` ring eviction O(1)
**Location:** `src/editor/log-store.ts:50-52`

`entries.splice(0, len - maxSize)` shifts the whole array on every overflow write. The scrollback code already uses a circular buffer (`src/core/scrollback.ts`) — do the same here.

#### 5.3 Stop invalidating the log render cache on every write
**Location:** `src/editor/log-store.ts:64, 81`

Cache is dirtied on every single log write, so under steady logging it never hits.

**Fix:** Append-only render — keep last rendered text, append new entries.

#### 5.4 Delete the unbounded `this.messages` array
**Location:** `src/editor/editor.ts:104, 2357`

Separate from the capped `Log` ring — grows forever in long-running daemons.

**Fix:** Remove; rely on the capped `Log`.

#### 5.5 LRU-cap `search-find-all-matches` results
**Location:** `src/editor/api/search-ops.ts:660-672`

Allocates a nested TLisp list per match — heavy GC pressure on large files.

**Fix:** Cap results or return a lazy cursor.

### Bug-adjacent perf issues (worth fixing alongside)

These were found during the perf audit and are likely correctness bugs, surfaced here so they aren't lost:

- **`src/editor/editor.ts:3278`** — `recomputeHighlights` clamps visible-line count with `tabSize` (default **4**) instead of viewport height, so it tokenizes the wrong window. Latent bug.
- **`src/frontend/render/buffer-lines.ts:365`** — `renderWithBlockCursor` uses `cursorColumn` instead of `effectiveCursorCol` (likely cursor-position bug on wrapped lines).
- **`src/editor/api/search-ops.ts:136-144`** — dead code (early `break`) in `findPreviousMatch`.

## Alternatives Considered

### "Just rewrite the buffer in C/Rust via a native addon"
Rejected. tmax's design principle is zero external dependencies (`AGENTS.md` project overview). All the Tier 1 wins are achievable in TypeScript by adding the missing incremental bookkeeping; the gap buffer is already the right structure. A native buffer would be a major architectural departure and wouldn't fix the RPC/serialize/render issues that account for the bulk of the latency.

### "Adopt fp-ts / effect-ts and get performance for free"
Rejected. The FP layer is not the cause — `FunctionalGapBuffer` is correctly immutable with one allocation per edit. The regression is the *missing* incremental layer (no `cumulativeOffset` cache, no `lines` diffing), not the FP style. Adding a dependency would not fix any of the 30 findings and would violate the zero-deps principle.

### "Wait for a real profiler before doing anything"
Partially accepted. CHORE-33 exists precisely to add measurement before changes. The static findings above are accurate (verified by direct code reading), but the *magnitude* of each is unmeasured. The phased plan defers everything in Tier 2+ until the harness is in place and Phase 1 buffer fixes are measured.

## Phased Plan

```
Phase 0 (prerequisite): CHORE-33 — build the benchmark harness.
  Verify: keystrokes/sec baseline on a 10k-line file (cold + warm).

Phase 1 (per-keystroke, ~3 surgical fixes, biggest wins):
  CHORE-34 — buffer.ts: incremental lines + offset cache + stop array clone.
  Verify: re-run harness; target ≥2× keystrokes/sec on a 10k-line file.

Phase 1b (per-keystroke, network/render):
  #5 frame diff + fire-and-forget render event
  #6 rule pre-sort + span cache
  Verify: harness + a new "rendered frames/sec" metric.

Phase 2 (interpreter):
  #1 TCO fix, #2 module-export cache, #3 parse cache.
  Verify: harness + a new "T-Lisp evals/sec" microbenchmark.

Phase 3 (network/serialize):
  #4 stop shipping full buffer per keystroke (delta protocol)
  #25 version-counter poll.
  Verify: harness + a "bytes-per-keystroke" metric over the socket.

Phase 4 (rendering polish, search, messages):
  #14-20, #26-28.
  Verify: harness + a "search chars/sec" microbenchmark for incremental search.

Phase 5 (async/IO):
  #21-24, #29-30.
  Verify: a "daemon responsiveness under FS load" test.
```

## Non-Goals

- **Rewriting the editor as a state machine.** RFC-009 already covers the broader Elm-purity question; this RFC is narrowly about performance.
- **Changing the FP discipline.** `rules/functional-programming.md` and the FP skill stay authoritative; the fixes here are localized.
- **Adding external dependencies.** Out of scope by project principle.

## Open Questions

1. **Delta protocol shape for §1.4.** A dirty-region descriptor vs. a CRDT-style patch. The CRDT would unlock collaborative editing (RFC-002 territory) but is much larger scope. Defer to a sub-RFC once Phase 1 lands.
2. **Highlighting cache eviction under multi-line constructs.** A change to a `/* ... */` opener invalidates every subsequent line until the closer — how aggressive should the invalidation be? Defer to the Phase 1b CHORE.
3. **Whether to keep the synchronous FS builtins at all.** Tier 4.1 makes them async in the daemon, but they're also used in the standalone `tlisp` CLI where blocking is acceptable. The resolution is a per-profile policy, not a deletion.

## Status & Trigger

**Not approved for implementation.** This RFC documents the audit results and a candidate remediation path. Two follow-on CHOREs are pre-filed:
- **CHORE-33** — benchmark harness (Phase 0 prerequisite).
- **CHORE-34** — Phase 1 buffer fixes (highest-ROI surgical work).

The remaining tiers become their own CHOREs once Phase 1 has measured before/after numbers, so the magnitude of each subsequent fix can be weighed against its cost.
