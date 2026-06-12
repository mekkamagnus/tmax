# docs/rfcs/ — Requests for Comments

Technical proposals for significant features or architectural changes. Each RFC describes a problem, proposes a solution, and documents alternatives considered.

## Implemented

| File | Title | Description | Related |
|------|-------|-------------|---------|
| [RFC-001-trt-framework.md](RFC-001-trt-framework.md) | TRT Framework | T-Lisp testing framework (like Emacs ERT) with assertions, fixtures, suites | [ADRs 0009-0017](../adrs/index.md) |
| [RFC-002-server-client-architecture.md](RFC-002-server-client-architecture.md) | Server/Client Architecture | Daemon/client with JSON-RPC, AI agent control protocol | [ADR-0018](../adrs/ADR-0018-basic-server-client-infrastructure.md), [ADR-0058](../adrs/ADR-0058-frame-based-daemon-client.md), [SPEC-034](../specs/SPEC-034-emacs-daemon-client-parity.md) |
| [RFC-003-emacs-parity-roadmap.md](RFC-003-emacs-parity-roadmap.md) | Emacs Parity Roadmap | Plan for Emacs with Evil-mode parity | [ADR-0035](../adrs/ADR-0035-evil-integration.md) |
| [RFC-005-tlisp-module-system.md](RFC-005-tlisp-module-system.md) | T-Lisp Module System | defmodule, require-module, export, qualified imports | [SPEC-007](../specs/SPEC-007-tlisp-module-system.md), [module-system-gap-analysis.md](../memos/module-system-gap-analysis.md) |
| [RFC-007-ui-test-status.md](RFC-007-ui-test-status.md) | UI Test Status | UI testing infrastructure status report | [ADR-0018](../adrs/ADR-0018-ui-test-automation-file-based-ipc.md) |

## Planned

| File | Title | Description | Related |
|------|-------|-------------|---------|
| [RFC-004-tlisp-browser.md](RFC-004-tlisp-browser.md) | T-Lisp Browser | Browser-based T-Lisp REPL and visualization | — |
| [RFC-006-steep-ecosystem.md](RFC-006-steep-ecosystem.md) | Steep Ecosystem | Steep as independent TUI framework | [ADR-0059](../adrs/ADR-0059-interchangeable-frontends.md), [RFC-008](RFC-008-steep-bubbletea-gap-analysis.md) |
| [RFC-008-steep-bubbletea-gap-analysis.md](RFC-008-steep-bubbletea-gap-analysis.md) | Steep Bubbletea Gap Analysis | Gap analysis vs Bubbletea framework | [RFC-006](RFC-006-steep-ecosystem.md) |
| [RFC-009-elm-purity-gap-analysis.md](RFC-009-elm-purity-gap-analysis.md) | Elm Purity Gap Analysis | Path to full Elm architecture purity | [ADR-0003](../adrs/ADR-0003-final-architecture-tlisp-first.md) |

## Proposed

| File | Title | Description | Related |
|------|-------|-------------|---------|
| [RFC-010-loom-package-manager.md](RFC-010-loom-package-manager.md) | Loom Package Manager | Emacs/MELPA-style package manager for T-Lisp packages | [ADR-0052](../adrs/ADR-0052-plugin-repository.md), [ADR-0053](../adrs/ADR-0053-plugin-submission.md), [package-registry-options-analysis.md](../memos/package-registry-options-analysis.md), [prd.md](../specs/prd.md) |
| [RFC-011-org-markdown-gap-analysis.md](RFC-011-org-markdown-gap-analysis.md) | Markdown-mode Org-inspired Enhancements | Org-mode + Obsidian parity for markdown-mode: executable code blocks, subtree ops, wiki-links, embeds, backlinks, frontmatter, tag navigation, table formulas, export | [RFC-003](RFC-003-emacs-parity-roadmap.md), [SPEC-018](../specs/SPEC-018-markdown-major-mode.md) |
| [RFC-012-browse-url.md](RFC-012-browse-url.md) | browse-url — Terminal-Aware URL Handling | Umbrella RFC: layered URL handling with detection, resolution, terminal-aware rendering, active browsing, AI-guided web tasks | [RFC-004](RFC-004-tlisp-browser.md), [RFC-012A](RFC-012A-browse-url-mvp.md), [RFC-012B](RFC-012B-in-terminal-reading.md), [RFC-012C](RFC-012C-rich-rendering.md), [RFC-012D](RFC-012D-active-browsing.md) |
| [RFC-012A-browse-url-mvp.md](RFC-012A-browse-url-mvp.md) | browse-url MVP | URL detection, external browser dispatch, `gx`, contextual resolvers, structured errors | [RFC-012](RFC-012-browse-url.md) |
| [RFC-012B-in-terminal-reading.md](RFC-012B-in-terminal-reading.md) | In-Terminal Reading | Plaintext + Reader rendering, browse buffers, Vimium link hints, bookmarks, caching | [RFC-012](RFC-012-browse-url.md), [RFC-012A](RFC-012A-browse-url-mvp.md) |
| [RFC-012C-rich-rendering.md](RFC-012C-rich-rendering.md) | Rich Rendering | Structural a11y-tree + screenshot rendering, Kitty/Sixel/iTerm2 protocols, markdown preview | [RFC-012](RFC-012-browse-url.md), [RFC-012B](RFC-012B-in-terminal-reading.md) |
| [RFC-012D-active-browsing.md](RFC-012D-active-browsing.md) | Active Browsing (Experimental) | Persistent browser sessions, form interaction, browser automation, AI-guided browsing | [RFC-012](RFC-012-browse-url.md), [RFC-012B](RFC-012B-in-terminal-reading.md) |
| [RFC-013-fikra-ai-harness.md](RFC-013-fikra-ai-harness.md) | Fikra — AI Harness | Built-in multi-backend AI assistant (Claude Code, Codex, Gemini, Pi, Ollama) with project→thread→turn model, git checkpoints, per-action safety confirmations, T-Lisp-extensible prompts/workflows, and future extraction to Loom package | [RFC-010](RFC-010-loom-package-manager.md), [ADR-0020](../adrs/ADR-0020-ai-agent-control.md), [RFC-002](RFC-002-server-client-architecture.md) |
| [RFC-014-workspace-system.md](RFC-014-workspace-system.md) | Workspace System — Native tmux Replacement | Persistent named workspaces, scrollback buffers, window cross-workspace moves, agent-aware process monitoring, test/demo backend abstraction | [RFC-014A](RFC-014A-shell-mode.md), [RFC-014B](RFC-014B-project-mode.md), [RFC-002](RFC-002-server-client-architecture.md), [modes.md](../modes.md) |
| [RFC-014A-shell-mode.md](RFC-014A-shell-mode.md) | shell-mode — Interactive Terminal Emulator | PTY-backed terminal emulator in tmax windows: ANSI passthrough, scrollback, agent-aware process monitoring | [RFC-014](RFC-014-workspace-system.md), [RFC-014B](RFC-014B-project-mode.md), [RFC-013](RFC-013-fikra-ai-harness.md) |
| [RFC-014B-project-mode.md](RFC-014B-project-mode.md) | project-mode — Project Awareness | Project root detection, file discovery, project-wide search, workspace-project binding, `.tmax.project` config | [RFC-014](RFC-014-workspace-system.md), [RFC-014A](RFC-014A-shell-mode.md) |

## RFC Lifecycle

1. **Proposed** — Written and open for discussion
2. **Planned** — Accepted, scheduled for implementation
3. **Implemented** — Built and shipped
