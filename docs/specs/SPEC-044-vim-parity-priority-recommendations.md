# Feature: Vim Parity — Priority Recommendations Roadmap

**Depends on:** SPEC-005 (vim editing model), SPEC-038 (unified keymap dispatch), SPEC-041 (operator+find-char), the Vim-vs-VSCode-Vim gap analysis (this conversation), `src/editor/CLAUDE.md` (primitives-only rule), `src/tlisp/CLAUDE.md` (T-Lisp owns editor logic).

### Prerequisites (must pass before implementation)

1. **[SPEC-005](./SPEC-005-vim-editing-motions.md)** — current vim editing model (operators, motions, counts). Items 1-9 extend this model without breaking it.
2. **[SPEC-038](./SPEC-038-unified-keymap-which-key.md)** — unified keymap dispatch routes every normal/visual/insert key through T-Lisp. Phase 1-2 bindings land in this dispatch path.
3. **[SPEC-041](./SPEC-041-operator-find-char.md)** — established the pattern for stashing pending-operator state and resuming after a sub-state (`df<char>` etc.). Phase 1 item 1 (text objects + operators) reuses this exact pattern.
4. **[src/editor/CLAUDE.md](../../src/editor/CLAUDE.md)** — TypeScript in `src/editor/api/` provides primitives only; decisions live in T-Lisp. Every step below that touches `.ts` must justify why T-Lisp can't compute it.

### Assumptions (correct these before implementation starts)

Per the spec-driven-development skill, surface assumptions before any spec content. Each of these is a guess — flag the wrong ones now.

1. **VS Code Vim is the right parity target.** Assumed because it's the most-installed vim emulator and the gap analysis used its feature surface. Alternative: target Neovim parity (more modern, more features). → If Neovim is the target, Phase 7 (Surround) and parts of Phase 6 (Ex ranges) move from "deferred" to "must-have."
2. **Phase 1 is genuinely bindings-only.** Verified by source (13 text-object primitives exist, `search-next`/`search-previous` are exposed, macro API is wired) EXCEPT for the macro-record-key hook (v3 finding #19) which IS a `normal-handler.ts` change. Phase 1 is "mostly bindings + one handler hook," not "pure bindings."
3. **The daemon caches T-Lisp files at startup.** Based on memory `feedback_daemon-restart-after-code-change.md`. The Pre-Phase-1 smoke (below) verifies this — if false, the daemon-restart rule can be relaxed for T-Lisp-only changes.
4. **Replace mode belongs as a new TypeScript mode union value (Strategy A), not an insert sub-state.** Picked for type safety; reconsider if the 5-site TS change proves larger than expected.
5. **Count × operator × text-object multiplication follows the existing `vim-operator-total-count` formula** at operators.tlisp:117-119. Unverified for text objects — confirm `d2iw` actually deletes 2 words before assuming.
6. **No existing tests assume `q` quits globally.** Phase 1.3 rebinds `q`; if a UI test asserts `q`-quit behavior at top-level, it will break. (Audit: `grep -rn 'send_keys.*"q"' test/ui/`.)
7. **Macro-record-key should be captured BEFORE the bound command executes** (vim records literal keys, not effects). Unverified against tmax's macro playback model — lock down in Step 1.3.
8. **The 11 priority recommendations are still the right 11.** Based on the June 2026 gap analysis. If the codebase has shipped any of them since, re-scope before starting.

→ Correct any of these now. The rest of the spec proceeds with them as given.

### Plan Review Notes (v2 — second pass, verified against source)

A pre-implementation review against the actual source surfaced these corrections, which are reflected in the steps below. Future reviewers should re-verify each item before its phase starts — file locations drift.

| # | Claim in v0/v1 | Verified against source | Correction applied |
|---|---|---|---|
| 1 | Ex command table lives in `commands/command-handler.ts` | Actually in `src/editor/api/bindings-ops.ts:56-128` (`editor-execute-command-line`) | Step 1.2, Step 5 references updated |
| 2 | `search-next` / `search-previous` would need T-Lisp wrappers | Already T-Lisp-callable: `search-ops.ts:343` and `:376` expose them via `api.set` | Step 1.2 simplified — direct bindings work |
| 3 | Mode union is at `mode-ops.ts:72` only | The union is duplicated: `mode-ops.ts:39` (function signature) and `:72` (validation array). Both need `'replace'`. Also check `bindings-ops.ts:33-34` for the same union | Step 2.1 enumerates all three sites |
| 4 | Text-object primitive names are camelCase (`deleteInnerWord`) | T-Lisp exposure is kebab-case: `delete-inner-word` at `text-objects-ops.ts:46` | Step 1.1 Lisp names corrected |
| 5 | Text-object dispatch "follows the SPEC-041 stash pattern" | SPEC-041's `vim-operator-apply-find` (operators.tlisp:77-115) also wraps mutations in `(undo-begin)` / `(undo-commit combo)` AND calls `(set-register "\"" deleted)`. Text-object dispatch MUST follow this exact bookending or undo + yank-pop break | Step 1.1 MUST list updated with explicit undo/register requirements |
| 6 | "Phase 5 indentation logic — find it (`grep -r "indent"`)" | Already exists: `src/tlisp/core/commands/indent.tlisp` exports `indent-current-line` and `indent-region`. Phase 5's `=` is mostly wrapping existing logic | Step 5.1 rewritten to lean on existing module |
| 7 | `q` rebinding glossed over as "dispatcher checks next key" | Reading the next key requires either `(read-key)` primitive or a new transient pending state — both are non-trivial and need explicit design | Step 1.3 design fleshed out with two options |
| 8 | `@` register-name reading not described | Same problem as #7 — needs `(read-key)` or a transient state | Step 1.3 updated |
| 9 | New T-Lisp files only need `(provide "name")` | Each new `commands/*.tlisp` must ALSO be added to the load list wherever existing libraries are required (find via `grep "commands/windows" src/`) | New Files table + Phase 1.3 MUST list updated |
| 10 | Visual-mode text objects (`iw`, `i"` in visual) described as "visual bindings only" | Visual text objects are NOT operator-pending — they expand the current selection. Different code path from normal-mode `diw`. | Step 1.1 visual section split out; Phase 5 owns visual `r`/`I`/`A` |
| 11 (v2) | "Cover ALL existing primitives in `text-objects.ts`" — v1 listed 24+ variants | **Only 13 primitives are exposed to T-Lisp** at `text-objects-ops.ts:46-280`: `delete-inner-word`, `delete-around-word`, `change-inner-single-quote`, `change-around-single-quote`, `change-inner-double-quote`, `change-around-double-quote`, `delete-inner-paren`, `change-inner-paren`, `delete-inner-brace`, `change-inner-brace`, `delete-inner-bracket`, `delete-inner-angle`, `delete-inner-tag`. Missing: `change-inner-word`, `change-around-word`, all `delete-around` for `{`, `[`, `<`, `t`, all `change-around` for `(`, `{`, `[`, `<`, `t`, `delete/change-around-paren`, `delete-inner-single-quote`, `delete-around-single-quote`, `delete-inner-double-quote`, `delete-around-double-quote`. So ~11 more TS primitives are needed before all 24+ `di{obj}`/`da{obj}`/`ci{obj}`/`ca{obj}` combos work. | Step 1.1 scope split: Tier-A (13 existing) wired first; Tier-B (11 missing) added as TS primitives in Step 1.1b before wiring |
| 12 (v2) | Text-object dispatch insertion point: "after the line-operator cases but before the 'Unsupported operator' fallthrough at operators.tlisp:203" | **Wrong location.** Line 203 is in `vim-operator-apply`. The key-dispatch entry is `vim-dispatch-operator-key` at line 207; its final fallthrough at line 230 `(vim-operator-apply key)` sends `i`/`a` straight to operator-apply. The text-object branch must intercept BEFORE line 230, alongside the existing `g`-pending (lines 209-218) and `f`/`t`/`F`/`T` (lines 228-229) checks. | Step 1.1 insertion-point MUST updated |
| 13 (v2) | Step 1.3 macros: "Do not touch handlers — MUST NOT modify `src/editor/handlers/*.ts`" | **Partially incorrect.** The macro API is exposed via `editor.ts:1302-1347` (`defineRaw("macro-record-start"/"-stop"/"-key"/"macro-play"/"macro-play-last")`). But `grep -rn "recordKey\|macro-record" src/editor/handlers/` returns ZERO matches — no handler calls `macro-record-key`. **Recording captures nothing today.** For `q` to actually record keys, EITHER (a) the T-Lisp unified dispatcher (`vim-dispatch-normal-key` from SPEC-038) must call `(macro-record-key <key>)` on every keypress when `(macro-recording-p)`, OR (b) each handler calls it. Option (a) is the architectural fit per `src/tlisp/CLAUDE.md`. This means macro recording is NOT pure T-Lisp — it needs a unified-dispatcher hook (in T-Lisp, not handlers, but it's still a non-trivial change). | Step 1.3 MUST list updated: macro recording requires unified-dispatcher hook, not just `q` binding |
| 14 (v2) | Validation command `python3 test/ui/tmax_harness/runner.py` | **`runner.py` does NOT exist.** `test/ui/tmax_harness/` contains library modules (`harness.py`, `client.py`, etc.) but no runner. The actual UI runner is `test/ui/run_python_suite.py` (invoked via `bun run test:ui` or `bun run test:ui:renderer`). | Validation Commands section fixed |
| 15 (v2) | Validation command `tmax --stop` | Assumes `tmax` is on PATH. The local binary is `bin/tmax` (also `bin/tmaxclient`). For development verification use `bin/tmax --stop` or `bun run daemon` + Ctrl-C. | Validation Commands section updated |
| 16 (v2) | New tests "see Testing Strategy" | No Testing Strategy section exists in the chosen template. Existing test files relevant to each phase: `test/unit/text-objects.test.ts`, `test/unit/operator-find-char.test.ts`, `test/unit/macro-recording.test.ts`, `test/unit/macro-persistence.test.ts`, `test/unit/macros.test.ts`, `test/unit/incremental-search.test.ts`, `test/unit/search-navigation.test.ts`, `test/unit/vim-dispatch.test.ts`, `test/unit/yank-operator.test.ts`, `test/unit/change-operator.test.ts`, `test/unit/delete-operator.test.ts`. Each phase's tests should EXTEND the matching existing file rather than create new ones; only genuinely new features warrant new files (`repeat-change.test.ts`, `marks.test.ts`, `jumplist.test.ts`, `indent-ops.test.ts`, `replace-mode.test.ts`). | Step-by-step acceptance criteria now name specific test files |
| 17 (v2) | "`q` is bound to `editor-quit`" | Confirmed at `src/tlisp/core/bindings/normal.tlisp:149`: `(key-bind "q" "(editor-quit)" "normal")`. The rebind is a single line change, but the dispatcher must preserve top-level quit semantics (covered in Step 1.3 design). | Step 1.3 confirmed |
| 18 (v2) | Runtime is "Bun" | Mixed: `start` is `node --import tsx` (per `package.json:7`), but `daemon`, `tui`, `tlisp`, and `test` are `bun`. Daemon-restart memory applies to `bun src/server/server.ts` invocations. | Validation Commands clarified |
| 19 (v3) | "the recording hook belongs in T-Lisp unified dispatch (per `src/tlisp/CLAUDE.md`), not in handler files" | **Wrong.** There is NO single T-Lisp function `vim-dispatch-normal-key`. The "unified keymap" is the `normal-handler.ts` flow itself (per the comment in `vim-dispatch.tlisp:5-9`): it routes pending-states → digits → prefix → keymap-ref lookup → `executeCommand(editor, cmdRight.value)` at `normal-handler.ts:129`. **The handler IS the chokepoint.** Recording must hook in at `normal-handler.ts:129` BEFORE `executeCommand`, calling `(macro-record-key <key>)` when `(macro-recording-p)`. This matches the existing pattern: the handler already calls `(vim-dispatch-operator-key ...)` and `(vim-dispatch-find-target ...)` to route into T-Lisp. The "handler routes, T-Lisp decides" rule is preserved — the handler is routing the key into the macro-record primitive, T-Lisp decides whether to store it. | Step 1.3 MUST list corrected: hook is in `normal-handler.ts:129`, not T-Lisp |
| 20 (v3) | Phase 2.1: extend existing `commands/replace.tlisp` with vim replace | **Name collision.** `src/tlisp/core/commands/replace.tlisp` already exists and implements Emacs-style `query-replace` (functions `query-replace`, `replace-yes`, `replace-no`, `replace-all`, `replace-quit`). Extending it with vim `r{char}`/`R` would conflate two unrelated features. | Step 2.1: vim replace logic goes in a NEW `commands/vim-replace.tlisp` file, NOT `replace.tlisp` |
| 21 (v3) | Step 1.3 Option B (`(read-key)` primitive) viable | **Not viable.** `grep -rn "read-key\|readKey" src/` returns ZERO matches — no such primitive exists. Building one would require a non-trivial async-read TS primitive. | Step 1.3 simplified: only Option A (transient pending state) is real; Option B struck |
| 22 (v3) | Phase 2.1 mode change requires touching 5 sites | **Alternative undersold.** Vim replace can be implemented as a sub-state flag on `'insert'` mode (analogous to how operator-pending is a T-Lisp global inside `'normal'` mode), avoiding ALL TypeScript changes. Trade-off: less type-safe, breaks mode-predicates like `(eq (editor-mode) "replace")`. | Step 2.1 Design Decisions: weigh "add new mode union value" (type-safe, 5 TS sites) vs "insert sub-state flag" (no TS change, less discoverable). Pick one explicitly |
| 23 (v3) | `set-register` for `"A` append: would need new code | **Already supported.** `set-register` at `evil-integration.ts:259` auto-detects uppercase for append (line 295: "Check if uppercase (append mode)"). `"Ayy` works through existing infrastructure with no new code. | Step 2.3 acceptance criterion `"Ayy appends` confirmed — no new work needed beyond parsing the `"x` prefix |

**Out of scope for this review pass** (still open): whether the daemon hot-reloads T-Lisp files or requires restart (memory says restart; the Pre-Phase-1 smoke resolves this). The Linux clipboard-availability probe for Phase 2.4 is unspecified — decide between (a) startup probe caching, (b) per-call probe. The `.`-repeat hook surface (Step 2.2) spans every operator AND every edit command — the cost estimate should be revisited before Phase 2 starts (likely 2-3× the original 1-3 day estimate). Whether `macro-record-key` should be called inside `vim-dispatch-*` BEFORE or AFTER the dispatched command executes (vim records the literal keys, not their effects) — this is a semantic detail that must be locked down in Step 1.3 design.

### Pre-Phase-1 smoke (do this FIRST, before any step)

A 30-minute exercise that de-risks Phase 1. Skipping it risks discovering the daemon-restart assumption was wrong mid-implementation.

1. Edit one `(key-bind ...)` line in an existing `commands/*.tlisp` file (say, change the bound command string).
2. Save. WITHOUT restarting the daemon, run `bun run start` and verify the change took effect.
3. If the change is live → daemon hot-reloads T-Lisp; the restart advice can be relaxed for T-Lisp-only phases. If not → restart is required for every Phase 1 step too.
4. Record the finding in `docs/learnings.md` (per CLAUDE.md §6) and update the Architecture Constraints table accordingly.

## Feature Description

This spec is the implementation roadmap for closing the highest-leverage gaps between tmax's current vim emulation and VS Code Vim's documented feature surface, as identified in the June 2026 gap analysis. The 11 recommendations break into three cost tiers:

- **Tier A — Bindings only (low cost, very high impact):** wire existing TypeScript primitives into the operator/search/macro keypaths so users can actually reach them from the keyboard. Primitives exist today; the user-visible features do not.
- **Tier B — Mode and parser extensions (medium cost, high impact):** add a replace mode value, a change-recording layer for `.`, and a register-prefix parser path. Each touches one TypeScript file plus T-Lisp.
- **Tier C — New functionality (higher cost, deferred in part):** WORD/sentence motions, marks + jumplist, indent/case operators, Ex ranges. Some are pure T-Lisp; others (marks, Ex ranges) need new TS primitive helpers.

Phases 1-5 below are in-scope. Phases 6-7 (Ex ranges / Surround) are explicitly deferred to follow-up specs because their cost is multi-week and they deserve dedicated design — they are listed here only to set expectation.

## User Story

As a tmax user coming from VS Code Vim (or any modern vim emulator)
I want the vim-defining workflows — `diw`, `/search`, `n/N`, `q`-recorded macros, `r{char}`, `.`, `"ayy`, `ma`/`'a`, `C-o`/`C-i` — to just work
So that I can edit code at the speed I expect from a vim-family editor, not the reduced subset that works today

## Problem Statement

A gap analysis (June 2026) between VS Code Vim and tmax found that tmax has working TypeScript primitives and T-Lisp libraries for several flagship vim features — text objects, search, macros, registers — but the **user-facing key bindings either don't exist or aren't wired end-to-end**. Specifically:

1. **Text objects** (`src/editor/api/text-objects.ts`, 706 lines) implement `deleteInnerWord`, `changeInnerSingleQuote`, `deleteInnerParen`, etc., but `vim-dispatch-operator-key` in `src/tlisp/core/commands/operators.tlisp` has no `iw`/`aw`/`i"`/`a{`/`it` cases — so `diw`, `ci"`, `dat` are unreachable.
2. **Search** primitives (`src/editor/api/search-ops.ts`, 873 lines; `commands/isearch.tlisp`) implement incremental search, next/previous, highlight, but `/`, `?`, `n`, `N` have no key bindings. Only `*` and `#` are bound.
3. **Macros** (`api/macro-recording.ts`, `api/macro-persistence.ts`) record, play, and persist to `~/.config/tmax/macros.tlisp`, but `q` is bound to `editor-quit` and `@` is unbound — the API is unreachable from the keyboard.
4. **Replace mode** (`r{char}`, `R`) doesn't exist; the `mode-ops.ts:72` type has no `'replace'` value.
5. **`.` repeat last change** has no implementation; no `vim-repeat-change` recording layer.
6. **Register-prefix syntax** (`"ayy`, `"ap`) has no parser path — the register API exists but only `M-x` callers reach it.
7. **WORD motions** (`W B E ge gE`), **sentence/section** (`( ) [[ ]]`) are missing entirely.
8. **Marks** (`m`, `'`, `` ` ``) and **jumplist** (`C-o`/`C-i`) have no implementation.
9. **Indent / case operators** (`> < = ~ gu gU g~ gq`) are missing entirely, including their visual-mode forms.
10. **Ex ranges** (`:1,5d`, `:.,$`, `:'<,'>`) and **Ex commands** (`:g`, `:v`, `:sort`, `:!`) are missing.

The first three are especially high-leverage because the implementation work is small — mostly `key-bind` lines and a few T-Lisp dispatch entries — yet they cover workflows that are arguably the most vim-defining.

## Solution Statement

1. **Phase 1** — Add an `operator+text-object` dispatch branch in `operators.tlisp` (reusing the `vim-pending-operator-for-find` stash pattern from SPEC-041), add `/`/`?`/`n`/`N`/`:nohl` bindings in `commands/isearch.tlisp`, and rebind `q`/`@`/`@@` to the existing macro record/play API.
2. **Phase 2** — Add `'replace'` to the `EditorMode` type, a minimal replace-handler, and `r{char}`/`R` bindings; build a change-recording list in `commands/repeat.tlisp` and bind `.`; extend operator-key dispatch to parse a `"x` prefix.
3. **Phase 3** — Add `W B E ge gE` and `( ) [[ ]] [ ]` as pure-T-Lisp motions over a new TS primitive that distinguishes WORD vs word boundaries.
4. **Phase 4** — Add a marks store (T-Lisp-owned, TS primitive for "set/get position by name") and a jumplist stack (T-Lisp-owned, populated by motions/operators that move >1 line); bind `m`, `'`, `` ` ``, `C-o`, `C-i`.
5. **Phase 5** — Add indent/case primitives (gap-buffer region ops) and T-Lisp operator wrappers for `> < = ~ gu gU g~ gq`, including visual-mode bindings.
6. **Phase 6 (DEFERRED)** — Ex ranges and `:g`/`:v`/`:sort`/`:!`. Out of scope here; see "Deferred to follow-up."
7. **Phase 7 (DEFERRED)** — Surround emulation (`ds`/`cs`/`ys`/`S`). Out of scope here; see "Deferred to follow-up."

## Tech Stack

| Layer | Technology | Version | Why |
|---|---|---|---|
| Runtime | Bun + Node (mixed) | Bun latest, Node via `tsx` | `start` uses `node --import tsx` (`package.json:7`); `daemon`, `tui`, `test`, `tlisp` use `bun`. Daemon-restart memory applies to `bun src/server/server.ts` invocations. |
| Language | TypeScript | ^5.9.3 | Strict mode, `tsconfig.src.json` / `tsconfig.test.json` split. |
| Editor logic | T-Lisp (built-in) | n/a | All decisions live in `src/tlisp/core/`. TypeScript only provides primitives. |
| UI test harness | Python + uv + tmux | Python 3.13, uv-managed | `test/ui/tmax_harness/` library, `test/ui/run_python_suite.py` runner. |
| Dependencies | ink, react, typescript, tsx | per `package.json` | Zero editor-logic deps — do NOT add new runtime deps for any phase. |
| Build | `bun build --compile` | n/a | Produces `dist/tmax` and `dist/tlisp` standalone binaries. |

**No new runtime dependencies.** Every phase must be implementable with the existing stack. Phase 2.4 (OS clipboard) uses `Bun.spawn` against platform tools (`pbcopy`/`xclip`/`clip`) — no npm clipboard package.

## Commands (build / test / lint / dev)

Single source of truth: `package.json:6-29`. Full commands:

```bash
# Development
bun run dev                              # Watch-mode dev server (node --import tsx --dev)
bun run start                            # One-shot run (node --import tsx)
bun run daemon                           # Daemon only (bun src/server/server.ts)
bun run tui                              # TUI client (bun src/client/tui-client.ts)

# Type checking
bun run typecheck                        # Full typecheck (src + test)
bun run typecheck:src                    # Source-only typecheck
bun run typecheck:test                   # Test-only typecheck

# Tests
bun run test                             # All bun tests
bun run test:unit                        # test/unit/ only
bun run test:integration                 # test/integration/ only
bun run test:daemon                      # Python suite, daemon subset
bun run test:ui                          # Full Python UI suite
bun run test:ui:renderer                 # Python UI suite, renderer/tmux subset
bun run test:ui:helpers                  # Harness self-tests

# Build
bun run build                            # Both tmax + tlisp standalone binaries
bun run build:tmax                       # Just tmax
bun run build:tlisp                      # Just tlisp

# Daemon lifecycle (for UI verification)
bin/tmax --stop                          # Stop the daemon (assumes bin/ on PATH or use ./bin/tmax)
bun run daemon                           # Start daemon in foreground (Ctrl-C to stop)
```

**Phase verification gate (run after every step):** `bun run typecheck && bun run test:unit && bun run test:ui:renderer`.

## Project Structure

Where each kind of change lands:

```
src/
├── core/                          → Buffer types, gap buffer, terminal primitives
│   └── types.ts                   → EditorMode union (Strategy A target for 'replace')
├── tlisp/
│   ├── core/
│   │   ├── bindings/              → (key-bind ...) per mode — Phase 1-5 keys land here
│   │   │   ├── normal.tlisp       → 'q' rebind (Phase 1.3), new motion/operator keys
│   │   │   ├── visual.tlisp       → Visual-mode keys (Phase 5 indent/case)
│   │   │   └── insert.tlisp       → Insert-mode keys (Phase 2 stretch)
│   │   └── commands/              → Command libraries — new files land here
│   │       ├── operators.tlisp    → Text-object dispatch (Phase 1.1b), "." hook (2.2)
│   │       ├── motions.tlisp      → WORD/sentence motions (Phase 3.1)
│   │       ├── vim-dispatch.tlisp → Pending-state helpers
│   │       ├── vim-counts.tlisp   → Count state machine
│   │       ├── indent.tlisp       → EXISTING — wrap for '=' operator (Phase 5.1)
│   │       ├── macros.tlisp       → NEW (Phase 1.3)
│   │       ├── vim-replace.tlisp  → NEW (Phase 2.1) — NOT replace.tlisp (collision)
│   │       ├── repeat.tlisp       → NEW (Phase 2.2)
│   │       ├── marks.tlisp        → NEW (Phase 4.1)
│   │       ├── jumplist.tlisp     → NEW (Phase 4.2)
│   │       ├── indent-ops.tlisp   → NEW (Phase 5.1)
│   │       └── command-history.tlisp → NEW (Phase 6 prerequisite)
│   └── ...
├── editor/
│   ├── api/                       → TS primitives ONLY (no decisions)
│   │   ├── mode-ops.ts            → validModes array (Strategy A target, line 72)
│   │   ├── text-objects-ops.ts    → Exposes 13 primitives (Phase 1.1a adds ~11 more)
│   │   ├── text-objects.ts        → Region computation (Phase 1.1a adds variants)
│   │   ├── evil-integration.ts    → Registers — 'A' append already works (Phase 2.3)
│   │   ├── search-ops.ts          → search-next/previous exposed (Phase 1.2 binds them)
│   │   ├── macro-recording.ts     → DO NOT TOUCH (production-ready)
│   │   └── clipboard-ops.ts       → NEW (Phase 2.4) — or extend evil-integration.ts
│   ├── handlers/                  → Mode dispatch routing (no logic)
│   │   ├── normal-handler.ts:129  → Macro-record-key hook (Phase 1.3, v3 finding #19)
│   │   ├── insert-handler.ts      → Template for replace-handler.ts (Phase 2.1)
│   │   └── replace-handler.ts     → NEW (Phase 2.1 Strategy A only)
│   └── editor.ts:1302-1347        → defineRaw() for macro primitives (already done)
├── server/                        → Daemon — no changes for Phases 1-5
└── client/                        → TUI client — no changes for Phases 1-5

test/
├── unit/                          → Bun tests, extend existing files
│   ├── text-objects.test.ts       → Phase 1.1a/1.1b
│   ├── operator-find-char.test.ts → Pattern template
│   ├── macro-recording.test.ts    → Phase 1.3
│   ├── incremental-search.test.ts → Phase 1.2
│   ├── vim-dispatch.test.ts       → Phase 1.1b dispatch
│   ├── replace-mode.test.ts       → NEW (Phase 2.1)
│   ├── repeat-change.test.ts      → NEW (Phase 2.2)
│   ├── marks.test.ts              → NEW (Phase 4.1)
│   ├── jumplist.test.ts           → NEW (Phase 4.2)
│   └── indent-ops.test.ts         → NEW (Phase 5.1)
├── integration/                   → Cross-module integration tests
└── ui/                            → Python UI tests
    ├── tmax_harness/              → Library (harness.py, client.py, etc.)
    ├── tests/                     → Test scenarios — extend for each phase
    └── run_python_suite.py        → Runner (invoked via bun run test:ui*)

docs/
├── specs/                         → THIS FILE + SPEC-045..053 (follow-ups)
├── adrs/                          → Architecture Decision Records — add per phase
├── rfcs/                          → RFCs for larger features
└── learnings.md                   → Persistent lessons — append per CLAUDE.md §6
```

**Rule:** every change must trace to a file in this tree. If you're editing a file not listed, the spec missed something — pause and update the spec.

## Code Style

The project follows the patterns in `src/tlisp/CLAUDE.md` and `src/editor/CLAUDE.md`. One real example beats description — this is the canonical command-library shape (from existing `commands/operators.tlisp:60-75`):

```lisp
(defmodule editor/commands/operators
  (export vim-operator-pending-p vim-begin-operator vim-reset-operator
          vim-operator-apply vim-dispatch-operator-key vim-operator-apply-find)

;; Module-level state — pending operator lives here, NOT in TypeScript.
(defvar vim-pending-operator nil)
(defvar vim-operator-count 1)
(defvar vim-pending-operator-for-find nil)       ;; SPEC-041 stash pattern

(defun vim-begin-operator (operator)
  "Begin a Vim OPERATOR command. Stashes operator + count, sets status."
  (progn
    (set! vim-pending-operator operator)
    (set! vim-operator-count (vim-count-consume))
    (editor-set-status (concat operator " operator"))
    t))

;; The dispatch entry — handlers route keys here, T-Lisp decides.
(defun vim-dispatch-operator-key (key)
  "Dispatch KEY while an operator is pending."
  (if vim-operator-g-pending
    ...handle g-prefix...
    (if (or (string= key "f") (string= key "t")
            (string= key "F") (string= key "T"))
      (vim-operator-begin-find key)              ;; SPEC-041 stash pattern
      (vim-operator-apply key))))                ;; fallthrough

(provide "operators")
```

**Conventions:**
- **T-Lisp owns state.** `(defvar ...)` for any pending/active flag. Never store editor decisions in TypeScript.
- **TS exposes primitives only** via `api.set("name", (args) => Either<...>)`. Region computation yes, "what to delete" no.
- **Operators wrap mutations in `(undo-begin)` / `(undo-commit combo)`** and call `(set-register "\""` <text>)`. See `vim-operator-apply-find` lines 100, 114.
- **Handlers route, never decide.** `normal-handler.ts` calls `(vim-dispatch-operator-key "<key>")`; it never inspects the key itself.
- **Counts multiply:** operator-count × motion-count via `vim-operator-total-count` (operators.tlisp:117-119).
- **Naming:** T-Lisp kebab-case (`delete-inner-word`), TS camelCase (`deleteInnerWord`).
- **No comments unless WHY is non-obvious.** A `;; TODO vim-record-change` hook is OK; a `;; This deletes the word` comment is not.
- **Each command file ends with `(provide "name")` AND must be added to the load list** wherever existing libraries are required.

## Testing Strategy

| Level | Framework | Location | When |
|---|---|---|---|
| Unit (TS) | `bun test` | `test/unit/*.test.ts` | Every new primitive, every T-Lisp dispatch branch |
| Integration | `bun test` | `test/integration/` | Cross-module flows (operator + text-object + undo + register) |
| UI (end-to-end) | Python + uv + tmux | `test/ui/tests/*.py` | Every user-visible feature; sends real keys, inspects captured output |
| Daemon | Python suite | `test/ui/run_python_suite.py daemon` | Daemon-resident state (macro persistence, marks across buffers) |

**Coverage expectations:**
- Every Phase N acceptance criterion maps to at least one test (unit OR UI).
- Visual/rendering changes MUST have a UI test, not just unit — per memory `feedback_verify-end-to-end-not-unit-only.md`.
- Operators and edits MUST have an undo round-trip test (`<op>` then `u` restores text + cursor).
- Register writes MUST have a yank-pop test (`<op>` then `M-y` cycles).

**Test file policy:** extend existing files (`text-objects.test.ts`, `macro-recording.test.ts`, etc.) when the feature fits. Create new files only for genuinely new features (`replace-mode.test.ts`, `repeat-change.test.ts`, `marks.test.ts`, `jumplist.test.ts`, `indent-ops.test.ts`).

**Test ordering:** TDD per `rules/testing.md` — write the test first, watch it fail, implement, watch it pass. No exceptions for Phase 1-3.

## TDD Discipline (per `test-driven-development` skill)

Every step in every phase follows RED → GREEN → REFACTOR. "Seems right" is not done. A step is incomplete until a previously-failing test passes.

### The cycle, mapped to this spec

```
RED                GREEN               REFACTOR
 ───                ────                ────────
Add a test       Make it pass        Clean up
to test/unit/    via the T-Lisp      the T-Lisp
or test/ui/      dispatch / TS       module shape
                 primitive           (tests still green)
   │                  │                   │
   ▼                  ▼                   ▼
bun test             bun test            bun test
FAILS                PASSES              PASSES
```

**No exceptions for Phases 1-5.** If a step's RED test passes immediately, the test is wrong (or the feature already exists — re-run the gap analysis).

### RED — write the failing test first

Each acceptance criterion in each step MUST have a corresponding test written BEFORE implementation. Place it in the file named in the step's acceptance list. The test asserts the END STATE (buffer contents, cursor position, register contents), never the implementation.

**Template** (mirrors `test/unit/operator-find-char.test.ts:38-52` — copy this shape):

```typescript
import { describe, expect, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import {
  bufferText,
  createStartedEditor,
  executeTlisp,
} from "../helpers/editor-fixture.ts";

async function press(editor: Editor, keys: string): Promise<void> {
  for (const key of keys) {
    await editor.handleKey(key);
  }
}

function getRegister(editor: Editor, name: string = '"'): string {
  const escaped = name === '"' ? '\\"' : name;
  const value = executeTlisp(editor, `(get-register "${escaped}")`);
  if (value.type === "nil") return "";
  if (value.type === "string") return value.value as string;
  throw new Error(`Register ${name} held unexpected type: ${value.type}`);
}

describe("SPEC-044 Phase 1.1b — operator+text-object dispatch", () => {
  describe("diw — delete inner word", () => {
    test("deletes the word under the cursor and yanks to \"", async () => {
      // RED: This test fails because vim-dispatch-operator-key at
      // operators.tlisp:230 has no i/a interception — diw falls through to
      // (vim-operator-apply "i") → "Unsupported operator: di".
      const editor = await createStartedEditor("hello world foo");
      await press(editor, "diw");
      expect(bufferText(editor)).toBe(" world foo");
      expect(getRegister(editor)).toBe("hello");
    });

    test("restores text and cursor after undo", async () => {
      const editor = await createStartedEditor("hello world");
      await press(editor, "diw");
      await press(editor, "u");
      expect(bufferText(editor)).toBe("hello world");
    });
  });
});
```

**Naming convention** (per skill: "name tests descriptively, read like a specification"):
```typescript
// Good — describes behavior
test("diw deletes the word under the cursor and yanks to \"")
test("ci\" enters insert mode with quote contents removed")
test("3rx overwrites 3 characters with x starting at cursor")
test("@a replays the macro stored in register a")
test("ma then 'a jumps to the marked line")

// Bad — describes implementation
test("calls deleteInnerWord when 'i' is dispatched")
test("sets vim-pending-operator correctly")
```

### GREEN — minimum code to pass

Write the smallest change that turns RED green. No extra features. No abstractions for hypothetical future cases.

For Phase 1.1b the GREEN step is:
1. Add the `i`/`a` interception in `vim-dispatch-operator-key` (operators.tlisp:230 area).
2. Add `vim-operator-apply-text-object` mirroring `vim-operator-apply-find` shape.
3. Wire the 13 existing text-object primitives into the dispatch table.
4. Run `bun test test/unit/text-objects.test.ts` — passes.

Do NOT add the Tier-B primitives (Step 1.1a) during 1.1b's GREEN. Step 1.1a is its own RED/GREEN cycle.

### REFACTOR — clean up with tests still green

Only after GREEN passes. Extract shared dispatch logic, rename for clarity, remove duplication. Run `bun test` after EACH refactor step. If a refactor breaks a test, revert — don't adjust the test to match the refactor.

### The Prove-It Pattern (applied to this spec)

For each bug surfaced during implementation, do NOT jump to a fix. Write a reproduction test first.

**Example:** During Phase 1.3 macros, suppose `@a` plays the macro but the recorded keys include the stopping `q`. Bug report → reproduction test:

```typescript
describe("SPEC-044 Phase 1.3 — macro recording edge cases", () => {
  test("recorded macro does NOT include the stopping q key", async () => {
    // RED: confirms the bug — current implementation records the q
    const editor = await createStartedEditor("aaa\nbbb\nccc");
    await press(editor, "qa");    // start recording into a
    await press(editor, "jx");    // down + delete char
    await press(editor, "q");     // stop recording
    await press(editor, "gg");    // back to top
    await press(editor, "@a");    // replay
    // If q was recorded, @a would press q → editor-quit → editor closes.
    // Test passes if line 2 has one char deleted, not if editor quit.
    expect(bufferText(editor)).toBe("aaa\nbb\nccc");
  });
});
```

Bug confirmed → fix in T-Lisp (skip recording the literal `q` if it's the stop signal) → test passes → push.

### Test Pyramid for this spec

```
              ╱╲
             ╱  ╲         UI tests (test/ui/tests/*.py)
            ╀    ─         ~15% — daemon-resident state,
           ╱      ╲          visual rendering, end-to-end keys
          ╱────────╲
         ╱          ╲       Integration tests (test/integration/)
        ╱            ╲      ~25% — operator+text-object+undo+register flows
       ╱──────────────╲
      ╱                ╲    Unit tests (test/unit/*.test.ts)
     ╱                  ╲   ~60% — per-operator, per-motion, per-primitive
    ╱────────────────────╲
```

**Size classification** (per skill):

| Size | This spec's examples |
|---|---|
| **Small** (ms, no I/O) | `diw` deletes a word; `rx` overwrites a char; `.` repeats last change |
| **Medium** (multi-process, localhost) | Macro persists across daemon restart; OS clipboard round-trip via `pbcopy`/`pbpaste` |
| **Large** (external services) | None in scope — Phase 6 `:!cmd` shell-out would qualify but is deferred |

**Decision guide:**
- Pure T-Lisp dispatch logic, single buffer → **unit** (`test/unit/*.test.ts`)
- Crosses a TS primitive boundary (registers, undo) → **unit** with real primitives (no mocks — see below)
- Daemon state across client calls → **integration** or **UI**
- Anything user-visible that draws to terminal → **UI** (mandatory per memory `feedback_verify-end-to-end-not-unit-only.md`)

### DAMP over DRY in tests

Each test should read as a standalone specification. Duplication across `press(editor, "diw")` + `expect(bufferText(editor))` blocks is GOOD — it means each test tells its own story. Do NOT extract a `testDiw(input, expected)` helper just because six tests share the shape.

### Real implementations over mocks (critical for this spec)

The macro API, register API, search API, and undo API are all in-process TypeScript functions. NEVER mock them.

```
Preference order:
1. Real editor (createStartedEditor) — use this for ~90% of tests
2. Fake buffer / in-memory state — only when editor bootstrap is too slow
3. Stub returning canned register/buffer data — almost never
4. Mock verifying api.set was called — NEVER. This tests implementation, not behavior.
```

Bad example to avoid:
```typescript
// ❌ This tests that we called setRegister, not that the register was set
test("diw yanks to register", () => {
  const spy = vi.spyOn(registerApi, "setRegister");
  press(editor, "diw");
  expect(spy).toHaveBeenCalledWith('"', "hello");  // implementation detail
});

// ✅ This tests the actual register state
test("diw yanks to register", async () => {
  await press(editor, "diw");
  expect(getRegister(editor)).toBe("hello");  // behavior
});
```

### Arrange-Act-Assert per test

```typescript
test("ci\" enters insert mode and clears quote contents", async () => {
  // Arrange — set up buffer + cursor at a known position
  const editor = await createStartedEditor('say "hello world" today');
  await press(editor, "fh");   // cursor on 'h' inside quotes

  // Act — the operation under test
  await press(editor, "ci\"");

  // Assert — the end state
  expect(bufferText(editor)).toBe('say "" today');
  // Verify we're in insert mode by typing and seeing it appear
  await press(editor, "hi");
  expect(bufferText(editor)).toBe('say "hi" today');
});
```

### One assertion per concept, not per test

It's OK to assert buffer + register + mode in one test if they're all consequences of the same behavior. Don't split a single behavior across three tests just to satisfy "one assertion."

Bad splitting:
```typescript
// ❌ Three tests for one behavior — fragments the story
test("diw deletes text", ...);
test("diw yanks to register", ...);
test("diw leaves cursor at start", ...);
```

Acceptable grouping:
```typescript
// ✅ One behavior, multiple state assertions
test("diw deletes word, yanks to \"", and positions cursor", async () => {
  const editor = await createStartedEditor("hello world");
  await press(editor, "diw");
  expect(bufferText(editor)).toBe(" world");
  expect(getRegister(editor)).toBe("hello");
  // cursor position check via executeTlisp
  const line = executeTlisp(editor, "(cursor-line)");
  const col = executeTlisp(editor, "(cursor-column)");
  expect([line.value, col.value]).toEqual([0, 0]);
});
```

### TDD Per-Phase checklist

Before starting each step, the implementer confirms:

- [ ] RED test written and committed before any production code change.
- [ ] RED test observed FAILING (run `bun test <file>` and capture output).
- [ ] Failure reason is "feature missing" — NOT a typo, NOT a wrong import.
- [ ] GREEN code is the minimum to pass — no extra features sneak in.
- [ ] After GREEN, REFACTOR step ran with `bun test` green after each change.
- [ ] Test name describes behavior, not implementation.
- [ ] No mocks of in-process APIs (registers, undo, search) — real implementations only.
- [ ] UI test added if the feature is user-visible (per memory).
- [ ] If a bug was found during implementation, a separate reproduction test was written first (Prove-It Pattern).

### TDD Red Flags (apply to every PR implementing this spec)

- Code lands without a corresponding test.
- Test passes on first run — suspect it's testing the wrong thing.
- "All tests pass" claimed without showing test output.
- Bug fix without a reproduction test that previously failed.
- Tests asserting `api.set` was called with specific arguments (implementation detail).
- Skipping a failing test (`test.skip`, `--bail`) to manufacture green.
- Running `bun test` twice in a row with no code change between (per skill: adds no confidence).
- Test names like `"works"`, `"handles error"`, `"test 1"`.

## Incremental Implementation Discipline (per `incremental-implementation` skill)

Each phase below is sliced into vertical, end-to-end increments. Every increment leaves the system in a working, testable state. No increment lands more than ~100 lines without a test+commit cycle.

### The increment cycle (per slice)

```
For each increment in each phase:
  1. RED         — write failing test (per TDD Discipline section)
  2. GREEN       — minimum code to pass
  3. VERIFY      — bun run typecheck && bun run test:unit && (daemon restart) && bun run test:ui:renderer
  4. COMMIT      — atomic, descriptive message (per git-workflow-and-versioning)
  5. NEXT SLICE  — carry forward, do not restart
```

**Hard rules from the skill:**
- **One thing per increment.** A commit that wires `diw` AND adds `/` search bindings is two commits. Split them.
- **Keep it compilable.** After every increment: `bun run typecheck` green, `bun run test:unit` green. Never leave the tree broken between slices.
- **Rollback-friendly.** Additive changes (new files, new `(key-bind ...)` lines) are easy to revert. Modifications to existing dispatch tables should be minimal and focused. Never delete + replace in the same commit.
- **No scope creep.** Touch only what the increment requires. Notice dead code or refactoring opportunities? Note them — don't fix them. (CLAUDE.md §3 echoes this.)
- **Run verification ONCE per code change.** No reassurance reruns on unchanged code.

### Slicing plan — Phase 1 (Bindings-Only Wiring)

Phase 1 has 3 logical features (text objects, search, macros). Each is its own vertical slice, sub-sliced where useful.

| Slice | Scope | In scope | Out of scope | Verify |
|---|---|---|---|---|
| **1.A** | Text objects, Tier-A (13 existing primitives) | Add `i`/`a` interception at `operators.tlisp:230`; add `vim-operator-apply-text-object`; wire `diw daw ci" ca" ci' ca' di) ci) di} ci} di] di< diT` only | Tier-B variants (`ciw caw da) ca) …`); count multiplier; register prefix | `bun test test/unit/text-objects.test.ts` for the 13 combos; `bun run test:ui:renderer` |
| **1.B** | Text objects, Tier-B (11 missing primitives) | Add the missing TS primitives to `text-objects.ts` + `text-objects-ops.ts`; wire `ciw caw da) ca) da} ca} da] ca] da< ca< dat cat di' da' di" da"` | Visual-mode text objects; `d2iw` count multiplier (separate slice) | `bun test test/unit/text-objects.test.ts` for the 11 new combos |
| **1.C** | Text-object count multiplier | Verify/implement `d2iw`, `d3aw` using existing `vim-operator-total-count` formula | Visual text objects; new operators | Count tests pass |
| **1.D** | Search bindings (`/ ? n N`) | Add 4 `(key-bind ...)` lines to `isearch.tlisp`; verify incremental search minibuffer works | `:nohl`; visual `/`; regex | `bun test test/unit/incremental-search.test.ts` + `search-navigation.test.ts` |
| **1.E** | `:nohl` Ex command | Add `:nohl`/`:noh` to `editor-execute-command-line` in `bindings-ops.ts:56-128`; call existing `search-clear` | New search primitives | UI test for `:nohl` clears highlights |
| **1.F** | Macro bindings (`q` record) | Add `commands/macros.tlisp`; rebind `q` from `editor-quit` to dispatcher; preserve top-level quit on cancel | `@` play; `@@` replay; recording-capture hook | `bun test test/unit/macros.test.ts` — `qa` enters recording state |
| **1.G** | Macro recording-capture hook (v3 finding #19) | Add `(macro-record-key <key>)` call at `normal-handler.ts:129` when `(macro-recording-p)` | `@` play; persistence | Unit test: record `jxjx`, replay via API, verify buffer state |
| **1.H** | Macro play (`@` + `@@`) | Bind `@` to register-dispatch; bind `@@` to `executeLastMacro` | Persistence across restarts | `bun test test/unit/macro-recording.test.ts` — `@a` plays `qa` recording |
| **1.I** | Macro persistence verification | Verify existing `saveMacrosToFile` hook fires on stop; no new code if already wired | New persistence logic | Restart daemon, `@a` still works |

**9 slices in Phase 1.** Each is independently shippable, revertable, and testable. Stop and reassess after every slice — if Slice 1.A reveals an unexpected issue (e.g., `operators.tlisp` is shared with visual mode in a surprising way), pause before continuing.

**Risk-first sub-ordering inside Phase 1:** 1.G (recording hook) is the riskiest slice because it touches a TypeScript handler — do it EARLY (right after 1.F so the binding exists), not last. If 1.G fails, macros don't actually record and Slices 1.H-1.I are pointless.

### Slicing plan — Phase 2 (Mode + Parser Extensions)

| Slice | Scope | Risk | Verify |
|---|---|---|---|
| **2.A** | Replace mode Strategy A — TS union change (5 sites) | Medium — touches type signatures | `bun run typecheck:src` clean; existing mode tests still pass |
| **2.B** | Replace mode — `r{char}` two-key command | Low (pure T-Lisp) | `bun test test/unit/replace-mode.test.ts` |
| **2.C** | Replace mode — `R` mode + handler | Low | `bun test test/unit/replace-mode.test.ts` |
| **2.D** | `.` repeat — recorder scaffolding | Medium — every operator must call `vim-record-change` | Recorder tests for `dw`, `dd`, `ciw` |
| **2.E** | `.` repeat — replay | Low | `bun test test/unit/repeat-change.test.ts` — `dw.` deletes next word |
| **2.F** | `.` repeat — insert-mode capture | High — hook into insert-handler Esc | `ihi<Esc>.` re-inserts |
| **2.G** | `"x` register prefix | Medium — extends operator-key dispatch | `"ayy`, `"ap`, `"Ayy` |
| **2.H** | OS clipboard bridge | Medium — TS primitive + platform detection | macOS `pbcopy`/`pbpaste` round-trip |

**8 slices.** Slice 2.A is its own commit because it's a type-system change that should land before any code depends on `'replace'`. If Strategy A proves too invasive at slice 2.A, pause and reconsider Strategy B (T-Lisp sub-state flag) before continuing.

### Slicing plan — Phase 3 (Missing Motions)

| Slice | Scope | Verify |
|---|---|---|
| **3.A** | `W B E` WORD motions | `bun test test/unit/word-motions.test.ts` (extend existing) |
| **3.B** | `ge gE` backward word-end | Same file |
| **3.C** | `( )` sentence motions | New test file or extend |
| **3.D** | `[[ ]] [ ]` section motions | Same |
| **3.E** | `H M L` window-relative | New test file |
| **3.F** | `C-e C-y` single-line scroll | Same |
| **3.G** | `gj gk g_` screen-line motions | Same |

**7 slices, each small.** Each motion is its own commit because they're independent — no motion depends on another. Order is arbitrary; pick by user-impact (WORD motions are highest-value).

### Slicing plan — Phase 4 (Marks + Jumplist)

| Slice | Scope | Verify |
|---|---|---|
| **4.A** | Mark store + `ma` set + `'a`/`` `a `` jump | `bun test test/unit/marks.test.ts` |
| **4.B** | `:marks` Ex command listing | UI test for the listing buffer |
| **4.C** | Special marks `'< '> '[ '] '^ .` | Extend marks tests |
| **4.D** | Global marks `mA` cross-buffer | Daemon test |
| **4.E** | Jumplist store + `C-o`/`C-i` | `bun test test/unit/jumplist.test.ts` |
| **4.F** | Jumplist push hooks on `gg G n N * # %` | Extend jumplist tests |

**6 slices.** 4.A is the foundation — 4.B-4.D build on it. 4.E-4.F are independent of marks but depend on the same position-store primitive.

### Slicing plan — Phase 5 (Indent / Case / Format Operators)

| Slice | Scope | Verify |
|---|---|---|
| **5.A** | `>>` `<<` line indent/outdent | `bun test test/unit/indent-ops.test.ts` |
| **5.B** | `>` `<` operator + motion forms (`>w`, `>j`) | Same |
| **5.C** | Visual mode `>` `<` | UI test |
| **5.D** | `gu` `gU` `g~` lowercase/uppercase/toggle (line + operator + visual) | Extend indent-ops tests |
| **5.E** | `~` toggle-case-char | Same |
| **5.F** | `=` operator via existing `indent-region` from `indent.tlisp` | Same |

**6 slices.** 5.F is last because it depends on language-aware indent — markdown/lisp work, TS/JS may not. If 5.F fails for TS, defer to SPEC-045 (per Design Decisions).

### Cross-phase slicing rules

- **Each slice ends with a green `bun run test:unit` AND `bun run test:ui:renderer`.** Not "next slice will fix it."
- **Each slice is a single git commit** with format `feat(vim-parity): phase 1.A wire diw/daw operator+text-object dispatch`.
- **Daemon restart between TS-touching slices.** Per memory `feedback_daemon-restart-after-code-change.md`. T-Lisp-only slices may not need it (verify with Pre-Phase-1 smoke).
- **Slice ordering is by dependency, not perceived importance.** 1.A before 1.B before 1.C — the dispatcher must exist before the Tier-B primitives can be wired.
- **No slice touches more than ~5 files.** If it does, split it. (Per `spec-driven-development` Phase 3 task rule.)
- **No slice writes more than ~100 lines without a test run.** (Per `incremental-implementation` red flag.)

### When to stop and reassess

Pause and update the spec BEFORE continuing if any of these happen mid-increment:

- A slice unexpectedly touches files outside the Project Structure map.
- A RED test reveals the assumed primitive doesn't exist (e.g., `(read-key)` ghost from v2 review).
- A GREEN step requires >100 lines (the slice is too big — split it).
- A daemon-restart doesn't pick up the change (T-Lisp caching question — re-run Pre-Phase-1 smoke).
- A bug surfaces that contradicts a v3 review finding (the finding was wrong — update the review table).
- An Open Question becomes blocking (answer it in the PR description before merging).

### Simplicity-first gate (per skill Rule 0)

Before writing any slice's GREEN code, ask: "What is the simplest thing that could work?"

After writing, check:
- Can this be done in fewer lines?
- Are these abstractions earning their complexity?
- Would a staff engineer look at this and say "why didn't you just…"?
- Am I building for hypothetical future requirements, or the current slice?

```
SIMPLICITY CHECK for Phase 1.A:
✗ Generic text-object dispatch table with metadata-driven resolver
✓ cond chain in vim-dispatch-operator-key, 13 cases

SIMPLICITY CHECK for Phase 2.D (repeat recorder):
✗ Generic event-sourcing model with replay engine
✓ List of (operator, motion, count, register) tuples + simple replay function
```

Implement the naive, obviously-correct version first. Optimize only after correctness is proven with tests.

### Rollback-friendly commit shape

Every slice's commit must be revertable in isolation:

```
GOOD commit (Phase 1.A):
  - Add i/a interception in operators.tlisp:230
  - Add vim-operator-apply-text-object function
  - Add 13 dispatch cases
  - Add 13 unit tests
  → git revert <sha> restores the pre-slice state cleanly

BAD commit (do NOT do this):
  - Phase 1.A + 1.B + 1.C bundled
  - "While I was here, also fixed the visual-mode bug"
  → Reverting pulls out unrelated work; can't isolate the bug
```

Per Rule 5: never delete + replace in the same commit. If Phase 1.F rebinds `q`, that's two commits — (1) add the macro dispatcher, (2) remove the old `editor-quit` binding. Revert either independently.

## Boundaries

### Always do
- Run `bun run typecheck && bun run test:unit && bun run test:ui:renderer` after every step. Zero exceptions.
- Restart the daemon after any `.ts` change before any UI test (memory `feedback_daemon-restart-after-code-change.md`).
- Wrap every mutation in `(undo-begin)` / `(undo-commit combo)` and write `(set-register "\""` <text>)`. Skipping breaks undo + yank-pop.
- Add new T-Lisp command files to the load list (grep for `windows.tlisp`/`tabs.tlisp` to find it).
- Place new keys via `(key-bind ...)` in `bindings/*.tlisp`, NEVER in handler code.
- Place new primitives in `src/editor/api/*.ts` via `api.set(...)`, NEVER make editor decisions there.
- Verify multibyte/emoji handling for any new char-level operation (BUG-09 awareness).
- Append to `docs/learnings.md` when the user corrects a mistake (CLAUDE.md §6).
- Read `rules/{typescript,tlisp,editor,testing,ui-testing,daemon-client}.md` before touching the corresponding area.

### Ask first
- Adding any new TypeScript mode union value (Strategy A in Phase 2.1) — touches 5 sites.
- Adding any new runtime dependency. Default answer: no.
- Changing the daemon's T-Lisp load sequence.
- Removing or renaming any existing T-Lisp function (callers may exist in user `init.tlisp`).
- Changing the `EditorMode` type signature (cascades through handler files).
- Deferring any Phase N item to a follow-up spec mid-implementation.
- Shipping a feature without a corresponding UI test for visual/rendering changes.

### Never do
- Add editor decisions (what to delete, how to move, which mode) in `src/editor/api/*.ts` or `src/editor/handlers/*.ts`.
- Add a `(read-key)` primitive — does not exist, and the SPEC-041 stash pattern makes it unnecessary.
- Reimplement region computation in T-Lisp when a TS primitive already exists.
- Commit failing tests to "clean up later" or skip a check (`--no-verify`, `bun test --skip`) to manufacture green.
- Touch `src/editor/api/macro-recording.ts` — production-ready, the API is the boundary.
- Extend `src/tlisp/core/commands/replace.tlisp` with vim semantics — name collision with Emacs `query-replace`; use `vim-replace.tlisp`.
- Modify `bin/tmax` or `bin/tlisp` launcher scripts without explicit user authorization.
- Delete pre-existing dead code unless asked — mention it, don't remove it (CLAUDE.md §3).

## Architecture Constraints

| Area | Governing Doc | Rule |
|------|--------------|------|
| Editor layer | `src/editor/CLAUDE.md` | TypeScript in `src/editor/api/` provides primitives ONLY. Decisions (what to delete, how to move, which mode) live in `src/tlisp/core/`. |
| T-Lisp layer | `src/tlisp/CLAUDE.md` | All state machines, dispatch, key sequences, count logic live in T-Lisp. Add TS primitives only when T-Lisp literally cannot compute something (char scanning, buffer access). |
| Command library pattern | `src/tlisp/CLAUDE.md` | Follow `windows.tlisp` / `tabs.tlisp` / `isearch.tlisp`: define functions, add `(key-bind ...)` in the same file, end with `(provide "name")`. |
| Mode type | `src/editor/api/mode-ops.ts:72` | Modes are a closed string union. Adding `'replace'` is a one-line TS change that must be matched in `setMode` callers and T-Lisp `editor-set-mode` validation. |
| Operator state pattern | SPEC-041 (`src/tlisp/core/commands/operators.tlisp`) | Pending-operator state is stashed in module-level `defvar`, consumed when the sub-state (find, text-object) resolves. New branches must follow this pattern; do NOT add a parallel state machine. |
| Unified keymap | SPEC-038 (`src/editor/handlers/normal-handler.ts`) | All normal/visual/insert keys route through `vim-dispatch-*` in T-Lisp. New keys must be `(key-bind ...)` lines, not handler changes. |
| Verification | `CLAUDE.md` §8 | Every step must end with `bun run typecheck:src`, `bun run typecheck:test`, `bun run test:ui:renderer`, and `bun run typecheck`. Visual/rendering changes MUST be verified in the running daemon (per memory `feedback_verify-end-to-end-not-unit-only.md`). |
| Daemon restarts | Memory `feedback_daemon-restart-after-code-change.md` | After any TS source change, restart the daemon before UI verification. Unit tests don't pick up stale-daemon regressions. |

Fill this table **before writing steps.** ✅ done above.

## Relevant Files

### Existing Files to Modify

| File | Change | Constraints |
|------|--------|-------------|
| `src/tlisp/core/commands/operators.tlisp` | Add `iw/aw/iW/aW/is/as/ip/ap/i"/a"/i'/a'/i`/a\``/i(/a)/i{/a}/i[/a[/i</a</it/at` dispatch branch; parse `"x` register prefix before operator; trigger `vim-record-change` after operator completes | SPEC-041 stash pattern. Operator state owned here, not in TS. |
| `src/tlisp/core/commands/isearch.tlisp` | Add `(key-bind "/" "?" "n" "N" ":nohl")` to the existing search primitives; export the binding functions | Follow the `windows.tlisp`/`tabs.tlisp` library pattern. No new state machine. |
| `src/tlisp/core/commands/macros.tlisp` (new — see below) OR extend `commands/edit-commands.tlisp` | Bind `q` (start/stop record), `@` (play), `@@` (replay last); preserve `q` as `editor-quit` only at top-level when not recording | Memory `feedback_daemon-restart-after-code-change.md`. The `q` binding must check `(macro-recording-p)` first. |
| `src/tlisp/core/commands/repeat.tlisp` (new) | `vim-record-change`, `vim-repeat-last-change`. Operators and `i/a/o/x/r` push entries; `.` replays | Pure T-Lisp. No TS change. |
| `src/tlisp/core/bindings/normal.tlisp` | Add WORD/sentence/section motion bindings (`W B E ge gE ( ) [[ ]] [ ] m ' \` C-o C-i > < = ~ r R . @`); remove/replace `q` binding | All new keys go here, not in handler code. |
| `src/tlisp/core/bindings/visual.tlisp` | Add `> < = ~ r I A` (visual indent/case/replace) and text-object keys (`iw aw i" a" …`) inside visual | Visual bindings only. |
| `src/tlisp/core/commands/motions.tlisp` | Add WORD/sentence/section motion functions and `H M L C-e C-y gj gk g_` | Pure T-Lisp where possible; WORD-vs-word boundary detection may need a TS primitive. |
| `src/tlisp/core/commands/marks.tlisp` (new) | `set-mark`, `goto-mark-line`, `goto-mark-col`, `:marks` listing | Pure T-Lisp state plus TS position primitive. |
| `src/tlisp/core/commands/jumplist.tlisp` (new) | `push-jump`, `jump-back`, `jump-forward`; hook motions/operators to call `push-jump` on >1-line moves | Pure T-Lisp ring buffer. |
| `src/tlisp/core/commands/indent-ops.tlisp` (new) | `indent-region`, `outdent-region`, `toggle-case-region`, `auto-format-region`; operator wrappers | Mostly T-Lisp; gap-buffer region shift may need a TS primitive. |
| `src/editor/api/mode-ops.ts:72` | Add `'replace'` to `validModes` and to the `EditorMode` type in `src/core/types.ts` | TS primitive change — required because the mode union is a TS type. |
| `src/editor/handlers/replace-handler.ts` (new) | Routes keys to T-Lisp `vim-replace-*` functions; minimal (mirror `insert-handler.ts` shape) | Primitives-only rule — no decisions here. |
| `src/editor/api/text-objects.ts` | Add missing `changeAround*`, `deleteAround*` variants (only inner forms exist for `()`, `{}`, `[]`, `<>`, tags); add sentence/paragraph objects | Pure primitives — region computation only. |
| `src/editor/api/text-utils.ts` | Add `findWordBoundaryWORD` (whitespace-only) helper if T-Lisp can't compute it | Primitive only; no decisions. |
| `src/editor/api/register-ops.ts` (new) OR extend `evil-integration.ts` | OS clipboard bridge for `+`/`*` registers | Use `Bun.env` and a minimal child-process call. Primitives only — T-Lisp decides when to call it. |
| `src/tlisp/core/commands/search-ex.tlisp` OR extend `isearch.tlisp` | Bind `:nohl`, add `:noh` alias to Ex command table | Follow `commands/command-handler` Ex table pattern. |
| `src/editor/handlers/command-handler.ts` | Add `<Up>`/`<Down>` history navigation in command mode (Phase 6 prerequisite, but small) | Handler routes only — history ring owned by T-Lisp. |
| `src/tlisp/core/commands/command-history.tlisp` (new) | Per-mode history rings for `:` commands | Pure T-Lisp. |
| `test/unit/*.test.ts` | New tests per phase (see Testing Strategy) | Follow `rules/testing.md`. |
| `test/ui/tmax_harness/*.py` | New UI test scenarios for the wired features | Follow `rules/ui-testing.md` — must send real keys and inspect captured output. |

### New Files

| File | Purpose | Constraints |
|------|---------|-------------|
| `src/tlisp/core/commands/macros.tlisp` | Wires macro-recording API to `q`/`@`/`@@` keys | Library pattern (`provide`). |
| `src/tlisp/core/commands/repeat.tlisp` | `.` repeat-change recorder/replayer | Pure T-Lisp state. |
| `src/tlisp/core/commands/vim-replace.tlisp` (NOT `replace.tlisp` — name collision with Emacs query-replace) | Vim `r{char}`/`R` replace mode | Library pattern. |
| `src/tlisp/core/commands/marks.tlisp` | Mark store + bindings | Pure T-Lisp + position primitive. |
| `src/tlisp/core/commands/jumplist.tlisp` | `C-o`/`C-i` ring | Pure T-Lisp. |
| `src/tlisp/core/commands/indent-ops.tlisp` | Indent/case/format operators (extends existing `indent.tlisp`) | Mostly T-Lisp. |
| `src/tlisp/core/commands/command-history.tlisp` | `:` command history ring | Pure T-Lisp. |
| `src/editor/handlers/replace-handler.ts` | Replace-mode key dispatch (only under Strategy A) | Mirror `insert-handler.ts`; primitives only. |

## Implementation Phases

### Phase 1: Bindings-Only Wiring (Tier A — highest ROI)

**Constraint checkpoint:** Before starting Phase 1, verify:
- [ ] `src/editor/api/text-objects.ts` exports `deleteInnerWord`, `changeInnerSingleQuote`, `deleteInnerParen`, etc. (it does — read it before each step).
- [ ] `src/editor/api/search-ops.ts` exports `searchForward`, `searchNext`, etc. (it does).
- [ ] `src/editor/api/macro-recording.ts` exports `startRecording`, `stopRecording`, `executeMacro` (it does).
- [ ] All Phase 1 changes are T-Lisp only — no `.ts` edits, no daemon binary change for tests.

#### Step 1.1: Wire text objects into operators

**User story:** As a tmax user, I want `diw`/`daw`/`ci"`/`ca{`/`dat` to delete/change the right region, so that I can edit semantic units in 3 keystrokes.

**Description:** Two sub-steps.

**Step 1.1a — Add missing TS primitives (Tier-B text objects).** Only 13 text-object primitives are exposed at `src/editor/api/text-objects-ops.ts:46-280`. Before all operator+text-object combos work, add the ~11 missing ones by following the existing pattern (look at `delete-inner-word` / `delete-around-word` for the template): `change-inner-word`, `change-around-word`, `delete-around-paren`, `change-around-paren`, `delete-around-brace`, `change-around-brace`, `delete-around-bracket`, `change-around-bracket`, `delete-around-angle`, `change-around-angle`, `delete-around-tag`, `change-around-tag`, `delete-inner-single-quote`, `delete-around-single-quote`, `delete-inner-double-quote`, `delete-around-double-quote`. The corresponding region-computation helpers may already exist in `text-objects.ts` (706 lines) but are not yet exported to T-Lisp — grep before reimplementing.

**Step 1.1b — Wire text-object dispatch into `vim-dispatch-operator-key`.** The insertion point is BEFORE the final `(vim-operator-apply key)` fallthrough at `operators.tlisp:230`. The new branch must check `(or (string= key "i") (string= key "a"))` and, if true, stash the operator (mirror SPEC-041's `vim-operator-begin-find` at operators.tlisp:60-75) and enter a new transient state expecting a text-object key. Place this check alongside the existing `g`-pending (line 209) and `f`/`t`/`F`/`T` (line 228) branches — NOT inside `vim-operator-apply`. When the text-object key arrives, resolve to the matching primitive via `vim-operator-apply-text-object` (new function, mirroring `vim-operator-apply-find` shape).

**MUST:**
- Reuse the `vim-pending-operator-for-find` stash pattern from SPEC-041 (`operators.tlisp:60-75`) — do NOT add a parallel state machine.
- Wrap every mutation in `(undo-begin)` ... `(undo-commit combo)` — see `vim-operator-apply-find` lines 100 and 114 for the exact bookending. Skipping this breaks undo for text-object operations.
- Call `(set-register "\""` <deleted-or-yanked-text>) on completion — see `vim-operator-apply` lines 189-202 for the per-operator pattern. Yank-pop and the numbered delete registers (US-1.9.3) rely on this.
- Tier-A coverage (13 existing primitives): `diw daw ci" ca" ci' ca' di) ci) di} ci} di] di< diT` (where `diT` uses `delete-inner-tag`).
- Tier-B coverage (after Step 1.1a): `ciw caw da) ca) da} ca} da] ca] da< ca< dat cat di' da' di" da"`.
- Apply count: `d2iw` deletes two words (existing count multiplier pattern in operators.tlisp:117-119).
- Push the operation to the repeat-recording list once Phase 2.2 lands; for now leave a `;; TODO vim-record-change` hook in the same place as the existing operators.

**MUST NOT:**
- Insert the dispatch branch inside `vim-operator-apply` (line 179) — that function takes a resolved motion string; the `i`/`a` interception must happen one level up in `vim-dispatch-operator-key` before `(vim-operator-apply key)` is called at line 230.
- Reimplement region computation in T-Lisp — call the existing primitives, which already handle multibyte chars and edge cases (BUG-09 awareness).
- Modify `src/editor/handlers/*.ts` — this is T-Lisp dispatch (Step 1.1b) plus optional new TS primitives (Step 1.1a).
- Break the existing `g`-pending or `f`/`t`/`F`/`T` branches in `vim-dispatch-operator-key` — the new `i`/`a` check goes alongside them, not in front.

**Convention source:** SPEC-041 (operator state pattern), `src/tlisp/CLAUDE.md` (T-Lisp owns dispatch).

**Acceptance criteria:**
- [ ] `diw` deletes inside word; cursor at start of removed region; deleted text in `"` register and kill ring.
- [ ] `daw` deletes word plus trailing whitespace.
- [ ] `ci"` enters insert mode with quotes' contents deleted.
- [ ] `dat` deletes around tag (opening + closing) in an HTML/JSX buffer.
- [ ] `d2iw` deletes two words.
- [ ] `u` after `diw` restores the deleted text AND cursor position (undo bookend works).
- [ ] `M-y` after `dd` cycles through the numbered delete registers (register write works).
- [ ] `"ayiw` works after Phase 2.3 lands (register prefix).
- [ ] UI test `test/ui/tmax_harness` confirms `diw` deletes the expected region in a live session.
- [ ] `bun run typecheck:test` passes — T-Lisp changes can break test TS only if bindings change shape.

#### Step 1.2: Bind `/` `?` `n` `N` `:nohl`

**User story:** As a tmax user, I want to search forward and backward with `/`/`?`, jump between matches with `n`/`N`, and clear highlights with `:nohl`, so that I can navigate matches the same way I do in every other vim editor.

**Description:** In `commands/isearch.tlisp`, add `(key-bind "/" "(isearch-forward)" "normal")`, `(key-bind "?" "(isearch-backward)" "normal")`, `(key-bind "n" "(search-next)" "normal")`, `(key-bind "N" "(search-previous)" "normal")`. The four target functions are already T-Lisp-callable — `isearch-forward`/`isearch-backward` live in `commands/isearch.tlisp`, and `search-next`/`search-previous` are exposed from `src/editor/api/search-ops.ts:343` and `:376`. For `:nohl`, add a T-Lisp function `(defun nohl (search-clear))` in `commands/isearch.tlisp` and add a branch in `src/editor/api/bindings-ops.ts:64-122` (`editor-execute-command-line`) that handles `command === "nohl" || command === "noh"` by calling `(nohl)`. The existing fallthrough at `bindings-ops.ts:117-119` already evals unknown commands as T-Lisp — verify whether `:nohl` lands in that fallthrough (in which case only the `defun` is needed) or needs an explicit branch (in which case add one).

**MUST:**
- `/` and `?` must enter an incremental search minibuffer (the `search-incremental-*` primitives already implement this — bind to them, not to a new prompt).
- `n`/`N` must respect search direction (`?`-initiated search flips `n`).
- `:nohl` clears `search-set-highlight-ranges` output without clearing the pattern (so `n` still works).

**MUST NOT:**
- Re-implement search — primitives exist.
- Bind `/` in visual mode yet (Phase 1.5 visual-search deferred — visual mode ` Esc` is the escape valve).
- Touch `src/editor/api/search-ops.ts`.

**Convention source:** `src/tlisp/CLAUDE.md` (library pattern), SPEC-005 (search model).

**Acceptance criteria:**
- [ ] Typing `/foo<CR>` in a buffer with multiple `foo` matches moves cursor to next match and highlights all.
- [ ] `n` advances to the next match; `N` reverses.
- [ ] `?foo<CR>` searches backward; `n` goes backward.
- [ ] Wrap-around: after the last match, `n` lands on the first (and vice versa for `N`).
- [ ] No matches: status shows "Pattern not found", cursor unchanged.
- [ ] Regex: `/foo*<CR>` matches `fo`, `foo`, `fooo`, …
- [ ] `:nohl<CR>` clears highlights; pressing `n` after still works (pattern retained).
- [ ] UI test sends `/the<CR>n` and confirms cursor moved.

#### Step 1.3: Bind macros (`q`, `@`, `@@`)

**User story:** As a tmax user, I want to press `q` to start/stop recording a macro into a register, then `@<reg>` to play it, so that I can automate repetitive edits without learning T-Lisp.

**Description:** New `src/tlisp/core/commands/macros.tlisp`. The key challenge is that `q` and `@` are 2-key commands (operator-like): they read a follow-up register name. **Only one design is viable** (Option B in earlier drafts required a `(read-key)` primitive that does NOT exist per `grep -rn "read-key\|readKey" src/`):

**Option A — Transient pending state (the only real path):**
- Add `defvar vim-macro-record-pending` and `vim-macro-play-pending` flags.
- Bind `q` to a dispatcher: if `(macro-recording-p)`, call `(macro-stop-recording)`; else set `vim-macro-record-pending` true.
- The handler (`normal-handler.ts:124-136`) must check `vim-macro-record-pending` AFTER the keymap lookup but BEFORE the final "Unbound key" fallback. The simplest implementation: add a `(key-bind "<reg>" ...)` for each register letter `a-z`/`0-9` inside `commands/macros.tlisp` that calls `(macro-record-dispatch-register "<reg>")` when pending, OR add a check in the handler that re-routes the key if pending. Pick ONE — the keymap-flood approach scales poorly (36 bindings), prefer the handler-side pending check.
- Same shape for `@` (play) and `@@` (replay last).

**MUST:**
- `q<reg>` starts recording into `<reg>`; status line shows `recording @<reg>`.
- `q` while recording stops and saves.
- `@<reg>` plays; `@@` plays the last-played register.
- `editor-quit` (`q` followed by anything that's not a register letter, OR `q` at top-level when not recording and the dispatcher is cancelled via `Esc`) still works — the dispatcher must route register-non-letter to quit-or-cancel. Current binding is at `normal.tlisp:149` — `(key-bind "q" "(editor-quit)" "normal")`.
- Recording persists across daemon restarts via `saveMacrosToFile` (`api/macro-persistence.ts`).
- **CRITICAL — recording-capture hook.** The macro API is exposed via `editor.ts:1302-1347` (`macro-record-start`/`-stop`/`-key`/`macro-play`/`macro-play-last`), but `grep -rn "recordKey\|macro-record" src/editor/handlers/` returns ZERO matches — handlers do NOT call `macro-record-key` today, which means recording captures nothing. Fix this by adding a hook at `src/editor/handlers/normal-handler.ts:129` (BEFORE the existing `await executeCommand(editor, cmdRight.value)` call). When `(macro-recording-p)` is true, the handler must call `(macro-record-key "<key>")` BEFORE evaluating the bound command. This matches the existing handler-routing pattern: the handler already calls `(vim-dispatch-operator-key ...)` and `(vim-dispatch-find-target ...)` to route into T-Lisp; macro-record-key is the same shape. The "handler routes, T-Lisp decides" rule from `src/editor/CLAUDE.md` is preserved — the handler routes the key into the macro-record primitive, T-Lisp decides whether to store it.
- Add `(provide "macros")` to the new file AND add it to the load list wherever `windows.tlisp`/`tabs.tlisp` are required (find via `grep -rn "windows.tlisp\|tabs.tlisp" src/`).
- Lock down BEFORE implementation: does the recording hook skip the `q` key itself (vim does NOT record the stopping `q`)? Confirm with the existing `recordKey` semantics in `api/macro-recording.ts:96`.

**MUST NOT:**
- Touch `src/editor/api/macro-recording.ts` — the API is production-ready.
- Add a T-Lisp-side "unified dispatcher" function for macro recording — there is no such function. The unified dispatch IS the handler. (See v3 review note #19.)
- Bind `q` in insert mode (Phase 2 stretch — visual-mode `q` is unclaimed).
- Replace `editor-quit` for users who never record — the dispatcher must fall through to quit on cancel.

**Convention source:** `api/macro-recording.ts` (existing API), `api/macro-persistence.ts` (US-2.4.2 persistence), ADR-0038/0039.

**Acceptance criteria:**
- [ ] `qa<some-keys>q` records a macro into `a`.
- [ ] `@a` plays it.
- [ ] `@@` plays it again.
- [ ] Restarting the daemon and running `@a` still works (persistence).
- [ ] `q` at top-level with no follow-up register (or followed by `Esc`) still quits the editor.
- [ ] UI test records and plays a macro in a live session.

#### Step 1.4: Phase 1 verification gate

**Description:** Stop and verify Phase 1 end-to-end before Phase 2. Restart the daemon (per `feedback_daemon-restart-after-code-change.md` — though Phase 1 is pure T-Lisp, the daemon may cache T-Lisp files).

**Acceptance criteria:**
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:ui:renderer` passes.
- [ ] `bun run test:unit` passes.
- [ ] Manual smoke test in `bun run start`: try `diw`, `/foo<CR>n`, `qa<keys>q@a`, all working.

### Phase 2: Mode + Parser Extensions (Tier B)

**Constraint checkpoint:** Before starting Phase 2, verify:
- [ ] Phase 1 verification gate passed.
- [ ] `src/editor/api/mode-ops.ts:72` understood — adding `'replace'` requires updating the union type in `src/core/types.ts` as well.
- [ ] SPEC-041 stash pattern is the template for the register-prefix parser.

#### Step 2.1: Replace mode (`r{char}`, `R`)

**User story:** As a tmax user, I want to typo-fix one character with `r{char}` or overwrite a run with `R`, so that I don't have to enter insert mode for small corrections.

**Description:**

**Name-collision warning:** `src/tlisp/core/commands/replace.tlisp` already exists and implements Emacs-style `query-replace` (functions `query-replace`, `replace-yes/no/all/quit`). DO NOT extend that file. Vim replace logic goes in a NEW `src/tlisp/core/commands/vim-replace.tlisp` to keep the two features separable.

**Two viable implementation strategies — pick ONE in the Design Decisions section before coding:**

**Strategy A — Add `'replace'` to the TypeScript mode union (type-safe, more changes):**
- The `'replace'` value must be added to ALL FIVE sites that hardcode the mode union: (1) `EditorMode` in `src/core/types.ts`, (2) the `setMode` parameter type at `src/editor/api/mode-ops.ts:39`, (3) the `validModes` array at `src/editor/api/mode-ops.ts:72`, (4) `getMode`/`setMode` signatures in `src/editor/api/bindings-ops.ts:33-34`, (5) any other `setMode: (mode: ...)` signatures surfaced to T-Lisp (grep `setMode:` in `src/editor/`).
- Add `src/editor/handlers/replace-handler.ts` mirroring `insert-handler.ts` shape (routes only, no logic).
- In T-Lisp: `vim-replace-char` (the `r` two-key command — stash state via a new `vim-pending-replace-char` defvar, await next char, overwrite using existing buffer primitives), `vim-replace-mode-enter` (the `R` binding), `vim-replace-mode-insert` (overwrites instead of inserting while in replace mode).

**Strategy B — Use `'insert'` mode with a T-Lisp sub-state flag (no TS change, less discoverable):**
- Add `defvar vim-replace-mode-active` to `vim-replace.tlisp`.
- Bind `R` to `(progn (set! vim-replace-mode-active t) (editor-set-mode "insert"))`.
- Bind `r{char}` to a T-Lisp dispatcher that overwrites one char and returns.
- Hook the insert-mode character handling so that when `vim-replace-mode-active` is true, typed chars overwrite instead of insert.
- Escape clears the flag and returns to normal mode.

Trade-off: Strategy A requires ~5 TS changes but is type-safe and `editor-mode` returns `"replace"`. Strategy B is pure T-Lisp but `(eq (editor-mode) "insert")` is true during replace, breaking any code that distinguishes the two. Pick A unless the TS changes prove larger than expected.

**MUST:**
- `r{char}` replaces exactly one character under the cursor, then returns to normal mode.
- `R` enters replace mode: typed chars overwrite; `Backspace` restores the original char (vim semantics).
- `Escape` from replace mode returns to normal mode.
- Count: `3rx` replaces 3 chars with `x` (count multiplier).
- `<CR>` in replace mode splits the line (vim semantics — NOT an overwrite of newline).

**MUST NOT:**
- Implement `gR` (virtual replace) — defer.
- Add a separate visual-mode replace binding in Phase 2 — visual `r` moves to Phase 5 with the other visual-block ops.
- Add `'replace'` to ONLY one site — TypeScript will not catch the others at compile time if they use loose string types; runtime validation in `editor-set-mode` will reject the new mode.

**Convention source:** `src/editor/api/mode-ops.ts:72` (mode union), `src/editor/handlers/insert-handler.ts` (handler shape).

**Acceptance criteria:**
- [ ] `rx` overwrites the char under the cursor.
- [ ] `3rx` overwrites 3 chars with `x`.
- [ ] `R` enters replace mode; typed chars overwrite; `Backspace` restores.
- [ ] `Escape` returns to normal mode.
- [ ] UI test confirms replace semantics.

#### Step 2.2: `.` repeat last change

**User story:** As a tmax user, I want `.` to repeat my last change (e.g., `dw`, `dd`, `ciw`), so that I can apply the same edit at multiple cursor positions in 1 keystroke each.

**Description:** New `commands/repeat.tlisp`. Maintain a `vim-last-change` record: a list of (operator, motion-or-text-object, count, register) tuples plus any insert-mode text typed before returning to normal. The recording hook surface is broader than it looks — it spans every mutation entry point: `vim-operator-apply` (operators.tlisp:179), `vim-operator-apply-find` (operators.tlisp:77), every edit command in `commands/edit-commands.tlisp` (`x`, `D`, `C`, `J`, `p`, `P`), every Phase 1 text-object case, and insert-mode text capture on `<Esc>`. Each of those must call `(vim-record-change <descriptor>)`. `.` replays the last descriptor at the current cursor.

**MUST:**
- Re-record on every mutating command. Read-only commands (motions, search, `n`, `N`) do NOT replace the last change.
- `.` works in normal mode and after an operator+text-object.
- `.` after an insert-mode session replays the typed text AND the cursor position relative to entry (vim semantics: `i…<Esc>.` re-inserts at the new cursor).
- Count override: `5.` repeats with count 5 (vim semantics).
- The recording hook does NOT interfere with the existing `(undo-begin)`/`(undo-commit)` bookending — record BEFORE `undo-begin`, replay through the same operator pathway.

**MUST NOT:**
- Record non-mutating commands (this is the most common `.` bug).
- Persist last-change across daemon restarts (per-session is sufficient for v1).

**Convention source:** Vim reference, `commands/operators.tlisp` (operator-completion hooks).

**Acceptance criteria:**
- [ ] `dw.` deletes the next word.
- [ ] `dd.` deletes the line under the new cursor.
- [ ] `ihi<Esc>.` inserts `hi` again at the new cursor.
- [ ] `5.` repeats with explicit count.
- [ ] Cursor movement alone doesn't change the dot-repeat target.

#### Step 2.3: `"`-prefix register syntax

**User story:** As a tmax user, I want `"ayy` to yank into register `a` and `"ap` to paste from `a`, so that I can keep multiple clipboard slots.

**Description:** Extend `vim-dispatch-operator-key` to detect a leading `"x` prefix where `x` is a register name (`a-zA-Z0-9*+`). Stash the register, then continue reading the operator. When the operator completes, call the existing register API with the stashed register instead of the default `"`.

**MUST:**
- `"ayy` yanks line into register `a`.
- `"ap` pastes from register `a`.
- `"A` appends to register `a`.
- `"+yy` / `"+p` work once Phase 2.4 (clipboard) lands; until then `+` is in-memory only.
- Count and register compose: `3"ayw` yanks 3 words into `a`.

**MUST NOT:**
- Break the existing default-register flow — no prefix means register `"`.

**Convention source:** SPEC-041 stash pattern, `api/evil-integration.ts` (register API).

**Acceptance criteria:**
- [ ] `"ayy` yanks line into `a`; `:registers` (after Phase 6) lists `a`.
- [ ] `"ap` pastes from `a`.
- [ ] `"Ayy` appends.
- [ ] `"+p` works (in-memory only until 2.4).

#### Step 2.4: OS clipboard bridge for `+` and `*`

**User story:** As a tmax user, I want `"+y` and `"+p` to share text with the system clipboard, so that I can copy from tmax and paste into a browser.

**Description:** In `src/editor/api/register-ops.ts` (new) or by extending `evil-integration.ts`, add `clipboardGet()` and `clipboardSet(text)` primitives using a minimal platform-specific shim:
- macOS: `pbcopy`/`pbpaste`.
- Linux: `xclip -selection clipboard`/`xsel --clipboard` (fallback).
- Windows: `clip`/`Get-Clipboard`.

Wire into the existing `+` and `*` register get/set paths.

**MUST:**
- `"+y<motion>` writes to OS clipboard.
- `"+p` reads from OS clipboard.
- Graceful no-op if no clipboard tool is available (warn via `*Messages*`).
- Primitives only — T-Lisp decides when to call them.

**MUST NOT:**
- Block the editor on clipboard I/O — make it synchronous but fast; document the tradeoff.

**Convention source:** `src/editor/CLAUDE.md` (primitives only), Vim reference (`+`/`*` register semantics).

**Acceptance criteria:**
- [ ] On macOS, `"+yy` then `pbpaste` in another shell shows the yanked line.
- [ ] `pbcopy "hello"` in another shell, then `"+p` in tmax, inserts `hello`.
- [ ] No regression when clipboard tool is absent.

#### Step 2.5: Phase 2 verification gate

(Same shape as 1.4 — restart daemon, run all test suites, manual smoke.)

### Phase 3: Missing Motions (WORD / Sentence / Section / Window-Relative)

**Constraint checkpoint:** Before starting Phase 3, verify:
- [ ] `src/editor/api/text-utils.ts` has `findWordStart`/`findWordEndOnLine` but no WORD (whitespace-only) variants.
- [ ] Decide: add a TS primitive for WORD boundary, or compute in T-Lisp from `buffer-line-text`. Prefer T-Lisp unless performance demands TS.

#### Step 3.1: WORD and sentence motions

**Description:** Add `W B E ge gE ( ) [[ ]] [ ]` motions. WORD uses whitespace-only boundaries (no punctuation split). Sentence splits on `. ! ?` followed by whitespace. Section splits on `{` at column 0 (C-style) or form-feed.

**MUST:**
- All motions work with count and as operator motions (`dW`, `c)`, `y[[`).
- `ge` lands on the LAST char of the previous word end (vim quirk).

**MUST NOT:**
- Add a new state machine — motions are pure functions.

**Acceptance criteria:**
- [ ] `W` jumps over punctuation clusters as one WORD.
- [ ] `(` `)` move by sentence.
- [ ] `[[` `]]` move by section.

#### Step 3.2: Window-relative and single-line scrolls

**Description:** Add `H M L` (top/middle/bottom of viewport), `C-e C-y` (single-line scroll), `gj gk` (screen-line moves on wrapped lines), `g_` (last non-blank).

**Acceptance criteria:**
- [ ] `H`/`M`/`L` move to top/middle/bottom visible line.
- [ ] `C-e`/`C-y` scroll one line.
- [ ] `gj`/`gk` move by screen row when line wrapping is on.

### Phase 4: Marks + Jumplist

**Constraint checkpoint:** Before starting Phase 4, verify:
- [ ] T-Lisp has no existing marks store.
- [ ] `src/editor/api/jump-ops.ts` exists but only handles line jumps — NOT a jumplist. Decide whether to extend it or build a T-Lisp ring.

#### Step 4.1: Marks

**Description:** New `commands/marks.tlisp` with a `defvar` alist mapping `(mark-name . (buffer-id line col))`. `m<name>` sets; `'<name>` jumps to line; `` `<name> `` jumps to exact col. Add `:marks` listing.

**MUST:**
- Lowercase marks are buffer-local; uppercase are global (cross-buffer).
- Special marks: `'<` `'>` (visual selection), `'[` `']` (last change), `'^` (last insert), `'.` (last change position).

**Acceptance criteria:**
- [ ] `ma` sets mark `a` in current buffer; `'a` jumps to its line.
- [ ] `mA` sets global mark `A` that survives a buffer switch.
- [ ] `:marks` lists all set marks.

#### Step 4.2: Jumplist (`C-o`/`C-i`)

**Description:** T-Lisp ring buffer of cursor positions. Motions and operators that move >1 line push to it. `C-o`/`C-i` traverse.

**MUST:**
- `gg`, `G`, `Nn`, `n`, `*`, `#`, `%`, `'mark`, mark jumps push.
- Single-char motions (`h j k l w b e`) do NOT push (vim semantics).
- List is per-window.

**Acceptance criteria:**
- [ ] `G C-o` returns to the prior position.
- [ ] `C-i` after `C-o` redoes.

### Phase 5: Indent / Case / Format Operators

**Constraint checkpoint:** Before starting Phase 5, verify:
- [ ] tmax has indentation logic somewhere — find it (`grep -r "indent"` in `src/`) before designing `=`.
- [ ] If `=` requires language awareness, scope Phase 5 to `>` `<` `~ gu gU g~` only and defer `=` to a follow-up.

#### Step 5.1: Indent and case operators

**Description:** New `commands/indent-ops.tlisp`. Operators `> < gu gU g~` for shift-right / shift-left / lowercase / uppercase / toggle-case. The `=` (reindent) operator can lean on the EXISTING `src/tlisp/core/commands/indent.tlisp` module which already exports `indent-current-line` and `indent-region` — wrap `indent-region` as the `=` operator. For `>`/`<`, add T-Lisp wrappers that compose the existing indent primitive with a `tab-width`/`indent-offset` lookup against the active major mode. Case operators are pure T-Lisp using `buffer-line-text` + `buffer-replace-line` (or equivalent TS primitives).

**MUST:**
- All operators work with motions, text objects, visual mode, and lines (`>> guu gUU`).
- Indent width respects the major mode's `tab-width` / `indent-offset` (read from the mode-local variables established in `modes/*.tlisp`).
- Visual mode: `>` `<` `~` on selection (note: visual `r` from Phase 2.1 also lands here as a visual-block replace).
- New indent cases follow the SPEC-041 stash pattern + undo bookend + `set-register` write just like Phase 1 text objects.

**Acceptance criteria:**
- [ ] `>>` indents the current line by one shiftwidth.
- [ ] `>` in visual indents the selection.
- [ ] `guu` lowercases the current line; `gUU` uppercases.
- [ ] `~` toggles case of char under cursor.
- [ ] `=ap` reindents the current paragraph using `indent-region` from the existing `indent.tlisp`.
- [ ] Visual-mode `r{x}` (deferred from Phase 2.1) replaces every char in the selection with `x`.

### Phase 6: Ex Ranges and `:g` / `:v` / `:sort` / `:!` — DEFERRED

Out of scope for SPEC-044. Tracked here for visibility. Implementing Ex ranges properly requires:
- A range parser in `commands/command-handler.ts` (handles `:%`, `:1,5`, `:.,$`, `:'<,'>`, `:+N`, `:-N`).
- `:g`/`:v`/`:global!` over every line in range, applying an Ex command per match.
- `:sort` with flags (`u`, `!`, `n`, `r`, `i`).
- `:!cmd` shell-out via `Bun.spawn` (primitives-only in TS).

Open a dedicated SPEC-045 once Phase 1-5 land.

### Phase 7: Surround Emulation — DEFERRED

Out of scope for SPEC-044. Implementing vim-surround (`ds`/`cs`/`ys`/`S`) is best built on top of the operator+text-object dispatch from Phase 1.1. Open a dedicated SPEC-046 once Phase 5 lands.

## Acceptance Criteria

1. **Phase 1 (Tier A):** `diw`, `daw`, `ci"`, `ca{`, `dat`, `/foo<CR>n`, `N`, `:nohl`, `qa<keys>q`, `@a`, `@@` all work end-to-end in a live daemon session.
2. **Phase 2 (Tier B):** `rx`, `R<text><Esc>`, `.`, `"ayy`, `"ap`, `"Ayy`, `"+yy` / `"+p` (real OS clipboard) all work end-to-end.
3. **Phase 3 (Tier C-motions):** `W B E ge gE ( ) [[ ]] [ ] H M L C-e C-y gj gk g_` all work and compose with operators (`dW`, `c)`, `y[[`).
4. **Phase 4 (Tier C-marks):** `ma`/`'a`/`` `a ``, `mA` (global), `'<` `'>` `'[` `']` `'^` `'.`, `:marks`, `C-o`/`C-i` jumplist all work.
5. **Phase 5 (Tier C-operators):** `> < gu gU g~` work as operators, line-operators, and visual-mode bindings. `=` deferred if it needs language awareness.
6. **No regressions:** every existing UI test (`test/ui/tmax_harness`) still passes; every existing unit test still passes; `bun run typecheck` is green.
7. **No TS violations:** `src/editor/handlers/*.ts` and `src/editor/api/*.ts` files contain no new editor decisions (per `src/editor/CLAUDE.md`).
8. **Memory compliance:** daemon restarted before every UI verification step (per `feedback_daemon-restart-after-code-change.md`); visual fixes verified in the live system, not unit-only (per `feedback_verify-end-to-end-not-unit-only.md`).

## Validation Commands

Execute every command at the end of each phase (not just at the end of the spec). Every command must exit 0.

- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:src` — TypeScript source typechecks.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:test` — Test files typecheck.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck` — Full typecheck (src + test).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:unit` — Unit tests pass (extends `text-objects.test.ts`, `operator-find-char.test.ts`, `macro-recording.test.ts`, `incremental-search.test.ts`, `vim-dispatch.test.ts`, etc.).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:ui:renderer` — UI renderer tests pass via `cd test/ui && uv run python run_python_suite.py daemon-tmux` (sends real keys, inspects captured output).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:daemon` — Daemon behavior tests pass via `cd test/ui && uv run python run_python_suite.py daemon`.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run build` — Bun build succeeds (`build:tmax` + `build:tlisp`).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run start` — Manual smoke (note: `start` invokes `node --import tsx src/main.tsx`, not `bun` directly). Exercise every Phase N acceptance criterion in a live session.
- After any `.ts` change: `bin/tmax --stop` (or `bun run daemon` + Ctrl-C) then restart before any UI test (per memory `feedback_daemon-restart-after-code-change.md`).
- For new UI test scenarios: extend `test/ui/tests/*.py` — invoke via `cd test/ui && uv run python run_python_suite.py daemon-tmux` (NOT a non-existent `runner.py`).

## Design Decisions

| Decision | Rationale | Alternative rejected |
|----------|-----------|---------------------|
| Phase 1 is bindings-only (no TS changes) | The primitives exist — TS changes would be churn. Lowest-risk, highest-impact first. | Rewriting `text-objects.ts` — rejected; the API is fine, only dispatch is missing. |
| Reuse SPEC-041 stash pattern for operator+text-object and `"x` register prefix | Proven pattern, single source of truth for pending-operator state. | New state machine per feature — rejected; multiplies bug surface. |
| Marks and jumplist owned by T-Lisp, not TS | They're stateful decisions (which positions to remember, when to push) — that's logic per `src/editor/CLAUDE.md`. TS only adds a position get/set primitive if needed. | Storing marks in `editor.ts` state — rejected; violates primitives-only rule. |
| Replace mode requires a TS change (`mode-ops.ts:72`) — Strategy A | The mode union is a TS type — T-Lisp can't extend it cleanly. 5-site change, minimal blast radius. | Encoding replace as an insert-mode flag (Strategy B) — rejected for v1; lower discoverability and any code that branches on `editor-mode` would misbehave. Revisit if TS churn proves larger than expected. |
| Vim-replace logic goes in NEW `commands/vim-replace.tlisp`, NOT `commands/replace.tlisp` | The existing `replace.tlisp` implements Emacs `query-replace`; conflating would break the separation of vim/Emacs feature sets. | Extending `replace.tlisp` — rejected; name collision. |
| Macro recording hook goes in `normal-handler.ts:129`, not T-Lisp | The "unified dispatcher" IS the handler — there is no single T-Lisp `vim-dispatch-normal-key` function (per `vim-dispatch.tlisp:5-9` comment). Handler-side hook matches the existing pattern of routing keys into T-Lisp. | T-Lisp-side wrapping of every binding expression — rejected; too invasive. |
| `.` records changes only, not motions | Vim semantics; recording motions would replay navigation, surprising users. | Recording everything — rejected; doesn't match Vim. |
| `=` operator possibly deferred to Phase 5.5 | Reindent may need language awareness; markdown/lisp have it, TS/JS do not. | Shipping a half-correct `=` — rejected; worse than not shipping. |
| Phase 6 (Ex ranges) and Phase 7 (Surround) deferred to follow-up SPECs | Each is multi-week and deserves dedicated design; bundling would inflate this spec and delay Tier A. | One mega-spec — rejected; review and validation cost too high. |

**Deferred to follow-up:**
- **SPEC-045** — Ex ranges (`:1,5d`, `:.,$`, `:'<,'>`) and `:g`/`:v`/`:sort`/`:!`/`:r!`/`:normal`.
- **SPEC-046** — Surround emulation (`ds`/`cs`/`ys`/`S`).
- **SPEC-047** — Visual-block operations (`I`/`A`/`c`/`r`/`>` columnar; multi-cursor from block).
- **SPEC-048** — Insert-mode niceties (`C-w`/`C-u`/`C-r`/`C-o`/auto-pairs/abbreviations).
- **SPEC-049** — Ex `:set` / options system (decide whether to add or keep T-Lisp-vars model).
- **SPEC-050** — Sneak / EasyMotion / CamelCaseMotion style jump plugins.
- **SPEC-051** — Tags / tagstack / `:tag` / `C-]` / `C-t`.
- **SPEC-052** — `gd`/`gf` (requires LSP or ctags integration).
- **SPEC-053** — Ex `:map`/`:noremap`/`:registers`/`:marks`/`:ls`/`:buffers` introspection commands.

## Open Questions

Unresolved items that need human input before or during implementation. Each blocks at least one phase.

1. **Parity target — VS Code Vim or Neovim?** (Blocks Phase 6/7 scoping.) If Neovim, Surround and Ex ranges become must-have, not deferred.
2. **Daemon T-Lisp hot-reload?** (Blocks Phase 1 start.) Resolved by the Pre-Phase-1 smoke. If yes, relax restart rule for T-Lisp-only changes.
3. **Replace mode — Strategy A or B?** (Blocks Phase 2.1.) Type-safe TS change vs. pure-T-Lisp sub-state. Design Decisions recommends A; confirm before coding.
4. **Macro-record-key timing — before or after bound command?** (Blocks Phase 1.3.) Vim records literal keys (before); tmax's playback model may differ. Lock down in Step 1.3 design.
5. **Linux clipboard availability — startup probe or per-call?** (Blocks Phase 2.4.) Startup probe is faster but stale if `xclip` is installed mid-session.
6. **Count × text-object multiplication — does `d2iw` follow `vim-operator-total-count`?** (Blocks Phase 1.1b.) Assumed yes (Assumption #5); verify before relying on it.
7. **Are any of the 11 priority recommendations already shipped?** (Blocks spec rescope.) The June 2026 gap analysis may be stale. Re-run the inventory before Phase 1.
8. **Should Phase 5 `=` operator be deferred to a follow-up?** (Blocks Phase 5 scoping.) Reindent may need language awareness; markdown/lisp have it, TS/JS do not.
9. **What's the cap on jumplist entries?** (Blocks Phase 4.2.) Vim default is 100; confirm tmax's ring buffer size.
10. **Visual-block `I`/`A`/`r`/`>` — Phase 5 or SPEC-047?** (Blocks Phase 5 acceptance.) Currently scoped to SPEC-047; confirm before Phase 5 starts.

→ Answer these in the PR that implements each phase. Update this section when resolved.

## Spec-Driven Development Compliance Checklist

Per the spec-driven-development skill's verification gate:

- [x] **Objective covered** — Feature Description + User Story + Problem Statement + Solution Statement.
- [x] **Tech Stack covered** — Tech Stack section above.
- [x] **Commands covered** — Commands section + Validation Commands at end.
- [x] **Project Structure covered** — Project Structure section with file tree.
- [x] **Code Style covered** — Code Style section with real snippet from `operators.tlisp`.
- [x] **Testing Strategy covered** — Testing Strategy section (framework, locations, coverage, file policy).
- [x] **TDD Discipline covered** — TDD Discipline section with RED/GREEN/REFACTOR mapped to each phase, real-codebase template, Prove-It Pattern, anti-patterns.
- [x] **Incremental Implementation covered** — Incremental Implementation Discipline section with per-phase slicing plans (9+8+7+6+6 = 36 slices total), simplicity gate, rollback rules.
- [x] **Boundaries covered** — Always / Ask first / Never sections above.
- [x] **Success Criteria covered** — Acceptance Criteria section (specific, testable, per-phase).
- [x] **Open Questions covered** — Open Questions section above.
- [x] **Assumptions surfaced** — Assumptions block near top.
- [ ] **Human has reviewed and approved** — pending.
- [ ] **Spec saved to file in repository** — done (`docs/specs/SPEC-044-vim-parity-priority-recommendations.md`).

The spec covers the skill's Specify phase. The Implementation Phases section covers the Plan phase. The Step-by-Step Tasks (within each phase) cover the Tasks phase. Phase 4 (Implement) is executed by future PRs following `incremental-implementation` and `test-driven-development` skills.

## TDD Verification Gate (per `test-driven-development` skill)

Every PR implementing a phase MUST be rejected by reviewer unless ALL of these are true:

- [ ] Every new behavior in the phase has a corresponding test.
- [ ] All tests pass: `bun run test:unit` AND `bun run test:ui:renderer`.
- [ ] RED test was committed before the implementation (visible in PR history or commit message).
- [ ] Test names describe behavior, not implementation (`"diw deletes word under cursor"`, not `"test dispatch works"`).
- [ ] No tests were skipped, disabled, or marked `.todo` to manufacture green.
- [ ] No mocks of in-process APIs (registers, undo, search, macro recording) — real implementations only.
- [ ] Visual/rendering changes include at least one UI test that sends real keys and inspects captured output (per memory `feedback_verify-end-to-end-not-unit-only.md`).
- [ ] Any bug found during implementation has a reproduction test that failed before the fix (Prove-It Pattern).
- [ ] Tests run ONCE per code change — no `bun test` reruns on unchanged code (per skill: adds no confidence).

## Incremental Implementation Verification Gate (per `incremental-implementation` skill)

Every PR implementing a slice MUST be rejected by reviewer unless ALL of these are true:

- [ ] The PR is a single slice from the slicing plan (Phase 1.A, 2.D, etc.) — not bundled.
- [ ] Each commit in the PR does one thing (RED test, GREEN code, REFACTOR are separate commits where possible).
- [ ] The slice touches ≤5 files (per `spec-driven-development` Phase 3 task rule).
- [ ] No slice writes >100 lines without an intervening test+commit cycle.
- [ ] `bun run typecheck` green after every commit (per skill Rule 2: keep it compilable).
- [ ] `bun run test:unit` green after every commit.
- [ ] Daemon was restarted if the slice touched any `.ts` file (per memory).
- [ ] The change is rollback-friendly — `git revert <sha>` restores the pre-slice state without side effects.
- [ ] No out-of-scope cleanup snuck in (per Rule 0.5 — adjacent dead code, unrelated refactors, etc.).
- [ ] Commit message format: `feat(vim-parity): phase <N>.<letter> <one-line description>` (or `fix(vim-parity):` for bug slices).
- [ ] No slice ships a feature flag for incomplete work unless the spec explicitly calls for it (none do).
- [ ] Verification commands run ONCE per code change — no reassurance reruns on unchanged code (per skill: adds no information).
- [ ] If the slice was riskier than expected, the spec was updated BEFORE continuing (per "When to stop and reassess").

## Edge Cases

- **Empty buffer:** `diw`, `cw`, `>>` on an empty buffer should no-op (not crash). Verify with a fresh `bun run start /dev/null`.
- **Single-line buffer:** motions `[[`/`]]`/`(`/`)` should no-op gracefully at boundaries.
- **Wrapped lines:** `gj`/`gk` must move by screen row; `j`/`k` by logical line. Confirm with a 200-col line in an 80-col terminal.
- **Multibyte / emoji:** `r<char>` and `~` must treat emoji as one cell (existing BUG-09 work). Verify with a `🦀`-containing buffer.
- **Zero-count operator:** `0d` should be the `0` motion (to column 0), not a 0-count operator. The existing count parser already handles this; regression-test it.
- **Mark in deleted region:** `ma` then `dd` on the mark's line — `'a` should land on the next existing line at or below (vim semantics).
- **Jumplist overflow:** cap at 100 entries (vim default); oldest drops.
- **Replace mode over EOL:** `R` at end of line should extend the line (insert semantics past EOL).
- **`@` on empty register:** `@z` where `z` is unrecorded should warn via `*Messages*` and not crash.
- **`/` with no matches:** should clear the minibuffer, show "Pattern not found", and not move the cursor.
- **Daemon restart between phases:** after every `.ts` change, restart the daemon before any UI test (per memory). T-Lisp-only changes also benefit from a restart since the daemon caches T-Lisp files.
- **Register `"` collision:** `"y` is both "yank into `"` (the unnamed register, no explicit register) and "yank into register `y`". Disambiguate: a single `"` immediately followed by a register letter is the prefix; a lone `"` falls through to operator dispatch.
- **`.` after yank:** `.` should NOT replay yanks (yank isn't a change). Verify `yy.` doesn't double-yank.
- **Unnamed register rule:** yank (`y`) writes `"` AND register `0`. Delete (`d`/`c`/`x`) writes `"` AND rotates numbered registers `1-9`. Text-object dispatch and indent/case operators MUST preserve this distinction — verify with `yiw` then `dd` then `:registers` (after Phase 6) shows the yanked word in `0` and the deleted line in `1`.
- **Visual-mode text objects are a different code path:** `viw` expands the existing visual selection to word boundaries — it does NOT go through operator-pending. Phase 1.1's operator+text-object dispatch is normal-mode only. Visual text objects are a separate Step 5.x (visual-mode bindings) concern.
- **`@` replay while recording:** Pressing `@a` during a recording should append the macro's keys to the current recording (vim quirk). Phase 1.3 must decide: do this fully, or no-op with a warning.
