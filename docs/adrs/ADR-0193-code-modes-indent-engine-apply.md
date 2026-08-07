# ADR-0193 — Code major modes: indent engine apply + direct rule storage (`#151`)

## Status

Accepted

## Context

`#151`: typescript/python/go/lisp were "registered but incomplete." Investigation
(see the indent-engine-calculate-only memory) found the indent engine never
APPLIED indentation — `indent-apply-line` returned the target column but never
set the line's whitespace, so #149's electric-indent was a silent no-op for every
mode. Separately, the rules were corrupted: the parser double-processes string
escapes (load-bearing — markdown etc. over-escaped to compensate), and
`major-mode-ops` re-embedded the parsed rules into a new `evalTlisp` source that
re-parsed (re-corrupting) them.

A prior attempt fixed the parser's double-processing directly — correct, but it
broke 27+ markdown tests (the double-processing is load-bearing). So that path
needs a coordinated codebase-wide string-escape migration, too broad for #151.

## Decision

A **narrow** fix that leaves the parser (and markdown) untouched:

1. **`indent-apply-line` now APPLIES** the calculated column (`src/editor/api/indent-ops.ts`).
   After `indent-calculate-column`, set the line's leading whitespace to `column`
   spaces via `buffer.replace` + the existing `setCurrentBuffer`; no-op if already
   correct. This is the missing piece that makes electric-indent actually indent.
2. **`major-mode-ops` stores indent rules DIRECTLY** in `indentRulesByBuffer`
   (newly exported from `indent-ops.ts`), bypassing the `(indent-set-rules …)`
   `evalTlisp` re-embed — so the rules are stored once (as-registered), not
   re-parsed a second time. Both `major-mode-set` and `major-mode-auto-detect`.
3. **4 code modes use 4-backslash indent regexes** so they survive the
   (tokenizer+parser) double-parse as correct regexes (each `\` → `\\\\`).
   typescript's malformed `\\($?` → `\\($`. Decrease rules matching `)` use `[)]`
   (an unescaped `)` is invalid in JS RegExp; `\)` can't survive the parser's
   default-drop, so the character class is the robust form).
4. **`reindent-buffer`** command + **`g =`** keymap in each of the 4 modes.

## Consequences

- The 4 code modes now auto-indent on Enter (electric-indent applies) and `g =`
  reformats the whole buffer; verified typescript/go indent `{`-bodies to the tab
  width and dedent `}`, python indents bodies after `:`, lisp after `(`.
- The apply step is system-wide: every mode with valid rules now auto-indents.
  Fundamental-mode buffers (`*scratch*`, most tests) have no rules → unaffected.
  Other modes (json/yaml/etc.) keep 2-backslash rules; their brace-based rules
  survive the parse as valid → they gain brace-based auto-indent (an improvement
  over the prior no-op). Modes with `\)`-containing 2-backslash rules (e.g. shell)
  still error-then-swallow on those rules (no indent, no crash — unchanged).
- The parser is **unchanged** — markdown and all other double-processing-dependent
  code is unaffected. The deeper parser string-escape migration remains a separate
  opportunity (would let rules use natural 2-backslash + fix the latent markdown
  over-escaping), but it's not required for #151.
- Tooling-dependent commands (go-to-definition, LSP format, compile/run) are
  deferred — need external tools.
- Verify-gate (SPEC-095): **PASS** — acceptance criteria met; full unit suite
  shows no new failures vs main.
