# ADR-0214 — Man-page viewer (`man` / `woman`) (`#181` / SPEC-114)

## Status
Accepted

## Context
tmax's comint/shell modes run real shell commands, but there was no way to look
up a command's documentation in-editor — users context-switched to a terminal
`man`. Emacs solves this with `Man`/`WoMan`. SPEC-114 called for both backends
(per the agentic-coding rule): a `man` binary wrapper (accurate) AND a zero-dep
`woman` roff renderer (default when `man` is absent).

## Decision
A man-page viewer with two auto-selected backends, a read-only `man-mode`, and
comint/shell integration. All in `src/editor/man/` (TS) + `man.tlisp` (T-Lisp):

1. **Resolver** (`resolver.ts`) — searches `MANPATH` (else macOS/Linux/homebrew
   dirs) for `topic.S[.gz]`, honoring section + `MANSECT`. `Bun.gunzipSync` for
   `.gz`.
2. **`woman` renderer** (`woman.ts`) — pure-TS roff → text. Handles classic-man
   AND mdoc (the macro set macOS pages use) common subsets. Inline macros append
   to a paragraph buffer (mdoc's one-macro-per-line reflows into sentences);
   block macros flush. Font escapes consumed (plain text — styling lives in the
   highlight layer). Targets readability, not pixel accuracy.
3. **`man` backend** (`man-backend.ts`) — spawns the system `man` with
   `MANPAGER=cat` (avoids the pager hanging the spawn), strips nroff overstrike.
4. **Selector** (`manpage.ts`) — `man` binary if `command -v man` succeeds, else
   `woman`. Resolves the real section in both paths; extracts SEE ALSO.
5. **`man-mode` + commands** (`man.tlisp`) — `(man topic)`, `:man <topic>`
   dispatch, `}`/`{` section jumps, RET follows a `name(sec)` SEE-ALSO ref, `s`
   within-page search, `q` bury, history stack. `K` in normal mode (vim-
   traditional) opens the man page for the word under point — works in any
   buffer including comint/shell.

## Consequences
- `:man ls` / `M-x man` renders a real man page in `*Man*` (man-mode). On hosts
  with the `man` binary (macOS/Linux), output is maximally accurate; the
  `woman` backend is the zero-dep fallback for man-less environments.
- The `woman` renderer covers the common macro subset; exotic troff requests
  fall through best-effort. This is a scope/correctness decision (covers real
  pages users hit), not an effort-trim — pinned by fixture + real-page tests.
- `man.tlisp` uses `list`/`nth` for the topic+section pair (T-Lisp `cons`
  requires a list second arg; `(cons name text)` with a string text errors).
- The man binary is forced non-interactive (`MANPAGER=cat`); without that `man`
  launches `less` and hangs the spawn.

## Verification
`bun run typecheck` (4 projects) clean. New
`test/unit/man-page-viewer.test.ts` 12/12 (resolver find/null/section; woman on
a real `ls` page + classic-man fixture; escape processing; overstrike stripping;
`man-format` primitive; `(man "ls")` renders into `*Man*` under man-mode;
`printf(3)` section syntax; unknown page → Right(nil); `man-next-section`).
Regression: command-line/comint/describe/helpful/help-mode 31/31. Verify-gate: PASS.
