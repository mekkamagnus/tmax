# Bug: `vi"` (and the whole quote text-object family) only works when the cursor is already inside the quotes — no forward search like vim

## Bug Description

Typing `vi"` in normal mode does nothing unless the cursor already sits
BETWEEN a pair of double quotes. With the cursor anywhere before the string
(e.g. at the start of the line, or on the words around it) — the common case
when you type `vi"` from a word you just landed on — the region computation
returns nil and the editor silently stays in plain VISUAL with the one-char
`v` selection. Same for `va"`, and the single-quote family `vi'`/`va'`, and
every operator form `di"`/`ci"`/`yi"`/`da"`/`ca"`/`di'`/… — all flow through
the same quote finder.

Expected (vim parity): when the cursor is not inside a quoted string, `i"`
selects the NEXT quoted string on the line (vim searches forward). E.g. on
`say "hello world" now` with the cursor on `say`, `vi"` selects `hello world`.

## Problem Statement

`findMatchingQuote` (src/editor/api/text-objects.ts) only scans BACKWARD for
an opening quote at/Before the cursor and FORWARD for a closing one strictly
after it. Three vim-parity defects:

1. **No forward search**: cursor before the first quote → "No opening found"
   → nil → the user's `vi"` no-op.
2. **Between two strings it grabs a phantom region**: on
   `a "x" b "y" c` with the cursor on `b`, the backward scan latches onto the
   CLOSING quote of `"x"` and the forward scan onto the OPENING quote of
   `"y"` → a region spanning the junk between the strings. Vim selects `"y"`.
3. **Cursor ON a closing quote mis-pairs**: on `a "x" b "y" c` with the
   cursor on the `"` after x, forward-scan pairs it with the OPENING quote of
   `"y"` instead of treating it as the close of `"x"`.

## Solution Statement

Rewrite `findMatchingQuote` to the vim algorithm for single-line quotes:

- Collect all quote positions on the line; pair them in order
  (q0,q1), (q2,q3), … ignoring a trailing unpaired quote.
- Cursor within [open, close] inclusive (ON a quote counts) → that pair.
- Otherwise → the first pair whose OPENING quote is at/after the cursor.
- No such pair → Left (cursor is past the last string — vim also fails
  there, with a beep).

This fixes the entire family at the single choke point
(`vi"`/`va"`/`di"`/`ci"`/`yi"`/… and the single-quote twins), because every
quote text-object flows through `findMatchingQuote`.

## Steps to Reproduce

1. `printf 'say "hello world" now\n' > /tmp/q.md && bun src/main.ts /tmp/q.md`
2. Cursor on `s` of `say` (line start).
3. Type `v` `i` `"` — nothing happens (status line never re-anchors; the
   selection stays the single char under the cursor).
4. Move INSIDE the quotes (e.g. `f"` then `l`) and repeat `vi"` — works.

Fixture-level: `(text-object-region "\"" "i")` with the cursor at col 1–3
returns nil; with the cursor at col 6 it returns `0 5 0 16`.

## Root Cause Analysis

`findMatchingQuote` (text-objects.ts:222–257):

```ts
let start = column;
while (start >= 0 && currentLine[start]! !== quoteChar) start--;
if (start < 0) return Either.left(`No opening ${quoteChar} found`);
let end = column + 1;
while (end < currentLine.length && currentLine[end]! !== quoteChar) end++;
if (end >= currentLine.length) return Either.left(`No closing ${quoteChar} found`);
```

The backward/forward scan has no notion of quote PAIRING — it assumes the
cursor is strictly inside a string and finds the nearest quote on each side,
which (a) fails before the first quote, (b) mis-pairs between/after strings.
The engine plumbing is all correct and verified working (fixture + live
embedded + live daemon/TUI: cursor-inside `vi"` selects 0,5–0,16 in every
path); only this finder's semantics diverge from vim.

## Relevant Files

Use these files to fix the bug:

- `src/editor/api/text-objects.ts` — `findMatchingQuote`: the single choke
  point; rewrite to the pair-collecting algorithm. All quote delete/change
  helpers and `textObjectRegion` call it.
- `test/unit/text-objects.test.ts` — the existing quote text-object suite
  (39 tests); add the parity regressions here.

### New Files

(none)

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Task 1: Rewrite `findMatchingQuote` with vim pairing semantics

**User Story**: As a vim user, I want `vi"` to select the next quoted string
when my cursor is outside one, so that text objects behave like every other
vim implementation I've used.

- Collect all indices of `quoteChar` on the line.
- Build non-overlapping pairs (0th+1st, 2nd+3rd, …); ignore a trailing
  unpaired quote.
- If `column` is within [open, close] (inclusive) → that pair.
- Else the first pair with `open >= column`.
- Else `Either.left` (past the last string — matches vim's failure).

**Acceptance Criteria**:
- [ ] `say "hello world" now`, cursor col 1/2/3 → region (0,4)-(0,17) for
      `a"` inner variant bounds 5..16; inner `"i"` gives 5..16, `"a"` 4..17.
- [ ] `a "x" b "y" c`, cursor on `b` (col 7) → the `"y"` pair, not a phantom
      spanning quote-of-x → quote-of-y.
- [ ] Cursor ON a closing quote → that string's pair.
- [ ] Cursor after the LAST string → Left (unchanged failure).
- [ ] Unterminated single quote at EOL → ignored, not paired with anything.

### Task 2: Regression tests in the quote suite

**User Story**: As a maintainer, I want the pairing semantics pinned so a
future refactor can't silently reintroduce the no-op.

- Fixture tests via `(text-object-region "\"" "i"/"a")` at: before first
  string, between two strings, on a closing quote, after last string.
- One live-key test: `handleKey v`,`i`,`"` with the cursor on `say`
  → visual selection region is the string.

**Acceptance Criteria**:
- [ ] All new tests red before the fix, green after.
- [ ] Existing 39 text-object tests stay green.

### Task 3: Full verification + live check

**User Story**: As the reporting user, I want `vi"` to work in my real
editor session, verified in the mekkapi tab.

- `bun run typecheck` + `bun test test/unit/text-objects.test.ts`.
- tmux embedded + daemon/TUI spot-check: cursor at line start, `vi"`,
  selection anchors to the string.

**Acceptance Criteria**:
- [ ] Live: `vi"` from OUTSIDE the quotes selects the string.
- [ ] typecheck clean; quote suite green; no regressions in the
      text-object/text-objects-adjacent suites.

## Validation Commands

- `bun run typecheck` — clean
- `bun test test/unit/text-objects.test.ts` — all green (39 existing + new)
- `bun test test/unit/text-objects-ops.test.ts` (if present) / adjacent suites
- `bun run test:unit -- test/unit/text-objects.test.ts` — via the hardened runner
- Live (tmux): the Steps-to-Reproduce sequence, expecting the selection to
  anchor to `hello world` from OUTSIDE the quotes.

## Notes

- **Why introduced**: US-1.8.1's helpers were written for the cursor-inside
  case only; no pairing model.
- **Related**: this session's pattern of engine-vs-live divergence does NOT
  apply here — all four delivery paths (fixture, embedded text/markdown,
  daemon/TUI) were verified working cursor-inside; the defect is pure
  semantics in the finder.
- The same fix automatically covers `di"`/`ci"`/`yi"`/`da"`/`ca"` and the
  `'` twins — no per-combo work (SPEC-069's generic dispatch already routes
  them all through `text-object-region` → `findMatchingQuote`).
- Multi-line strings: out of scope (vim's `i"` is line-wise for quotes too).
- No daemon restart requirements beyond the usual (embedded picks up source
  on relaunch).
