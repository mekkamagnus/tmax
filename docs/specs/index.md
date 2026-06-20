# docs/specs/ — Feature Specifications, Bugs, and Chores

Individual work items organized by type: SPEC (features), BUG (defects), CHORE (maintenance).

## Master Documents

| File | Description | Related |
|------|-------------|---------|
| [prd.md](prd.md) | Product Requirements Document — features, phases, architecture priorities | [ROADMAP.md](../ROADMAP.md), [srs.md](../srs.md), [technical-vision.md](../technical-vision.md) |
| [SPECS_INDEX.md](SPECS_INDEX.md) | Legacy index of all spec files (auto-generated) | — |

## Active Specs (Features)

| File | Title | Related |
|------|-------|---------|
| [SPEC-009-tlisp-diagnostics-debugging.md](SPEC-009-tlisp-diagnostics-debugging.md) | T-Lisp Diagnostics & Debugging | [ADR-0060](../adrs/ADR-0060-tlisp-diagnostics-system.md) |
| [SPEC-011-chore_terminal_ui_event_loop.md](SPEC-011-chore_terminal_ui_event_loop.md) | Terminal UI Event Loop | [ADR-0002](../adrs/ADR-0002-terminal-ui-implementation-event-loop.md) |
| [SPEC-012-tlisp-async-primitives.md](SPEC-012-tlisp-async-primitives.md) | T-Lisp Async Primitives | [ADR-0069](../adrs/ADR-0069-tlisp-async-context-colored.md) |
| [SPEC-013-native-ast-engine.md](SPEC-013-native-ast-engine.md) | Native AST Engine | [syntax-highlighting-ast-analysis.md](../memos/syntax-highlighting-ast-analysis.md) |
| [SPEC-014-daemon-render-cache.md](SPEC-014-daemon-render-cache.md) | Daemon Render Cache & Frame Capture | [ADR-0073](../adrs/ADR-0073-daemon-capture-server-side-rendering.md) |
| [SPEC-016-messages-emacs-parity.md](SPEC-016-messages-emacs-parity.md) | Emacs-Parity *Messages* Buffer | [ADR-0057](../adrs/ADR-0057-messages-buffer-observability.md), [ADR-0072](../adrs/ADR-0072-message-buffer-observability.md) |
| [SPEC-017-website-docs.md](SPEC-017-website-docs.md) | Website Documentation Section | [ADR-0054](../adrs/ADR-0054-documentation-website.md), [ADR-0070](../adrs/ADR-0070-marketing-website.md) |
| [SPEC-018-markdown-major-mode.md](SPEC-018-markdown-major-mode.md) | Markdown Major Mode | — |
| [SPEC-019-demo-playbook-runner.md](SPEC-019-demo-playbook-runner.md) | Demo Playbook Runner | — |
| [SPEC-001-daemon-tmux-observability.md](SPEC-001-daemon-tmux-observability.md) | Daemon/Tmux Observability | [ADR-0067](../adrs/ADR-0067-daemon-tmux-observability.md) |
| [SPEC-002-ui-test-suite-expansion.md](SPEC-002-ui-test-suite-expansion.md) | Expanded UI Test Suite | [ADR-0018](../adrs/ADR-0018-ui-test-automation-file-based-ipc.md) |
| [SPEC-003-minor-mode-system.md](SPEC-003-minor-mode-system.md) | Lisp-First Mode and Editor Policy System | — |
| [SPEC-004-daily-driver-blocks.md](SPEC-004-daily-driver-blocks.md) | Daily Driver Blocking Features | [ADR-0066](../adrs/ADR-0066-spec-035-daily-drivers.md) |
| [SPEC-005-vim-editing-motions.md](SPEC-005-vim-editing-motions.md) | Full Vim Editing & Motions | — |
| [SPEC-006-buffer-completion.md](SPEC-006-buffer-completion.md) | Buffer Completion and Reusable Minibuffer | [ADR-0068](../adrs/ADR-0068-minibuffer-completion-stack.md) |
| [SPEC-007-tlisp-module-system.md](SPEC-007-tlisp-module-system.md) | T-Lisp Module System | [RFC-005](../rfcs/RFC-005-tlisp-module-system.md), [module-system-gap-analysis.md](../memos/module-system-gap-analysis.md) |
| [SPEC-008-standalone-tlisp-option-b.md](SPEC-008-standalone-tlisp-option-b.md) | Standalone T-Lisp Runtime | [standalone-tlisp-gap-analysis.md](../memos/standalone-tlisp-gap-analysis.md) |
| [SPEC-010-ui-test-expansion.md](SPEC-010-ui-test-expansion.md) | UI Test Suite Expansion (Tests 17-24) | — |
| [SPEC-015-render-visual-tests.md](SPEC-015-render-visual-tests.md) | Render Visual Tests | — |

## Active Specs — RFC-001 (trt) Implementation

RFC-001 (TRT framework) is implemented across five sequentially-dependent specs. See
[RFC-001](../rfcs/RFC-001-trt-framework.md) for the design and the improvement → spec map.

| File | Title | Phase | Related |
|------|-------|-------|---------|
| [SPEC-049-trt-runtime-testing.md](SPEC-049-trt-runtime-testing.md) | trt — Self-Hosted Core + AI-Observable Runner | 1 + 2 | [RFC-001](../rfcs/RFC-001-trt-framework.md) |
| [SPEC-050-trt-fixtures-suites-parametrized.md](SPEC-050-trt-fixtures-suites-parametrized.md) | trt — Fixtures, Suites & Parametrized Tests | 3 | [RFC-001](../rfcs/RFC-001-trt-framework.md), [SPEC-049](SPEC-049-trt-runtime-testing.md) |
| [SPEC-051-trt-async-snapshots-coverage.md](SPEC-051-trt-async-snapshots-coverage.md) | trt — Async, Snapshots & Coverage | 4 | [RFC-001](../rfcs/RFC-001-trt-framework.md), [SPEC-012](SPEC-012-tlisp-async-primitives.md) |
| [SPEC-052-trt-watch-tdd-mocking-bench-doctest.md](SPEC-052-trt-watch-tdd-mocking-bench-doctest.md) | trt — Watch/TDD, Mocking, Benchmarking & Doctest | 5 | [RFC-001](../rfcs/RFC-001-trt-framework.md) |
| [SPEC-053-trt-test-explorer-pilot-migration.md](SPEC-053-trt-test-explorer-pilot-migration.md) | trt — Test Explorer UI & Pilot Migration | 6 | [RFC-001](../rfcs/RFC-001-trt-framework.md), [SPEC-049](SPEC-049-trt-runtime-testing.md) |
| [SPEC-046-implementation-backlog.md](SPEC-046-implementation-backlog.md) | Implementation backlog — prioritized list of remaining features | — |
| [SPEC-047-daemon-event-buffer.md](SPEC-047-daemon-event-buffer.md) | `*daemon*` event buffer for daemon lifecycle events | [SPEC-055](SPEC-055-unified-observability.md), [ADR-0093](../adrs/ADR-0093-daemon-event-buffer.md) |
| [SPEC-048-adw-generic-e2e.md](SPEC-048-adw-generic-e2e.md) | adw generic e2e test runner | — |
| [SPEC-054-tlisp-common-lisp-parity-phases-1-2.md](SPEC-054-tlisp-common-lisp-parity-phases-1-2.md) | T-Lisp Common Lisp parity (phases 1–2) | — |
| [SPEC-058-tlisp-adw-portability-primitives.md](SPEC-058-tlisp-adw-portability-primitives.md) | T-Lisp adw-portability primitives (`append-file`, `json-encode`, `command-line-args`) | [RFC-018](../rfcs/RFC-018-tlisp-scripting-primitives.md), [CHORE-31-tlisp-fp-foundations.md](CHORE-31-tlisp-fp-foundations.md) |
| [SPEC-059-adw-pipeline-loop.md](SPEC-059-adw-pipeline-loop.md) | adw 4-stage pipeline (plan → review → build → patch-review) with build↔patch-review retry loop | [CHORE-30-adw-build.md](CHORE-30-adw-build.md), [SPEC-057-adw-patch-review.md](SPEC-057-adw-patch-review.md) |
| [SPEC-060-adw-tmux-launcher.md](SPEC-060-adw-tmux-launcher.md) | adw tmux launcher — run adw pipelines in the `tmax` tmux session (survives agent timeouts) | [SPEC-059-adw-pipeline-loop.md](SPEC-059-adw-pipeline-loop.md) |

## Bug Reports

| File | Title | Related |
|------|-------|---------|
| [BUG-01-daemon-client-broken-features.md](BUG-01-daemon-client-broken-features.md) | Daemon/Client Broken and Missing Features | [BUG-01-python-harness-result-wrapping.md](BUG-01-python-harness-result-wrapping.md) |
| [BUG-01-python-harness-result-wrapping.md](BUG-01-python-harness-result-wrapping.md) | Python Harness — Wrong T-Lisp API Names | [BUG-01-daemon-client-broken-features.md](BUG-01-daemon-client-broken-features.md) |
| [BUG-02-completion-buffer-switch.md](BUG-02-completion-buffer-switch.md) | Frame sync race in handleRenderState | — |
| [BUG-02-multiline-insert-and-tui-stale-state.md](BUG-02-multiline-insert-and-tui-stale-state.md) | Multiline Insert and TUI Stale State | — |
| [BUG-03-flaky-startup-module-exports.md](BUG-03-flaky-startup-module-exports.md) | Flaky test startup and module exports | — |
| [BUG-04-vim-normal-insert-modes.md](BUG-04-vim-normal-insert-modes.md) | Vim normal/insert modes broken from wrong directory | — |
| [BUG-05-demo-skill-visual-tmux.md](BUG-05-demo-skill-visual-tmux.md) | Demo skill outputs text instead of visual TUI | — |

## Chores

| File | Title | Related |
|------|-------|---------|
| [CHORE-09-python-query-layer.md](CHORE-09-python-query-layer.md) | Migrate UI Test Harness from Bash to Python | [CHORE-09-texinfo-docs.md](CHORE-09-texinfo-docs.md) |
| [CHORE-09-texinfo-docs.md](CHORE-09-texinfo-docs.md) | Create Texinfo Documentation | [CHORE-09-python-query-layer.md](CHORE-09-python-query-layer.md) |
| [CHORE-10-fix-type-errors-harden-ci.md](CHORE-10-fix-type-errors-harden-ci.md) | Fix All Type Errors and Harden CI | — |
| [CHORE-10-update-testing-suite.md](CHORE-10-update-testing-suite.md) | Update Testing Suite | — |
| [CHORE-11-fix-cursor-rendering.md](CHORE-11-fix-cursor-rendering.md) | Fix cursor rendering — block cursor | — |
| [CHORE-12-daemon-start-stop.md](CHORE-12-daemon-start-stop.md) | Harden Daemon Start/Stop Workflow | [CHORE-15-harden-daemon.md](CHORE-15-harden-daemon.md) |
| [CHORE-13-remove-ink-dead-code.md](CHORE-13-remove-ink-dead-code.md) | Remove Ink frontend and dead code | [ADR-0061](../adrs/ADR-0061-remove-dead-ink-react-frontend.md) |
| [CHORE-14-tmax-workflow-hardening.md](CHORE-14-tmax-workflow-hardening.md) | tmax Workflow Hardening | [ADR-0065](../adrs/ADR-0065-tmax-tmux-workflow-hardening.md) |
| [CHORE-15-harden-daemon.md](CHORE-15-harden-daemon.md) | Harden Daemon | [CHORE-12-daemon-start-stop.md](CHORE-12-daemon-start-stop.md) |
| [CHORE-16-file-completion.md](CHORE-16-file-completion.md) | Wire file completion into find-file | [ADR-0064](../adrs/ADR-0064-interactive-find-file.md) |
| [CHORE-17-test-suite-cleanup.md](CHORE-17-test-suite-cleanup.md) | Test Suite Cleanup | — |
| [CHORE-18-minibuffer-completion-spec.md](CHORE-18-minibuffer-completion-spec.md) | Consolidate Minibuffer Completion Spec | [ADR-0068](../adrs/ADR-0068-minibuffer-completion-stack.md) |
| [CHORE-19-frame-aware-rpc.md](CHORE-19-frame-aware-rpc.md) | Frame-Aware RPC Methods | [ADR-0074](../adrs/ADR-0074-frame-aware-rpc-methods.md) |
| [CHORE-20-status-line-vim-style.md](CHORE-20-status-line-vim-style.md) | Vim-Style Status Line Layout | [ADR-0075](../adrs/ADR-0075-vim-style-status-line.md) |
| [CHORE-25-adw-plan-dispatcher.md](CHORE-25-adw-plan-dispatcher.md) | adw-plan.ts — description → spec dispatcher (claude-driven) | [CHORE-26-adw-agent-module.md](CHORE-26-adw-agent-module.md) |
| [CHORE-26-adw-agent-module.md](CHORE-26-adw-agent-module.md) | Extract claude interface into adws-modules/agent.ts | [CHORE-25-adw-plan-dispatcher.md](CHORE-25-adw-plan-dispatcher.md) |
| [CHORE-27-adw-spec-review.md](CHORE-27-adw-spec-review.md) | adw-spec-review.ts — spec → reviewed spec (codex-driven) | [CHORE-29-adw-logging-refactor.md](CHORE-29-adw-logging-refactor.md) |
| [CHORE-28-adw-plan-fp-refactor.md](CHORE-28-adw-plan-fp-refactor.md) | adw-plan.ts functional refactor (TaskEither pipeline) | — |
| [CHORE-29-adw-logging-refactor.md](CHORE-29-adw-logging-refactor.md) | Split adw-state.json into state + per-agent events.jsonl | [CHORE-27-adw-spec-review.md](CHORE-27-adw-spec-review.md) |
| [CHORE-30-adw-build.md](CHORE-30-adw-build.md) | adw-build.ts — spec → implementation dispatcher (claude-driven) | [CHORE-26-adw-agent-module.md](CHORE-26-adw-agent-module.md) |
| [CHORE-31-tlisp-fp-foundations.md](CHORE-31-tlisp-fp-foundations.md) | T-Lisp FP foundations — make-promise + core/monads (verification of shipped RFC-018 Tier 1 Steps 1.4/1.5) | [RFC-018](../rfcs/RFC-018-tlisp-scripting-primitives.md), [SPEC-058-tlisp-adw-portability-primitives.md](SPEC-058-tlisp-adw-portability-primitives.md) |

## Completed Specs (Still in Active Directory)

| File | Title | Related |
|------|-------|---------|
| [SPEC-006-implementation-spec-save.md](SPEC-006-implementation-spec-save.md) | Enhanced :w and :wq Commands | [SPEC-007-design-save-functionality.md](archive/SPEC-007-design-save-functionality.md), [SPEC-008-implementation-spec-save-improved.md](archive/SPEC-008-implementation-spec-save-improved.md) |
| [SPEC-015-chore_ui_test_suite_tmux.md](SPEC-015-chore_ui_test_suite_tmux.md) | UI Test Suite - Active Tmux Session | — |
| [SPEC-032-save-file.md](SPEC-032-save-file.md) | Save File via Daemon | — |
| [SPEC-033-messages-buffer.md](SPEC-033-messages-buffer.md) | *Messages* Buffer | [SPEC-016-messages-emacs-parity.md](SPEC-016-messages-emacs-parity.md) |
| [SPEC-034-emacs-daemon-client-parity.md](SPEC-034-emacs-daemon-client-parity.md) | Emacs-style Daemon/Client Parity | [RFC-002](../rfcs/RFC-002-server-client-architecture.md) |

## Legacy/Superseded Specs (Still in Active Directory)

These are older iterations superseded by newer specs but not yet archived:

| File | Title | Note |
|------|-------|------|
| [SPEC-001-update-delete-notes.md](SPEC-001-update-delete-notes.md) | Update and Delete Notes | Early draft |
| [SPEC-002-spec-prompt-template.md](SPEC-002-spec-prompt-template.md) | Spec Prompt Template | Template, not a feature spec |
| [SPEC-003-core-editor.md](SPEC-003-core-editor.md) | Core Editor | Superseded by later specs |
| [SPEC-004-tlisp-core-bindings-migration.md](SPEC-004-tlisp-core-bindings-migration.md) | T-Lisp Core Bindings Migration | See SPEC-005, SPEC-007 |
| [SPEC-005-tlisp-centric-keybindings.md](SPEC-005-tlisp-centric-keybindings.md) | T-Lisp Centric Key Bindings | Superseded |
| [SPEC-007-design-save-functionality.md](SPEC-007-design-save-functionality.md) | Save Functionality Design | See SPEC-006 |
| [SPEC-008-implementation-spec-save-improved.md](SPEC-008-implementation-spec-save-improved.md) | Save Implementation Improved | See SPEC-006 |
| [SPEC-009-migrate-ui-to-deno-ink.md](SPEC-009-migrate-ui-to-deno-ink.md) | Migrate UI to Deno-ink | Obsolete — using Bun now |

## Archive

Completed and superseded specs: [archive/index.md](archive/index.md)
