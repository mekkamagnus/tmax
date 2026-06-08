# RFC-008: Steep ↔ Bubble Tea Gap Analysis

**Status:** 📋 PROPOSED
**Created:** 2026-06-08
**Author:** tmax Design Team
**Companion to:** RFC-006 (Steep Ecosystem)

## Table of Contents
- [Abstract](#abstract)
- [What Bubble Tea Is](#what-bubble-tea-is)
- [What Steep Has Now](#what-steep-has-now)
- [Gaps](#gaps)
- [What Steep Doesn't Need](#what-steep-doesnt-need)
- [Estimated Scope](#estimated-scope)
- [Design Decisions](#design-decisions)

---

## Abstract

This RFC analyzes the gaps between tmax's Steep frontend and the Charmbracelet Bubble Tea framework. The goal is not to clone Bubble Tea — Steep serves tmax's editor architecture, not generic TUI apps — but to identify which Bubble Tea patterns and capabilities would meaningfully improve Steep as a framework and as the foundation for the broader tea ecosystem (RFC-006).

## What Bubble Tea Is

Bubble Tea is an Elm-architecture TUI framework for Go. Its model:

```
Init → Model, Cmd
Update(Msg, Model) → Model, Cmd
View(Model) → string
```

**Core concepts:**

1. **Model** — immutable application state
2. **Msg** — union type of all possible events (key press, window resize, timer tick, I/O completion)
3. **Init()** → `(Model, Cmd)` — initial state + optional commands
4. **Update(Msg, Model)** → `(Model, Cmd)` — pure function: given a message and current model, produce a new model and optionally emit commands
5. **View(Model)** → `string` — pure function: render model to terminal output
6. **Cmd** — side-effect description (HTTP request, timer, subprocess). Not executed in Update — dispatched by the runtime
7. **TeaProgram** — the runtime that wires init/update/view together, manages the event loop, processes commands, and drives the render cycle

**Key features Bubble Tea provides:**

- Alt screen buffer management
- Raw mode input with full escape sequence parsing (arrow keys, function keys, modifier combos, mouse events, bracketed paste, focus events)
- Window resize detection
- Render diffing (only redraws changed lines)
- Command system for async side effects (tick, every, HTTP, exec)
- Mouse support (click, scroll, drag, motion)
- Bracketed paste mode
- Focus/blur events (terminal focus detection)
- Compose-able sub-models (tea.Batch, tea.Sequence)
- Signal handling (SIGINT, SIGTERM)
- Enter/exit alt screen with cleanup
- Cursor styling (block, underline, bar; blinking)
- Repaint-on-resize
- Diff-based rendering (only changed rows)

## What Steep Has Now

### SteepFrontend (`index.ts` — 123 lines)

The main loop. Owns the full lifecycle:

```
run(editor, initialState)
  → start editor
  → enter alt screen
  → render loop: state → clear screen → writeAt lines → move cursor
  → input loop: key → editor.handleKey() → get state → render
  → resize handler: update dims → get state → render
  → cleanup on SIGINT/SIGTERM
```

The render function is a single `render()` closure that:
1. Calculates layout (tab bar, buffer area, command area, status line)
2. Gets syntax highlight spans
3. Renders buffer lines, command input, status line
4. Writes everything to screen via `writeAt()`
5. Positions cursor

**What this is:** A working TUI loop with imperative rendering. Not Elm architecture — the update and view are not pure functions, there's no Cmd system, and the render does full-screen clears.

### Screen (`screen.ts` — 54 lines)

Terminal primitives:
- `enterAltScreen()` / `exitAltScreen()` — `?1049h`/`?1049l`
- `clear()` — `2J` + home
- `writeAt(row, col, text)` — CSI cursor positioning + write
- `moveTo(row, col)` — CSI cursor positioning
- `hideCursor()` / `showCursor()` — `?25l`/`?25h`
- `getDims()` — stdout columns/rows with defaults
- `onResize(callback)` — stdout resize + SIGWINCH listeners

### Input (`input.ts` — 75 lines)

Raw mode key reading:
- `start()` / `stop()` — sets raw mode, binds stdin data handler
- `onKey(handler)` — registers callback
- `tokenizeSteepInput()` — splits chunks into normalized `KeyMsg` objects
- Handles: escape, return, backspace, ctrl+C
- Delegates to `tokenizeTerminalInput()` for arrow keys, PageUp/Down

### KeyMsg (`frontends/types.ts`)

```typescript
interface KeyMsg {
  key: string;
  raw?: string;
  escape?: boolean;
  return?: boolean;
  backspace?: boolean;
  delete?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}
```

## Gaps

### Gap 1: No Elm Architecture Separation

**What Bubble Tea does:** Init/Update/View are three distinct, pure functions. The runtime calls them independently. Update produces a new Model; View renders it. They never share mutable state.

**What Steep does:** Everything is in one `render()` closure. The "update" is `editor.handleKey()` which mutates editor state internally. The "view" is interleaved with layout calculations, syntax highlighting, and screen writes. There's no separation between "what happened" and "how to draw it."

**Impact:** High. This is the fundamental architectural gap. Without it, Steep can't be used as a standalone framework, can't support sub-models, and can't reason about state transitions.

**Effort:** Large. Requires refactoring SteepFrontend into three distinct phases and extracting state into an immutable model.

### Gap 2: Full-Screen Clear on Every Render

**What Bubble Tea does:** Diff-based rendering. The View function returns a string, and Bubble Tea compares it against the previous output, only writing changed lines. This is fast and flicker-free.

**What Steep does:** `screen.clear()` + full rewrite every frame. Every keypress clears the entire screen and redraws every line. This works but causes visible flicker on slow terminals and wastes bandwidth on large screens.

**Impact:** Medium. Works but limits responsiveness. Users on SSH connections or large terminals will see flicker.

**Effort:** Medium (~150 lines for a diff renderer). Track previous frame as `string[]`, compare per-row, only `writeAt` changed rows.

### Gap 3: No Cmd System (Async Side Effects)

**What Bubble Tea does:** Update returns `(Model, Cmd)`. Cmds describe async operations (timers, HTTP, subprocesses) without executing them. The runtime executes them and delivers results as Msgs. This keeps Update pure and testable.

**What Steep does:** Side effects happen inside `editor.handleKey()` and `editor.start()`. File I/O, T-Lisp evaluation, daemon communication — all happen imperatively inside the update path. No way to batch, sequence, or cancel async operations.

**Impact:** Medium. Works for tmax's current needs since the editor handles its own async. Becomes a blocker if Steep needs to support timers, animations, or non-editor TUI apps.

**Effort:** Large. Requires designing a Cmd/Msg type system and integrating it with the event loop.

### Gap 4: Incomplete Key Parsing

**What Bubble Tea does:** Parses the full range of terminal escape sequences:
- Function keys (F1-F12)
- Modifier combos (Ctrl+Arrow, Shift+Tab, Alt+Enter, Ctrl+Shift+...)
- Mouse events (click, scroll, drag, motion) via SGR and X10 protocols
- Bracketed paste (large text pastes delivered as a single PasteMsg)
- Focus events (terminal gains/loses focus)
- Extended keys (CSI u protocol)
- Kitty keyboard protocol

**What Steep does:** Handles: arrow keys, PageUp/Down, escape, return, backspace, ctrl+C, ctrl+other. Missing: function keys, mouse events, bracketed paste, focus events, modifier combos beyond ctrl, Shift+Tab, extended key protocol.

**Impact:** Medium. tmax is a keyboard-first editor — function keys and mouse support would improve usability. Bracketed paste prevents paste events from being interpreted as individual keystrokes.

**Effort:** Medium (~200 lines to expand the escape sequence parser in `input.ts` and `render/input.ts`).

### Gap 5: No Mouse Support

**What Bubble Tea does:** Full mouse support — click, double-click, scroll, drag, motion events. Mouse mode is activated by sending `\x1b[?1000h` (basic) or `\x1b[?1006h` (SGR) to the terminal.

**What Steep does:** No mouse support at all. No mouse mode activation, no mouse event parsing, no mouse Msgs.

**Impact:** Low for tmax (keyboard-first editor). Medium for Steep as a general framework — many TUI apps need mouse.

**Effort:** Medium (~150 lines). Enable SGR mouse mode, parse mouse escape sequences, add MouseMsg type.

### Gap 6: No Cursor Styling

**What Bubble Tea does:** Supports cursor styles — block `\x1b[2 q`, underline `\x1b[4 q`, bar `\x1b[6 q` — and blinking variants. Exposes this through the View API.

**What Steep does:** Only `hideCursor()` and `showCursor()`. No cursor style changes. tmax hardcodes block cursor rendering in the buffer renderer.

**Impact:** Low. tmax renders its own block cursor via ANSI inverse video. Native cursor styling would be cleaner but not essential.

**Effort:** Small (~20 lines in screen.ts).

### Gap 7: No Sub-Model Composition

**What Bubble Tea does:** Supports composing programs from sub-models via `tea.Batch` (run multiple programs concurrently) and embedding child models. Each sub-model has its own init/update/view.

**What Steep does:** Monolithic render function. Tab bar, buffer area, status line, minibuffer — all rendered inline in one closure. No composable components.

**Impact:** Medium for Steep as a framework. Low for tmax's current needs — the editor has a fixed layout.

**Effort:** Large. Requires solving Gap 1 (Elm architecture) first, then building a component model on top.

### Gap 8: No Resize Msg

**What Bubble Tea does:** Window resize produces a `WindowSizeMsg` with explicit width/height, delivered through the same Update function as every other event. The model updates, View re-renders.

**What Steep does:** Resize calls a callback that imperatively updates the editor and re-renders. The resize doesn't flow through the normal key→state→render path — it has its own side-channel.

**Impact:** Low. Works correctly. Would be cleaner as a Msg in an Elm architecture.

**Effort:** Trivial once Gap 1 is solved.

### Gap 9: No Tick/Timer Commands

**What Bubble Tea does:** `tea.Tick(duration, func)` delivers a Msg after a delay. `tea.Every(interval, func)` delivers Msgs on a recurring interval. Used for animations, debouncing, which-key timeout, auto-save.

**What Steep does:** No timer infrastructure. Timeouts (like which-key) are handled in T-Lisp via the evaluator, not in the frontend.

**Impact:** Low for tmax (T-Lisp handles timing). Medium for Steep as a general framework.

**Effort:** Small (~50 lines) once Gap 3 (Cmd system) exists. Without the Cmd system, timers require ad-hoc `setInterval` in the render loop.

### Gap 10: No Render Batching/Coalescing

**What Bubble Tea does:** Batches multiple Msgs processed in the same tick into a single render pass. If Update produces three Msgs in sequence, View is only called once.

**What Steep does:** Every keypress triggers `render()` immediately. Multiple rapid keypresses = multiple full-screen redraws. No batching.

**Impact:** Low in practice (keyboard input is inherently serial). Would matter with mouse motion events or programmatic Msg bursts.

**Effort:** Small (~30 lines) once Gap 1 is solved. Accumulate Msgs in a queue, drain before render.

## What Steep Doesn't Need

Not every Bubble Tea feature makes sense for Steep:

1. **HTTP commands** — tmax doesn't make HTTP requests. If Steep becomes a general framework, add later.
2. **Subprocess exec** — tmax runs as a single process. Shell command execution belongs in T-Lisp, not the frontend.
3. **Go-specific concurrency** — Bubble Tea uses goroutines and channels. Steep uses async/await and event callbacks. The concurrency model is different by design.
4. **Generic program interface** — Bubble Tea's `tea.Program` accepts any model satisfying the `Model` interface. Steep serves tmax's EditorState — it doesn't need to be fully generic yet.
5. **ANSI writer abstraction** — Bubble Tea has a `lipgloss.Writer` for custom ANSI output targets. Steep writes directly to stdout via CSI sequences.

## Estimated Scope

| Gap | Description | Priority | Effort | Depends on |
|---|---|---|---|---|
| 1 | Elm architecture separation | High | Large | — |
| 2 | Diff-based rendering | High | Medium | — |
| 3 | Cmd system (async side effects) | Medium | Large | Gap 1 |
| 4 | Complete key parsing | Medium | Medium | — |
| 5 | Mouse support | Low | Medium | — |
| 6 | Cursor styling | Low | Small | — |
| 7 | Sub-model composition | Medium | Large | Gap 1 |
| 8 | Resize as Msg | Low | Trivial | Gap 1 |
| 9 | Tick/timer commands | Low | Small | Gap 3 |
| 10 | Render batching | Low | Small | Gap 1 |

### Recommended sequence

**First pass (unblocks Steep as a usable framework):**
1. Gap 2 — Diff-based rendering. Immediate quality improvement, no architecture change needed
2. Gap 4 — Complete key parsing. Practical improvement for tmax users
3. Gap 6 — Cursor styling. Trivial, improves polish

**Second pass (architectural foundation):**
4. Gap 1 — Elm architecture separation. This is the big one
5. Gap 8 — Resize as Msg. Trivial once Gap 1 is done
6. Gap 10 — Render batching. Simple once Gap 1 is done

**Third pass (framework completeness):**
7. Gap 3 — Cmd system
8. Gap 5 — Mouse support
9. Gap 9 — Tick/timer commands
10. Gap 7 — Sub-model composition

## Design Decisions

1. **Steep is not Bubble Tea.** The goal is parity of capability, not identical API. Steep uses TypeScript idioms (async/await, closures, union types) rather than Go idioms (interfaces, goroutines, channels).

2. **tmax first, framework second.** Steep serves tmax. Framework generalization happens only when it doesn't compromise tmax's needs. Gap 1 (Elm architecture) is valuable for tmax's own code quality, not just framework aspirations.

3. **Diff rendering before Elm architecture.** Gap 2 is a standalone improvement that can be shipped immediately. Gap 1 requires restructuring the entire frontend. Do the easy win first.

4. **Mouse is low priority.** tmax is a keyboard-first editor. Mouse support matters for Steep-as-framework but not for tmax's daily use.

5. **Cmd system can wait.** tmax's editor already handles its own async (file I/O, T-Lisp evaluation). A formal Cmd system becomes necessary only when Steep needs to support non-editor TUI apps or complex async flows (animations, real-time updates).
