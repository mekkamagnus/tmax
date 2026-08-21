# Buffer-local keymaps and the normative lookup chain

## Status

Accepted (2026-08-21, #206 / [SPEC-206](../specs/SPEC-206-buffer-local-keymaps.md))

## Context

Dispatch resolved every key against four GLOBAL per-mode keymaps. Special
buffers had no way to own keys — chat.tlisp bound RET/C-g in the global
normal map, leaking into every buffer. The keymap `parent` slot and
minor-mode keymap association existed but were unwired.

## Decision

Keymap lookup is a CHAIN, rebuilt per `current-keymap` call and linked
through the parent field: buffer-local → active minor-mode keymaps
(later-activated innermost — cons-accumulation over the earliest-first
activation list) → the editor-mode keymap. `keymap-ref` walks innermost-
first; `keymap-prefix-p` matches at ANY level; the display fns merge levels
(innermost wins) for which-key. TS dispatch composition is unchanged:
count/operator/Escape before keymap lookup, TS major-mode maps after the
chain. New API: buffer-set-keymap/buffer-keymap/keymap-chain + exported
keymap-init/keymap-register/keymap-named + TS getter minor-mode-keymap.

## Consequences

- Special buffers (chat, future comint/dired/fikra buffers) own keys without
  polluting global maps; chat.tlisp's globals are gone.
- LIMITATION (documented in-code): the handler checks prefix-p before ref,
  so a buffer-local FULL binding of a key that prefixes at an outer level
  (bare g/SPC) cannot fire — the outer prefix wins.
- Known T-Lisp gotchas encountered: no dotted pairs, no cadr, cons/append
  reject nil/'() where lists are required.
- Out-of-scope discoveries recorded: fikra cross-module symbol breakage
  (#214 scope); a same-process sequential-parse anomaly worth a standalone
  issue if it reproduces in production.
