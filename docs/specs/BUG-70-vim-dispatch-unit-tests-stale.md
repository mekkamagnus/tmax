# Bug (pre-existing): vim-dispatch unit tests stale (assert empty/pre-splash `*scratch*`)

## Goals

- `test/unit/vim-dispatch.test.ts` green end-to-end.
- The two stale assertions stop fighting the splash screen that the editor now renders in an empty `*scratch*`.
- Test-only change — no production code touched (the splash feature is intentional, see ADR-0163 / BUG-58).

## Completion Criteria (Definition of Done)

- [ ] `test/unit/vim-dispatch.test.ts:27` ("starts without a file with a usable scratch buffer") no longer asserts `bufferText(editor)).toBe("")` against a splash `*scratch*`; it either asserts the splash content OR seeds a clean buffer before asserting.
- [ ] `test/unit/vim-dispatch.test.ts:40` ("handles insert-mode Enter, Backspace, and Tab through editor input") no longer asserts `bufferText(editor)).toBe("a\n\t")` against a buffer that still carries the uncleared splash; it seeds a clean/empty buffer before the insert sequence.
- [ ] `bun test test/unit/vim-dispatch.test.ts --timeout 4000` exit 0 (all 24 tests pass). The `--timeout 4000` is required to dodge the **separate** BUG-72 / issue #122 intermittent hang — without it the file can hang mid-run and mask whether this fix is actually green.
- [ ] No change under `src/` (production code unchanged).

## Root Cause (investigated 2026-08-06)

**Stale tests, not a production bug.** The editor now seeds the default `*scratch*` buffer with splash-screen content at startup, but two `vim-dispatch.test.ts` assertions still expect empty / pre-splash content.

Confirmed against the running suite (`bun test test/unit/vim-dispatch.test.ts --timeout 4000 -t …`):

1. **`src/editor/editor.ts:2908-2910`** — `Editor.start()` creates the default buffer directly with splash text:
   ```ts
   if (!this.model.currentBuffer) {
     this.createBuffer("*scratch*", TextBufferImpl.SPLASH_TEXT);
   }
   ```
2. **`src/core/buffer.ts:143-154`** — `TextBufferImpl.SPLASH_TEXT` is the 10-line "tmax — extensible terminal editor … Version 0.2.0 (Alpha)" intro.
3. **`src/editor/editor.ts:2917-2928`** — `showSplashIfEmpty()` is the *daemon-side* on-demand variant of the same logic; it is **not** what the unit tests hit. The unit tests hit the startup path at editor.ts:2909 directly (the fixture calls `editor.start()` via `createEditorFixture`, `test/helpers/editor-fixture.ts:218-220`). The issue's "showSplashIfEmpty" framing is slightly off — the assertion-breaking splash comes from the `start()` body, not from `showSplashIfEmpty`.
4. **`src/editor/handlers/insert-handler.ts:28-33`** — the splash is *cleared on the first printable insert character*, but only when `buffer-name` is `*scratch*` and `buffer-text` starts with `"  tmax"`. The `i` key (mode switch) is handled by the normal handler, so it does **not** clear the splash; the subsequent `a` clears it *after* inserting `a` at the cursor, which is why test 2 ends up with `"a\n\t"` followed by the residual splash block rather than `"a\n\t"` alone.

The two failing assertions:

- `test/unit/vim-dispatch.test.ts:27` — `expect(bufferText(editor)).toBe("")` against a `*scratch*` that now contains `SPLASH_TEXT` (received: the full 10-line splash). Verified red.
- `test/unit/vim-dispatch.test.ts:40` — `expect(bufferText(editor)).toBe("a\n\t")`, but the uncleared splash survives the insert sequence (received: `"a\n\t"` + splash). Verified red.

The splash feature landed (BUG-58 / ADR-0163 era) without updating these two assertions. Stash-confirmed pre-existing per the issue body. Same stale-test pattern as #113 / #115 / #119 / BUG-68.

## Implementation Plan

The two tests want a **clean buffer to exercise vim-dispatch behavior**, not the splash. The faithful, minimal fix is to make the fixture hand them a clean buffer — matching every other test in this file that already passes content to `createStartedEditor`.

The mechanism already exists and is used by the 20+ passing tests below (lines 46-369): **`createStartedEditor(content?)`** delegates to `createEditorFixture({ initialContent })`, and `createEditorFixture` (`test/helpers/editor-fixture.ts:222-224`) calls `editor.createBuffer(bufferName ?? "test", initialContent)`. `Editor.createBuffer` (`src/editor/editor.ts:2270-2276`) **always sets the newly created buffer as `currentBuffer`** via `SetCurrentBuffer`. So passing any content (even `""`) supplants the splash `*scratch*` with a clean "test" buffer.

Concretely:

1. **`test/unit/vim-dispatch.test.ts:23-28`** ("starts without a file with a usable scratch buffer") — change `createStartedEditor()` to `createStartedEditor("")` so `currentBuffer` is a clean empty "test" buffer, leaving the `toBe("")` assertion correct. (If the test's intent is specifically to assert the *splash* startup behavior, assert against `SPLASH_TEXT` instead — but the test name and body indicate it wants a usable empty buffer, so seeding `""` is the faithful fix. Prefer `""`.)
2. **`test/unit/vim-dispatch.test.ts:30-43`** ("handles insert-mode Enter, Backspace, and Tab") — change `createStartedEditor()` to `createStartedEditor("")` so the insert sequence runs against a clean buffer and the `toBe("a\n\t")` assertion holds. This also removes the dependence on the insert-handler's splash-clearing heuristic (insert-handler.ts:30), which is not what this test is exercising.

No new helpers, no production changes. The fix is two single-argument additions (`""`) mirroring the pattern already used at lines 46, 57, 70, 80, 90, 101, 112, 117, 122, 127, 134, 138, 142, 147, 153, 157, 161, 165, 169, 175, 180, 185, 190, 194, 198, 204, 218, 230, 241, 247, 251, 261, 265, 269, 273, 279, 291, 302, 332 of this same file.

**Do not** "fix" this by altering the splash feature, the startup path (editor.ts:2909), or the insert-handler clear (insert-handler.ts:30) — those are intentional (ADR-0163) and out of scope for a stale-test catch-up.

## Codex adversarial review (2026-08-06) — correction

- **Codex flag (unverified):** claimed `insert-handler.tlisp` calls nonexistent `buffer-delete-line` — `rg buffer-delete-line src/` finds **no such call**, so the claim is UNVERIFIED (possibly erroneous). Verify before acting; **do not** treat as a confirmed fix.
- The primary fix remains the splash-assertion update (or clear-the-splash test setup) described in the Implementation Plan above.

### Verification gate

Run with `--timeout 4000` (per-test ms) to avoid the unrelated BUG-72 / issue #122 intermittent hang that can stall this file:

```bash
bun test test/unit/vim-dispatch.test.ts --timeout 4000
```

## Test Plan

- Red (before): `bun test test/unit/vim-dispatch.test.ts --timeout 4000` → 2 fail (lines 27 and 40), both showing `SPLASH_TEXT` in the received value.
- Green (after): same command → 24 pass / 0 fail.
- Regression scope: the change only affects two test setups; assert no other test in the file flips by running the whole file (not just `-t`).
- Sanity: `bun run typecheck:test` still clean (the change is a string-literal arg, no type impact).

## Relevant Files

- `test/unit/vim-dispatch.test.ts` — the stale assertions (lines 23-28, 30-43). **Edit target.**
- `test/helpers/editor-fixture.ts:207-264` — `createEditorFixture` / `createStartedEditor`; confirms passing `initialContent` supplants the splash via `createBuffer`.
- `src/editor/editor.ts:2269-2307` — `Editor.createBuffer` (always sets the new buffer as `currentBuffer`).
- `src/editor/editor.ts:2900-2928` — startup splash seeding (`*scratch*` ← `SPLASH_TEXT`) and `showSplashIfEmpty`.
- `src/core/buffer.ts:140-154` — `SPLASH_TEXT` definition + "cleared on first keystroke" comment.
- `src/editor/handlers/insert-handler.ts:28-33` — splash-clear-on-first-printable-char heuristic (explains test 2's residual-splash symptom; **not** the fix site).
- `docs/adrs/ADR-0163-embedded-editor-buffer-filename-bootstrap.md` — the splash decision of record (do not revert).
- `docs/specs/BUG-72-vim-dispatch-vim-bindings-smoke-intermittent-hang.md` — the unrelated hang that mandates `--timeout 4000` when verifying.

## Notes

No ADR — stale-test catch-up to the splash feature (an existing, intentional decision), same class as #113 / #115 / #119 / BUG-68.
