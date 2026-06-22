# Feature: Vim Parity — Priority Recommendations Roadmap

**Depends on:** SPEC-005 (vim editing model), SPEC-038 (unified keymap dispatch), SPEC-041 (operator+find-char), the Vim-vs-VSCode-Vim gap analysis (this conversation), `src/editor/Claude.md` (primitives-only rule), `src/tlisp/Claude.md` (T-Lisp owns editor logic).

### Prerequisites (must pass before implementation)

1. **[SPEC-005](./SPEC-005-vim-editing-motions.md)** — current vim editing model (operators, motions, counts). Items 1-9 extend this model without breaking it.
2. **[SPEC-038](./SPEC-038-unified-keymap-which-key.md)** — unified keymap dispatch routes every normal/visual/insert key through T-Lisp. Phase 1-2 bindings land in this dispatch path.
3. **[SPEC-041](./SPEC-041-operator-find-char.md)** — established the pattern for stashing pending-operator state and resuming after a sub-state (`df<char>` etc.). Phase 1 item 1 (text objects + operators) reuses this exact pattern.
4. **[src/editor/Claude.md](../../src/editor/Claude.md)** — TypeScript in `src/editor/api/` provides primitives only; decisions live in T-Lisp. Every step below that touches `.ts` must justify why T-Lisp can't compute it.

### Assumptions (correct these before implementation starts)

Per the spec-driven-development skill, surface assumptions before any spec content. Each of these is a guess — flag the wrong ones now.

1. **VS Code Vim is the right parity target.** Assumed because it's the most-installed vim emulator and the gap analysis used its feature surface. Alternative: target Neovim parity (more modern, more features). → If Neovim is the target, Phase 7 (Surround) and parts of Phase 6 (Ex ranges) move from "deferred" to "must-have."
2. **Phase 1 is not purely bindings-only.** Verified by source: `operators.tlisp` already has text-object pending state and `vim-operator-apply-text-object`; `test/unit/operator-text-object.test.ts` already covers SPEC-044 Phase 1.A; `search-next`/`search-previous` are exposed; macro API is wired. Remaining Phase 1 work may still touch `.ts`: narrower text-object primitive gaps in `text-objects-ops.ts`, the explicit `:nohl` branch in `bindings-ops.ts`, and the macro-record-key hook in `normal-handler.ts`.
3. **The daemon caches T-Lisp files at startup.** Based on memory `feedback_daemon-restart-after-code-change.md`. The Pre-Phase-1 smoke (below) verifies this — if false, the daemon-restart rule can be relaxed for T-Lisp-only changes.
4. **Replace mode uses Strategy A: add a new TypeScript mode union value.** Picked for type safety and explicit `(editor-mode)` semantics. Strategy B remains documented only as the rejected alternative.
5. **Count × operator × text-object multiplication follows the existing `vim-operator-total-count` formula** at operators.tlisp:117-119. Unverified for text objects — confirm `d2iw` actually deletes 2 words before assuming.
6. **No existing tests assume `q` quits globally.** Phase 1.3 rebinds `q`; if a UI test asserts `q`-quit behavior at top-level, it will break. (Audit: `grep -rn 'send_keys.*"q"' test/ui/`.)
7. **Macro-record-key is captured BEFORE the bound command executes** (vim records literal keys, not effects), except for the stopping `q`, which must stop recording without being recorded.
8. **The 11 priority recommendations are roadmap candidates, not a frozen implementation batch.** Based on the June 2026 gap analysis. Re-run the inventory before each phase and re-scope shipped items out before implementation. Do not implement all Phases 1-5 as one work order; split them into approved phase-specific specs or PRs before coding.

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
| 10 | Visual-mode text objects (`iw`, `i"` in visual) described as "visual bindings only" | Visual text objects are NOT operator-pending — they expand the current selection. Different code path from normal-mode `diw`. | Step 1.1 visual section split out; visual-block `I`/`A`/`r` is deferred to SPEC-047 |
| 11 (v2, refreshed) | "Cover ALL existing primitives in `text-objects.ts`" — v1 listed 24+ variants | `text-objects-ops.ts` now exposes 21 T-Lisp primitives, including `change-inner-word`, `change-around-word`, quote deletes, and around paren. Remaining missing exposed variants are narrower: around brace/bracket/angle/tag delete/change, plus inner bracket/angle/tag change if supported by `text-objects.ts`. | Step 1.1 scope updated: Phase 1.A dispatch/tests already exist; Phase 1.B should verify current gaps and add only missing primitives, not rebuild text-object dispatch from scratch |
| 12 (v2) | Text-object dispatch insertion point: "after the line-operator cases but before the 'Unsupported operator' fallthrough at operators.tlisp:203" | **Wrong location.** Line 203 is in `vim-operator-apply`. The key-dispatch entry is `vim-dispatch-operator-key` at line 207; its final fallthrough at line 230 `(vim-operator-apply key)` sends `i`/`a` straight to operator-apply. The text-object branch must intercept BEFORE line 230, alongside the existing `g`-pending (lines 209-218) and `f`/`t`/`F`/`T` (lines 228-229) checks. | Step 1.1 insertion-point MUST updated |
| 13 (v2) | Step 1.3 macros: "Do not touch handlers — MUST NOT modify `src/editor/handlers/*.ts`" | **Partially incorrect.** The macro API is exposed via `editor.ts` as `macro-record-start`, `macro-record-stop`, `macro-record-key`, `macro-record-active`, `macro-record-register`, `macro-execute`, and `macro-execute-last`. But `grep -rn "recordKey\|macro-record" src/editor/handlers/` returns ZERO matches — no handler calls `macro-record-key`. **Recording captures nothing today.** | Step 1.3 MUST list updated: macro recording requires a normal-handler hook, not just `q` binding |
| 14 (v2) | Validation command `python3 test/ui/tmax_harness/runner.py` | **`runner.py` does NOT exist.** `test/ui/tmax_harness/` contains library modules (`harness.py`, `client.py`, etc.) but no runner. The actual UI runner is `test/ui/run_python_suite.py` (invoked via `bun run test:ui` or `bun run test:ui:renderer`). | Validation Commands section fixed |
| 15 (v2) | Validation command `tmax --stop` | Assumes `tmax` is on PATH. The local binary is `bin/tmax` (also `bin/tmaxclient`). For development verification use `bin/tmax --stop` or `bun run daemon` + Ctrl-C. | Validation Commands section updated |
| 16 (v2, refreshed) | New tests "see Testing Strategy" | Existing test files relevant to each phase include `test/unit/operator-text-object.test.ts`, `test/unit/operator-find-char.test.ts`, `test/unit/macro-recording.test.ts`, `test/unit/macro-persistence.test.ts`, `test/unit/macros.test.ts`, `test/unit/incremental-search.test.ts`, `test/unit/search-navigation.test.ts`, `test/unit/vim-dispatch.test.ts`, `test/unit/yank-operator.test.ts`, `test/unit/change-operator.test.ts`, and `test/unit/delete-operator.test.ts`. Each phase's tests should EXTEND the matching existing file rather than create new ones; only genuinely new features warrant new files (`repeat-change.test.ts`, `marks.test.ts`, `jumplist.test.ts`, `indent-ops.test.ts`, `replace-mode.test.ts`). | Step-by-step acceptance criteria now name specific test files |
| 17 (v2) | "`q` is bound to `editor-quit`" | Confirmed at `src/tlisp/core/bindings/normal.tlisp:149`: `(key-bind "q" "(editor-quit)" "normal")`. The rebind is a single line change, but the dispatcher must preserve top-level quit semantics (covered in Step 1.3 design). | Step 1.3 confirmed |
| 18 (v2) | Runtime is "Bun" | Mixed: `start` is `node --import tsx` (per `package.json:7`), but `daemon`, `tui`, `tlisp`, and `test` are `bun`. Daemon-restart memory applies to `bun src/server/server.ts` invocations. | Validation Commands clarified |
| 19 (v3, refreshed) | "the recording hook belongs in T-Lisp unified dispatch (per `src/tlisp/Claude.md`), not in handler files" | **Wrong.** There is NO single T-Lisp function `vim-dispatch-normal-key`. The "unified keymap" is the `normal-handler.ts` flow itself: it routes pending-states → digits → prefix → keymap-ref lookup → `executeCommand(editor, cmdRight.value)`. In current source, line 129 is a prefix return; the keymap `executeCommand` call is around line 149. **The handler IS the chokepoint.** Recording must hook before keymap command execution, calling `(macro-record-key <key>)` when `(macro-record-active)` is true. | Step 1.3 MUST list corrected: hook is near the keymap execution block around `normal-handler.ts:144-150`, not line 129 |
| 20 (v3) | Phase 2.1: extend existing `commands/replace.tlisp` with vim replace | **Name collision.** `src/tlisp/core/commands/replace.tlisp` already exists and implements Emacs-style `query-replace` (functions `query-replace`, `replace-yes`, `replace-no`, `replace-all`, `replace-quit`). Extending it with vim `r{char}`/`R` would conflate two unrelated features. | Step 2.1: vim replace logic goes in a NEW `commands/vim-replace.tlisp` file, NOT `replace.tlisp` |
| 21 (v3) | Step 1.3 Option B (`(read-key)` primitive) viable | **Not viable.** `grep -rn "read-key\|readKey" src/` returns ZERO matches — no such primitive exists. Building one would require a non-trivial async-read TS primitive. | Step 1.3 simplified: only Option A (transient pending state) is real; Option B struck |
| 22 (v3) | Phase 2.1 mode change requires touching 5 sites | **Alternative undersold.** Vim replace can be implemented as a sub-state flag on `'insert'` mode (analogous to how operator-pending is a T-Lisp global inside `'normal'` mode), avoiding ALL TypeScript changes. Trade-off: less type-safe, breaks mode-predicates like `(eq (editor-mode) "replace")`. | Step 2.1 Design Decisions: weigh "add new mode union value" (type-safe, 5 TS sites) vs "insert sub-state flag" (no TS change, less discoverable). Pick one explicitly |
| 23 (v3) | `set-register` for `"A` append: would need new code | **Already supported.** `set-register` at `evil-integration.ts:259` auto-detects uppercase for append (line 295: "Check if uppercase (append mode)"). `"Ayy` works through existing infrastructure with no new code. | Step 2.3 acceptance criterion `"Ayy appends` confirmed — no new work needed beyond parsing the `"x` prefix |

**Out of scope for this review pass** (still open): whether the daemon hot-reloads T-Lisp files or requires restart (memory says restart; the Pre-Phase-1 smoke resolves this). The Linux clipboard-availability probe for Phase 2.4 is unspecified — decide between (a) startup probe caching, (b) per-call probe. The `.`-repeat hook surface (Step 2.2) spans every operator AND every edit command — the cost estimate should be revisited before Phase 2 starts (likely 2-3× the original 1-3 day estimate). Macro-record-key timing is resolved: call before the bound command executes, while special-casing the recording stop key so it is not captured.

### Pre-Phase-1 smoke (do this FIRST, before any step)

A 30-minute exercise that de-risks Phase 1. Skipping it risks discovering the daemon-restart assumption was wrong mid-implementation.

1. Edit one `(key-bind ...)` line in an existing `commands/*.tlisp` file (say, change the bound command string).
2. Save. WITHOUT restarting the daemon, run `bun run start` and verify the change took effect.
3. If the change is live → daemon hot-reloads T-Lisp; the restart advice can be relaxed for T-Lisp-only phases. If not → restart is required for every Phase 1 step too.
4. Record the finding in `docs/learnings.md` (per CLAUDE.md §6) and update the Architecture Constraints table accordingly.

## Feature Description

This spec is a phased implementation roadmap, not a single end-to-end work order. Before implementing any phase, re-run the feature inventory for that phase, remove already-shipped slices, and answer phase-blocking open questions. It closes the highest-leverage gaps between tmax's current vim emulation and VS Code Vim's documented feature surface, as identified in the June 2026 gap analysis. The 11 recommendations break into three cost tiers:

- **Tier A — Bindings only (low cost, very high impact):** wire existing TypeScript primitives into the operator/search/macro keypaths so users can actually reach them from the keyboard. Primitives exist today; the user-visible features do not.
- **Tier B — Mode and parser extensions (medium cost, high impact):** add a replace mode value, a change-recording layer for `.`, and a register-prefix parser path. Each touches one TypeScript file plus T-Lisp.
- **Tier C — New functionality (higher cost, deferred in part):** WORD/sentence motions, marks + jumplist, indent/case operators, Ex ranges. Some are pure T-Lisp; others (marks, Ex ranges) need new TS primitive helpers.

Phases 1-5 below are roadmap scope, not one executable implementation batch. Before coding, split the relevant phase or slice group into a phase-specific approved implementation spec/PR, re-run current-source inventory, and remove already-shipped work from that smaller scope. Phases 6-7 (Ex ranges / Surround) are explicitly deferred to follow-up specs because their cost is multi-week and they deserve dedicated design — they are listed here only to set expectation.

## User Story

As a tmax user coming from VS Code Vim (or any modern vim emulator)
I want the vim-defining workflows — `diw`, `/search`, `n/N`, `q`-recorded macros, `r{char}`, `.`, `"ayy`, `ma`/`'a`, `C-o`/`C-i` — to just work
So that I can edit code at the speed I expect from a vim-family editor, not the reduced subset that works today

## Problem Statement

A gap analysis (June 2026) between VS Code Vim and tmax found that tmax has working TypeScript primitives and T-Lisp libraries for several flagship vim features — text objects, search, macros, registers — but the **user-facing key bindings either don't exist, aren't wired end-to-end, or have only partial variant coverage**. Re-run this inventory before each phase; current source has already shipped some Phase 1 text-object work. Specifically:

1. **Text objects** (`src/editor/api/text-objects.ts`) now have operator-pending dispatch in `src/tlisp/core/commands/operators.tlisp` and SPEC-044 Phase 1.A tests in `test/unit/operator-text-object.test.ts`. Remaining work is narrower: verify shipped coverage, add only missing primitive exposures/region helpers, and cover remaining variants such as around brace/bracket/angle/tag where supported.
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

1. **Phase 1** — Verify the existing `operator+text-object` dispatch in `operators.tlisp`, complete only the remaining text-object primitive/dispatch gaps, add `/`/`?`/`n`/`N`/`:nohl` bindings, and rebind `q`/`@`/`@@` to the existing macro record/play API.
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
| Live-keypath harness | tmax-use | local package | Required e2e vehicle for SPEC-044 acceptance criteria; playbooks live in `tmax-use/playbooks/*.yaml` and run via `bun run test:tmax-use`. |
| Renderer regression harness | Python + uv + tmux | Python 3.13, uv-managed | `test/ui/tmax_harness/` library, `test/ui/run_python_suite.py` runner; required only for renderer/TUI changes. |
| Dependencies | ink, react, typescript, tsx | per `package.json` | Zero editor-logic deps — do NOT add new runtime deps for any phase. |
| Build | `bun build --compile` | n/a | Produces `dist/tmax`, `dist/tlisp`, and `dist/tmax-use` standalone binaries. |

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
bun run typecheck                        # Full typecheck (src + test + tmax-use + bench)
bun run typecheck:src                    # Source-only typecheck
bun run typecheck:test                   # Test-only typecheck
bun run typecheck:tmax-use               # tmax-use typecheck
bun run typecheck:bench                  # Benchmark harness typecheck

# Tests
bun run test                             # All bun tests
bun run test:unit                        # test/unit/ only
bun run test:integration                 # test/integration/ only
bun run test:daemon                      # Python suite, daemon subset
bun run test:ui                          # Full Python UI suite
bun run test:ui:renderer                 # Python UI suite, renderer/tmux subset
bun run test:tmax-use                    # tmax-use live-keypath playbooks
bun run test:ui:helpers                  # Harness self-tests

# Build
bun run build                            # tmax + tlisp + tmax-use standalone binaries
bun run build:tmax                       # Just tmax
bun run build:tlisp                      # Just tlisp
bun run build:tmax-use                   # Just tmax-use

# Daemon lifecycle (for UI verification)
bin/tmax --stop                          # Stop the daemon (assumes bin/ on PATH or use ./bin/tmax)
bun run daemon                           # Start daemon in foreground (Ctrl-C to stop)
```

**Phase verification gate (run after every step):** `bun run typecheck && bun run test:unit && bun run test:tmax-use`. Add `bun run test:ui:renderer` only when the slice changes renderer behavior, terminal layout, cursor display, or other TUI rendering.

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
│   │       ├── macros.tlisp       → EXISTING — Phase 1.3 may extend/reroute
│   │       ├── vim-replace.tlisp  → NEW (Phase 2.1) — NOT replace.tlisp (collision)
│   │       ├── repeat.tlisp       → NEW (Phase 2.2)
│   │       ├── marks.tlisp        → EXISTING — Phase 4.1 may extend
│   │       ├── jumplist.tlisp     → EXISTING — Phase 4.2 may extend
│   │       ├── indent-ops.tlisp   → EXISTING — Phase 5.1 may extend
│   │       └── command-history.tlisp → NEW (Phase 6 prerequisite)
│   └── ...
├── editor/
│   ├── api/                       → TS primitives ONLY (no decisions)
│   │   ├── mode-ops.ts            → validModes array (Strategy A target, line 72)
│   │   ├── text-objects-ops.ts    → Exposes 21 primitives; Phase 1.1 adds only remaining gaps
│   │   ├── text-objects.ts        → Region computation (Phase 1.1 adds only missing variants)
│   │   ├── evil-integration.ts    → Registers — 'A' append already works (Phase 2.3)
│   │   ├── search-ops.ts          → search-next/previous exposed (Phase 1.2 binds them)
│   │   ├── macro-recording.ts     → DO NOT TOUCH (production-ready)
│   │   └── clipboard-ops.ts       → NEW (Phase 2.4) — or extend evil-integration.ts
│   ├── handlers/                  → Mode dispatch routing (no logic)
│   │   ├── normal-handler.ts      → Macro-record-key hook near keymap executeCommand (Phase 1.3)
│   │   ├── insert-handler.ts      → Template for replace-handler.ts (Phase 2.1)
│   │   └── replace-handler.ts     → NEW (Phase 2.1 Strategy A only)
│   └── editor.ts:1302-1347        → defineRaw() for macro primitives (already done)
├── server/                        → Daemon — no changes for Phases 1-5
└── client/                        → TUI client — no changes for Phases 1-5

test/
├── unit/                          → Bun tests, extend existing files
│   ├── operator-text-object.test.ts → Existing Phase 1.A coverage; extend for remaining gaps
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
└── ui/                            → Python daemon/renderer regression tests
    ├── tmax_harness/              → Library (harness.py, client.py, etc.)
    ├── tests/                     → Existing Python scenarios; not the SPEC-044 live-keypath e2e vehicle
    └── run_python_suite.py        → Runner (invoked via bun run test:ui*)

docs/
├── specs/                         → THIS FILE + SPEC-045..053 (follow-ups)
├── adrs/                          → Architecture Decision Records — add per phase
├── rfcs/                          → RFCs for larger features
└── learnings.md                   → Persistent lessons — append per CLAUDE.md §6
```

**Rule:** every change must trace to a file in this tree. If you're editing a file not listed, the spec missed something — pause and update the spec.

## Code Style

The project follows the patterns in `src/tlisp/Claude.md` and `src/editor/Claude.md`. One real example beats description — this is the canonical command-library shape (from existing `commands/operators.tlisp:60-75`):

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
| Live keypath E2E | tmax-use | `tmax-use/playbooks/*.yaml` | Every user-visible acceptance criterion; each playbook drives a fresh daemon, sends real keys via `keys:`, and inspects captured frame/buffer output. API-only `eval:` may set up fixtures but cannot replace keypath assertions. Run via `bun run test:tmax-use`. |
| Daemon/renderer regression | Python suite | `test/ui/run_python_suite.py daemon` / `daemon-tmux` | Existing daemon and renderer regressions. Required only when a slice changes daemon protocol, renderer behavior, terminal layout, cursor display, or other TUI rendering. |

**Coverage expectations:**
- Every Phase N acceptance criterion maps to at least one deterministic unit/integration test and, when the behavior is user-visible, one tmax-use live-keypath playbook.
- Visual/rendering changes MUST also pass `bun run test:ui:renderer` — per memory `feedback_verify-end-to-end-not-unit-only.md`.
- Operators and edits MUST have an undo round-trip test (`<op>` then `u` restores text + cursor).
- Register writes MUST have a yank-pop test (`<op>` then `M-y` cycles).

**Test file policy:** extend existing files (`operator-text-object.test.ts`, `macro-recording.test.ts`, etc.) when the feature fits. Create new files only for genuinely new features (`replace-mode.test.ts`, `repeat-change.test.ts`, `marks.test.ts`, `jumplist.test.ts`, `indent-ops.test.ts`).

**Test ordering:** TDD per `rules/testing.md` — write the test first, watch it fail, implement, watch it pass. No exceptions for Phase 1-3.

## TDD Discipline (per `test-driven-development` skill)

Every step in every phase follows RED → GREEN → REFACTOR. "Seems right" is not done. A step is incomplete until a previously-failing test passes.

### The cycle, mapped to this spec

```
RED                GREEN               REFACTOR
 ───                ────                ────────
Add a test       Make it pass        Clean up
to test/unit/    via the T-Lisp      the T-Lisp
or tmax-use/     dispatch / TS       module shape
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
      // Example only: existing Phase 1.A coverage should already pass in the
      // current repo. For new work, replace this with a missing variant such
      // as da} or ca] and observe that specific variant fail first.
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

For Phase 1.1 now, the GREEN step is:
1. Run `bun test test/unit/operator-text-object.test.ts` and verify the already-shipped dispatch still passes.
2. Add a failing test for one missing variant identified by the fresh inventory.
3. Add only the required primitive exposure/helper and dispatch case for that variant.
4. Run `bun test test/unit/operator-text-object.test.ts` — passes.

Do NOT rebuild the existing text-object pending state or duplicate Phase 1.A tests. Each missing variant should be its own RED/GREEN cycle.

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
             ╱  ╲         tmax-use playbooks
            ╀    ─         ~15% — live daemon,
           ╱      ╲          real keys, captured output
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
- Daemon state across client calls → **integration** or **tmax-use**
- User-visible key behavior → **tmax-use** (mandatory live keypath for this spec)
- Renderer/layout/cursor-display changes → **Python renderer suite** via `bun run test:ui:renderer`

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
- [ ] tmax-use playbook added if the feature is user-visible; `bun run test:ui:renderer` added only for renderer/TUI changes (per memory).
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
  3. VERIFY      — bun run typecheck && bun run test:unit && bun run test:tmax-use; add bun run test:ui:renderer for renderer/TUI changes
  4. COMMIT      — atomic, descriptive message (per git-workflow-and-versioning)
  5. NEXT SLICE  — carry forward, do not restart
```

**Hard rules from the skill:**
- **One thing per increment.** A commit that wires `diw` AND adds `/` search bindings is two commits. Split them.
- **Keep it compilable.** After every increment: `bun run typecheck` green, `bun run test:unit` green. Never leave the tree broken between slices.
- **Rollback-friendly.** Additive changes (new files, new `(key-bind ...)` lines) are easy to revert. Modifications to existing dispatch tables should be minimal and focused. Never delete + replace in the same commit.
- **No scope creep.** Touch only what the increment requires. Notice dead code or refactoring opportunities? Note them — don't fix them. (CLAUDE.md §3 echoes this.)
- **Run verification ONCE per code change.** No reassurance reruns on unchanged code.

### Slicing plan — Phase 1 (Tier-A Wiring and Remaining Gaps)

Phase 1 has 3 logical features (text objects, search, macros). Each is its own vertical slice, sub-sliced where useful.

| Slice | Scope | In scope | Out of scope | Verify |
|---|---|---|---|---|
| **1.A** | Text objects, already-shipped Tier-A | Verify existing `operators.tlisp` text-object pending state, `vim-operator-apply-text-object`, normal-handler pending route, and `test/unit/operator-text-object.test.ts` coverage still pass | Rebuild text-object dispatch from scratch; duplicate existing Phase 1.A tests | `bun test test/unit/operator-text-object.test.ts`; `bun run test:tmax-use` for the representative playbook |
| **1.B** | Text objects, remaining primitive/dispatch gaps | Inventory current `text-objects.ts` + `text-objects-ops.ts`; add only missing exposed variants such as around brace/bracket/angle/tag delete/change and supported inner change variants; extend `operator-text-object.test.ts` | Already-exposed variants (`ciw`, `caw`, quote deletes, around paren); visual-mode text objects; register prefix | `bun test test/unit/operator-text-object.test.ts` for the new combos |
| **1.C** | Text-object count multiplier | Verify/implement `d2iw`, `d3aw` using existing `vim-operator-total-count` formula | Visual text objects; new operators | Count tests pass |
| **1.D** | Search bindings (`/ ? n N`) | Add 4 `(key-bind ...)` lines to `isearch.tlisp`; verify incremental search minibuffer works | `:nohl`; visual `/`; regex | `bun test test/unit/incremental-search.test.ts` + `search-navigation.test.ts` |
| **1.E** | `:nohl` Ex command | Add `:nohl`/`:noh` to `editor-execute-command-line` in `bindings-ops.ts:56-128`; clear highlight ranges without clearing the last search pattern | New search parser | tmax-use playbook for `:nohl` clears highlights and `n` still works |
| **1.F** | Macro bindings (`q` record) | Add `commands/macros.tlisp`; rebind `q` from `editor-quit` to dispatcher; preserve top-level quit on cancel | `@` play; `@@` replay; recording-capture hook | `bun test test/unit/macros.test.ts` — `qa` enters recording state |
| **1.G** | Macro recording-capture hook (v3 finding #19) | Add `(macro-record-key <key>)` call near the keymap `executeCommand` block in `normal-handler.ts` when `(macro-record-active)` | `@` play; persistence | Unit test: record `jxjx`, replay via API, verify buffer state |
| **1.H** | Macro play (`@` + `@@`) | Bind `@` to register-dispatch using `(macro-execute <reg>)`; bind `@@` to `(macro-execute-last)` | Persistence across restarts | `bun test test/unit/macro-recording.test.ts` — `@a` plays `qa` recording |
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

**8 slices.** Slice 2.A is its own commit because it's a type-system change that should land before any code depends on `'replace'`. Strategy A is selected for SPEC-044; if it proves too invasive, stop and update this spec before replacing it with a different design.

### Slicing plan — Phase 3 (Missing Motions)

| Slice | Scope | Verify |
|---|---|---|
| **3.A** | `W B E` WORD motions | `bun test test/unit/word-navigation.test.ts` (extend existing) |
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
| **4.B** | `:marks` Ex command listing | tmax-use playbook for the listing buffer |
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
| **5.C** | Visual mode `>` `<` | tmax-use playbook |
| **5.D** | `gu` `gU` `g~` lowercase/uppercase/toggle (line + operator + visual) | Extend indent-ops tests |
| **5.E** | `~` toggle-case-char | Same |
| **5.F** | Deferred: `=` operator via existing `indent-region` from `indent.tlisp` | Follow-up spec unless a phase-specific SPEC-044 addendum explicitly approves language-aware behavior |

**5 required slices plus one deferred slice.** 5.F is documented as follow-up scope because it depends on language-aware indent — markdown/lisp work, TS/JS may not. Do not implement `=` in SPEC-044 unless a phase-specific addendum first defines supported languages and tests.

### Cross-phase slicing rules

- **Each slice ends with a green `bun run test:unit` AND `bun run test:tmax-use`.** Add `bun run test:ui:renderer` only for renderer/TUI changes. Not "next slice will fix it."
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
SIMPLICITY CHECK for Phase 1.B:
✗ Generic text-object dispatch table rewrite with metadata-driven resolver
✓ One missing variant at a time, using the existing cond chain and pending state

SIMPLICITY CHECK for Phase 2.D (repeat recorder):
✗ Generic event-sourcing model with replay engine
✓ List of (operator, motion, count, register) tuples + simple replay function
```

Implement the naive, obviously-correct version first. Optimize only after correctness is proven with tests.

### Rollback-friendly commit shape

Every slice's commit must be revertable in isolation:

```
GOOD commit (Phase 1.B):
  - Add one missing around-brace primitive exposure
  - Add the matching operator dispatch case
  - Add the matching operator-text-object unit test
  → git revert <sha> restores the pre-slice state cleanly

BAD commit (do NOT do this):
  - Phase 1.A + 1.B + 1.C bundled
  - "While I was here, also fixed the visual-mode bug"
  → Reverting pulls out unrelated work; can't isolate the bug
```

Per Rule 5: never delete + replace in the same commit. If Phase 1.F rebinds `q`, that's two commits — (1) add the macro dispatcher, (2) remove the old `editor-quit` binding. Revert either independently.

## Boundaries

### Always do
- Run `bun run typecheck && bun run test:unit && bun run test:tmax-use` after every step. Add `bun run test:ui:renderer` only for renderer/TUI changes. Zero exceptions.
- Restart the daemon after any `.ts` change before tmax-use or renderer verification (memory `feedback_daemon-restart-after-code-change.md`).
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
- Shipping a user-visible feature without a corresponding tmax-use playbook, or a renderer/TUI change without `bun run test:ui:renderer`.

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
| Editor layer | `src/editor/Claude.md` | TypeScript in `src/editor/api/` provides primitives ONLY. Decisions (what to delete, how to move, which mode) live in `src/tlisp/core/`. |
| T-Lisp layer | `src/tlisp/Claude.md` | All state machines, dispatch, key sequences, count logic live in T-Lisp. Add TS primitives only when T-Lisp literally cannot compute something (char scanning, buffer access). |
| Command library pattern | `src/tlisp/Claude.md` | Follow `windows.tlisp` / `tabs.tlisp` / `isearch.tlisp`: define functions, add `(key-bind ...)` in the same file, end with `(provide "name")`. |
| Mode type | `src/editor/api/mode-ops.ts:72` | Modes are a closed string union. Adding `'replace'` is a one-line TS change that must be matched in `setMode` callers and T-Lisp `editor-set-mode` validation. |
| Operator state pattern | SPEC-041 (`src/tlisp/core/commands/operators.tlisp`) | Pending-operator state is stashed in module-level `defvar`, consumed when the sub-state (find, text-object) resolves. New branches must follow this pattern; do NOT add a parallel state machine. |
| Unified keymap | SPEC-038 (`src/editor/handlers/normal-handler.ts`) | All normal/visual/insert keys route through T-Lisp dispatch. New key definitions should be `(key-bind ...)` lines. **Routing exception:** handler changes are allowed only to route pending-state keys or macro-record capture into T-Lisp primitives, such as the Step 1.3 `macro-record-key` hook. |
| Verification | `CLAUDE.md` §8 | Every step must end with `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`, `bun run test:unit`, and `bun run test:tmax-use`. Visual/rendering changes MUST also run `bun run test:ui:renderer` and be verified in the running daemon (per memory `feedback_verify-end-to-end-not-unit-only.md`). |
| Daemon restarts | Memory `feedback_daemon-restart-after-code-change.md` | After any TS source change, restart the daemon before UI verification. Unit tests don't pick up stale-daemon regressions. |

Fill this table **before writing steps.** ✅ done above.

## Relevant Files

### Existing Files to Modify

| File | Change | Constraints |
|------|--------|-------------|
| `src/tlisp/core/commands/operators.tlisp` | Add `iw/aw/iW/aW/is/as/ip/ap/i"/a"/i'/a'/i`/a\``/i(/a)/i{/a}/i[/a[/i</a</it/at` dispatch branch; parse `"x` register prefix before operator; trigger `vim-record-change` after operator completes | SPEC-041 stash pattern. Operator state owned here, not in TS. |
| `src/tlisp/core/commands/isearch.tlisp` | Add normal-mode `(key-bind ...)` entries for `/`, `?`, `n`, and `N`; optionally define `nohl`/`noh` helpers used by the command-line branch | Follow the `windows.tlisp`/`tabs.tlisp` library pattern. No new state machine. |
| `src/tlisp/core/commands/macros.tlisp` | Existing macro command library; bind/adjust `q` (start/stop record), `@` (play), `@@` (replay last); preserve deterministic quit/cancel behavior below | Memory `feedback_daemon-restart-after-code-change.md`. The `q` binding must check `(macro-record-active)` first. |
| `src/tlisp/core/commands/repeat.tlisp` (new) | `vim-record-change`, `vim-repeat-last-change`. Operators and `i/a/o/x/r` push entries; `.` replays | Pure T-Lisp. No TS change. |
| `src/tlisp/core/bindings/normal.tlisp` | Add WORD/sentence/section motion bindings (`W B E ge gE ( ) [[ ]] [ ] m ' \` C-o C-i > < = ~ r R . @`); remove/replace `q` binding | All new keys go here, not in handler code. |
| `src/tlisp/core/bindings/visual.tlisp` | Add `> < ~` and `gu/gU/g~` visual indent/case bindings, plus visual text-object keys (`iw aw i" a" …`) if covered by the approved Phase 5 slice | Visual bindings only. Visual-block `I`/`A`/`r` and `=` are deferred out of SPEC-044. |
| `src/tlisp/core/commands/motions.tlisp` | Add WORD/sentence/section motion functions and `H M L C-e C-y gj gk g_` | Pure T-Lisp where possible; WORD-vs-word boundary detection may need a TS primitive. |
| `src/tlisp/core/commands/marks.tlisp` | Existing mark command library; extend `set-mark`, `goto-mark-line`, `goto-mark-col`, `:marks` listing only for missing Phase 4 behavior | Pure T-Lisp state plus TS position primitive if still needed after inventory. |
| `src/tlisp/core/commands/jumplist.tlisp` | Existing jumplist command library; extend `push-jump`, `jump-back`, `jump-forward`; hook motions/operators to call `push-jump` on >1-line moves only for missing Phase 4 behavior | Pure T-Lisp ring buffer. |
| `src/tlisp/core/commands/indent-ops.tlisp` | Existing indent/case operator library; extend only missing `indent-region`, `outdent-region`, `toggle-case-region`, and operator wrappers | Mostly T-Lisp; gap-buffer region shift may need a TS primitive. |
| `src/editor/api/mode-ops.ts:72` | Add `'replace'` to `validModes` and to the `EditorMode` type in `src/core/types.ts` | TS primitive change — required because the mode union is a TS type. |
| `src/editor/handlers/replace-handler.ts` (new) | Routes keys to T-Lisp `vim-replace-*` functions; minimal (mirror `insert-handler.ts` shape) | Primitives-only rule — no decisions here. |
| `src/editor/api/text-objects.ts` | Add only missing region helpers discovered by inventory, likely around variants for `{}`, `[]`, `<>`, tags and supported change variants for bracket/angle/tag | Pure primitives — region computation only. |
| `src/editor/api/text-utils.ts` | Add `findWordBoundaryWORD` (whitespace-only) helper if T-Lisp can't compute it | Primitive only; no decisions. |
| `src/editor/api/register-ops.ts` (new) OR extend `evil-integration.ts` | OS clipboard bridge for `+`/`*` registers | Use `Bun.env` and a minimal child-process call. Primitives only — T-Lisp decides when to call it. |
| `src/tlisp/core/commands/search-ex.tlisp` OR extend `isearch.tlisp` | Define reusable `nohl`/`noh` helpers if useful; they must clear only highlight ranges, not the saved search pattern. The actual `:nohl`/`:noh` command-line branch belongs in `src/editor/api/bindings-ops.ts` unless the command parser is redesigned | Follow the current `editor-execute-command-line` table, not a non-existent command-handler table. |
| `src/editor/handlers/command-handler.ts` | Add `<Up>`/`<Down>` history navigation in command mode (Phase 6 prerequisite, but small) | Handler routes only — history ring owned by T-Lisp. |
| `src/tlisp/core/commands/command-history.tlisp` (new) | Per-mode history rings for `:` commands | Pure T-Lisp. |
| `test/unit/*.test.ts` | New or extended tests per phase (see Testing Strategy) | Follow `rules/testing.md`; extend `test/unit/word-navigation.test.ts` for WORD motions unless inventory justifies a new motion file. |
| `tmax-use/playbooks/*.yaml` | New e2e playbook scenarios for the wired features | tmax-use is the project's e2e harness (SPEC-061). Each playbook drives a fresh daemon, sends real keys via `keys:` and/or exercises the API via `eval:`, and asserts on observable frame/buffer state. See `tmax-use/playbooks/README.md` for the schema; `eval-19-vim-text-objects.yaml`, `eval-20-vim-search.yaml`, `eval-21-vim-macros.yaml` are the Phase 1 templates. Run via `bun run test:tmax-use` or `bin/tmax-use <playbook>`. |

### New Files

| File | Purpose | Constraints |
|------|---------|-------------|
| `src/tlisp/core/commands/repeat.tlisp` | `.` repeat-change recorder/replayer | Pure T-Lisp state. |
| `src/tlisp/core/commands/vim-replace.tlisp` (NOT `replace.tlisp` — name collision with Emacs query-replace) | Vim `r{char}`/`R` replace mode | Library pattern. |
| `src/tlisp/core/commands/command-history.tlisp` | `:` command history ring | Pure T-Lisp. |
| `src/editor/handlers/replace-handler.ts` | Replace-mode key dispatch (only under Strategy A) | Mirror `insert-handler.ts`; primitives only. |

## Implementation Phases

### Phase 1: Tier-A Wiring and Remaining Gaps (highest ROI)

**Constraint checkpoint:** Before starting Phase 1, verify:
- [ ] `src/editor/api/text-objects.ts` exports `deleteInnerWord`, `changeInnerSingleQuote`, `deleteInnerParen`, etc. (it does — read it before each step).
- [ ] `src/editor/api/search-ops.ts` exports `searchForward`, `searchNext`, etc. (it does).
- [ ] `src/editor/api/macro-recording.ts` exposes T-Lisp primitives `macro-record-start`, `macro-record-stop`, `macro-record-key`, `macro-record-active`, `macro-record-register`, `macro-execute`, and `macro-execute-last` (it does).
- [ ] Phase 1 is not `.tlisp`-only: Step 1.1 may need `text-objects.ts`/`text-objects-ops.ts`, Step 1.2 may edit `bindings-ops.ts`, and Step 1.3 requires a `normal-handler.ts` hook. Keep each `.ts` edit primitive/routing-only.

#### Step 1.1: Wire text objects into operators

**User story:** As a tmax user, I want `diw`/`daw`/`ci"`/`ca{`/`dat` to delete/change the right region, so that I can edit semantic units in 3 keystrokes.

**Description:** Two sub-steps, starting from current source rather than the older inventory.

**Step 1.1a — Re-run inventory and verify shipped text-object dispatch.** Current `operators.tlisp` already exports text-object pending state, `vim-operator-begin-text-object`, `vim-dispatch-text-object`, and `vim-operator-apply-text-object`; `normal-handler.ts` already routes pending text-object keys before operator dispatch; `test/unit/operator-text-object.test.ts` already contains SPEC-044 Phase 1.A tests. Do not rebuild this work. Run the existing test file first, inspect failures if any, and update only stale or missing coverage.

**Step 1.1b — Add only remaining TS primitive/exposure gaps.** Current `text-objects-ops.ts` exposes 21 primitives, including `change-inner-word`, `change-around-word`, quote deletes, and around paren. Before adding code, compare `text-objects.ts`, `text-objects-ops.ts`, `operators.tlisp`, and `operator-text-object.test.ts`. The likely remaining gaps are around brace/bracket/angle/tag delete/change variants and supported inner change variants for bracket/angle/tag; do not add already-exposed variants again. If a region-computation helper does not exist in `text-objects.ts`, either add a primitive helper there or narrow the acceptance criteria for this slice.

**MUST:**
- Preserve the existing text-object pending state and `vim-pending-operator-for-find` stash pattern from SPEC-041 — do NOT add a second parallel state machine.
- Wrap every mutation in `(undo-begin)` ... `(undo-commit combo)` — see `vim-operator-apply-find` lines 100 and 114 for the exact bookending. Skipping this breaks undo for text-object operations.
- Call `(set-register "\""` <deleted-or-yanked-text>) on completion — see `vim-operator-apply` lines 189-202 for the per-operator pattern. Yank-pop and the numbered delete registers (US-1.9.3) rely on this.
- Current shipped coverage includes `diw`, `daw`, `ciw`, `caw`, quote delete/change variants, inner/around paren, inner brace change/delete, inner bracket, inner angle, and inner tag tests or dispatch entries. Preserve them.
- Remaining coverage should be limited to variants actually missing after inventory, for example `da}`, `ca}`, `da]`, `ca]`, `da<`, `ca<`, `dat`, `cat`, and supported inner change variants for bracket/angle/tag.
- Apply count: `d2iw` deletes two words (existing count multiplier pattern in operators.tlisp:117-119).
- Push the operation to the repeat-recording list once Phase 2.2 lands; for now leave a `;; TODO vim-record-change` hook in the same place as the existing operators.

**MUST NOT:**
- Move the existing dispatch branch into `vim-operator-apply` — that function takes a resolved motion string; the `i`/`a` interception must stay one level up in `vim-dispatch-operator-key` before `(vim-operator-apply key)`.
- Reimplement region computation in T-Lisp — call the existing primitives, which already handle multibyte chars and edge cases (BUG-09 awareness).
- Modify `src/editor/handlers/*.ts` for Step 1.1 unless the existing pending route is broken. Text-object primitive gaps belong in `src/editor/api/text-objects*.ts`; macro routing belongs in Step 1.3.
- Break the existing `g`-pending or `f`/`t`/`F`/`T` branches in `vim-dispatch-operator-key` — the new `i`/`a` check goes alongside them, not in front.

**Convention source:** SPEC-041 (operator state pattern), `src/tlisp/Claude.md` (T-Lisp owns dispatch).

**Acceptance criteria:**
- [ ] `diw` deletes inside word; cursor at start of removed region; deleted text in `"` register and kill ring.
- [ ] `daw` deletes word plus trailing whitespace.
- [ ] `ci"` enters insert mode with quotes' contents deleted.
- [ ] `dat` deletes around tag (opening + closing) in an HTML/JSX buffer.
- [ ] `d2iw` deletes two words.
- [ ] `u` after `diw` restores the deleted text AND cursor position (undo bookend works).
- [ ] `M-y` after `dd` cycles through the numbered delete registers (register write works).
- [ ] Register-prefixed text-object operations are covered by Phase 2.3, not required for Step 1.1 completion.
- [ ] tmax-use playbook confirms a representative text-object operation deletes the expected region in a live session (see `tmax-use/playbooks/eval-19-vim-text-objects.yaml`).
- [ ] `bun run typecheck:test` passes — T-Lisp changes can break test TS only if bindings change shape.

#### Step 1.2: Bind `/` `?` `n` `N` `:nohl`

**User story:** As a tmax user, I want to search forward and backward with `/`/`?`, jump between matches with `n`/`N`, and clear highlights with `:nohl`, so that I can navigate matches the same way I do in every other vim editor.

**Description:** In `commands/isearch.tlisp`, add `(key-bind "/" "(isearch-forward)" "normal")`, `(key-bind "?" "(isearch-backward)" "normal")`, `(key-bind "n" "(search-next)" "normal")`, `(key-bind "N" "(search-previous)" "normal")`. The four target functions are already T-Lisp-callable — `isearch-forward`/`isearch-backward` live in `commands/isearch.tlisp`, and `search-next`/`search-previous` are exposed from `src/editor/api/search-ops.ts:343` and `:376`. For `:nohl`, use the existing `search-clear-highlights` primitive if present; if inventory shows it is missing, add only that tiny highlight-only primitive in `src/editor/api/search-ops.ts`. Do NOT call `search-clear`: current `search-clear` resets `lastSearchPattern`, which would break `n` after `:nohl`. The command-line path must be explicit: current `editor-execute-command-line` in `src/editor/api/bindings-ops.ts:56-128` does not eval unknown commands as T-Lisp; it sets `Unknown command`. Add a `command === "nohl" || command === "noh"` branch unless the command parser is deliberately redesigned in the same slice.

**MUST:**
- `/` and `?` must enter an incremental search minibuffer (the `search-incremental-*` primitives already implement this — bind to them, not to a new prompt).
- `n`/`N` must respect search direction (`?`-initiated search flips `n`).
- `:nohl` clears visible search highlights without clearing the pattern (so `n` still works).

**MUST NOT:**
- Re-implement search — primitives exist.
- Bind `/` in visual mode yet (Phase 1.5 visual-search deferred — visual mode ` Esc` is the escape valve).
- Touch `src/editor/api/search-ops.ts` except to add the minimal `search-clear-highlights` primitive if the fresh inventory shows it does not already exist.

**Convention source:** `src/tlisp/Claude.md` (library pattern), SPEC-005 (search model).

**Acceptance criteria:**
- [ ] Typing `/foo<CR>` in a buffer with multiple `foo` matches moves cursor to next match and highlights all.
- [ ] `n` advances to the next match; `N` reverses.
- [ ] `?foo<CR>` searches backward; `n` goes backward.
- [ ] Wrap-around: after the last match, `n` lands on the first (and vice versa for `N`).
- [ ] No matches: status shows "Pattern not found", cursor unchanged.
- [ ] Regex: `/foo*<CR>` matches `fo`, `foo`, `fooo`, …
- [ ] `:nohl<CR>` clears highlights; pressing `n` after still works (pattern retained).
- [ ] tmax-use playbook sends `/the<CR>n` and confirms cursor moved.

#### Step 1.3: Bind macros (`q`, `@`, `@@`)

**User story:** As a tmax user, I want to press `q` to start/stop recording a macro into a register, then `@<reg>` to play it, so that I can automate repetitive edits without learning T-Lisp.

**Description:** Extend existing `src/tlisp/core/commands/macros.tlisp`. The key challenge is that `q` and `@` are 2-key commands (operator-like): they read a follow-up register name. **Only one design is viable** (Option B in earlier drafts required a `(read-key)` primitive that does NOT exist per `grep -rn "read-key\|readKey" src/`):

**Option A — Transient pending state (the only real path):**
- Add `defvar vim-macro-record-pending` and `vim-macro-play-pending` flags.
- Bind `q` to a dispatcher: if `(macro-record-active)`, call `(macro-record-stop)`; else set `vim-macro-record-pending` true.
- Pending-register handling belongs near the normal-handler pending-state/keymap flow, not at stale line anchors. Current `normal-handler.ts` routes find/text-object/operator pending states near lines 68-89, prefix returns around line 129, and keymap command execution around lines 144-150. Add pending macro register routing in the same routing style, before the final "Unbound key" fallback. The keymap-flood approach (`a-z`/`0-9` bindings) scales poorly; prefer one handler-side pending check.
- Same shape for `@` (play) and `@@` (replay last).

**MUST:**
- `q<reg>` starts recording into `<reg>`; status line shows `recording @<reg>`.
- `q` while recording stops and saves.
- `@<reg>` plays; `@@` plays the last-played register.
- Exact pending behavior: `q` alone starts macro-register pending state and does not quit because there is no timeout/read-key mechanism. `q<Esc>` and `q<C-g>` cancel pending state and call `editor-quit`. `q<invalid>` where `<invalid>` is not a register name cancels pending state, leaves the invalid key unhandled, shows a warning/status message, and does not start recording. Quit remains available through the existing command-mode path (`:q<CR>`).
- Recording persists across daemon restarts via `saveMacrosToFile` (`api/macro-persistence.ts`).
- **CRITICAL — recording-capture hook.** The macro API is exposed via `editor.ts` as `macro-record-start`, `macro-record-stop`, `macro-record-key`, `macro-record-active`, `macro-record-register`, `macro-execute`, and `macro-execute-last`, but `grep -rn "recordKey\|macro-record" src/editor/handlers/` returns ZERO matches — handlers do NOT call `macro-record-key` today, which means recording captures nothing. Fix this by adding a hook immediately before the keymap `await executeCommand(editor, cmdRight.value)` call (currently around `normal-handler.ts:149`, not line 129). When `(macro-record-active)` is true, the handler must call `(macro-record-key "<key>")` BEFORE evaluating the bound command. This matches the existing handler-routing pattern: the handler already calls `(vim-dispatch-operator-key ...)` and `(vim-dispatch-find-target ...)` to route into T-Lisp; macro-record-key is the same shape. The "handler routes, T-Lisp decides" rule from `src/editor/Claude.md` is preserved — the handler routes the key into the macro-record primitive, T-Lisp decides whether to store it.
- Preserve `(provide "macros")` and ensure the existing file remains in the load list wherever `windows.tlisp`/`tabs.tlisp` are required (find via `grep -rn "windows.tlisp\|tabs.tlisp" src/`).
- The recording hook must skip the stopping `q` key itself; vim does NOT record the stopping `q`.

**MUST NOT:**
- Touch `src/editor/api/macro-recording.ts` — the API is production-ready.
- Add a T-Lisp-side "unified dispatcher" function for macro recording — there is no such function. The unified dispatch IS the handler. (See v3 review note #19.)
- Bind `q` in insert mode (Phase 2 stretch — visual-mode `q` is unclaimed).
- Claim bare `q` can still quit without a follow-up key. That is not implementable without a timeout/read-key mechanism; use `q<Esc>`/`q<C-g>` or `:q<CR>` for quit.

**Convention source:** `api/macro-recording.ts` (existing API), `api/macro-persistence.ts` (US-2.4.2 persistence), ADR-0038/0039.

**Acceptance criteria:**
- [ ] `qa<some-keys>q` records a macro into `a`.
- [ ] `@a` plays it.
- [ ] `@@` plays it again.
- [ ] Restarting the daemon and running `@a` still works (persistence).
- [ ] `q` alone enters pending state; `q<Esc>` and `q<C-g>` cancel pending state and quit; `q<invalid>` cancels with a warning and does not record.
- [ ] tmax-use playbook records and plays a macro in a live session (see `tmax-use/playbooks/eval-21-vim-macros.yaml`).

#### Step 1.4: Phase 1 verification gate

**Description:** Stop and verify Phase 1 end-to-end before Phase 2. Restart the daemon after any `.ts` change and after any T-Lisp load-list change; the Pre-Phase-1 smoke determines whether T-Lisp-only binding edits also need a daemon restart.

**Acceptance criteria:**
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:tmax-use` passes for Phase 1 playbooks.
- [ ] `bun run test:ui:renderer` passes if Phase 1 changed renderer/TUI behavior.
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

**Selected implementation strategy: Strategy A.** Strategy B is retained below only as rejected design context.

**Strategy A — Add `'replace'` to the TypeScript mode union (type-safe, more changes):**
- The `'replace'` value must be added to ALL FIVE sites that hardcode the mode union: (1) `EditorMode` in `src/core/types.ts`, (2) the `setMode` parameter type at `src/editor/api/mode-ops.ts:39`, (3) the `validModes` array at `src/editor/api/mode-ops.ts:72`, (4) `getMode`/`setMode` signatures in `src/editor/api/bindings-ops.ts:33-34`, (5) any other `setMode: (mode: ...)` signatures surfaced to T-Lisp (grep `setMode:` in `src/editor/`).
- Add `src/editor/handlers/replace-handler.ts` mirroring `insert-handler.ts` shape (routes only, no logic).
- In T-Lisp: `vim-replace-char` (the `r` two-key command — stash state via a new `vim-pending-replace-char` defvar, await next char, overwrite using existing buffer primitives), `vim-replace-mode-enter` (the `R` binding), `vim-replace-mode-insert` (overwrites instead of inserting while in replace mode).

**Rejected Strategy B — Use `'insert'` mode with a T-Lisp sub-state flag (no TS change, less discoverable):**
- Add `defvar vim-replace-mode-active` to `vim-replace.tlisp`.
- Bind `R` to `(progn (set! vim-replace-mode-active t) (editor-set-mode "insert"))`.
- Bind `r{char}` to a T-Lisp dispatcher that overwrites one char and returns.
- Hook the insert-mode character handling so that when `vim-replace-mode-active` is true, typed chars overwrite instead of insert.
- Escape clears the flag and returns to normal mode.

Trade-off resolved: Strategy A requires ~5 TS changes but is type-safe and `editor-mode` returns `"replace"`. Strategy B is pure T-Lisp but `(eq (editor-mode) "insert")` is true during replace, breaking any code that distinguishes the two. Implement Strategy A unless this spec is explicitly revised before Phase 2.1.

**MUST:**
- `r{char}` replaces exactly one character under the cursor, then returns to normal mode.
- `R` enters replace mode: typed chars overwrite; `Backspace` restores the original char (vim semantics).
- `Escape` from replace mode returns to normal mode.
- Count: `3rx` replaces 3 chars with `x` (count multiplier).
- `<CR>` in replace mode splits the line (vim semantics — NOT an overwrite of newline).

**MUST NOT:**
- Implement `gR` (virtual replace) — defer.
- Add a separate visual-mode replace binding in Phase 2 — visual/block `r` is deferred to SPEC-047 with the other visual-block ops.
- Add `'replace'` to ONLY one site — TypeScript will not catch the others at compile time if they use loose string types; runtime validation in `editor-set-mode` will reject the new mode.

**Convention source:** `src/editor/api/mode-ops.ts:72` (mode union), `src/editor/handlers/insert-handler.ts` (handler shape).

**Acceptance criteria:**
- [ ] `rx` overwrites the char under the cursor.
- [ ] `3rx` overwrites 3 chars with `x`.
- [ ] `R` enters replace mode; typed chars overwrite; `Backspace` restores.
- [ ] `Escape` returns to normal mode.
- [ ] tmax-use playbook confirms replace semantics through real keys.

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

**Convention source:** `src/editor/Claude.md` (primitives only), Vim reference (`+`/`*` register semantics).

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
- [ ] Current `src/tlisp/core/commands/marks.tlisp` behavior has been inventoried; extend only missing mark behavior.
- [ ] Current `src/tlisp/core/commands/jumplist.tlisp` behavior has been inventoried; extend only missing jumplist behavior.
- [ ] `src/editor/api/jump-ops.ts` exists but only handles line jumps — NOT a jumplist. Decide whether any TS position primitive is still needed after the T-Lisp inventory.

#### Step 4.1: Marks

**Description:** Extend existing `commands/marks.tlisp` with any missing mark behavior. The mark store should be a `defvar` alist mapping `(mark-name . (buffer-id line col))`. `m<name>` sets; `'<name>` jumps to line; `` `<name> `` jumps to exact col. Add or complete `:marks` listing.

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
- [ ] Existing indentation files have been inventoried (`src/tlisp/core/commands/indent.tlisp` and `src/tlisp/core/commands/indent-ops.tlisp` exist).
- [ ] `=` is deferred out of SPEC-044 unless a phase-specific addendum defines language support and tests.

#### Step 5.1: Indent and case operators

**Description:** Extend existing `commands/indent-ops.tlisp`. Operators `> < gu gU g~` for shift-right / shift-left / lowercase / uppercase / toggle-case are in SPEC-044. The `=` (reindent) operator is deferred unless a phase-specific addendum defines language support and tests. For `>`/`<`, add T-Lisp wrappers that compose existing indentation primitives with a `tab-width`/`indent-offset` lookup against the active major mode. Case operators are pure T-Lisp using `buffer-line-text` + `buffer-replace-line` (or equivalent TS primitives).

**MUST:**
- Required operators work with motions, text objects, visual mode, and lines (`>> guu gUU`).
- Indent width respects the major mode's `tab-width` / `indent-offset` (read from the mode-local variables established in `modes/*.tlisp`).
- Visual mode: `>` `<` `~` and `gu/gU/g~` on selection. Visual-block `I`/`A`/`r` is deferred to SPEC-047.
- New indent cases follow the SPEC-041 stash pattern + undo bookend + `set-register` write just like Phase 1 text objects.

**Acceptance criteria:**
- [ ] `>>` indents the current line by one shiftwidth.
- [ ] `>` in visual indents the selection.
- [ ] `guu` lowercases the current line; `gUU` uppercases.
- [ ] `~` toggles case of char under cursor.
- [ ] `=` / `=ap` are not implemented in SPEC-044 unless a phase-specific addendum first defines language-aware behavior.
- [ ] Visual-mode `r{x}` is not implemented in SPEC-044; it belongs to SPEC-047 visual-block work.

### Phase 6: Ex Ranges and `:g` / `:v` / `:sort` / `:!` — DEFERRED

Out of scope for SPEC-044. Tracked here for visibility. Implementing Ex ranges properly requires:
- A range parser integrated with the current Ex command path in `src/editor/api/bindings-ops.ts` (handles `:%`, `:1,5`, `:.,$`, `:'<,'>`, `:+N`, `:-N`) unless that parser is moved to T-Lisp in a dedicated redesign.
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
5. **Phase 5 (Tier C-operators):** `> < gu gU g~` work as operators, line-operators, and visual-mode bindings. `=` and visual-block `I`/`A`/`r` are deferred out of SPEC-044 unless a phase-specific addendum explicitly brings them back with tests.
6. **No regressions:** every existing tmax-use playbook (`bun run test:tmax-use`) still passes; every existing unit test still passes; `bun run typecheck` is green.
7. **No TS violations:** `src/editor/handlers/*.ts` and `src/editor/api/*.ts` files contain no new editor decisions (per `src/editor/Claude.md`).
8. **Memory compliance:** daemon restarted before every UI verification step (per `feedback_daemon-restart-after-code-change.md`); visual fixes verified in the live system, not unit-only (per `feedback_verify-end-to-end-not-unit-only.md`).

## Validation Commands

Execute every deterministic validation command at the end of each phase (not just at the end of the spec). Every command in this list must exit 0.

- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:src` — TypeScript source typechecks.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:test` — Test files typecheck.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck` — Full typecheck (`typecheck:src` + `typecheck:test` + `typecheck:tmax-use` + `typecheck:bench`).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:unit` — Unit tests pass (extends `operator-text-object.test.ts`, `operator-find-char.test.ts`, `macro-recording.test.ts`, `incremental-search.test.ts`, `vim-dispatch.test.ts`, etc.).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:tmax-use` — tmax-use live-keypath playbooks pass for every user-visible acceptance criterion.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:daemon` — Daemon behavior tests pass via `cd test/ui && uv run python run_python_suite.py daemon`.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:ui:renderer` — Required only for renderer/TUI changes; UI renderer tests pass via `cd test/ui && uv run python run_python_suite.py daemon-tmux`.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run build` — Bun build succeeds (`build:tmax` + `build:tlisp` + `build:tmax-use`).
- After any `.ts` change: `bin/tmax --stop` (or `bun run daemon` + Ctrl-C) then restart before tmax-use or renderer verification (per memory `feedback_daemon-restart-after-code-change.md`).
- For new e2e test scenarios: extend `tmax-use/playbooks/*.yaml` — invoke via `bun run test:tmax-use` (all playbooks) or `bin/tmax-use <playbook>` (single). The legacy `test/ui/tests/*.py` Python harness is NOT the e2e vehicle for this spec.

Manual smoke commands do not belong to the exit-0 gate because they are interactive:

- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run start` — Manual smoke (note: `start` invokes `node --import tsx src/main.tsx`, not `bun` directly). Exercise representative Phase N workflows in a live session and quit manually.

## Design Decisions

| Decision | Rationale | Alternative rejected |
|----------|-----------|---------------------|
| Phase 1 is inventory-driven, not bindings-only | Some work is already shipped; remaining work may include `.ts` primitive/routing changes for text-object gaps, `:nohl`, and macro capture. Lowest-risk, highest-impact first still applies. | Treating the stale gap analysis as authoritative — rejected; source inventory wins. |
| Reuse SPEC-041 stash pattern for operator+text-object and `"x` register prefix | Proven pattern, single source of truth for pending-operator state. | New state machine per feature — rejected; multiplies bug surface. |
| Marks and jumplist owned by T-Lisp, not TS | They're stateful decisions (which positions to remember, when to push) — that's logic per `src/editor/Claude.md`. TS only adds a position get/set primitive if needed. | Storing marks in `editor.ts` state — rejected; violates primitives-only rule. |
| Replace mode requires a TS change (`mode-ops.ts:72`) — Strategy A | The mode union is a TS type — T-Lisp can't extend it cleanly. 5-site change, minimal blast radius. | Encoding replace as an insert-mode flag (Strategy B) — rejected for v1; lower discoverability and any code that branches on `editor-mode` would misbehave. Revisit if TS churn proves larger than expected. |
| Vim-replace logic goes in NEW `commands/vim-replace.tlisp`, NOT `commands/replace.tlisp` | The existing `replace.tlisp` implements Emacs `query-replace`; conflating would break the separation of vim/Emacs feature sets. | Extending `replace.tlisp` — rejected; name collision. |
| Macro recording hook goes in `normal-handler.ts` near keymap execution, not T-Lisp | The "unified dispatcher" IS the handler — there is no single T-Lisp `vim-dispatch-normal-key` function. In current source the keymap `executeCommand` call is around line 149; line 129 is only a prefix return. Handler-side hook matches the existing pattern of routing keys into T-Lisp. | T-Lisp-side wrapping of every binding expression — rejected; too invasive. |
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
3. **Linux clipboard availability — startup probe or per-call?** (Blocks Phase 2.4.) Startup probe is faster but stale if `xclip` is installed mid-session.
4. **Count × text-object multiplication — does `d2iw` follow `vim-operator-total-count`?** (Blocks Phase 1.1b.) Assumed yes (Assumption #5); verify before relying on it.
5. **Are any of the 11 priority recommendations already shipped?** (Blocks spec rescope.) The June 2026 gap analysis may be stale. Re-run the inventory before each phase.
6. **What's the cap on jumplist entries?** (Blocks Phase 4.2.) Vim default is 100; confirm tmax's ring buffer size.

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
- [x] **Incremental Implementation covered** — Incremental Implementation Discipline section with per-phase slicing plans. Treat these as roadmap slices; approve and execute smaller phase-specific specs/PRs rather than one 36-slice batch.
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
- [ ] All tests pass: `bun run test:unit` AND `bun run test:tmax-use`; `bun run test:ui:renderer` also passes when renderer/TUI behavior changed.
- [ ] RED test was committed before the implementation (visible in PR history or commit message).
- [ ] Test names describe behavior, not implementation (`"diw deletes word under cursor"`, not `"test dispatch works"`).
- [ ] No tests were skipped, disabled, or marked `.todo` to manufacture green.
- [ ] No mocks of in-process APIs (registers, undo, search, macro recording) — real implementations only.
- [ ] User-visible keypath changes include at least one tmax-use playbook that sends real keys and inspects captured output; renderer/TUI changes also include `bun run test:ui:renderer` coverage (per memory `feedback_verify-end-to-end-not-unit-only.md`).
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
- **Daemon restart between phases:** after every `.ts` change, restart the daemon before tmax-use or renderer verification (per memory). T-Lisp-only changes also benefit from a restart since the daemon caches T-Lisp files.
- **Register `"` collision:** `"y` is both "yank into `"` (the unnamed register, no explicit register) and "yank into register `y`". Disambiguate: a single `"` immediately followed by a register letter is the prefix; a lone `"` falls through to operator dispatch.
- **`.` after yank:** `.` should NOT replay yanks (yank isn't a change). Verify `yy.` doesn't double-yank.
- **Unnamed register rule:** yank (`y`) writes `"` AND register `0`. Delete (`d`/`c`/`x`) writes `"` AND rotates numbered registers `1-9`. Text-object dispatch and indent/case operators MUST preserve this distinction — verify with `yiw` then `dd` then `:registers` (after Phase 6) shows the yanked word in `0` and the deleted line in `1`.
- **Visual-mode text objects are a different code path:** `viw` expands the existing visual selection to word boundaries — it does NOT go through operator-pending. Phase 1.1's operator+text-object dispatch is normal-mode only. Visual text objects are a separate Step 5.x (visual-mode bindings) concern.
- **`@` replay while recording:** Pressing `@a` during a recording should append the macro's keys to the current recording (vim quirk). Phase 1.3 must decide: do this fully, or no-op with a warning.

## Audit findings (adw-patch-review 2026-06-21T21:52:21.024Z)

**Verdict:** gaps

Phase 1 (Tier-A wiring) is fully landed — text objects, search bindings, `:nohl`, and the macro record/play API (q/@/@@) are wired end-to-end with the normal-handler recording hook in place. Phase 2 is only partial: `r{char}` and the `"x` register prefix shipped, but `R` mode (Strategy A — no `'replace'` in mode-ops.ts:72), `.` repeat (no `repeat.tlisp`, no `.` binding), and the OS clipboard bridge (no `clipboard-ops.ts`) are missing. Phase 3 ships only W/B/E/ge/gE; sentence, section, H/M/L, C-e/C-y, and gj/gk/g_ are absent. Phase 4 ships basic marks + jumplist but lacks global marks, special marks (`'<` `'>` `'[` `']` `'^` `.`), and the `:marks` listing. Phase 5 ships only line-scoped operators (>>, <<, ~, guu, gUU, g~~); operator+motion forms and all visual-mode variants are deferred. Several spec-listed edge cases (wrapped-line motions, replace-over-EOL, `.` after yank) cannot be handled because the underlying features are not implemented.

### Criteria
- **Phase 1.1: diw/daw/ciw/caw/ci"/ca{/dat text-object dispatch via operator+text-object** — implemented: src/tlisp/core/commands/operators.tlisp:170-220 (vim-operator-apply-text-object covers diw/daw/ciw/caw/quote/paren/brace/bracket/angle/tag combos); src/editor/api/text-objects-ops.ts:66-689 (21 primitives incl. around brace/bracket/angle/tag + change variants)
- **Phase 1.1: Count multiplier d2iw (existing vim-operator-total-count formula)** — implemented: src/tlisp/core/commands/operators.tlisp:160-166 (vim-operator-begin-text-object multiplies operator-count × motion-count); operators.tlisp:185-188 pass count to delete/change-inner/around-word
- **Phase 1.1: undo bookend + set-register on text-object mutations (SPEC-041 pattern)** — implemented: src/tlisp/core/commands/operators.tlisp:183,218 ((if (string= operator "y") nil (undo-begin)) … (undo-commit combo))
- **Phase 1.2: / ? n N normal-mode bindings** — implemented: src/tlisp/core/commands/isearch.tlisp:34-37 (key-bind / ? n N)
- **Phase 1.2: :nohl/:noh Ex command clears highlights without clearing pattern** — implemented: src/editor/api/bindings-ops.ts:111-112 (nohl/noh branch); src/editor/api/search-ops.ts:452-461 (search-clear-highlights primitive)
- **Phase 1.3: q<reg> record / q stop / @<reg> play / @@ replay** — implemented: src/tlisp/core/commands/macros.tlisp:40-127 + 132-133 (key-bind q/@)
- **Phase 1.3: macro-record-key hook in normal-handler.ts (CRITICAL gap from v3 review)** — implemented: src/editor/handlers/normal-handler.ts:89-95,121-124,131-134,141-144,151-154,233-235 (macro-record-key called before bound command across all pending routes + final keymap execute); line 164-168 special-cases the stopping q
- **Phase 1.3: q<Esc>/q<C-g> cancel pending and quit** — implemented: src/tlisp/core/commands/macros.tlisp:95-100 (cond branch on Escape/C-g calls editor-quit)
- **Phase 2.1 Strategy A: 'replace' added to EditorMode union (5 sites)** — missing: src/editor/api/mode-ops.ts:72 (validModes = ['normal','insert','visual','command','mx'] — NO 'replace'); mode-ops.ts:39 setMode signature unchanged
- **Phase 2.B: r{char} two-key replace (count-aware, undo bookend)** — implemented: src/tlisp/core/commands/vim-replace.tlisp:23-61 (vim-replace-begin/apply with undo_begin/undo_commit + count clamp + r<Enter> newline split); test/unit/replace-mode.test.ts:29-81
- **Phase 2.C: R replace mode (typed chars overwrite, Backspace restores, Escape exits)** — missing: No R binding in src/tlisp/core/bindings/normal.tlisp; vim-replace.tlisp:7 comment states 'R mode (2.C) is a separate slice that requires the replace mode union value (Step 2.A)'
- **Phase 2.2: . repeat last change (vim-record-change recorder + replay)** — missing: No src/tlisp/core/commands/repeat.tlisp file exists; Grep for 'vim-record-change|vim-repeat-last-change|key-bind "\\."' returns no matches in src/tlisp/core; no test/unit/repeat-change.test.ts
- **Phase 2.3: "x register prefix ("ayy, "ap, "Ayy append, 3"ayw count)** — implemented: src/tlisp/core/commands/operators.tlisp:357-461 (vim-register-prefix-pending-p through vim-maybe-apply-register); key-bind at operators.tlisp:461
- **Phase 2.4: OS clipboard bridge for + and * registers (pbcopy/pbpaste, xclip, clip)** — missing: No src/editor/api/clipboard-ops.ts or register-ops.ts file; "+y/"*y write to in-memory registers only via existing evil-integration.ts path
- **Phase 3.A: W B E WORD (whitespace-only) motions** — implemented: src/tlisp/core/bindings/normal.tlisp:85-87 (key-bind W/B/E → word-next-WORD/word-previous-WORD/word-end-WORD)
- **Phase 3.B: ge gE backward word-end motions** — implemented: src/tlisp/core/commands/motions.tlisp:190-191 (key-bind g e / g E → word-previous-end/word-previous-end-WORD)
- **Phase 3.C: ( ) sentence motions** — missing: Grep for 'sentence|\( \)' across src/tlisp/core returns no motion bindings
- **Phase 3.D: [[ ]] [] ][ section motions** — missing: Grep for 'section|\[\[|\]\]' across src/tlisp/core/commands returns no bindings (only markdown-mode-specific [ H / ] H)
- **Phase 3.E: H M L window-relative motions** — missing: No H/M/L motion bindings in src/tlisp/core/bindings/normal.tlisp or motions.tlisp
- **Phase 3.F: C-e C-y single-line scroll** — missing: No C-e/C-y bindings in normal.tlisp; motions.tlisp has no scroll-line function
- **Phase 3.G: gj gk g_ screen-line motions** — missing: No gj/gk/g_ bindings in normal.tlisp or motions.tlisp
- **Phase 4.A: m ' ` marks (buffer-local)** — implemented: src/tlisp/core/commands/marks.tlisp:52-84 (vim-mark-set/get/jump); marks.tlisp:97-99 bindings; test/unit/marks.test.ts
- **Phase 4.B: :marks Ex command listing** — missing: Grep for 'marks' in src/editor/api/bindings-ops.ts editor-execute-command-line returns no :marks branch
- **Phase 4.C: Special marks '< '> '[ '] '^ .** — missing: src/tlisp/core/commands/marks.tlisp has no special-mark handling; grep for '<|'>|^[|]|\^|\. in marks.tlisp returns no auto-set marks
- **Phase 4.D: Global marks mA cross-buffer** — missing: src/tlisp/core/commands/marks.tlisp:52-66 vim-mark-set stores into a single alist with no uppercase/global distinction; no buffer-id field
- **Phase 4.E: C-o / C-i jumplist navigation** — implemented: src/tlisp/core/commands/jumplist.tlisp:68-100 (vim-jump-back, vim-jump-forward, key-bind C-o/C-i); test/unit/jumplist.test.ts
- **Phase 4.F: Jumplist push hooks on gg/G/n/N/*/#/%** — partial: jumplist.tlisp exports vim-jump-record but no explicit cap at 100 entries (Open Question #6 unresolved)
- **Phase 5.A: >> << line indent/outdent** — implemented: src/tlisp/core/commands/indent-ops.tlisp:77-117 (vim-indent-line, vim-outdent-line); indent-ops.tlisp:125-126 bindings
- **Phase 5.B: > < operator+motion forms (>w, >j, >k)** — missing: src/tlisp/core/commands/indent-ops.tlisp:5-8 comment: 'Operator+motion forms (guw, gU$, etc.) are deferred to a follow-up slice per spec Phase 5.B'
- **Phase 5.C: Visual mode > < ~ gu gU g~** — missing: src/tlisp/core/bindings/visual.tlisp:1-52 contains no indent/case operator bindings; only legacy u/U direct case bindings exist
- **Phase 5.D: guu gUU g~~ line-scoped case operators** — implemented: src/tlisp/core/commands/indent-ops.tlisp:56-66 (vim-toggle-case-line, vim-lowercase-line, vim-uppercase-line); indent-ops.tlisp:127-129 bindings
- **Phase 5.E: ~ toggle case of char under cursor** — implemented: src/tlisp/core/commands/indent-ops.tlisp:22-37 (vim-toggle-case-char); indent-ops.tlisp:124 binding
- **Phase 5.F: = reindent operator deferred unless addendum defines language support** — implemented: Correctly deferred per spec — no = operator in normal.tlisp
- **Acceptance Criterion 6: No regressions; all existing tmax-use playbooks + unit tests + typecheck pass** — implemented: Gate results reported: typecheck:src PASS, test:unit PASS, test:tmax-use PASS
- **Acceptance Criterion 7: No TS violations — src/editor/handlers/* and src/editor/api/* contain no new editor decisions** — implemented: src/editor/handlers/normal-handler.ts:44-270 routes keys via T-Lisp primitives (macro-record-pending-p, vim-register-prefix-pending-p, etc.) without inspecting semantics; operators.tlisp owns all combo decisions

### Tests
- **diw deletes inner word and yanks to "** — covered: test/unit/operator-text-object.test.ts (existing SPEC-044 Phase 1.A coverage referenced in spec); tmax-use/playbooks/eval-19-vim-text-objects.yaml
- **daw deletes word + trailing whitespace** — covered: test/unit/operator-text-object.test.ts exercises delete-around-word via operator+text-object dispatch
- **ci" enters insert mode with quote contents removed** — covered: src/tlisp/core/commands/operators.tlisp:203 (change-inner-double-quote) + test/unit/operator-text-object.test.ts
- **dat deletes around tag (opening + closing)** — covered: src/tlisp/core/commands/operators.tlisp:202 + src/editor/api/text-objects-ops.ts:656-668
- **d2iw count multiplier** — covered: optionalCount in src/editor/api/text-objects-ops.ts:699-705 passes count through; operator count × motion count in operators.tlisp:165
- **u after diw restores text + cursor (undo bookend)** — covered: undo-begin/undo-commit bookends in operators.tlisp:183,218 + replace-mode.test.ts:68-73 proves the round-trip pattern
- **M-y yank-pop after dd cycles numbered delete registers** — uncovered: No explicit yank-pop-after-text-object test found in test/unit/
- **/foo<CR> moves to next match and highlights all** — covered: tmax-use/playbooks/eval-20-vim-search.yaml; test/unit/incremental-search.test.ts
- **n advances to next match; N reverses; wrap-around** — covered: test/unit/search-navigation.test.ts (referenced in spec validation list)
- **:nohl clears highlights; n still works** — uncovered: src/editor/api/search-ops.ts:452-461 comment confirms pattern retained; no dedicated :nohl test located
- **qa<keys>q records; @a plays; @@ replays; persists across restart** — covered: test/unit/macro-recording.test.ts, macro-persistence.test.ts, macros.test.ts; tmax-use/playbooks/eval-21-vim-macros.yaml
- **Recorded macro does NOT include the stopping q key (Prove-It pattern)** — covered: src/editor/handlers/normal-handler.ts:163-168 special-cases the stopping q before the record hook at line 233
- **rx overwrites char; 3rx overwrites 3 chars; r<Esc> cancels** — covered: test/unit/replace-mode.test.ts:29-66
- **R enters replace mode; typed chars overwrite; Backspace restores; Escape exits** — uncovered: R mode not implemented; test/unit/replace-mode.test.ts has no R-mode tests
- **dw. deletes next word; dd. deletes line; ihi<Esc>. re-inserts; 5. count override** — uncovered: `.` repeat not implemented; no test/unit/repeat-change.test.ts file
- **"ayy yanks into a; "ap pastes from a; "Ayy appends** — uncovered: No dedicated unit test for register-prefix flow located in test/unit/ (feature wired in operators.tlisp:357-461 but no named test)
- **"+yy / "+p OS clipboard round-trip (pbcopy/pbpaste)** — uncovered: Phase 2.4 not implemented; no clipboard test
- **ma sets mark; 'a jumps to line; `a jumps to exact col** — covered: test/unit/marks.test.ts:31-50+ (vim-mark-set/vim-mark-get round-trip)
- **mA global mark survives buffer switch** — uncovered: Global marks not implemented
- **:marks lists all set marks** — uncovered: :marks Ex command not implemented
- **G C-o returns to prior position; C-i redoes** — covered: test/unit/jumplist.test.ts (per spec test list)
- **>> indents current line; << outdents; guu lowercases; gUU uppercases; ~ toggles char** — covered: test/unit/indent-ops.test.ts (per spec test list); indent-ops.tlisp:77-117 + 22-37
- **> in visual indents selection** — uncovered: Visual-mode indent/case bindings not implemented
- **>w / gu$ operator+motion forms** — uncovered: indent-ops.tlisp:5-8 explicitly defers operator+motion forms
- **W/B/E WORD motions; ge/gE backward word-end** — covered: test/unit/word-navigation.test.ts (extended per spec)
- **( ) sentence motions; [[ ]] section motions** — uncovered: Sentence/section motions not implemented
- **H/M/L/C-e/C-y/gj/gk/g_ motions** — uncovered: None of these motions are bound in normal.tlisp or motions.tlisp

### Edge cases
- **Empty buffer: diw/cw/> > should no-op (not crash)** — handled: src/editor/api/text-objects-ops.ts:68-70,89-91 etc. return Either.right(createNil()) when buffer is null
- **Single-line buffer: motions at boundaries no-op gracefully** — missed: No explicit test for [[/]]/(/) at boundaries; also the underlying motions are not implemented
- **Wrapped lines: gj/gk by screen row, j/k by logical line** — missed: gj/gk not implemented; spec Edge Case explicitly calls for verifying against a 200-col line in 80-col terminal
- **Multibyte/emoji: r<char> and ~ treat emoji as one cell (BUG-09)** — missed: vim-replace-apply uses buffer-replace-range which respects existing primitives; no explicit emoji test in replace-mode.test.ts
- **Zero-count operator: 0d is the 0 motion (to column 0), not a 0-count operator** — handled: src/editor/handlers/normal-handler.ts:185-192 digit 0 only feeds count when vim-count-active-p is true
- **Mark in deleted region: 'a lands on next existing line at or below** — missed: src/tlisp/core/commands/marks.tlisp:69-84 vim-mark-jump has no adjustment for deleted-line clamp
- **Jumplist overflow cap at 100 entries (vim default)** — missed: src/tlisp/core/commands/jumplist.tlisp has no cap; Open Question #6 unresolved; grep for '100|max|cap' in jumplist.tlisp returns only pointer arithmetic
- **Replace mode over EOL: R extends line (insert semantics past EOL)** — missed: R mode not implemented; cannot satisfy this edge case
- **@ on empty register: @z warns via *Messages* and does not crash** — missed: src/tlisp/core/commands/macros.tlisp:107-127 macro-dispatch-play falls through to cancel for non-register keys, but no explicit @<unrecorded-reg> warning path
- **/ with no matches: clear minibuffer, show 'Pattern not found', cursor unchanged** — missed: search-incremental-* primitives (referenced in isearch.tlisp) handle the no-match case per existing search-ops.ts behavior; no explicit test cited
- **Daemon restart between TS-touching phases** — handled: Memory feedback_daemon-restart-after-code-change.md applied; CI now uses test:tmax-use per .github/workflows/ci.yml diff
- **Register " collision: " followed by register letter vs. lone "** — handled: src/tlisp/core/commands/operators.tlisp:405-426 vim-dispatch-register treats \" as a valid register letter; the pending-state machine disambiguates
- **`.` after yank should NOT replay yanks (yank isn't a change)** — missed: `.` not implemented; this invariant cannot be violated or verified
- **Unnamed register rule: y writes " and 0; d/c/x rotate numbered 1-9** — missed: operators.tlisp uses set-register \" for the unnamed register on all mutations, but no test verifies the yank→0 vs delete→1-9 rotation
- **Visual-mode text objects are a different code path (viw expands selection)** — missed: No visual text-object bindings in src/tlisp/core/bindings/visual.tlisp; spec marks this as separate Step 5.x concern and it is not implemented
- **@ replay while recording: append macro's keys to current recording (vim quirk)** — missed: macros.tlisp comment mentions it; no implementation for append-during-record behavior
- **q<invalid> cancels pending with warning and does not record** — handled: src/tlisp/core/commands/macros.tlisp:101-105 (t branch: vim-reset-macro-pending + editor-set-status 'Macro record cancelled')


## Audit findings (adw-patch-review 2026-06-22T00:50:28.381Z)

**Verdict:** gaps

Phase 1 (Tier-A wiring) is fully landed and verified — text objects, search bindings, :nohl, macros (q/@/@@), and the critical macro-record-key hook are all wired through normal-handler.ts. Phase 2 is now mostly complete: r{char} and R replace mode (Strategy A — 'replace' IS in mode-ops.ts:72), the \"x register prefix, and the OS clipboard bridge (clipboard-ops.ts + operators.tlisp:446-448 for set, edit-commands.tlisp:53-81 for get) have all shipped since the prior audit. Phase 3 ships W/B/E, ge/gE, sentence ( ), section [[ ]], H/M/L, and C-e/C-y — but Phase 3.G (gj/gk/g_) and the []/][ section variants are absent. Phase 4 ships buffer-local marks + :marks + jumplist with the 100-entry cap (Open Question #6 resolved), but global marks (mA) and special marks auto-set ('< '> '[ '] '^ .) are still missing — only the vim-mark-set-special primitive exists with no callers. Phase 5 ships line-scoped ops (>>, <<, ~, guu, gUU, g~~) and visual-mode >/</~ — but operator+motion forms (Phase 5.B) and visual-mode gu/gU/g~ are still deferred. The single largest gap is Phase 2.2 (. repeat) — no repeat.tlisp exists, no vim-record-change/vim-repeat-last-change function, no . binding. Test coverage matches: Phase 1 tests comprehensive; replace-mode.test.ts covers r and R; clipboard-ops.test.ts covers round-trip; indent-ops.test.ts covers Phase 5.A/C/D/E; but no test/unit/repeat-change.test.ts and no dedicated sentence/section/H/M/L/C-e/C-y motion tests.

### Criteria
- **Phase 1.1: diw/daw/ciw/caw/ci"/ca{/dat text-object dispatch via operator+text-object** — implemented: src/tlisp/core/commands/operators.tlisp:170-220 (vim-operator-apply-text-object); src/editor/api/text-objects-ops.ts:66-689 (21 primitives incl. around brace/bracket/angle/tag + change variants); test/unit/operator-text-object.test.ts
- **Phase 1.1: Count multiplier d2iw (existing vim-operator-total-count formula)** — implemented: src/tlisp/core/commands/operators.tlisp:160-166 (vim-operator-begin-text-object multiplies operator-count × motion-count); optionalCount in text-objects-ops.ts:699-705
- **Phase 1.1: undo bookend + set-register on text-object mutations (SPEC-041 pattern)** — implemented: src/tlisp/core/commands/operators.tlisp:183,218 ((if (string= operator "y") nil (undo-begin)) … (undo-commit combo)); set-register at :219
- **Phase 1.2: / ? n N normal-mode bindings** — implemented: src/tlisp/core/commands/isearch.tlisp:34-37 (key-bind / ? n N)
- **Phase 1.2: :nohl/:noh Ex command clears highlights without clearing pattern** — implemented: src/editor/api/bindings-ops.ts:113-119 (nohl/noh branch calls clearSearchHighlights only); test/unit/search-navigation.test.ts:232-265
- **Phase 1.3: q<reg> record / q stop / @<reg> play / @@ replay** — implemented: src/tlisp/core/commands/macros.tlisp:40-127 + bindings :132-133
- **Phase 1.3: macro-record-key hook in normal-handler.ts (CRITICAL gap from v3 review)** — implemented: src/editor/handlers/normal-handler.ts:89-95,121-124,131-134,141-144,151-154,233-235 — macro-record-key called before bound command across all pending routes + final keymap execute
- **Phase 1.3: q<Esc>/q<C-g> cancel pending and quit** — implemented: src/tlisp/core/commands/macros.tlisp:95-100 (cond branch on Escape/C-g calls editor-quit); test/unit/macros.test.ts
- **Phase 2.A Strategy A: 'replace' added to EditorMode union (5 sites)** — implemented: src/editor/api/mode-ops.ts:38,39,72,83 — getMode/setMode signatures and validModes array now include 'replace'
- **Phase 2.B: r{char} two-key replace (count-aware, undo bookend)** — implemented: src/tlisp/core/commands/vim-replace.tlisp:23-62 (vim-replace-begin/apply with undo-begin/undo-commit + count clamp + r<Enter> newline split); test/unit/replace-mode.test.ts:29-82
- **Phase 2.C: R replace mode (typed chars overwrite, Backspace restores, Escape exits)** — implemented: src/tlisp/core/commands/vim-replace.tlisp:78-102 (vim-replace-mode-enter opens undo-begin, vim-replace-mode-insert-char overwrites or appends); src/editor/handlers/replace-handler.ts:14-78 (Escape commits undo + Backspace moves cursor); test/unit/replace-mode.test.ts:84-118
- **Phase 2.2: . repeat last change (vim-record-change recorder + replay)** — missing: No src/tlisp/core/commands/repeat.tlisp file exists; no vim-record-change/vim-repeat-last-change function; no key-bind for "." in src/tlisp/core; no test/unit/repeat-change.test.ts
- **Phase 2.3: "x register prefix ("ayy, "ap, "Ayy append, 3"ayw count)** — implemented: src/tlisp/core/commands/operators.tlisp:357-469 (vim-register-prefix-pending-p through vim-maybe-apply-register); key-bind at :469; vim-valid-register-p at :380-387 includes a-z/A-Z/0-9/*/+
- **Phase 2.4: OS clipboard bridge for + and * registers (pbcopy/pbpaste, xclip, clip)** — implemented: src/editor/api/clipboard-ops.ts:99-153 (clipboardSet/clipboardGet with platform detection); src/tlisp/core/commands/operators.tlisp:446-448 (clipboard-set when register is + or *); src/tlisp/core/commands/edit-commands.tlisp:53-81 (clipboard-get on paste from +/*); test/unit/clipboard-ops.test.ts
- **Phase 3.A: W B E WORD (whitespace-only) motions** — implemented: src/tlisp/core/bindings/normal.tlisp:85-87 (key-bind W/B/E → word-next-WORD/word-previous-WORD/word-end-WORD); test/unit/word-navigation.test.ts:372+
- **Phase 3.B: ge gE backward word-end motions** — implemented: src/tlisp/core/commands/motions.tlisp:435-436 (key-bind g e / g E)
- **Phase 3.C: ( ) sentence motions** — implemented: src/tlisp/core/commands/motions.tlisp:240-337 (vim-sentence-next/previous + scan helpers); bindings at :439-440
- **Phase 3.D: [[ ]] section motions (also [] ][ per AC#3)** — partial: src/tlisp/core/commands/motions.tlisp:341-412 implements vim-section-previous/vim-section-next only; bindings :441-442 cover only [[ and ]]; [] and ][ (section-end variants) are NOT implemented
- **Phase 3.E: H M L window-relative motions** — implemented: src/tlisp/core/commands/motions.tlisp:170-202 (vim-window-top/middle/bottom); bindings :443-445
- **Phase 3.F: C-e C-y single-line scroll** — implemented: src/tlisp/core/commands/motions.tlisp:204-239 (vim-scroll-line-down/up); bindings :446-447
- **Phase 3.G: gj gk g_ screen-line motions** — missing: No gj/gk/g_ bindings in src/tlisp/core/bindings/normal.tlisp or motions.tlisp; grep returns zero matches
- **Phase 4.A: m ' ` marks (buffer-local)** — implemented: src/tlisp/core/commands/marks.tlisp:18-96 (vim-mark-begin-set/jump-line/jump-exact + dispatch); bindings :134-136; test/unit/marks.test.ts
- **Phase 4.B: :marks Ex command listing** — implemented: src/editor/api/bindings-ops.ts:120-137 (evaluates (vim-marks-format) and logs to *Messages*); src/tlisp/core/commands/marks.tlisp:106-132 (vim-marks-list/format)
- **Phase 4.C: Special marks '< '> '[ '] '^ . (auto-set)** — missing: src/tlisp/core/commands/marks.tlisp:98-104 defines vim-mark-set-special primitive but grep finds no caller in src/tlisp/core/commands/ — operators/edit-commands/insert-entries do NOT invoke it; the special marks are never auto-populated
- **Phase 4.D: Global marks mA cross-buffer** — missing: src/tlisp/core/commands/marks.tlisp:53-57 stores all marks into a single alist with no uppercase/global distinction and no buffer-id field; grep for 'uppercase|buffer-id|global|cross-buffer' returns no matches
- **Phase 4.E: C-o / C-i jumplist navigation** — implemented: src/tlisp/core/commands/jumplist.tlisp:67-120 (vim-jump-record/back/forward); bindings :122-123; test/unit/jumplist.test.ts
- **Phase 4.F: Jumplist push hooks on gg/G/n/N/*/#/% + 100-entry cap** — implemented: src/tlisp/core/commands/jumplist.tlisp:31-39,67-78 (vim-jump-cap-value=100, vim-jump-drop-oldest trims to cap); Open Question #6 resolved
- **Phase 5.A: >> << line indent/outdent** — implemented: src/tlisp/core/commands/indent-ops.tlisp:78-118 (vim-indent-line/vim-outdent-line); bindings :214-215; test/unit/indent-ops.test.ts:55-91
- **Phase 5.B: > < operator+motion forms (>w, >j, gu$)** — missing: src/tlisp/core/commands/indent-ops.tlisp:5-8 comment: 'Operator+motion forms (guw, gU$, etc.) are deferred to a follow-up slice per spec Phase 5.B'
- **Phase 5.C: Visual mode > < ~ gu gU g~** — partial: src/tlisp/core/commands/indent-ops.tlisp:126-207 implements vim-visual-indent/outdent/toggle-case only; bindings :220-222 wire visual >, <, ~. Visual-mode gu/gU/g~ are NOT implemented
- **Phase 5.D: guu gUU g~~ line-scoped case operators** — implemented: src/tlisp/core/commands/indent-ops.tlisp:40-67 (vim-transform-line for downcase/upcase/toggle); bindings :216-218; test/unit/indent-ops.test.ts:92-114
- **Phase 5.E: ~ toggle case of char under cursor** — implemented: src/tlisp/core/commands/indent-ops.tlisp:23-38 (vim-toggle-case-char with count + undo bookend); binding :213; test/unit/indent-ops.test.ts:31-54
- **Phase 5.F: = reindent operator deferred unless addendum defines language support** — implemented: Correctly deferred — no = operator in normal.tlisp or motions.tlisp
- **Acceptance Criterion 6: No regressions; all existing tmax-use playbooks + unit tests + typecheck pass** — implemented: Gate results reported: typecheck:src PASS, test:unit PASS, test:tmax-use PASS
- **Acceptance Criterion 7: No TS violations — src/editor/handlers/* and src/editor/api/* contain no new editor decisions** — implemented: src/editor/handlers/normal-handler.ts:44-270 routes keys via T-Lisp primitives (macro-record-pending-p, vim-register-prefix-pending-p, vim-replace-char-pending-p, etc.) without inspecting semantics; src/editor/handlers/replace-handler.ts:14-78 mirrors insert-handler shape (routes only); clipboard-ops.ts:119-153 is pure primitive
- **Acceptance Criterion 8: Memory compliance — daemon restarted before UI verification; visual fixes verified in live system** — implemented: .github/workflows/ci.yml updated to use test:tmax-use; CLAUDE.md §8 now requires bun run test:tmax-use for e2e validation

### Tests
- **diw/daw/ci"/ca{/dat text-object operations delete/change expected region and yank to "** — covered: test/unit/operator-text-object.test.ts (existing SPEC-044 Phase 1.A coverage referenced in spec); tmax-use/playbooks/eval-19-vim-text-objects.yaml
- **d2iw count multiplier** — covered: operators.tlisp:160-166 count×motion-count; operator-text-object.test.ts; optionalCount in text-objects-ops.ts:699-705
- **u after diw restores text + cursor (undo bookend)** — covered: undo-begin/undo-commit at operators.tlisp:183,218; replace-mode.test.ts:68-73 proves the round-trip pattern
- **M-y yank-pop after dd cycles numbered delete registers** — uncovered: No explicit yank-pop-after-text-object test in test/unit/; operators.tlisp calls (set-register "\"") directly (line 136) bypassing registerDelete's 1-9 rotation in evil-integration.ts:188
- **/foo<CR> moves to next match and highlights all** — covered: tmax-use/playbooks/eval-20-vim-search.yaml; test/unit/incremental-search.test.ts
- **n advances to next match; N reverses; wrap-around** — covered: test/unit/search-navigation.test.ts
- **:nohl clears highlights without clearing pattern; n still works** — covered: test/unit/search-navigation.test.ts:232-265 (Phase 1.E :nohl and :noh alias tests)
- **qa<keys>q records; @a plays; @@ replays; persists across restart** — covered: test/unit/macro-recording.test.ts, macro-persistence.test.ts, macros.test.ts; tmax-use/playbooks/eval-21-vim-macros.yaml
- **Recorded macro does NOT include the stopping q key (Prove-It pattern)** — covered: src/editor/handlers/normal-handler.ts:163-168 special-cases the stopping q before the record hook at line 233
- **rx overwrites char; 3rx overwrites 3 chars; r<Esc> cancels** — covered: test/unit/replace-mode.test.ts:29-82 (Phase 2.B tests)
- **R enters replace mode; typed chars overwrite; Backspace restores; Escape exits** — covered: test/unit/replace-mode.test.ts:84-118 (Phase 2.C tests including R past EOL appends, single-undo session)
- **dw. deletes next word; dd. deletes line; ihi<Esc>. re-inserts; 5. count override** — uncovered: . repeat NOT implemented — no test/unit/repeat-change.test.ts file exists
- **"ayy yanks into a; "ap pastes from a; "Ayy appends** — uncovered: Feature wired in operators.tlisp:357-469 but no dedicated unit test for the register-prefix flow located in test/unit/
- **"+yy / "+p OS clipboard round-trip (pbcopy/pbpaste)** — covered: test/unit/clipboard-ops.test.ts:15-37 (clipboard-set/clipboard-get round-trip + multi-line + empty)
- **ma sets mark; 'a jumps to line; `a jumps to exact col** — covered: test/unit/marks.test.ts:31-150 (set/get round-trip, exact jump, line jump, pending state machine, clear, unset)
- **mA global mark survives buffer switch** — uncovered: Global marks NOT implemented; no uppercase/cross-buffer logic in marks.tlisp
- **:marks lists all set marks** — uncovered: vim-marks-format function exists at marks.tlisp:129; bindings-ops.ts:120-137 wires it; no explicit test for :marks command execution in test/unit/
- **G C-o returns to prior position; C-i redoes** — covered: test/unit/jumplist.test.ts:31-132 (record, back, forward, truncate, clear)
- **Jumplist overflow cap at 100 entries** — uncovered: Implementation exists (jumplist.tlisp:31-39 vim-jump-cap-set, vim-jump-drop-oldest at line 41-45) but no explicit cap test in test/unit/jumplist.test.ts
- **>> indents current line; << outdents; guu lowercases; gUU uppercases; ~ toggles char** — covered: test/unit/indent-ops.test.ts:31-184 (Phase 5.A/D/E/C with count, undo bookend, edge cases)
- **> in visual indents selection** — covered: test/unit/indent-ops.test.ts:135-184 (Phase 5.C visual >, <, ~ with undo)
- **>w / gu$ operator+motion forms** — uncovered: indent-ops.tlisp:5-8 explicitly defers operator+motion forms — no tests, no implementation
- **W/B/E WORD motions; ge/gE backward word-end** — covered: test/unit/word-navigation.test.ts:372+ (Phase 3.A WORD motion tests with count and punctuation clusters)
- **( ) sentence motions** — uncovered: Implementation exists at motions.tlisp:240-337 with bindings at :439-440; no dedicated sentence motion tests in test/unit/
- **[[ ]] section motions** — uncovered: Implementation exists at motions.tlisp:341-412 with bindings at :441-442; no dedicated section motion tests in test/unit/
- **H/M/L/C-e/C-y window-relative and scroll motions** — uncovered: Implementation exists at motions.tlisp:170-235 with bindings at :443-447; no dedicated H/M/L or C-e/C-y motion tests in test/unit/
- **gj/gk/g_ screen-line motions** — uncovered: Feature NOT implemented; no bindings, no primitive, no test

### Edge cases
- **Empty buffer: diw/cw/>> no-op (not crash)** — handled: src/editor/api/text-objects-ops.ts returns Either.right(createNil()) on null buffer; >> with end<=start loops zero times (indent-ops.tlisp:82)
- **Single-line buffer: motions at boundaries no-op gracefully** — missed: WORD motions bound; sentence/section scan loops guard at boundaries (motions.tlisp:290-337). No explicit test exercising [[/]]/(/) at boundaries in test/unit/
- **Wrapped lines: gj/gk by screen row, j/k by logical line** — missed: gj/gk not implemented (no bindings in motions.tlisp or normal.tlisp); spec explicitly calls for verifying against 200-col line in 80-col terminal
- **Multibyte/emoji: r<char> and ~ treat emoji as one cell (BUG-09)** — missed: vim-replace-apply uses buffer-replace-range which respects existing primitives; no explicit emoji test in test/unit/replace-mode.test.ts:29-114
- **Zero-count operator: 0d is the 0 motion (not 0-count operator)** — handled: src/editor/handlers/normal-handler.ts:189-192 — digit 0 only feeds count when vim-count-active-p is true
- **Mark in deleted region: 'a lands on next existing line at or below** — missed: src/tlisp/core/commands/marks.tlisp:70-85 vim-mark-jump clamps to stored line/col with no adjustment if the line was deleted
- **Jumplist overflow cap at 100 entries (vim default)** — handled: src/tlisp/core/commands/jumplist.tlisp:31-39,67-78 — vim-jump-cap-value=100, vim-jump-drop-oldest trims to cap. Test coverage: no explicit cap test in test/unit/jumplist.test.ts
- **Replace mode over EOL: R extends line (insert semantics past EOL)** — handled: src/tlisp/core/commands/vim-replace.tlisp:94-100 vim-replace-mode-insert-char calls buffer-insert when col>=len; test/unit/replace-mode.test.ts:99 'R-mode typing past EOL appends'
- **@ on empty register: @z warns via *Messages* and does not crash** — handled: src/editor/editor.ts:1467-1469 throws 'No macro in register ${register}' — caught by executeCommand and surfaced as statusMessage, not a deliberate warn to *Messages*
- **/ with no matches: clear minibuffer, show 'Pattern not found', cursor unchanged** — missed: No explicit test cited; search-incremental-* primitives handle the case per existing behavior but no named test verifies status message + cursor unchanged
- **Daemon restart between TS-touching phases** — handled: memory feedback_daemon-restart-after-code-change.md applied; CI uses test:tmax-use per .github/workflows/ci.yml diff
- **Register " collision: " followed by register letter vs. lone "** — handled: src/tlisp/core/commands/operators.tlisp:386-388 vim-valid-register-p includes \"; vim-dispatch-register disambiguates via pending state
- **. after yank should NOT replay yanks (yank isn't a change)** — missed: . repeat not implemented; this invariant cannot be violated or verified (no repeat.tlisp, no test)
- **Unnamed register rule: y writes " and 0; d/c/x rotate numbered 1-9** — missed: Rotation primitives registerYank/registerDelete exist (evil-integration.ts:169,188) but operators.tlisp:136,139,256,262,266 calls (set-register "\"" ...) directly, bypassing rotation for T-Lisp-side text-object operations. No test verifies yank→0 vs delete→1-9 rotation end-to-end
- **Visual-mode text objects are a different code path (viw expands selection)** — missed: No visual text-object bindings in src/tlisp/core/bindings/visual.tlisp; spec marks this as separate Step 5.x concern
- **@ replay while recording: append macro's keys to current recording (vim quirk)** — missed: macros.tlisp comment mentions it but no implementation for append-during-record behavior
- **q<invalid> cancels pending with warning and does not record** — handled: src/tlisp/core/commands/macros.tlisp:101-105 — t branch calls vim-reset-macro-pending + editor-set-status 'Macro record cancelled'

