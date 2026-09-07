# Visual-mode inclusive cursor (vim parity)

## Status

Accepted (2026-08-31) — implements #232 / SPEC-232.

## Context

tmax's visual charwise selections were end-EXCLUSIVE: the cursor rested one character past the last selected char. On `vi"` that char is the closing quote — the cursor "jumped outside the string" (user report). `v`+motion selections were also one char short of vim (`v l l d` deleted 2 chars, not 3). A first implementation attempt failed on apparently contradictory conventions; the resolution was pinning the base layer directly: **`buffer.delete`/`getText` are end-exclusive** (`[2,4]` removes `cd`), and the visual layer had simply inherited that convention at the anchor level. The apparent contradiction was a geometry miscount in the old backwards-selection test (its anchor sat on the closing quote at col 16; "hello world" ends at 15).

## Decision

One convention: **visual selections are inclusive of the cursor position; the buffer layer stays exclusive.** Anchors put the cursor ON the last selected character — the text-object anchor clamps to `region-end − 1` (guarded to the region start for zero-width regions like `""`), and motion anchoring already lands on-char. The charwise consumers — `visual-delete`, `visual-yank`, `visual-lowercase`, `visual-uppercase` — operate one past the anchored end (`end.column + 1`). Line/block conventions (#145/#230) are untouched. `vim-visual-paste` needs no change (its delete goes through `visual-delete`), and the goggles yank-flash wrapper now flashes the selection exactly.

## Consequences

- `vi"` parks on the last inner character; `v`+motion selects and deletes vim-exact counts; all `vi"d/y/p` results byte-identical to before.
- The verify-gate caught a half-patched pair the green battery missed: the case-transform primitives were read-inclusive but replace-exclusive — a delete-5-insert-6 buffer corruption reachable via M-x (the `u`/`U` keys bypass them via the correct T-Lisp transform). Both sides now consistent, pinned by tests along with the zero-width guard and backwards charwise d/y.
- Known edge, pinned as intended behavior: `vi"` on an empty `""` anchors in place and consumes one char under the inclusive convention.
