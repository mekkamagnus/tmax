# docs/adrs/ — Architecture Decision Records

Records of significant architectural decisions. Each ADR describes the context, decision, and consequences. Template: [adr-template.md](adr-template.md). Workflow guide: [adr-workflow.md](../adr-workflow.md).

Ordered most-recent first (highest ADR number = most recent decision). Topic groupings preserved within each section.

## Recent — Editor Functional Rewrite, adw Goal Mode (ADR 0112, 0111)

| File | Decision | Related |
|------|----------|---------|
| [ADR-0112-adw-build-goal-mode.md](ADR-0112-adw-build-goal-mode.md) | adw build `/goal` mode — in-session iteration loop with two-layer (inner Claude / outer orchestrator) retry model; BUG-23 typecheck-gate skip on `goal-exhausted` | CHORE-40, BUG-23, [ADR-0108](ADR-0108-adw-compile-gate-and-feedback-integrity.md), [ADR-0094](ADR-0094-adw-pipeline-architecture.md), RFC-023 |
| [ADR-0111-editor-functional-elm-architecture.md](ADR-0111-editor-functional-elm-architecture.md) | Editor functional rewrite — Elm Architecture (`EditorModel` / `update` / `Cmd`) threading state through the `State<S,A>` monad; strangler-pattern 7-phase migration | CHORE-39, [ADR-0098](ADR-0098-tlisp-fp-foundations.md), rules/functional-programming.md |

## Recent — Resume-Worktree Validation, Server Stale-Lock Reclaim, Compile Gate (ADR 0110, 0109, 0108, 0107, 0106, 0105, 0101-0104)

| File | Decision | Related |
|------|----------|---------|
| [ADR-0110-server-reclaim-stale-but-served-lock.md](ADR-0110-server-reclaim-stale-but-served-lock.md) | Server reclaims a live-but-not-serving daemon lock (probeDaemon + socket-exists, not pid-alive alone) | [ADR-0103](ADR-0103-server-test-socket-leak-fix.md), BUG-16 |
| [ADR-0109-adw-resume-worktree-validation.md](ADR-0109-adw-resume-worktree-validation.md) | adw resume validates the recorded worktree via `git worktree list --porcelain` (not `existsSync`), refuses wrong-repo/wrong-branch, recreates from recorded `base_sha` | BUG-20, [SPEC-065](../specs/SPEC-065-adw-worktree-isolation.md), [ADR-0094](ADR-0094-adw-pipeline-architecture.md), [ADR-0108](ADR-0108-adw-compile-gate-and-feedback-integrity.md), BUG-18 |
| [ADR-0108-adw-compile-gate-and-feedback-integrity.md](ADR-0108-adw-compile-gate-and-feedback-integrity.md) | adw compile gate (`typecheck` in build) + hard-fail tier for import-time failures + feedback-channel integrity check | [ADR-0094](ADR-0094-adw-pipeline-architecture.md), [ADR-0101](ADR-0101-adw-test-pipeline-stage.md), [ADR-0104](ADR-0104-test-stage-wall-clock-timeout.md), SPEC-065, BUG-20, BUG-18 |
| [ADR-0107-api-529-rate-limit-retry.md](ADR-0107-api-529-rate-limit-retry.md) | Dispatcher-level 529 retry with exponential backoff (30s/60s/120s) on LLM gateway overload | BUG-18, [SPEC-065](../specs/SPEC-065-adw-worktree-isolation.md), [RFC-021](../rfcs/RFC-021-remote-adw-dispatch.md) |
| [ADR-0106-watchdog-resume-all-gap-disabled-default.md](ADR-0106-watchdog-resume-all-gap-disabled-default.md) | Watchdog auto-launch disabled by default (`--watchdog` to opt in) — resume-all design gap blindly re-ran abandoned specs | SPEC-066, [ADR-0101](ADR-0101-adw-test-pipeline-stage.md) |
| [ADR-0105-test-isolation-policy.md](ADR-0105-test-isolation-policy.md) | Unit tests must use per-test temp dirs, never the real `agents/` (or any production) directory | BUG-17, [ADR-0103](ADR-0103-server-test-socket-leak-fix.md), [ADR-0101](ADR-0101-adw-test-pipeline-stage.md) |
| [ADR-0104-test-stage-wall-clock-timeout.md](ADR-0104-test-stage-wall-clock-timeout.md) | Test-stage wall-clock timeout (20 min) + process-tree kill (`detached` + `kill -pgid`) | [ADR-0101](ADR-0101-adw-test-pipeline-stage.md), [ADR-0103](ADR-0103-server-test-socket-leak-fix.md), SPEC-066 |
| [ADR-0103-server-test-socket-leak-fix.md](ADR-0103-server-test-socket-leak-fix.md) | Server-test socket-leak fix — `connectWithTimeout` + `forceShutdown` + `afterEach` cleanup (BUG-16) | BUG-16, [ADR-0101](ADR-0101-adw-test-pipeline-stage.md), [ADR-0104](ADR-0104-test-stage-wall-clock-timeout.md) |
| [ADR-0102-python-ui-harness-removal.md](ADR-0102-python-ui-harness-removal.md) | Python UI harness removed; tmax-use + playbooks is the sole e2e mechanism | SPEC-063, SPEC-061, [ADR-0101](ADR-0101-adw-test-pipeline-stage.md) |
| [ADR-0101-adw-test-pipeline-stage.md](ADR-0101-adw-test-pipeline-stage.md) | adw-test pipeline stage — 5th stage (plan→review→build→test→patch-review), unit gates e2e, resolve loop | SPEC-063, [ADR-0094](ADR-0094-adw-pipeline-architecture.md), [ADR-0102](ADR-0102-python-ui-harness-removal.md), [ADR-0103](ADR-0103-server-test-socket-leak-fix.md), [ADR-0104](ADR-0104-test-stage-wall-clock-timeout.md) |

## Recent — adw Pipeline, Browse-URL, Tooling, FP Foundations (ADR 0094-0100)

| File | Decision | Related |
|------|----------|---------|
| [ADR-0100-project-tooling-skills-bin-demos.md](ADR-0100-project-tooling-skills-bin-demos.md) | Project skills, bin launchers, demos, package.json scripts | [ADR-0094](ADR-0094-adw-pipeline-architecture.md), [ADR-0097](ADR-0097-trt-tlisp-native-test-framework.md) |
| [ADR-0099-expanded-tlisp-api.md](ADR-0099-expanded-tlisp-api.md) | Expanded T-Lisp API — file I/O, string ops, spec authoring primitives | [ADR-0094](ADR-0094-adw-pipeline-architecture.md), [ADR-0095](ADR-0095-browse-url-detection-dispatch.md) |
| [ADR-0098-tlisp-fp-foundations.md](ADR-0098-tlisp-fp-foundations.md) | T-Lisp FP foundations — adt.ts, writer.ts, monads.tlisp, evaluator/stdlib refactors | [ADR-0094](ADR-0094-adw-pipeline-architecture.md), [ADR-0097](ADR-0097-trt-tlisp-native-test-framework.md) |
| [ADR-0097-trt-tlisp-native-test-framework.md](ADR-0097-trt-tlisp-native-test-framework.md) | TRT — T-Lisp-native test framework replacing TS test-framework | [ADR-0098](ADR-0098-tlisp-fp-foundations.md), [SPEC-049](../specs/SPEC-049-trt-runtime-testing.md) |
| [ADR-0096-unified-observability-daemon-buffer.md](ADR-0096-unified-observability-daemon-buffer.md) | Unified observability — `*daemon*` event buffer, log-store, `*Messages*` readonly | [SPEC-055](../specs/SPEC-055-unified-observability.md), [ADR-0093](ADR-0093-daemon-event-buffer.md), [RFC-017](../rfcs/RFC-017-agent-activity-log.md) |
| [ADR-0095-browse-url-detection-dispatch.md](ADR-0095-browse-url-detection-dispatch.md) | Browse-URL — URL detection + browser dispatch (`gX`) | [SPEC-056](../specs/SPEC-056-browse-url.md), [ADR-0099](ADR-0099-expanded-tlisp-api.md) |
| [ADR-0094-adw-pipeline-architecture.md](ADR-0094-adw-pipeline-architecture.md) | adw pipeline architecture — 4-stage orchestrator with subprocess composition, shared workspace, resume | [ADR-0098](ADR-0098-tlisp-fp-foundations.md), [SPEC-057](../specs/SPEC-057-adw-patch-review.md), [SPEC-059](../specs/SPEC-059-adw-pipeline-loop.md), [SPEC-060](../specs/SPEC-060-adw-tmux-launcher.md), [RFC-017](../rfcs/RFC-017-agent-activity-log.md) |

## Recent — Daemon Event Buffer, Unified Dispatch, Operator+Find Chaining (ADR 0090-0093)

| File | Decision | Related |
|------|----------|---------|
| [ADR-0093-daemon-event-buffer.md](ADR-0093-daemon-event-buffer.md) | `*daemon*` virtual buffer for daemon connection lifecycle events | [SPEC-047](../specs/SPEC-047-daemon-event-buffer.md), [SPEC-001](../specs/SPEC-001-daemon-tmux-observability.md), [RFC-017](../rfcs/RFC-017-agent-activity-log.md), [ADR-0067](ADR-0067-daemon-tmux-observability.md) |
| [ADR-0091-unified-keymap-dispatch.md](ADR-0091-unified-keymap-dispatch.md) | Unified keymap-first normal-mode dispatch | [CHORE-23](../specs/CHORE-23-unify-key-dispatch.md), [ADR-0082](ADR-0082-vim-count-aware-dispatch.md) |
| [ADR-0090-operator-find-char-chaining.md](ADR-0090-operator-find-char-chaining.md) | Operator + find-char chaining via stash-and-resume | [SPEC-041](../specs/SPEC-041-operator-find-char.md), [ADR-0091](ADR-0091-unified-keymap-dispatch.md) |

## Recent — Workspace, Vim Counts, Markdown, Viewport (ADR 0081-0089)

| File | Decision | Related |
|------|----------|---------|
| [ADR-0089-tmax-cli-workspace-management.md](ADR-0089-tmax-cli-workspace-management.md) | tmax CLI workspace management flags | [ADR-0081](ADR-0081-workspace-system.md) |
| [ADR-0088-demo-runner-posix-shell-escaping.md](ADR-0088-demo-runner-posix-shell-escaping.md) | Demo runner POSIX shell escaping | — |
| [ADR-0087-keymap-mutable-set.md](ADR-0087-keymap-mutable-set.md) | Keymap mutable set for performance | [ADR-0006](ADR-0006-tlisp-keymap-data-structures.md) |
| [ADR-0086-which-key-per-instance-state.md](ADR-0086-which-key-per-instance-state.md) | Which-key per-instance state | [ADR-0047](ADR-0047-which-key-popup.md), [ADR-0081](ADR-0081-workspace-system.md) |
| [ADR-0085-horizontal-viewport-scrolling.md](ADR-0085-horizontal-viewport-scrolling.md) | Horizontal viewport scrolling infrastructure | [SPEC-037](../specs/SPEC-037-horizontal-viewport.md) |
| [ADR-0084-undo-pre-edit-cursor-restore.md](ADR-0084-undo-pre-edit-cursor-restore.md) | Undo pre-edit cursor restore | [ADR-0025](ADR-0025-undo-redo.md) |
| [ADR-0083-markdown-mode-commands.md](ADR-0083-markdown-mode-commands.md) | Markdown mode commands and navigation | [ADR-0078](ADR-0078-tlisp-special-forms-extensions.md) |
| [ADR-0082-vim-count-aware-dispatch.md](ADR-0082-vim-count-aware-dispatch.md) | Vim count-aware key bindings and dispatch | [ADR-0026](ADR-0026-count-prefix.md) |
| [ADR-0081-workspace-system.md](ADR-0081-workspace-system.md) | Workspace system (SPEC-040) | [ADR-0058](ADR-0058-frame-based-daemon-client.md) |

## Recent — Architecture, Language, and Packaging (ADR 0077-0079)

| File | Decision | Related |
|------|----------|---------|
| [ADR-0079-steep-top-level-package.md](ADR-0079-steep-top-level-package.md) | Steep promoted to top-level `src/steep/` package | [ADR-0059](ADR-0059-interchangeable-frontends.md) |
| [ADR-0078-tlisp-special-forms-extensions.md](ADR-0078-tlisp-special-forms-extensions.md) | T-Lisp `let*`, `while`, `dolist`, relaxed `if`/`substring` arity | [SPEC-018](../specs/SPEC-018-markdown-major-mode.md) |
| [ADR-0077-embedded-server-single-process.md](ADR-0077-embedded-server-single-process.md) | Embed socket server in single-process launch | [ADR-0018](ADR-0018-basic-server-client-infrastructure.md), [ADR-0058](ADR-0058-frame-based-daemon-client.md), [FEAT-01](../specs/FEAT-01-embedded-server.md) |

## Recent — Render, RPC, and Distribution (ADR 0070-0076)

| File | Decision | Related |
|------|----------|---------|
| [ADR-0076-syntax-highlighting-in-render-pipeline.md](ADR-0076-syntax-highlighting-in-render-pipeline.md) | Syntax highlighting in render pipeline | [SPEC-013](../specs/SPEC-013-native-ast-engine.md) |
| [ADR-0075-vim-style-status-line.md](ADR-0075-vim-style-status-line.md) | Vim-style status line layout | [CHORE-20](../specs/CHORE-20-status-line-vim-style.md) |
| [ADR-0074-frame-aware-rpc-methods.md](ADR-0074-frame-aware-rpc-methods.md) | Frame-aware RPC methods | [CHORE-19](../specs/CHORE-19-frame-aware-rpc.md) |
| [ADR-0073-daemon-capture-server-side-rendering.md](ADR-0073-daemon-capture-server-side-rendering.md) | Daemon capture / server-side rendering | [SPEC-014](../specs/SPEC-014-daemon-render-cache.md) |
| [ADR-0072-message-buffer-observability.md](ADR-0072-message-buffer-observability.md) | Message buffer observability | [ADR-0057](ADR-0057-messages-buffer-observability.md) |
| [ADR-0071-binary-distribution.md](ADR-0071-binary-distribution.md) | Binary distribution via GitHub Releases | [distribution-strategy.md](../memos/distribution-strategy.md) |
| [ADR-0070-marketing-website.md](ADR-0070-marketing-website.md) | Marketing website | [SPEC-017](../specs/SPEC-017-website-docs.md) |

## Recent — Completion, Async, and Daemon Observability (ADR 0066-0069)

| File | Decision | Related |
|------|----------|---------|
| [ADR-0069-tlisp-async-context-colored.md](ADR-0069-tlisp-async-context-colored.md) | T-Lisp async context coloring | [SPEC-012](../specs/SPEC-012-tlisp-async-primitives.md) |
| [ADR-0068-minibuffer-completion-stack.md](ADR-0068-minibuffer-completion-stack.md) | Minibuffer completion stack | [SPEC-006](../specs/SPEC-006-buffer-completion.md) |
| [ADR-0067-daemon-tmux-observability.md](ADR-0067-daemon-tmux-observability.md) | Daemon/tmux observability | [SPEC-001](../specs/SPEC-001-daemon-tmux-observability.md) |
| [ADR-0066-spec-035-daily-drivers.md](ADR-0066-spec-035-daily-drivers.md) | SPEC-035 daily drivers scope | [SPEC-004](../specs/SPEC-004-daily-driver-blocks.md) |

## Recent — Workflow and CLI Hardening (ADR 0061-0065)

| File | Decision | Related |
|------|----------|---------|
| [ADR-0065-tmax-tmux-workflow-hardening.md](ADR-0065-tmax-tmux-workflow-hardening.md) | tmax tmux workflow hardening | [CHORE-14](../specs/archive/CHORE-14-tmax-workflow-hardening.md) |
| [ADR-0064-interactive-find-file.md](ADR-0064-interactive-find-file.md) | Interactive find-file command | [CHORE-16](../specs/CHORE-16-file-completion.md) |
| [ADR-0063-cwd-independent-source-paths.md](ADR-0063-cwd-independent-source-paths.md) | CWD-independent source paths | — |
| [ADR-0062-daemon-client-cli-improvements.md](ADR-0062-daemon-client-cli-improvements.md) | Daemon/Client CLI improvements | — |
| [ADR-0061-remove-dead-ink-react-frontend.md](ADR-0061-remove-dead-ink-react-frontend.md) | Remove dead Ink/React frontend | [ADR-0001](ADR-0001-switch-to-deno-ink-main-entry.md) |

## Recent — Frontends, Diagnostics, Frames (ADR 0057-0060)

| File | Decision | Related |
|------|----------|---------|
| [ADR-0060-tlisp-diagnostics-system.md](ADR-0060-tlisp-diagnostics-system.md) | T-Lisp diagnostics system | [SPEC-009](../specs/SPEC-009-tlisp-diagnostics-debugging.md) |
| [ADR-0059-interchangeable-frontends.md](ADR-0059-interchangeable-frontends.md) | Interchangeable frontend architecture | [RFC-006](../rfcs/RFC-006-steep-ecosystem.md) |
| [ADR-0058-frame-based-daemon-client.md](ADR-0058-frame-based-daemon-client.md) | Frame-based daemon/client | [ADR-0018](ADR-0018-basic-server-client-infrastructure.md) |
| [ADR-0057-messages-buffer-observability.md](ADR-0057-messages-buffer-observability.md) | *Messages* buffer observability | [SPEC-016](../specs/SPEC-016-messages-emacs-parity.md) |

## Advanced Features (ADR 0040-0056)

| File | Decision | Related |
|------|----------|---------|
| [ADR-0056-init-file-refactoring.md](ADR-0056-init-file-refactoring.md) | Init file system refactoring | — |
| [ADR-0055-test-coverage-metrics.md](ADR-0055-test-coverage-metrics.md) | Test coverage metrics | [ADR-0017](ADR-0017-basic-coverage.md) |
| [ADR-0054-documentation-website.md](ADR-0054-documentation-website.md) | Documentation website | [SPEC-017](../specs/SPEC-017-website-docs.md) |
| [ADR-0053-plugin-submission.md](ADR-0053-plugin-submission.md) | Plugin submission process | [ADR-0052](ADR-0052-plugin-repository.md) |
| [ADR-0052-plugin-repository.md](ADR-0052-plugin-repository.md) | Plugin repository | [RFC-010](../rfcs/RFC-010-loom-package-manager.md) |
| [ADR-0051-apropos-command.md](ADR-0051-apropos-command.md) | Apropos command | — |
| [ADR-0050-describe-function.md](ADR-0050-describe-function.md) | Describe-function command | — |
| [ADR-0049-describe-key.md](ADR-0049-describe-key.md) | Describe-key command | — |
| [ADR-0048-command-documentation-preview.md](ADR-0048-command-documentation-preview.md) | Command documentation preview | — |
| [ADR-0047-which-key-popup.md](ADR-0047-which-key-popup.md) | Which-key popup | — |
| [ADR-0046-fuzzy-command-completion.md](ADR-0046-fuzzy-command-completion.md) | Fuzzy command completion | [ADR-0045](ADR-0045-minibuffer-input.md) |
| [ADR-0045-minibuffer-input.md](ADR-0045-minibuffer-input.md) | Minibuffer input system | [ADR-0046](ADR-0046-fuzzy-command-completion.md) |
| [ADR-0044-undo-tree.md](ADR-0044-undo-tree.md) | Undo tree visualization | [ADR-0025](ADR-0025-undo-redo.md) |
| [ADR-0043-window-resizing.md](ADR-0043-window-resizing.md) | Window resizing | [ADR-0042](ADR-0042-window-splitting.md) |
| [ADR-0042-window-splitting.md](ADR-0042-window-splitting.md) | Window splitting | [ADR-0043](ADR-0043-window-resizing.md) |
| [ADR-0041-lsp-diagnostics.md](ADR-0041-lsp-diagnostics.md) | LSP diagnostics | [ADR-0040](ADR-0040-lsp-client-connection.md) |
| [ADR-0040-lsp-client-connection.md](ADR-0040-lsp-client-connection.md) | LSP client connection | [ADR-0041](ADR-0041-lsp-diagnostics.md) |

## Vim Editing Features (ADR 0021-0039)

| File | Decision | Related |
|------|----------|---------|
| [ADR-0039-macro-persistence.md](ADR-0039-macro-persistence.md) | Macro persistence | [ADR-0038](ADR-0038-macro-recording.md) |
| [ADR-0038-macro-recording.md](ADR-0038-macro-recording.md) | Macro recording (q) | — |
| [ADR-0037-plugin-lifecycle-hooks.md](ADR-0037-plugin-lifecycle-hooks.md) | Plugin lifecycle hooks | [ADR-0036](ADR-0036-plugin-directory-structure.md) |
| [ADR-0036-plugin-directory-structure.md](ADR-0036-plugin-directory-structure.md) | Plugin directory structure | [ADR-0037](ADR-0037-plugin-lifecycle-hooks.md) |
| [ADR-0035-evil-integration.md](ADR-0035-evil-integration.md) | Evil-mode integration strategy | [RFC-003](../rfcs/RFC-003-emacs-parity-roadmap.md) |
| [ADR-0034-yank-pop.md](ADR-0034-yank-pop.md) | Yank pop (M-y) | [ADR-0033](ADR-0033-kill-ring-storage.md) |
| [ADR-0033-kill-ring-storage.md](ADR-0033-kill-ring-storage.md) | Kill ring storage | [ADR-0024](ADR-0024-yank-copy-operator.md), [ADR-0034](ADR-0034-yank-pop.md) |
| [ADR-0032-basic-text-objects.md](ADR-0032-basic-text-objects.md) | Basic text objects (iw, i(, i") | [ADR-0031](ADR-0031-visual-mode-selection.md) |
| [ADR-0031-visual-mode-selection.md](ADR-0031-visual-mode-selection.md) | Visual mode selection (v, V) | [ADR-0032](ADR-0032-basic-text-objects.md) |
| [ADR-0030-jump-commands.md](ADR-0030-jump-commands.md) | Jump commands (gg, G, H, M, L) | — |
| [ADR-0029-word-under-cursor-search.md](ADR-0029-word-under-cursor-search.md) | Word under cursor search (*, #) | [ADR-0028](ADR-0028-search-forward-backward.md) |
| [ADR-0028-search-forward-backward.md](ADR-0028-search-forward-backward.md) | Search (/ and ?) | — |
| [ADR-0027-change-operator.md](ADR-0027-change-operator.md) | Change operator (c) | [ADR-0023](ADR-0023-delete-operator.md) |
| [ADR-0026-count-prefix.md](ADR-0026-count-prefix.md) | Count prefix (3j, 5dd) | — |
| [ADR-0025-undo-redo.md](ADR-0025-undo-redo.md) | Undo/redo (u, C-r) | — |
| [ADR-0024-yank-copy-operator.md](ADR-0024-yank-copy-operator.md) | Yank/copy operator (y) | [ADR-0033](ADR-0033-kill-ring-storage.md) |
| [ADR-0023-delete-operator.md](ADR-0023-delete-operator.md) | Delete operator (d) | [SPEC-005](../specs/SPEC-005-vim-editing-motions.md) |
| [ADR-0022-line-navigation.md](ADR-0022-line-navigation.md) | Line navigation (0, ^, $) | [SPEC-005](../specs/SPEC-005-vim-editing-motions.md) |
| [ADR-0021-word-navigation.md](ADR-0021-word-navigation.md) | Word navigation (w, b, e) | [SPEC-005](../specs/SPEC-005-vim-editing-motions.md) |

## Server/Client & AI (ADR 0018-0020)

| File | Decision | Related |
|------|----------|---------|
| [ADR-0020-ai-agent-control.md](ADR-0020-ai-agent-control.md) | AI agent control protocol | [RFC-002](../rfcs/RFC-002-server-client-architecture.md) |
| [ADR-0019-advanced-client-commands.md](ADR-0019-advanced-client-commands.md) | Advanced daemon/client commands | [ADR-0018](ADR-0018-basic-server-client-infrastructure.md) |
| [ADR-0018-ui-test-automation-file-based-ipc.md](ADR-0018-ui-test-automation-file-based-ipc.md) | UI test automation via file-based IPC | — |
| [ADR-0018-basic-server-client-infrastructure.md](ADR-0018-basic-server-client-infrastructure.md) | Basic daemon/client infrastructure | [RFC-002](../rfcs/RFC-002-server-client-architecture.md), [ADR-0058](ADR-0058-frame-based-daemon-client.md) |

## Testing Framework (ADR 0009-0017)

| File | Decision | Related |
|------|----------|---------|
| [ADR-0017-basic-coverage.md](ADR-0017-basic-coverage.md) | Test coverage metrics | [ADR-0055](ADR-0055-test-coverage-metrics.md) |
| [ADR-0016-better-cli-output.md](ADR-0016-better-cli-output.md) | CLI test output formatting | — |
| [ADR-0015-async-testing.md](ADR-0015-async-testing.md) | Async test support | [SPEC-012](../specs/SPEC-012-tlisp-async-primitives.md) |
| [ADR-0014-test-suites.md](ADR-0014-test-suites.md) | Test suite organization | — |
| [ADR-0013-fixtures-system.md](ADR-0013-fixtures-system.md) | Test fixtures system | — |
| [ADR-0012-rich-assertions.md](ADR-0012-rich-assertions.md) | Rich assertion library | [ADR-0010](ADR-0010-essential-assertions.md) |
| [ADR-0011-basic-test-isolation.md](ADR-0011-basic-test-isolation.md) | Test isolation strategy | — |
| [ADR-0010-essential-assertions.md](ADR-0010-essential-assertions.md) | Essential test assertions | — |
| [ADR-0009-core-testing-framework-mvp.md](ADR-0009-core-testing-framework-mvp.md) | Core testing framework MVP | [RFC-001](../rfcs/RFC-001-trt-framework.md) |

## Core Architecture (ADR 0001-0008)

| File | Decision | Related |
|------|----------|---------|
| [ADR-0008-pure-tlisp-key-bind-function.md](ADR-0008-pure-tlisp-key-bind-function.md) | Pure T-Lisp key-bind function | [ADR-0006](ADR-0006-tlisp-keymap-data-structures.md) |
| [ADR-0007-core-bindings-in-tlisp-files.md](ADR-0007-core-bindings-in-tlisp-files.md) | Core bindings defined in T-Lisp files | [ADR-0003](ADR-0003-final-architecture-tlisp-first.md) |
| [ADR-0006-tlisp-keymap-data-structures.md](ADR-0006-tlisp-keymap-data-structures.md) | T-Lisp keymap data structures | [ADR-0007](ADR-0007-core-bindings-in-tlisp-files.md) |
| [ADR-0005-write-command-with-filename-support.md](ADR-0005-write-command-with-filename-support.md) | :w and :wq with filename support | [SPEC-006](../specs/SPEC-006-implementation-spec-save.md) |
| [ADR-0004-terminal-dimensions-hook-full-height-layout.md](ADR-0004-terminal-dimensions-hook-full-height-layout.md) | Terminal dimensions and full-height layout | — |
| [ADR-0003-final-architecture-tlisp-first.md](ADR-0003-final-architecture-tlisp-first.md) | T-Lisp-first architecture | [ADR-0007](ADR-0007-core-bindings-in-tlisp-files.md), [ADR-0008](ADR-0008-pure-tlisp-key-bind-function.md) |
| [ADR-0002-terminal-ui-implementation-event-loop.md](ADR-0002-terminal-ui-implementation-event-loop.md) | Terminal UI via event loop | [SPEC-011](../specs/SPEC-011-chore_terminal_ui_event_loop.md) |
| [ADR-0001-switch-to-deno-ink-main-entry.md](ADR-0001-switch-to-deno-ink-main-entry.md) | Switch to Deno Ink as main entry | [ADR-0061](ADR-0061-remove-dead-ink-react-frontend.md) |

## Template

| File | Description |
|------|-------------|
| [adr-template.md](adr-template.md) | Template for writing new ADRs |
