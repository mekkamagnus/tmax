# ADR-0204 — In-editor apropos + apropos-documentation (`#174` / SPEC-107)

## Status
Accepted

## Context
The TS `apropos-command` primitive existed but had no T-Lisp wrapper, no key
binding, and filtered to functions only (not variables). The `:help` hint
advertised "M-x apropos" that wasn't reachable. There was also no docstring-body
search (the "I think there's a command that does X" tool).

## Decision
1. **T-Lisp commands** — `apropos` (name search) and `apropos-documentation`
   (docstring-body search) in `describe.tlisp`, both using `read-from-minibuffer`
   for the regex prompt and `describe-to-help` for `*Help*` rendering.
2. **Variable-name search** — removed the function-only filter from
   `apropos-command`'s `checkMatch`; non-function bindings are included with
   docstring `(variable)` and no key bindings.
3. **New `apropos-documentation` primitive** — mirrors `apropos-command`'s
   enumeration but matches the regex against docstring BODIES (not names);
   returns `(name type docstring)`.
4. **Bindings** — `SPC h a` → `apropos`, `SPC h A` → `apropos-documentation`.
5. **ReDoS hygiene** — both primitives cap pattern length at 500 chars.

## Consequences
- `SPC h a` and `M-x apropos` are live; results render in `*Help*` as
  `name [bindings] docstring` rows (functions) or `name (variable)` rows.
- `SPC h A` / `M-x apropos-documentation` searches what functions DO, not just
  their names.
- Variables (keymaps, saved-modtimes, etc.) are discoverable by name.
- Pre-existing `findCommandsByPattern` in server.ts has the same regex pattern —
  a follow-up ReDoS hardening pass should cap it too.

## Verification
`bun run typecheck` clean; `bun test test/unit/apropos.test.ts` → 6/6 pass
(name search, variable-name search, docstring-body search, *Help* render,
no-matches page, SPC h a/A bindings); 31/31 regression across apropos +
core-bindings + vim-dispatch.
Verify-gate (adversarial, 2-agent) verdict: **PASS**.
