# SPEC-039: Markdown Org/Obsidian-Style Enhancements — Architectural Decisions

## Status

Accepted (2026-06-15)

## Context

SPEC-039 added an Org/Obsidian-inspired layer to the markdown major-mode: wiki-links, backlinks, frontmatter, code-block execution, table formulas, templates, and multi-backend export. The implementation is ~1600 lines of T-Lisp (`src/tlisp/core/commands/markdown.tlisp`) plus a handful of TS primitives in `tlisp-api.ts` and `file-ops.ts`. The work shipped in phases over several commits and then went through a `patch-review` audit that surfaced concrete gaps; a reflect-refine iteration on branch `spec-loop/039` closed them.

Several choices made during this work are load-bearing — they shape how future markdown/PKM features should be built, and unwinding them would touch a lot of code. This ADR records the decisions and their rationale so they aren't relitigated.

## Decisions

### 1. Feature logic lives in T-Lisp, not TypeScript

The entire feature set — parsing, navigation, formulas, export — is implemented in `src/tlisp/core/commands/markdown.tlisp`. TypeScript (`tlisp-api.ts`, `file-ops.ts`) only contributes primitives that T-Lisp genuinely cannot do: spawning processes (`shell-command`), raw filesystem I/O (`read-file-content`, `write-file-content`, `file-rename`, `file-glob`), and regex-backed primitives (`string-match`, `match-string`, `match-beginning`, `match-end`, `replace-regexp-in-string`).

**Rationale:** This is the project's core architectural rule (Emacs architecture: TS = primitives, T-Lisp = editor logic). Markdown commands are editor logic. Keeping them in T-Lisp means they're inspectable and user-extensible without recompiling.

**Consequence:** Regex-heavy parsing has to use the T-Lisp regex primitives, whose escaping rules are non-obvious (see Decision 5). Performance-critical loops pay the interpreter overhead. This is an accepted trade.

### 2. Export dispatch is descoped to per-backend commands, not a which-key popup

`markdown-export-dispatch` was originally specified as a which-key popup that prompts for a backend. It is now a status-message hint pointing at the per-backend bindings (`, x h` / `, x t` / `, x l`).

**Rationale:** The `read-string` primitive is a synchronous stub that returns `""`, and T-Lisp has no `completing-read` or popup-picker primitive. Implementing a real interactive picker requires async-minibuffer work that's out of scope for this feature. Descope is cleaner than a misleading no-op dispatch.

**Consequence:** Users invoke backends by their direct binding. If a picker is added later (new primitive or fixing `read-string`), `markdown-export-dispatch` is the natural place to wire it — the per-backend commands already exist and work.

### 3. Persistent shell sessions are descoped

The `shell-exec-session` / `session-kill` / `session-list` primitives and their `markdown-kill-session` / `markdown-list-sessions` wrappers were removed. The SPEC body already marked them strikethrough "Not working".

**Rationale:** The `sessions` Map was declared but never populated — `shell-exec-session` always spawned a transient `Bun.spawnSync`. Worse, the T-Lisp layer never parsed session attributes from code fences, so even a correct primitive would have had no caller. Persistent process management is a real feature but it belongs in a focused future SPEC, not half-implemented here.

**Consequence:** Code-block execution is one-shot per block. No state carries between executions. The SPEC slot for session features is formally deferred; if/when it returns, it should be its own SPEC with the session-attribute parsing designed end-to-end.

### 4. Templates read from `~/.config/tmax/templates/` with built-in fallback

`markdown-new-from-template` reads `~/.config/tmax/templates/<name>.md` if present, else falls back to built-in `blank` / `daily` / `meeting` strings. Template files support `{{date}}` and `{{title}}` substitution via `markdown-expand-template-variables`. The template name is passed via the keybinding prefix (`, N` / `, N d` / `, N m`), not a prompt — because `read-string` is a stub (see Decision 2).

**Rationale:** User-supplied templates are a hard requirement of the feature, and the built-ins give a working out-of-box experience. The `~`-expansion was added to `read-file-content` itself (via `process.env.HOME`) so every caller benefits, rather than each caller reimplementing it.

**Consequence:** The `read-file-content` primitive now expands a leading `~`. Callers passing literal paths with a `~` prefix get HOME-substituted behavior. This is documented at the primitive; no caller relied on `~` as a literal filename character.

### 5. Regex escaping: single backslash for groups, double for literals

Aggregate table-formula regexes (`sum`/`mean`/`min`/`max`/`count`) use `\(` for capture groups (single backslash in the `.tlisp` source) and `\\$` / `\\.` for literal dollar/dot (double backslash). This matches the proven pattern at `markdown.tlisp:77` (the heading regex) and **not** the quadruple-backslash form an earlier iteration used.

**Rationale:** The T-Lisp reader turns `\\` into `\`, so `\\$` becomes `\$` at the regex level (literal dollar), and `\(` stays `\(` (capture group). The quadruple form `\\\\$` becomes `\\$` at the regex level, which the engine reads as literal-backslash + end-anchor — wrong. This was a latent bug that unit tests missed (the test harness calls the interpreter directly) and the live `tmaxclient --eval` path exposed (JSON-RPC re-decodes the expression). The fix is documented here because the wrong form *looks* more conservative and a future contributor could easily "fix" it back.

**Consequence:** Any new T-Lisp regex using capture groups must follow this convention. Five explicit per-function regex checks are used instead of one alternation (`\(sum\|mean\|...\)`) because the alternation form proved unreliable inside the longer aggregate pattern — another trap worth not stepping back into.

### 6. Module internals called by exported functions must be exported

During the reflect-refine iteration, `markdown-table-eval-formula` (exported) threw "Undefined symbol" at call time because it called `markdown-table-row-p` and `markdown-delete-line` (defined in the same file but not in the `(export ...)` list). Exporting them fixed it. This was a latent bug with no test coverage until the new audit-fix tests exercised the path.

**Rationale:** The T-Lisp module loader binds exported symbols for use by exported-function bodies at call time; non-exported symbols aren't reachable from an exported function's eval context. (Internal-to-internal calls work within the same `progn`/load context, which is why `markdown-align-table` appeared to work — it happened not to exercise the unexported-helper path at eval time.)

**Consequence:** When adding a new `(defun ...)` that an exported function will call, add it to the `(export ...)` list. The rule is now implicit in how the module system works; a future interpreter change could make non-exported helpers reachable and relax this, but until then it's required.

### 7. LaTeX export tracks list state, wrapping items in `itemize`

The LaTeX backend maintains an `in-list` boolean and emits `\begin{itemize}` on the first consecutive list item, `\end{itemize}` when the run ends (heading, code fence, blank line, or EOF). Previously it emitted bare `\item` lines outside any list environment.

**Rationale:** Bare `\item` outside a list environment produces uncompilable `.tex`. The state-tracking mirrors the existing `in-code-block` flag in the same function — same pattern, second axis.

**Consequence:** Nested lists aren't handled (a `-` inside an indented block is treated as a continuation of the current list). That's a known limitation; nested-list support would need a stack rather than a boolean, and is deferred.

## Consequences Summary

**Easier:**
- PKM-style markdown features (links, templates, formulas, export) are available and extensible in T-Lisp without touching TypeScript.
- The descope decisions (sessions, export popup) keep the shipped surface honest — no misleading no-ops.
- The escaping and export-list rules are now documented, reducing the chance of re-introducing the bugs.

**Harder:**
- Regex-heavy parsing must navigate the T-Lisp escaping rules (Decision 5).
- Module authors must remember to export helpers used by exported functions (Decision 6).
- Interactive features that need a real prompt/picker are blocked on a `completing-read` primitive or a fixed `read-string` (Decisions 2, 4).

## Related

- [SPEC-039](../specs/SPEC-039-markdown-org-obsidian-enhancements.md) — the full spec, including the patch-review audit findings and reflect-refine iteration notes.
- The `patch-review` verdict at `.patch-reviews/SPEC-039-2026-06-13T20-13-08/verdict.md` (gitignored machine state) drove the descope and bug-fix decisions.
- [ADR-0059](ADR-0059-interchangeable-frontends.md) — the TS-primitives / T-Lisp-logic split that Decision 1 follows.
