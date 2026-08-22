# SPEC-219: Fikra L1 — runtime modes, degradation, trust, mode-aware lighter

**Issue:** #219 (fikra-p3 / RFC-027 §D5 L1)
**Status:** Implemented 2026-08-22

## Goal

The four runtime-mode presets (`approval-required` < `auto-accept-edits` <
`auto` < `full-access` in strictness order), per-backend expressibility
DERIVED from recorded CLI surfaces with NEAREST-STRICTER degradation,
adapter flag translation (claude + codex), mid-thread mode changes
(`SPC a m`), thread trust state (L2 groundwork), the default-mode escape
hatch, and the mode-aware modeline lighter with degradation star.

Default is `approval-required` — the deliberate divergence from t3code
(t3code defaults to auto; tmax asks first).

## The recorded-surface discovery

The issue's fixture table was written against an OLDER codex surface
(`--ask-for-approval` with untrusted/on-request/never values, auto
unverifiable → degrade). Recording the ACTUAL installed surfaces
(2026-08-22) overturned two assumptions:

- **claude 2.1.195**: `--permission-mode` choices are acceptEdits, auto,
  bypassPermissions, default, dontAsk, plan — `auto` is NATIVE. No
  acceptEdits approximation, no auto* marker for claude.
- **codex-cli 0.147.0**: `--ask-for-approval` NO LONGER EXISTS. The
  surface is `--sandbox {read-only, workspace-write, danger-full-access}`,
  `--approve-for-me` (approvals routed through automatic review), and
  `--dangerously-bypass-approvals-and-sandbox`. `--approve-for-me` IS the
  `auto` expression — auto is expressible, it does not degrade.

The issue's own governing rule decides the conflict: "any mode whose
semantics cannot be verified from that surface degrades rather than
passing by fixture row" — semantics the surface CAN verify pass. So both
recorded backends express ALL FOUR modes; degradation fires for unknown
backends and future surface gaps (pinned via synthetic + unknown-backend
tests). RFC-027 §D5's fixture table carries a correction note.

## Design

`src/tlisp/core/fikra/modes.tlisp` (new):

- `fikra-recorded-surfaces`: checked-in records (backend, version, flag
  tokens) captured from the installed CLIs' `--help`; replay carries the
  `*` wildcard. Refreshed only by the opt-in live probe (#224) — never a
  CI gate.
- **Expressibility is DERIVED, not tabulated**: `fikra-mode-expressible-p`
  = an explicit translator case exists AND every emitted flag token is in
  the recorded surface. Translators return nil for unmapped modes — never
  a silent default (only `fikra-claude-mode-arg` keeps a defensive
  fallback for #214's args fn).
- `fikra-mode-strictness` alist orders the four modes; `fikra-set-runtime-mode`
  validates (unknown → nil + status, mode unchanged), persists via
  `fikra-thread-set-field "runtime-mode"`, refreshes the lighter, and
  emits the ONE-TIME explain message when effective ≠ requested.
- `fikra-nearest-stricter` recursive scan: degradation picks the nearest
  STRICTER expressible mode — never looser, never multi-step.
- Default: `fikra-default-runtime-mode` defvar + `fikra-set-default-runtime-mode`
  setter (module defvars aren't setq-able cross-module — the setter IS the
  issue's escape hatch, called from init.tlisp). thread.tlisp's fresh
  state seeds runtime-mode nil; modes owns the default.
- Trust: `fikra-trust-add` records a tool class once (idempotent, alist in
  thread field `trust`), `fikra-trust-has-p` queries. L2's approval flow
  (#220) consults it for always-allow promotion.
- `fikra-mode-star` renders `*` iff effective ≠ requested.

**Interactive surface**: `SPC a m` (bound in `fikra/mode`, lazy
require-module per the #216 cycle rule) opens a `completing-read`
minibuffer over exactly the four modes. The completion table
(`fikra-runtime-mode-table`) and accept handler
(`fikra-runtime-mode-accept` → `fikra-set-runtime-mode`) are passed to
completing-read as module-QUALIFIED names — bare names resolve to
undefined symbols from other contexts (#214 lesson).

Supporting changes: `thread.tlisp` exports `fikra-thread-set-field` and
seeds runtime-mode nil (above); `adapter.tlisp` exports
`fikra-set-backend-forced` (sets the backend WITHOUT an availability
probe — keyless CI seam); `chat.tlisp`'s `fikra-refresh-lighter` is
mode-aware (`fikra:<backend><state>:<effective><star>`); the #216 lighter
test was updated to the new format.

## Completion Criteria

- [x] Default runtime mode is `approval-required` (the t3code divergence);
      persists to thread `state.json` (pinned).
- [x] Escape hatch: `fikra-set-default-runtime-mode` changes the default
      for threads without an explicit mode (pinned).
- [x] `SPC a m` (fikra-set-runtime-mode) changes mid-thread; unknown mode
      refused without disturbing the current mode (pinned).
- [x] The SPC a m PROMPT SURFACE is real: `fikra-runtime-mode-table`
      offers exactly the four modes; the accept handler sets + persists
      (pinned; the binding itself is lazy-loaded from fikra/mode).
- [x] Claude expresses all four (native auto); adapter flags match the
      recorded-surface fixture for every mode (pinned).
- [x] Codex (recorded 0.147 surface) expresses all four —
      `--approve-for-me` IS auto; flags from the EFFECTIVE mode (pinned).
- [x] Unmapped modes return nil from translators — never a silent default
      (pinned).
- [x] Degradation picks the NEAREST STRICTER expressible mode — never
      looser, never two steps; nothing expressible → approval-required
      (pinned via direct fikra-runtime-mode-degrade calls).
- [x] Unknown backend: no surface record → everything degrades to
      `approval-required` (pinned).
- [x] Trust-add is idempotent; trust-has-p queries; trust PERSISTS to
      `state.json` (gate round-1 catch: the writer never persisted the
      `trust` field and trust-add never saved — trust died on restart;
      both fixed + pinned) AND a fresh editor reads it back (codex-review
      catch: persisted ≠ reloaded; pinned).
- [x] Modeline shows the EFFECTIVE mode; the degradation star renders iff
      degraded; expressible mode → no star (pinned). Pre-chat fallback and
      chat's refresh render the SAME format `fikra:<backend><state>:<mode><star>`
      (codex-review catch: they diverged; the state char now lives once in
      fikra/modes). The PRE-CHAT fallback path itself is pinned (gate
      round-2 catch: it never worked — the condition-case handler clause
      is `(error (var) body...)` and the body form was being consumed as
      the var slot, silently evaluating to nil; shape fixed + pinned both
      star and no-star fallback renders).
- [x] One-time explain message — once per DEGRADING SET (not per render),
      naming both modes; absent for expressible sets (pinned via the
      *Messages* log — gate round-1 catch: previously unpinned).
- [x] Set-mode PERSISTS across editors (fresh editor on the same repo
      reloads state.json — the full nil→field chain pinned end-to-end).
- [x] `SPC a m` registered in the normal-mode keymap (pinned via
      key-binding lookup).
- [x] The LIVE claude adapter consumes the effective mode:
      `fikra-backend-claude-args` takes `--permission-mode` from
      `fikra-claude-mode-arg` of the EFFECTIVE mode (codex-review catch:
      it was hard-coded default — the mode was decorative). Pinned: mode
      changes change spawned-turn args; degradation keeps them
      conservative.
- [x] typecheck:src + typecheck:test green; fikra-approvals 17/17; the
      full 10-suite fikra batch green with `--timeout 20000` (any #215
      module-load timeout under full parallel load is the known
      load-family flake from SPEC-218 — passes solo).
- [x] Codex review round posted to the issue (request-changes → all
      actionable findings fixed; dispositions recorded in the comment).

## Advisories (gate round-2, recorded — not gaps)

- The conservative base: when NOTHING is expressible, degradation returns
  `approval-required` even if that mode is itself inexpressible — the
  intent is "clamp to strictest known," which is safe because unexpressible
  backends spawn nothing (adapters consume only expressible effective
  modes; the claude adapter's defensive `fikra-claude-mode-arg` falls to
  `default`).
- `fikra-nearest-stricter` uses `<=` on strictness diff: with duplicate
  strictness values a later candidate would win the tie. Unreachable
  today (strictness values are unique per mode by construction).
- A pre-existing, unread `fikra-default-runtime-mode` defvar lives in
  `fikra/mode` (predates this branch); the LIVE default + setter are in
  `fikra/modes`. Left in place per surgical-change rules; noted here so
  it isn't mistaken for the escape hatch.

## Known bounds (gate round-1 + codex review, accepted)

- **Token-membership, not semantic proof.** Expressibility verifies that
  emitted flag TOKENS appear in the recorded surface; the mapping
  `--approve-for-me` ≈ `auto` is an interpretive judgment recorded in the
  surface data + fixtures, not something the checker can derive. The
  fixtures + RFC correction note are the honesty mechanism.
- **Records are data, unvalidated until #224.** The checked-in surfaces
  were recorded by hand from the installed CLIs; the opt-in live probe
  (never a CI gate) refreshes them.
- **Keystroke-level e2e for the minibuffer path** rides the general
  minibuffer machinery (already covered by the #195-era suites); the
  handler, table, accept, and keymap registration are each pinned here.
- **Codex helpers unintegrated**: `fikra-codex-flags` has no live
  consumer yet — the codex backend itself is #224; the claude adapter is
  the integration proof of the pattern.

## Notes

- Child-thread inheritance of runtime mode is #222 scope (child threads
  don't exist yet); per-thread state persists correctly today.
- The live surface refresher (probe → re-record) lands with #224's codex
  backend work; the records here are data, and the derivation rule is the
  mechanism that will consume refreshed records.
- `fikra-set-backend-forced` is a deliberate test seam, not a user surface.
