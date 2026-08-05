# ADR-0176 — `loadCoreBindings` fails loud on a required-module load failure (#109 / BUG-60)

## Status

Accepted

## Context

BUG-60 was originally framed as a `tmax-use` `evalReady` race against T-Lisp
module load. That framing was **disproven**: `server.ts start()` is sequential —
`startEditor()` (which runs `loadCoreBindings` synchronously) completes **before**
`startSocket()`, so the socket cannot appear until core bindings are registered.
There is no race.

The real root cause: `BindingRuntime.loadCoreBindings`
(`src/editor/runtime/binding-runtime.ts`) **swallowed** required-binding load
failures. On any failure it `console.warn`d, called `loadFallbackBindings()`
(keymap-only — no commands), and unconditionally ran
`setCoreBindingsLoaded(true)` — a lie. The result: a daemon that **started
normally** (socket up, `(+ 1 2)` evaluated fine) but whose first real command
eval hit `Undefined symbol: find-file` (or any other command defined in the
required modules) because the parse error in a required `.tlisp` (e.g. a stray
paren pulled in transitively) was silently downgraded. The specific observed
flake (a `find-file.tlisp` stray paren) was fixed in `a448b70`, but the
swallow-on-failure mechanism remained live.

## Decision

Make a load failure of **any** required binding fatal and loud, instead of
silent fallback + a satisfied flag.

1. **Capture the real parse error.** `loadBindingsFromFile` now stashes the
   most recent failure message on a `lastBindingError` field (reset per call,
   set in each failure-return path), instead of discarding it into a
   `console.warn`. `loadCoreBindings` includes it in the thrown error.
2. **`loadCoreBindings` throws on the first failing required file** —
   `keymaps.tlisp` (SPEC-038) and each of `normal/insert/visual/command.tlisp`.
   Per the Codex correction, a `keymaps.tlisp` failure is fatal too: normal-mode
   global dispatch depends on its T-Lisp functions and there is no TS-level
   fallback dispatcher, so a broken keymap must not silently degrade to dead
   keys.
3. **`loadFallbackBindings` is no longer called from `loadCoreBindings`.** It
   survives only as the constructor-time pre-load baseline (`editor.ts`,
   `FALLBACK_BINDINGS`) — not a recovery path.
4. **`setCoreBindingsLoaded(true)` + `onCoreBindingsLoaded()` run only on full
   success** (after the loop). On failure the throw skips them, so
   `coreBindingsLoaded` stays `false` and the lazy-load guard can retry.

The rejection propagates through the plain-`await` facades
(`ensureCoreBindingsLoaded` → `ensureCoreBindingsLoadedPublic`) →
`server.startEditor()` → `server.start()`. The daemon launcher
(`src/main.ts:144-150`) surfaces it verbatim (`console.error('Failed to start
server:', error)`) and exits non-zero, so the socket never appears and a future
required-binding parse error produces a clear start failure naming the offending
required file + error — not a cryptic `Undefined symbol` later.

## Consequences

- **Contract change:** a missing or corrupt required command-module file (or
  `keymaps.tlisp`) now **fails daemon start** instead of degrading to a
  keymap-only editor. This is intended — a daemon with no `find-file` /
  `save-buffer` / working keymaps is not usable.
- **Happy path unchanged:** when all required files load (the production case),
  `loadCoreBindings` is byte-identical in effect (load all → set flag → toggle
  line-numbers). Verified by the existing happy-path unit test + three
  representative tmax-use playbooks (eval-38, eval-24, vim-parity-motions) and a
  manual fail-path check (a stray `)` in `normal.tlisp` → daemon fails to start
  naming `normal.tlisp: Unexpected closing parenthesis at line N`).
- **Embedded path:** `tmax file.md` (auto-daemon) fails loud; the direct-edit
  embedded branch (`bun run start`, `main.ts` Phase 5a) has a pre-existing
  `startEditor` catch that logs "Embedded server init skipped" — out of scope
  here; the embedded editor still has the constructor-time fallback keymap.
- The `evalReady`/`moduleReady` polling from the original framing is explicitly
  **not** re-added (the race was disproven; it would only convert the symptom
  from `Undefined symbol` to a timeout while leaving the swallowed-error cause
  in place).
