# ADR-0199 — Configurable `default-major-mode` fallback (`#171` / SPEC-104)

## Status

Accepted

## Context

When no detection rule matched a buffer's filename, `major-mode-auto-detect`
returned the hard-coded string `"fundamental"`. There was no way for a user to
choose a different fallback (e.g. open new/undetected buffers in `text-mode` or
`markdown-mode`), unlike Emacs's `default-major-mode`.

## Decision

Made the no-match fallback configurable as the lowest-precedence step in the
detection chain (after filename `auto-mode-alist` and, when implemented, file-
local `mode:` (SPEC-102) and magic content sniffing (SPEC-103)):

1. **State** — added `defaultMajorMode: string` (default `"fundamental"`) to
   `MajorModeDomainState` (`src/editor/functional/domain-state.ts`).

2. **Helpers** — extracted `activateConfig(config)` (sets current mode, syntax
   language, indent rules, runs the activate hook) and `resolveDefault()`
   (returns the configured default if registered, else fundamental + warning).
   `major-mode-auto-detect` now calls `resolveDefault()` on the no-match path.

3. **API** — `(set-default-major-mode NAME)` setter + `(default-major-mode-get)`
   getter primitives in `src/editor/api/major-mode-ops.ts`.

### Why setter primitives, not `(setq default-major-mode …)`

Emacs exposes this as a `setq`-able variable because Emacs Lisp is **Lisp-2**
(separate function and variable namespaces). **T-Lisp is Lisp-1** — one shared
namespace — so a `setq`-able variable named `default-major-mode` would collide
with and shadow a same-named function. tmax therefore uses the setter/getter-
primitive idiom, the same pattern as `set-expand-tabs` / `set-tab-width` (#144).
A user who follows the Emacs habit and runs `(setq default-major-mode "text")`
gets a **clean error** ("variable not defined" — T-Lisp `setq` requires a prior
`defvar`) instead of silent session corruption; the configured default is
unchanged. This non-corruption is pinned by a test.

## Consequences

- Undetected buffers open in the user-configured default mode; default behavior
  (`fundamental-mode`) is unchanged when the variable is at its default.
- An unregistered configured default falls back to `fundamental` + warns
  (surfaces in `*Messages*`); no crash.
- Changing the default is forward-only: already-detected buffers keep their
  mode; new undetected buffers pick up the new default (pinned by a test).
- Filename detection still wins over the default (precedence pinned by a test).
- Set the default in `init.tlisp`: `(set-default-major-mode "text")`.
- This is the leaf of the detection precedence chain; SPEC-102 (file-local) and
  SPEC-103 (magic) compose above it when implemented.

## Verification

`bun run typecheck` clean; `bun run build` succeeds;
`bun test test/unit/default-major-mode.test.ts` → 7/7 pass.
Verify-gate (adversarial, 2-agent) verdict: **PASS**.
