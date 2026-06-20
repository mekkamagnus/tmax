# Chore: Consolidated Implementation Backlog

## Chore Description

This document consolidates every unimplemented or partially-implemented feature discovered during the full spec audit (SPEC-001 through SPEC-044, all CHORE, BUG, FEAT, and RFC files). Each item has a precise reference to the originating spec, a gap description, and the acceptance criteria that remain unmet.

This is a living backlog — when an item is resolved, mark it `[x]` and add a commit reference.

---

## Step by Step Tasks

### 1. Architecture: Truthful provide/featurep/require (SPEC-003, SPEC-007)

**Source:** `docs/specs/SPEC-003-minor-mode-system.md` (Steps 4–5), `docs/specs/SPEC-007-tlisp-module-system.md` (Step 12, Phase 4/5, AC#9)

**Gap:** `(provide ...)` is a documented no-op in `evaluator.ts:488`. `(featurep ...)` and `(require ...)` do not exist as T-Lisp functions. ~14 core `.tlisp` files still contain live `(provide "...")` forms that compile only because the no-op stub exists. SPEC-003 claims these were made "truthful"; SPEC-007 requires them deleted entirely.

**Tasks:**
- [ ] Make `(provide FEATURE)` register the feature name in a module-level `providedFeatures: Set<string>` on the environment or module registry
- [ ] Implement `(featurep FEATURE)` → returns `t` if feature is in the registry, `nil` otherwise
- [ ] Implement `(require FEATURE)` → loads the module if not already `featurep`, errors if unresolvable
- [ ] Remove the no-op `evalProvide` from `evaluator.ts:488` and its dispatch case at `:586`
- [ ] Remove all `(provide "...")` calls from core `.tlisp` files (replace with module exports where appropriate), OR convert them to register via the new truthful mechanism
- [ ] Fix `test/tlisp/modes.test.tlisp:4-5` which calls `(featurep "python-mode")` and `(featurep "line-numbers-mode")` — these should pass once `featurep` is real

**Relevant files:**
- `src/tlisp/evaluator.ts` (evalProvide at line 488, dispatch at line 586)
- `src/tlisp/module-registry.ts` (add `providedFeatures` tracking)
- `src/tlisp/core/modes/markdown-mode.tlisp:110` (has `(provide ...)`)
- `src/tlisp/core/keymaps.tlisp:159` (has `(provide ...)`)
- `src/tlisp/core/fikra/*.tlisp` (have `(provide ...)`)
- `src/tlisp/core/commands/messages.tlisp:19` (has `(provide ...)`)
- `src/tlisp/core/commands/markdown.tlisp:1793` (has `(provide ...)`)
- `test/tlisp/modes.test.tlisp` (first two assertions will fail until `featurep` is real)
- `test/unit/module-system.test.ts:75` (expects `(provide ...)` → Right; update to expect truthfulness)

---

### 2. Architecture: Wire central key resolution into handlers (SPEC-003)

**Source:** `docs/specs/SPEC-003-minor-mode-system.md` (Step 10)

**Gap:** `src/editor/key-resolution.ts` implements the full Emacs precedence ladder (modal → minor in reverse activation order → major → mode → global) with passing unit tests, but `resolveKeyBinding` is never imported or called by any handler (`normal-handler.ts`, `insert-handler.ts`, `visual-handler.ts`, `command-handler.ts`, `mx-handler.ts`). Which-key also does not reference it. The code is dead.

**Tasks:**
- [ ] Evaluate whether `resolveKeyBinding` should replace or complement the current keymap-first dispatch in handlers
- [ ] If replacing: refactor each handler to call `resolveKeyBinding` as the single resolution path
- [ ] If complementing: wire it as a fallback after keymap lookup fails in handlers
- [ ] Wire `which-key.ts` to use `resolveKeyBinding` for prefix bindings display
- [ ] Remove or integrate any duplicate resolution logic
- [ ] Ensure `test/unit/key-resolution-modes.test.ts` still passes after wiring

**Relevant files:**
- `src/editor/key-resolution.ts` (the dead code)
- `src/editor/handlers/normal-handler.ts`
- `src/editor/handlers/insert-handler.ts`
- `src/editor/handlers/visual-handler.ts`
- `src/editor/handlers/command-handler.ts`
- `src/editor/handlers/mx-handler.ts`
- `src/editor/utils/which-key.ts`
- `test/unit/key-resolution-modes.test.ts`

---

### 3. Architecture: Eager built-in mode loading (SPEC-003)

**Source:** `docs/specs/SPEC-003-minor-mode-system.md` (Step 3, "Deterministic eager built-in loading")

**Gap:** `src/editor/mode-loader.ts` exists with `discoverModeFiles`/`loadTlispFile` but is never imported or invoked. Built-in modes load on-demand via `require-module`. The spec requires `(major-mode-list)` to include all built-ins immediately after daemon startup.

**Tasks:**
- [ ] Import and call the mode loader during `loadCoreBindings` in `editor.ts` (after keymap loading, before user init)
- [ ] Ensure all built-in modes (`fundamental`, `python`, `typescript`, `lisp`, `go`, `markdown`) are loaded eagerly
- [ ] Verify `(major-mode-list)` returns all built-ins post-startup
- [ ] Update `test/unit/mode-loader.test.ts` to assert eager loading

**Relevant files:**
- `src/editor/mode-loader.ts` (dead code — needs to be imported)
- `src/editor/editor.ts` (loadCoreBindings at line 1631)
- `test/unit/mode-loader.test.ts`

---

### 4. Architecture: Status line minor-mode lighters (SPEC-003)

**Source:** `docs/specs/SPEC-003-minor-mode-system.md` (Step 11, "Status line rendering")

**Gap:** `src/frontend/render/status-line.ts` renders the major mode `[${majorModeShort}]` but does NOT render minor-mode lighters. The spec wants `NORMAL [python] (Ln Fill)`. `activeMinorModeLighters` is plumbed through serialization but never displayed.

**Tasks:**
- [ ] Update `src/frontend/render/status-line.ts` to append `(lighter1 lighter2 ...)` when `activeMinorModeLighters` is non-empty
- [ ] Ensure the three frontends (`tui-client.ts`, `assam.ts`, `capture-frame.ts`) pass `activeMinorModeLighters` through render state
- [ ] Add a unit test asserting the lighter string appears in status line output

**Relevant files:**
- `src/frontend/render/status-line.ts` (lines 26-31 — add lighter rendering)
- `src/client/tui-client.ts`
- `src/steep/assam.ts`
- `src/render/capture-frame.ts`

---

### 5. Architecture: Remove legacy TS toggle functions (SPEC-004)

**Source:** `docs/specs/SPEC-004-daily-driver-blocks.md` (Feature 3, "Removal of legacy TS toggle functions")

**Gap:** `toggle-line-numbers` and `toggle-relative-line-numbers` are still defined as `defineRaw` calls in `src/editor/editor.ts:1112-1129` and mutate `state.config` directly, bypassing the minor mode system. The spec requires their removal.

**Tasks:**
- [ ] Remove `toggle-line-numbers` and `toggle-relative-line-numbers` from `editor.ts:1112-1129`
- [ ] Verify no other code references these removed functions
- [ ] Verify the minor-mode equivalents (`line-numbers-mode`, `relative-line-numbers-mode`) cover all use cases

**Relevant files:**
- `src/editor/editor.ts` (lines 1112-1129)

---

### 6. Architecture: Create display-ops.ts and thin window-ops.ts (SPEC-004)

**Source:** `docs/specs/SPEC-004-daily-driver-blocks.md` (Features 4–5)

**Gap:** No `src/editor/api/display-ops.ts` exists. `window-ops.ts` still contains full editor logic (split, close, resize) rather than thin display primitives (`window-allocate`, `window-deallocate`, `window-set-size`, `window-focus`). Tab operations also remain in TypeScript rather than T-Lisp.

**Tasks:**
- [ ] Create `src/editor/api/display-ops.ts` exposing `window-set-layout`, `window-get-cell`, `render-tab-bar`
- [ ] Refactor `src/editor/api/window-ops.ts` to thin display primitives
- [ ] Move window command logic into `src/tlisp/core/commands/windows.tlisp` (add `balance-windows`)
- [ ] Move tab command logic from `src/editor/api/tab-ops.ts` into `src/tlisp/core/commands/tabs.tlisp` (currently a stub with only key bindings)
- [ ] Add `window-config` per tab per spec
- [ ] Update tests

**Relevant files:**
- `src/editor/api/window-ops.ts` (to be thinned)
- `src/editor/api/tab-ops.ts` (logic to move to T-Lisp)
- `src/tlisp/core/commands/windows.tlisp` (add `balance-windows`)
- `src/tlisp/core/commands/tabs.tlisp` (currently a stub)

---

### 7. T-Lisp Diagnostics: Stdlib migration (SPEC-009)

**Source:** `docs/specs/SPEC-009-tlisp-diagnostics-debugging.md` (Step 11, "Stdlib / host-primitive diagnostic migration")

**Gap:** `src/tlisp/stdlib.ts` has zero references to `diagnostic`, `createDiagnostic`, or any `TL*` error code. All stdlib/host-primitive errors are raw `throw new Error()` calls. The spec requires all to be migrated to diagnostic-backed `Either.left`.

**Tasks:**
- [ ] Audit every error-throwing site in `stdlib.ts` and add arity/type-check wrappers using `createDiagnostic`
- [ ] Convert each `throw new Error(...)` to a diagnostic-backed return using appropriate error codes
- [ ] Add unit tests asserting diagnostic shape on stdlib errors

**Relevant files:**
- `src/tlisp/stdlib.ts`

---

### 8. T-Lisp Diagnostics: Daemon diagnostic-events module (SPEC-009)

**Source:** `docs/specs/SPEC-009-tlisp-diagnostics-debugging.md` (Step 16, "Daemon diagnostic-events module")

**Gap:** `src/server/diagnostic-events.ts` does not exist. No `tlisp.diagnostic.created` event emission, no separate bounded event log, no filter-by-`sinceRequest`/client/frame/buffer/module/severity query methods. `tmaxclient --diagnostics` reads `recentErrors` (string log) instead of a diagnostic event log.

**Tasks:**
- [ ] Create `src/server/diagnostic-events.ts` with bounded event log, emit on eval failure
- [ ] Add query RPC methods: `diagnostics`, `diagnostics-since`
- [ ] Update `tmaxclient --diagnostics` to use the new diagnostic log
- [ ] Update `status` RPC to expose `recentDiagnostics` alongside `recentErrors`
- [ ] Add unit tests

**Relevant files:**
- `src/server/diagnostic-events.ts` (new file)
- `src/server/server.ts` (wire into eval failure path)
- `bin/tmaxclient` (update `--diagnostics` handler)

---

### 9. T-Lisp Diagnostics: Editor diagnostic surfaces (SPEC-009)

**Source:** `docs/specs/SPEC-009-tlisp-diagnostics-debugging.md` (Step 14, "Editor error surfaces")

**Gap:** No `src/editor/api/tlisp-diagnostics-ops.ts` file exists. No `diagnostic-list`, `diagnostic-at-point`, `jump-to-diagnostic` editor commands. No dedicated `*T-Lisp Diagnostics*` buffer.

**Tasks:**
- [ ] Create `src/editor/api/tlisp-diagnostics-ops.ts` with `diagnostic-list`, `diagnostic-at-point`, `jump-to-diagnostic`
- [ ] Wire into `tlisp-api.ts`
- [ ] Add `*T-Lisp Diagnostics*` buffer support
- [ ] Add unit tests

**Relevant files:**
- `src/editor/api/tlisp-diagnostics-ops.ts` (new file)
- `src/editor/tlisp-api.ts`

---

### 10. T-Lisp Diagnostics: Wire trace into evaluator (SPEC-009)

**Source:** `docs/specs/SPEC-009-tlisp-diagnostics-debugging.md` (Step 15, "`trace`/`untrace`/`trace-list`")

**Gap:** `trace`, `untrace`, `trace-list` are registered as builtins in `interpreter.ts:54-78`, backed by `DebugState`. However, the evaluator does not consult `isTraced`/`recordTrace` during function calls — enabling trace has no runtime effect.

**Tasks:**
- [ ] Add `isTraced(fnName)` check in `evaluator.ts` function-call path
- [ ] When traced, call `recordTrace(fnName, args, result)` before returning
- [ ] Add unit test asserting trace output when a function is traced

**Relevant files:**
- `src/tlisp/evaluator.ts` (function call sites)
- `src/tlisp/debug-state.ts` (`isTraced`, `recordTrace`)
- `src/tlisp/interpreter.ts` (builtin registration)

---

### 11. T-Lisp Diagnostics: CLI source names + structured *e (SPEC-009)

**Source:** `docs/specs/SPEC-009-tlisp-diagnostics-debugging.md` (Steps 13–14)

**Gap:** CLI `cli.ts` never passes a `sourceName` into `execute()`, so `--> file:line:col` is lost. REPL uses no `<repl:N>` source naming. `*e` is stored as a plain string, not a structured diagnostic.

**Tasks:**
- [ ] Update `cli.ts` to pass script path as `sourceName` to `interpreter.execute()`
- [ ] Update `repl.ts` to use `<repl:N>` as source name and store structured diagnostic in `*e`
- [ ] Add `diagnostic?` to `ConfigError` in `src/error/types.ts` (currently only on `EvalError`)

**Relevant files:**
- `src/tlisp/cli.ts` (line 48 — pass sourceName)
- `src/tlisp/repl.ts` (lines 95-97, 117, 124, 135)
- `src/error/types.ts` (add `diagnostic?` to ConfigError)

---

### 12. T-Lisp Diagnostics: LSP .tlisp diagnostics (SPEC-009)

**Source:** `docs/specs/SPEC-009-tlisp-diagnostics-debugging.md` (Step 17)

**Gap:** `diagnosticToLSP` exists in `diagnostics.ts:98` but is never called anywhere. The existing LSP diagnostics surface is for TypeScript, not `.tlisp`.

**Tasks:**
- [ ] Wire `diagnosticToLSP` into the LSP diagnostics pipeline for `.tlisp` buffers
- [ ] Add `.tlisp` extension to the LSP language map
- [ ] Add integration test

**Relevant files:**
- `src/tlisp/diagnostics.ts` (line 98 — `diagnosticToLSP`)
- `src/editor/api/lsp-diagnostics.ts`
- `src/lsp/client.ts`

---

### 13. T-Lisp Diagnostics: Test coverage (SPEC-009)

**Source:** `docs/specs/SPEC-009-tlisp-diagnostics-debugging.md` (Testing section)

**Gap:** All 4 spec-required test files are absent: `tlisp-diagnostics.test.ts`, `tlisp-debugging.test.ts`, `tlisp-agent-observability.test.ts`, `tlisp-diagnostics-editor.test.ts`. Existing test files (tokenizer, parser, evaluator, interpreter, server-observability, server-client, repl) have zero diagnostic assertions.

**Tasks:**
- [ ] Create `test/unit/tlisp-diagnostics.test.ts` (diagnostic model, codes, LSP conversion, JSON serialization)
- [ ] Create `test/unit/tlisp-debugging.test.ts` (trace/untrace/trace-list, stack frames)
- [ ] Create `test/unit/tlisp-agent-observability.test.ts` (--eval --json, --diagnostics --json, --last-error --json, --backtrace --json)
- [ ] Create `test/integration/tlisp-diagnostics-editor.test.ts` (editor diagnostic ops, *T-Lisp Diagnostics* buffer)
- [ ] Update `test/unit/tokenizer.test.ts` with span/offset/invalid-char tests
- [ ] Update `test/unit/parser.test.ts` with `parseProgram`/sourceName tests
- [ ] Update `test/unit/evaluator.test.ts` with diagnostic/stack/backtrace assertions
- [ ] Update `test/unit/repl.test.ts` with `<repl:N>` and structured `*e` tests

**Relevant files:**
- `test/unit/tlisp-diagnostics.test.ts` (new)
- `test/unit/tlisp-debugging.test.ts` (new)
- `test/unit/tlisp-agent-observability.test.ts` (new)
- `test/integration/tlisp-diagnostics-editor.test.ts` (new)

---

### 14. UI Tests: Visual mode selection operations (SPEC-002)

**Source:** `docs/specs/SPEC-002-ui-test-suite-expansion.md` (Step 7)

**Gap:** `test/ui/tests/07_visual_mode.py` only tests enter→VISUAL and return→NORMAL. No selection-state query, visual yank/delete, or selection movement range assertions.

**Tasks:**
- [ ] Add visual mode selection movement tests (hjkl in visual, extends selection)
- [ ] Add visual yank test (yank selection, verify buffer text)
- [ ] Add visual delete test (delete selection, verify buffer text)
- [ ] Add selection-state query helper if not already available

**Relevant files:**
- `test/ui/tests/07_visual_mode.py`
- `test/ui/tmax_harness/operations.py` (may need selection helpers)

---

### 15. UI Tests: Editing operator operations (SPEC-002)

**Source:** `docs/specs/SPEC-002-ui-test-suite-expansion.md` (Step 8)

**Gap:** Missing `yank line`, `put`, `change`, and `count-prefix` as named harness operations. Undo test is deliberately weakened because daemon `buffer-insert` doesn't record undo history.

**Tasks:**
- [ ] Add `yank_line`, `put`, `change` helpers to `operations.py`
- [ ] Strengthen undo test — find a way to test undo via daemon that actually records history
- [ ] Add count-prefix operations to harness if missing

**Relevant files:**
- `test/ui/tmax_harness/operations.py`
- `test/ui/tests/09_undo_yank_delete.py`

---

### 16. UI Tests: Search & replace operations (SPEC-002)

**Source:** `docs/specs/SPEC-002-ui-test-suite-expansion.md` (Step 9)

**Gap:** Backward search, replace-current, replace-all, and cancel-replace are untested. Only forward search and no-match are covered.

**Tasks:**
- [ ] Add backward search test
- [ ] Add replace-current test
- [ ] Add replace-all test
- [ ] Add cancel-replace test

**Relevant files:**
- `test/ui/tests/11_search_replace.py`

---

### 17. UI Tests: Daily driver feature tests (SPEC-002)

**Source:** `docs/specs/SPEC-002-ui-test-suite-expansion.md` (Step 19)

**Gap:** Major-mode auto-detection, indentation behavior, dired, and custom-key-binding-from-init are neither tested nor documented as follow-up bugs.

**Tasks:**
- [ ] Add major-mode auto-detection test (open `.py` file, verify `python-mode`)
- [ ] Add indentation test (enter indent-triggering character, verify indent)
- [ ] Add dired test (open dired, navigate, verify buffer list)
- [ ] Add custom-key-binding-from-init test (load temp `init.tlisp` with custom binding, verify it works)
- [ ] Document any features deferred as follow-up bugs

**Relevant files:**
- `test/ui/tests/12_daily_drivers.py`

---

### 18. UI Tests: Window splitting via C-w keys (SPEC-010)

**Source:** `docs/specs/SPEC-010-ui-test-expansion.md` (Test 21)

**Gap:** `test/ui/tests/21_window_splitting.py` uses daemon-mode `(split-window ...)` calls, not the `C-w s/v/w/q` daemon-tmux key path the spec requires. Also registered in `DAEMON_TESTS` instead of `DAEMON_TMUX_TESTS`.

**Tasks:**
- [ ] Add a daemon-tmux test variant that sends `C-w s`, `C-w v`, `C-w w`, `C-w q` via tmux and verifies pane changes
- [ ] Move or duplicate the test into `DAEMON_TMUX_TESTS` in `run_python_suite.py`

**Relevant files:**
- `test/ui/tests/21_window_splitting.py`
- `test/ui/run_python_suite.py` (line 31 — move to DAEMON_TMUX_TESTS)

---

### 19. UI Tests: Config loading via real init.tlisp (SPEC-010)

**Source:** `docs/specs/SPEC-010-ui-test-expansion.md` (Test 22)

**Gap:** `test/ui/tests/22_config_loading.py` simulates init.tlisp behavior rather than loading a real `init.tlisp` via `--config-dir`/`XDG_CONFIG_HOME`.

**Tasks:**
- [ ] Update the test to create a temp directory, write an `init.tlisp` with a known side-effect, launch tmax with `--config-dir`, and verify the side-effect occurred

**Relevant files:**
- `test/ui/tests/22_config_loading.py`

---

### 20. Messages buffer: Read-only guard (SPEC-016)

**Source:** `docs/specs/SPEC-016-messages-emacs-parity.md` (US-4, acceptance criterion)

**Gap:** No read-only guard for `*Messages*` buffer. Users can edit the messages buffer directly.

**Tasks:**
- [ ] Add a read-only check when the current buffer is `*Messages*` in insert-handler, normal-handler, and command-handler
- [ ] Display a status message "Buffer is read-only" on edit attempt
- [ ] Add unit test

**Relevant files:**
- `src/editor/handlers/insert-handler.ts`
- `src/editor/handlers/normal-handler.ts`
- `src/editor/editor.ts` (buffer name check)

---

### 21. Save file: Add save-file RPC and client flags (SPEC-032)

**Source:** `docs/specs/SPEC-032-save-file.md`

**Gap:** The `save-buffer` crash was fixed, but the `save-file` JSON-RPC method and `--save`/`--save-as` tmaxclient flags were never added. Clients must use `--command save-buffer`.

**Tasks:**
- [ ] Add `save-file` JSON-RPC method to `server.ts` with optional `filename` param
- [ ] Add `--save` flag to `tmaxclient` (saves current buffer)
- [ ] Add `--save-as FILE` flag to `tmaxclient` (save-as to new path)
- [ ] Add unit test for `handleSaveFile`

**Relevant files:**
- `src/server/server.ts` (add `save-file` handler)
- `bin/tmaxclient` (add flags)

---

### 22. Markdown Org/Obsidian: Missing features (SPEC-039)

**Source:** `docs/specs/SPEC-039-markdown-org-obsidian-enhancements.md`

**Gap:** Multiple features across all 6 phases are missing or partial.

**Tasks:**

#### Phase 2 — Code block sessions
- [ ] Implement session evaluation (`shell-exec-session` is a stub, sessions Map never populated)

#### Phase 3 — Table formulas
- [ ] Add `mean`, `min`, `max`, `count` formula functions
- [ ] Add `%` modulo operator
- [ ] Add `@>$>` shorthand syntax

#### Phase 4 — Export engine
- [ ] Fix LaTeX `\item` outside `itemize`
- [ ] Change `markdown-export-dispatch` to use which-key popup instead of `read-string`

#### Phase 5 — YAML frontmatter
- [ ] Add `frontmatter` token type to tokenizer
- [ ] Implement `{{tags}}` template variable expansion
- [ ] Read templates from `~/.config/tmax/templates/*.md`

#### Phase 6 — Embeds
- [ ] Implement `markdown-follow-embed` for `![[file]]` syntax
- [ ] Implement inline display of embedded content

#### Phase 6 — Wiki-link navigation
- [ ] Implement `markdown-next-wiki-link` command (currently `]l`/`[l` are bound to heading nav, not wiki-links)
- [ ] Rebind `]l`/`[l` to wiki-link navigation

#### Phase 6 — Backlinks
- [ ] Implement unlinked mentions detection
- [ ] Add persistent JSON cache (currently in-memory Map only)

#### Phase 6 — Templates + note composer
- [ ] Implement rename preview
- [ ] Implement `markdown-move-note`

#### Test coverage
- [ ] Add tests for the 30+ acceptance criteria marked `[x]` but with zero test coverage

**Relevant files:**
- `src/tlisp/core/commands/markdown.tlisp`
- `src/tlisp/core/modes/markdown-mode.tlisp`
- `src/syntax/languages/markdown.ts`

---

### 23. Module system: Remove provide no-op and dead module-loader-standalone (SPEC-007)

**Source:** `docs/specs/SPEC-007-tlisp-module-system.md` (AC#9, AC#15)

**Gap:** `evalProvide` retained as no-op; `module-loader-standalone.ts` duplicates `module-loader.ts` and is dead code.

**Tasks:**
- [ ] (Covered by item 1 above — remove no-op `evalProvide`)
- [ ] Delete `src/tlisp/module-loader-standalone.ts` (or refactor to import from shared `module-loader.ts`)
- [ ] Verify no imports reference the standalone loader

**Relevant files:**
- `src/tlisp/module-loader-standalone.ts` (dead code)

---

### 24. Standalone T-Lisp: Import boundary guard + REPL smoke test (SPEC-008)

**Source:** `docs/specs/SPEC-008-standalone-tlisp-option-b.md` (Steps 9, 14)

**Gap:** No automated import-boundary guard test exists. No subprocess-level REPL smoke test.

**Tasks:**
- [ ] Add a test asserting `src/tlisp/` never imports `src/editor/*` (static check or grep-based test)
- [ ] Add a subprocess-level REPL smoke test: spawn `bin/tlisp`, send `(+ 1 2)`, assert `3`, send `(exit)`, assert clean exit
- [ ] Add dedicated unit tests for `getenv`/`current-time`/`exit`/`shell-command` sys primitives

**Relevant files:**
- `test/unit/tlisp-standalone-profile.test.ts` (add boundary assertion)
- `test/integration/tlisp-cli.test.ts` (add REPL subprocess test)
- `test/unit/tlisp-standalone-sys-ops.test.ts` (new)

---

### 25. Steep/Oolong: Wire into markdown-preview (SPEC-018, SPEC-021)

**Source:** `docs/specs/SPEC-018-markdown-major-mode.md`, `docs/specs/SPEC-021-steep-phase2-oolong.md` (Step 7)

**Gap:** `markdown-preview` in `markdown.tlisp:665` shells out to `glow` instead of using Oolong's `renderMarkdown`. The Oolong package exists standalone but is not wired into the editor.

**Tasks:**
- [ ] Update `markdown-preview` command to use Oolong's `renderMarkdown` (import from `src/steep/oolong/renderer.ts`)
- [ ] Fall back to `glow` only if Oolong rendering fails
- [ ] Add test asserting Oolong is used (not `glow`)

**Relevant files:**
- `src/tlisp/core/commands/markdown.tlisp` (line 665)
- `src/steep/oolong/renderer.ts`

---

### 26. Named Daemons (SPEC-043) — ENTIRELY UNIMPLEMENTED

**Source:** `docs/specs/SPEC-043-named-daemons.md`

**Gap:** Zero code exists. No named sockets, no `daemon-discovery.ts`, no `tmax ls`, no `--daemon=NAME`, no `*daemons*` buffer.

**Tasks:**

#### Phase 1
- [ ] Add `name` field to daemon lock file
- [ ] Implement `-d NAME` / `--daemon=NAME` in `bin/tmax`
- [ ] Named socket resolution via `name`

#### Phase 2
- [ ] Create `src/server/daemon-discovery.ts` with `listDaemons()`, `pruneStale()`
- [ ] Add `tmax ls` subcommand
- [ ] Add `--prune` flag
- [ ] Add `--json` output
- [ ] Add `list-daemons` and `prune-daemons` RPC methods

#### Phase 3
- [ ] Implement `*daemons*` virtual buffer
- [ ] Add `daemon-list` T-Lisp primitive

#### Phase 4
- [ ] Add unit tests for discovery

**Relevant files:**
- `src/server/daemon-discovery.ts` (new)
- `bin/tmax` (add `-d`, `ls`, `--prune`)
- `src/server/server.ts` (add name to lock)

---

### 27. Fikra AI: Multi-backend, threads, plan mode (SPEC-042) — Phases 3–5 UNIMPLEMENTED

**Source:** `docs/specs/SPEC-042-fikra-ai-harness.md`

**Gap:** Only Phase 1 (primitives) and Phase 2 (Claude backend, basic mode) are implemented. Phases 3–5 are entirely absent. Phase 1+2 patch review lists 5 CRITICAL + 4 REQUIRED bugs.

**Tasks:**

#### Phase 1+2 bug fixes (CRITICAL)
- [ ] C1: Ensure `alist-get` is defined and accessible
- [ ] C2: Ensure `intern`/`fboundp` are defined and accessible
- [ ] C3: Fix `http-request` boundary violation (hardcoded `fikra-http-complete`)
- [ ] C4: Replace `split-string` with `string-split`
- [ ] C5: Replace `string-match-p` with `string-match`
- [ ] R1: Fix `buffer-mode` → `editor-mode`
- [ ] R2: Add missing `buffer-current-line-text`
- [ ] R3: Add missing `buffer-exists-p`
- [ ] R4: Fix wrong Claude JSON path

#### Phase 3 — Multi-backend
- [ ] Add `fikra-backend-codex.tlisp`
- [ ] Add `fikra-backend-gemini.tlisp`
- [ ] Add `fikra-backend-ollama.tlisp`
- [ ] Add `fikra-backend-pi.tlisp`
- [ ] Implement backend selector UI
- [ ] Implement ghost text inline completion (`SPC a i`)

#### Phase 4 — Threads, checkpoints, worktrees, safety
- [ ] Create `fikra-thread.tlisp`
- [ ] Create `fikra-checkpoint.tlisp`
- [ ] Create `fikra-worktree.tlisp`
- [ ] Create `fikra-safety.tlisp`
- [ ] Add tests for each

#### Phase 5 — Plan mode, custom backends, persistence, modeline
- [ ] Implement `defworkflow` macro
- [ ] Add plan mode
- [ ] Add history persistence
- [ ] Add modeline indicator
- [ ] Add tests

**Relevant files:**
- `src/tlisp/core/fikra/fikra-mode.tlisp`
- `src/tlisp/core/fikra/fikra-adapter.tlisp`
- `src/tlisp/core/fikra/fikra-backend-claude.tlisp`
- `src/editor/tlisp-api.ts` (lines 1093–1267 — primitives)
- `src/tlisp/stdlib.ts` (verify alist-get, intern, fboundp definitions)

---

### 28. Vim Parity: Tier A bindings (SPEC-044)

**Source:** `docs/specs/SPEC-044-vim-parity-priority-recommendations.md`

**Gap:** Search bindings (`/`, `?`, `n`, `N`), macro bindings (`q`, `@`, `@@`) are not wired. Text object dispatch exists but full primitive coverage unverified.

**Tasks:**
- [ ] Add `/` binding to forward search (incremental search)
- [ ] Add `?` binding to backward search
- [ ] Add `n` binding to repeat search forward
- [ ] Add `N` binding to repeat search backward
- [ ] Add `q` for macro recording (rebind from `editor-quit` — use `:q` or `ZQ` instead)
- [ ] Add `@` for macro replay
- [ ] Add `@@` for last macro replay
- [ ] Verify all ~24 text object primitives are exposed in `text-objects-ops.ts`
- [ ] Add `test/unit/text-objects.test.ts` if missing

**Relevant files:**
- `src/tlisp/core/bindings/normal.tlisp` (line 149: `q` → `editor-quit`, needs rebinding)
- `src/tlisp/core/commands/motions.tlisp` (search bindings)
- `src/editor/api/text-objects.ts` (verify primitive coverage)

---

### 29. Vim Parity: Tier B mode extensions (SPEC-044)

**Source:** `docs/specs/SPEC-044-vim-parity-priority-recommendations.md`

**Gap:** Replace mode (`r{char}`, `R`), `.` repeat last change, `"x` register-prefix syntax are all unimplemented.

**Tasks:**
- [ ] Implement replace mode (`r` single char, `R` continuous)
- [ ] Create `src/editor/handlers/replace-handler.ts`
- [ ] Add `'replace'` to mode union in `mode-ops.ts`
- [ ] Implement `.` repeat last change command
- [ ] Implement `"x` register-prefix parser in vim dispatch
- [ ] Add tests for each

**Relevant files:**
- `src/editor/handlers/replace-handler.ts` (new)
- `src/editor/mode-state.ts` (add `'replace'` mode)
- `src/tlisp/core/commands/vim-dispatch.tlisp` (register prefix parser)
- `src/tlisp/core/bindings/normal.tlisp`

---

### 30. Vim Parity: Tier C new functionality (SPEC-044)

**Source:** `docs/specs/SPEC-044-vim-parity-priority-recommendations.md`

**Gap:** WORD/sentence/section motions, marks + jumplist, indent/case/format operators, OS clipboard bridge are all unimplemented.

**Tasks:**
- [ ] Add WORD motions (`W`, `B`, `E`, `ge`, `gE`)
- [ ] Add sentence motions (`(`, `)`)
- [ ] Add section motions (`[[`, `]]`)
- [ ] Add window-relative motions (`H`, `M`, `L`, `C-e`, `C-y`, `gj`, `gk`, `g_`)
- [ ] Implement marks (`m`, `'`, `` ` ``)
- [ ] Implement jumplist (`C-o`, `C-i`)
- [ ] Implement indent operators (`>`, `<`)
- [ ] Implement case operators (`~`, `gu`, `gU`, `g~`)
- [ ] Implement format operator (`=`)
- [ ] Implement OS clipboard bridge (`+`, `*` registers)
- [ ] Add tests for each

**Relevant files:**
- `src/tlisp/core/commands/motions.tlisp`
- `src/tlisp/core/commands/operators.tlisp`
- `src/tlisp/core/bindings/normal.tlisp`
- `src/editor/api/jump-ops.ts`
- `src/editor/api/register-ops.ts` or `clipboard-ops.ts` (new)

---

### 31. BUG-04/14: Runtime portability (Bun-specific APIs) — NOT FIXED

**Source:** `docs/specs/BUG-04-vim-normal-insert-modes.md`, `docs/specs/BUG-14-mode-detection-regression.md`

**Gap:** `src/editor/editor.ts` uses `import.meta.dir` (lines 109, 190, 1634, 1637) and `Bun.file(path)` (line 1608). `package.json` start/dev scripts use `node --import tsx` instead of `bun`. The editor cannot run under Node.js.

**Tasks:**
- [ ] Replace `import.meta.dir` with `fileURLToPath(new URL(import.meta.url))` or `path.resolve(__dirname, ...)`
- [ ] Replace `Bun.file(path)` with `fs.readFile(path, 'utf-8')` or a Bun/Node abstraction
- [ ] Update `package.json` scripts: `"start": "bun src/main.tsx"`, `"dev": "bun --watch src/main.tsx --dev"`
- [ ] Add a runtime-agnostic helper if needed
- [ ] Verify `bun run start README.md` loads bindings correctly

**Relevant files:**
- `src/editor/editor.ts` (lines 109, 190, 1608, 1634, 1637)
- `package.json` (lines 7-8)
- `src/main.tsx`

---

### 32. CHORE-04: Remaining items (P2 keymap migration, P3 editor split)

**Source:** `docs/specs/CHORE-04-system-improvements.md`

**Gap:** P2 (T-Lisp keymap migration — delete legacy `keyMappings`/`KeymapSync` from `editor.ts`) and P3 (split `editor.ts` into smaller modules) are not done. `editor.ts` is 3,181 lines.

**Tasks:**

#### P2 — Keymap migration
- [ ] Remove legacy `keyMappings` references from `editor.ts` (26 remaining)
- [ ] Remove `KeymapSync` references
- [ ] Remove `loadFallbackBindings` references
- [ ] Verify all keybindings are now defined via T-Lisp keymaps

#### P3 — Editor split
- [ ] Evaluate whether to split `editor.ts` (spec suggested `editor-api.ts`, `editor-keys.ts`, `editor-modes.ts`, `editor-render.ts`)
- [ ] Note: API builtins were already extracted to `src/editor/api/*.ts` — different decomposition than spec proposed
- [ ] Consider extracting remaining large sections (initialization, event handling, state management)

**Relevant files:**
- `src/editor/editor.ts` (3,181 lines)

---

### 33. CHORE-22: Remaining simplification items

**Source:** `docs/specs/CHORE-22-codebase-simplification.md`

**Gap:** 32 `as any` casts persist in fold API registrations (Task 3). Tasks 4c (foldRanges render mutation) and 4d (RenderContext object) are partially incomplete. Task 13 (which-key dead exports) unclear.

**Tasks:**
- [ ] Reduce `as any` casts in fold API to zero (Task 3)
- [ ] Verify `state.foldRanges` render references are mutation-free (Task 4c)
- [ ] Evaluate whether `RenderContext` object is needed for `renderSingleWindow` (Task 4d)
- [ ] Audit which-key exports and remove any dead ones (Task 13)

**Relevant files:**
- `src/editor/tlisp-api.ts` (32 `as any` casts in fold registrations)
- `src/frontend/render/buffer-lines.ts` (lines 507, 523 — foldRanges references)
- `src/editor/utils/which-key.ts`

---

### 34. Buffer completion: Fix hardcoded modified: false (SPEC-006)

**Source:** `docs/specs/SPEC-006-buffer-completion.md` (Step 14, "replace hardcoded `modified: false`")

**Gap:** Two spots in `server.ts` still hardcode `modified: false` (lines 347 and 1820).

**Tasks:**
- [ ] Replace hardcoded `modified: false` at `server.ts:347` with actual buffer modified state
- [ ] Replace hardcoded `modified: false` at `server.ts:1820` with actual buffer modified state
- [ ] Add test asserting modified state is factual

**Relevant files:**
- `src/server/server.ts` (lines 347, 1820)

---

### 35. Init file: Add unit tests (SPEC-025)

**Source:** `docs/specs/SPEC-025-init-file-refactor.md`

**Gap:** No unit tests for init file loading or `eval-init-file`.

**Tasks:**
- [ ] Create `test/unit/init-file.test.ts` testing `loadInitFile`, `evalInitFile`, `init-file-path`
- [ ] Test XDG default path resolution
- [ ] Test `--init-file` custom path override

**Relevant files:**
- `test/unit/init-file.test.ts` (new)
- `src/editor/editor.ts` (lines 1933-2007)

---

### 36. Workspace: Add T-Lisp workspace commands module (SPEC-040)

**Source:** `docs/specs/SPEC-040-workspace-system.md`

**Gap:** No `src/editor/api/workspace-ops.ts` exists. Workspace commands are only available via daemon RPC, not as T-Lisp functions.

**Tasks:**
- [ ] Create `src/editor/api/workspace-ops.ts` exposing T-Lisp workspace commands
- [ ] Wire into `tlisp-api.ts`
- [ ] Verify workspace operations are callable from T-Lisp `(eval ...)` via daemon

**Relevant files:**
- `src/editor/api/workspace-ops.ts` (new)
- `src/editor/tlisp-api.ts`
- `src/core/workspace.ts`

---

### 37. Workspace: Phase 3 validation (SPEC-040)

**Source:** `docs/specs/SPEC-040-workspace-system.md` (Step 15)

**Gap:** 7 timeout/perf test failures that pass in isolation. `bun run test:daemon` not verified green.

**Tasks:**
- [ ] Investigate and fix the 7 timeout/perf test failures
- [ ] Verify `bun test` full suite passes
- [ ] Verify `bun run test:daemon` passes

**Relevant files:**
- Test files referenced in SPEC-040 validation section

---

### 38. Website docs: MDX content files (SPEC-017)

**Source:** `docs/specs/SPEC-017-website-docs.md`

**Gap:** Content is authored directly in `page.tsx` files rather than as `.mdx` files in a `content/` directory. Structural deviation from spec.

**Tasks:**
- [ ] Evaluate whether to extract content to `.mdx` files
- [ ] If extracting: create `website/content/docs/*.mdx`, update page components to load from content
- [ ] This is low priority — functional output is correct

**Relevant files:**
- `website/app/docs/*/page.tsx`

---

## Validation Commands

Execute every command to validate the backlog is complete and accurate:

- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:src` — Verify no TypeScript errors in source
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:test` — Verify no TypeScript errors in tests
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test` — Run full test suite
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run build` — Verify build succeeds

### 38. `*daemon*` Event Buffer (SPEC-047)

**Source:** `docs/specs/SPEC-047-daemon-event-buffer.md`

**Summary:** Add a `*daemon*` virtual buffer (mirroring `*Messages*`) that records daemon connection lifecycle events (client connect/disconnect, type/name), replacing the two ad-hoc `console.log` calls in `src/server/server.ts` that intrude on the TUI render surface. Quiet by default; observable via `(switch-to-buffer "*daemon*")`. Complements SPEC-001's structured RPC observability without overlapping it.

**Key files:**
- `src/editor/editor.ts` — `daemonLog` ring + `logDaemonEvent()` + `*daemon*` buffer at startup
- `src/server/server.ts` — replace `console.log` (`:1024`, `:1118`) with `editor.logDaemonEvent()`
- `test/unit/daemon-event-buffer.test.ts` — ring/render/cap + `*Messages*` non-pollution

**Validation:**
- `bun run typecheck` and `bun run test:ui:renderer` pass
- `bun test test/unit/daemon-event-buffer.test.ts` passes
- End-to-end: `tmaxclient --keys` no longer prints `Client connected` on the TUI surface; events appear in `*daemon*`

## Notes

- Items are ordered by architectural impact — foundational issues (provide/featurep, key resolution, diagnostics) come first, then feature gaps, then polish
- Each item references the originating spec document for full context
- Items marked as "entirely unimplemented" (26, 27 Phase 3–5, 29, 30) represent significant new work
- BUG-04/14 (item 31) is a runtime portability fix that enables Node.js compatibility
- The RFC-001 Embark feature is explicitly DEFERRED and not included — revisit after completion stack is stable
- SPEC-044 items (28, 29, 30) reference SPEC-045+ for deferred items (ex ranges, surround, visual-block, insert niceties, :set, jump plugins, tags, gd/gf, :map/:registers)
