# SPEC-220: Fikra L2 — interactive approvals: MCP bridge, tokens, guard

**Issue:** #220 (fikra-p3 / RFC-027 §D5 L2, §Security)
**Status:** Implemented 2026-08-22

## Goal

Mid-turn approvals: the subprocess asks through a generic MCP bridge, the
user answers in `*Fikra*` (`[y] allow / [n] reject / [a] always-allow`),
the agent proceeds. The mechanism landed generic in Phase 0 (#210); this
issue adds the POLICY + UI + the interactive-frames-only resolve guard +
the claude capability gate + always-allow → `--allowedTools` promotion.

## Design

**`bin/tmax-mcp-confirmation.ts`** (new, ~160 lines): GENERIC
MCP-stdio→daemon bridge. Argv `<source> <token> [socket]` (socket defaults
to `defaultSocketPath()` — the adapter never needs to know it). MCP
surface: `initialize`, `tools/list` (one `permission` tool), `tools/call`
→ forwards to the daemon's `confirmation/mediate` JSON-RPC and returns the
deferred decision as the tool result. Reject/bridge-error → `isError`
(the agent proceeds on the safe side, never hangs on a dead bridge).
Zero Fikra logic; listens on nothing; exits with stdin.

**Resolver-kind stamping** (`server.ts processRequest`): frame-scoped
`keypress` dispatches stamp `confirmationService.resolverHint =
"interactive"`, `eval` dispatches stamp `"headless"`. The fact is
READ-ONLY from T-Lisp (`confirmation-resolver-kind`) — deliberately no
setter: eval-reachable code must not self-mark interactive. The handler
signature gained a 4th arg (the minted token's SCOPE) so fikra can
validate thread/turn liveness T-Lisp-side.

**`src/tlisp/core/fikra/approvals.tlisp`** (new): registers
`fikra-approval-enqueue` for source `"fikra"`.

- **Scope liveness** (`"<thread>/<turn>"`): thread must match the current
  thread, the turn must equal the live turn-count, and the thread must be
  mid-turn (`running`). Dead correlation → the parked mediate resolves
  reject IMMEDIATELY — no prompt, no event. (`string-match` gates the
  numeric parse — `string-to-number` throws on garbage; there is no
  `string-match-p` builtin, chat.tlisp's calls to it are latent-broken,
  noted.)
- **Live enqueue**: pending id+kind recorded, `permission-request` FAEP
  event (renders the `[y]/[n]/[a]` prompt line), checked transition to
  `confirming`, buffer-local y/n/a bindings in `*Fikra*` (extending
  chat's keymap).
- **`fikra-approval-answer`**: THE GUARD first — headless resolvers are
  DENIED (status message) and the prompt STAYS pending; only interactive
  clients settle it. Then first-resolver-wins `confirmation-resolve`,
  `permission-response` FAEP event, `confirming → running` (only if still
  confirming), and on `always` → `fikra-trust-add` (the #219 trust state)
  + message.
- **Guard override**: `fikra-set-approval-guard` installs a user fn name
  (module defvars are not setq-able cross-module) — the deliberate,
  visible init.tlisp act that re-enables headless resolution.

**backend-claude**: `interactive-approvals` is now PROBED
(`--permission-prompt-tool` in `claude --help`; grep-count, cached). The
recorded 2.1.195 surface LACKS the hook → L2 degrades to L1 +
turn-boundary review for claude (the harness stays correct; only
real-time mediation is lost). When capable: start-turn mints the
turn-scoped token, writes `.tmax/fikra/mcp/<thread>-<turn>.json`
(command + source + token in argv — the token never transits
model-controlled space), and args carry `--mcp-config` +
`--permission-prompt-tool mcp__tmax-confirmation__permission`. Trust
promotes: `fikra-backend-claude-args` appends `--allowedTools <classes>`
whenever the thread trust list is non-empty. Test seams:
`fikra-claude-set-approvals-override "on"/"off"/nil`.

**Playbook**: `tmax-use/playbooks/_smoke-fikra-approvals.yaml` — opt-in
(underscore prefix = explicit-run-only per the playbooks README), never
in CI.

## Completion Criteria

- [x] Generic MCP bridge: initialize/tools surface, deferred mediate
      round trip, reject → isError, dead daemon → isError not hang
      (5/5 in `mcp-confirmation-shim.test.ts`, hermetic fake-daemon).
- [x] Live mediate parks → `permission-request` renders the prompt in the
      FAEP replay headlessly; confirming state; y resolves the parked RPC
      allow; FAEP records the decision (pinned).
- [x] THE GATE TEST: headless (eval-stamped) resolve DENIED, prompt stays
      pending, thread stays confirming; a second INTERACTIVE
      (keypress-stamped) client resolves normally (pinned).
- [x] Guard override fn permits headless resolution when deliberately
      installed (pinned).
- [x] Forged token → immediate reject, NO prompt event, thread never
      enters confirming (pinned).
- [x] Stale (single-use) token → reject on reuse (pinned).
- [x] Cross-turn token (scope names an old turn) → handler rejects
      before any prompt; never parked-for-prompt (pinned).
- [x] `always` writes thread trust AND the next turn's claude args carry
      `--allowedTools <class>` (pinned).
- [x] Hook absent (`"off"`): args omit the L2 flags; write-mcp-config
      no-ops (pinned). Hook present (`"on"`): token minted (48-hex),
      config file written + parses with source+token in argv, args wire
      the prompt tool (pinned). The REAL probe result on 2.1.195 (absent)
      is documented, not pinned — a future CLI gaining the hook must flip
      it, by design.
- [x] typecheck:src + typecheck:test green; fikra-approvals 26/26 (17 L1
      + 9 L2); confirmation-mediate 10/10 (handler signature updated for
      the scope arg); mcp-shim 5/5; related suites (backend-claude,
      chat-ui) green.

## Notes

- Turn-boundary review (checkpoints) remains always-on regardless of L2.
- The `resolverHint` is process-wide on the daemon (one editor per
  daemon, ADR-0058) — single in-flight dispatch at a time on the event
  loop; no interleaving hazard.
- chat.tlisp's `string-match-p` calls (`fikra-file-path-in-line-p` /
  `fikra-extract-file-path`) are LATENT-broken (no such builtin) —
  pre-existing, unrelated to #220, flagged for a follow-up issue.
