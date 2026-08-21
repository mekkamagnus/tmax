# SPEC-206: Buffer-local keymaps + normative lookup chain

**Issue:** #206 (fikra-p0 / RFC-027 §UI, §Phase 0)
**Status:** Implemented 2026-08-21

## Goal

Per-buffer keymaps with a normative lookup chain, replacing the four global
per-mode maps as the sole dispatch source — and fixing chat.tlisp's global
RET/C-g pollution (the motivating bug).

## Design (normative)

Chain, innermost-first: **buffer-local → active minor-mode keymaps
(later-activated first) → the editor-mode keymap**. Levels link through the
keymap `parent` field; `current-keymap` rebuilds the chain per call (mode
can change; outermost parent is always reset so no stale links survive).

- `keymap-ref` walks the chain — innermost binding wins.
- `keymap-prefix-p` returns prefix if the partial sequence is a prefix at
  ANY level (a buffer-local key must not shadow a mode-level prefix
  mid-sequence).
- `keymap-prefix-bindings` / `keymap-all-bindings` / `keymap-bindings-list`
  merge across levels for display (which-key): deduped, innermost wins.
- TS dispatch composition unchanged: count/operator/Escape priority BEFORE
  keymap lookup; TS major-mode keyMappings AFTER the chain (normal-handler
  order preserved — no TS changes required for dispatch).

New T-Lisp API (editor/keymaps): `buffer-set-keymap`, `buffer-keymap`,
`keymap-chain`, `keymap-init`/`keymap-register`/`keymap-named`/
`keymap-mutable-set!` (now exported), plus TS getter `minor-mode-keymap`
(the registry's keymap-name string; resolved via the named-keymap registry).

chat.tlisp: global `(key-bind "RET"/"C-g" ... "normal")` removed; a
`*Fikra*` buffer-local map is attached idempotently by
`fikra-ensure-buffer-keymap` (called from `fikra-chat-open`, exported for
testability).

## Completion Criteria

- [x] Buffer-local binding shadows the mode map only in that buffer
      (dispatch-level test: `j` → local command in one buffer, mode motion
      in another).
- [x] Cross-level prefixes: buffer-local single key does not shadow
      SPC/g mode prefixes (`keymap-prefix-p` chain-walk pinned).
- [x] which-key merge across levels with innermost-wins on collision
      (`keymap-prefix-bindings` pinned).
- [x] Minor-mode tier: named keymap + `minor-mode-set-keymap` + activation
      → shadows mode map; buffer-local outranks it; deactivation drops the
      tier.
- [x] TS dispatch composition: `3j` count and `r<Esc>` cancel still work
      with a buffer-local map active.
- [x] chat.tlisp globals removed (RET keeps its pre-existing occur-jump
      mode binding — fikra's OVERRIDE is gone; C-g unbound) and the
      `*Fikra*` buffer-local map carries RET → fikra-follow-link.
- [x] Tests: test/unit/keymap-local.test.ts (7). `bun run typecheck`
      (all projects) green; blast radius green — keymap-ops/sync/
      data-structures, key-resolution-modes, describe-key, steep-which-key,
      minor-mode-ops/set-lighter, t1-minor-modes, fikra-mode/primitives,
      comint, count-prefix, change-operator, macro-handler,
      spc-semicolon-mx, steep-input: 185 tests (1 load-induced flake on
      first run, clean on rerun).

## Notes

- T-Lisp gotchas documented in-code: no dotted pairs, `append`/`cons`
  reject nil/'() where lists are required (helpers use `(list)`), no `cadr`.
- Discovered pre-existing breakage, OUT of scope: fikra/chat references
  fikra/mode symbols unqualified (`fikra-mode-active` etc.) — the chat-open
  path has been broken since the module system landed; #214's adapter
  rewrite covers it (noted there).
- Discovered pre-existing parser anomaly (observation only): sequential
  parsing of some file pairs can report spurious unbalanced-paren errors in
  the same process even though each file parses clean in isolation —
  reproducible with monads.tlisp then chat.tlisp via shared-instance parse;
  did not block this work (fresh-process parses clean; editor load order
  unaffected). Worth a standalone issue if it reproduces in production.
