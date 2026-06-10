# Mode Inventory

Tracks every major and minor mode for tmax: what exists, what's missing, and what to build next.

See [ROADMAP § Phase 1.6](./ROADMAP.md) for the phase this inventory feeds into. Mode *mechanism* lives in [SPEC-003 (minor-mode-system)](./specs/SPEC-003-minor-mode-system.md); individual modes get their own SPECs only when non-trivial.

---

## Rubric

Every mode is scored on four axes. Tier is derived from the first three.

| Axis | Values | Meaning |
|------|--------|---------|
| **Frequency** | low / med / high | How often the file type appears in real repos (majors) or how often the behavior is wanted (minors) |
| **Complexity** | S / M / L | Implementation effort. S = single-file mode with no indent engine; M = indent + a few commands; L = parser, tag objects, or external tool integration |
| **Template** | mode name | Closest existing mode to copy from. "scratch" = no template, write from zero |
| **Blockers** | none / has-deps / blocked | Prerequisites that must ship first |

**Tier:**
- **T1** — high frequency + (S or M complexity) + no blockers. Ship first.
- **T2** — medium frequency, or has deps that are themselves T1.
- **T3** — low frequency, L complexity, or community-driven.

---

## Major Modes

| Mode | Extensions | Status | Tier | Freq | Complexity | Detail |
|------|-----------|--------|------|------|-----------|--------|
| fundamental | (none) | ✅ shipped | — | — | — | [fundamental-mode](#fundamental-mode) |
| typescript | `.ts` `.tsx` `.js` `.jsx` `.mjs` | 🟡 registered | T2 | high | M | [typescript-mode](#typescript-mode) |
| python | `.py` `.pyi` | 🟡 registered | T2 | high | M | [python-mode](#python-mode) |
| go | `.go` | 🟡 registered | T2 | med | M | [go-mode](#go-mode) |
| lisp | `.tlisp` `.lisp` `.el` `.clj` | 🟡 registered | T2 | med | M | [lisp-mode](#lisp-mode) |
| markdown | `.md` `.markdown` `.mdx` | ✅ shipped | — | high | — | [markdown-mode](#markdown-mode) |
| json | `.json` `.jsonc` | ❌ missing | T1 | high | S | [json-mode](#json-mode) |
| yaml | `.yaml` `.yml` | ❌ missing | T1 | high | S | [yaml-mode](#yaml-mode) |
| shell | `.sh` `.bash` `.zsh` `.fish` | ❌ missing | T1 | high | S | [shell-mode](#shell-mode) |
| toml | `.toml` | ❌ missing | T1 | med | S | [toml-mode](#toml-mode) |
| css | `.css` `.scss` `.less` | ❌ missing | T2 | med | M | [css-mode](#css-mode) |
| html | `.html` `.htm` | ❌ missing | T2 | med | M | [html-mode](#html-mode) |
| rust | `.rs` | ❌ missing | T2 | med | M | [rust-mode](#rust-mode) |
| text | `.txt` `.text` | ❌ missing | T2 | high | S | [text-mode](#text-mode) |
| conf | `.conf` `.ini` `.cfg` | ❌ missing | T2 | med | S | [conf-mode](#conf-mode) |
| dockerfile | `Dockerfile` `*.dockerfile` | ❌ missing | T2 | med | S | [dockerfile-mode](#dockerfile-mode) |
| xml | `.xml` `.svg` `.xsd` | ❌ missing | T3 | low | M | [xml-mode](#xml-mode) |
| c | `.c` `.h` | ❌ missing | T3 | low | M | [c-mode](#c-mode) |
| cpp | `.cpp` `.cc` `.hpp` | ❌ missing | T3 | low | L | [cpp-mode](#cpp-mode) |
| java | `.java` | ❌ missing | T3 | low | M | [java-mode](#java-mode) |
| sql | `.sql` | ❌ missing | T3 | low | S | [sql-mode](#sql-mode) |

---

## Minor Modes

| Mode | Status | Tier | Freq | Complexity | Detail |
|------|--------|------|------|-----------|--------|
| line-numbers | ✅ shipped | — | high | — | [line-numbers-mode](#line-numbers-mode) |
| relative-line-numbers | ✅ shipped | — | med | — | [relative-line-numbers-mode](#relative-line-numbers-mode) |
| auto-fill | ✅ shipped | — | low | — | [auto-fill-mode](#auto-fill-mode) |
| overwrite | ❌ missing | T1 | med | S | [overwrite-mode](#overwrite-mode) |
| read-only | ❌ missing | T1 | high | S | [read-only-mode](#read-only-mode) |
| show-paren | ❌ missing | T1 | high | S | [show-paren-mode](#show-paren-mode) |
| whitespace | ❌ missing | T1 | high | S | [whitespace-mode](#whitespace-mode) |
| truncate-lines | ❌ missing | T1 | high | S | [truncate-lines-mode](#truncate-lines-mode-mode) |
| electric-pair | ❌ missing | T1 | high | S | [electric-pair-mode](#electric-pair-mode) |
| electric-indent | ❌ missing | T1 | high | S | [electric-indent-mode](#electric-indent-mode) |
| font-lock | ❌ missing | T2 | high | M | [font-lock-mode](#font-lock-mode) |
| subword | ❌ missing | T2 | med | S | [subword-mode](#subword-mode) |
| indent-tabs | ❌ missing | T2 | med | S | [indent-tabs-mode](#indent-tabs-mode) |
| highlight-changes | ❌ missing | T2 | med | M | [highlight-changes-mode](#highlight-changes-mode) |
| auto-save | ❌ missing | T2 | med | M | [auto-save-mode](#auto-save-mode) |
| abbrev | ❌ missing | T3 | low | M | [abbrev-mode](#abbrev-mode) |
| flymake | ❌ missing | T3 | med | L | [flymake-mode](#flymake-mode) |
| follow | ❌ missing | T3 | low | M | [follow-mode](#follow-mode) |

---

# Major Mode Details

## fundamental-mode
**Status:** ✅ shipped · **Spec:** [SPEC-003](./specs/SPEC-003-minor-mode-system.md) (mechanism) · **Source:** [`src/tlisp/core/modes/fundamental.tlisp`](../src/tlisp/core/modes/fundamental.tlisp)

Default major mode with no language-specific behavior. The fallback for buffers with no recognized extension.

## typescript-mode
**Status:** 🟡 registered (no commands, no keymap) · **Spec:** none · **Source:** [`src/tlisp/core/modes/typescript-mode.tlisp`](../src/tlisp/core/modes/typescript-mode.tlisp)

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| high | M | fundamental-mode | Phase 1.5 (electric-pair, indent, show-paren) |

Handles `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`. Registration-only today: regex-based indent hints, no commands, no keymap. Needs the Phase 1.5 TypeScript primitives (auto-indent on Enter, electric pairs, comment-dwim) before it can grow.

## python-mode
**Status:** 🟡 registered · **Spec:** none · **Source:** [`src/tlisp/core/modes/python-mode.tlisp`](../src/tlisp/core/modes/python-mode.tlisp)

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| high | M | fundamental-mode | Phase 1.5 |

PEP-8 indent rules, `:`-triggered indent. Blocked on the same Phase 1.5 primitives as TypeScript.

## go-mode
**Status:** 🟡 registered · **Spec:** none · **Source:** [`src/tlisp/core/modes/go-mode.tlisp`](../src/tlisp/core/modes/go-mode.tlisp)

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| med | M | fundamental-mode | Phase 1.5; tabs-vs-spaces config |

Go uses tabs by default — needs `indent-tabs-mode` (currently missing) before indent rules work correctly.

## lisp-mode
**Status:** 🟡 registered · **Spec:** none · **Source:** [`src/tlisp/core/modes/lisp-mode.tlisp`](../src/tlisp/core/modes/lisp-mode.tlisp)

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| med | M | fundamental-mode | Phase 1.5; paredit-style structural editing is L complexity |

S-expression indent rules, `defun`-aware. Structural editing (slurp/barf/wrap) is a follow-up, not a blocker.

## markdown-mode
**Status:** ✅ shipped · **Spec:** [SPEC-018](./specs/SPEC-018-markdown-major-mode.md) · **Source:** [`src/tlisp/core/modes/markdown-mode.tlisp`](../src/tlisp/core/modes/markdown-mode.tlisp)

The richest mode in tmax — ~750 lines of commands, 30+ keybindings, headings, lists, links, wiki-link navigation. Reference implementation for what other modes should become.

## json-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| high | S | typescript-mode | none |

Pure data format. No statements, no comments (in strict JSON). Indent = 2 spaces, bracket matching. Ideal first mode to write because it has zero language-level complexity beyond what bracket-pair handling already provides.

## yaml-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| high | S | typescript-mode | none |

Whitespace-sensitive indent. CI/CD configs (GitHub Actions, GitLab CI), k8s manifests, tmax demo playbooks. Indent engine must treat leading whitespace as semantic, not cosmetic.

## shell-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| high | S | typescript-mode | none |

Bash/zsh. `if`/`fi`, `case`/`esac`, `do`/`done` indent rules. Comments with `#`. Note: this is the *file editing* mode, not an interactive shell — that's a separate Phase 3 feature.

## toml-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| med | S | conf-mode (when shipped) or scratch | none |

Cargo, pyproject, dependabot. Section headers `[section]`, `key = value` pairs. Trivial grammar.

## css-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| med | M | typescript-mode | Phase 1.5 |

Brace-delimited blocks, selector indent, `property: value;` lines. Nested selectors (SCSS, Less) add M complexity.

## html-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| med | M | scratch | Phase 1.5; tag text objects (`cit`, `dat`) from ROADMAP §1.9 |

Tag-aware indent, tag text objects, attribute completion. Pairs naturally with the planned HTML text objects.

## rust-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| med | M | go-mode (structurally) | Phase 1.5 |

`fn`, `impl`, `match` arms, lifetime ticks. Similar block structure to Go but more indent cases.

## text-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| high | S | fundamental-mode | none |

Parent for prose modes. Wraps auto-fill, paragraph motion. Should be the default for `.txt` and unknown extensions instead of `fundamental-mode` when fill behavior is wanted.

## conf-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| med | S | fundamental-mode | none |

Catch-all for `.conf`, `.ini`, `.cfg`, `.properties`. `[section]` headers, `key=value` or `key value` lines, `#` / `;` comments. Parent for `toml-mode` and `gitignore-mode`.

## dockerfile-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| med | S | conf-mode (when shipped) | none |

`INSTRUCTION argument` lines. Uppercase instruction keywords (`FROM`, `RUN`, `COPY`...) get font-lock emphasis. Continuation lines with `\`.

## xml-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| low | M | html-mode (when shipped) | Tag text objects |

Tag matching, namespace handling. SVG, XSD, Maven configs. Lower frequency because most modern tooling uses JSON/YAML.

## c-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| low | M | scratch | Phase 1.5 |

`{}` blocks, preprocessor `#` directives, K&R or Allman indent styles. Parent for cpp-mode.

## cpp-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| low | L | c-mode (when shipped) | Phase 1.5; template syntax, namespace scopes |

Templates, namespaces, scope resolution `::`. L complexity because the grammar is genuinely large.

## java-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| low | M | c-mode (when shipped) | Phase 1.5 |

C-family syntax with class/method indent rules, annotations (`@Override`).

## sql-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| low | S | scratch | none |

Keyword uppercasing convention, statement terminator `;`. Lower frequency — most SQL is written in DB clients or via LSP.

---

# Minor Mode Details

## line-numbers-mode
**Status:** ✅ shipped · **Spec:** [SPEC-003](./specs/SPEC-003-minor-mode-system.md) (mechanism) · **Source:** [`src/tlisp/core/modes/line-numbers-mode.tlisp`](../src/tlisp/core/modes/line-numbers-mode.tlisp)

Absolute line numbers in the gutter. Toggleable buffer-local and globally.

## relative-line-numbers-mode
**Status:** ✅ shipped · **Spec:** [SPEC-003](./specs/SPEC-003-minor-mode-system.md) (mechanism) · **Source:** [`src/tlisp/core/modes/relative-line-numbers-mode.tlisp`](../src/tlisp/core/modes/relative-line-numbers-mode.tlisp)

Distance-from-cursor line numbers (Vim-style). Useful with count-prefixed motions like `12j`.

## auto-fill-mode
**Status:** ✅ shipped · **Spec:** [SPEC-003](./specs/SPEC-003-minor-mode-system.md) (mechanism) · **Source:** [`src/tlisp/core/modes/auto-fill-mode.tlisp`](../src/tlisp/core/modes/auto-fill-mode.tlisp)

Automatic line wrapping at `fill-column`. Most useful in `text-mode` and `markdown-mode`.

## overwrite-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| med | S | line-numbers-mode | none |

Replaces characters instead of inserting them (the Insert key behavior). Trivial: flip a flag in the insert primitive.

## read-only-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| high | S | auto-fill-mode | none |

Blocks mutation of buffer contents. Required by `*Help*`, `*Messages*`, and other generated buffers to prevent accidental edits.

## show-paren-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| high | S | scratch | TypeScript primitive for char-scan at cursor |

Highlights the matching delimiter when cursor is on `(`, `)`, `{`, `}`, `[`, `]`. Roadmap-listed as Phase 1.5 prerequisite; tracked here because it ships as a minor mode.

## whitespace-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| high | S | line-numbers-mode | none |

Visualizes tabs, trailing whitespace, hard wraps. Critical for editors where indentation is semantic (YAML, Python).

## truncate-lines-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| high | S | line-numbers-mode | none |

Toggles between wrapping long lines and clipping them at the viewport edge. Vim's `:set wrap` / `:set nowrap`.

## electric-pair-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| high | S | scratch | insert primitive hook |

Auto-inserts matching pair when typing `(`, `[`, `{`, `"`, `'`. Phase 1.5 prerequisite for every programming major mode.

## electric-indent-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| high | S | scratch | insert primitive hook, indent engine |

Auto-indents new line on Enter based on the active major mode's indent rules. Phase 1.5 prerequisite.

## font-lock-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| high | M | scratch | syntax highlight pipeline (ROADMAP §1.11) |

Toggle syntax highlighting per-buffer. Requires the highlight engine itself to exist first.

## subword-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| med | S | scratch | word-motion primitive |

Makes `w` / `b` / `e` stop inside CamelCase (e.g., `camelCase` → 2 stops). Essential for TypeScript/Java editing.

## indent-tabs-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| med | S | scratch | indent engine |

Buffer-local toggle between tabs and spaces for indentation. Required by `go-mode` (tabs) and most other modes (spaces).

## highlight-changes-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| med | M | scratch | diff against saved buffer text |

Marks unsaved edits visually. M complexity because it requires tracking changes since last save.

## auto-save-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| med | M | scratch | timer hooks, crash recovery design |

Periodic save to a recovery file (not the original). Emacs-style `#file#` convention. M complexity for the recovery flow.

## abbrev-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| low | M | scratch | abbrev table storage |

Expands abbreviations as you type (e.g., `tn` → `typescript`). ROADMAP-listed as deferred; tracked here for completeness.

## flymake-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| med | L | scratch | LSP integration (Phase 3.1) |

On-the-fly syntax checking via external tools or LSP. L complexity because it depends on the LSP client.

## follow-mode
**Status:** ❌ missing · **Spec:** none

| Freq | Complexity | Template | Blockers |
|------|-----------|----------|----------|
| low | M | scratch | window splitting (Phase 1.12 / 3.2) |

Synchronizes scrolling across split windows showing the same buffer. Blocked until window splitting ships.
