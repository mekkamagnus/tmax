# RFC-042: Agent-aware workspaces — the herdr-style UI (pre-fikra)

**Status:** Proposed 2026-11-27. §3 (the workspace/tab layer) is an OPEN DECISION — this RFC records the options; nothing in that layer is built until the user picks.

**Related:** RFC-014 (workspace system), RFC-014A (shell-mode — largely BUILT, see §2), SPEC-097, BUG-84, #351 (pty exit status — prerequisite), #362–#366 (this arc's issues), RFC-013/RFC-027 (fikra — the later package this prepares for)

---

## 1. Problem

tmax can already host agent TUIs (claude, codex) in terminal windows — verified live. What it cannot do is *supervise* them: there is no herdr-style surface where tabs are agent-aware (idle/working/blocked/done at a glance), no way to script pane control, and the workspace/tab hierarchy does not yet model "one tab = one agent session". This arc builds that oversight layer. It is deliberately scoped as the step **before** the full fikra package: everything here (panes, status detection, control verbs) is fikra's substrate, without fikra's hard parts (threads, approvals, backends, streaming).

## 2. What exists (verified 2026-11-27)

| Piece | Where | State |
|---|---|---|
| PTY terminal windows; claude/codex run in them | `terminal-manager.ts`, `shell.tlisp`, `shell-ops.ts`; SPEC-097 + BUG-84 | **Done** — all DoD checked, live e2e both tools |
| Per-terminal ANSI parser, screen buffer, scrollback | `src/core/pty.ts`, `terminal-manager.ts` | Done |
| Tab bar in the TUI | `renderTabBarAnsi`, `state.tabs` | Done — but a "tab" is **one buffer** (`contracts/editor.ts:201`: `Tab { id, label, buffer }`) |
| Named persisted workspaces | `WorkspaceManager` (`core/workspace.ts`): create/load/save/rename, content hashes, `~/.config/tmax/workspaces/`; one **active** per daemon; client `--workspace NAME` | Done |
| Workspace restore swaps windows+tabs in place | `editor.ts` `applyUpdate(SetWindows/SetTabs/...)` | Done |
| Multi-load hooks | `getLoaded`/`isLoaded`/`getLoadedNames` on WorkspaceManager | Present, unused for live switching |
| Terminals | per-editor (`apiContext.terminalManager`, #201) | Done; no per-tab ownership concept |
| Process primitives | `make-process` `:cwd/:env`/filters/sentinels; `comint.tlisp` | Done (fikra-hardened) |
| Daemon RPC + `tmaxclient`; `*daemon*` lifecycle buffer | server, client | Done; no pane/tab verbs |
| Agent-status detection | — | **Nothing** (no `processState`/`agentStatus` anywhere in `src`) |

## 3. The workspace/tab layer — OPEN DECISION

herdr's hierarchy is workspace (project context) → tab (subcontext) → pane (terminal). tmax's current hierarchy is workspace (persisted session) → buffer-tab → window. The options:

**A. Grow `Tab` into a layout-tab.** A tab owns a window tree + its terminals, over the shared buffer set; switching tabs swaps layout (the workspace-restore path already does exactly this shape of swap).
*Pros:* reuses restore machinery and the rendered tab bar; one editor, one T-Lisp session. *Cons:* model surgery on a deeply-wired type; all tabs share one buffer list (cross-tab noise); per-tab terminal ownership is new.

**B. Workspaces are the herdr tabs.** Keep the hierarchy; make fast workspace switching real (hold several loaded), render the tab bar over workspaces, give each its own terminals/editor.
*Pros:* WorkspaceManager already persists/names/hashes; isolation per tab is natural; `--workspace` exists. *Cons:* heavier than a throwaway tab; two "tab" concepts to reconcile; switching cost unless multi-live.

**C. Daemon-level sessions, one Editor per herdr tab.** The true herdr model: N editors in one daemon, TUI attaches to one, daemon-level metadata drives the bar.
*Pros:* exact herdr semantics; per-tab agent state. *Cons:* biggest step; multi-editor daemons are historically the buggiest area (the fikra separate-editor-session lessons); cost per tab.

**D. Hybrid, staged.** herdr-tab = layout-tab (A's runtime shape) inside a named persisted workspace; a tab can later be *promoted* to its own workspace/editor (B/C) when it needs isolation. herdr mapping: herdr-workspace ≈ tmax workspace, herdr-tab ≈ layout-tab, herdr-pane ≈ window/terminal.
*Pros:* smallest first step with an upgrade path per tab; persistence comes from the workspace layer untouched. *Cons:* two concepts must stay honestly named (buffer-tab vs session-tab) or the UI confuses them.

**Recommendation:** D, staged — but this is the decision this RFC exists to take. Recorded in #363; blocked on it.

## 4. Agent-status detection (the genuinely new engine)

Per terminal/pane: (1) foreground process identification on PTY spawn (`claude`, `codex`, `zsh`…); (2) output-pattern classification into idle / working / blocked / done / unknown — spinner and "Working…" lines → working; permission dialogs ("Allow…? ❯ 1. Yes") → blocked; prompt-at-rest → idle; child exit → done; (3) optional rich parsing of the agent's own statusline row (model, `ctx:%`) for the tab label. Testable from recorded output fixtures (the fikra suite pattern). Depends on **#351** (real exit status) for done-detection.

## 5. Status chrome

Tab label enrichment: status glyph/color + process name (+ model/ctx when parsed); status-line segment for the focused terminal. Sidebar (herdr's agent section) explicitly deferred.

## 6. Control surface (the automation verbs)

Daemon RPC + `tmaxclient` subcommands: tab/workspace create/close/rename/list/focus; pane `send-text`/`send-keys`/`read`; `wait output`; `wait agent-status`. This is what lets a lead tab drive worker tabs inside tmax — the workflow herdr hosts today. RPC plumbing exists; the verbs are new.

## 7. Terminal UX finishing

RFC-014A's `C-\` normal mode over scrollback (scroll, `/` search, `y y` yank). Verify what BUG-84 left in place and finish it — this is the "read a busy pane" capability.

## 8. Dependencies and out of scope

**Dependency:** #351 (platform-health arc). **Out of scope:** everything fikra (threads, turns, approvals, backends, streaming, checkpoints), external openers, file previews, theming.

## 9. Decomposition

| Issue | Unit |
|---|---|
| #362 | Agent-status detection engine (§4) |
| #363 | Workspace/tab layer — decide §3, then implement (BLOCKED on the decision) |
| #364 | Status chrome (§5) |
| #365 | Control verbs over RPC + tmaxclient (§6) |
| #366 | Terminal normal-mode UX finish (§7) |

Sequencing: #366 and #362 are decision-independent and can go first; #363 gates #364 and most of #365.
