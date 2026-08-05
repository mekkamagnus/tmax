# Bug: `C-w` window chords were misdiagnosed — real root cause is `tmax-use` playbook key-tokenization, NOT a keymap/editor defect

> **Status note (re-investigated 2026-08-06):** The original title ("`C-w` window commands have a redundant dual-binding… and the chord path is unreliable") and BOTH prior investigation comments were **disproven**. The `C-w` chords dispatch correctly in the editor. The observed "leak" is a `tmax-use` playbook authoring error (bare `C-w w` instead of the angle-bracket `<C-w>w` form every other Ctrl-key playbook uses). This spec is corrected to the verified root cause. The dual-binding smell and the dead `windowPrefixPressed` flag remain legitimate, separate cleanups — they are kept as minor sub-goals, not the bug.

## Goals

- Establish the verified root cause: `C-w s` / `C-w v` / `C-w w` / `C-w q` **DO dispatch** in the editor; the "broken keypath" was a `tmax-use` tokenization mistake (`C-w w` → 5 literal chars vs `<C-w>w` → `\x17`+`w`).
- Restore keypath (`keys:`) coverage of the `C-w` chords in `eval-38-window-ops.yaml` using the **correct angle-bracket form**, and fix the comments in that playbook that propagate the wrong root cause.
- Remove the architecture smell that the misdiagnosis surfaced: the bare-`C-w` terminal binding (`editor-window-prefix`) is dead weight — it never executes (the which-key prefix path at `normal-handler.ts:196-209` intercepts `C-w` before the binding lookup), and its `windowPrefixPressed` flag is never read. Pick ONE `C-w` mechanism (the T-Lisp chords), per `src/editor/CLAUDE.md` ("TypeScript here provides primitives ONLY. Editor logic lives in T-Lisp.").
- No editor/keymap behavior change for correctly-driven `C-w` chords (regression-proof).

## Completion Criteria (Definition of Done)

- [ ] `tmax-use/playbooks/eval-38-window-ops.yaml` drives window split/cycle/close via **`keys:` steps using `<C-w>` angle-bracket tokens** (e.g. `keys: "<C-w>s"`, `keys: "<C-w>w"`, `keys: "<C-w>q"`), replacing the current `eval:`-only window-op steps. The two comment blocks (lines ~73 and ~151) are corrected to state the real root cause and removed/rewritten.
- [ ] A focused unit test asserts the editor dispatches the chord end-to-end: feed `handleKey("\x17")` then `handleKey("s")` and assert `(window-count)` goes 1 → 2; feed `"\x17"` then `"w"` and assert `(window-current)` cycles; feed `"\x17"` then `"q"` and assert `(window-count)` decreases. (This locks in the regression-proof green state.)
- [ ] A `tmax-use` unit test (or assertion in `test/unit/tmax-use/keys.test.ts`) pins the tokenization: `compileHeadless("<C-w>s")` === `["", "s"]` and `parseKeys("C-w s")` yields literal `["C","-","w"," ","s"]` — so a future bare-form playbook step fails loudly instead of silently leaking.
- [ ] EITHER the bare-`C-w` → `editor-window-prefix` binding and the `editor-window-prefix` raw handler (`src/editor/editor.ts:1188-1194`) + the `windowPrefixPressed` field (`editor.ts:118`) are removed (grep first confirms nothing reads the flag), OR a one-line comment documents why the binding must stay. The `C-w` chords in `motions.tlisp:511-514` remain the single authoritative mechanism.
- [ ] No regression: `bun run typecheck`, `bun run test:unit`, `bun run test:integration`, and `bun run test:tmax-use` all pass.

## Root Cause (investigated 2026-08-06 — verified, supersedes prior diagnosis)

**The original "dual-binding makes the chord unreliable" framing and both prior investigation comments are WRONG.** Verified directly against a live `Editor` (via `test/helpers/editor-fixture.ts`):

1. **The T-Lisp keymap lookup is correct.** Probed against the runtime keymap after core bindings load:
   - `(keymap-prefix-p (current-keymap) "C-w")` → `t` ✓
   - `(keymap-ref (current-keymap) "C-w s")` → `"(split-window-below)"` ✓ (and `C-w v/w/q/+/-/>/<` all present)
   - `(keymap-prefix-bindings (current-keymap) "C-w")` → all 9 chords ✓
   - The chords are stored flat in `"bindings"` AND nested in `"prefix-table"` by `keymap-set-key` (`src/tlisp/core/keymaps.tlisp:39-58`); `keymap-ref` (`keymaps.tlisp:30-37`) reads the flat form. Both forms are present. The prior comment's "deeper keymap-internals discrepancy: SPC lookups resolve but C-w lookups do not" **does not reproduce** — both resolve.

2. **The editor dispatches the chords correctly.** Driving `editor.handleKey("\x17")` (C-w) then `handleKey("s")` sets `whichKeyPrefix="C-w"` then resolves `lookupKey="C-w s"` and runs `(split-window-below)` — `(window-count)` goes 1 → 2. All four chords verified: `C-w s`→split, `C-w v`→split, `C-w w`→`(window-current)` 0→1, `C-w q`→delete. The dispatch flow is `src/editor/handlers/normal-handler.ts:196-209` (prefix detection sets `whichKeyPrefix`), then `:172-173` builds `lookupKey = `${currentPrefix} ${normalizedKey}``, then `:224` `(keymap-ref …)` finds the chord command. This path **works**. `SPC` uses a parallel path (`spaceActive` flag set by the bound `editor-handle-space` command at `normal-handler.ts:174-176`), but both converge on the same `keymap-ref` resolution — they do not diverge.

3. **The REAL defect: `tmax-use` playbook key tokenization.** `tmax-use/src/keys.ts:49-78` (`parseKeys`) only recognizes a Ctrl key when written in the **angle-bracket** form `<C-w>` (the `<…>` branch at `:54-67` → `parseSpecial` control table at `:230-236` → byte `\x17`). A bare `C-w` (no brackets) is tokenized by the default literal branch (`:69-74`) into **five separate literal characters**: `["C", "-", "w", " ", "w"]` for `"C-w w"`. The daemon dispatches each as its own `keypress`; the editor receives literal `C`, `-`, `w` in normal mode → `C`/`-`/`w` are motions or unbound, and the trailing `w` reads as forward-word. That is exactly the "`-w w` visible on the screen / leaks into the buffer" symptom from the original BUG-59 report.
   - Verified: `compileHeadless("<C-w>s")` → `["", "s"]` ✓ (works); `compileHeadless("C-w s")` → `["C", "-", "w", " ", "s"]` ✗ (the leak).
   - Every OTHER Ctrl-key playbook step in the repo uses the angle-bracket form (`eval-27:200 keys: "<C-x>"`, `vim-parity-motions:274 keys: "<C-o>"`, `vim-parity-edit:152 keys: "<C-a>"`, `vim-parity-advanced:288 keys: "<C-v>j~"`). The window-ops playbook simply never adopted the convention — and the misdiagnosis ("chord is unreliable") was mistaken for an editor defect.

**Why the prior two investigation comments were wrong:** (a) The first comment claimed `editor-window-prefix` is "an INCOMPLETE STUB" that fires on bare `C-w` and leaks the trailing key — but bare `C-w` is **intercepted by the which-key prefix path** (`normal-handler.ts:196`, `keymap-prefix-p` returns `t`), so `editor-window-prefix` **never executes at all**; the trailing `s` is then a correctly-driven chord key, not a leaked normal-mode key. (b) The second comment claimed "C-w <key> 2-key lookups do not resolve despite both being bound" — the probe above refutes this: `keymap-ref "C-w s"` returns the command and the editor runs it. Both comments were reasoning about the symptom (literal-char leak from a bare-form playbook) without confirming the tokenizer was emitting control bytes.

**Net:** there is no editor/keymap bug. There is (i) a playbook authoring/documentation gap (bare `C-w` vs `<C-w>`), and (ii) an incidental cleanup (dead `editor-window-prefix` handler + `windowPrefixPressed` flag, and the redundant bare-`C-w` binding).

## Implementation Plan

1. **Fix the playbook (the actual bug).** In `tmax-use/playbooks/eval-38-window-ops.yaml`:
   - Replace the `eval: '(split-window-below)'` / `'(other-window)'` / `'(delete-window)'` window-op steps (the ones gated behind the "unreliable" comments) with `keys:` steps using the angle-bracket form: `keys: "<C-w>s"`, `keys: "<C-w>w"`, `keys: "<C-w>q"`. Keep the `eval:` count assertions (`(window-count)`, `(window-current)`) as the oracle — they are read-only primitives independent of the keypath, so they remain valid checks.
   - **Do NOT** write `keys: "<C-w> s"` (with a space) — the space byte is itself bound (`editor-handle-space`, normal.tlisp:236) and would cancel the C-w prefix; the correct form is `<C-w>s` (no separator) or two separate `keys:` steps (`<C-w>` then `s`).
   - Rewrite the two comment blocks (~lines 73-74 and ~151) to state the verified root cause: the chords work; the bare-form `C-w` was the tokenizer error.

2. **Add the regression-locking unit tests.**
   - In `test/unit/` (a new `test/unit/cw-window-chords.test.ts` or extend `test/unit/window-splitting.test.ts`): using `createEditorFixture` from `test/helpers/editor-fixture.ts`, drive `handleKey("\x17")` + `handleKey("s")` and assert `(window-count)` 1→2; `"\x17"` + `"v"` → count increases; `"\x17"` + `"w"` → `(window-current)` changes; `"\x17"` + `"q"` → count decreases. Pattern: same `exec('(window-count)')?.right.value` probe used during this investigation.
   - In `test/unit/tmax-use/keys.test.ts`: add assertions that `compileHeadless("<C-w>s")` deep-equals `["", "s"]` and that `parseKeys("C-w s")` yields literal tokens whose `.headless` values are `["C","-","w"," ","s"]`. This makes a future bare-form playbook step fail with a clear diff if anyone re-introduces it.

3. **Remove the dead TS-side window-prefix machinery (architecture cleanup).**
   - `src/editor/editor.ts:118` — the `windowPrefixPressed: boolean = false` field. Grep first: `rg -n "windowPrefixPressed" src/ test/` — confirmed it is written at `editor.ts:1192` but never read anywhere (the prior investigation already noted "dead state"). Delete the field.
   - `src/editor/editor.ts:1188-1194` — the `editor-window-prefix` raw handler. Because `C-w` is a prefix (`keymap-prefix-p` true), `normal-handler.ts:196-209` intercepts it before the binding lookup at `:224`, so this handler is unreachable. Delete it.
   - The bare-`C-w` binding: it lives in TWO places — the fallback string in `src/editor/runtime/binding-runtime.ts:78` (`(key-bind "C-w" "(editor-window-prefix)" "normal")`) AND `src/tlisp/core/commands/windows.tlisp:24`. **Keep the binding in motions.tlisp's chord set but DO NOT bind bare `C-w` to anything** — the which-key prefix path needs `C-w` to be a prefix (satisfied by the chords existing), not a terminal binding. Remove the bare-`C-w` binding from both `binding-runtime.ts:78` (fallback) and `windows.tlisp:24`. Verify after removal that `keymap-prefix-p "C-w"` still returns `t` (it will — the chords remain in the prefix-table) and that `C-w s` still dispatches.
   - If step 3 turns out to change observable behavior (it should not, given the handler is unreachable and the flag is dead), STOP and document the finding in this spec rather than forcing the removal; the test added in step 2 will catch any regression.

4. **Verify.** `bun run typecheck:src && bun run typecheck:test && bun run test:unit && bun run test:tmax-use`. The eval-38 playbook must pass with the new `keys:` steps. Manually confirm in the live TUI (`tmax file` then `C-w s`) that a split appears.

## Test Plan

- **Unit (editor dispatch, regression-lock):** new `cw-window-chords.test.ts` — `handleKey("\x17")` then `handleKey("s")` → `(window-count)` is 2; `"\x17"`+`"v"` → count up; `"\x17"`+`"w"` → `(window-current)` cycles; `"\x17"`+`"q"` → count down. Exact assertion: `expect(exec('(window-count)').right.value).toBe(2)`.
- **Unit (tokenizer contract):** `test/unit/tmax-use/keys.test.ts` — `expect(compileHeadless("<C-w>s").right).toEqual(["", "s"])` and the bare-form negative.
- **e2e (tmax-use playbook):** `eval-38-window-ops.yaml` with `keys: "<C-w>s"` / `"<C-w>w"` / `"<C-w>q"` steps, asserting via the existing `(window-count)`/`(window-current)` eval oracles. Run `bun run test:tmax-use` (or the targeted playbook runner).
- **Live TUI (manual, optional):** `tmax somefile`, press `C-w` then `s` → a second window appears; status line never shows `-w` leaking into the buffer.

## Relevant Files

- `tmax-use/src/keys.ts:49-78, 229-236` — `parseKeys` / `parseSpecial`; the tokenizer that requires `<C-w>` angle-bracket form for control bytes.
- `tmax-use/playbooks/eval-38-window-ops.yaml:73-74, 151` — the playbook with the wrong-root-cause comments and the `eval:`-only window steps to convert to `keys:`.
- `src/editor/handlers/normal-handler.ts:172-179, 196-209, 224` — the dispatch flow that DOES correctly resolve `C-w s` (prefix detection → `lookupKey` → `keymap-ref`). Read to confirm no change is needed here.
- `src/tlisp/core/keymaps.tlisp:30-37, 39-58, 82-89` — `keymap-ref` / `keymap-set-key` / `keymap-prefix-p`; verified correct (both flat and nested chord storage work).
- `src/tlisp/core/commands/motions.tlisp:511-514` — the `C-w s/v/w/q` chord bindings (the authoritative, working mechanism).
- `src/editor/editor.ts:118, 1188-1194` — the `windowPrefixPressed` field + `editor-window-prefix` raw handler (dead code; cleanup target).
- `src/editor/runtime/binding-runtime.ts:78` — fallback bare-`C-w` binding (cleanup target).
- `src/tlisp/core/commands/windows.tlisp:24` — runtime bare-`C-w` binding (cleanup target).
- `src/editor/CLAUDE.md` — the "TS primitives only, logic in T-Lisp" rule the dead handler violates.
- `test/helpers/editor-fixture.ts` — `createEditorFixture` (the harness used to verify the chords dispatch; reuse for the regression test).
- `test/unit/tmax-use/keys.test.ts` — existing tokenizer tests (extend with the `<C-w>` / bare-form contract).

## Severity / Notes

- **Priority:** low→medium. The "bug" is a playbook/documentation gap, not an editor defect — the editor's `C-w` chords work for any client that sends `\x17` (the daemon, the TUI, a correctly-authored playbook). The cleanup (dead handler, dead flag, redundant binding) is a code-hygiene win that resolves the `src/editor/CLAUDE.md` architecture-rule smell the original spec correctly identified.
- **Confidence:** high. Root cause established by direct runtime probes against the live `Editor` and the `tmax-use` tokenizer (both quoted above with the exact return values); the chords were driven end-to-end through `handleKey` and `(window-count)`/`(window-current)` confirmed the dispatch.
