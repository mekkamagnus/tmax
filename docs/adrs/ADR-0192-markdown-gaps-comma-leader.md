# ADR-0192 — Markdown gaps: comma-leader dispatch + indent rules (`#157`)

## Status

Accepted

## Context

`#157` listed seven markdown-mode gaps. Two were high-impact, self-contained
correctness fixes; the other five are enhancements / separate subsystems and are
deferred (filed as follow-ups).

**Gap 6 (comma-leader):** the markdown major mode binds `, b`/`, i`/`, h`/… (the
markdown leader), but pressing `,` ran the *global* `vim-repeat-find-reverse`
binding (`,`) before the major-mode leader could form — so **none of the
`,`-prefixed markdown bindings ever dispatched**. The entire markdown leader
keymap was dead.

Root cause: `normal-handler.ts` `isMajorModePrefix` decided whether a key is a
"complete binding" (not a prefix) by calling `lookupMajorModeBinding`, which uses
`resolveMapping` — and `resolveMapping` falls through to global/mode-only
bindings. So `,` (global `vim-repeat-find-reverse`, mode="normal", no majorMode)
matched as `modeOnly`, `lookupMajorModeBinding(",")` returned it, and
`isMajorModePrefix` concluded `,` was a complete binding → the major-mode prefix
path was skipped → the global `,` executed.

**Gap 1 (indent rules):** `markdown-mode` registered with empty indent rules;
with #149's electric-indent (default ON), markdown had nothing to apply on Enter.

## Decision

- **Gap 6** — in `isMajorModePrefix`, treat a key as a "complete major-mode
  binding" only if the **major mode defines it specifically** (`m.majorMode ===
  currentMajorMode`). A global/mode-only binding no longer excludes a key from
  being a major-mode prefix. Effect: in markdown, `,` starts the leader (`, b` →
  `markdown-toggle-bold`); in other modes `,` is still `vim-repeat-find-reverse`
  (no regression — only modes with `,`-prefixed bindings are affected; `]` and
  other major-mode prefixes are unchanged because they have no competing global
  complete binding).
- **Gap 1** — `markdown-mode.tlisp` `major-mode-register` gains best-effort
  increase rules for list items (`^\\s*[-*+]\\s`, `^\\s*\\d+\\.\\s`) and
  blockquotes (`>\\s*$`); decrease left empty (markdown dedent is manual).

## Consequences

- The markdown `,`-leader keymap now works (`, b` bold, `, i` italic, `, h`
  heading, …) — the single highest-impact markdown fix. `,` outside markdown is
  unchanged.
- Markdown gets list/blockquote indent-on-Enter (best-effort, like other modes).
- **Deferred (transparent follow-ups):** gap 2 (text objects `cit`/`da`/`iH`),
  gap 3 (`read-string` interactive prompt — sync stub still returns `""`), gap 4
  (`markdown-export-dispatch` no-op), gap 5 (in-TUI preview renderer — Oolong /
  SPEC-021), gap 7 (`markdown-promote/demote-heading` line-shift — TS primitive).
  These are enhancements / separate subsystems, tracked separately.
- Verify-gate (SPEC-094): **PASS** — stated AC met; no keymap regression
  (vim-bindings-smoke + core-bindings 105/0; which-key-popup + steep-which-key
  36/0; markdown family 135/0).
