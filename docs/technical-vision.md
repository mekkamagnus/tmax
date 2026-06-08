# tmax Technical Vision

**Status:** Active
**Last updated:** 2026-06-08
**Audience:** Contributors, maintainers, and future architects

This document sits above PRDs, RFCs, and ADRs in the project hierarchy. It defines where tmax is headed and why. All technical decisions should be consistent with the principles here. If an RFC or PRD contradicts this vision, resolve the conflict before proceeding.

---

## Why This Document Exists

tmax is growing beyond a single-purpose editor into a platform with its own TUI framework (Steep), its own Lisp dialect (T-Lisp), and a daemon/client architecture. Individual RFCs and PRDs capture specific decisions, but they don't answer the broader question: *what kind of system are we building, and what tradeoffs are we willing to make to get there?*

This document provides that answer. It's the reference point when two reasonable approaches conflict and you need a tiebreaker.

---

## Current State

tmax is a functional terminal-based text editor in alpha (v0.2.0). It runs on Bun with zero external dependencies. The architecture follows Emacs: a TypeScript core handles terminal I/O, file system operations, and rendering, while T-Lisp handles all editor logic including commands, modes, key bindings, and extensibility.

The codebase is ~37,000 lines across 93 files. Five editing modes, 100+ T-Lisp API functions, a daemon/client architecture, and three interchangeable frontends (TUI, Ink, Steep) are working.

**What's incomplete:** The Elm architecture that Steep implements is organizational but not semantically pure. The `update()` function delegates to `editor.handleKey()`, which mutates state through setter closures, T-Lisp environment mutation, and module-scoped registries. This is the central architectural debt that the project must address.

---

## Target State

tmax's long-term architecture has three layers:

1. **Steep** — a standalone TUI framework implementing the Elm architecture with full purity. `update(msg, model) => { model, cmds }` is a pure function. No hidden state, no setter closures, no mutable registries. Steep should be usable by any project that needs a terminal UI, not just tmax.

2. **T-Lisp** — a Lisp dialect for editor extensibility, running in a persistent (immutable) environment. State changes are explicit and traceable. The interpreter supports tail-call optimization, macros, and a complete standard library.

3. **tmax** — the text editor application, built on Steep and T-Lisp. tmax is the pressure test for both: it validates that the frameworks work under real-world complexity, and it drives their API design.

### What "done" looks like

- Steep can be published as an independent npm package with no tmax-specific code
- T-Lisp environments are persistent — snapshotting and restoring state is trivial
- The `update` function is referentially transparent — same inputs always produce the same outputs
- Time-travel debugging and replay from checkpoint work out of the box
- Every test can be a snapshot test: `assert update(msg, state) === expectedState`
- The daemon/client architecture uses state snapshots (not imperative commands) for client rendering

---

## Guiding Principles

### 1. Long-term architecture over short-term convenience

tmax is in alpha. Rewrites are acceptable. The priority is the best architecture, not preserving existing code. A decision that saves two weeks now but creates technical debt that takes two months to fix later is the wrong decision.

**Implication:** When evaluating an approach, ask "is this how we'd design it if we were starting from scratch?" If no, and the cost of doing it right is reasonable, do it right.

### 2. Steep is a product, not an internal detail

Steep will become its own standalone library. tmax is its first consumer and its pressure test. This means:

- Steep's API must be generic — no tmax-specific types, no editor assumptions
- Pure interfaces are not overengineering — they are the product Steep sells
- Every tmax feature that requires a Steep workaround is a bug in Steep, not a feature of tmax

**Implication:** When adding capabilities to the TUI layer, design the generic interface first, then implement the tmax-specific behavior on top of it.

### 3. Purity is earned incrementally, not abandoned when expensive

Full Elm purity is the long-term goal (see RFC-009). It will be achieved in phases:

1. **Registries into state** — eliminate hidden mutable references (~1,500 lines)
2. **Async isolation via Cmd** — make update synchronous (~2,000 lines)
3. **Setter closures to return-state objects** — explicit state transitions (~3,000 lines)
4. **Persistent T-Lisp environment** — immutable bindings, complete snapshot isolation (~5,000 lines)

Each phase is independently valuable and testable. No phase is optional — they're sequenced by risk, not by importance.

**Implication:** Don't add new mutation patterns. If you're writing code that introduces hidden state or setter closures, it will need to be rewritten. Write it in the target style if possible, or document it as temporary.

### 4. tmax is not a single-consumer application

Every design decision should consider at least two consumers: tmax itself, and a hypothetical second application built on Steep + T-Lisp. If a design only makes sense because "tmax is the only user," it's probably too specific.

**Implication:** APIs should expose capabilities, not implementations. Internal shortcuts that leak into public interfaces create coupling that blocks Steep's independence.

### 5. Simplicity is a constraint, not a goal

The right architecture for tmax is not the simplest one — it's the one that makes the system correct, testable, and maintainable. The Elm architecture adds complexity (Cmd system, explicit state returns) but it pays for itself in debugging, testing, and framework credibility.

Simplicity matters when two approaches are otherwise equivalent. It does not justify cutting corners on purity or correctness.

---

## Strategic Pillars

### Pillar A: Purity

The Elm architecture's value proposition is that `update(msg, model) => { model, cmds }` is a pure function. This enables snapshot testing, time-travel debugging, replay, and stateless server rendering. These are not theoretical benefits — they are practical tools for building and debugging a complex editor.

The purity work is tracked in RFC-009. The phases are ordered by value-to-risk ratio. Each phase closes a specific mutation gap (setter closures, T-Lisp environment, module registries, async operations).

### Pillar B: Steep Independence

Steep must reach a point where it can be extracted from tmax and published as a standalone TUI framework. This requires:

- No imports from tmax-specific modules (editor, tlisp, buffer)
- Generic `Model` and `Msg` types with no editor assumptions
- A clean plugin/extension API for framework-level customization
- Its own test suite that doesn't depend on tmax's editor logic

tmax will always be Steep's primary consumer and test bed, but it must not be Steep's only possible consumer.

### Pillar C: Editor Completeness

The immediate functional goal is basic Emacs with Evil-mode parity (see ROADMAP.md). This means:

- Vim-style modal editing (normal, insert, visual, command modes) — complete
- Emacs features via M-x (kill ring, minibuffer, help) — in progress
- T-Lisp extensibility matching Emacs Lisp's capability surface
- Daemon/client architecture for multi-session editing

Editor features drive Steep's API design. If a feature can't be expressed cleanly in Steep, Steep needs to change.

### Pillar D: Ecosystem Sustainability

A text editor lives or dies by its plugin ecosystem. Emacs has MELPA. Vim has vim-plug. tmax needs Loom — a package manager that is itself a T-Lisp package, browsable from inside the editor via `M-x list-packages`, with CLI as a secondary interface.

Loom is tracked in RFC-010. The key architectural principle: **the package manager is T-Lisp-first.** TypeScript provides filesystem and network primitives; all logic, UI, and state management are in T-Lisp. This means the package manager benefits from the same purity and testability goals as the rest of the system.

**v1** ships with git-based packages and a curated index (no hosted infrastructure). **v2** adds a hosted registry at `loom.tmux.mekaelturner.com` with auto-generated docs once adoption justifies the cost.

---

## How We Make Decisions

When approaches conflict:

1. **Consistent with this vision?** If not, don't do it.
2. **Consistent with the purity phases?** If it adds new mutation, it's moving backward.
3. **Generic enough for Steep?** If it only works for tmax, it's too specific.
4. **Acceptable in alpha?** If the project were post-1.0, would we still make this choice? If not, do it now while the cost is low.
5. **Simplest correct option?** Among approaches that satisfy 1-4, pick the simple one.

---

## Tradeoffs We Accept

- **Speed over backward compatibility.** Alpha means we break things. We don't maintain migration paths for internal APIs.
- **Purity over performance.** Persistent data structures and explicit state returns have overhead. We'll optimize after correctness is proven.
- **Framework quality over feature velocity.** A well-architected Steep that ships one fewer editor feature is better than a feature-complete editor built on a framework we have to rewrite.
- **Explicitness over convenience.** Setter closures are convenient. Return-state objects are explicit. We choose explicit.

---

## What This Document Is Not

- It is not a roadmap (see ROADMAP.md)
- It is not an architecture specification (see `src/` directory structure and ADRs in `docs/adrs/`)
- It is not a list of features (see PRDs and RFCs)
- It is not immutable — as the project evolves, this vision should be updated to reflect new understanding

---

## Relationship to Other Documents

```
technical-vision.md          ← You are here
  └── Architecture docs      ← System design (ADRs, arch diagrams)
      └── RFCs               ← Specific proposals (RFC-008, RFC-009, etc.)
          └── PRDs           ← Feature-level requirements
              └── Issues     ← Implementation tasks
```

Documents lower in the hierarchy inherit principles from above. An RFC that contradicts this vision should be resolved before implementation begins.
