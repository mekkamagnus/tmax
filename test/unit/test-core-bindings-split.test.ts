/**
 * @file test-core-bindings-split.test.ts
 * @description Test that core binding files are loaded correctly and key bindings work as expected
 */

import { describe, test, beforeEach, afterEach } from "bun:test";
import { expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

describe("Core Binding Files Loading", () => {
  let editor: Editor;
  let mockTerminal: MockTerminal;
  let mockFileSystem: MockFileSystem;

  beforeEach(() => {
    mockTerminal = new MockTerminal();
    mockFileSystem = new MockFileSystem();
    // Load the actual content of the binding files
    mockFileSystem.files.set("src/tlisp/core/bindings/normal.tlisp",
`;; normal.tlisp
;; Default key bindings for normal mode in tmax editor
;;
;; This file contains all default key bindings for normal mode, extracted from TypeScript
;; to achieve pure T-Lisp-centric key binding management.
;;
;; Maintainer guidance:
;; - Each (key-bind) call defines a key, command, and optional mode
;; - Commands are T-Lisp expressions that get executed when keys are pressed
;; - Mode is specified as "normal" for all bindings in this file
;; - Keep bindings organized by functional groups for readability

;; =================================================================
;; BASIC NAVIGATION (Normal Mode)
;; =================================================================
;; Vim-style hjkl movement keys

;; Move cursor left (h)
(key-bind "h" "(cursor-move (cursor-line) (- (cursor-column) 1))" "normal")

;; Move cursor down (j)
(key-bind "j" "(cursor-move (+ (cursor-line) 1) (cursor-column))" "normal")

;; Move cursor up (k)
(key-bind "k" "(cursor-move (- (cursor-line) 1) (cursor-column))" "normal")

;; Move cursor right (l)
(key-bind "l" "(cursor-move (cursor-line) (+ (cursor-column) 1))" "normal")

;; =================================================================
;; MODE SWITCHING
;; =================================================================
;; Transition between editor modes

;; Enter insert mode from normal mode (i)
(key-bind "i" "(editor-set-mode \"insert\")" "normal")

;; Enter command mode from normal mode (:)
(key-bind ":" "(editor-enter-command-mode)" "normal")

;; =================================================================
;; APPLICATION CONTROL
;; =================================================================
;; Global application control commands

;; Quit editor from normal mode (q)
(key-bind "q" "(editor-quit)" "normal")

;; =================================================================
;; M-X SYSTEM (Emacs-style)
;; =================================================================
;; Two-key sequence: SPC ; to activate M-x mode

;; Handle space key - first part of SPC ; sequence
(key-bind " " "(editor-handle-space)" "normal")

;; Handle semicolon key - second part of SPC ; sequence
(key-bind ";" "(editor-handle-semicolon)" "normal")`);

    mockFileSystem.files.set("src/tlisp/core/bindings/insert.tlisp",
`;; insert.tlisp
;; Default key bindings for insert mode in tmax editor
;;
;; This file contains all default key bindings for insert mode, extracted from TypeScript
;; to achieve pure T-Lisp-centric key binding management.
;;
;; Maintainer guidance:
;; - Each (key-bind) call defines a key, command, and optional mode
;; - Commands are T-Lisp expressions that get executed when keys are pressed
;; - Mode is specified as "insert" for all bindings in this file
;; - Keep bindings organized by functional groups for readability

;; =================================================================
;; MODE SWITCHING
;; =================================================================
;; Transition between editor modes

;; Return to normal mode from insert mode (Escape)
(key-bind "Escape" "(editor-set-mode \"normal\")" "insert")

;; =================================================================
;; BASIC EDITING (Insert Mode)
;; =================================================================
;; Essential editing operations in insert mode
;; Note: Enter and Backspace are handled directly in editor.ts for proper escaping`);

    mockFileSystem.files.set("src/tlisp/core/bindings/command.tlisp",
`;; command.tlisp
;; Default key bindings for command mode in tmax editor
;;
;; This file contains all default key bindings for command mode, extracted from TypeScript
;; to achieve pure T-Lisp-centric key binding management.
;;
;; Maintainer guidance:
;; - Each (key-bind) call defines a key, command, and optional mode
;; - Commands are T-Lisp expressions that get executed when keys are pressed
;; - Mode is specified as "command" for all bindings in this file
;; - Keep bindings organized by functional groups for readability

;; =================================================================
;; COMMAND MODE BINDINGS
;; =================================================================
;; Key bindings specific to command mode

;; Exit command mode (Escape)
(key-bind "Escape" "(editor-exit-command-mode)" "command")

;; Execute command line (Enter)
(key-bind "Enter" "(editor-execute-command-line)" "command")

;; =================================================================
;; APPLICATION CONTROL
;; =================================================================
;; Global application control commands

;; Quit editor from command mode (q)
(key-bind "q" "(editor-quit)" "command")`);

    mockFileSystem.files.set("src/tlisp/core/bindings/visual.tlisp",
`;; visual.tlisp
;; Default key bindings for visual mode in tmax editor
;;
;; This file contains all default key bindings for visual mode, extracted from TypeScript
;; to achieve pure T-Lisp-centric key binding management.
;;
;; Maintainer guidance:
;; - Each (key-bind) call defines a key, command, and optional mode
;; - Commands are T-Lisp expressions that get executed when keys are pressed
;; - Mode is specified as "visual" for all bindings in this file
;; - Keep bindings organized by functional groups for readability

;; =================================================================
;; VISUAL MODE BINDINGS
;; =================================================================
;; Key bindings specific to visual mode

;; Exit visual mode (Escape)
(key-bind "Escape" "(editor-set-mode \"normal\")" "visual")

;; Delete selected text (d)
(key-bind "d" "(delete-selection)" "visual")

;; Yank selected text (y)
(key-bind "y" "(yank-selection)" "visual")

;; Change selected text (c)
(key-bind "c" "(change-selection)" "visual")`);

    mockFileSystem.files.set("~/.tmaxrc", `(key-bind "C-c C-c" "(custom-command)" "normal")`); // Custom binding
    editor = new Editor(mockTerminal, mockFileSystem);
  });

  afterEach(() => {
    editor.stop();
  });

  test("should load normal mode bindings from normal.tlisp", async () => {
    await editor.start();

    const keyMappings = editor.getKeyMappings();
    const hMappings = keyMappings.get("h");

    expect(hMappings).toBeDefined();
    expect(hMappings?.length).toBe(1);
    expect(hMappings![0].command).toBe("(cursor-move (cursor-line) (- (cursor-column) 1))");
    expect(hMappings![0].mode).toBe("normal");
  });

  test("should load insert mode bindings from insert.tlisp", async () => {
    await editor.start();

    const keyMappings = editor.getKeyMappings();
    const escapeMappings = keyMappings.get("Escape");

    // Find the escape mapping for insert mode
    const insertEscapeMapping = escapeMappings?.find(m => m.mode === "insert");

    expect(insertEscapeMapping).toBeDefined();
    expect(insertEscapeMapping!.command).toBe("(editor-set-mode \"normal\")");
    expect(insertEscapeMapping!.mode).toBe("insert");
  });

  test("should load visual mode bindings from visual.tlisp", async () => {
    await editor.start();

    const keyMappings = editor.getKeyMappings();
    const escapeMappings = keyMappings.get("Escape");

    // Find the escape mapping for visual mode
    const visualEscapeMapping = escapeMappings?.find(m => m.mode === "visual");

    expect(visualEscapeMapping).toBeDefined();
    expect(visualEscapeMapping!.command).toBe("(editor-set-mode \"normal\")");
    expect(visualEscapeMapping!.mode).toBe("visual");
  });

  test("should load command mode bindings from command.tlisp", async () => {
    await editor.start();

    const keyMappings = editor.getKeyMappings();
    const escapeMappings = keyMappings.get("Escape");

    // Find the escape mapping for command mode
    const commandEscapeMapping = escapeMappings?.find(m => m.mode === "command");

    expect(commandEscapeMapping).toBeDefined();
    expect(commandEscapeMapping!.command).toBe("(editor-exit-command-mode)");
    expect(commandEscapeMapping!.mode).toBe("command");
  });

  test("should load custom bindings from ~/.tmaxrc that can override defaults", async () => {
    await editor.start();

    const keyMappings = editor.getKeyMappings();
    const customMappings = keyMappings.get("C-c C-c");

    expect(customMappings).toBeDefined();
    expect(customMappings?.length).toBe(1);
    expect(customMappings![0].command).toBe("(custom-command)");
    expect(customMappings![0].mode).toBe("normal");
  });

  test("should load all four binding files", async () => {
    await editor.start();

    const keyMappings = editor.getKeyMappings();

    // Check that we have bindings from all modes
    const hMappings = keyMappings.get("h"); // From normal.tlisp
    const escapeInsertMappings = keyMappings.get("Escape")?.find(m => m.mode === "insert"); // From insert.tlisp
    const escapeVisualMappings = keyMappings.get("Escape")?.find(m => m.mode === "visual"); // From visual.tlisp
    const escapeCommandMappings = keyMappings.get("Escape")?.find(m => m.mode === "command"); // From command.tlisp

    expect(hMappings).toBeDefined();
    expect(escapeInsertMappings).toBeDefined();
    expect(escapeVisualMappings).toBeDefined();
    expect(escapeCommandMappings).toBeDefined();
  });

  test("should handle missing binding files gracefully", async () => {
    // Create editor with missing binding files
    const mockFileSystemMissing = new MockFileSystem();
    const editorMissing = new Editor(mockTerminal, mockFileSystemMissing);

    // This should not throw an error, but use fallback bindings
    await editorMissing.start();

    // Editor should still be running
    expect(editorMissing.isRunning()).toBe(true);

    editorMissing.stop();
  });
});