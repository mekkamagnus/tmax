# Elisp Developer Pain Points: Lessons for T-Lisp

An exhaustive survey of Elisp developer frustrations as reported online (Reddit, LWN, Hacker News, blogs, forums), organized into five categories with items prioritized within each. Each pain point includes a specific T-Lisp design implication.

Sources include: LWN.net "Making Emacs Popular Again" discussion, r/emacs and r/neovim threads, Hacker News discussions on Emacs/Elisp, blog posts from Emacs package authors, and general Lisp community commentary.

---

## 1. Language Design

Semantics, type system, scoping, error handling, namespace, and language quality.

### LD-1. Weak Error Messages and Debugging — Immediate

**The pain:** Elisp errors are famously unhelpful. `(wrong-type-argument stringp nil)` tells you a type was wrong but not where, why, or how to fix it. The debugger exists but is modal and invasive. Stack traces require enabling `debug-on-error`. There is no source location tracking in errors.

**T-Lisp implication:** Add source location (line, column) to parsed ASTs and include them in all error messages. This was recommendation #3 in the Clojure memo and remains critical. An editor Lisp is debugged interactively — errors must be actionable. **Critical now because T-Lisp is becoming the primary editor logic layer (SPEC-003, SPEC-005); errors in T-Lisp code must not be opaque.**

### LD-2. Single Global Namespace — High #implemented

**The pain:** Every `defun` and `defvar` lives in one flat namespace. Package authors must manually prefix everything (`my-package--helper-function`, `org-mode--internal-var`). Name collisions between packages are common and debugging them is painful. There is no module or package isolation.

> "ELPA vs MELPA schism... no real module system" — cmonsanto, LWN

**T-Lisp implication:** T-Lisp currently has the same flat global environment. A `defmodule`/`use` system (even a simple prefix-based one) should be planned before the package ecosystem grows. This is the single most cited structural problem in Elisp. **Plan before T-Lisp libraries proliferate from SPEC-003's mode system and SPEC-006's completion commands.**

**T-Lisp status:** Implemented in SPEC-007. T-Lisp now has Guile/Racket-style modules with private-by-default bindings, explicit exports, `require-module`, qualified/aliased/selective imports, module introspection, module-aware command discovery, and plugin isolation via `user/plugin/{name}` modules.

**Related documents:**
- [`specs/SPEC-007-tlisp-module-system.md`](../../specs/SPEC-007-tlisp-module-system.md) — implemented module system specification.
- [`rfcs/RFC-005-tlisp-module-system.md`](../../rfcs/RFC-005-tlisp-module-system.md) — options analysis and Guile/Racket-style recommendation.
- [`docs/memos/module-system-gap-analysis.md`](./module-system-gap-analysis.md) — implementation gap analysis used to close the namespace work.
- [`docs/memos/package-registry-options-analysis.md`](./package-registry-options-analysis.md) — package registry direction that depends on module boundaries.

### LD-3. Elisp Is "Not a Very Good Lisp" — Medium

**The pain:** Elisp diverges from other Lisp dialects in ways that don't serve it well. No first-class closures until recently, no reader macros, no proper tail-call optimization, no continuations, no pattern matching. Developers who know Clojure, Scheme, or Common Lisp find Elisp frustratingly limited.

> "Emacs Lisp is its own little cul-de-sac, and not highly respected as Lisp dialect" — dvdeug, LWN
> "eLisp is not something you want to get your hands dirty in 2020" — tchernobog, LWN
> "clearly not a very good Lisp" — curtis3389, LWN

**T-Lisp implication:** Borrow the good parts. Threading macros, pattern matching, proper TCO (already done), and destructuring make the language feel modern. Don't replicate Elisp's minimalist approach to language features.

### LD-4. No Type System or Contracts — Medium

**The pain:** Elisp has no type annotations. Runtime type errors surface far from the actual bug. There's no way to document "this function expects a buffer object and a string." `cl-defmethod` exists but is rarely used and bolted on.

**T-Lisp implication:** Don't need a full type system, but consider:
- Optional type predicates/assertions at function boundaries
- `:pre`/`:post` conditions (Clojure-style)
- Better: use the existing `deftest` infrastructure to encourage contract testing

### LD-5. Dynamic Scoping (Historical) — Done

**The pain:** Elisp used dynamic scoping by default for decades. This led to subtle bugs where a variable name in one function would capture bindings from an unrelated caller. Lexical binding was added in Emacs 24 (2012) but must be explicitly enabled per-file via `;; -*- lexical-binding: t; -*-`. Much existing code still uses dynamic scoping.

> "ELisp used dynamic bindings until very recently" — val314159, LWN

**T-Lisp status:** T-Lisp already uses lexical scoping. Good. Do not add dynamic scoping as a default.

### LD-6. Immutable Data Not Enforced — Done

**The pain:** Elisp mutation is everywhere. `setcar`, `setcdr`, `plist-put` (sometimes mutates, sometimes doesn't), `nreverse` vs `reverse`. It's unpredictable which operations mutate in place vs return new values. This makes reasoning about code hard.

**T-Lisp status:** T-Lisp already follows functional principles (hashmap-set returns new map, no list mutation functions). Good. Stay the course. Never add mutating list operations.

---

## 2. Developer Experience

Defaults, keybindings, configuration, completion, documentation, REPL workflow.

### DX-1. No Modern Completion Framework Built-In — Immediate

**The pain:** Emacs built-in completion (`icomplete`, `ido`) is basic. Everyone installs third-party completion frameworks (company, corfu, vertico, helm, ivy). This is configuration overhead that shouldn't exist.

**T-Lisp implication:** Build a basic completion/selection UI into the editor core. It doesn't need to be fancy — fuzzy file finding, command completion, and buffer switching should work out of the box. **SPEC-006 (buffer completion) is actively implementing this with Vertico/Orderless/Marginalia-style completion.**

### DX-2. Terrible Defaults — Immediate

**The pain:** Emacs out-of-the-box is nearly unusable for modern development. Basic things require configuration: line numbers, syntax highlighting, auto-completion, project navigation, version control integration. Users accumulate massive init files.

> "~/.emacs is over 500 lines" — gdt, LWN

**T-Lisp implication:** The default config (`init.tlisp`) should provide a usable editing experience without any customization. Vim users expect hjkl, :w, :q to work immediately. Ship good defaults for everything, not a minimal skeleton. **SPEC-004 (daily driver blocks) and SPEC-005 (vim motions) are closing this gap right now.**

### DX-3. Default Keybindings Are Terrible — Immediate

**The pain:** Emacs default keybindings use `C-` chords extensively. `C-x C-s` to save, `C-x C-c` to quit, `C-x b` to switch buffers. These are ergonomic nightmares (pinkie strain is real — "Emacs pinky"). Vim's modal approach is widely preferred for ergonomics.

> "absolutely zero mnemonic value" — mgedmin, LWN

**T-Lisp status:** T-Lisp already uses modal editing (normal/insert/visual/command modes). Good. Continue with vim-like defaults. Do not emulate Emacs keybinding style. **SPEC-005 is completing the vim motion set so these bindings actually work end-to-end.**

### DX-4. Configuration Is Programming — High

**The pain:** Customizing Emacs requires writing Elisp. There's no simple config format, no declarative option system that covers most needs. Want to change a theme? Write Elisp. Want to remap a key? Write Elisp. Want to install plugins? Write Elisp that calls `package-install` and `require` and `use-package`.

**T-Lisp implication:** Consider a layered configuration approach:
- Layer 1: Simple key=value config file for common settings (theme, font, tab width)
- Layer 2: T-Lisp init file for power users
- Never require programming for basic customization

### DX-5. Evaluation Workflow Is Clunky — High

**The pain:** Testing Elisp changes requires: edit file, save, switch to `*scratch*`, evaluate buffer, switch back. Or use `M-:` for one-off expressions. Or `ielm` for a REPL. None of these feel smooth. There's no hot-reload. There's no `eval-region` that just works everywhere.

**T-Lisp implication:** First-class REPL integration. The daemon architecture enables this — a client should be able to send T-Lisp expressions and get results immediately. `eval-buffer` and `eval-region` should work in any buffer with zero setup. **The daemon `-e` flag exists; full interactive REPL is a natural follow-up to the current T-Lisp migration.**

### DX-6. Steep Learning Curve / Hostile Documentation — High

**The pain:** Elisp documentation is extensive but organized like a reference manual, not a learning path. `C-h i` opens Info pages that assume you already know what you're looking for. Terms like "point," "mark," "narrowing," "killing" (not the process kind) confuse newcomers.

> "Non-standard terminology confusing newcomers (NAR, epa, Joseph Garvin)" — LWN summary
> "absolutely zero mnemonic value" in default keybindings — mgedmin, LWN

**T-Lisp implication:**
- Use standard terminology (cursor, selection, clipboard) not Emacs jargon
- API function names should be self-documenting (`cursor-line`, `buffer-text`, not `point`, `buffer-string`)
- Provide a getting-started guide, not just a reference

### DX-7. GUI Is Outdated — Done

**The pain:** Emacs GUI toolkit (Gtk, NS, etc.) integration is fragile. Font rendering, HiDPI support, smooth scrolling, image display are all subpar. The X11/Wayland display server integration has long-standing bugs.

> "needs rewriting by an expert, and has needed it for decades" — Stallman, LWN

**T-Lisp status:** T-Lisp is terminal-only. This is a feature, not a limitation. Terminal rendering is simple, universal, and avoids the entire GUI toolkit problem.

---

## 3. Performance

Startup, runtime speed, large file handling, async/blocking.

### PF-1. No Multithreading / UI Blocking — Medium

**The pain:** Emacs runs Elisp in a single thread. Any long-running Elisp code freezes the entire UI. There is no way to do background computation without blocking input. `sit-for` and `accept-process-output` are hacks, not solutions. This makes Emacs unusable for network operations, large file processing, or any CPU-intensive task.

> "no multithreading" — tchernobog, LWN

**T-Lisp implication:** The daemon/client architecture already separates the T-Lisp runtime from the frontend. Ensure editor operations never block the rendering loop. Consider async primitives (promises, futures) in T-Lisp from the start rather than retrofitting them later.

### PF-2. Slow Startup — Done

**The pain:** Emacs startup time grows with configuration complexity. Heavy configs can take 5-10 seconds. `emacs --daemon` + `emacsclient` is the workaround but adds complexity. The daemon model exists partly because interactive startup is too slow.

**T-Lisp status:** The daemon/client architecture handles this. Daemon startup is fast, client connection is near-instant.

### PF-3. No Bytecode Optimization / JIT — Done

**The pain:** Elisp is interpreted (with optional byte-compilation that provides modest speedups). No JIT. Performance-sensitive code must drop to C. The `libjit` integration attempts have stalled.

**T-Lisp status:** T-Lisp runs on Bun/V8 which provides JIT automatically. The TypeScript implementation is a performance advantage here.

### PF-4. Large Buffer Handling — Done

**The pain:** Emacs struggles with very large files (100MB+). Operations become slow, memory usage balloons. This is partly an Elisp problem (inefficient text representation) and partly a C core problem.

**T-Lisp status:** The gap buffer implementation is a good start. Ensure T-Lisp operations on buffer contents don't create unnecessary copies.

---

## 4. Architectural Regrets

Process model, core/extension boundary, data model complexity.

### AR-1. C Core / Elisp Boundary — Immediate

**The pain:** The boundary between C core and Elisp is arbitrary and painful. Some things are in C for performance (text representation, regex), some are in Elisp for extensibility (modes, commands). Moving something across the boundary requires rewriting it. The C API is not well-documented.

**T-Lisp status:** TypeScript core / T-Lisp extension boundary is cleaner. TypeScript handles I/O, rendering, and the runtime. T-Lisp handles editor logic. Keep this boundary deliberate and well-documented. **SPEC-003 (minor modes) and SPEC-005 (vim motions) are actively migrating TypeScript editor logic into T-Lisp — the boundary must be clean and documented as it forms.**

### AR-2. Buffer Model Complexity — Immediate

**The pain:** Emacs buffers are complex objects with markers, overlays, text properties, narrowing, indirect buffers, and more. The API surface is enormous and full of edge cases. "Buffer-or-string" parameter types are confusing.

**T-Lisp implication:** Keep the buffer API simple. Gap buffer + line-based access + cursor positioning. Add complexity only when real usage demands it. **SPEC-006 adds buffer metadata and completion; SPEC-004 adds window splits that reference buffers. Keep the API lean as these features land.**

### AR-3. Everything in One Process — Done

**The pain:** Emacs runs editor, language runtime, packages, and UI all in one process. A crash in any package brings down the whole editor. There's no isolation. Elisp code can directly access and corrupt editor internals.

**T-Lisp status:** The daemon/client architecture with Frame-based multi-client support is the right approach. Keep the T-Lisp sandboxed from the rendering core. A T-Lisp error should never crash the terminal.

---

## 5. Ecosystem

Packages, community, transferability, licensing, governance.

### EC-1. Resistance to Change — High

**The pain:** Emacs development moves slowly. Features take years to land. The community resists breaking changes (for good reason — backwards compatibility matters), but this creates ossification. Neovim succeeded partly by being willing to break things.

> "Guile/Scheme replacement attempts failed due to inertia" — smoogen, tome, LWN

**T-Lisp implication:** T-Lisp is young. Make breaking changes now while few people depend on it. Pin down the language design before growing a user base. Once people have init files, stability matters.

### EC-2. Package Management Chaos — High

**The pain:** Emacs has multiple package archives (ELPA, MELPA, GNU ELPA, NonGNU ELPA) with different policies. Some packages are on MELPA only. Version pinning is manual. Dependency resolution is fragile. `use-package` became the de facto standard but is itself a macro that hides complexity.

> "ELPA vs MELPA schism" — cmonsanto, LWN

**T-Lisp implication:** Design a single package system from the start:
- One registry
- Lock file with exact versions
- Dependency resolution built in
- Don't let a schism form

### EC-3. Elisp Is Not Transferable — Medium

**The pain:** Learning Elisp teaches you Elisp, not a transferable skill. It's not used outside Emacs. The time investment doesn't compound into other tools or jobs. This is a major reason developers choose VS Code (JavaScript) or Neovim (Lua) instead.

> "elisp is useless elsewhere" — xiaoxing, LWN
> People wish they could use JavaScript instead — curtis3389, moltonel, LWN

**T-Lisp implication:** T-Lisp faces the same problem — it's editor-only. Mitigate this by:
- Making T-Lisp a "good Lisp" that teaches real functional programming concepts
- Keeping the language small and principled so knowledge transfers
- Documenting how T-Lisp maps to concepts in Clojure, Scheme, etc.

### EC-4. Package Quality Varies Wildly — Medium

**The pain:** No standards for Elisp package quality. Some packages are battle-tested (magit, org-mode). Many are abandonware. No linting standards enforced by package archives. No automated testing infrastructure for packages. API stability is not guaranteed.

**T-Lisp implication:** When a package system is built:
- Require basic metadata (version, author, dependencies)
- Encourage (don't mandate) tests via the built-in `deftest` framework
- Provide linting tooling for T-Lisp packages

### EC-5. Unwelcoming Community — Medium

**The pain:** The Emacs community has a reputation for being elitist and dismissive of newcomers. Questions on r/emacs about "why doesn't X work" often get responses like "you should read the manual" or "that's not the Emacs way."

> "unwelcoming elitist developers" — josh, LWN

**T-Lisp implication:** Community is emergent, not designed. But the project can set tone through:
- Friendly documentation
- Responsive issue handling
- Explicit code of conduct
- Valuing beginner contributions

### EC-6. Copyright Assignment Blocks Contributions — Done

**The pain:** GNU Emacs requires copyright assignment to the FSF for non-trivial contributions. This is a legal process that takes days to weeks and deters casual contributors. Many developers refuse on principle.

> "copyright assignment blocking contributions" — josh, cmonsanto, LWN

**T-Lisp implication:** Not a language issue, but: use a permissive license (MIT/Apache) and require no copyright assignment. Accept contributions via standard PR flow.

### EC-7. Stallman / Governance Issues — Ongoing

**The pain:** RMS maintains veto power over Emacs development decisions. This has blocked features (browser integration, modern GUI work) and created uncertainty about the project's direction. Governance is single-person, not community-driven.

> Stallman himself: the GUI "needs rewriting by an expert, and has needed it for decades" — LWN

**T-Lisp implication:** Not directly applicable, but: have clear governance. Make decisions in the open. Don't let one person's preferences block progress.

---

## Summary

| ID | Category | Pain Point | T-Lisp Action | Priority | Status |
|----|----------|-----------|---------------|----------|--------|
| LD-1 | Language | Weak error messages | Source locations in all errors | Immediate | Needed |
| LD-2 | Language | Single namespace | Guile/Racket-style modules | High | #implemented |
| LD-3 | Language | Not a good Lisp | Threading macros, pattern matching, TCO | Medium | Partial |
| LD-4 | Language | No type contracts | Optional boundary assertions | Medium | Planned |
| LD-5 | Language | Dynamic scoping | Lexical only | — | Done |
| LD-6 | Language | Mutable data | Stay functional | — | Done |
| DX-1 | DevEx | No completion framework | Vertico/Orderless/Marginalia (SPEC-006) | Immediate | In progress |
| DX-2 | DevEx | Terrible defaults | Ship usable defaults (SPEC-004/005) | Immediate | In progress |
| DX-3 | DevEx | Bad keybindings | Complete vim motions (SPEC-005) | Immediate | In progress |
| DX-4 | DevEx | Configuration = programming | Layered config file + T-Lisp | High | Planned |
| DX-5 | DevEx | Eval workflow clunky | First-class REPL | High | Partial |
| DX-6 | DevEx | Steep learning curve | Standard terminology, getting-started guide | High | Planned |
| DX-7 | DevEx | GUI is outdated | Terminal-only | — | Done |
| PF-1 | Perf | UI blocking | Async primitives | Medium | Planned |
| PF-2 | Perf | Slow startup | Daemon/client | — | Done |
| PF-3 | Perf | No JIT | Bun/V8 JIT | — | Done |
| PF-4 | Perf | Large buffers | Gap buffer | — | Done |
| AR-1 | Arch | C/Lisp boundary | Document TS/T-Lisp boundary | Immediate | In progress |
| AR-2 | Arch | Buffer complexity | Keep buffer API lean | Immediate | In progress |
| AR-3 | Arch | Single process | Daemon/client isolation | — | Done |
| EC-1 | Ecosystem | Resistance to change | Break things now while young | High | Active |
| EC-2 | Ecosystem | Package chaos | One registry, lock files | High | Future |
| EC-3 | Ecosystem | Not transferable | Make T-Lisp teach good FP | Medium | Ongoing |
| EC-4 | Ecosystem | Package quality | Metadata, linting, `deftest` | Medium | Future |
| EC-5 | Ecosystem | Unwelcoming community | Friendly docs, code of conduct | Medium | Ongoing |
| EC-6 | Ecosystem | Copyright assignment | Permissive license, no assignment | — | Done |
| EC-7 | Ecosystem | Governance issues | Open decision-making | Ongoing | Ongoing |

**Immediate action (6 items):** LD-1 error messages, DX-1 completion (SPEC-006), DX-2 defaults (SPEC-004/005), DX-3 vim motions (SPEC-005), AR-1 TS/T-Lisp boundary, AR-2 buffer API discipline.

**High priority (4 items):** DX-4 layered config, DX-5 REPL, DX-6 documentation, EC-2 package system.

**Medium (5 items):** LD-3 language quality, LD-4 type contracts, PF-1 async, EC-3 transferability, EC-4/5 package quality and community.

**Already addressed (8 items):** Lexical scoping, immutable data, terminal-only, daemon/client, startup, JIT, process isolation, module namespaces.
