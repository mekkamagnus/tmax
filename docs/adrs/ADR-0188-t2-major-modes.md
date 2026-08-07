# ADR-0188 — T2 major modes: text, conf, css, html, rust, dockerfile (`#152`)

## Status

Accepted

## Context

`docs/modes.md` lists six T2 major modes as missing (❌): text, conf, css, html,
rust, dockerfile. Without them, `.txt`/`.conf`/`.css`/`.html`/`.rs`/`Dockerfile`
files fall back to `fundamental-mode`. This is the same registration-only pattern
established by the T1 modes (#150 / SPEC-089 / ADR-0186): extensions + best-effort
indent hints, full electric behavior deferred to Phase 1.5 (#149/#151).

The syntax tokenizer supports none of these languages, so all six pass `nil` for
`syntax-language` (keeps `major-mode-set` error-free — same as #150).

One wrinkle: `Dockerfile` has no extension, so extension-based auto-detect cannot
catch it. `detectAutoMode` (`auto-mode.ts`) tests regexp rules against the full
filename, so a `[Dd]ockerfile` regexp rule covers `Dockerfile` and variants.

## Decision

Add six registration-only mode files modeled on `typescript-mode.tlisp`:
`(major-mode-register NAME EXTENSIONS nil INCREASE DECREASE)` with best-effort
indent regexes. `dockerfile-mode.tlisp` additionally calls
`(auto-mode-add "[Dd]ockerfile" "dockerfile" "regexp")`. Wire all six into
startup via `(require-module editor/modes/…)` in `normal.tlisp`.

Indent rules (increase = prev-line match → indent next; decrease = current-line
match → dedent):
- **text** / **conf** / **dockerfile** — none (flat grammars).
- **css** / **rust** — `\\{$` / `^\\s*}` (brace blocks).
- **html** — `>$` / `^\\s*</` (best-effort tag heuristic; full tag-aware indent
  is Phase 1.5 / ROADMAP §1.9).

## Consequences

- 11 more file extensions/filenames now auto-detect to the right mode (text,
  conf/ini/cfg/properties/env, css/scss/less, html/htm/xhtml, rs, dockerfile +
  the `Dockerfile` filename).
- No syntax highlighting (no tokenizer) — consistent with registration-only
  status. css/html/rust full behavior is Phase 1.5 (#149/#151).
- Same best-effort-indent caveat as T1 (#150): the indent rules are hints; the
  verify-gate confirmed a pre-existing indent-rule regex double-escape quirk
  inherited from T1 — not a T2 regression, deferred to Phase 1.5.
- Verify-gate (SPEC-090): **PASS** — all 10 acceptance criteria met.
