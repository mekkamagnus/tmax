# Chore: Interchangeable Frontend Framework (Ink + Steep)

## Chore Description

Refactor the frontend layer into a selectable, swappable renderer architecture with two implementations:

1. **Ink** — the existing React/Ink frontend (status quo)
2. **Steep** — a new Charm-for-JS direct ANSI renderer using the Elm Architecture

Both frontends share the same `Frontend` interface contract, the same pure render functions, and the same `Editor` class. Selection is via CLI flag (`--steep`). The Elm Architecture (init → update → view loop) becomes the canonical pattern for both frontends.

The key architectural change: `Editor.handleKey()` currently returns `void` and mutates internal state. To support proper Elm Architecture, `handleKey()` must return the new `EditorState` instead. This is a signature change that propagates to all callers, but does NOT change the logic inside handlers/API ops — they still mutate `stateAccess`, and we just read the result back.

## Relevant Files

### Existing Files to Modify

- **`src/editor/editor.ts`** — Core editor class. `handleKey()` signature changes from `Promise<void>` to `Promise<EditorState>`. `getEditorState()` remains for backward compat but is no longer the primary way to get state.
- **`src/frontend/types.ts`** — Becomes the `Frontend` interface definition. Currently holds React-specific types; will be replaced with renderer-agnostic types.
- **`src/frontend/ink-adapter.ts`** — InkTerminalIO adapter. Stays in place but gets wrapped by `InkFrontend` class.
- **`src/main.tsx`** — Entry point. Adds `--steep` flag parsing and frontend selection. Currently hardcodes React/Ink render path.
- **`src/frontend/input.ts`** — `splitInputForTlisp` utility. Shared by both frontends, moves to `src/frontend/render/`.

### New Files

- **`src/frontend/frontends/types.ts`** — `Frontend` interface, `KeyMsg` type, `TerminalDims` type
- **`src/frontend/frontends/ink/index.ts`** — `InkFrontend` class implementing `Frontend`. Wraps existing React/Ink render loop.
- **`src/frontend/frontends/steep/index.ts`** — `SteepFrontend` class implementing `Frontend`. Elm Architecture runtime.
- **`src/frontend/frontends/steep/screen.ts`** — Direct ANSI screen operations (~50 lines): alt screen, clear, writeAt, moveTo, cursor show/hide
- **`src/frontend/frontends/steep/input.ts`** — Raw stdin key normalization (~80 lines): raw mode, escape sequence parsing, KeyEvent → KeyMsg
- **`src/frontend/frontends/steep/style.ts`** — ANSI style wrappers (~40 lines): fg(), bg(), bold(), reset()
- **`src/frontend/render/buffer-lines.ts`** — Pure function: `EditorState + dims → styled string[]`
- **`src/frontend/render/status-line.ts`** — Pure function: `EditorState + width → styled string`
- **`src/frontend/render/command-input.ts`** — Pure function: `mode + text + cursor → styled string`

### Existing Files to Move (no content changes, path updates only)

- `src/frontend/components/*` → `src/frontend/frontends/ink/components/`
- `src/frontend/hooks/*` → `src/frontend/frontends/ink/hooks/`
- `src/frontend/ink-adapter.ts` → `src/frontend/frontends/ink/ink-adapter.ts`

## Step by Step Tasks

### Step 1: Define the Frontend interface

Create `src/frontend/frontends/types.ts`:

```typescript
import type { EditorState } from "../../core/types.ts";

export interface TerminalDims {
  width: number;
  height: number;
}

export interface KeyMsg {
  key: string;
  raw?: string;
  escape?: boolean;
  return?: boolean;
  backspace?: boolean;
  delete?: boolean;
}

export interface Frontend {
  run(editor: any, initialState: EditorState): Promise<void>;
}
```

This is the contract. Both InkFrontend and SteepFrontend implement `Frontend.run()`.

### Step 2: Change Editor.handleKey() to return EditorState

In `src/editor/editor.ts`:

- Change signature: `async handleKey(key: string): Promise<EditorState>`
- At the end of `handleKey()`, after the mode-specific dispatch and logging, add: `return this.state;`
- This is a minimal change — the method still mutates `this.state` internally (via handlers and API ops), but now returns it for the Elm Architecture pattern.
- `getEditorState()` stays for any legacy callers. No logic changes inside handlers, API ops, or the stateAccess proxy.
- Update callers in `src/frontend/frontends/ink/` and `src/editor/editor.ts` internal calls (macro replay) that currently do `await editor.handleKey(key)` without capturing the return.

Verify: all existing tests still pass. Callers that previously did:
```typescript
await editor.handleKey(key);
const state = editor.getEditorState();
```
can now do:
```typescript
const state = await editor.handleKey(key);
```
But the old pattern still works since `getEditorState()` returns `this.state`.

### Step 3: Extract shared render functions

Create three pure functions in `src/frontend/render/`:

**`buffer-lines.ts`:**
```typescript
export function renderBufferLines(
  state: EditorState,
  width: number,
  height: number
): string[]
```
Logic: extract from `BufferView.tsx` lines 31-117 (viewport calculation, line retrieval, cursor highlighting, `~` tildes). Returns array of ANSI-styled strings (no React, no JSX).

**`status-line.ts`:**
```typescript
export function renderStatusLine(
  state: EditorState,
  width: number
): string
```
Logic: extract from `StatusLine.tsx` lines 21-57. Returns single ANSI-styled string with mode label, cursor position, and status message.

**`command-input.ts`:**
```typescript
export function renderCommandInput(
  mode: EditorMode,
  text: string,
  cursorPos: number
): string
```
Logic: extract from `CommandInput.tsx` lines 158-174. Returns single ANSI-styled string with prompt and visual cursor block.

Each function uses the `style` helper from `steep/style.ts` to produce ANSI escape sequences. The Ink frontend can either: (a) strip ANSI codes and use `<Text>` props, or (b) have the shared functions return structured data (segments with text + style) that both frontends format differently. Option (b) is cleaner.

### Step 4: Move existing Ink frontend into subdirectory

Move (git mv):
- `src/frontend/components/` → `src/frontend/frontends/ink/components/`
- `src/frontend/hooks/` → `src/frontend/frontends/ink/hooks/`
- `src/frontend/ink-adapter.ts` → `src/frontend/frontends/ink/ink-adapter.ts`
- `src/frontend/input.ts` → `src/frontend/render/input.ts` (shared utility)

Update all import paths within moved files. No logic changes.

### Step 5: Create InkFrontend adapter

Create `src/frontend/frontends/ink/index.ts`:

```typescript
import type { Frontend } from "../types.ts";
import type { EditorState } from "../../../core/types.ts";

export class InkFrontend implements Frontend {
  async run(editor: any, initialState: EditorState): Promise<void> {
    // Delegate to existing React/Ink render loop
    // This wraps the current logic from main.tsx lines 366-428
    // enterFullScreen, render(<Editor ...>), waitUntilExit, exitFullScreen
  }
}
```

This class owns: enterFullScreen, React render, waitUntilExit, exitFullScreen. It reuses the existing `Editor.tsx` component unchanged.

### Step 6: Create Steep runtime modules

Create `src/frontend/frontends/steep/`:

**`screen.ts`** (~50 lines) — Direct ANSI terminal operations:
- `enterAltScreen()` / `exitAltScreen()`
- `clear()`
- `writeAt(row, col, text)`
- `moveTo(row, col)`
- `showCursor()` / `hideCursor()`
- `getDims(): TerminalDims`
- `onResize(cb)` — SIGWINCH handler

**`input.ts`** (~80 lines) — Raw mode stdin → KeyMsg:
- `start()` — enters raw mode on stdin
- `onKey(cb: (msg: KeyMsg) => void)` — emits normalized key events
- `stop()` — exits raw mode
- Handles escape sequences (arrow keys, function keys, etc.)
- Splits batched input into per-key events (reuse `splitInputForTlisp` from `render/input.ts`)

**`style.ts`** (~40 lines) — ANSI escape wrappers:
- `fg(text, color)` — `\x1b[38;5;{color}m{text}\x1b[0m`
- `bg(text, color)` — `\x1b[48;5;{color}m{text}\x1b[0m`
- `bold(text)` — `\x1b[1m{text}\x1b[22m`
- Named colors: green, yellow, magenta, cyan, blue, white, black, gray (map to 256-color codes)

### Step 7: Create SteepFrontend

Create `src/frontend/frontends/steep/index.ts`:

The Elm Architecture runtime:
```typescript
export class SteepFrontend implements Frontend {
  async run(editor: any, initialState: EditorState): Promise<void> {
    const screen = new Screen();
    const input = new Input();

    await editor.start();
    screen.enterAltScreen();
    screen.hideCursor();

    let state = initialState;

    const render = () => {
      const { width, height } = screen.getDims();
      const lines = renderBufferLines(state, width, height - 2);
      const cmd = (state.mode === 'command' || state.mode === 'mx')
        ? renderCommandInput(state.mode, state.commandLine || state.mxCommand, cursorPos)
        : null;
      const status = renderStatusLine(state, width);

      screen.clear();
      lines.forEach((line, i) => screen.writeAt(i, 0, line));
      if (cmd !== null) screen.writeAt(height - 2, 0, cmd);
      screen.writeAt(height - 1, 0, status);
      screen.moveTo(cursorRow, cursorCol);
    };

    input.onKey(async (msg: KeyMsg) => {
      state = await editor.handleKey(msg.key);  // update returns new state
      render();
    });

    screen.onResize(() => {
      editor.updateTerminalSize(screen.getDims().width, screen.getDims().height);
      render();
    });

    render(); // initial paint
  }
}
```

### Step 8: Wire up frontend selection in main.tsx

In `src/main.tsx`, replace the hardcoded Ink render path with:

```typescript
import { InkFrontend } from './frontend/frontends/ink/index.ts';
import { SteepFrontend } from './frontend/frontends/steep/index.ts';
import type { Frontend } from './frontend/frontends/types.ts';

const frontend: Frontend = args.includes('--steep')
  ? new SteepFrontend()
  : new InkFrontend();

await frontend.run(editor, initialState);
```

The `--steep` flag selects the direct ANSI frontend. Default remains Ink for backward compatibility. Also add `--steep` to the help text.

### Step 9: Update package.json scripts

Add convenience scripts:
```json
"steep": "node --import tsx src/main.tsx --steep",
"steep:dev": "node --import tsx src/main.tsx --steep --dev"
```

### Step 10: Validation

Run the full validation sequence (see Validation Commands below). Confirm:
- All existing unit tests pass (`handleKey` return value change doesn't break anything)
- `bun run start` still works (Ink frontend)
- `bun run steep` starts the editor with direct ANSI rendering
- Both frontends render the same visual output for the same state
- Type checking passes with zero errors

## Validation Commands

- `bunx tsc --noEmit` — Type check the entire project with zero errors
- `bun test` — Run full test suite, all tests pass
- `bun run start` — Verify Ink frontend still starts and accepts input (manual smoke test)
- `bun run steep` — Verify Steep frontend starts, renders buffer, status line, accepts hjkl input (manual smoke test)
- `grep -r "handleKey" src/ test/ | grep "Promise<void>"` — Confirm no callers still expect void return from handleKey
- `grep -r "from.*frontend/components" src/` — Confirm no stale import paths remain after move

## Notes

**Why handleKey returns state instead of void:** The Elm Architecture requires `update(msg, model) → model`. By returning the state, both frontends get a clean functional interface. The internal mutation pattern (stateAccess proxy) is an implementation detail that doesn't leak to the frontend layer.

**Why not refactor Editor to be fully immutable:** That would require changing ~104 `this.state.` mutations across editor.ts plus ~350 across api/*.ts. That's a separate chore. The return-value change is the minimal bridge to enable Elm Architecture without rewriting the entire editor.

**Steep is intentionally minimal:** ~250 lines total (screen + input + style + index). No virtual DOM, no reconciler, no component lifecycle. It proves the direct-ANSI approach works and can be extended later with layout helpers, diffing, etc.

**The shared render functions are the key abstraction:** Both frontends produce identical visual output because they call the same pure functions. The only difference is how those styled strings get to the screen — React/Ink reconciliation vs direct ANSI writes.

**Terminal resize handling:** Steep handles SIGWINCH directly in screen.ts. Ink handles it through React's useEffect + process.stdout 'resize' event. Both call `editor.updateTerminalSize()` and re-render.

**Render function output format:** The shared render functions should return structured data (array of `{text: string, style: StyleFlags}`) rather than ANSI strings directly. This lets Ink map to `<Text>` props and Steep map to ANSI codes, without either frontend needing to parse the other's format. A small `formatAnsi(segment[])` and `formatInkProps(segment[])` helper handles the conversion.
