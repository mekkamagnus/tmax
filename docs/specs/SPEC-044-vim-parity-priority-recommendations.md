# Feature: Vim Parity — Remaining Priority Cleanup Slice

> **⚠️ SUPERSEDED by [SPEC-067](SPEC-067-vim-parity-implementation.md).** This spec was rejected by spec-review as a non-implementable retrospective roadmap ("not a clean implementation spec ... stale repository assumptions ... cites removed validation infrastructure"). It is kept as a historical document. SPEC-067 is the forward-looking implementation spec that replaces it.

**Document status:** executable implementation spec for the remaining SPEC-044 cleanup slice. Historical roadmap and audit material is retained only as non-authoritative context in the marked appendix; implementers must follow the current-scope sections, current file table, acceptance criteria, and validation commands below.

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
3. **The daemon caches T-Lisp files at startup.** Based on memory `feedback_daemon-restart-after-code-change.md`. Treat daemon restart as required before live-keypath validation after source changes.
4. **Replace mode, macro recording, clipboard support, and repeat-change files exist in the current repo.** Do not create replacement files for these features; extend only the remaining gaps identified below.
5. **Register semantics are not satisfied by raw `(set-register "\"" text)` for default yank/delete paths.** Yank behavior must write the unnamed register, yank register `0`, and kill ring; delete/change behavior must write the unnamed register and kill ring, and line deletes must rotate numbered registers `1-9`.
6. **Line anchors in older audits are stale.** Use symbol/function names and a fresh `rg` inventory before editing.
7. **The 11 priority recommendations are historical roadmap candidates, not the current implementation batch.** Current scope is the remaining cleanup checklist in this spec.

→ Correct any of these now. The rest of the spec proceeds with them as given.

### Historical Plan Review Notes (non-authoritative)

These notes are retained to explain why earlier wording changed. They include stale file-status and line-anchor claims from older inventories; do not use them as implementation instructions. Current source inventory, Relevant Files, Acceptance Criteria, and Validation Commands below are authoritative.

| # | Claim in v0/v1 | Verified against source | Correction applied |
|---|---|---|---|
| 1 | Ex command table lives in `commands/command-handler.ts` | Actually in `src/editor/api/bindings-ops.ts:56-128` (`editor-execute-command-line`) | Step 1.2, Step 5 references updated |
| 2 | `search-next` / `search-previous` would need T-Lisp wrappers | Already T-Lisp-callable: `search-ops.ts:343` and `:376` expose them via `api.set` | Step 1.2 simplified — direct bindings work |
| 3 | Mode union is at `mode-ops.ts:72` only | The union is duplicated: `mode-ops.ts:39` (function signature) and `:72` (validation array). Both need `'replace'`. Also check `bindings-ops.ts:33-34` for the same union | Step 2.1 enumerates all three sites |
| 4 | Text-object primitive names are camelCase (`deleteInnerWord`) | T-Lisp exposure is kebab-case: `delete-inner-word` at `text-objects-ops.ts:46` | Step 1.1 Lisp names corrected |
| 5 | Text-object dispatch "follows the SPEC-041 stash pattern" | SPEC-041's `vim-operator-apply-find` wraps mutations in `(undo-begin)` / `(undo-commit combo)`. Register writes must go through yank/delete-aware register semantics, not only raw `(set-register "\"" text)`, so yank goes to `0` and line deletes rotate `1-9`. | Step 1.1 MUST list updated with explicit undo/register requirements |
| 6 | "Phase 5 indentation logic — find it (`grep -r "indent"`)" | Already exists: `src/tlisp/core/commands/indent.tlisp` exports `indent-current-line` and `indent-region`. Phase 5's `=` is mostly wrapping existing logic | Step 5.1 rewritten to lean on existing module |
| 7 | `q` rebinding glossed over as "dispatcher checks next key" | Reading the next key requires either `(read-key)` primitive or a new transient pending state — both are non-trivial and need explicit design | Step 1.3 design fleshed out with two options |
| 8 | `@` register-name reading not described | Same problem as #7 — needs `(read-key)` or a transient state | Step 1.3 updated |
| 9 | New T-Lisp files only need `(provide "name")` | Each new `commands/*.tlisp` must ALSO be added to the load list wherever existing libraries are required (find via `grep "commands/windows" src/`) | New Files table + Phase 1.3 MUST list updated |
| 10 | Visual-mode text objects (`iw`, `i"` in visual) described as "visual bindings only" | Visual text objects are NOT operator-pending — they expand the current selection. Different code path from normal-mode `diw`. | Step 1.1 visual section split out; visual-block `I`/`A`/`r` is deferred to a proposed visual-block follow-up |
| 11 (v2, refreshed) | "Cover ALL existing primitives in `text-objects.ts`" — v1 listed 24+ variants | `text-objects-ops.ts` now exposes 21 T-Lisp primitives, including `change-inner-word`, `change-around-word`, quote deletes, and around paren. Remaining missing exposed variants are narrower: around brace/bracket/angle/tag delete/change, plus inner bracket/angle/tag change if supported by `text-objects.ts`. | Step 1.1 scope updated: Phase 1.A dispatch/tests already exist; Phase 1.B should verify current gaps and add only missing primitives, not rebuild text-object dispatch from scratch |
| 12 (v2) | Text-object dispatch insertion point: "after the line-operator cases but before the 'Unsupported operator' fallthrough at operators.tlisp:203" | **Wrong location.** Line 203 is in `vim-operator-apply`. The key-dispatch entry is `vim-dispatch-operator-key` at line 207; its final fallthrough at line 230 `(vim-operator-apply key)` sends `i`/`a` straight to operator-apply. The text-object branch must intercept BEFORE line 230, alongside the existing `g`-pending (lines 209-218) and `f`/`t`/`F`/`T` (lines 228-229) checks. | Step 1.1 insertion-point MUST updated |
| 13 (v2) | Step 1.3 macros: "Do not touch handlers — MUST NOT modify `src/editor/handlers/*.ts`" | **Partially incorrect.** The macro API is exposed via `editor.ts` as `macro-record-start`, `macro-record-stop`, `macro-record-key`, `macro-record-active`, `macro-record-register`, `macro-execute`, and `macro-execute-last`. But `grep -rn "recordKey\|macro-record" src/editor/handlers/` returns ZERO matches — no handler calls `macro-record-key`. **Recording captures nothing today.** | Step 1.3 MUST list updated: macro recording requires a normal-handler hook, not just `q` binding |
| 14 (v2) | Validation command `python3 test/ui/tmax_harness/runner.py` | **`runner.py` does NOT exist.** `test/ui/tmax_harness/` contains library modules (`harness.py`, `client.py`, etc.) but no runner. Current package validation uses `test:unit`, `test:tmax-use`, typecheck, and build gates; do not cite removed `test:ui:*` scripts. | Validation Commands section fixed |
| 15 (v2) | Validation command `tmax --stop` | Assumes `tmax` is on PATH. The local binary is `bin/tmax` (also `bin/tmaxclient`). For development verification use `bin/tmax --stop` or `bun run daemon` + Ctrl-C. | Validation Commands section updated |
| 16 (v2, refreshed) | New tests "see Testing Strategy" | Existing test files relevant to each phase include `test/unit/operator-text-object.test.ts`, `test/unit/operator-find-char.test.ts`, `test/unit/macro-recording.test.ts`, `test/unit/macro-persistence.test.ts`, `test/unit/macros.test.ts`, `test/unit/incremental-search.test.ts`, `test/unit/search-navigation.test.ts`, `test/unit/vim-dispatch.test.ts`, `test/unit/yank-operator.test.ts`, `test/unit/change-operator.test.ts`, `test/unit/delete-operator.test.ts`, `test/unit/repeat-change.test.ts`, `test/unit/register-prefix.test.ts`, `test/unit/clipboard-ops.test.ts`, `test/unit/section-end-motions.test.ts`, `test/unit/g-underscore-motion.test.ts`, `test/unit/marks.test.ts`, `test/unit/jumplist.test.ts`, `test/unit/indent-ops.test.ts`, and `test/unit/visual-case-ops.test.ts`. Each phase should extend the matching existing file unless the fresh inventory proves a feature has no home. | Step-by-step acceptance criteria now name specific test files |
| 17 (v2) | "`q` is bound to `editor-quit`" | Confirmed at `src/tlisp/core/bindings/normal.tlisp:149`: `(key-bind "q" "(editor-quit)" "normal")`. The rebind is a single line change, but the dispatcher must preserve top-level quit semantics (covered in Step 1.3 design). | Step 1.3 confirmed |
| 18 (v2) | Runtime is "Bun" | Mixed: `start` is `node --import tsx` (per `package.json:7`), but `daemon`, `tui`, `tlisp`, and `test` are `bun`. Daemon-restart memory applies to `bun src/server/server.ts` invocations. | Validation Commands clarified |
| 19 (v3, refreshed) | "the recording hook belongs in T-Lisp unified dispatch (per `src/tlisp/Claude.md`), not in handler files" | **Wrong.** There is NO single T-Lisp function `vim-dispatch-normal-key`. The "unified keymap" is the `normal-handler.ts` flow itself: it routes pending-states → digits → prefix → keymap-ref lookup → `executeCommand(editor, cmdRight.value)`. In current source, line 129 is a prefix return; the keymap `executeCommand` call is around line 149. **The handler IS the chokepoint.** Recording must hook before keymap command execution, calling `(macro-record-key <key>)` when `(macro-record-active)` is true. | Step 1.3 MUST list corrected: hook is near the keymap execution block around `normal-handler.ts:144-150`, not line 129 |
| 20 (v3) | Phase 2.1: extend existing `commands/replace.tlisp` with vim replace | **Name collision.** `src/tlisp/core/commands/replace.tlisp` already exists and implements Emacs-style `query-replace` (functions `query-replace`, `replace-yes`, `replace-no`, `replace-all`, `replace-quit`). Extending it with vim `r{char}`/`R` would conflate two unrelated features. | Resolved in current source: vim replace logic lives in existing `commands/vim-replace.tlisp`, NOT `replace.tlisp` |
| 21 (v3) | Step 1.3 Option B (`(read-key)` primitive) viable | **Not viable.** `grep -rn "read-key\|readKey" src/` returns ZERO matches — no such primitive exists. Building one would require a non-trivial async-read TS primitive. | Step 1.3 simplified: only Option A (transient pending state) is real; Option B struck |
| 22 (v3) | Phase 2.1 mode change requires touching 5 sites | **Alternative undersold.** Vim replace can be implemented as a sub-state flag on `'insert'` mode (analogous to how operator-pending is a T-Lisp global inside `'normal'` mode), avoiding ALL TypeScript changes. Trade-off: less type-safe, breaks mode-predicates like `(eq (editor-mode) "replace")`. | Step 2.1 Design Decisions: weigh "add new mode union value" (type-safe, 5 TS sites) vs "insert sub-state flag" (no TS change, less discoverable). Pick one explicitly |
| 23 (v3) | `set-register` for `"A` append: would need new code | **Already supported.** `set-register` at `evil-integration.ts:259` auto-detects uppercase for append (line 295: "Check if uppercase (append mode)"). `"Ayy` works through existing infrastructure with no new code. | Step 2.3 acceptance criterion `"Ayy appends` confirmed — no new work needed beyond parsing the `"x` prefix |

**Historical note:** macro-record-key timing, clipboard file presence, repeat-change file presence, replace-mode presence, and jumplist cap are no longer open in the current repo. Re-run `rg` before relying on any historical finding above.

### Pre-implementation smoke (do this FIRST, before code changes)

Non-destructive, repeatable validation for this slice:

1. Run `bun run typecheck:src && bun run typecheck:test && bun run typecheck && bun run test:unit && bun run test:tmax-use`.
2. Run `bun run build`.
3. Use `bin/tmax --stop` before any later live-keypath validation that depends on changed TypeScript or T-Lisp source.
4. Do not hand-edit key bindings as a smoke test; source edits belong only to the implementation slice.

## Feature Description

This spec is a phase/slice-specific work order for the remaining SPEC-044 cleanup items after the repo's shipped Vim parity work. It closes only the current gaps that remain after the June 23, 2026 inventory:

1. Fix remaining default yank/delete register semantics where T-Lisp paths still bypass the yank/delete-aware register behavior.
2. Add or complete focused tests for shipped but under-covered behavior: register prefix, jumplist cap, sentence/section/window/scroll motions, `:marks`, and multibyte replace/case edge cases where coverage is missing.
3. Implement remaining `gj`/`gk` screen-line motions if current primitives can support them without renderer decisions leaking into T-Lisp.
4. Implement remaining global marks and auto-populated special marks.
5. Implement remaining indent/case operator+motion forms and visual `gu`/`gU`/`g~` sequence support.

Already-shipped features such as search bindings, macros, replace mode, repeat-change, register prefix syntax, and clipboard support are not to be rebuilt.

Historical roadmap tiers from the original gap analysis are preserved for context:

- **Tier A — Bindings only (low cost, very high impact):** wire existing TypeScript primitives into the operator/search/macro keypaths so users can actually reach them from the keyboard. Primitives exist today; the user-visible features do not.
- **Tier B — Mode and parser extensions (medium cost, high impact):** add a replace mode value, a change-recording layer for `.`, and a register-prefix parser path. Each touches one TypeScript file plus T-Lisp.
- **Tier C — New functionality (higher cost, deferred in part):** WORD/sentence motions, marks + jumplist, indent/case operators, Ex ranges. Some are pure T-Lisp; others (marks, Ex ranges) need new TS primitive helpers.

Phases 6-7 (Ex ranges / Surround) remain deferred to follow-up specs and are out of this implementation slice.

## User Story

As a tmax user coming from VS Code Vim (or any modern vim emulator)
I want the vim-defining workflows — `diw`, `/search`, `n/N`, `q`-recorded macros, `r{char}`, `.`, `"ayy`, `ma`/`'a`, `C-o`/`C-i` — to just work
So that I can edit code at the speed I expect from a vim-family editor, not the reduced subset that works today

## Problem Statement

A gap analysis (June 2026) between VS Code Vim and tmax found that tmax has working TypeScript primitives and T-Lisp libraries for several flagship vim features — text objects, search, macros, registers — but the **user-facing key bindings either don't exist, aren't wired end-to-end, or have only partial variant coverage**. Re-run this inventory before each phase; the current repo has already shipped substantial Phase 1-5 work. Specifically:

1. **Text objects** (`src/editor/api/text-objects.ts`) now have operator-pending dispatch in `src/tlisp/core/commands/operators.tlisp` and SPEC-044 Phase 1.A tests in `test/unit/operator-text-object.test.ts`. Remaining work is narrower: verify shipped coverage and fix register semantics so yank/delete text-object paths use yank/delete-aware register operations, not only raw unnamed-register writes.
2. **Search** primitives and bindings are shipped: `/`, `?`, `n`, `N`, and `:nohl`/`:noh` are wired through `src/tlisp/core/commands/isearch.tlisp`, `src/editor/api/bindings-ops.ts`, and covered by `test/unit/search-navigation.test.ts`. Remaining work is edge-case coverage only if a fresh phase spec keeps search in scope.
3. **Macros** are shipped through `q`, `@`, `@@`, persistence, and the normal-handler `macro-record-key` hook. Relevant tests include `test/unit/macro-recording.test.ts`, `test/unit/macro-persistence.test.ts`, `test/unit/macros.test.ts`, and `test/unit/macro-handler.test.ts`. Remaining work is optional Vim-quirk behavior such as replay while recording.
4. **Replace mode** (`r{char}`, `R`) is shipped via `src/tlisp/core/commands/vim-replace.tlisp`, `src/editor/handlers/replace-handler.ts`, and `test/unit/replace-mode.test.ts`.
5. **`.` repeat last change** is shipped via `src/tlisp/core/commands/repeat.tlisp`, the `.` key binding, and `test/unit/repeat-change.test.ts`. Remaining work is any gaps found by a fresh repeat inventory, not file creation.
6. **Register-prefix syntax** (`"ayy`, `"ap`, `"Ayy`) is shipped and covered by `test/unit/register-prefix.test.ts`. Remaining work is to make all operator/text-object mutations use the same yank/delete-aware register semantics required by Vim numbered registers.
7. **WORD, sentence, section, section-end, window-relative, scroll, and `g_` motions** are mostly shipped. Current tests include `test/unit/word-navigation.test.ts`, `test/unit/delete-operator.test.ts` for `d)`, `test/unit/section-end-motions.test.ts`, and `test/unit/g-underscore-motion.test.ts`. Remaining gaps after inventory: `gj`/`gk` screen-line motions and any missing dedicated sentence/window tests.
8. **Marks and jumplist** are partially shipped: buffer-local marks, `:marks`, jumplist navigation, and a 100-entry cap exist in `src/tlisp/core/commands/marks.tlisp` and `src/tlisp/core/commands/jumplist.tlisp`. Remaining gaps are global marks (`mA`) and auto-populated special marks (`'<`, `'>`, `'[`, `']`, `'^`, `'.`), plus explicit jumplist-cap test coverage if desired.
9. **Indent / case operators** are partially shipped: line `>>`/`<<`, `~`, `guu`/`gUU`/`g~~`, visual `>`/`<`/`~`, and visual `u`/`U`/`~` coverage exist in `test/unit/indent-ops.test.ts` and `test/unit/visual-case-ops.test.ts`. Remaining gaps are operator+motion forms (`>w`, `gu$`) and any explicit visual `gu`/`gU`/`g~` sequence support not covered by existing visual `u`/`U` bindings.
10. **Ex ranges** (`:1,5d`, `:.,$`, `:'<,'>`) and **Ex commands** (`:g`, `:v`, `:sort`, `:!`) remain deferred.

The first three are especially high-leverage because the implementation work is small — mostly `key-bind` lines and a few T-Lisp dispatch entries — yet they cover workflows that are arguably the most vim-defining.

## Solution Statement

1. **Phase 1** — Verify shipped `operator+text-object`, search, and macro wiring; if this phase remains in scope, focus only on remaining register-semantics and coverage gaps.
2. **Phase 2** — Verify shipped replace mode, repeat-change, register-prefix, and clipboard bridge; if this phase remains in scope, focus only on uncovered repeat/register/clipboard edge cases.
3. **Phase 3** — Verify shipped WORD, sentence, section, section-end, window-relative, scroll, and `g_` motions; remaining implementation is primarily `gj`/`gk` and any missing dedicated motion tests.
4. **Phase 4** — Extend existing marks/jumplist implementation only for missing global marks, special marks, and any missing cap/push-hook coverage.
5. **Phase 5** — Extend existing indent/case implementation only for missing operator+motion forms and remaining visual sequence coverage. `=` remains deferred unless a phase-specific addendum defines language-aware behavior.
6. **Phase 6 (DEFERRED)** — Ex ranges and `:g`/`:v`/`:sort`/`:!`. Out of scope here; see "Deferred to follow-up."
7. **Phase 7 (DEFERRED)** — Surround emulation (`ds`/`cs`/`ys`/`S`). Out of scope here; see "Deferred to follow-up."

## Tech Stack

| Layer | Technology | Version | Why |
|---|---|---|---|
| Runtime | Bun + Node (mixed) | Bun latest, Node via `tsx` | `start` uses `node --import tsx`; `daemon`, `tui`, `test`, `tlisp` use `bun`. Daemon-restart memory applies to `bun src/server/server.ts` invocations. |
| Language | TypeScript | ^5.9.3 | Strict mode, `tsconfig.src.json` / `tsconfig.test.json` split. |
| Editor logic | T-Lisp (built-in) | n/a | All decisions live in `src/tlisp/core/`. TypeScript only provides primitives. |
| Live-keypath harness | tmax-use | local package | Required e2e vehicle for SPEC-044 acceptance criteria; playbooks live in `tmax-use/playbooks/*.yaml` and run via `bun run test:tmax-use`. |
| Renderer regression harness | tmax-use + targeted tests | local | `package.json` does not expose `test:daemon`, `test:ui`, or `test:ui:renderer`; this spec validates through current package gates only. |
| Dependencies | ink, react, typescript, tsx | per `package.json` | Zero editor-logic deps — do NOT add new runtime deps for any phase. |
| Build | `bun build --compile` | n/a | Produces `dist/tmax`, `dist/tlisp`, and `dist/tmax-use` standalone binaries. |

**No new runtime dependencies.** Every phase must be implementable with the existing stack. Phase 2.4 (OS clipboard) uses `Bun.spawn` against platform tools (`pbcopy`/`xclip`/`clip`) — no npm clipboard package.

## Commands (build / test / lint / dev)

Single source of truth: `package.json`. Current commands:

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
bun run test:tmax-use                    # tmax-use live-keypath playbooks

# Build
bun run build                            # tmax + tlisp + tmax-use standalone binaries
bun run build:tmax                       # Just tmax
bun run build:tlisp                      # Just tlisp
bun run build:tmax-use                   # Just tmax-use

# Daemon lifecycle (for UI verification)
bin/tmax --stop                          # Stop the daemon (assumes bin/ on PATH or use ./bin/tmax)
bun run daemon                           # Start daemon in foreground (Ctrl-C to stop)
```

**Slice verification gate (run after every step):** `bun run typecheck:src && bun run typecheck:test && bun run typecheck && bun run test:unit && bun run test:tmax-use && bun run build`. Add `bun run test:integration` when the slice crosses integration boundaries.

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
│   │   └── commands/              → Command libraries — most Phase 1-5 files now exist
│   │       ├── operators.tlisp    → Text-object dispatch (Phase 1.1b), "." hook (2.2)
│   │       ├── motions.tlisp      → EXISTING — WORD/sentence/section/window motions; extend only missing gaps
│   │       ├── vim-dispatch.tlisp → Pending-state helpers
│   │       ├── vim-counts.tlisp   → Count state machine
│   │       ├── indent.tlisp       → EXISTING — wrap for '=' operator (Phase 5.1)
│   │       ├── macros.tlisp       → EXISTING — Phase 1.3 may extend/reroute
│   │       ├── vim-replace.tlisp  → EXISTING — Vim replace mode; NOT replace.tlisp (collision)
│   │       ├── repeat.tlisp       → EXISTING — repeat-change recorder/replayer
│   │       ├── marks.tlisp        → EXISTING — Phase 4.1 may extend
│   │       ├── jumplist.tlisp     → EXISTING — Phase 4.2 may extend
│   │       ├── indent-ops.tlisp   → EXISTING — Phase 5.1 may extend
│   │       └── command-history.tlisp → PROPOSED only for a future Ex/history spec
│   └── ...
├── editor/
│   ├── api/                       → TS primitives ONLY (no decisions)
│   │   ├── mode-ops.ts            → existing replace-mode validation; modify only for fresh gaps
│   │   ├── text-objects-ops.ts    → Exposes 21 primitives; Phase 1.1 adds only remaining gaps
│   │   ├── text-objects.ts        → Region computation (Phase 1.1 adds only missing variants)
│   │   ├── evil-integration.ts    → Registers — 'A' append already works (Phase 2.3)
│   │   ├── search-ops.ts          → search-next/previous exposed (Phase 1.2 binds them)
│   │   ├── macro-recording.ts     → DO NOT TOUCH (production-ready)
│   │   └── clipboard-ops.ts       → EXISTING — OS clipboard primitives
│   ├── handlers/                  → Mode dispatch routing (no logic)
│   │   ├── normal-handler.ts      → Macro-record-key hook near keymap executeCommand (Phase 1.3)
│   │   ├── insert-handler.ts      → Template for replace-handler.ts (Phase 2.1)
│   │   └── replace-handler.ts     → EXISTING — replace-mode key routing
│   └── editor.ts                  → defineRaw() for macro primitives (already done)
├── server/                        → Daemon — no changes for Phases 1-5
└── client/                        → TUI client — no changes for Phases 1-5

test/
├── unit/                          → Bun tests, extend existing files
│   ├── operator-text-object.test.ts → Existing Phase 1.A coverage; extend for remaining gaps
│   ├── operator-find-char.test.ts → Pattern template
│   ├── macro-recording.test.ts    → Phase 1.3
│   ├── incremental-search.test.ts → Phase 1.2
│   ├── vim-dispatch.test.ts       → Phase 1.1b dispatch
│   ├── replace-mode.test.ts       → EXISTING — Phase 2.1 coverage
│   ├── repeat-change.test.ts      → EXISTING — Phase 2.2 coverage
│   ├── marks.test.ts              → EXISTING — Phase 4.1 coverage
│   ├── jumplist.test.ts           → EXISTING — Phase 4.2 coverage
│   ├── indent-ops.test.ts         → EXISTING — Phase 5 coverage
│   ├── register-prefix.test.ts    → EXISTING — Phase 2.G coverage
│   ├── section-end-motions.test.ts → EXISTING — Phase 3.D coverage
│   ├── g-underscore-motion.test.ts → EXISTING — Phase 3.G coverage
│   └── visual-case-ops.test.ts    → EXISTING — visual case coverage
├── integration/                   → Cross-module integration tests
└── ui/                            → Historical Python UI harness files may exist, but package gates do not expose them for this spec

docs/
├── specs/                         → THIS FILE + proposed Vim follow-ups (do not assume SPEC-045..053 are available)
├── adrs/                          → Architecture Decision Records — add per phase
├── rfcs/                          → RFCs for larger features
└── learnings.md                   → Persistent lessons — append per CLAUDE.md §6
```

**Rule:** every change must trace to a file in this tree. If you're editing a file not listed, the spec missed something — pause and update the spec.

## Code Style

The project follows the patterns in `src/tlisp/Claude.md` and `src/editor/Claude.md`. One real example beats description — this is the canonical command-library shape from existing `commands/operators.tlisp`:

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
- **Operators wrap mutations in `(undo-begin)` / `(undo-commit combo)`** and call yank/delete-aware register helpers. Raw `(set-register "\""` <text>) updates only one register; it is correct for explicit named-register writes but not sufficient for Vim's yank-to-`0` and delete-rotation-through-`1-9` semantics.
- **Handlers route, never decide.** `normal-handler.ts` calls `(vim-dispatch-operator-key "<key>")`; it never inspects the key itself.
- **Counts multiply:** operator-count × motion-count via `vim-operator-total-count`.
- **Naming:** T-Lisp kebab-case (`delete-inner-word`), TS camelCase (`deleteInnerWord`).
- **No comments unless WHY is non-obvious.** A `;; TODO vim-record-change` hook is OK; a `;; This deletes the word` comment is not.
- **Each command file ends with `(provide "name")` AND must be added to the load list** wherever existing libraries are required.

## Testing Strategy

| Level | Framework | Location | When |
|---|---|---|---|
| Unit (TS) | `bun test` | `test/unit/*.test.ts` | Every new primitive, every T-Lisp dispatch branch |
| Integration | `bun test` | `test/integration/` | Cross-module flows (operator + text-object + undo + register) |
| Live keypath E2E | tmax-use | `tmax-use/playbooks/*.yaml` | Every user-visible acceptance criterion; each playbook drives a fresh daemon, sends real keys via `keys:`, and inspects captured frame/buffer output. API-only `eval:` may set up fixtures but cannot replace keypath assertions. Run via `bun run test:tmax-use`. |
| Integration / live regression | Bun + tmax-use | `test/integration/`, `tmax-use/playbooks/*.yaml` | Required when a slice changes daemon-visible behavior or user-visible keypaths. |

**Coverage expectations:**
- Every Phase N acceptance criterion maps to at least one deterministic unit/integration test and, when the behavior is user-visible, one tmax-use live-keypath playbook.
- Visual/rendering changes MUST be covered by current package gates and a targeted tmax-use playbook; do not cite removed `test:ui:*` scripts.
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
- Renderer/layout/cursor-display changes → **targeted tmax-use playbook plus current package gates**

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
- [ ] tmax-use playbook added if the feature is user-visible; renderer/TUI changes are covered by current package gates and targeted live-keypath assertions.
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
  3. VERIFY      — bun run typecheck:src && bun run typecheck:test && bun run typecheck && bun run test:unit && bun run test:tmax-use && bun run build
  4. COMMIT      — atomic, descriptive message (per git-workflow-and-versioning)
  5. NEXT SLICE  — carry forward, do not restart
```

**Hard rules from the skill:**
- **One thing per increment.** A commit that wires `diw` AND adds `/` search bindings is two commits. Split them.
- **Keep it compilable.** After every increment: `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`, and `bun run test:unit` green. Never leave the tree broken between slices.
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
| **1.E** | `:nohl` Ex command | Already shipped; if touched, update `editor-execute-command-line` by symbol name and clear highlight ranges without clearing the last search pattern | New search parser | tmax-use playbook for `:nohl` clears highlights and `n` still works |
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
| **3.C** | `( )` sentence motions | Extend `test/unit/word-navigation.test.ts` or add a focused sentence-motion file if inventory justifies it |
| **3.D** | `[[ ]] [] ][` section and section-end motions | Existing coverage in `test/unit/section-end-motions.test.ts`; add missing section-start tests if needed |
| **3.E** | `H M L` window-relative | New test file |
| **3.F** | `C-e C-y` single-line scroll | Same |
| **3.G** | `gj gk` screen-line motions and `g_` last non-blank | `g_` is covered by `test/unit/g-underscore-motion.test.ts`; `gj`/`gk` need a dedicated screen-line test if implemented |

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

- **Each slice ends with the same required gate:** `bun run typecheck:src && bun run typecheck:test && bun run typecheck && bun run test:unit && bun run test:tmax-use && bun run build`. Not "next slice will fix it."
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
- Run `bun run typecheck:src && bun run typecheck:test && bun run typecheck && bun run test:unit && bun run test:tmax-use && bun run build` after every step. Zero exceptions.
- Restart the daemon after any `.ts` change before tmax-use or renderer verification (memory `feedback_daemon-restart-after-code-change.md`).
- Wrap every mutation in `(undo-begin)` / `(undo-commit combo)` and route register writes through the correct Vim semantic path: yank writes `"` + `0` + kill ring, delete/change writes `"` + kill ring and rotates `1-9` for line deletes. Raw `(set-register "\""` <text>) is not enough for unnamed yank/delete semantics.
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
- Shipping a user-visible feature without a corresponding tmax-use playbook.

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
| Mode type | `src/editor/api/mode-ops.ts` | Modes are a closed string union. Replace mode already exists; modify mode validation only for a fresh inventory gap. |
| Operator state pattern | SPEC-041 (`src/tlisp/core/commands/operators.tlisp`) | Pending-operator state is stashed in module-level `defvar`, consumed when the sub-state (find, text-object) resolves. New branches must follow this pattern; do NOT add a parallel state machine. |
| Unified keymap | SPEC-038 (`src/editor/handlers/normal-handler.ts`) | All normal/visual/insert keys route through T-Lisp dispatch. New key definitions should be `(key-bind ...)` lines. **Routing exception:** handler changes are allowed only to route pending-state keys or macro-record capture into T-Lisp primitives, such as the Step 1.3 `macro-record-key` hook. |
| Verification | `CLAUDE.md` §8 | Every step must end with `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`, `bun run test:unit`, `bun run test:tmax-use`, and `bun run build`. |
| Daemon restarts | Memory `feedback_daemon-restart-after-code-change.md` | After any TS source change, restart the daemon before UI verification. Unit tests don't pick up stale-daemon regressions. |

Fill this table **before writing steps.** ✅ done above.

## Relevant Files

### Existing Files to Modify

| File | Change | Constraints |
|------|--------|-------------|
| `src/tlisp/core/commands/operators.tlisp` | Existing operator/text-object/register-prefix/repeat hooks; modify only for remaining register-semantics gaps or missing operator+motion forms | SPEC-041 stash pattern. Operator state owned here, not in TS. |
| `src/tlisp/core/commands/isearch.tlisp` | Existing `/`, `?`, `n`, `N` bindings; modify only if a fresh search inventory finds a gap | Follow the `windows.tlisp`/`tabs.tlisp` library pattern. No new state machine. |
| `src/tlisp/core/commands/macros.tlisp` | Existing macro command library with `q`, `@`, `@@`; modify only for remaining Vim quirks such as replay while recording | Memory `feedback_daemon-restart-after-code-change.md`. The `q` binding must check `(macro-record-active)` first. |
| `src/tlisp/core/commands/repeat.tlisp` | Existing `vim-record-change`, `vim-repeat-last-change`, and `.` binding; extend only for fresh inventory gaps | Pure T-Lisp. No TS change. |
| `src/tlisp/core/bindings/normal.tlisp` | Existing normal-mode bindings for many Phase 1-5 items; add only missing keys such as `gj`/`gk` or remaining operator+motion entries | All new keys go here, not in handler code. |
| `src/tlisp/core/bindings/visual.tlisp` | Existing visual bindings; extend only missing visual text-object or visual operator sequences if a phase-specific spec keeps them in scope | Visual bindings only. Visual-block `I`/`A`/`r` and `=` are deferred out of SPEC-044. |
| `src/tlisp/core/commands/motions.tlisp` | Existing WORD/sentence/section/section-end/window/scroll/`g_` motion functions; add only missing `gj`/`gk` or coverage-driven gaps | Pure T-Lisp where possible; screen-line movement may need renderer/viewport primitives. |
| `src/tlisp/core/commands/marks.tlisp` | Existing mark command library; extend `set-mark`, `goto-mark-line`, `goto-mark-col`, `:marks` listing only for missing Phase 4 behavior | Pure T-Lisp state plus TS position primitive if still needed after inventory. |
| `src/tlisp/core/commands/jumplist.tlisp` | Existing jumplist command library with 100-entry cap; extend only for missing push-hook or cap test coverage | Pure T-Lisp ring buffer. |
| `src/tlisp/core/commands/indent-ops.tlisp` | Existing indent/case operator library; extend only missing `indent-region`, `outdent-region`, `toggle-case-region`, and operator wrappers | Mostly T-Lisp; gap-buffer region shift may need a TS primitive. |
| `src/editor/api/mode-ops.ts` | Existing `'replace'` mode support; modify only if replace-mode inventory finds a gap | TS primitive change only; no editor behavior decisions here. |
| `src/editor/handlers/replace-handler.ts` | Existing replace-mode key routing; modify only for remaining replace-mode gaps | Primitives-only rule — no decisions here. |
| `src/editor/api/text-objects.ts` | Add only missing region helpers discovered by inventory, likely around variants for `{}`, `[]`, `<>`, tags and supported change variants for bracket/angle/tag | Pure primitives — region computation only. |
| `src/editor/api/text-utils.ts` | Add `findWordBoundaryWORD` (whitespace-only) helper if T-Lisp can't compute it | Primitive only; no decisions. |
| `src/editor/api/clipboard-ops.ts` | Existing OS clipboard bridge for `+`/`*` registers | Use existing primitives; T-Lisp decides when to call them. |
| `src/editor/api/evil-integration.ts` | Add T-Lisp-callable yank/delete semantic helpers if needed so T-Lisp operators can use `registerYank`/`registerDelete` instead of raw unnamed `set-register` | Primitives only; do not decide editor behavior here. |
| `src/tlisp/core/commands/search-ex.tlisp` OR extend `isearch.tlisp` | Define reusable `nohl`/`noh` helpers if useful; they must clear only highlight ranges, not the saved search pattern. The actual `:nohl`/`:noh` command-line branch belongs in `src/editor/api/bindings-ops.ts` unless the command parser is redesigned | Follow the current `editor-execute-command-line` table, not a non-existent command-handler table. |
| `src/editor/handlers/command-handler.ts` | Add `<Up>`/`<Down>` history navigation in command mode (Phase 6 prerequisite, but small) | Handler routes only — history ring owned by T-Lisp. |
| `src/tlisp/core/commands/command-history.tlisp` (proposed) | Per-mode history rings for `:` commands if a future Ex/history spec keeps this scope | Pure T-Lisp. |
| `test/unit/*.test.ts` | Extend current tests per phase (see Testing Strategy) | Follow `rules/testing.md`; current SPEC-044-related files include `operator-text-object.test.ts`, `register-prefix.test.ts`, `repeat-change.test.ts`, `clipboard-ops.test.ts`, `section-end-motions.test.ts`, `g-underscore-motion.test.ts`, `marks.test.ts`, `jumplist.test.ts`, `indent-ops.test.ts`, and `visual-case-ops.test.ts`. |
| `tmax-use/playbooks/*.yaml` | New e2e playbook scenarios for the wired features | tmax-use is the project's e2e harness (SPEC-061). Each playbook drives a fresh daemon, sends real keys via `keys:` and/or exercises the API via `eval:`, and asserts on observable frame/buffer state. See `tmax-use/playbooks/README.md` for the schema; `eval-19-vim-text-objects.yaml`, `eval-20-vim-search.yaml`, `eval-21-vim-macros.yaml` are the Phase 1 templates. Run via `bun run test:tmax-use` or `bin/tmax-use <playbook>`. |

### New Files / Proposed Files

| File | Purpose | Constraints |
|------|---------|-------------|
| `src/tlisp/core/commands/command-history.tlisp` (proposed) | `:` command history ring if a future Ex/history slice is approved | Pure T-Lisp. |
| `test/unit/screen-line-motion.test.ts` (proposed) | Dedicated `gj`/`gk` coverage if those motions remain in scope and do not fit an existing motion test | Prefer extending existing motion tests if practical. |

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
- Call the correct register semantic path on completion. For yanks, use or add a T-Lisp-callable wrapper around `registerYank(text)` from `src/editor/api/evil-integration.ts` so `"` and `0` both update and the kill ring is populated. For deletes/changes, use or add a T-Lisp-callable wrapper around `registerDelete(text, isLineDelete)` so `"` updates, line deletes rotate `1-9`, and the kill ring is populated. Use raw `(set-register <explicit-register> text)` only for explicit named-register writes such as `"ayy`/`"Ayy`.
- Current shipped coverage includes `diw`, `daw`, `ciw`, `caw`, quote delete/change variants, inner/around paren, inner brace change/delete, inner bracket, inner angle, and inner tag tests or dispatch entries. Preserve them.
- Remaining coverage should be limited to variants actually missing after inventory, for example `da}`, `ca}`, `da]`, `ca]`, `da<`, `ca<`, `dat`, `cat`, and supported inner change variants for bracket/angle/tag.
- Apply count: `d2iw` deletes two words through the existing `vim-operator-total-count` pattern.
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
- [ ] Targeted tmax-use/manual live verification covers any renderer/TUI behavior changed by the slice.
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
- Add a separate visual-mode replace binding in Phase 2 — visual/block `r` is deferred to a proposed visual-block follow-up with the other visual-block ops.
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

**Description:** Existing `commands/repeat.tlisp` maintains a `vim-last-change` record and binds `.`. If this slice is revisited, verify the current hook surface instead of recreating the file: `vim-operator-apply`, `vim-operator-apply-find`, text-object cases, `commands/edit-commands.tlisp` (`x`, `D`, `C`, `J`, `p`, `P`), `vim-replace.tlisp`, and any insert-mode text capture hooks. Each mutating path that remains in scope must call `(vim-record-change <descriptor>)`; `.` replays the last descriptor at the current cursor.

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

**Description:** Current source already implements `W B E ge gE ( ) [[ ]] [] ][` and `g_` in `src/tlisp/core/commands/motions.tlisp`. If Phase 3 is revisited, verify those shipped paths and focus implementation on missing `gj`/`gk` screen-line motions or missing dedicated coverage. WORD uses whitespace-only boundaries (no punctuation split). Sentence splits on `. ! ?` followed by whitespace. Section starts split on `{` at column 0 (C-style) or form-feed; section ends split on `}` at column 0.

**MUST:**
- All motions work with count and as operator motions (`dW`, `c)`, `y[[`).
- `ge` lands on the LAST char of the previous word end (vim quirk).

**MUST NOT:**
- Add a new state machine — motions are pure functions.

**Acceptance criteria:**
- [ ] `W` jumps over punctuation clusters as one WORD.
- [ ] `(` `)` move by sentence.
- [ ] `[[` `]]` move by section; `[]` `][` move by section end.

#### Step 3.2: Window-relative and single-line scrolls

**Description:** Current source already implements `H M L` (top/middle/bottom of viewport), `C-e C-y` (single-line scroll), and `g_` (last non-blank). Remaining implementation is `gj gk` (screen-line moves on wrapped lines) unless a fresh inventory finds another gap.

**Acceptance criteria:**
- [ ] `H`/`M`/`L` move to top/middle/bottom visible line.
- [ ] `C-e`/`C-y` scroll one line.
- [ ] `gj`/`gk` move by screen row when line wrapping is on.
- [ ] `g_` remains covered by `test/unit/g-underscore-motion.test.ts`.

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
- Visual mode: `>` `<` `~` and visual case transforms on selection. Visual-block `I`/`A`/`r` is deferred to a proposed visual-block follow-up.
- New indent cases follow the SPEC-041 stash pattern + undo bookend + the same yank/delete-aware register semantic path as Phase 1 text objects.

**Acceptance criteria:**
- [ ] `>>` indents the current line by one shiftwidth.
- [ ] `>` in visual indents the selection.
- [ ] `guu` lowercases the current line; `gUU` uppercases.
- [ ] `~` toggles case of char under cursor.
- [ ] `=` / `=ap` are not implemented in SPEC-044 unless a phase-specific addendum first defines language-aware behavior.
- [ ] Visual-mode `r{x}` is not implemented in SPEC-044; it belongs to proposed visual-block follow-up work.

### Phase 6: Ex Ranges and `:g` / `:v` / `:sort` / `:!` — DEFERRED

Out of scope for SPEC-044. Tracked here for visibility. Implementing Ex ranges properly requires:
- A range parser integrated with the current Ex command path in `src/editor/api/bindings-ops.ts` (handles `:%`, `:1,5`, `:.,$`, `:'<,'>`, `:+N`, `:-N`) unless that parser is moved to T-Lisp in a dedicated redesign.
- `:g`/`:v`/`:global!` over every line in range, applying an Ex command per match.
- `:sort` with flags (`u`, `!`, `n`, `r`, `i`).
- `:!cmd` shell-out via `Bun.spawn` (primitives-only in TS).

Open a dedicated follow-up spec once Phase 1-5 remaining gaps are scoped. `SPEC-046` through `SPEC-053` already exist for unrelated work in the live repo, and `SPEC-045` is absent as of the 2026-06-23 inventory, so do not cite these as actual reserved file paths.

### Phase 7: Surround Emulation — DEFERRED

Out of scope for SPEC-044. Implementing vim-surround (`ds`/`cs`/`ys`/`S`) is best built on top of the operator+text-object dispatch from Phase 1.1. Open a dedicated follow-up spec using the next available spec number once Phase 5 remaining gaps land.

## Acceptance Criteria

1. **Register semantics:** T-Lisp-authored yank/delete/change paths use yank/delete-aware register semantics; yanks update `"` and `0`, deletes/changes update `"` and the kill ring, and line deletes rotate `1-9`. Tests cover text-object and line-delete paths with `get-register`, `M-y`, and representative real-key flows.
2. **Current shipped features remain covered:** search, macros, replace mode, repeat-change, register prefix, clipboard, marks/jumplist, section-end, `g_`, and indent/case tests still pass in their current files.
3. **Remaining motion gaps:** `gj`/`gk` are either implemented with dedicated wrapped-line tests or explicitly deferred in a follow-up spec after documenting the missing primitive.
4. **Remaining mark gaps:** global marks and auto-populated special marks are either implemented with tests or explicitly deferred in a follow-up spec after documenting the required state model.
5. **Remaining indent/case gaps:** operator+motion forms and visual `gu`/`gU`/`g~` sequence behavior are either implemented with tests or explicitly deferred in a follow-up spec.
6. **No regressions:** every existing tmax-use playbook (`bun run test:tmax-use`) still passes; every existing unit test still passes; `bun run typecheck:src`, `bun run typecheck:test`, and `bun run typecheck` are green.
7. **No TS violations:** `src/editor/handlers/*.ts` and `src/editor/api/*.ts` files contain no new editor decisions (per `src/editor/Claude.md`).
8. **Memory compliance:** daemon restarted before every live-keypath verification step after source changes (per `feedback_daemon-restart-after-code-change.md`).

## Validation Commands

Execute every deterministic validation command at the end of each phase (not just at the end of the spec). Every command in this list must exit 0.

- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:src` — TypeScript source typechecks.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:test` — Test files typecheck.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck` — Full typecheck (`typecheck:src` + `typecheck:test` + `typecheck:tmax-use` + `typecheck:bench`).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:unit` — Unit tests pass (extends `operator-text-object.test.ts`, `operator-find-char.test.ts`, `macro-recording.test.ts`, `incremental-search.test.ts`, `vim-dispatch.test.ts`, etc.).
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:tmax-use` — tmax-use live-keypath playbooks pass for every user-visible acceptance criterion.
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

**Deferred to follow-up (proposed, not reserved file paths):**
- **Proposed Vim follow-up: Ex ranges** — `:1,5d`, `:.,$`, `:'<,'>`, `:g`/`:v`/`:sort`/`:!`/`:r!`/`:normal`.
- **Proposed Vim follow-up: Surround emulation** — `ds`/`cs`/`ys`/`S`.
- **Proposed Vim follow-up: Visual-block operations** — `I`/`A`/`c`/`r`/`>` columnar; multi-cursor from block.
- **Proposed Vim follow-up: Insert-mode niceties** — `C-w`/`C-u`/`C-r`/`C-o`/auto-pairs/abbreviations.
- **Proposed Vim follow-up: Ex `:set` / options system** — decide whether to add or keep T-Lisp-vars model.
- **Proposed Vim follow-up: jump plugins** — Sneak / EasyMotion / CamelCaseMotion style jumps.
- **Proposed Vim follow-up: tags/tagstack** — `:tag`, `C-]`, `C-t`.
- **Proposed Vim follow-up: definition/file jumps** — `gd`/`gf` (requires LSP or ctags integration).
- **Proposed Vim follow-up: Ex introspection commands** — `:map`/`:noremap`/`:registers`/`:marks`/`:ls`/`:buffers`.

## Open Questions

Unresolved items that need human input before or during implementation. Each blocks at least one remaining roadmap slice.

1. **Parity target — VS Code Vim or Neovim?** (Blocks proposed Ex/surround follow-up scoping.) If Neovim, Surround and Ex ranges become must-have, not deferred.
2. **Daemon T-Lisp hot-reload?** (Affects verification workflow.) Resolved by the Pre-Phase-1 smoke. If yes, relax restart rule for T-Lisp-only changes.
3. **Special/global marks implementation boundary.** (Blocks remaining Phase 4 gaps.) Decide whether global marks and auto-populated special marks can stay fully T-Lisp-owned or need a TS position/buffer-id primitive.
4. **Screen-line motion primitive boundary.** (Blocks `gj`/`gk`.) Decide whether T-Lisp can compute wrapped screen rows from existing viewport primitives or needs a small TS primitive.
5. **Register semantic primitive exposure.** (Blocks numbered-register correctness for T-Lisp-authored operators.) Decide whether to expose `register-yank` / `register-delete` wrappers from `evil-integration.ts`, or route T-Lisp operators through existing yank/delete primitives that already call `registerYank` / `registerDelete`.

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
- [ ] All required gates pass: `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`, `bun run test:unit`, `bun run test:tmax-use`, and `bun run build`.
- [ ] RED test was committed before the implementation (visible in PR history or commit message).
- [ ] Test names describe behavior, not implementation (`"diw deletes word under cursor"`, not `"test dispatch works"`).
- [ ] No tests were skipped, disabled, or marked `.todo` to manufacture green.
- [ ] No mocks of in-process APIs (registers, undo, search, macro recording) — real implementations only.
- [ ] User-visible keypath changes include at least one tmax-use playbook that sends real keys and inspects captured output; renderer/TUI changes include targeted tmax-use/manual live verification because no renderer package script is currently exposed.
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

## Current Source Inventory (refreshed 2026-06-23)

This replaces the stale appended audit findings from 2026-06-21 and 2026-06-22. Treat this as a snapshot for roadmap triage only; every implementation slice must re-run its own inventory before coding.

### Implemented or Mostly Implemented

- **Phase 1 text objects/search/macros:** `operators.tlisp`, `isearch.tlisp`, `macros.tlisp`, and `normal-handler.ts` contain the shipped operator+text-object, search, macro, and macro-record-key routing. Tests: `test/unit/operator-text-object.test.ts`, `test/unit/search-navigation.test.ts`, `test/unit/incremental-search.test.ts`, `test/unit/macro-recording.test.ts`, `test/unit/macro-persistence.test.ts`, `test/unit/macros.test.ts`, `test/unit/macro-handler.test.ts`; tmax-use templates include `eval-19-vim-text-objects.yaml`, `eval-20-vim-search.yaml`, and `eval-21-vim-macros.yaml`.
- **Phase 2 replace/repeat/register/clipboard:** `src/tlisp/core/commands/vim-replace.tlisp`, `src/editor/handlers/replace-handler.ts`, `src/tlisp/core/commands/repeat.tlisp`, `src/editor/api/clipboard-ops.ts`, and register-prefix paths in `operators.tlisp` exist. Tests: `test/unit/replace-mode.test.ts`, `test/unit/repeat-change.test.ts`, `test/unit/register-prefix.test.ts`, `test/unit/clipboard-ops.test.ts`.
- **Phase 3 motions:** WORD and backward word-end coverage lives in `test/unit/word-navigation.test.ts`; section-end coverage lives in `test/unit/section-end-motions.test.ts`; `g_` coverage lives in `test/unit/g-underscore-motion.test.ts`. Current `motions.tlisp` has sentence, section, section-end, H/M/L, C-e/C-y, and `g_` bindings.
- **Phase 4 marks/jumplist:** `marks.tlisp` and `jumplist.tlisp` exist; buffer-local marks, `:marks`, C-o/C-i, and the 100-entry jumplist cap are implemented. Tests: `test/unit/marks.test.ts`, `test/unit/jumplist.test.ts`.
- **Phase 5 indent/case:** `indent-ops.tlisp` exists with line indent/outdent, line case transforms, visual `>`/`<`/`~`, and char toggle. Tests: `test/unit/indent-ops.test.ts`, `test/unit/visual-case-ops.test.ts`.

### Remaining Gaps to Scope in Follow-up Slices

- **Register semantics for T-Lisp-authored operators:** several operator/text-object paths still call raw `(set-register "\"" text)`. Future slices must use or expose yank/delete-aware register operations so yanks update register `0`, deletes/changes update the unnamed register and kill ring, and line deletes rotate numbered registers `1-9`. Add end-to-end tests around `yiw`, `diw`, `dd`, `M-y`, and direct register inspection using `get-register`.
- **Screen-line motions:** `gj`/`gk` still need implementation and tests against wrapped lines. Keep `g_` out of this gap; it is already implemented and tested.
- **Marks:** global marks (`mA`) and auto-populated special marks (`'<`, `'>`, `'[`, `']`, `'^`, `'.`) remain open unless a fresh inventory finds them implemented.
- **Indent/case operator+motion forms:** `>w`, `<j`, `gu$`, `gU}` and related operator+motion combinations remain open; visual `u`/`U`/`~` already have coverage, so do not relabel them missing without re-checking `visual-case-ops.test.ts`.
- **Ex ranges and larger Ex commands:** still deferred to proposed follow-up specs, not actual `SPEC-045` through `SPEC-053` file paths.

### Current Test Reference Map

- Text objects and register semantics: `test/unit/operator-text-object.test.ts`, `test/unit/yank-operator.test.ts`, `test/unit/delete-operator.test.ts`, `test/unit/change-operator.test.ts`, `test/unit/register-prefix.test.ts`, `test/unit/yank-operator-integration.test.ts`, `test/unit/yank-pop.test.ts`, `test/unit/yank-pop-integration.test.ts`.
- Search: `test/unit/search-navigation.test.ts`, `test/unit/incremental-search.test.ts`.
- Macros: `test/unit/macro-recording.test.ts`, `test/unit/macro-persistence.test.ts`, `test/unit/macros.test.ts`, `test/unit/macro-handler.test.ts`.
- Replace/repeat/clipboard: `test/unit/replace-mode.test.ts`, `test/unit/repeat-change.test.ts`, `test/unit/clipboard-ops.test.ts`.
- Motions: `test/unit/word-navigation.test.ts`, `test/unit/delete-operator.test.ts` (`d)`), `test/unit/section-end-motions.test.ts`, `test/unit/g-underscore-motion.test.ts`, plus a proposed `screen-line-motion.test.ts` for `gj`/`gk`.
- Marks/jumplist: `test/unit/marks.test.ts`, `test/unit/jumplist.test.ts`.
- Indent/case: `test/unit/indent-ops.test.ts`, `test/unit/visual-case-ops.test.ts`.
