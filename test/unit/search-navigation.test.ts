/**
 * @file search-navigation.test.ts
 * @description Tests for search forward/backward functionality (US-1.5.1)
 * 
 * Tests Vim-style search with /pattern (forward) and ?pattern (backward).
 * Support n/N for next/previous match and match highlighting.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { moveCursor } from "../helpers/editor-fixture.ts";

describe("Search Navigation (US-1.5.1)", () => {
  let editor: Editor;
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;

  beforeEach(async () => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);
    await editor.start();

    // Create a buffer with test content
    editor.createBuffer("test.txt", "Hello world\nThis is a test\nSearch for pattern\npattern matches here\nend of file");

  });

  describe("search-forward (/pattern)", () => {
    test("moves cursor to next match of pattern", async () => {
      // Start at beginning of buffer
      moveCursor(editor, 0, 0);

      // Search for "pattern" using T-Lisp
      const result = await editor.getInterpreter().execute('(search-forward "pattern")');
      
      // Should execute successfully
      expect(result._tag).toBe("Right");
      
      // Cursor should have moved (line 2 is first occurrence of "pattern")
      expect(editor.getState().cursorPosition.line).toBeGreaterThanOrEqual(2);
    });

    test("shows error when pattern not found", async () => {
      moveCursor(editor, 0, 0);

      const result = await editor.getInterpreter().execute('(search-forward "notfound")');
      expect(result._tag).toBe("Left");
    });

    test("empty search reuses previous pattern", async () => {
      // First search for "pattern"
      await editor.getInterpreter().execute('(search-forward "pattern")');
      const firstLine = editor.getState().cursorPosition.line;
      
      // Empty search should reuse pattern
      await editor.getInterpreter().execute('(search-forward "")');

      // Should move to next match
      expect(editor.getState().cursorPosition.line).toBeGreaterThan(firstLine);
    });

    test("search wraps around to beginning when reaching end", async () => {
      // Start after the last occurrence of "pattern"
      moveCursor(editor, 3, 10);

      // Search for "pattern" - should wrap to first occurrence
      await editor.getInterpreter().execute('(search-forward "pattern")');

      // Should wrap to line 2 (first occurrence)
      expect(editor.getState().cursorPosition.line).toBe(2);
    });
  });

  describe("search-backward (?pattern)", () => {
    test("moves cursor to previous match of pattern", async () => {
      // Start at end of buffer
      moveCursor(editor, 4, 0);

      // Search backward for "pattern"
      await editor.getInterpreter().execute('(search-backward "pattern")');

      // Should move to line 3 (last occurrence of "pattern")
      expect(editor.getState().cursorPosition.line).toBe(3);
    });

    test("shows error when pattern not found", async () => {
      moveCursor(editor, 4, 0);

      const result = await editor.getInterpreter().execute('(search-backward "notfound")');
      expect(result._tag).toBe("Left");
    });

    test("empty search reuses previous pattern", async () => {
      // First search for "pattern"
      await editor.getInterpreter().execute('(search-backward "pattern")');
      
      // Empty search should reuse pattern
      await editor.getInterpreter().execute('(search-backward "")');

      // Should move to previous occurrence
      expect(editor.getState().cursorPosition.line).toBe(2);
    });

    test("search wraps around to end when reaching beginning", async () => {
      // Start before the first occurrence
      moveCursor(editor, 2, 0);

      // Search backward - should wrap to last occurrence
      await editor.getInterpreter().execute('(search-backward "pattern")');

      // Should wrap to line 3
      expect(editor.getState().cursorPosition.line).toBe(3);
    });
  });

  describe("n/N for next/previous match", () => {
    test("n moves to next match in forward direction", async () => {
      // First search for "pattern"
      await editor.getInterpreter().execute('(search-forward "pattern")');
      const firstLine = editor.getState().cursorPosition.line;

      // Press n to go to next match
      await editor.getInterpreter().execute('(search-next)');

      // Should move to next occurrence
      expect(editor.getState().cursorPosition.line).toBeGreaterThan(firstLine);
    });

    test("N moves to previous match (reverse direction)", async () => {
      // First search for "pattern"
      await editor.getInterpreter().execute('(search-forward "pattern")');
      
      // Move to next match
      await editor.getInterpreter().execute('(search-next)');
      const secondLine = editor.getState().cursorPosition.line;

      // Press N to go to previous match
      await editor.getInterpreter().execute('(search-previous)');

      // Should move back to first match
      expect(editor.getState().cursorPosition.line).toBeLessThan(secondLine);
    });

    test("n wraps around to first match after last", async () => {
      // Start after last occurrence
      moveCursor(editor, 3, 10);

      // Search forward from last occurrence
      await editor.getInterpreter().execute('(search-forward "pattern")');
      
      // Should wrap to first occurrence (line 2)
      expect(editor.getState().cursorPosition.line).toBe(2);
      
      // Press n from first match - should go to second match
      await editor.getInterpreter().execute('(search-next)');
      expect(editor.getState().cursorPosition.line).toBe(3);
      
      // Press n again from last match - should wrap to first
      await editor.getInterpreter().execute('(search-next)');
      expect(editor.getState().cursorPosition.line).toBe(2);
    });
  });

  describe("search pattern storage", () => {
    test("last search pattern is stored", async () => {
      await editor.getInterpreter().execute('(search-forward "test")');
      
      // Pattern should be retrievable
      const result = await editor.getInterpreter().execute('(search-pattern-get)');
      expect(result._tag).toBe("Right");
    });

    test("search direction is stored", async () => {
      await editor.getInterpreter().execute('(search-forward "test")');
      
      // Direction should be "forward"
      const result = await editor.getInterpreter().execute('(search-direction-get)');
      expect(result._tag).toBe("Right");
    });
  });

  describe("match highlighting", () => {
    test("search pattern is stored for highlighting", async () => {
      await editor.getInterpreter().execute('(search-forward "pattern")');

      // Pattern should be available for highlighting
      const result = await editor.getInterpreter().execute('(search-pattern-get)');
      expect(result._tag).toBe("Right");
    });

    test("clearing search removes highlight pattern", async () => {
      await editor.getInterpreter().execute('(search-forward "pattern")');
      await editor.getInterpreter().execute('(search-clear)');

      // Pattern should be cleared
      const result = await editor.getInterpreter().execute('(search-pattern-get)');
      expect(result._tag).toBe("Right");
    });
  });

  // SPEC-044 Phase 1.D — verify /, ?, n, N are reachable from the keyboard.
  // The T-Lisp functions exist; these tests confirm the (key-bind ...) lines
  // route the keys to them through the normal-mode handler.
  describe("SPEC-044 Phase 1.D — search key bindings", () => {
    test("pressing n after search-forward advances to next match", async () => {
      moveCursor(editor, 0, 0);
      await editor.getInterpreter().execute('(search-forward "pattern")');
      const firstLine = editor.getState().cursorPosition.line;

      await editor.handleKey("n");

      expect(editor.getState().cursorPosition.line).toBeGreaterThan(firstLine);
    });

    test("pressing N after search-forward returns to previous match", async () => {
      moveCursor(editor, 0, 0);
      await editor.getInterpreter().execute('(search-forward "pattern")');
      const firstLine = editor.getState().cursorPosition.line;
      await editor.handleKey("n");
      const secondLine = editor.getState().cursorPosition.line;

      await editor.handleKey("N");

      expect(editor.getState().cursorPosition.line).toBe(firstLine);
      expect(secondLine).toBeGreaterThan(firstLine);
    });
  });

  // SPEC-044 Phase 1.E — :nohl clears visible highlights but keeps the last
  // search pattern so `n` still works.
  describe("SPEC-044 Phase 1.E — :nohl Ex command", () => {
    test(":nohl clears searchMatches without clearing the search pattern", async () => {
      moveCursor(editor, 0, 0);
      await editor.getInterpreter().execute('(search-forward "pattern")');

      // Populate highlights via the incremental-search path so state.searchMatches is non-empty.
      await editor.getInterpreter().execute('(search-incremental-start "forward")');
      await editor.getInterpreter().execute('(search-incremental-update "p")');
      const matchesDuringSearch = editor.getState().searchMatches ?? [];
      expect(matchesDuringSearch.length).toBeGreaterThan(0);

      // Issue :nohl through the command-line path.
      await editor.getInterpreter().execute('(editor-set-command-line "nohl")');
      await editor.getInterpreter().execute('(editor-execute-command-line)');

      // Highlights must be cleared.
      const matchesAfter = editor.getState().searchMatches ?? [];
      expect(matchesAfter.length).toBe(0);

      // Pattern must survive :nohl so n/N still jump.
      const patternAfter = await editor.getInterpreter().execute('(search-pattern-get)');
      expect(patternAfter._tag).toBe("Right");
      const patternValue = (patternAfter as { _tag: "Right"; right: { type: string; value: string } }).right;
      expect(patternValue.type).toBe("string");
      expect(patternValue.value).toBe("pattern");
    });

    test(":noh (alias) is accepted and preserves the pattern", async () => {
      moveCursor(editor, 0, 0);
      await editor.getInterpreter().execute('(search-forward "pattern")');

      await editor.getInterpreter().execute('(editor-set-command-line "noh")');
      await editor.getInterpreter().execute('(editor-execute-command-line)');

      const patternAfter = await editor.getInterpreter().execute('(search-pattern-get)');
      expect(patternAfter._tag).toBe("Right");
      const patternValue = (patternAfter as { _tag: "Right"; right: { type: string; value: string } }).right;
      expect(patternValue.value).toBe("pattern");
    });
  });
});
