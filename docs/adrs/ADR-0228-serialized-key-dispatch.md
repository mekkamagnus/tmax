# Serialized key dispatch in the Steep input layer

## Status

Accepted (2026-08-21, #195 / [BUG-81](../specs/BUG-81-spc-semicolon-mx-live.md))

## Context

BUG-81 reported `SPC ;` (M-x entry) as flaky/broken in the live embedded
editor while provably correct in unit fixtures. Chunk-level instrumentation of
the live input path showed the reported repro never delivered the `;` at all —
tmux `send-keys` consumes any standalone `;` argument as its own command
separator, even with `-l`, so the which-key popup simply timed in with no
second key. That repro artifact is documented in the spec.

Investigating the suspected engine-vs-live difference uncovered a real latent
bug in `src/steep/input.ts`: each tokenized key was dispatched with
`void this.handler(message)`. Real terminals coalesce fast keystrokes into a
single stdin chunk (`" "` and `";"` arrive as `" ;"`), so two keys from one
chunk ran **concurrently**: the second key's `handleKey` could read
leader/prefix state (`spacePressed`, `whichKeyPrefix`) before the first key's
async `handleKey` had set it — `SPC ;` would fall through as a bare `;`.
Unit fixtures never saw this because they `await` each `handleKey`
sequentially.

## Decision

Key dispatch in the Steep input layer is **serialized on a promise chain**
(`dispatchSerialized` in `src/steep/input.ts`): every key message runs to
completion — within a chunk and across overlapping chunks — before the next
begins. The chain is per-`Input`-instance (`dispatchTail`), so ordering is
by-construction and needs no locks. The `onKey` handler contract is unchanged:
handlers field their own errors (SteepFrontend catches `EDITOR_QUIT_SIGNAL`
and render errors); the chain's catch only keeps it alive if that contract is
violated, surfacing on stderr rather than silently swallowing.

## Consequences

- Multi-key sequences that depend on state set by an async predecessor
  (`SPC ;` is the canonical case) are correct under coalesced input.
- A slow handler now delays subsequent keys instead of racing them — the
  correct trade for an editor whose handlers mutate shared state.
- The daemon/TUI client path (`--keys` over RPC) is serialized separately by
  the server's request handling; this ADR covers only the embedded Steep
  stdin path.
- e2e playbooks driving panes through tmux must not use `send-keys` with a
  standalone `;` argument; use `load-buffer` + `paste-buffer` instead
  (documented in the BUG-81 spec resolution).
