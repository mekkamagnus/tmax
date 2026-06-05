# Elisp Developer Pain Points: Lessons for T-Lisp

An exhaustive survey of Elisp developer frustrations as reported online (Reddit, LWN, Hacker News, blogs, forums), organized by relevance to tmax's current development phase. Each pain point includes a specific T-Lisp design implication.

Sources include: LWN.net "Making Emacs Popular Again" discussion, r/emacs and r/neovim threads, Hacker News discussions on Emacs/Elisp, blog posts from Emacs package authors, and general Lisp community commentary.

---

## Priority: Immediate — Active Spec Work

These pain points are directly relevant to specs currently being implemented or about to start.

### 1. No Modern Completion Framework Built-In (Editor UX)

**The pain:** Emacs built-in completion (`icomplete`, `ido`) is basic. Everyone installs third-party completion frameworks (company, corfu, vertico, helm, ivy). This is configuration overhead that shouldn't exist.

**T-Lisp implication:** Build a basic completion/selection UI into the editor core. It doesn't need to be fancy — fuzzy file finding, command completion, and buffer switching should work out of the box. **SPEC-006 (buffer completion) is actively implementing this with Vertico/Orderless/Marginalia-style completion.**

### 2. Terrible Defaults (Developer Experience)

**The pain:** Emacs out-of-the-box is nearly unusable for modern development. Basic things require configuration: line numbers, syntax highlighting, auto-completion, project navigation, version control integration. Users accumulate massive init files.

> "~/.emacs is over 500 lines" — gdt, LWN

**T-Lisp implication:** The default config (`init.tlisp`) should provide a usable editing experience without any customization. Vim users expect hjkl, :w, :q to work immediately. Ship good defaults for everything, not a minimal skeleton. **SPEC-004 (daily driver blocks) and SPEC-005 (vim motions) are closing this gap right now.**

### 3. Default Keybindings Are Terrible (Editor UX)

**The pain:** Emacs default keybindings use `C-` chords extensively. `C-x C-s` to save, `C-x C-c` to quit, `C-x b` to switch buffers. These are ergonomic nightmares (pinkie strain is real — "Emacs pinky"). Vim's modal approach is widely preferred for ergonomics.

> "absolutely zero mnemonic value" — mgedmin, LWN

**T-Lisp status:** T-Lisp already uses modal editing (normal/insert/visual/command modes). Good. Continue with vim-like defaults. Do not emulate Emacs keybinding style. **SPEC-005 is completing the vim motion set so these bindings actually work end-to-end.**

### 4. Weak Error Messages and Debugging (Language Design)

**The pain:** Elisp errors are famously unhelpful. `(wrong-type-argument stringp nil)` tells you a type was wrong but not where, why, or how to fix it. The debugger exists but is modal and invasive. Stack traces require enabling `debug-on-error`. There is no source location tracking in errors.

**T-Lisp implication:** Add source location (line, column) to parsed ASTs and include them in all error messages. This was recommendation #3 in the Clojure memo and remains critical. An editor Lisp is debugged interactively — errors must be actionable. **Critical now because T-Lisp is becoming the primary editor logic layer (SPEC-003, SPEC-005); errors in T-Lisp code must not be opaque.**

### 5. C Core / Elisp Boundary (Architectural Regrets)

**The pain:** The boundary between C core and Elisp is arbitrary and painful. Some things are in C for performance (text representation, regex), some are in Elisp for extensibility (modes, commands). Moving something across the boundary requires rewriting it. The C API is not well-documented.

**T-Lisp status:** TypeScript core / T-Lisp extension boundary is cleaner. TypeScript handles I/O, rendering, and the runtime. T-Lisp handles editor logic. Keep this boundary deliberate and well-documented. **SPEC-003 (minor modes) and SPEC-005 (vim motions) are actively migrating TypeScript editor logic into T-Lisp — the boundary must be clean and documented as it forms.**

### 6. Buffer Model Complexity (Architectural Regrets)

**The pain:** Emacs buffers are complex objects with markers, overlays, text properties, narrowing, indirect buffers, and more. The API surface is enormous and full of edge cases. "Buffer-or-string" parameter types are confusing.

**T-Lisp implication:** Keep the buffer API simple. Gap buffer + line-based access + cursor positioning. Add complexity only when real usage demands it. **SPEC-006 adds buffer metadata and completion; SPEC-004 adds window splits that reference buffers. Keep the API lean as these features land.**

---

## Priority: High — Next Phase

These are not actively being spec'd but are near-term concerns once the current specs land.

### 7. Configuration Is Programming (Developer Experience)

**The pain:** Customizing Emacs requires writing Elisp. There's no simple config format, no declarative option system that covers most needs. Want to change a theme? Write Elisp. Want to remap a key? Write Elisp. Want to install plugins? Write Elisp that calls `package-install` and `require` and `use-package`.

**T-Lisp implication:** Consider a layered configuration approach:
- Layer 1: Simple key=value config file for common settings (theme, font, tab width)
- Layer 2: T-Lisp init file for power users
- Never require programming for basic customization

### 8. Single Global Namespace (Language Design)

**The pain:** Every `defun` and `defvar` lives in one flat namespace. Package authors must manually prefix everything (`my-package--helper-function`, `org-mode--internal-var`). Name collisions between packages are common and debugging them is painful. There is no module or package isolation.

> "ELPA vs MELPA schism... no real module system" — cmonsanto, LWN

**T-Lisp implication:** T-Lisp currently has the same flat global environment. A `defmodule`/`use` system (even a simple prefix-based one) should be planned before the package ecosystem grows. This is the single most cited structural problem in Elisp. **Plan before T-Lisp libraries proliferate from SPEC-003's mode system and SPEC-006's completion commands.**

### 9. Evaluation Workflow Is Clunky (Developer Experience)

**The pain:** Testing Elisp changes requires: edit file, save, switch to `*scratch*`, evaluate buffer, switch back. Or use `M-:` for one-off expressions. Or `ielm` for a REPL. None of these feel smooth. There's no hot-reload. There's no `eval-region` that just works everywhere.

**T-Lisp implication:** First-class REPL integration. The daemon architecture enables this — a client should be able to send T-Lisp expressions and get results immediately. `eval-buffer` and `eval-region` should work in any buffer with zero setup. **The daemon `-e` flag exists; full interactive REPL is a natural follow-up to the current T-Lisp migration.**

### 10. Steep Learning Curve / Hostile Documentation (Developer Experience)

**The pain:** Elisp documentation is extensive but organized like a reference manual, not a learning path. `C-h i` opens Info pages that assume you already know what you're looking for. Terms like "point," "mark," "narrowing," "killing" (not the process kind) confuse newcomers.

> "Non-standard terminology confusing newcomers (NAR, epa, Joseph Garvin)" — LWN summary
> "absolutely zero mnemonic value" in default keybindings — mgedmin, LWN

**T-Lisp implication:**
- Use standard terminology (cursor, selection, clipboard) not Emacs jargon
- API function names should be self-documenting (`cursor-line`, `buffer-text`, not `point`, `buffer-string`)
- Provide a getting-started guide, not just a reference

---

## Priority: Medium — Language Quality

Language design issues that affect T-Lisp's quality as a Lisp dialect. Important for developer satisfaction but not blocking current feature work.

### 11. No Multithreading / UI Blocking (Language Design)

**The pain:** Emacs runs Elisp in a single thread. Any long-running Elisp code freezes the entire UI. There is no way to do background computation without blocking input. `sit-for` and `accept-process-output` are hacks, not solutions. This makes Emacs unusable for network operations, large file processing, or any CPU-intensive task.

> "no multithreading" — tchernobog, LWN

**T-Lisp implication:** The daemon/client architecture already separates the T-Lisp runtime from the frontend. Ensure editor operations never block the rendering loop. Consider async primitives (promises, futures) in T-Lisp from the start rather than retrofitting them later.

### 12. Elisp Is "Not a Very Good Lisp" (Language Design)

**The pain:** Elisp diverges from other Lisp dialects in ways that don't serve it well. No first-class closures until recently, no reader macros, no proper tail-call optimization, no continuations, no pattern matching. Developers who know Clojure, Scheme, or Common Lisp find Elisp frustratingly limited.

> "Emacs Lisp is its own little cul-de-sac, and not highly respected as Lisp dialect" — dvdeug, LWN
> "eLisp is not something you want to get your hands dirty in 2020" — tchernobog, LWN
> "clearly not a very good Lisp" — curtis3389, LWN

**T-Lisp implication:** Borrow the good parts. Threading macros, pattern matching, proper TCO (already done), and destructuring make the language feel modern. Don't replicate Elisp's minimalist approach to language features.

### 13. No Type System or Contracts (Language Design)

**The pain:** Elisp has no type annotations. Runtime type errors surface far from the actual bug. There's no way to document "this function expects a buffer object and a string." `cl-defmethod` exists but is rarely used and bolted on.

**T-Lisp implication:** Don't need a full type system, but consider:
- Optional type predicates/assertions at function boundaries
- `:pre`/`:post` conditions (Clojure-style)
- Better: use the existing `deftest` infrastructure to encourage contract testing

### 14. Immutable Data Not Enforced (Language Design)

**The pain:** Elisp mutation is everywhere. `setcar`, `setcdr`, `plist-put` (sometimes mutates, sometimes doesn't), `nreverse` vs `reverse`. It's unpredictable which operations mutate in place vs return new values. This makes reasoning about code hard.

**T-Lisp status:** T-Lisp already follows functional principles (hashmap-set returns new map, no list mutation functions). Good. Stay the course. Never add mutating list operations.

---

## Priority: Low — Ecosystem & Community

These matter for long-term project health but are not blocking current development.

### 15. Elisp Is Not Transferable (Ecosystem)

**The pain:** Learning Elisp teaches you Elisp, not a transferable skill. It's not used outside Emacs. The time investment doesn't compound into other tools or jobs. This is a major reason developers choose VS Code (JavaScript) or Neovim (Lua) instead.

> "elisp is useless elsewhere" — xiaoxing, LWN
> People wish they could use JavaScript instead — curtis3389, moltonel, LWN

**T-Lisp implication:** T-Lisp faces the same problem — it's editor-only. Mitigate this by:
- Making T-Lisp a "good Lisp" that teaches real functional programming concepts
- Keeping the language small and principled so knowledge transfers
- Documenting how T-Lisp maps to concepts in Clojure, Scheme, etc.

### 16. Package Management Chaos (Ecosystem)

**The pain:** Emacs has multiple package archives (ELPA, MELPA, GNU ELPA, NonGNU ELPA) with different policies. Some packages are on MELPA only. Version pinning is manual. Dependency resolution is fragile. `use-package` became the de facto standard but is itself a macro that hides complexity.

> "ELPA vs MELPA schism" — cmonsanto, LWN

**T-Lisp implication:** Design a single package system from the start:
- One registry
- Lock file with exact versions
- Dependency resolution built in
- Don't let a schism form

### 17. Package Quality Varies Wildly (Ecosystem)

**The pain:** No standards for Elisp package quality. Some packages are battle-tested (magit, org-mode). Many are abandonware. No linting standards enforced by package archives. No automated testing infrastructure for packages. API stability is not guaranteed.

**T-Lisp implication:** When a package system is built:
- Require basic metadata (version, author, dependencies)
- Encourage (don't mandate) tests via the built-in `deftest` framework
- Provide linting tooling for T-Lisp packages

### 18. Copyright Assignment Blocks Contributions (Ecosystem)

**The pain:** GNU Emacs requires copyright assignment to the FSF for non-trivial contributions. This is a legal process that takes days to weeks and deters casual contributors. Many developers refuse on principle.

> "copyright assignment blocking contributions" — josh, cmonsanto, LWN

**T-Lisp implication:** Not a language issue, but: use a permissive license (MIT/Apache) and require no copyright assignment. Accept contributions via standard PR flow.

---

## Priority: Already Addressed

These pain points are already handled by tmax's architecture. Listed for completeness and to avoid regressions.

### 19. Dynamic Scoping (Language Design)

**The pain:** Elisp used dynamic scoping by default for decades. This led to subtle bugs where a variable name in one function would capture bindings from an unrelated caller. Lexical binding was added in Emacs 24 (2012) but must be explicitly enabled per-file via `;; -*- lexical-binding: t; -*-`. Much existing code still uses dynamic scoping.

> "ELisp used dynamic bindings until very recently" — val314159, LWN

**T-Lisp status:** T-Lisp already uses lexical scoping. Good. Do not add dynamic scoping as a default.

### 20. Everything in One Process (Architectural Regrets)

**The pain:** Emacs runs editor, language runtime, packages, and UI all in one process. A crash in any package brings down the whole editor. There's no isolation. Elisp code can directly access and corrupt editor internals.

**T-Lisp status:** The daemon/client architecture with Frame-based multi-client support is the right approach. Keep the T-Lisp sandboxed from the rendering core. A T-Lisp error should never crash the terminal.

### 21. Slow Startup (Performance)

**The pain:** Emacs startup time grows with configuration complexity. Heavy configs can take 5-10 seconds. `emacs --daemon` + `emacsclient` is the workaround but adds complexity. The daemon model exists partly because interactive startup is too slow.

**T-Lisp status:** The daemon/client architecture handles this. Daemon startup is fast, client connection is near-instant.

### 22. No Bytecode Optimization / JIT (Performance)

**The pain:** Elisp is interpreted (with optional byte-compilation that provides modest speedups). No JIT. Performance-sensitive code must drop to C. The `libjit` integration attempts have stalled.

**T-Lisp status:** T-Lisp runs on Bun/V8 which provides JIT automatically. The TypeScript implementation is a performance advantage here.

### 23. Large Buffer Handling (Performance)

**The pain:** Emacs struggles with very large files (100MB+). Operations become slow, memory usage balloons. This is partly an Elisp problem (inefficient text representation) and partly a C core problem.

**T-Lisp status:** The gap buffer implementation is a good start. Ensure T-Lisp operations on buffer contents don't create unnecessary copies.

### 24. GUI Is Outdated (Editor UX)

**The pain:** Emacs GUI toolkit (Gtk, NS, etc.) integration is fragile. Font rendering, HiDPI support, smooth scrolling, image display are all subpar. The X11/Wayland display server integration has long-standing bugs.

> "needs rewriting by an expert, and has needed it for decades" — Stallman, LWN

**T-Lisp status:** T-Lisp is terminal-only. This is a feature, not a limitation. Terminal rendering is simple, universal, and avoids the entire GUI toolkit problem.

---

## Priority: Governance & Culture

Not directly actionable in code, but shape project decisions.

### 25. Resistance to Change (Community)

**The pain:** Emacs development moves slowly. Features take years to land. The community resists breaking changes (for good reason — backwards compatibility matters), but this creates ossification. Neovim succeeded partly by being willing to break things.

> "Guile/Scheme replacement attempts failed due to inertia" — smoogen, tome, LWN

**T-Lisp implication:** T-Lisp is young. Make breaking changes now while few people depend on it. Pin down the language design before growing a user base. Once people have init files, stability matters.

### 26. Unwelcoming Community (Community)

**The pain:** The Emacs community has a reputation for being elitist and dismissive of newcomers. Questions on r/emacs about "why doesn't X work" often get responses like "you should read the manual" or "that's not the Emacs way."

> "unwelcoming elitist developers" — josh, LWN

**T-Lisp implication:** Community is emergent, not designed. But the project can set tone through:
- Friendly documentation
- Responsive issue handling
- Explicit code of conduct
- Valuing beginner contributions

### 27. Stallman / Governance Issues (Community)

**The pain:** RMS maintains veto power over Emacs development decisions. This has blocked features (browser integration, modern GUI work) and created uncertainty about the project's direction. Governance is single-person, not community-driven.

> Stallman himself: the GUI "needs rewriting by an expert, and has needed it for decades" — LWN

**T-Lisp implication:** Not directly applicable, but: have clear governance. Make decisions in the open. Don't let one person's preferences block progress.

---

## Summary: Top T-Lisp Design Recommendations

| # | Pain Point | T-Lisp Action | Priority | Status |
|---|-----------|---------------|----------|--------|
| 1 | No modern completion | Vertico/Orderless/Marginalia-style completion (SPEC-006) | Immediate | In progress |
| 2 | Terrible defaults | Ship usable defaults for daily driving (SPEC-004/005) | Immediate | In progress |
| 3 | Bad keybindings | Complete vim motion set (SPEC-005) | Immediate | In progress |
| 4 | Weak error messages | Source locations in all T-Lisp errors | Immediate | Needed |
| 5 | C/Lisp boundary | Document TS/T-Lisp boundary as it forms | Immediate | In progress |
| 6 | Buffer complexity | Keep buffer API lean as features land | Immediate | In progress |
| 7 | Configuration = programming | Layer config: simple settings + T-Lisp | High | Planned |
| 8 | Single namespace | Plan `defmodule`/`use` before libraries grow | High | Planned |
| 9 | Eval workflow clunky | First-class REPL; eval-region everywhere | High | Partial |
| 10 | Steep learning curve | Standard terminology, getting-started guide | High | Planned |
| 11 | UI blocking | Async primitives; never block rendering | Medium | Planned |
| 12 | Not a good Lisp | Threading macros, pattern matching, TCO | Medium | Partial |
| 13 | No type contracts | Optional boundary assertions | Medium | Planned |
| 14 | Mutable data | Stay functional (already done) | Medium | Done |
| 15 | Not transferable | Make T-Lisp teach good FP | Low | Ongoing |
| 16 | Package chaos | One registry, lock files, deps | Low | Future |
| 17 | Package quality | Metadata, linting, `deftest` | Low | Future |
| 18 | Copyright assignment | Permissive license, no assignment | Low | Done |
| 19 | Dynamic scoping | Lexical only (already done) | Done | Done |
| 20 | Single process | Daemon/client isolation | Done | Done |
| 21 | Slow startup | Daemon/client | Done | Done |
| 22 | No JIT | Bun/V8 JIT | Done | Done |
| 23 | Large buffers | Gap buffer | Done | Done |
| 24 | GUI problems | Terminal-only | Done | Done |
| 25 | Resistance to change | Break things now | Governance | Active |
| 26 | Unwelcoming community | Friendly docs, code of conduct | Governance | Ongoing |
| 27 | Single-person governance | Open decision-making | Governance | Ongoing |

**Already addressed (6 items):** Lexical scoping, immutable data, modal keybindings, terminal-only rendering, daemon/client architecture, startup performance.

**Immediate action (6 items):** Completion framework (SPEC-006), good defaults (SPEC-004/005), vim motions (SPEC-005), error messages, TS/T-Lisp boundary, buffer API discipline.

**High priority (4 items):** Layered configuration, namespaces, REPL workflow, documentation.

**Plan for later (4 items):** Package system, language features (async/pattern matching), quality standards, transferability.
