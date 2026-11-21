# ADR-0307 — #286: the Stagehand status buffer + the level-aware prefix rule

- **Status**: Accepted
- **Date**: 2026-11-22
- **Issue**: #286
- **Spec**: SPEC-281

## Context

Stagehand (the tmax git front-end cluster #286–#297) needs its T0
foundation: a `*Stagehand*` status buffer with foldable sections,
navigation, refresh, and the repo/error states. All later cluster
issues (#287 stage/discard, #288 commit, #289 diff...) bind INTO this
buffer, so its shape is load-bearing for the whole cluster.

Two engine realities surfaced during the build and shaped the design:

1. **Key spelling.** The dispatch path normalizes raw bytes to
   "Enter"/"Tab" (`Editor.normalizeKey`), and the keymap lookup uses
   that verbatim — older "RET"/"TAB"-spelled keymap entries do not
   match it. New buffer-local bindings use the handler's names.
2. **The #206 prefix rule.** `keymap-prefix-p` returned t when ANY
   chain level held the key as a prefix, so a buffer-local FULL
   binding of an outer-prefixed key (vim's `g` — prefixes g g, g i,
   g X, g u u, g ~ ~) could never fire. The normative `g` refresh key
   requires exactly that shadowing.

## Decision

- **Buffer-local keymap** (the fikra-diff pattern: `keymap-init` +
  `keymap-set-key` + `buffer-set-keymap`), NOT major-mode-scoped
  `key-bind` rows: the TS keyMappings major-mode tier is a
  last-resort path that loses to every global binding — n (search-next)
  and p (paste) would swallow navigation.
- **`keymap-prefix-p` is level-aware** (keymaps.tlisp): walk the chain
  innermost-first; the first level with EITHER a full binding or a
  prefix entry for the key decides. A local full binding shadows an
  outer prefix (the Emacs rule); mid-sequence waits are unchanged.
  Regression-tested in `test/unit/keymap-local.test.ts` alongside all
  8 original #206 rows (which pin the mid-sequence behavior and still
  pass — the new rule only changes the local-full/outer-prefix case,
  which nothing else exercised).
- **Unborn vs detached** disambiguation: `symbolic-ref --short HEAD`
  resolves on unborn repos (a branch name), and fails only when
  detached; `rev-parse --verify HEAD` failing = no commits. Together:
  branch + no commits → `unborn: <branch>`; no branch + commits →
  `HEAD detached at <sha>`.
- **Fold state** is a name-keyed hashmap mutated with
  `keymap-mutable-set!` (a builtin; `hashmap-set` is immutable and
  there is no `buffer-previous`-style accessor for module defvars
  across modules). The RENDERED buffer is fold-aware — folding is
  visible, not just internal state.
- **Module layout**: `stagehand/` joins `fikra/` as a core-module
  subdirectory prefix (module-loader); required from
  `bindings/normal.tlisp` at startup; `major-mode-register
  "stagehand-status"` marks the buffer for the cluster's later
  per-section keymaps (#287/#288 own those — deliberately absent).

## Consequences

- `SPC g` is now bound globally (was free).
- Special buffers can own keys that collide with outer prefixes by
  full-binding shadowing; existing local keymaps (fikra chat/diff/
  capture/worktree) bind no outer-prefixed keys, so behavior is
  unchanged for them (their suites stay green).
- The "RET"/"TAB" spelling question for OLDER entries (occur's RET
  row, fikra chat's RET) is out of scope here — noted as a follow-up
  observation for the cluster: if those keys are dead via the normal
  handler, they need the same spelling fix in their own issues.
