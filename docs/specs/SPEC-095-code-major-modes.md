# Feature: Code major modes functional + indent-engine apply fix (`#151`)

## Feature Description

`#151`: typescript/python/go/lisp were "registered but incomplete." The indent
engine never APPLIED indentation (calculate-only), so no mode auto-indented. This
fixes the engine's apply step + the rule-storage path (without touching the
load-bearing parser), and adds a per-mode `reindent-buffer` command + keymap.

The fixes (all narrow — parser untouched, markdown unaffected):
1. **`indent-apply-line` now APPLIES.** After calculating the target column, it
   sets the line's leading whitespace to `column` spaces (was calculate-only →
   electric-indent was a silent no-op for every mode).
2. **major-mode-ops stores indent rules DIRECTLY** in `indentRulesByBuffer`
   (newly exported), bypassing the `evalTlisp (indent-set-rules …)` re-embed
   whose second parse re-corrupted the regex backslashes.
3. **4 code modes use 4-backslash indent regexes** so they survive the
   (tokenizer+parser) string parse as correct regexes. (The parser double-processes
   strings — load-bearing for markdown etc., so NOT changed.) `)` rules use `[)]`
   (an unescaped `)` is invalid in JS RegExp; `\)` can't survive the parser's
   default-drop). typescript's malformed `\\($?` → `\\($`.

Plus: `reindent-buffer` command + `g =` keymap in each of the 4 modes.

**Deferred (out of scope — need external tooling):** LSP commands (go-to-definition,
rename, diagnostics), external format, compile/run.

## User Story

As a tmax user editing TypeScript/Python/Go/Lisp,
I want the major mode to highlight, indent on Enter, and re-indent the buffer,
So that the mode is a functional editing environment.

## Solution Statement

- `src/editor/api/indent-ops.ts`: export `indentRulesByBuffer`; `indent-apply-line`
  applies the column via `buffer.replace` + `setCurrentBuffer` (no-op if correct).
- `src/editor/api/major-mode-ops.ts`: import + direct-store rules (no re-embed) in
  major-mode-set + auto-detect.
- `src/tlisp/core/modes/{typescript,python,go,lisp}-mode.tlisp`: 4-backslash regexes;
  typescript `\\($?`→`\\($`; `)` decrease rules use `[)]`.
- `src/tlisp/core/commands/indent-ops.tlisp`: `reindent-buffer`.
- 4 modes: `(key-bind "g =" "(reindent-buffer)" "normal" "<mode>")`.

## Acceptance Criteria

- [ ] `(major-mode-set NAME)` sets `(syntax-get-language)` for each of the 4 modes.
- [ ] `reindent-buffer` indents a line after the mode's opener (typescript/go `{` → 4 spaces; python `if x:` → body indented; lisp `(` → indented) and dedents closers.
- [ ] `indent-apply-line` applies (no longer calculate-only).
- [ ] `g =` bound to `reindent-buffer` in each of the 4 modes.
- [ ] No regression: tokenizer/string-escaping/core-bindings/vim-bindings-smoke green; full unit suite has no NEW failures vs main (the apply step activates system-wide electric-indent — fundamental-mode buffers have no rules so are unaffected; only code modes gain indent).
- [ ] `bun run typecheck` clean.

## Validation Commands

- `bun run typecheck`
- `bun test test/unit/code-major-modes.test.ts`
- `bun test test/unit/tokenizer.test.ts test/unit/string-escaping.test.ts test/unit/core-bindings.test.ts`
- Full unit suite (apply step is system-wide)

## Notes

- The parser's double-processing is NOT changed (it's load-bearing for markdown
  etc.). The indent rules are fixed via 4-backslash sources + direct storage.
- Other modes (json/yaml/etc.) keep their 2-backslash rules; their brace-based
  rules survive the parse as valid (coincidentally correct). The apply step now
  gives them brace-based auto-indent on Enter (an improvement, was a no-op).
- Tooling commands (go-to-def/run/LSP-format) deferred — need external tools.
