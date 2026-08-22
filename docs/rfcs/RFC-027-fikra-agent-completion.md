# RFC-027: Fikra Agent Completion — from one-shot chat to a Codex/t3code/zcode-style agent

**Date:** 2026-08-19
**Status:** Proposed (rev 8 — rev 2 incorporated deltas confirmed against the [t3code](https://github.com/pingdotgg/t3code) source tree; revs 3–7 addressed codex spec-review rounds 1–5; rev 8 addresses round 6 — **final round; review loop stopped at 6** (12→11→8→10→6→8 issues) — (interactive-only default resolve policy closing the agent self-approval hole, fully generic token-mint with handler-owned validation, Codex `auto` degraded per the semantics rule, checkpoint ref retention + close-time diff export, exact capture command contract, platform-stated peer-credential role with token as primary control, session-continuity downgrade contract, `minor-mode-set-lighter` primitive))
**Related:** [RFC-013](RFC-013-fikra-ai-harness.md) (original Fikra design — this RFC completes it), [RFC-018](RFC-018-tlisp-scripting-primitives.md), [RFC-019](RFC-019-performance-audit.md) (latency discipline), [RFC-025](RFC-025-daemon-client-protocol-hardening.md), [ADR-0058](../adrs/ADR-0058-frame-based-daemon-client.md), [ADR-0020](../adrs/ADR-0020-ai-agent-control.md), [SPEC-065](../specs/SPEC-065-adw-worktree-isolation.md) (worktree precedent), [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (confirmed reference implementation)

## Issue board

Decomposed for burn-down as issues **#206–#225** (label `fikra`, phase labels `fikra-p0`…`fikra-p5`). Dependency spine: P0 primitives (#206–#211) → FAEP + threads + claude + replay + UI (#212–#216) → checkpoints (#217–#218) → approvals (#219–#220) → worktrees + thread machinery (#221–#222) → plan/codex/workflows (#223–#225).

## Summary

Fikra today is a chat skeleton: every message spawns a fresh `claude --print`, the
reply streams in as undifferentiated text, and nothing else exists — no session
continuity, no visibility into what the agent *did*, no approvals, no checkpoints,
no threads, no persistence. It is a walkie-talkie; the reference tools (Codex,
t3code, zcode) are **agents**: the model plans, explores the repo, edits files,
runs commands, and the harness mediates every action.

This RFC specifies the completion. Fikra becomes an **agent harness** built on the
agent CLIs it already wraps:

```
  user task (capture buffer)
      │
      ▼
  ┌─ agent turn ──────────────────────────────────────────┐
  │  claude/codex subprocess (--resume <session>)         │
  │   plan → tool calls (read/edit/bash) ⋯ → result        │
  │      │ streamed as normalized events (FAEP)            │
  │      ▼                                                │
  │  *Fikra* buffer: text + collapsed tool blocks +        │
  │  inline approval prompts  ← zcode (Allow/Reject/Always)│
  └──────────────┬────────────────────────────────────────┘
                 ▼
  checkpoint (git ref, non-invasive) + diff review   ← t3code
                 ▼
  iterate / revert any turn / handoff to worktree    ← Codex
```

Five architectural commitments distinguish this from "more of RFC-013":

1. **Fikra is a harness, not an agent** (D1). The agent loop — planning, tool use,
   context management — belongs to the CLIs. Fikra drives them, mediates
   permissions, renders the activity, and holds the accountability machinery.
2. **A normalized event protocol (FAEP)** (D2) between backends and UI. Threads
   are event-sourced JSONL logs; the chat buffer is a pure replay of events.
   This is what makes backend switching, re-opening, and CI testing possible.
3. **Process-per-turn with session resume** (D3), not long-lived bidirectional
   stdio sessions. Crash-safe, simple, and sufficient.
4. **Layered approvals** (D5): runtime-mode presets translated to CLI capability
   flags (always available), plus mid-turn interactive approvals routed through
   the daemon (Claude's `--permission-prompt-tool` via an MCP shim).
5. **Non-invasive git checkpoints** (D6): temp-index `commit-tree` refs that
   never touch the user's index or HEAD — fixing RFC-013's invasive
   `git add -A && git commit` approach.

Everything above the TypeScript primitives stays T-Lisp, per the architecture
rule: the TS additions in Phase 0 are generic (buffer-local keymaps,
`buffer-append`), not Fikra-specific.

## Current state — honest gap analysis

Shipped (commit `27ed324`, "Fikra Phase 2" — actually RFC-013 Phase 1 partial):

| Module | What it does | What it lacks |
|---|---|---|
| `mode.tlisp` | minor mode, SPC a bindings, backend discovery | nothing thread-aware |
| `adapter.tlisp` | backend registry, `funcall`-based dispatch | no capability negotiation, args never forwarded (`fikra-backend-call` drops `args`) |
| `backend-claude.tlisp` | spawns `claude --print -p <prompt>` | one-shot: no `--resume`, no `--verbose`, no tool events, no permission flags; context glued into the prompt string |
| `chat.tlisp` | `*Fikra*` buffer, token insert, turn status | single global thread; `RET`/`C-g` bound in the **global** normal keymap (every buffer); token insert is O(buffer) per token |
| `capture.tlisp` | org-capture-style compose popup | buffer-recreation branch has a `((member ...))` double-eval runtime bug (calls `member`'s result as a function); first-open path works |
| `context.tlisp` | context string builder | string-concat only; agent can't pull context on demand |
| `workflow.tlisp` | explain/fix/refactor/test prompts | one-shot wrappers, no thread integration |

Not started: threads, checkpoints, diffs, revert, approvals, runtime modes,
worktrees, project grouping, plan mode, session persistence, backend switching,
ghost text. Tests assert file existence and a couple of parse helpers — not
behavior. (All 7 modules do parse — verified directly with the tokenizer/
parser on 2026-08-20 — but the unit suite never loads them, so a parse
regression ships silently; module-load tests are a Phase 1 gate. This is the
"swallowed .tlisp parse error" failure mode already on record from BUG-60
postmortem work.)

## Architecture

```
┌─ UI layer (T-Lisp) ──────────────────────────────────────────┐
│ *Fikra* chat · capture · *Fikra-Diff* · *Fikra-Threads*      │
│ buffer-local keymaps · event renderer · modeline             │
├─ Harness layer (T-Lisp) ─────────────────────────────────────┤
│ thread/turn state machine · checkpoints · worktrees          │
│ approval policy + trust state · persistence                  │
├─ Event protocol: FAEP ───────────────────────────────────────┤
│ normalized agent events · append-only log · replay           │
├─ Adapter layer (T-Lisp) ─────────────────────────────────────┤
│ backend-claude · backend-codex · backend-replay (testing)    │
├─ TypeScript core primitives (already exist unless noted) ────┤
│ make-process · process-write · signal · http-request         │
│ shell-command · buffers/windows · keymaps                    │
└──────────────────────────────────────────────────────────────┘
        tmax-mcp-confirmation (generic MCP→daemon bridge, bin/, Phase 3)
```

### D1 — Harness over agent CLIs, not our own agent loop

Codex and Claude CLIs already implement the hard parts: the tool-use loop,
multi-step planning, context compaction, file search/edit tools, sandboxing.
Reimplementing that over raw HTTP APIs would be months of work for a worse
result (RFC-013 §Alternatives already concluded this; it holds even more
strongly now that the CLIs have matured).

What Fikra adds that the CLIs *don't* have:

- **An editor-native UI** — the agent transcript is a tmax buffer: navigable,
  searchable, yankable, scriptable.
- **Programmability** — every prompt, workflow, approval rule, and context
  source is a T-Lisp defvar/defun the user can rebind.
- **Project-scoped thread management** with cross-backend history (zcode model).
- **Accountability machinery** — checkpoints, per-turn diffs, revert (t3code
  model) — layered on top of whatever the backend did.
- **Remote control for free** — t3code ships mobile/web clients over a server
  to get this; fikra already *is* a daemon with thin clients (ADR-0058). Any
  `tmaxclient` — local tmux, SSH from a phone, a scripted RPC client — gets the
  full control surface without building a relay.

### D2 — FAEP: the Fikra Agent Event Protocol

Every backend's raw output is normalized into one event vocabulary. Events are
plists appended to the thread's log; the chat buffer is rendered by replaying
them.

| Event | Payload | Rendered as |
|---|---|---|
| `turn-start` | turn-id, backend, model, runtime-mode | `── turn 4 · claude · accept-edits ──` |
| `session` | session-id | (invisible; persisted for `--resume`) |
| `text-delta` | text chunk | appended assistant text |
| `thought` | text chunk | dim/collapsed reasoning block |
| `tool-call` | id, tool, summary (file+range / command / query) | one-line collapsed block, `TAB` expands |
| `tool-result` | id, ok, summary | completion mark on the block |
| `permission-request` | id, action, detail | inline `[y] Allow [n] Reject [a] Always` prompt |
| `permission-response` | id, decision | prompt resolved |
| `file-change` | path, +adds/−dels | link line under the turn |
| `turn-end` | status (completed/interrupted/error), duration | footer line (no checkpoint ref — see below) |
| `checkpoint-start` / `checkpoint-ready` / `checkpoint-error` | turn-n, ref (on ready), reason (on error) | async checkpoint lifecycle, settles *under* the turn footer |

Why this is the load-bearing decision:

- **Replay is rendering.** Re-opening a thread = re-render the log. No separate
  transcript format to keep in sync.
- **Backend switching mid-thread** works because the log is backend-agnostic;
  each turn records which backend ran it.
- **CI without API keys**: a `backend-replay` adapter reads recorded event logs
  (fixtures) and drives the identical UI/state machine paths (§Testing).
- **T-Lisp sees the stream**: hooks can match on events (e.g. flash the modeline
  on `permission-request`, auto-open the diff on `checkpoint-ready` — never on
  `turn-end`, which precedes checkpoint settle).
- **t3code converges on the same bet.** Its production `ProviderRuntimeIngestion`
  normalizes provider runtime streams into orchestration events over an
  event-sourced read model — commands → pure decider → persisted events →
  projection. FAEP is the same architecture at T-Lisp scale, independently
  validated against a shipped product. t3code also makes approvals, tool
  actions, and failures first-class timeline items ("activities") — FAEP's
  `tool-call`/`permission-request`/`file-change` events are that concept.

Log format: one JSON object per line in
`.tmax/fikra/threads/<id>/events.jsonl`; thread metadata (backend, session-id,
runtime mode, trust state, checkpoint refs) in `state.json` beside it. `.tmax/`
is gitignored. Persistence needs two primitives that do not exist today
(verified 2026-08-20): `json-encode` and `append-file` — both already
specified as RFC-018 Tier 1; Phase 0 lands them if RFC-018 hasn't. **The event
log is append-only forever** — revert and truncation are rendered as
tombstone events (§D6), never by rewriting the file; that's what keeps the
audit trail honest.

### D3 — Turn execution: process-per-turn + session resume

Each turn spawns one backend process; when it exits, the turn is over.

```lisp
;; sketch — claude adapter, turn N of thread T
(claude-spawn "--print" "--output-format" "stream-json" "--verbose"
              "--resume" (fikra-thread-session-id)     ; omitted on turn 1
              "--permission-mode" (fikra-claude-mode runtime-mode)
              <L2 flags when approvals are interactive>
              "-p" user-message)
```

- The first `system/init` event carries the `session-id`; it is stored in
  `state.json`. Subsequent turns resume it — conversation continuity without a
  persistent stdio protocol.
- The filter function parses JSONL → FAEP events → `fikra-event-emit` (append to
  log + render incrementally + bump revision so the TUI poll picks it up).
  **Adapters own per-process line buffering**: `make-process` invokes the
  filter on arbitrary stdout chunks, not lines — each adapter keeps a
  partial-line accumulator per process so JSON objects split across chunk
  boundaries reassemble. The replay fixtures deliberately include split-chunk
  transcripts to test this.
- **Filter callbacks are serialized per process (generic Phase 0 change).**
  Today `make-process` fires `ctx.evalTlisp` from the async stdout reader
  without awaiting it, so two chunks can interleave mid-eval. The fix is
  TS-side and generic: each process keeps a promise chain — every chunk's
  filter eval is appended to the previous one and runs to completion before
  the next begins. No T-Lisp timer or scheduler primitive is needed: within a
  serialized callback, the filter normalizes the chunk and calls
  `fikra-event-emit` synchronously (append log → render → revision bump, in
  order). Ordering is therefore by-construction; Phase 1 ordering tests pin
  rapid tool/text interleavings, and the replay fixtures include split-chunk
  transcripts.
- The sentinel fires `turn-end` when the process exits — the **authoritative**
  turn-end signal (t3code: "a turn ends when the session leaves `running`
  status"). Completion checkpoint capture is *async follow-up work*, not part
  of turn termination: it settles after the turn, and its failure or delay must
  never corrupt or extend turn state. The turn shows as complete immediately;
  the diff appears when the checkpoint reactor finishes.
- **The checkpoint reactor is itself process-based.** The turn sentinel emits
  `turn-end`, then spawns the capture (`git` via `make-process` with `:cwd` at
  the thread root); the capture's own sentinel emits `checkpoint-ready` or
  `checkpoint-error`. Captures form a single per-thread chain — turn N+1's
  baseline capture queues behind any unsettled capture of turn N — so refs are
  ordered without locks, while user input for turn N+1 is never blocked (the
  t3code discipline: turn end is authoritative, checkpoints trail).
- A crashed or killed process ends its turn; nothing leaks. This is the same
  reliability argument as the adw pipeline's one-subprocess-per-stage design.

A persistent bidirectional session (`--input-format stream-json`) is explicitly
deferred (§Open Questions) — it buys mid-turn user injection, which nothing here
needs.

**Session-continuity failure handling is part of the contract.** If the first
turn's stream yields no usable session id, or a later `--resume` is rejected
(CLI upgrade, expired session, backend quirk), the thread does *not* silently
lose history: the adapter falls back to stateless turns — each subsequent
prompt is prefixed with a compact FAEP-derived context summary (last N turns)
— emits a `session` event with `state: "downgraded"`, and the modeline drops
the session marker. Continuity is a capability the adapter reports
(`session-resume` in `capabilities`), re-probed per turn after any downgrade,
and resumed automatically once the CLI accepts again. Tests: fixture
transcripts with missing session events and rejected resumes.

### D4 — Adapter contract v2

RFC-013's three-function protocol (`available-p`/`chat`/`abort`) is upgraded:

```lisp
;; every backend module must provide:
(fikra-backend-<name>-available-p)          ; installed & ready
(fikra-backend-<name>-capabilities)         ; alist:
                                            ;  (interactive-approvals . t/nil)
                                            ;  (session-resume . t/nil)
                                            ;  (sandbox-presets . t/nil)
(fikra-backend-<name>-start-turn thread turn message)  ; spawn process per D3
(fikra-backend-<name>-abort)                ; signal the current process
;; normalization helpers may be shared (flickr of JSON → FAEP lives in the adapter)
```

`interactive-approvals` gates whether L2 (§D5) UI is offered for that backend or
whether safety falls back to L1 + turn-boundary review. `sandbox-presets` marks
backends (Codex) that enforce isolation themselves.

Flag translation is adapter-owned, so CLI surface drift is contained to one file
per backend. As of writing: Claude uses `--permission-mode` /
`--allowedTools` / `--disallowedTools` / `--permission-prompt-tool`; Codex uses
`--sandbox read-only|workspace-write|danger-full-access` with
`--ask-for-approval` policies, and `codex exec --json` (JSONL events) with
resume support. Adapters re-verify flags against the installed CLI version at
`available-p` time and report capabilities accordingly.

**Transports.** t3code's five drivers reduce to three transport families:
Claude's stream-json SDK, the `codex app-server` JSON-RPC, and **ACP (Agent
Client Protocol)** — the Zed-born standard several agent CLIs speak. Fikra's
adapter layer starts with the first two: `backend-claude` (stream-json per D3)
and `backend-codex` (`exec --json`, app-server if L2 approvals demand it). An
ACP adapter — one adapter buying OpenCode-, Cursor-, and Grok-class backends
nearly free — is a **future RFC, explicitly out of scope here** (§Phases).

**Normalization fixtures (Phase 1 deliverable).** Each adapter ships recorded
raw→FAEP fixtures that replay tests pin. Seed mappings:

- Claude stream-json: `system/init.session_id` → `session`; assistant content
  block `text` → `text-delta`; `tool_use{ id, name, input }` → `tool-call`
  (summary derived per tool — Edit/Write→path(+range), Bash→command line,
  Search→query); `user{ tool_use_id, is_error }` → `tool-result`;
  `result{ subtype, duration_ms }` → `turn-end` (error subtype → error status).
- Codex `exec --json`: agent message deltas → `text-delta`; exec command
  events → `tool-call`/`tool-result`; patch events → `file-change`; turn
  aborted / errored → `turn-end(interrupted|error)`; session header →
  `session`.

### D5 — Approval mediation, layered

**L1 — runtime-mode presets → CLI capability flags.** Always available, no
plumbing. Per-thread mode, changed mid-conversation (`SPC a m`); child threads
inherit their parent's mode. Four modes (t3code's set, confirmed from its
docs — RFC-013's "3 modes" folklore was one short):

| Fikra mode | Behavior | Claude flags | Codex flags |
|---|---|---|---|
| `approval-required` (= t3code *Supervised*) | ask before commands *and* file changes | `--permission-mode default` | `--sandbox workspace-write --ask-for-approval untrusted` |
| `auto-accept-edits` | edits flow, commands still ask | `--permission-mode acceptEdits` | `--sandbox workspace-write --ask-for-approval on-request` |
| `auto` | routine actions proceed, risky ones ask | `acceptEdits` + safe-set `--allowedTools` (read/search) | `--sandbox workspace-write --ask-for-approval on-request` |
| `full-access` | unattended until it asks a question | `--permission-mode bypassPermissions` | `--sandbox danger-full-access -a never` |

**The table is illustrative, not contractual.** Provider approval semantics do
not line up one-to-one (e.g. Codex `on-failure` runs first and asks only after
a failure — it does not mean "commands still ask"; Claude's real
`bypassPermissions` mode is stronger than any `--allowedTools` set). The
behavior column is the contract; each adapter owns a *tested* mapping from
behavior to its CLI's actual flags, and degrades explicitly: if a backend
cannot express a mode, it drops to the nearest stricter mode and the modeline
shows the effective mode, not the requested one. Mapping tests run against
**checked-in fixtures** (recorded flag sets per CLI version) so CI is
deterministic and never needs a Claude/Codex install; a live CLI probe is an
opt-in smoke test, not a gate.

`auto` is deliberately fuzzy at the edges — its enforcement is provider-specific
(t3code: Codex delegates routine approvals to an AI reviewer, Claude uses its
own auto mode, providers without an equivalent fall back to asking). Adapters
declare what they can implement via `capabilities`; if a backend cannot express
`auto`, it degrades to `approval-required` and the modeline says so.

**Fallback matrices are fixture-driven and exhaustive.** Strictness order:
`approval-required` < `auto-accept-edits` < `auto` < `full-access`;
"nearest stricter expressible" walks that order, nothing else. Each backend
ships a checked-in fixture of `{ requested, flags, effective-mode }` rows
covering *all four* requested modes — as of writing: Claude expresses all four
(`auto` ≈ `acceptEdits` + safe allowlist, effective-mode reported `auto*` as an
approximation); Codex expresses `approval-required`, `auto-accept-edits`, and
`full-access`, while requested `auto` **degrades to `auto-accept-edits`**
(`on-request`'s routine/risky split is an AI-reviewer behavior unverifiable
from the CLI surface — the semantics rule applies, so the fixture row records
the degradation); an OpenCode-class backend (future ACP) expresses only
`approval-required` and `full-access`, so `auto-accept-edits` and `auto` both
degrade to `approval-required`. **Fixtures prove adapter output, not provider
semantics** — so the capability probe also records the installed CLI's version
and `--help` surface alongside the fixture, and any mode whose *semantics*
can't be verified from that surface degrades to the nearest stricter
verifiable mode rather than being declared expressed by fixture row alone. CI
asserts adapter output against the fixture; live probes are opt-in smoke,
never gates.

> **Correction (2026-08-22, SPEC-219):** recording the actual installed
> surfaces overturned two assumptions above. Claude 2.1.195's
> `--permission-mode` grew a NATIVE `auto` choice (no acceptEdits
> approximation, no `auto*`). Codex-cli 0.147.0 REMOVED
> `--ask-for-approval` entirely; its surface is `--sandbox
> {read-only, workspace-write, danger-full-access}` plus `--approve-for-me`
> (approvals routed through automatic review — that IS `auto`) and
> `--dangerously-bypass-approvals-and-sandbox`. Both recorded backends
> therefore express all four modes; the semantics rule still governs
> (unknown backends and future surface gaps degrade), and expressibility is
> now DERIVED from the checked-in surface records rather than tabulated.

**Default-mode stance.** Fikra defaults to `approval-required` — a conscious
divergence from t3code, which defaults to *Full access*. t3code threads are
disposable workspaces behind a GUI; fikra threads start in the user's live
working tree inside their editor. An editor that mutates the working tree
unattended *by default* violates the tmax ethos. Checkpoints are the safety
net, not the permission. Users who want t3code behavior set it once in
`init.tlisp` (`setq fikra-default-runtime-mode "full-access"`).

**L2 — mid-turn interactive approvals (Claude-first).** The subprocess asks; the
user answers in the `*Fikra*` buffer; the agent proceeds. Plumbing:

```
claude subprocess
  │ MCP tool call: fikra_permission(tool_name, input)
  ▼
tmax-mcp-confirmation <socket>           ; generic MCP→daemon bridge (bin/)
  │ JSON-RPC to daemon (fixed method, schema-validated — no eval)
  ▼
daemon defers the RPC response ── T-Lisp fikra-approval-request
  │ permission-request event → *Fikra* buffer inline prompt
  ▼
[y] allow / [n] reject / [a] always-allow this action class
  │ keypress → T-Lisp → daemon resolves the deferred response
  ▼
shim returns MCP tool result → claude continues
```

- The shim is launched by `claude` itself via `--mcp-config` (Claude Code spawns
  the configured MCP server and talks stdio to it); it only bridges to the
  daemon. `claude` is invoked with `--permission-prompt-tool` naming the shim's
  tool — **but this hook is capability-gated, not assumed**: the installed
  `claude --help` (checked 2026-08-20) exposes `--permission-mode`,
  `--allowedTools`, `--mcp-config`, `--resume`, and stream formats, *not*
  `--permission-prompt-tool`. The adapter probes the CLI at `available-p` time
  and reports `interactive-approvals` accordingly. When the hook is absent,
  L2 degrades to L1 + turn-boundary review for that backend — the harness
  stays correct, only the real-time mediation is lost.
- **The deferred-confirmation RPC is a generic Phase 0 daemon primitive**, not
  Fikra plumbing: any subprocess mediation (approvals now; future: external
  tool confirmations) needs it. Full contract:
  - Method `confirmation/mediate` — request
    `{ id, source, correlation, kind, detail, timeout-ms }`, response
    `{ decision: "allow"|"reject"|"always", scope }`.
  - **Delivery fits the synchronous eval model and stays generic.** Handlers
    are registered, not hard-coded: `(confirmation-handler-register "source"
    "handler-fn")` maps a source name to a T-Lisp function. A mediate request
    carries its `source`; the daemon runs one bounded synchronous eval of the
    *registered* handler with `(id detail)` — for fikra that's
    `fikra-approval-enqueue` (registered in Phase 3; Phase 0 tests use a test
    handler) — then parks the RPC response (no blocking wait, no async
    T-Lisp, no callback into a running eval). Daemon RPC handling is
    serialized on its event loop, so enqueue / resolve / cancel can never
    interleave mid-eval. Resolution is an ordinary later eval:
    `(confirmation-resolve id decision)` / `(confirmation-cancel id)` —
    executed only on behalf of interactive clients (default policy,
    §Security). `confirmation-pending` lists unsettled ids.
    **First resolver wins**; later resolves of a settled id are no-ops — two
    attached clients racing on `y` produce one decision.
  - **Timeout resolves as reject. Cancellation resolves as reject**: turn
    interrupt, thread close, and daemon shutdown sweep all pending ids for
    that thread and reject them (the subprocess unblocks, never hangs).
  - **Correlation is an unforgeable token, and the primitive stays generic.**
    `(confirmation-token-mint "source" "scope")` returns an opaque one-time
    token bound to that source+scope — nothing in the daemon knows about
    threads or turns. Validation is handler-owned: at enqueue time the daemon
    calls the registered handler's `(handler-validate-token token context)`;
    *fikra's* handler decides whether the scope names a live thread+turn.
    Spawning stays T-Lisp-owned (D3): the adapter mints the token, writes the
    `--mcp-config` file itself (plain T-Lisp file I/O) pointing the CLI at
    `tmax-mcp-confirmation` with the token in its argv. The token never
    transits model/tool-controlled space. Every `confirmation/mediate` request
    must carry it; failed validation rejects the request *before any prompt is
    shown*. Where the platform exposes socket peer credentials they are checked
    as defense-in-depth: Linux `SO_PEERCRED`; on macOS the existing
    uid-scoped socket directory (`/tmp/tmax-<uid>/`, 0700) serves that role —
    the **token is the primary control on every platform**, and token tests
    (forged, stale, cross-turn) are the required gate; peer-credential tests
    run only where the mechanism exists.
  - The prompt reaches clients through the existing frame/revision flow
    (ADR-0058); schema-validated JSON only — the subprocess never supplies
    T-Lisp code.
- "Always allow" writes the action class into the thread's trust state *and* is
  translated to `--allowedTools` on subsequent turns, so trusted classes stop
  costing round trips entirely.
- This rides the existing daemon/client architecture (ADR-0058): the prompt
  reaches every connected TUI through the same frame/revision flow as everything
  else.

**Turn-boundary review is always on** regardless of level: checkpoint + diff
after every turn. L1/L2 prevent unwanted actions in real time (zcode); the
checkpoint reverts anything that slipped through (t3code).

### D6 — Checkpoints, non-invasive

RFC-013's `git add -A && git commit` mutates the user's index and HEAD —
unacceptable in Local mode. Instead, checkpoints are commit objects built on a
**temporary index**, leaving the working tree, index, and HEAD untouched:

**Exact capture command contract** (run with cwd = thread root; every
invocation is an argv array via `make-process` — no shell, no quoting; `HEAD`
args are omitted entirely on an unborn repo, which disables checkpointing
before we ever get here):

```
env   GIT_INDEX_FILE=<tmp>   rm -f <tmp>            ; fresh index each capture
git   --git-dir... add -A -- .                      ; vs the fresh index: tree
                                                    ; mirrors disk, respecting
                                                    ; gitignore; `-- .` is
                                                    ; root-relative from cwd
git   write-tree            → tree
git   commit-tree <tree> [-p HEAD] -m "fikra <thread> turn <n>"  → commit
git   update-ref refs/fikra/<thread>/<n> <commit>   ; atomic; the only step
                                                    ; whose failure isn't
                                                    ; ignorable cleanup
env   GIT_INDEX_FILE=<tmp>   rm -f <tmp>            ; always, success or fail
```

A fresh (empty) index is deliberate: `add -A` against it stages exactly the
disk state, so deletions since HEAD are captured by absence. Failure rules:
any step before `update-ref` fails → `checkpoint-error`, temp index removed,
no ref created, turn state untouched. `update-ref` is the commit point —
atomic in git; failure → `checkpoint-error` with git's message surfaced.

- Two refs per turn: `<n>-baseline` (before the agent runs) and `<n>` (after).
- Captures untracked files too (unlike `git stash create`).
- Per-turn diff: `git diff <n>-baseline <n> --stat -p` → `*Fikra-Diff*` buffer.
- Revert: the tree-diff inverse specified below; stale refs pruned. The event
  log is never truncated (tombstone model).
- In Worktree mode the same mechanism runs inside the worktree, where it is
  additionally isolated.
- **Capture command branches.** HEAD present → the sketch as written. Unborn
  HEAD → checkpointing disabled for the thread (below). Empty/no-change turn →
  still create the ref (tree equals baseline's; diff is empty — cheap).
  `git update-ref` failure → `checkpoint-error` event; the turn itself is
  unaffected (D3 decoupling).

**Dirty-tree attribution policy.** Baseline captures whatever is in the
working tree — including pre-existing user changes — so per-turn diffs are
always turn-relative (correct by construction). The one hole: user edits made
*during* a live turn land in the completion ref and are indistinguishable from
agent edits in that turn's diff. Policy (stated, not solved): fikra warns when
a buffer in the thread's project is modified while a turn runs; turn diffs may
include such concurrent edits; and revert's divergence check is therefore
**content-based** — any file whose working-tree content differs from the
completion ref at revert time aborts that file (report + stash offer),
regardless of who edited it. Temp-repo tests cover user-edits-during-turn for
both diff and revert.
- Refs are namespaced under `refs/fikra/` (not branches). **Retention:** refs
  live for the thread's entire lifetime — revert never prunes (the tombstoned
  turns' refs are precisely the audit record). At thread close, every
  checkpoint's diff is exported to `.tmax/fikra/threads/<id>/diffs/*.patch`
  (immutable files) *before* refs are pruned; `events.jsonl` + exported diffs
  remain the durable audit trail after the thread is gone. This reconciles the
  "checkpoints reconstruct exactly what changed" claim with eventual cleanup.

**Revert is tree-diff-based, not `git restore` alone.** `git restore --source`
overwrites modified paths but leaves files *created after* the checkpoint in
place — a silent revert failure. Correct revert computes the tree diff target
checkpoint → current completion checkpoint and applies the inverse per the
2×2 presence matrix (target × current working tree):

| | **present now** | **absent now** |
|---|---|---|
| **in target** | `git restore --source=<target-ref> -- <path>` | `git restore --source=<target-ref> -- <path>` (deletion undone) |
| **absent in target** | delete the path | no-op |

Plus two standing exclusions: paths *untracked and not in the completion ref*
(user's own new files) are untouched, and *ignored* paths are untouched (never
captured, §edge cases). The old "deleted-in-target → restore" and
"created-after → delete" bullets are superseded by the matrix: presence in the
target alone decides restore vs delete.

Before any destructive step, the **content-divergence check**: any path in
scope whose working-tree content differs from the completion ref aborts that
path with a per-file report, and the divergent content is preserved as a
re-appliable patch produced by exactly
`git diff --binary <completion-ref> -- <path>` written to
`.tmax/fikra/stash/<thread>-<turn>/<mangled-path>.patch` (`--binary` keeps
binary files re-appliable; deleted-in-worktree paths yield deletion hunks;
restore with `git apply`). The check is purely
content-based; fikra does not attempt to attribute edits to user vs agent.
Reverting appends a `checkpoint-reverted { target-turn, revert-point }`
tombstone event — `events.jsonl` is never truncated. **Replay is
deterministic**: the tombstone *invalidates the turn range*
`(target-turn, revert-point]` — the renderer draws turns up to `target-turn`,
collapses the invalidated range into a one-line "reverted" marker, and
**continues rendering** events appended after the tombstone (a thread keeps
living after a revert; later turns are not hidden).

**Edge cases, stated up front** (each pinned by a temp-repo unit test):
- Non-git project root → checkpointing disabled; turn review shows a notice and
  revert is unavailable (the harness keeps working, minus accountability).
- Unborn HEAD → checkpoints begin after the first commit; turns before that
  run with the same notice.
- Gitignored files are **not** captured (temp-index `add -A` respects ignore
  rules) — documented, not fixed; agent edits to ignored files are visible in
  the turn's tool events but not in diffs.
- Submodules are recorded as gitlinks, not recursed — a documented limitation.

### D7 — Threads, projects, worktrees

- **Thread** = event log + state (backend, session-id, runtime mode, trust,
  checkpoint refs, worktree path). Identified `<project>-scoped` short id
  (`main`, `fix-11`, …). The single global `fikra-message-history` /
  `fikra-turn-status-val` today becomes per-thread state keyed by id, with
  `fikra-current-thread-id` as the focus.
- **Project** = git root of the working directory (RFC-014B's detection when it
  lands; `git rev-parse --show-toplevel` until then). Threads live in
  `<root>/.tmax/fikra/threads/`. The `*Fikra-Threads*` buffer groups by project
  (zcode model); each project auto-creates a `main` thread on first `SPC a a`.
- **Worktree mode** — sibling checkout per thread at `<repo>.fikra-<thread-id>/`
  on branch `fikra/<thread-id>` (the adw pipeline's SPEC-065 precedent: sibling
  dirs, never nested inside the repo). Concurrent threads in worktrees never
  collide — this is how you run three agents on one repo, Codex-style.
- **Handoff (`SPC a w`) is patch-apply-or-refuse; it never merges.**
  *Local → Worktree*: refuse if the working tree is dirty with changes not in
  the latest checkpoint (report; user commits or stashes first). Otherwise
  create the worktree from the thread's latest completion ref (HEAD if none)
  and record the worktree path in thread state. *Worktree → Local*: snapshot
  the worktree to a ref; compute the cumulative thread patch (thread-start
  ref → snapshot) and `git apply` it to the local tree; on conflict, abort the
  handoff, keep the worktree intact (cleanup refuses while unmerged state
  exists), and report the conflicted paths with the patch saved to
  `.tmax/fikra/patches/<thread>.patch` for manual application. Closing a
  worktree thread snapshots to a ref and prunes; pruning is refused (and
  reported) if the snapshot fails or unmerged changes exist.
- The backend process always runs with the thread's working directory (local
  root or worktree path) as cwd, so agent edits land in the right place and
  checkpoints are captured there. This requires a generic `make-process`
  `:cwd` (and `:env`) kwarg that does not exist today — `make-process` currently
  parses only `:command`/`:filter`/`:sentinel` (verified 2026-08-20). Phase 0
  adds it; Phase 4 (worktrees) is blocked on it.

## UI

### Event rendering (`*Fikra*`)

The renderer is a pure function over the event log tail. Rules per event (see
D2 table). Collapsed tool blocks look like:

```
  ⚙ Edit  src/editor/tlisp-api.ts:1489-1512        ✓
  ⚙ Bash  bun test test/unit/fikra-agent.test.ts    ✗ 2 failed
```

`TAB` on a block expands the full input/result (indented, dim). `file-change`
lines and any recognized path are navigable (`RET` → find-file; SPEC-121's
portable-link work applies). The buffer stays read-only; composition happens in
the capture buffer (existing design, unchanged).

**Buffer-local keymaps (Phase 0 prerequisite).** Today `chat.tlisp` binds `RET`
and `C-g` in the global normal keymap — those bindings leak into every buffer,
and the dispatch path (`normal-handler.ts`) resolves everything through
`(current-keymap)`, which returns the per-editor-mode map only; the keymap
`parent` slot and `minor-mode-set-keymap` exist but are unwired into lookup.
The fix is generic, and its lookup order is normative:

1. **buffer-local map** (new: `buffer-set-keymap <buffer> <keymap>`)
2. **minor-mode maps**, in activation order
3. **mode map** (today's `current-keymap` result)

A higher level shadows lower for both direct bindings *and* prefixes:
`keymap-ref` walks the chain innermost-first; `keymap-prefix-p` returns prefix
if the partial sequence is a prefix *at any level* (a buffer-local `y` must not
shadow approval keys while a mode-level `SPC` prefix is still live);
which-key merges candidate lists across levels, deduped, higher levels winning.

**Composition with the TypeScript dispatch path** (`normal-handler.ts`):
count-building, operator-pending resolution, and the Escape/C-g cancel
interpretation keep their current priority *before* keymap lookup (unchanged);
the T-Lisp chain above resolves the command; TS-level major-mode
`keyMappings` are consulted *after* the chain fails (today's order preserved).
Regression tests pin: buffer-local `y`/`n` during `confirming` state without
breaking count prefixes (`3j`) or `r<Esc>` cancel; which-key merging under a
partial prefix. Fikra's four special buffers (chat/capture/diff/threads) each
get a buffer-local map; this also unblocks comint buffers, dired, and future
major modes.

**Streaming performance (RFC-019 discipline).** `fikra-token-insert` currently
does line-count + cursor-move + insert per token — O(buffer) per token,
O(buffer²) per turn. Phase 0 adds a `buffer-append` primitive (append at end,
no cursor dance). **Coalescing is per-chunk, not per-clock** — there is no
timer primitive and none is needed: each serialized filter callback (D3) flushes
at most once — every `text-delta` normalized from that chunk batches into one
`append-file` write, one render pass, one revision bump. Non-delta events
append immediately. The line accumulator's residual tail is force-flushed on
`turn-end`/`turn-error` (final-flush tests pin that no buffered text is lost
when the process exits). Crash recovery is best-effort: the loader tolerates a
trailing partial line (drops it); a lost tail of streaming text costs
re-render fidelity, not correctness — checkpoint refs are the durable artifact
of record. The revision bump on flush is what the TUI poll already consumes —
no new push mechanism needed.

### Chat buffer keys (buffer-local)

| Key | Command |
|---|---|
| `i` | `fikra-capture` |
| `TAB` | expand/collapse tool block at point |
| `RET` | `fikra-follow-link` |
| `y` / `n` / `a` | approval response (only in `confirming` state) |
| `C-g` | `fikra-turn-interrupt` |
| `SPC a d` | last turn diff · `SPC a D` cumulative · `SPC a R` revert picker |
| `q` | `fikra-quit` |

### Modeline

`fikra:<backend><state>` where state ∈ `●` idle, `◉` running, `?` awaiting
approval, `◈` interrupted, `✗` error; runtime-mode suffix `!`/`!!` when
elevated, `wt:` prefix plus thread id in worktree mode. **The runtime-mode
segment always shows the effective mode** (D5 degradation rule); when the
effective mode differs from the requested one, the mode renders with a `*`
suffix (e.g. `auto*`) and the degrade emits a one-time message naming both
(`runtime mode auto unavailable on this backend — using approval-required`).
This renders as the
fikra **minor-mode lighter**, recomputed on every FAEP event — not via
`editor-set-status`, which is a transient message slot that unrelated commands
overwrite. The mechanism is a generic Phase 0 primitive:
`(minor-mode-set-lighter name lighter)` mutates a registered mode's lighter
at runtime; `minor-mode-list-lighters` (already feeding the status line)
picks it up on the next status recompute, and the FAEP emit path calls it
after every event. Phase 0 ships the primitive + unit test (set → next
lighter listing reflects it); Phase 1 wires fikra's state → lighter function.

## Key bindings (SPC a — global)

| Key | Command | Phase |
|---|---|---|
| `SPC a a` | open project chat (auto-create main thread) | 1 |
| `SPC a i` | capture (compose message) | 1 |
| `SPC a d` / `D` / `R` | turn diff / cumulative / revert | 2 |
| `SPC a m` | runtime mode | 3 |
| `SPC a t` / `T` | new thread / thread list | 4 |
| `SPC a w` | handoff Local ↔ Worktree | 4 |
| `SPC a p` | plan-mode turn | 5 |
| `SPC a e f r g s` | workflows (explain/fix/refactor/test/region) → threads | 5 |
| `SPC a b` | backend switcher | 5 |
| `SPC a q` | stop | 1 |

## Implementation phases

Each phase ends green with **phase-appropriate gates** (e.g. Phase 0 has no
replay backend yet — its gate is typecheck + targeted unit tests; later phases
add replay e2e and, where noted, a live smoke test gated on the real CLI being
present). **Every phase additionally gates on the project-wide checks from
CLAUDE.md §8: `bun run typecheck:src`, `bun run typecheck:test`, and
`bun run typecheck`** — mandatory for Phase 0 and Phase 3, which add
TypeScript primitives and a daemon RPC method. All work is T-Lisp
except where a file is named.

**Phase 0 — generic prerequisites (TS, small).** All verified absent today
(2026-08-20):
- Buffer-local keymaps: `buffer-set-keymap` + the chain lookup order (§UI).
- `minor-mode-set-lighter` — dynamic lighters for the modeline contract (§UI).
- `buffer-append` — O(1) append-at-end.
- `make-process :cwd` / `:env` kwargs (currently only `:command`/`:filter`/
  `:sentinel` are parsed) — needed for Phase 1 project-root cwd, blocks Phase 4.
- `make-process` filter serialization (per-process promise chain, §D3) —
  chunks evaluate in arrival order, each to completion.
- `json-encode` + `append-file` (RFC-018 Tier 1) — event-log persistence.
- Daemon `confirmation/mediate` deferred-RPC primitive — mechanism only
  (deferred response, timeout/cancel sweeps to reject, turn-token minting,
  peer-credential check; §D5 L2 spec). Fikra policy/UI ride on it in Phase 3.
Rip the global `RET`/`C-g` bindings out of `chat.tlisp` into a buffer-local map.
*Verify* (created in this phase): `test/unit/keymap-local.test.ts` (shadow +
cross-level prefix + TS-dispatch interaction), `test/unit/process-ops.test.ts`
(`:cwd`/`:env`, per-process filter serialization, append benchmark on a 10k-line
buffer), `test/unit/io-encode.test.ts` (json-encode/append-file round-trip),
`test/unit/confirmation-mediate.test.ts` (deferred response, timeout →
auto-reject, cancel sweep, token mint/validate, peer-credential check).

**Phase 1 — agent session core (single project, single main thread).**
The *minimal* thread subset, deliberately: one implicit `main` thread per
project with state + persistence + reopen — no thread creation, list, or
worktrees yet (those are Phase 4). FAEP module
(`fikra-event.tlisp`: emit/append/replay/render), minimal
`fikra-thread.tlisp` (state machine, `state.json` + `events.jsonl`
persistence), project-root detection (`git rev-parse --show-toplevel`) and
process cwd via `make-process :cwd`, adapter contract v2, rewritten
`backend-claude` per D3 (session resume, tool events, `--verbose`
stream-json), `backend-replay` fixture adapter. Chat buffer renders the full
event vocabulary. *Verify* (tests created in this phase):
`test/unit/fikra-event.test.ts` (normalization fixtures, ordering,
final-flush, module-load of every fikra module), `test/e2e/fikra-replay.test.ts`
(recorded transcript → rendering → state), plus opt-in live smoke playbook
`playbooks/fikra-session-resume.yaml` (two turns resume one Claude session;
daemon restart reopens history) — opt-in, never required for CI.

**Phase 2 — checkpoints + diff review.**
`fikra-checkpoint.tlisp` (temp-index capture, diff, revert, ref GC);
`*Fikra-Diff*` buffer with y/n/e keys. *Verify* (created in this phase):
`test/unit/fikra-checkpoint.test.ts` against temp git repos — dirty index
survives a checkpoint untouched; turn diff matches `git diff` output; revert
restores content, deletes later-created paths, writes stash patches, appends a
tombstone whose replay invalidates exactly the right turn range (rendering
continues past it), and aborts cleanly on diverged files; edge cases (non-git,
unborn, ignored, submodule) each pinned.

**Phase 3 — approvals.**
L1 mode presets + per-backend fallback matrices (fixture-driven, below); trust
state; `SPC a m`. L2 **policy and UI only** (mechanism — the
`confirmation/mediate` primitive, token minting, serialization — landed
generic in Phase 0): `bin/tmax-mcp-confirmation.ts`, a **generic**
MCP-to-daemon confirmation bridge (zero Fikra logic; all policy lives in
T-Lisp, preserving the T-Lisp-only editor-core boundary), inline prompts,
`--allowedTools` promotion on "always allow". *Verify* (created in this
phase): `test/unit/fikra-approvals.test.ts` — replay transcript with a
`permission-request` drives the prompt UI headlessly; forged/stale/cross-turn
tokens rejected before any prompt; second-client and eval-driven resolves
(the `fikra-approval-guard` path); opt-in smoke playbook
`playbooks/fikra-approvals.yaml` (`y` proceeds, `a` silences the next write,
`n` redirects the agent).

**Phase 4 — worktrees + full thread/project machinery.**
Everything beyond Phase 1's minimal subset: `fikra-worktree.tlisp`
(create/handoff/snapshot/cleanup, sibling dirs, patch-apply-or-refuse),
thread creation/switching/list (`SPC a t`/`T`), `*Fikra-Threads*` grouped by
project. *Verify* (created in this phase):
`test/unit/fikra-worktree.test.ts` — two threads in worktrees edit the same
file concurrently without cross-contamination; both handoff directions
succeed on clean trees and refuse on dirty/conflicting ones with patches
saved; thread close prunes worktree + refs; `git worktree list` clean.

**Phase 5 — plan mode, Codex adapter, workflows.**
Plan as a thread *interaction mode* (t3code model: `default`/`plan` — a thread
property, toggled `SPC a p`, with approval-gated implementation follow-up),
`backend-codex` (sandbox presets, resume), workflows re-bound to create/append
threads, backend switcher. *Verify:* `test/unit/fikra-codex.test.ts`
(fixture-driven mapping + fallback matrix) plus the existing suites green.

**Explicitly out of scope for this RFC**, so scheduling doesn't inherit them —
each gets its own RFC when its phase nears: `backend-acp` (Agent Client
Protocol adapter unlocking OpenCode/Cursor/Grok-class backends; D4's transport
analysis keeps it cheap later) and ghost-text completions (rides RFC-026
overlay machinery).

## Testing strategy

- **`backend-replay`** is the keystone: recorded real transcripts (Claude JSONL
  captured once, scrubbed) become fixtures; the entire UI/state/checkpoint
  machinery runs deterministically in CI without network or keys. Same pattern
  as adw's recorded-output testing.
- Unit: FAEP normalization (pure), checkpoint commands against temp repos,
  keymap isolation, trust-state promotion.
- Live smoke (opt-in, gated on CLI presence): session resume, approval round
  trip, worktree concurrency — as tmax-use playbooks.

## Security considerations

1. **Approvals are the injection boundary.** File content reaches the model as
   user-message context, never system prompts. The security boundary for
   *resolving* an approval is the same as every other tmax RPC: an
   authenticated same-user daemon connection. By design that includes remote
   `tmaxclient` sessions — remote approval is a feature (t3code's whole
   product), and the model/tool-controlled space cannot reach
   `confirmation-resolve` (it is editor RPC, not tool input; the shim carries
   only the mediate request). Users who want a presence requirement define
   `fikra-approval-guard` (a T-Lisp predicate over the requesting client).
   **Default resolve policy is interactive-frames-only — this is not
   configurable-by-accident.** The threat: an agent with Bash access can spawn
   `tmaxclient --eval "(confirmation-resolve ...)"` and approve its own
   pending request. Headless clients therefore **cannot resolve approvals by
   default**; the daemon distinguishes frame-attached (interactive) clients
   from `eval`/RPC-only clients, and only interactive clients may answer.
   `always` decisions require an interactive client unconditionally. Remote
   approval still works — through an attached TUI (including over SSH), which
   is the t3code-parity feature — but not through the eval surface an agent
   child process can drive. A guard denial leaves the prompt pending; resolves
   from non-interactive clients return denied without settling it. Tests:
   an agent-spawned `tmaxclient --eval` attempting to resolve its own pending
   approval is denied (the gate test); second *attached* client resolves
   normally. Users who genuinely want headless resolution rebind
   `fikra-approval-resolve-guard` — a deliberate, visible init.tlisp act.
   Trust writes are recorded as FAEP events (auditable, never silent).
2. **Bash commands display verbatim** in tool-call blocks — the user approves
   exactly the string that runs.
3. **API keys stay in the environment**; T-Lisp never sees them (RFC-013 rule,
   unchanged).
4. **Checkpoints are the audit trail**: even `full-access` turns leave refs that
   reconstruct exactly what changed, when.
5. Shim listens on nothing; it dials the daemon's existing socket, carries the
   thread/turn correlation nonce (§D5 — requests without a live correlation
   are rejected before any prompt is shown), and exits with the turn.
   Forged- and stale-request tests gate Phase 3.

## Alternatives considered

- **Own agent loop over raw model APIs** (tools implemented in T-Lisp). Rejected:
  reimplements planning/tooling/context-management the CLIs already do better;
  Fikra's value is the harness, not a second agent runtime. FAEP keeps the door
  open — a T-Lisp-native backend is just another adapter.
- **Persistent bidirectional stdio session** (`--input-format stream-json`).
  Deferred: process-per-turn + resume gives continuity with none of the
  state-machine fragility. Needed only for mid-turn user injection.
- **Invasive checkpoint commits** (RFC-013's `git add -A && git commit`).
  Rejected: mutates user index/HEAD. Temp-index refs are strictly better.
- **Worktrees inside the repo** (`.tmax/worktrees/`). Rejected in favor of
  sibling dirs per SPEC-065's hard-won conventions.
- **Defer buffer-local keymaps, keep global bindings.** Rejected: the current
  global `RET`/`C-g` pollution is a live bug, and every Fikra buffer (plus
  comint/dired) needs the mechanism. It's generic editor work, not Fikra scope
  creep.

## Open questions

- **Codex L2 approvals**: `codex exec` approvals are policy-based; full
  interactive routing may need the experimental app-server protocol. Until
  then Codex ships L1 + turn review (`interactive-approvals: nil`).
- **Trust scope**: is "always allow" thread-local (proposed), or also
  project/global tiers?
- **Session resume across CLI upgrades**: adapters should fall back to a fresh
  session + replayed context summary on resume failure. Needs a live test.
- **Ghost text auto-trigger** (Copilot-style) vs on-demand: latency says
  on-demand unless a local backend exists.
- **T-Lisp tool use** (agent invoking editor commands directly): RFC-013's old
  open question. FAEP makes a future `backend-embedded` adapter possible;
  still deferred.

## References

- [RFC-013](RFC-013-fikra-ai-harness.md) — original Fikra design; this RFC
  completes its Phase 2–4 with an agent-first architecture.
- [pingdotgg/t3code](https://github.com/pingdotgg/t3code) — the confirmed
  RFC-013 reference: an open-source "agent harness control surface" over
  Claude/Codex/Cursor/Grok/OpenCode. Its internals (event-sourced orchestration
  with pure decider + projector, `ProviderRuntimeIngestion` stream
  normalization, hidden-ref checkpoints, per-thread worktrees, turn-end
  decoupled from checkpoint settle, four runtime modes) directly informed
  rev 2 of this RFC. t3code froze user contributions; fikra's answer is that
  the harness itself is user-programmable.
- [ADR-0058](../adrs/ADR-0058-frame-based-daemon-client.md) — the frame/revision
  flow L2 approvals and streaming ride on.
- [SPEC-065](../specs/SPEC-065-adw-worktree-isolation.md) — sibling-worktree
  precedent and validation patterns.
- [RFC-019](RFC-019-performance-audit.md) — the streaming-render performance
  discipline (coalescing, O(1) append).
- Codex CLI, Claude Code CLI, zcode — workflow references per RFC-013.
