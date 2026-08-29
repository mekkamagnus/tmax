# Yank/cut/paste flash feedback (vim-goggles)

## Status

Accepted (2026-08-29) — implements #231 / SPEC-231.

## Context

Register mutations gave zero visual feedback. Design constraints discovered up front: the TUI client polls at 200 ms (so a flash shorter than one poll window is invisible and its change-detection must learn about flashes), syntax spans are recomputed per render (a flash needs its own state field), and T-Lisp timer primitives are off-limits (the TTL must live in TypeScript, per the which-key precedent).

## Decision

1. **One primitive, one state field**: `flash-region` (new `flash-ops.ts`) builds absolute-line-indexed inverse-ish spans (gray `bg #555555` — `ANSIStyle` has no inverse) into `EditorState.flashSpans`, with a TS-side 300 ms timer clear; a new flash supersedes an in-flight one. T-Lisp owns when/where: hooks on the operator (register-extent for y, cut-site for d/c, gated by an `applied` flag so failed combos never flash), text-object (exact region), visual (y/d wrappers + visual-paste), x, and paste paths.
2. **One shared merge**: `src/render/flash-merge.ts` merges flash over syntax spans to max(base, flash) length; capture-frame (Steep/capture RPC) and the TUI client both use it — the flash reaches both frontends without truncating syntax below it.
3. **The client wire carries flashes**: `editorStateToJson` serializes `flashSpans`; `jsonToEditorState` AND the daemon's `frameToEditorState` map it back (the deserialize side was the round-1 dead-code bug); the client poll compares flash content (not just presence) so onset, clear, and supersede each re-render.

## Consequences

- Every yank/cut/paste now flashes for ~300 ms in both frontends; four adversarial gate rounds are documented in SPEC-231's audit sections (they caught misindexed spans, the dropped client-wire field, phantom flashes on failed operators, and a syntax-truncating merge — all fixed with tests).
- Known cosmetic edges, documented in the spec: multi-line yanks/pastes flash only the first line's extent; find-motion operators and D/C/Y are unflashed (follow-ups); dedup pastes over-flash by one copy; a flash timer may fire after editor teardown (benign).
- Baselines: api-names-static.txt 421→422 + registry count.
