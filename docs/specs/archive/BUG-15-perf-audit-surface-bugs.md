# Bug: Three Correctness Issues Surfaced by RFC-019 Performance Audit

## Bug Description

Three independent correctness bugs in the rendering and search subsystems were surfaced during the static performance audit documented in [RFC-019](../rfcs/RFC-019-performance-audit.md). They are catalogued in the RFC's "Bug-adjacent perf issues" section but are correctness bugs (not performance issues), so they belong in a separate bug spec rather than the perf CHOREs.

### Bug 1 — `recomputeHighlights` tokenizes the wrong window (uses `tabSize` as visible-line count)
**Location:** `src/editor/editor.ts:3278`

```ts
const endLine = Math.min(startLine + (this.state.config?.tabSize ?? 50), lines.length);
```

`recomputeHighlights()` is supposed to tokenize "the visible viewport" (per SPEC-035, archived), but it clamps the visible-line count with `config.tabSize` — which defaults to **4** (tab-stop width, completely unrelated to viewport height). With the default config the method tokenizes only 4 lines starting at `viewportTop`. The fallback `?? 50` only fires when `tabSize` is unset, which it never is in practice.

**Additional finding (changes the fix):** A consumer audit shows `state.highlightSpans` is **only ever written, never read** by production code. The TUI client (`src/client/tui-client.ts:62-64`) computes its own spans independently via `computeHighlightSpans(getLine, vt, vt + bufferHeight, currentFilename)` and never touches `state.highlightSpans`. So the daemon-side `recomputeHighlights()` is computing a value nothing consumes, with a buggy window-size calculation.

### Bug 2 — Block cursor renders at the wrong column on scrolled non-highlighted lines
**Location:** `src/frontend/render/buffer-lines.ts:365`

```ts
const lineContent = fitToWidth(rawLine, cw);
const rendered = isCurrentLine ? renderWithBlockCursor(lineContent, cursorColumn) : lineContent;
```

`renderWithBlockCursor(text, cursorCol)` indexes into the rendered text by **visible position** (it walks `text[i]` counting `visiblePos` until it hits `cursorCol`). Line 365 passes the raw `cursorColumn` — but the surrounding render path already accounts for horizontal scroll via `effectiveCursorCol = Math.max(0, cursorColumn - viewportLeft)` (computed at line 318). The other three render branches correctly use `effectiveCursorCol` (lines 338, 347, 361); only this non-highlighted, non-wrapped branch uses the un-offset `cursorColumn`. On a horizontally-scrolled viewport the block cursor lands at the wrong character (or past end-of-line) on plain-text buffers.

### Bug 3 — Dead code in `findPreviousMatch` (broken first loop, then redundant second pass)
**Location:** `src/editor/api/search-ops.ts:131-158`

```ts
// First loop: BROKEN — `break`s on first non-match, making it worthless
let index = -1;
for (let i = 0; i < currentColumn; i++) {
  const foundIndex = lineText.indexOf(pattern, i);
  if (foundIndex !== -1 && foundIndex < currentColumn) {
    index = foundIndex;
    i = foundIndex; // Skip ahead
  } else {
    break;  // ← exits on the first non-match, ignores rest of the line
  }
}

// Second loop: does the same work correctly via "collect all, take last"
const allMatches: number[] = [];
let searchFrom = 0;
while (true) {
  const matchIndex = lineText.indexOf(pattern, searchFrom);
  if (matchIndex === -1 || matchIndex >= currentColumn) break;
  allMatches.push(matchIndex);
  searchFrom = matchIndex + 1;
}
if (allMatches.length > 0) {
  return { line: currentLine, column: allMatches[allMatches.length - 1]! };
}
```

The first loop (lines 135-144) computes `index` which is **never used** — the second loop overwrites the result via `allMatches`. The first loop also `break`s on first non-match, so even if `index` were read it would be wrong. This is pure dead code. It's not a *behavior* bug (search currently works because the second loop is correct), but it's misleading, allocates an unused `index` variable, and obscures the correct algorithm. Note: this is the same algorithm the perf audit flagged as O(n×m); the dead-code removal is a minimal fix, the algorithmic fix (use `lastIndexOf`) is RFC-019 Tier 3.7 and out of scope here.

## Problem Statement

Three independent defects:
1. `recomputeHighlights` computes an incorrect (and unused) result.
2. The block cursor renders at the wrong column on scrolled non-highlighted lines, a visible UX defect.
3. `findPreviousMatch` contains dead code that misleads future maintainers about how the algorithm works.

## Solution Statement

- **Bug 1:** Decision required — see "Open question" below. The three candidate fixes are (a) correct the clamp to use real viewport height, (b) delete `recomputeHighlights` and `state.highlightSpans` as dead code, (c) wire the daemon to actually consume `state.highlightSpans` so the TUI client can stop computing its own. Recommended for this bug spec: **(a)** — the minimal, surgical fix that makes the method correct for any future consumer. The dead-code-vs-fix-it decision is a larger architectural question (overlaps RFC-019 Tier 1.6 span caching) and should not be silently made inside a bug fix.
- **Bug 2:** Replace `cursorColumn` with `effectiveCursorCol` at line 365, matching the other three render branches. One-character-class fix.
- **Bug 3:** Delete the dead first loop (lines 135-144) and the unused `index` variable. Keep the second loop as the single source of truth. Minimal removal — no algorithmic change (the `lastIndexOf` optimization is RFC-019 Tier 3.7, out of scope).

## Steps to Reproduce

### Bug 1
1. Open a file with >4 lines in tmax.
2. Scroll so the viewport starts at line 50.
3. Set `tabSize` to a non-default value (e.g. `:set tabSize=2`).
4. Inspect `state.highlightSpans` after `recomputeHighlights()` runs (e.g. via daemon eval).
- **Expected (per SPEC-035):** spans cover the visible viewport (~`bufferHeight` lines).
- **Actual:** spans cover only `tabSize` lines (default 4), regardless of actual viewport height.

### Bug 2
1. Open a file with a long line (>terminal width) in a buffer that has no syntax highlighting (e.g. a `.txt` file, or a mode without span rules).
3. Scroll the viewport horizontally so `viewportLeft > 0` (e.g. `zl` or `zL`).
4. Move the cursor along the line.
- **Expected:** block cursor highlights the character under the actual cursor.
- **Actual:** block cursor highlights the character at `cursorColumn` positions from the left of the *visible* slice, which is wrong once `viewportLeft > 0`.

### Bug 3
1. Read `src/editor/api/search-ops.ts:131-158`.
2. Observe the first loop writes to `index` which is never read, and `break`s early.
- **Expected:** clean single-pass algorithm.
- **Actual:** dead first loop plus redundant working second loop.

## Root Cause Analysis

- **Bug 1:** Likely a typo or copy-paste error during SPEC-035 implementation. The author reached for a "default 50 lines" fallback but mistakenly used `config.tabSize` as the line count, conflating two unrelated config values. The bug persisted because `state.highlightSpans` has no consumer — no test or render path catches the wrong window.
- **Bug 2:** Three of four render branches were updated to use `effectiveCursorCol` when horizontal scrolling landed; the fourth (the non-highlighted, non-wrapped fallback) was missed. The bug only manifests on buffers without syntax highlighting AND with horizontal scroll, a narrow combination that hid it.
- **Bug 3:** Refactor residue. The first loop looks like an earlier (buggy) attempt at the algorithm; the second loop was added as "a better approach" (per the inline comment at line 146) but the first was never deleted.

## Relevant Files
Use these files to fix the bug:

- `src/editor/editor.ts` — Bug 1. The `recomputeHighlights` method (lines 3263-3298). The buggy clamp is at line 3278.
- `src/frontend/render/buffer-lines.ts` — Bug 2. The non-highlighted non-wrapped render branch at lines 363-366; the fix is at line 365. The correctly-behaving branches at lines 338, 347, 361 (all using `effectiveCursorCol`) are the reference.
- `src/editor/api/search-ops.ts` — Bug 3. The dead first loop at lines 135-144 and the unused `index` declaration at line 135. The correct second loop at lines 147-158 stays.
- `src/core/types.ts:269-308` — EditorState definition. Bug 1 fix may need to add a `viewportHeight` field here IF the chosen fix threads real viewport height through (see Open Question). For the recommended fix (a, fixed default), no change here is needed.

**Existing tests that must still pass:**
- `test/unit/search-ops.test.ts` (if it exists — verify) — exercises search; must still pass after Bug 3 removal.
- `test/ui/` renderer tests — must still pass after Bug 2 fix (these send real keys and inspect captured output per AGENTS.md §8).

### New Files
- None. All fixes are edits to existing files. Tests for the fixes are added to existing test files where they exist, or skipped if no test file covers the function (see Validation Commands).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Fix Bug 1 — Correct the `recomputeHighlights` line-count clamp

**User Story**: As a maintainer, I want `recomputeHighlights` to tokenize a sensible visible-line window so that the value it produces is correct for any future consumer, instead of being silently wrong.

- Decide the bug-1 fix shape. The recommended option for this bug spec is the **minimal surgical fix**: replace the `tabSize` clamp with a fixed sensible default (e.g. 50 lines) and update the comment to explain why no real viewport height is available on the daemon side. This matches the original intent (the `?? 50` fallback shows the author expected ~50 lines), removes the conflation with `tabSize`, and is one line of change.
- Edit `src/editor/editor.ts:3278`:
  - Before: `const endLine = Math.min(startLine + (this.state.config?.tabSize ?? 50), lines.length);`
  - After: `const endLine = Math.min(startLine + HIGHLIGHT_RECOMPUTE_VIEWPORT_LINES, lines.length);`
- Add a module-level constant near the top of `editor.ts` (or in an existing constants file if one exists for editor config): `const HIGHLIGHT_RECOMPUTE_VIEWPORT_LINES = 50;` with a comment: "Fallback visible-line count for `recomputeHighlights` — the daemon does not know the client's terminal height (the TUI client computes its own spans via `computeHighlightSpans`), so this is a sensible default for any daemon-side consumer."
- Do NOT delete `recomputeHighlights` or `state.highlightSpans` in this bug spec. The dead-code question is larger (see Open Question) and overlaps RFC-019 Tier 1.6.

**Acceptance Criteria**:
- [ ] `src/editor/editor.ts:3278` no longer references `config.tabSize`.
- [ ] A named constant explains the chosen line count and why real viewport height isn't available.
- [ ] `rg 'tabSize' src/editor/editor.ts` shows no remaining misuse in `recomputeHighlights`.
- [ ] `bun run typecheck:src` passes.

### Fix Bug 2 — Use `effectiveCursorCol` in the non-highlighted render branch

**User Story**: As a user editing a long unhighlighted line with horizontal scroll, I want the block cursor to appear under my actual cursor position so I can see where I'm editing.

- Edit `src/frontend/render/buffer-lines.ts:365`:
  - Before: `const rendered = isCurrentLine ? renderWithBlockCursor(lineContent, cursorColumn) : lineContent;`
  - After: `const rendered = isCurrentLine ? renderWithBlockCursor(lineContent, effectiveCursorCol) : lineContent;`
- This matches the pattern already used by the three sibling branches at lines 338, 347, 361.
- Do not change `renderWithBlockCursor` itself, `fitToWidth`, or any other call site. One-line surgical fix.

**Acceptance Criteria**:
- [ ] `src/frontend/render/buffer-lines.ts:365` passes `effectiveCursorCol`, not `cursorColumn`.
- [ ] The four render branches (338, 347, 361, 365) are now consistent in their cursor-column argument.
- [ ] `bun run typecheck:src` passes.
- [ ] Existing renderer tests still pass (run `bun run test:ui:renderer` if available without uv; otherwise verify via `bun test test/unit/`).

### Fix Bug 3 — Remove the dead first loop in `findPreviousMatch`

**User Story**: As a maintainer reading `findPreviousMatch`, I want a single clear algorithm so I don't waste time understanding dead code or worry about which loop is authoritative.

- Edit `src/editor/api/search-ops.ts`:
  - Delete lines 134-144 (the comment `// Find last occurrence of pattern before currentColumn`, the `let index = -1;` declaration, and the entire `for` loop that writes to the unused `index`).
  - Keep the second loop (lines 146-158) intact. It already produces the correct result via `allMatches[allMatches.length - 1]`.
  - The comment `// Better approach: find all matches and take the last one before currentColumn` at line 146 can be simplified to just `// Find the last occurrence of pattern before currentColumn` since there is no longer a "better" alternative being contrasted.
- Do not change the algorithm. The `lastIndexOf` optimization is RFC-019 Tier 3.7 and explicitly out of scope.
- Run any existing search tests to confirm behavior is unchanged.

**Acceptance Criteria**:
- [ ] The `for (let i = 0; i < currentColumn; i++)` loop is gone from `findPreviousMatch`.
- [ ] The `index` variable is no longer declared.
- [ ] `findPreviousMatch` behavior is unchanged (the second loop already produced the result).
- [ ] `bun run typecheck:src` passes.
- [ ] Any existing search test (`test/unit/search*.test.ts`) still passes.

### Run the Validation Commands
- Execute every command in the Validation Commands section, top to bottom, and confirm each passes with zero errors before declaring the bug fixed.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run typecheck:src` — Confirm no TypeScript errors after the three edits (the Bug 1 constant add, the Bug 2 argument swap, the Bug 3 deletion).
- `bun run typecheck:test` — Test suite typechecks.
- `bun run typecheck` — Full typecheck.
- `rg 'tabSize' src/editor/editor.ts` — Must show no `tabSize` reference inside `recomputeHighlights` (other `tabSize` references elsewhere in `editor.ts` are unrelated and acceptable).
- `rg 'cursorColumn\)' src/frontend/render/buffer-lines.ts` — Verify line 365 no longer passes the raw `cursorColumn` to `renderWithBlockCursor`. (Other call sites using `cursorColumn` for non-cursor-render purposes are fine.)
- `rg 'let index = -1' src/editor/api/search-ops.ts` — Must return no matches (the dead variable is gone).
- `bun test test/unit/` — Full unit suite; zero regressions. If a search-ops test file exists, confirm it specifically passes.
- `bash -lc 'set -euo pipefail; bin/tmax --stop 2>/dev/null || true; rm -f /tmp/tmax-$(id -u)/server.lock; bin/tmax --daemon >/tmp/tmax-bug15.log 2>&1 & for i in $(seq 1 100); do bin/tmaxclient --ping >/dev/null 2>&1 && break; sleep 0.1; done; bin/tmaxclient --ping >/dev/null; echo "daemon-up"; bin/tmaxclient --eval "(progn (setq x (search-find-all-matches \"foo\")) t)" >/dev/null; trap "bin/tmax --stop 2>/dev/null || true" EXIT; echo OK'` — Daemon starts cleanly with the three fixes; a search builtin round-trips without error. Catches integration regressions.

## Notes

- **Open question (Bug 1, deferred):** Should `recomputeHighlights` and `state.highlightSpans` be deleted entirely as dead code? The consumer audit shows no production reader. Deleting would be the most honest fix, but it overlaps RFC-019 Tier 1.6 (highlight span caching) — a future CHORE that will likely reintroduce a daemon-side span store keyed by line text. Making that architectural decision inside a bug fix would be scope creep. This bug spec makes the method *correct* (minimal surgical fix); the dead-code decision is recorded here for the Tier 1.6 CHORE to make.
- **Bug 2 is a real UX bug users could hit.** Open a `.txt` file, scroll right with `zl`, and edit — the cursor will be in the wrong place. Worth flagging in the changelog if one exists.
- **Bug 3 is not a behavior bug** — `findPreviousMatch` currently returns correct results because the second loop is authoritative. The fix is purely dead-code removal for clarity and to stop misleading future maintainers. No test should change behavior; if a test exists it must still pass identically.
- **AGENTS.md §3 (Surgical Changes):** Each of the three fixes is the minimal change that addresses the bug. No adjacent code is "improved." The Bug 3 fix specifically does NOT do the `lastIndexOf` perf optimization (RFC-019 Tier 3.7) even though it would be tempting — that's a separate concern with its own CHORE.
- **AGENTS.md §8 (Verify Before Reporting Complete):** The renderer path (Bug 2) is exercised by `test/ui/` tmux tests per the project convention. If `bun run test:ui:renderer` is available locally it must pass; if it requires `uv` and isn't installed, note that explicitly in the completion report rather than skipping silently.
