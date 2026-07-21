import { Editor } from "../../src/editor/editor.ts";
import { afterEach } from "bun:test";
import type { TerminalIO } from "../../src/core/contracts/terminal.ts";
import type { FileSystem } from "../../src/core/contracts/filesystem.ts";
import type { TLispValue } from "../../src/tlisp/types.ts";
import { Either, type Either as EitherValue } from "../../src/utils/task-either.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EditorAPIContext } from "../../src/editor/runtime/editor-api-context.ts";
import type { TextBuffer } from "../../src/core/contracts/buffer.ts";
import { initialModel } from "../../src/editor/functional/model.ts";
import type { EditorModel } from "../../src/editor/functional/model.ts";
import { update } from "../../src/editor/functional/index.ts";
import { createEditorSession, createEditorSessionState } from "../../src/editor/functional/domain-state.ts";
import { createEditorRuntimeCaches } from "../../src/editor/runtime/caches.ts";

/**
 * Options for {@link createTestAPIContext}. The fixture holds a real
 * `EditorModel`; `currentBuffer` / `buffers` overrides seed that model.
 */
export interface TestAPIContextOptions {
  /** Seed buffer for `model.currentBuffer` (also inserted into `buffers` as "default"). */
  currentBuffer?: TextBuffer;
  /** Seed buffer registry (defaults to a fresh empty Map; "default" is added if `currentBuffer` is set). */
  buffers?: Map<string, TextBuffer>;
}

/**
 * Test-only extras layered onto {@link EditorAPIContext} so legacy tests that
 * previously read/wrote mutable bridge fields can seed and observe model
 * state through a typed surface. These members do NOT exist on the production
 * `EditorAPIContext` (AC2.6) — they are test-infrastructure projections over
 * the model held by the fixture.
 */
export interface TestAPIContext extends EditorAPIContext {
  /** Live mutable buffer registry (the same Map the model holds). Seed/observe here. */
  readonly buffers: Map<string, TextBuffer>;
  /** Direct model read (alias for `access.getModel()`). */
  getModel(): EditorModel;
  /** Seed `model.currentBuffer` directly (test setup). */
  setCurrentBufferDirect(buffer: TextBuffer): void;
  /** Seed `model.statusMessage` directly (test setup/observation). */
  setStatusMessage(message: string): void;
  /** Seed `model.lastCommand` directly (test setup). */
  setLastCommand(command: string): void;
}

/**
 * CHORE-44 Change 2 — build a real `EditorAPIContext` for direct
 * `createEditorAPI` unit tests. Backed by a genuine `EditorModel`: reads go
 * through `access.getModel()` and writes go through `applyUpdate(msg)` (which
 * runs the pure reducer) or the four side-effectful methods (which, for the
 * fixture, delegate to the reducer since there are no tabs/windows/metadata
 * to sync). No mutable bridge fields — AC2.6.
 *
 * The returned handle includes the {@link TestAPIContext} test-only members
 * (`buffers`, `getModel`, `setStatusMessage`, `setLastCommand`,
 * `setCurrentBufferDirect`) so existing tests can seed and observe state
 * without re-introducing bridge properties on the production context.
 */
export function createTestAPIContext(options: TestAPIContextOptions = {}): TestAPIContext {
  const buffers = options.buffers ?? new Map<string, TextBuffer>();
  let model: EditorModel = {
    ...initialModel(),
    buffers,
    currentBuffer: options.currentBuffer,
  };

  const ctx: EditorAPIContext = {
    access: {
      getModel: () => model,
      applyModel: (m) => { model = m; },
    },
    session: createEditorSession(createEditorSessionState()),
    caches: createEditorRuntimeCaches(),
    terminal: new MockTerminal(),
    filesystem: new MockFileSystem(),
    applyUpdate: (msg) => { model = update(model, msg).model; },
    // The fixture has no tabs/windows/bufferMetadata, so the side-effectful
    // methods reduce to plain model commits via applyUpdate.
    setCurrentBuffer: (buffer) => {
      model = update(model, { type: "SetCurrentBuffer", buffer: buffer ?? undefined }).model;
    },
    setCursorLine: (line) => {
      model = update(model, { type: "SetCursorPosition", position: { ...model.cursorPosition, line } }).model;
    },
    setCursorColumn: (column) => {
      model = update(model, { type: "SetCursorPosition", position: { ...model.cursorPosition, column } }).model;
    },
    setCurrentFilename: (filename) => {
      model = update(model, { type: "SetCurrentFilename", filename }).model;
    },
    getSpacePressed: () => false,
    setSpacePressed: () => { /* no-op: fixture has no leader-key state */ },
  };

  // Test-only projections over the model. These are layered on AFTER the
  // EditorAPIContext object so the production context shape (AC2.6) is the
  // authoritative surface handed to `createEditorAPI`.
  const testCtx: TestAPIContext = {
    ...ctx,
    get buffers() { return buffers; },
    getModel: () => model,
    setCurrentBufferDirect: (buffer) => { model = { ...model, currentBuffer: buffer }; },
    setStatusMessage: (message) => { model = { ...model, statusMessage: message }; },
    setLastCommand: (command) => { model = { ...model, lastCommand: command }; },
  };
  return testCtx;
}



/**
 * CHORE-44 Change 12 — Options for {@link createEditorFixture}.
 *
 * Every field is optional; defaults give the common case (real mocks, real
 * core bindings, started editor, deterministic cleanup). Tests with specific
 * setup intent express it through these options rather than ad-hoc
 * `new Editor(...)` construction (AC12.3).
 */
export interface EditorFixtureOptions {
  /** Seed text for the editor's first test buffer (created via `createBuffer`). */
  readonly initialContent?: string;
  /** Name of the seed buffer (defaults to "test"). */
  readonly bufferName?: string;
  /** Inject a custom `TerminalIO` (defaults to a fresh `MockTerminal`). */
  readonly terminal?: TerminalIO;
  /** Inject a custom `FileSystem` (defaults to a fresh `MockFileSystem`). */
  readonly filesystem?: FileSystem;
  /** Custom init-file path passed as the Editor's third constructor arg. */
  readonly initFilePath?: string;
  /** Whether to call `editor.start()` (defaults to `true`). Set `false` for
   *  constructor-only / error-path tests, or when a test needs to mutate
   *  per-instance state (e.g. which-key timeout) before startup. */
  readonly start?: boolean;
  /** Whether `start()` should load real core bindings (defaults to `true`).
   *  When `false`, the fixture skips `start()` entirely — `Editor.start()` is
   *  monolithic and always loads bindings, so the only faithful way to test
   *  missing/failing binding behavior is to either keep `start: false` and
   *  exercise the constructor, or inject a `filesystem` option whose reads
   *  fail so the editor falls back to the minimal built-in keymap. */
  readonly loadRealCoreBindings?: boolean;
  /** Whether `dispose()` should clean up the per-editor which-key timer handle
   *  (defaults to `true`). Per-handle only — never broad listener removal
   *  (BUG-16). Set `false` only for tests that assert on post-dispose handle
   *  state. */
  readonly disposeTimeouts?: boolean;
}

/**
 * CHORE-44 Change 12 — the handle returned by {@link createEditorFixture}.
 *
 * `terminal` and `filesystem` are the exact dependencies the editor was
 * constructed with (the same instances tests used to seed files or queue
 * keys), so existing setup code keeps working. `dispose()` is idempotent.
 */
export interface EditorFixture {
  readonly editor: Editor;
  readonly terminal: TerminalIO;
  readonly filesystem: FileSystem;
  /** Execute T-Lisp through the editor's public interpreter boundary, failing
   *  the test on Left. */
  readonly executeTlisp: (expression: string) => TLispValue;
  /** Stop the editor and clean up per-editor handles (which-key timer).
   *  Idempotent; safe to call from `afterEach` or `try/finally`. Does NOT use
   *  broad `removeAllListeners` (BUG-16). */
  readonly dispose: () => void;
}

/** Compatibility fixtures returned as bare editors cannot expose dispose().
 * Keep their handles until Bun's per-test teardown so legacy callers receive
 * the same deterministic lifecycle as explicit createEditorFixture users. */
const compatibilityFixtures = new Set<EditorFixture>();

afterEach(() => {
  for (const fixture of compatibilityFixtures) fixture.dispose();
  compatibilityFixtures.clear();
});

/** Isolate the SPEC-055 log file per editor instance so tail-load never reads
 *  the developer's real ~/.config/tmax/messages.log AND never carries entries
 *  from a prior test in the same file (each editor gets its own empty log). */
function isolatedLogPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "tmax-test-log-"));
  return join(dir, "messages.log");
}

/**
 * CHORE-44 Change 12 — the single construction + cleanup path for editor
 * tests. Injects terminals, filesystems, init files, startup mode, and
 * binding behavior; returns a deterministic dispose handle (AC12.2).
 *
 * Behavior:
 *  - sets `TMAX_LOG_PATH` to a fresh isolated directory (per-editor log);
 *  - constructs `new Editor(terminal, filesystem, initFilePath?)`;
 *  - unless `start: false`, awaits `editor.start()` (which loads core
 *    bindings via the real `BindingRuntime` policy);
 *  - when `initialContent` is provided, creates a buffer named
 *    `bufferName ?? "test"` with that content;
 *  - `dispose()` calls `editor.stop()` and, unless `disposeTimeouts: false`,
 *    deactivates the per-editor which-key handle (clearing its timer). No
 *    broad listener removal — BUG-16 compliant.
 */
export async function createEditorFixture(options: EditorFixtureOptions = {}): Promise<EditorFixture> {
  const start = options.start ?? true;
  const loadRealCoreBindings = options.loadRealCoreBindings ?? true;
  const shouldStart = start && loadRealCoreBindings;

  process.env.TMAX_LOG_PATH = isolatedLogPath();

  const terminal: TerminalIO = options.terminal ?? new MockTerminal();
  const filesystem: FileSystem = options.filesystem ?? new MockFileSystem();
  const editor = new Editor(terminal, filesystem, options.initFilePath);

  if (shouldStart) {
    await editor.start();
  }

  if (options.initialContent !== undefined) {
    editor.createBuffer(options.bufferName ?? "test", options.initialContent);
  }

  let disposed = false;
  const disposeTimeouts = options.disposeTimeouts ?? true;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (disposeTimeouts) {
      // Per-handle cleanup only — see BUG-16. The which-key handle owns a
      // single setTimeout; deactivate() clears it. No process/socket
      // listener removal happens here.
      try {
        editor.getWhichKeyHandle().deactivate();
      } catch {
        // The handle is constructed in the Editor ctor and always present;
        // guard defensively in case a future code path restructures this.
      }
    }
    editor.stop();
  };

  const executeTlisp = (expression: string): TLispValue => {
    return expectRight(editor.getInterpreter().execute(expression), `T-Lisp failed: ${expression}`);
  };

  return { editor, terminal, filesystem, executeTlisp, dispose };
}

/**
 * Convenience wrapper for the common case: a started editor with real core
 * bindings and optional seed content. Delegates to {@link createEditorFixture}
 * so it inherits the same deterministic cleanup contract (AC12.2).
 *
 * Returns the bare `Editor` for backward compatibility with existing callers;
 * tests that need `dispose()` should call {@link createEditorFixture} instead.
 */
export async function createStartedEditor(content?: string): Promise<Editor> {
  const fixture = await createEditorFixture({ initialContent: content });
  compatibilityFixtures.add(fixture);
  return fixture.editor;
}

/** Return the successful value or fail the test immediately. */
export function expectRight<L, R>(result: EitherValue<L, R>, message: string = "Expected Right"): R {
  if (Either.isLeft(result)) {
    throw new Error(`${message}: ${String(result.left)}`);
  }
  return result.right;
}

/** Return the failed value or fail the test immediately. */
export function expectLeft<L, R>(result: EitherValue<L, R>, message: string = "Expected Left"): L {
  if (Either.isRight(result)) {
    throw new Error(`${message}: received Right`);
  }
  return result.left;
}

/** Return a present value or fail the test immediately. */
export function expectDefined<T>(value: T | null | undefined, message: string = "Expected defined value"): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

/** Return a T-Lisp list value or fail the test immediately. */
export function expectTlispList(value: TLispValue, message: string = "Expected T-Lisp list"): TLispValue[] {
  if (value.type !== "list" || !Array.isArray(value.value)) {
    throw new Error(`${message}: received ${value.type}`);
  }
  return value.value as TLispValue[];
}

/** Return a T-Lisp string value or fail the test immediately. */
export function expectTlispString(value: TLispValue, message: string = "Expected T-Lisp string"): string {
  if (value.type !== "string" || typeof value.value !== "string") {
    throw new Error(`${message}: received ${value.type}`);
  }
  return value.value;
}

/** Return a T-Lisp number value or fail the test immediately. */
export function expectTlispNumber(value: TLispValue, message: string = "Expected T-Lisp number"): number {
  if (value.type !== "number" || typeof value.value !== "number") {
    throw new Error(`${message}: received ${value.type}`);
  }
  return value.value;
}

/** Return a T-Lisp boolean value or fail the test immediately. */
export function expectTlispBoolean(value: TLispValue, message: string = "Expected T-Lisp boolean"): boolean {
  if (value.type !== "boolean" || typeof value.value !== "boolean") {
    throw new Error(`${message}: received ${value.type}`);
  }
  return value.value;
}

/** Return current buffer text or fail the test immediately. */
export function bufferText(editor: Editor): string {
  const buffer = editor.getState().currentBuffer;
  if (!buffer) {
    throw new Error("Expected a current buffer");
  }
  return expectRight(buffer.getContent(), "Expected current buffer content");
}

/** Execute T-Lisp through the editor's public interpreter boundary. */
export function executeTlisp(editor: Editor, expression: string): TLispValue {
  return expectRight(editor.getInterpreter().execute(expression), `T-Lisp failed: ${expression}`);
}

/** Return the visible text for a T-Lisp-owned minibuffer row. */
export function minibufferRowText(row: { segments: { text: string }[] }): string {
  return row.segments.map(segment => segment.text).join("");
}

/** Move the cursor through the public T-Lisp editor boundary. */
export function moveCursor(editor: Editor, line: number, column: number): void {
  executeTlisp(editor, `(cursor-move ${line} ${column})`);
}
