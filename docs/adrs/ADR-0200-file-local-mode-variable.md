# ADR-0200 — File-local `mode:` variable detection (`#169` / SPEC-102)

## Status

Accepted

## Context

tmax detected the major mode only from the filename. A file could not override
that, so a markdown file named `notes.txt`, or any extension-less/generated file
whose name didn't reflect its language, opened in the wrong mode. Emacs lets a
file declare its own mode via a file-local `mode:` variable.

## Decision

Added the **highest-precedence** step in `major-mode-auto-detect`: a file-local
`mode:` declaration overrides filename (and, when implemented, magic/default)
detection.

1. **Pure scanner** `findFileLocalMode(text)` in `src/editor/local-variables.ts`.
   Honors two forms:
   - First-line magic comment between `-*-` markers: `# -*- mode: python; -*-`,
     `<!-- -*- mode: markdown; -*- -->` (embedded), and the bare `-*- python -*-`
     shorthand.
   - A trailing `Local Variables:` … `End:` block with `mode: NAME`.
   - Only the `mode:` variable is honored. **`eval:`-style locals are
     intentionally NOT implemented** (security). Malformed declarations return
     `undefined` (fall through).

2. **Wiring** — `resolveFileLocal()` helper in `major-mode-ops.ts` reads the
   current buffer's text and activates the declared mode if registered;
   `major-mode-auto-detect` runs it FIRST (before `detectAutoMode`). An
   unregistered declared mode falls through to filename detection (no error).

3. **Gate** — `enableLocalVariables` (default `true`) on `MajorModeDomainState`;
   `(set-enable-local-variables FLAG)` / `(enable-local-variables-p)`. When off,
   `resolveFileLocal` short-circuits.

### Why setter primitives, not `(setq enable-local-variables …)`

Same reason as ADR-0199 (SPEC-104): T-Lisp is Lisp-1, so a setq-able variable
named `enable-local-variables` would collide with a same-named function. The
gate uses the setter-primitive idiom. Emacs (Lisp-2) uses a real variable.

## Consequences

- `notes.txt` with `# -*- mode: markdown; -*-` opens in `markdown-mode`.
- A file-local `mode:` wins even when the filename already matches a rule
  (`README.md` + `mode: text` → `text-mode`).
- No-declaration files detect exactly as before (no regression).
- `(set-enable-local-variables nil)` disables the feature (security opt-out).
- This is the top of the precedence chain: file-local > filename > magic
  (SPEC-103, future) > default (SPEC-104). Composes cleanly with the others.

## Verification

`bun run typecheck` clean; `bun run build` succeeds;
`bun test test/unit/file-local-mode.test.ts` → 11/11 pass (scanner + override +
precedence + gate + unregistered fall-through).
Verify-gate (adversarial, 2-agent) verdict: **PASS**.
