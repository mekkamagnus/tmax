# ADR-0207 — Helpgrep: full-text search over the Texinfo manual (`#178` / SPEC-111)

## Status
Accepted

## Context
tmax had `apropos` (live symbol/docstring search) and `occur` (current-buffer
search) but no way to full-text-search the **written prose manual** (the Texinfo
sources in `docs/tmax/`). Users reading about a concept in the manual had no
in-editor way to find every mention.

## Decision
Added `helpgrep` — `:helpgrep <pattern>` / `M-x helpgrep` greps the Texinfo
corpus (`docs/tmax/{tmax,tlisp}.texinfo`) and renders occur-style results
(`file:line:text`) in `*Help*`.

1. **`(helpgrep-search PATTERN)`** TS primitive: reads the corpus via
   `fs.readFileSync`, regex-greps each line (case-insensitive; escaped-literal
   fallback on invalid regex), returns `((file line text) ...)`. 500-char
   pattern cap (ReDoS hygiene). Corpus resolved via `import.meta.dir`.
2. **`(helpgrep-run PATTERN)`** T-Lisp: renders results via `describe-to-help`
   + sets major-mode `"helpgrep"`.
3. **`(helpgrep-jump)`** T-Lisp: parses the `file:line:` prefix of the current
   result line, resolves the corpus path via `(helpgrep-docs-dir)`, opens the
   texinfo source via `find-file`, and jumps to the line. Bound to RET scoped
   to major-mode `"helpgrep"`.
4. **`:helpgrep <pattern>`** and **`:helpgrep`** (bare → prompt) in
   command-line.tlisp. `:help` hint updated.

## Consequences
- Users can search the manual from within the editor and jump to source
  locations (RET on any result line).
- Distinct from `apropos` (live symbol metadata) — documented split.
- Corpus is hardcoded to `docs/tmax/*.texinfo`; a future enhancement could add
  `documentation.ts` / specs as a `C-u` widened scope.
- `import.meta.dir` corpus resolution works for dev (`bun src/main.ts`) and
  from the standard checkout; installed-binary users without docs/ won't get
  results (graceful no-match).

## Verification
`bun run typecheck` clean; `bun test test/unit/helpgrep.test.ts` → 5/5 pass
(search + render + no-matches + `:helpgrep` binding + jump-to-source).
Verify-gate (adversarial, 2-agent) verdict: **PASS** (retry 1 after adding jump).
