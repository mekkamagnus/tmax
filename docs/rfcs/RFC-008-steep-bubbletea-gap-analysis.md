# RFC-008: Assam ↔ Bubble Tea Gap Analysis

**Status:** 📋 PROPOSED
**Created:** 2026-06-08
**Updated:** 2026-06-09
**Author:** tmax Design Team
**Companion to:** RFC-006 (Steep Ecosystem)
**Purity implications:** RFC-009 (Elm Purity Gap Analysis)

## Table of Contents
- [Abstract](#abstract)
- [What Bubble Tea Is](#what-bubble-tea-is)
- [What Assam Has Now](#what-assam-has-now)
- [Gaps](#gaps)
- [What Assam Doesn't Need](#what-assam-doesnt-need)
- [Estimated Scope](#estimated-scope)
- [Design Decisions](#design-decisions)

---

## Abstract

This RFC analyzes the gaps between tmax's current Steep frontend code (which will become **Assam**, the Bubble Tea equivalent in the Steep ecosystem) and the Charmbracelet Bubble Tea framework. Each gap includes exact file paths, current code, target API signatures, step-by-step implementation instructions, and verification criteria — detailed enough for an AI agent to execute without additional context.

The goal is parity of capability, not identical API. Assam uses TypeScript idioms (async/await, closures, union types) rather than Go idioms (interfaces, goroutines, channels).

**Purity note:** RFC-009 analyzes the gap between Assam's organizational Elm separation and full semantic purity. The current `update` wraps `editor.handleKey()` which mutates state — this is a known temporary state, not a permanent design choice. RFC-009 defines a phased path to full purity: registries into state, setter closures to return-state objects, then persistent T-Lisp environments. The Gap 1 API below is designed to accommodate this transition — the `Update` type will remain `(msg, model) => { model, cmds }`, but what happens inside will shift from "wrap mutating handleKey" to "wrap pure state-returning handleKey" as RFC-009 phases land.

## What Bubble Tea Is

Bubble Tea is an Elm-architecture TUI framework for Go. Its model:

```
Init → Model, Cmd
Update(Msg, Model) → Model, Cmd
View(Model) → string
```

**Core concepts:**

1. **Model** — immutable application state (a plain object/struct)
2. **Msg** — union type of all possible events (key press, window resize, timer tick, I/O completion, mouse click)
3. **Init()** → `(Model, Cmd)` — returns initial state + optional commands
4. **Update(Msg, Model)** → `(Model, Cmd)` — pure function: given a message and current model, produce a new model and optionally emit commands
5. **View(Model)** → `string` — pure function: render model to terminal output string
6. **Cmd** — a description of a side effect (HTTP request, timer, subprocess). Not executed inside Update — the runtime dispatches them and delivers results as new Msgs
7. **Program** — the runtime that wires init/update/view together, manages the event loop, processes commands, and drives the render cycle

**Key features Bubble Tea provides:**

- Alt screen buffer management (`\x1b[?1049h` / `\x1b[?1049l`)
- Raw mode input with full escape sequence parsing (arrow keys, function keys, modifier combos, mouse events, bracketed paste, focus events)
- Window resize detection
- Render diffing (only redraws changed lines)
- Command system for async side effects (`tea.Tick`, `tea.Every`, `tea.Batch`)
- Mouse support (click, scroll, drag, motion) via SGR protocol
- Bracketed paste mode (`\x1b[?2004h`)
- Focus/blur events (`\x1b[?1004h`)
- Compose-able sub-models (`tea.Batch`, `tea.Sequence`)
- Signal handling (SIGINT, SIGTERM)
- Enter/exit alt screen with cleanup
- Cursor styling (block `\x1b[2 q`, underline `\x1b[4 q`, bar `\x1b[6 q`; blinking variants)
- Repaint-on-resize

## What Assam Has Now

### Current file locations (before reorganization)

These files will move to `src/steep/` as part of RFC-006:

| Current path | New path (post-RFC-006) | Lines |
|---|---|---|
| `src/frontend/frontends/steep/index.ts` | `src/steep/assam.ts` | 123 |
| `src/frontend/frontends/steep/screen.ts` | `src/steep/screen.ts` | 54 |
| `src/frontend/frontends/steep/input.ts` | `src/steep/input.ts` | 75 |
| `src/frontend/frontends/steep/style.ts` | `src/steep/matcha.ts` | 88 |
| `src/frontend/frontends/types.ts` | `src/steep/types.ts` | 27 |
| `src/frontend/render/input.ts` | `src/steep/input-tokenizer.ts` | 67 |

### AssamFrontend (`src/frontend/frontends/steep/index.ts` — 123 lines)

The main loop. Current structure (line numbers are approximate):

```
Lines 14-22:  Class declaration, constructor
Lines 23-31:  cleanup() — stop resize, stop input, show cursor, exit alt screen
Lines 32-72:  render() — the monolithic render closure
Lines 74-107: run() — enter alt screen, start editor, bind resize, bind input, render loop
Lines 108-122: finally block — cleanup
```

The `render()` closure:
1. Gets terminal dims (`screen.getDims()`)
2. Calculates layout heights (tab bar, buffer area, command area, status line)
3. Calls `computeHighlightSpans()` for syntax highlighting
4. Calls `renderBufferLines()`, `renderCommandInput()`, `renderStatusLine()`, `renderTabBarAnsi()`
5. Writes everything via `screen.writeAt()` with `screen.clear()` first
6. Positions cursor via `screen.moveTo()`

**What this is:** A working TUI loop with imperative rendering. NOT Elm architecture. Update and view are not separated. There's no Cmd system. The render does full-screen clears.

### Screen (`src/frontend/frontends/steep/screen.ts` — 54 lines)

Terminal primitives. All methods write directly to `process.stdout`:

```typescript
class Screen {
  enterAltScreen()   // writes "\x1b[?1049h" then clear()
  exitAltScreen()    // writes "\x1b[?1049l"
  clear()            // writes "\x1b[2J\x1b[H"
  writeAt(row, col, text)  // writes `\x1b[${row+1};${col+1}H${text}`
  moveTo(row, col)   // writes `\x1b[${row+1};${col+1}H`
  hideCursor()       // writes "\x1b[?25l"
  showCursor()       // writes "\x1b[?25h"
  getDims()          // returns { width: stdout.columns, height: stdout.rows }
  onResize(cb)       // binds stdout "resize" event + SIGWINCH signal
}
```

### Input (`src/frontend/frontends/steep/input.ts` — 75 lines)

Raw mode key reading:

```typescript
class Input {
  onKey(handler: (msg: KeyMsg) => void | Promise<void>)  // register callback
  start()      // set raw mode, bind stdin "data" handler
  stop()       // unset raw mode, unbind handler
}
```

Internally calls `tokenizeSteepInput(chunk, pending)` which delegates to `tokenizeTerminalInput()` from `src/frontend/render/input.ts`.

### Input tokenizer (`src/frontend/render/input.ts` — 67 lines)

The escape sequence parser. Current `escapeSequenceMap`:

```typescript
const escapeSequenceMap = {
  "\x1b[A": "Up",
  "\x1b[B": "Down",
  "\x1b[C": "Right",
  "\x1b[D": "Left",
  "\x1b[5~": "PageUp",
  "\x1b[6~": "PageDown",
  "\x1b[3~": "\x7f",    // Delete
};
```

### KeyMsg (`src/frontend/frontends/types.ts`)

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

### Frontend interface (`src/frontend/frontends/types.ts`)

```typescript
interface Frontend {
  run(editor: Editor, initialState: EditorState, filename?: string): Promise<void>;
}

interface TerminalDims {
  width: number;
  height: number;
}
```

---

## Gaps

### Gap 1: No Elm Architecture Separation

**What Bubble Tea does:** Init/Update/View are three distinct, pure functions. The runtime calls them independently. Update produces a new Model; View renders it. They never share mutable state.

**What Assam does:** Everything is in one `render()` closure inside `index.ts`. The "update" is `editor.handleKey()` which mutates editor state internally. The "view" is interleaved with layout calculations, syntax highlighting, and screen writes.

**Impact:** High. This is the fundamental architectural gap.

**Effort:** Large.

**Target API:**

```typescript
// src/steep/assam.ts

/** A message — must carry a `type` discriminant for switch narrowing. */
interface Msg {
  type: string;
  [key: string]: unknown;
}

/** Init returns initial model and optional commands. */
type Init<T> = () => { model: T; cmds?: Cmd[] };

/**
 * Update produces a new model and optional commands from a message.
 *
 * Current state (temporary): In tmax's adapter, update wraps editor.handleKey()
 * which mutates T-Lisp state internally via setter closures. This is not yet
 * a pure function. The separation still has value: it isolates side effects to
 * update(), keeps view() side-effect-free, and enables the Cmd system.
 *
 * Target state (RFC-009): As purity phases land, handleKey() will shift from
 * mutating state via setters to returning new state objects. The Update type
 * signature stays the same — only the internals change. This API is designed
 * to accommodate that transition without breaking changes.
 */
type Update<T> = (msg: Msg, model: T) => { model: T; cmds?: Cmd[] };

/**
 * View renders the model to a frame: an array of ANSI strings (one per screen
 * line) plus a cursor position.
 *
 * Cursor position is part of the view output, not the model. In Bubble Tea,
 * cursor positioning is embedded in the view string via ANSI sequences. Assam
 * returns it explicitly so the runtime can position the cursor after diff-
 * rendering without requiring the view to emit raw cursor-move escapes.
 */
interface Frame {
  lines: string[];
  cursor: { row: number; col: number } | null;
}

type View<T> = (model: T) => Frame;

/** Cmd describes a side effect without executing it. */
interface Cmd {
  readonly type: string;
  readonly execute: () => Promise<Msg>;
}

/** Assam program — the runtime. */
class AssamProgram<T> {
  constructor(options: {
    init: Init<T>;
    update: Update<T>;
    view: View<T>;
  });

  run(): Promise<void>;
}
```

**Step-by-step implementation:**

1. Create `src/steep/assam.ts` with the types above
2. Implement `AssamProgram`:
   - `run()` calls `init()`, stores the model, calls `view(model)`, writes output to screen
   - Bind input handler: each keypress → create a `KeyMsg` → call `update(msg, model)` → store new model → call `view(model)` → diff-render to screen → position cursor from `frame.cursor`
   - Bind resize handler: create a `WindowResizeMsg` → call `update(msg, model)` → store new model → call `view(model)` → diff-render to screen
   - Process Cmds: after each update, iterate `cmds` array, call `cmd.execute()`, when promise resolves, feed result Msg back through `update()`
   - Cleanup on SIGINT/SIGTERM
3. Create an adapter in `src/frontend/frontends/steep/index.ts` that wraps the existing editor logic into Assam's init/update/view:
   - `init`: returns current `EditorState` as the model
   - `update`: calls `editor.handleKey()` or handles resize, returns new `EditorState`
   - `view`: extracts the existing render logic (buffer lines, status line, etc.) into a pure function that takes `EditorState` and returns `Frame` (lines + cursor position)
4. Verify: `bun run typecheck` passes, `bun test` passes, editor behaves identically

**Verification:**
- `bun run typecheck` — zero errors
- `bun test` — all existing tests pass
- Manual: open tmax, type text, verify rendering identical to before refactor

---

### Gap 2: Full-Screen Clear on Every Render

**What Bubble Tea does:** Tracks previous frame output. Compares per-row. Only calls `writeAt()` for changed rows. No `clear()`. This is fast and flicker-free.

**What Assam does:** `screen.clear()` + full rewrite every frame (line 49 of `index.ts`). Every keypress clears the entire screen and redraws every line.

**Impact:** High for quality. Visible flicker on SSH, wasted bandwidth on large terminals.

**Effort:** Medium (~100 lines).

**Target API:**

```typescript
// src/steep/renderer.ts

export class DiffRenderer {
  private previousFrame: string[] = [];
  private width: number = 0;
  private height: number = 0;

  /** Set terminal dimensions. Call on init and resize. */
  setDims(width: number, height: number): void;

  /**
   * Compare new frame against previous frame. Write only changed rows.
   * Returns the number of rows written (for debugging).
   */
  render(screen: Screen, frame: string[]): number;

  /** Clear the stored frame (call after alt screen enter or resize). */
  invalidate(): void;
}
```

**Step-by-step implementation:**

1. Create `src/steep/renderer.ts`
2. Implement `DiffRenderer`:
   - `setDims(w, h)`: store width/height, invalidate frame
   - `render(screen, frame)`:
     ```typescript
     render(screen: Screen, frame: string[]): number {
       let writes = 0;
       const maxRows = Math.max(frame.length, this.previousFrame.length);
       for (let row = 0; row < maxRows; row++) {
         const newLine = frame[row] ?? "";
         const oldLine = this.previousFrame[row] ?? undefined;
         if (newLine !== oldLine) {
           screen.writeAt(row, 0, newLine);
           writes++;
         }
       }
       // If new frame is shorter, erase trailing rows from previous frame.
       // Use clearRow() (\x1b[K) rather than writing spaces — spaces inherit
       // any active ANSI color from the previous content.
       for (let row = frame.length; row < this.previousFrame.length; row++) {
         if (this.previousFrame[row] && this.previousFrame[row].length > 0) {
           screen.clearRow(row);
           writes++;
         }
       }
       this.previousFrame = [...frame];
       return writes;
     }
     ```
   - `invalidate()`: set `previousFrame = []`
   - **Limitation:** Line comparison is by raw string equality. Two lines that look identical but have different ANSI color codes will both be redrawn. This is acceptable because tmax rendering is deterministic — the same state always produces the same ANSI output. A future ANSI-aware comparison (stripping escape codes before comparing) would reduce redraws further but is not needed initially.
3. In `screen.ts`, add a `clearRow(row)` method: `process.stdout.write(\x1b[${row+1};1H\x1b[K`)`
4. Modify the render closure in `index.ts`:
   - Remove `screen.clear()` call
   - Replace individual `screen.writeAt()` calls with `this.diffRenderer.render(screen, lines)`
   - Call `diffRenderer.invalidate()` on alt screen enter and on resize
5. Handle cursor positioning: still use `screen.moveTo()` after diff render

**Verification:**
- `bun run typecheck` — zero errors
- Manual: open tmax in a large terminal, verify no flicker when typing
- Manual: verify resize still renders correctly (diff renderer invalidates on resize)
- Test: write a unit test in `test/unit/renderer.test.ts` that verifies only changed rows are written

---

### Gap 3: No Cmd System (Async Side Effects)

**What Bubble Tea does:** Update returns `(Model, Cmd)`. Cmds are data structures describing side effects. The runtime executes them asynchronously and delivers results as new Msgs. This keeps Update pure and testable.

**What Assam does:** Side effects happen inside `editor.handleKey()` and `editor.start()`. File I/O, T-Lisp evaluation, daemon communication — all happen imperatively. No way to batch, sequence, or cancel async operations.

**Impact:** High. Essential for Emacs-parity features (HTTP, async shell commands, network protocols).

**Effort:** Large. Depends on Gap 1 being complete.

**Target API:**

```typescript
// src/steep/cmd.ts

/** A Cmd describes a side effect. It carries a type tag and a function that
 *  produces a Msg when the effect completes. */
export interface Cmd {
  readonly type: string;
  readonly execute: () => Promise<Msg>;
}

/** Built-in Cmd constructors */

/** Fire a Msg once after a delay (milliseconds). */
export function Tick(ms: number, toMsg: () => Msg): Cmd;

/**
 * Fire a Msg on a recurring interval. Uses stateless recurrence: Every()
 * returns a Cmd whose execute() resolves once (after the first interval tick).
 * The program must return a new Every() Cmd from update() to continue the
 * cycle. This avoids leaked intervals and makes cancellation natural — just
 * stop returning the Cmd.
 *
 * Pattern:
 *   update(msg, model) {
 *     if (msg.type === "tick") return { model, cmds: [Every(1000, () => ({ type: "tick" }))] };
 *     return { model };
 *   }
 */
export function Every(ms: number, toMsg: () => Msg): Cmd;

/** Run an arbitrary async function and map the result to a Msg. */
export function AsyncCmd<T>(fn: () => Promise<T>, toMsg: (result: T) => Msg): Cmd;

/**
 * Run multiple Cmds concurrently. All results are delivered as separate Msgs.
 * Returns a single Cmd with type "batch" — the program unpacks it and executes
 * each element, rather than returning a bare array that must be flattened.
 */
export function Batch(cmds: Cmd[]): Cmd;

/** No-op Cmd. Its Msg carries type "none" to satisfy the Msg discriminant. */
export const None: Cmd = { type: "none", execute: async () => ({ type: "none" }) };
```

**Step-by-step implementation:**

1. Create `src/steep/cmd.ts` with the types and constructors above
2. `Tick(ms, toMsg)`: returns `{ type: "tick", execute: () => new Promise(resolve => setTimeout(() => resolve(toMsg()), ms)) }`
3. `Every(ms, toMsg)`: returns `{ type: "every", execute: () => new Promise(resolve => setTimeout(() => resolve(toMsg()), ms)) }` — uses `setTimeout` (fires once), NOT `setInterval`. The program re-emits `Every()` from update() to continue recurring.
4. `AsyncCmd(fn, toMsg)`: returns `{ type: "async", execute: () => fn().then(toMsg) }`
5. `Batch(cmds)`: returns `{ type: "batch", execute: async () => ({ type: "batch" }) }` — the program checks for `type: "batch"` and executes each inner Cmd individually, delivering each result as a separate Msg. The execute() on Batch itself is a no-op.
6. Integrate into `AssamProgram` (from Gap 1):
   - After each `update()` call, check if `cmds` is non-empty
   - For each cmd, call `cmd.execute()` (do NOT await — fire and let resolve)
   - When each cmd's promise resolves, feed the resulting Msg back through `update()`
   - This creates a loop: msg → update → (model, cmds) → execute cmds → new msg → update → ...
7. Add error handling: if `cmd.execute()` rejects, wrap the error in a `CmdErrMsg` and feed it through update

**Verification:**
- Unit test: create a trivial program with `Tick(100, () => ({ type: "tick-done" }))`, verify the Msg arrives
- Unit test: create a program with `AsyncCmd`, verify result Msg arrives
- `bun run typecheck` — zero errors

---

### Gap 4: Incomplete Key Parsing

**What Bubble Tea does:** Parses the full range of terminal escape sequences: function keys (F1-F12), modifier combos (Ctrl+Arrow, Shift+Tab, Alt+Enter), bracketed paste, focus events, extended keys (CSI u protocol), Kitty keyboard protocol.

**What Assam does:** Only handles: arrow keys, PageUp/Down, escape, return, backspace, ctrl+C, ctrl+other. The escape sequence map in `src/frontend/render/input.ts` has 6 entries.

**Impact:** Medium. Function keys and modifier combos are practical improvements. Bracketed paste prevents pasted text from being interpreted as individual keystrokes.

**Effort:** Medium (~200 lines to expand the escape sequence parser).

**Target API — expanded escape sequence map:**

Add these entries to the `escapeSequenceMap` in `src/frontend/render/input.ts` (or its new location `src/steep/input-tokenizer.ts`):

```typescript
const escapeSequenceMap: Readonly<Record<string, string>> = {
  // Arrow keys
  "\x1b[A": "Up",
  "\x1b[B": "Down",
  "\x1b[C": "Right",
  "\x1b[D": "Left",

  // Navigation
  "\x1b[5~": "PageUp",
  "\x1b[6~": "PageDown",
  "\x1b[H": "Home",
  "\x1b[F": "End",
  "\x1b[1~": "Home",       // vt100 variant
  "\x1b[4~": "End",         // vt100 variant

  // Function keys
  "\x1bOP": "F1",           // vt100
  "\x1bOQ": "F2",
  "\x1bOR": "F3",
  "\x1bOS": "F4",
  "\x1b[15~": "F5",
  "\x1b[17~": "F6",
  "\x1b[18~": "F7",
  "\x1b[19~": "F8",
  "\x1b[20~": "F9",
  "\x1b[21~": "F10",
  "\x1b[23~": "F11",
  "\x1b[24~": "F12",

  // Delete
  "\x1b[3~": "Delete",

  // Tab / Shift+Tab
  "\x1b[Z": "Shift+Tab",

  // Ctrl+Arrow (xterm)
  "\x1b[1;5A": "Ctrl+Up",
  "\x1b[1;5B": "Ctrl+Down",
  "\x1b[1;5C": "Ctrl+Right",
  "\x1b[1;5D": "Ctrl+Left",

  // Shift+Arrow
  "\x1b[1;2A": "Shift+Up",
  "\x1b[1;2B": "Shift+Down",
  "\x1b[1;2C": "Shift+Right",
  "\x1b[1;2D": "Shift+Left",

  // Alt+Arrow
  "\x1b[1;3A": "Alt+Up",
  "\x1b[1;3B": "Alt+Down",
  "\x1b[1;3C": "Alt+Right",
  "\x1b[1;3D": "Alt+Left",
};
```

**Update KeyMsg to include new fields:**

```typescript
interface KeyMsg {
  key: string;        // The parsed key name or literal character
  raw?: string;       // Raw escape sequence
  // Booleans for common keys
  escape?: boolean;
  return?: boolean;
  backspace?: boolean;
  delete?: boolean;
  tab?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  home?: boolean;
  end?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  // Function keys
  fKey?: number;      // 1-12
  // Modifiers
  ctrl?: boolean;
  meta?: boolean;     // Alt
  shift?: boolean;
  // Paste mode
  paste?: boolean;    // true when inside a bracketed paste
}
```

**Bracketed paste mode:**

1. On `Input.start()`, enable bracketed paste: `process.stdout.write("\x1b[?2004h")`
2. On `Input.stop()`, disable: `process.stdout.write("\x1b[?2004l")`
3. In the tokenizer, detect paste start `\x1b[200~` and paste end `\x1b[201~`
4. Accumulate everything between start/end into a single `PasteMsg` (or a `KeyMsg` with `paste: true` and the full pasted text in `key`)

**Focus events (optional, low priority):**

1. Enable: `process.stdout.write("\x1b[?1004h")`
2. Disable: `process.stdout.write("\x1b[?1004l")`
3. Parse `\x1b[I` (focus) and `\x1b[O` (blur) into FocusMsg

**Step-by-step implementation:**

1. Expand `escapeSequenceMap` in `src/frontend/render/input.ts` with all entries above
2. Update `toKeyMsg()` in `src/frontend/frontends/steep/input.ts` to detect F-keys, Home, End, Shift+Tab, modifier combos from the key string
3. Add `fKey`, `home`, `end`, `tab`, `paste` fields to `KeyMsg` interface
4. Add bracketed paste handling to `tokenizeTerminalInput()`:
   - Detect `\x1b[200~` → set paste mode flag, accumulate until `\x1b[201~`
   - When paste ends, emit a single `KeyMsg` with `paste: true` and the accumulated text
5. Add focus event handling (optional): detect `\x1b[I` and `\x1b[O`
6. Update all code that pattern-matches on `KeyMsg` to handle new fields

**Verification:**
- Unit test: feed each escape sequence to `tokenizeTerminalInput()`, verify correct key name
- Unit test: feed `\x1b[200~hello world\x1b[201~`, verify single `KeyMsg` with `paste: true`
- `bun run typecheck` — zero errors
- Manual: press F1-F12 in tmax, verify they register (even if no binding exists)

---

### Gap 5: No Mouse Support

**What Bubble Tea does:** Full mouse support — click, scroll, drag, motion events. Activated via `\x1b[?1000h` (basic click), `\x1b[?1002h` (drag), or `\x1b[?1006h` (SGR — recommended). SGR mode emits `\x1b[<Cb;Cx;CyM` (press) and `\x1b[<Cb;Cx;Cym` (release) where Cb is button code, Cx/Cy are column/row (1-based).

**What Assam does:** No mouse support at all.

**Impact:** High. Click-to-position, scroll-to-navigate, select-to-highlight are expected editor behaviors.

**Effort:** Medium (~150 lines).

**Target API:**

```typescript
// src/steep/types.ts (additions)

export type MouseAction = "press" | "release" | "scroll_up" | "scroll_down" | "motion";
export type MouseButton = "left" | "middle" | "right" | "none";

export interface MouseMsg {
  type: "mouse";
  action: MouseAction;
  button: MouseButton;
  row: number;       // 0-based
  col: number;       // 0-based
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

// Union type for all messages Assam can produce
export type AssamMsg = KeyMsg | MouseMsg | WindowResizeMsg | PasteMsg;
```

**Screen additions:**

```typescript
// Add to Screen class

enableMouse(): void {
  process.stdout.write("\x1b[?1000h");  // Basic click reporting
  process.stdout.write("\x1b[?1002h");  // Drag reporting
  process.stdout.write("\x1b[?1006h");  // SGR extended mode (recommended)
}

disableMouse(): void {
  process.stdout.write("\x1b[?1006l");
  process.stdout.write("\x1b[?1002l");
  process.stdout.write("\x1b[?1000l");
}
```

**Mouse event parsing — add to input tokenizer:**

SGR mouse sequences follow the pattern: `\x1b[<Cb;Cx;Cym` (release) or `\x1b[<Cb;Cx;CyM` (press/motion).

**Important:** Mouse events must bypass the `keys: string[]` array. The existing contract produces simple key-name strings (`"Up"`, `"F1"`, `"a"`). Pushing serialized JSON into that array would break `toKeyMsg()`. Instead, add a parallel `mouseEvents: MouseMsg[]` to the tokenizer output and handle mouse messages through a separate code path in `Input`.

```typescript
// Extend TerminalInputTokens with mouse events
export interface TerminalInputTokens {
  readonly keys: string[];
  readonly mouseEvents: MouseMsg[];  // parallel output for mouse
  readonly pending: string;
}

// In the tokenizer, before checking escapeSequenceMap:
// Check for SGR mouse sequence: \x1b[< digits ; digits ; digits M/m
const mouseMatch = remaining.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
if (mouseMatch) {
  const cb = parseInt(mouseMatch[1]!, 10);
  const col = parseInt(mouseMatch[2]!, 10) - 1;  // Convert 1-based to 0-based
  const row = parseInt(mouseMatch[3]!, 10) - 1;
  const isRelease = mouseMatch[4] === "m";

  const button = cb & 3;        // Bits 0-1: button (0=left, 1=middle, 2=right, 3=none/motion)
  const shift = !!(cb & 4);     // Bit 2: shift
  const meta = !!(cb & 8);      // Bit 3: meta/alt
  const ctrl = !!(cb & 16);     // Bit 4: ctrl
  const isMotion = !!(cb & 32); // Bit 5: motion
  // Scroll detection: mask out modifier bits (bits 2-5), check for button 4/5
  // This correctly detects Shift+Scroll (68/69), Ctrl+Scroll (80/81), etc.
  const isScroll = (cb & 0x43) === 0x40 || (cb & 0x43) === 0x41;
  // For scroll, determine direction from the base button value
  const scrollDir = (cb & 0x43) === 0x40 ? "scroll_up" : "scroll_down";

  let action: MouseAction;
  if (isScroll) {
    action = scrollDir as MouseAction;
  } else if (isMotion) {
    action = "motion";
  } else if (isRelease) {
    action = "release";
  } else {
    action = "press";
  }

  const buttonName: MouseButton =
    isScroll ? "none" :
    button === 0 ? "left" :
    button === 1 ? "middle" :
    button === 2 ? "right" :
    "none";

  mouseEvents.push({
    type: "mouse",
    action,
    button: buttonName,
    row,
    col,
    shift,
    ctrl,
    meta,
  });
  index += mouseMatch[0].length;
  continue;
}
```

**Step-by-step implementation:**

1. Add `MouseMsg` type to `src/frontend/frontends/types.ts` (or `src/steep/types.ts`)
2. Add `mouseEvents: MouseMsg[]` to `TerminalInputTokens` (and `SteepInputTokens`)
3. Add `enableMouse()` / `disableMouse()` to `Screen` class
4. Call `screen.enableMouse()` in `Input.start()` (after enabling raw mode)
5. Call `screen.disableMouse()` in `Input.stop()`
6. Add SGR mouse parsing to `tokenizeTerminalInput()` (before the `escapeSequenceMap` lookup, since mouse sequences start with `\x1b[<`) — push to `mouseEvents`, NOT to `keys`
7. Add a separate `onMouse(handler)` callback on `Input`, or have `handleData` dispatch mouse events to the same handler alongside key events (with a discriminated union `KeyMsg | MouseMsg`)
8. Update the event handler in `index.ts` to handle `MouseMsg` alongside `KeyMsg`

**Verification:**
- Unit test: feed `\x1b[<0;10;5M` to tokenizer, verify `mouseEvents[0]` is `{ type: "mouse", action: "press", button: "left", row: 4, col: 9 }`
- Unit test: feed `\x1b[<64;1;1M` (scroll up), verify `action: "scroll_up"`
- Unit test: feed `\x1b[<68;1;1M` (Shift+Scroll up, cb=68), verify `action: "scroll_up", shift: true`
- Manual: open tmax, click in the buffer area, verify cursor moves to clicked position
- Manual: scroll mouse wheel, verify viewport scrolls

---

### Gap 6: No Cursor Styling

**What Bubble Tea does:** Supports cursor styles — block, underline, bar — and blinking variants.

**What Assam does:** Only `hideCursor()` and `showCursor()`. tmax renders its own block cursor via ANSI inverse video in the buffer renderer.

**Impact:** Low. The custom ANSI inverse cursor works. Native cursor styling would be cleaner.

**Effort:** Small (~20 lines in screen.ts).

**Target API:**

```typescript
// Add to Screen class

type CursorStyle = "block" | "underline" | "bar";

setCursorStyle(style: CursorStyle, blink?: boolean): void {
  const blinkCodes = { block: "\x1b[1 q", underline: "\x1b[3 q", bar: "\x1b[5 q" };
  const steadyCodes = { block: "\x1b[2 q", underline: "\x1b[4 q", bar: "\x1b[6 q" };
  const codes = blink ? blinkCodes : steadyCodes;
  process.stdout.write(codes[style]);
}
```

**Step-by-step implementation:**

1. Add `CursorStyle` type and `setCursorStyle()` method to `Screen` class
2. Call `screen.setCursorStyle("block", false)` on alt screen enter (steady block cursor)
3. Optionally: switch to bar cursor in insert mode, block in normal mode (tmax-specific, not framework)

**Verification:**
- Manual: verify cursor style changes when calling the method

---

### Gap 7: No Sub-Model Composition

**What Bubble Tea does:** Supports composing programs from sub-models via `tea.Batch` (run multiple programs concurrently) and embedding child models. Each sub-model has its own init/update/view.

**What Assam does:** Monolithic render function. Tab bar, buffer area, status line, minibuffer — all rendered inline in one closure.

**Impact:** Medium for Assam as a framework. Low for tmax's current needs.

**Effort:** Large. Depends on Gap 1.

**Status: Design incomplete.** The message routing mechanism is unresolved. The parent `update()` needs to decide which child component receives each Msg, but the current `Component` interface has no `matches()` predicate or msg-type declaration. This requires a follow-up design before implementation. Options:
- (a) Each component declares `handles: string[]` — a list of `msg.type` values it accepts. Parent matches by type.
- (b) Each component implements `accepts(msg: Msg): boolean` — a predicate for arbitrary matching.
- (c) Convention: parent manually routes by msg type in its own update, no framework support.

Option (c) is simplest and what Bubble Tea effectively does (Go type switches). Recommend (c) for the initial implementation, with (b) as a future enhancement if the component count grows.

**Target API:**

```typescript
// src/steep/component.ts

/** A Component is a self-contained sub-program with its own model, update, and view. */
interface Component<T, M extends Msg> {
  init(): { model: T; cmds?: Cmd[] };
  update(msg: M, model: T): { model: T; cmds?: Cmd[] };
  view(model: T, width: number): string[];
}

/** Embed a component in a region of the screen. */
function embed<T, M extends Msg>(
  component: Component<T, M>,
  region: { row: number; col: number; width: number; height: number },
): EmbeddedComponent<T, M>;

interface EmbeddedComponent<T, M extends Msg> {
  /** Forward a message to this component if it matches. */
  update(msg: M): { model: T; cmds?: Cmd[] };
  /** Render the component's view into the allocated region. */
  render(): string[];
}
```

**Step-by-step implementation:**

1. Create `src/steep/component.ts`
2. Implement `Component` interface and `embed()` helper
3. `embed()` wraps the component, passing width from the region, clipping view output to region height
4. In tmax's Assam adapter, define components for: tab bar, buffer area, status line, minibuffer
5. The parent update/view delegates to child components
6. Message routing (option c): parent update checks msg.type manually and forwards to the appropriate child component's update()

**Verification:**
- Unit test: create two simple components, embed them, verify rendering is composed correctly
- Verify tmax still renders correctly with component-based architecture

---

### Gap 8: No Resize Msg

**What Bubble Tea does:** Window resize produces a `WindowSizeMsg` with explicit width/height, delivered through Update.

**What Assam does:** Resize calls a callback that imperatively updates the editor and re-renders via a side-channel (lines 83-88 of `index.ts`).

**Impact:** Medium. Works correctly but bypasses the normal message flow.

**Effort:** Trivial once Gap 1 is solved.

**Target API:**

```typescript
interface WindowResizeMsg {
  type: "window-resize";
  width: number;
  height: number;
}
```

**Step-by-step implementation:**

1. Add `WindowResizeMsg` to types
2. In `AssamProgram`, replace the resize callback with: create `WindowResizeMsg`, feed through `update()`
3. Remove the separate resize→render side-channel

**Verification:**
- Manual: resize terminal, verify rendering updates correctly
- Verify resize flows through update (add a console.log in update for debugging)

---

### Gap 9: No Tick/Timer Commands

**What Bubble Tea does:** `tea.Tick(duration, func)` delivers a Msg after a delay. `tea.Every(interval, func)` delivers Msgs on a recurring interval.

**What Assam does:** No timer infrastructure. Timeouts are handled in T-Lisp.

**Impact:** Medium. Timers enable animations, debouncing, auto-save, which-key timeout.

**Effort:** Small (~50 lines) once Gap 3 (Cmd system) exists.

**This gap is solved by Gap 3's Cmd system.** The `Tick` and `Every` Cmd constructors (defined in Gap 3) are the implementation. No additional code needed beyond what Gap 3 provides.

**Verification:**
- See Gap 3 verification tests

---

### Gap 10: No Render Batching/Coalescing

**What Bubble Tea does:** Batches multiple Msgs processed in the same tick into a single render pass.

**What Assam does:** Every keypress triggers `render()` immediately. No batching.

**Impact:** Low in practice (keyboard input is inherently serial). Would matter with mouse motion events or programmatic Msg bursts.

**Effort:** Small (~30 lines) once Gap 1 is solved.

**Design constraint:** The `Update` type in Gap 1 is synchronous (`(msg, model) => { model, cmds }`). This is intentional — update must be synchronous for batching to work. tmax's current `editor.handleKey()` is async, but this is handled by the adapter: the adapter calls `await editor.handleKey()` in the input handler (which is async), then enqueues a synthetic Msg with the resulting state. The actual `update()` function only does synchronous state derivation from that Msg. This keeps the batching contract clean: all Msgs in a synchronous batch are processed synchronously, then rendered once. When RFC-009 Phase 2 lands (setter closures → return-state), handleKey becomes synchronous and the async adapter becomes unnecessary.

**Target API:**

```typescript
// Inside AssamProgram

private msgQueue: Msg[] = [];
private renderScheduled: boolean = false;

/** Enqueue a message for processing. Multiple msgs enqueued in the same
 *  synchronous block are batched into a single render. */
enqueueMsg(msg: Msg): void {
  this.msgQueue.push(msg);
  if (!this.renderScheduled) {
    this.renderScheduled = true;
    queueMicrotask(() => {
      this.processQueue();
      this.renderScheduled = false;
    });
  }
}

private processQueue(): void {
  while (this.msgQueue.length > 0) {
    const msg = this.msgQueue.shift()!;
    const { model, cmds } = this.update(msg, this.model);
    this.model = model;
    this.processCmds(cmds);
  }
  // Single render after all msgs processed
  this.renderView();
}
```

**Step-by-step implementation:**

1. Add `msgQueue` and `renderScheduled` fields to `AssamProgram`
2. Replace direct `update() → render()` calls with `enqueueMsg()`
3. Use `queueMicrotask()` to batch — all Msgs enqueued synchronously are processed before the next render
4. `processQueue()` drains the queue, calling synchronous update for each Msg, then renders once at the end
5. For tmax's async input handler: the handler awaits `editor.handleKey()`, then enqueues a Msg with the result — the await yields, but enqueueMsg is called synchronously after the await resolves

**Verification:**
- Unit test: enqueue 5 Msgs synchronously, verify `view()` is called exactly once
- Manual: rapid typing should not cause flicker

---

## What Assam Doesn't Need

Not every Bubble Tea feature maps directly to TypeScript/Assam:

1. **Go-specific concurrency** — Bubble Tea uses goroutines and channels. Assam uses async/await and event callbacks. The concurrency model is different by design, but the capabilities are equivalent.

2. **Subprocess exec as a core Cmd** — Bubble Tea has `tea.ExecProcess`. In tmax, subprocess execution (shell-command, async-shell-command, compile) belongs in T-Lisp. If Assam later needs first-class exec for non-tmax apps, it can be added as a Cmd adapter without changing the core.

3. **ANSI writer abstraction (deferred)** — Bubble Tea has `lipgloss.Writer` for custom ANSI output targets. Assam currently writes directly to stdout. This would be useful for testing (capture output to a buffer) and for tmax's existing headless frame capture (`src/render/capture-frame.ts`). Defer until the diff renderer needs an abstraction over write targets.

## Estimated Scope

| Gap | Description | Priority | Effort | Depends on | Est. Lines | New File(s) |
|---|---|---|---|---|---|---|
| 1 | Elm architecture separation | High | Large | — | ~400 | `src/steep/assam.ts` + adapter |
| 2 | Diff-based rendering | High | Medium | — | ~100 | `src/steep/renderer.ts` |
| 5 | Mouse support | High | Medium | — | ~170 | modifies `screen.ts`, `input.ts`, `types.ts` |
| 3 | Cmd system (async side effects) | High | Large | Gap 1 | ~200 | `src/steep/cmd.ts` |
| 4 | Complete key parsing | Medium | Medium | — | ~200 | modifies `input-tokenizer.ts`, `types.ts` |
| 7 | Sub-model composition | Medium | Large | Gap 1 | ~250 | `src/steep/component.ts` |
| 8 | Resize as Msg | Medium | Trivial | Gap 1 | ~20 | modifies `assam.ts` |
| 9 | Tick/timer commands | Medium | Small | Gap 3 | ~0 | included in `cmd.ts` (Gap 3) |
| 6 | Cursor styling | Low | Small | — | ~20 | modifies `screen.ts` |
| 10 | Render batching | Low | Small | Gap 1 | ~30 | modifies `assam.ts` |
| | | | | **New code** | **~1,390** | |
| | | | | **Tests** | **~550** | 6 test files |
| | | | | **Adapter + migration** | **~200** | import updates, adapter |
| | | | | **Grand total** | **~2,140** | |

### Recommended sequence

**First pass (immediate quality wins — can ship independently):**

1. **Gap 2 — Diff-based rendering** (~100 lines)
   - Create `src/steep/renderer.ts` with `DiffRenderer` class
   - Remove `screen.clear()` from render loop
   - Verify: type in tmax, no flicker
   - Test file: `test/unit/renderer.test.ts`

2. **Gap 5 — Mouse support** (~150 lines)
   - Add `MouseMsg` type, `enableMouse()`/`disableMouse()` to Screen
   - Add SGR mouse parsing to input tokenizer
   - Verify: click in tmax buffer, cursor moves to position
   - Test file: `test/unit/mouse.test.ts`

3. **Gap 4 — Complete key parsing** (~200 lines)
   - Expand `escapeSequenceMap` with F-keys, Home/End, modifier combos
   - Add bracketed paste mode
   - Update `KeyMsg` interface with new fields
   - Verify: press F1-F12, verify they register
   - Test file: `test/unit/input-tokenizer.test.ts`

4. **Gap 6 — Cursor styling** (~20 lines)
   - Add `setCursorStyle()` to Screen
   - Verify: call with different styles, observe cursor change

**Second pass (architectural foundation — incremental, not Big Bang):**

5. **Gap 1 — Elm architecture separation** (~400 lines, including adapter)
   - **Phase A: Thin wrapper.** Create `src/steep/assam.ts` with `AssamProgram`, `Init`, `Update`, `View` types. Write a thin adapter that wraps the existing `SteepFrontend` with zero behavior change — init calls `editor.start()`, update calls `editor.handleKey()`, view calls the existing render functions. Verify: `bun run typecheck` + `bun test` pass, editor behaves identically. Ship this as a checkpoint.
   - **Phase B: View extraction.** Move render logic from the closure into a standalone `view(EditorState) => Frame` function. Cursor positioning moves into the Frame return. Verify: still identical behavior.
   - Test file: `test/unit/assam.test.ts`
   - **RFC-009 integration:** After Gap 1 Phase A ships, RFC-009 Phase 1 (registries into state) can proceed in parallel. The adapter's `update` calls `editor.handleKey()` which will use the updated `EditorState` with registry fields. No adapter changes needed — registries moving into state is transparent to the adapter.

6. **Gap 3 — Cmd system** (~200 lines)
   - Create `src/steep/cmd.ts` with `Cmd`, `Tick`, `Every`, `AsyncCmd`, `Batch`, `None`
   - Integrate into `AssamProgram` (execute cmds after update, feed results back as Msgs)
   - Verify: Tick Cmd fires, AsyncCmd resolves, result Msg arrives in update
   - Test file: `test/unit/cmd.test.ts`
   - **RFC-009 note:** Building the Cmd system here enables RFC-009 Phase 4 (async → Cmd) later. The Cmd system is Steep-layer infrastructure — it must be generic, not tmax-specific.

7. **Gap 8 — Resize as Msg** (~20 lines)
   - Add `WindowResizeMsg` type
   - Replace resize callback with Msg dispatch
   - Verify: resize flows through update

8. **Gap 9 — Tick/timer commands** (~0 lines)
   - Already implemented in Gap 3's `Tick` and `Every` constructors
   - Verify: timer tests pass

**Third pass (framework completeness):**

9. **Gap 7 — Sub-model composition** (~250 lines)
   - Create `src/steep/component.ts` with `Component`, `embed()`
   - Refactor tmax's render into components (tab bar, buffer, status line, minibuffer)
   - Verify: rendering identical to before refactor
   - Test file: `test/unit/component.test.ts`

10. **Gap 10 — Render batching** (~30 lines)
    - Add `enqueueMsg()` with `queueMicrotask()` batching to `AssamProgram`
    - Verify: 5 Msgs enqueued synchronously → 1 render call
    - Test file: add to `test/unit/assam.test.ts`

### Total test files to create

| Test file | Tests |
|---|---|
| `test/unit/renderer.test.ts` | DiffRenderer: unchanged rows not written, changed rows written, invalidate clears state |
| `test/unit/mouse.test.ts` | SGR parse: click, release, scroll, drag, shift/ctrl modifiers |
| `test/unit/input-tokenizer.test.ts` | F-keys, Home/End, modifier combos, bracketed paste, focus events |
| `test/unit/assam.test.ts` | Init/update/view cycle, Cmd processing, resize msg, render batching |
| `test/unit/cmd.test.ts` | Tick fires, Every fires repeatedly, AsyncCmd resolves, Batch runs all |
| `test/unit/component.test.ts` | Embed renders in region, message routing to child, clipped output |

## Design Decisions

1. **Assam is not Bubble Tea.** The goal is parity of capability, not identical API. Assam uses TypeScript idioms (async/await, closures, union types) rather than Go idioms (interfaces, goroutines, channels).

2. **Steep is a product, not an internal detail.** Per the [technical vision](../technical-vision.md), Steep will become its own standalone library. Assam's API must be generic — no tmax-specific types, no editor assumptions. Generic abstractions (Component, Cmd, Msg) are designed for composability because that's the product Steep sells. tmax is Steep's pressure test — if a tmax feature requires a Steep workaround, that's a bug in Steep.

3. **Elm purity is the long-term goal, pursued incrementally.** Per RFC-009, the init/update/view separation currently wraps `editor.handleKey()` which mutates T-Lisp state. This is an acknowledged temporary state. RFC-009 defines a phased path: registries into state, setter closures to return-state, then persistent T-Lisp environments. The Assam API (`Update`, `Init`, `View`) is designed for pure functions — the internals will shift from mutation to state-returning as RFC-009 phases land, without API changes.

4. **Diff rendering first.** Gap 2 is a standalone improvement that can be shipped immediately. Gap 1 requires restructuring the entire frontend. Do the easy win first.

5. **Mouse is high priority.** Every modern terminal supports mouse. Click-to-position, scroll-to-navigate, and select-to-highlight are expected editor behaviors. Frameworks without mouse support are incomplete. Ship mouse in the first pass alongside diff rendering and key parsing.

6. **Cmd system is essential.** The Cmd system is the async backbone of the Elm architecture. Without it, Update can't describe side effects — they leak into imperative code. tmax's Emacs-parity roadmap (HTTP requests, async shell commands, network protocols, real-time collaboration) all flow through Cmds. Design it early, even if the initial implementation only covers timers and file I/O. Note: RFC-009 Phase 4 (async → Cmd) defers moving tmax's async operations into Cmds until the Cmd system is built. Gap 3 in this RFC builds the Cmd system; RFC-009 Phase 4 migrates tmax's usage.

7. **SGR mouse mode only.** Use `\x1b[?1006h` (SGR extended mode). It supports large terminals (>223 columns), reports release events, and is supported by all modern terminals (xterm, iTerm2, Terminal.app, Windows Terminal, Alacritty, Kitty). Don't implement X10 or UTF-8 mouse modes.

8. **queueMicrotask for batching.** Use `queueMicrotask()` for render batching (Gap 10) rather than `setImmediate()` (not standard) or `setTimeout(0)` (adds unnecessary delay). `queueMicrotask` runs before the next render, after all synchronous Msgs are enqueued.

## Review Notes

Issues identified during review and how they were addressed:

| Issue | Severity | Resolution |
|-------|----------|------------|
| `Msg = Record<string, unknown>` too loose — no discriminant for narrowing | High | Changed to `interface Msg { type: string; [key: string]: unknown }` enforcing `type` field |
| `Every()` recurrence model hand-waved — `setInterval` leaks | High | Specified stateless recurrence via `setTimeout` + re-emit from `update()` |
| Mouse events pushed as JSON strings into `keys[]` — breaks `toKeyMsg()` | High | Added parallel `mouseEvents: MouseMsg[]` to tokenizer output |
| Scroll detection `cb === 64 \|\| cb === 65` misses modifier+scroll | Medium | Changed to `(cb & 0x43) === 0x40 \|\| (cb & 0x43) === 0x41` to mask modifier bits |
| Trailing row clearing with spaces inherits ANSI colors | Medium | Changed to `screen.clearRow()` using `\x1b[K` |
| `Batch()` returns bare array — callers must flatten | Medium | Changed to return single `Cmd` with `type: "batch"`, program unpacks |
| Gap 7 message routing unspecified | Medium | Marked design incomplete; recommended convention-based routing (option c) |
| Gap 10 `processQueue` assumes sync `update` but tmax has async `handleKey` | High | Made `update` sync by contract; async work in adapter, then enqueue Msg |
| Gap 1 cursor position not in `View` return | High | Changed `View` return to `Frame { lines, cursor }` |
| "Framework first" claimed without justification | Medium | Reversed per technical vision: "Steep is a product, not an internal detail" — generic APIs are the product |
| Elm purity claimed but `handleKey()` mutates state | High | Acknowledged as temporary; RFC-009 defines phased path to full purity |
| Line count estimate ~1,270 too low | Medium | Updated to ~2,140 including tests (~550), adapter (~200), and import migration |
| Gap 1 recommended as Big Bang | Medium | Split into Phase A (thin wrapper, zero behavior change) and Phase B (view extraction) |
