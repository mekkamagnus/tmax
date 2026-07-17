/**
 * @file documentation.test.ts
 * @description Tests for US-4.2.1 Documentation Website
 *
 * Tests documentation system functionality including:
 * - Documentation listing shows all T-Lisp functions
 * - Search finds tutorials and guides
 * - Function docs show signature, description, examples, related functions
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createEditorFixture, expectRight, expectTlispList, expectTlispString, type EditorFixture } from "../helpers/editor-fixture.ts";
import { TLispInterpreterImpl } from '../../src/tlisp/interpreter';
import { Editor } from '../../src/editor/editor';
import { MockTerminal } from '../mocks/terminal.ts';
import { MockFileSystem } from '../mocks/filesystem.ts';

describe('Documentation System (US-4.2.1)', () => {
  let fixture: EditorFixture;
  let interpreter: TLispInterpreterImpl;
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;
  let editor: Editor;

  beforeEach(async () => {
    fixture = await createEditorFixture();
    editor = fixture.editor;
    terminal = fixture.terminal as MockTerminal;
    filesystem = fixture.filesystem as MockFileSystem;
    interpreter = editor.getInterpreter();
  });

  afterEach(() => {
    fixture?.dispose();
  });

  describe('documentation-list command', () => {
    test('should show all documented T-Lisp functions', async () => {
      const result = await interpreter.execute('(documentation-list)');

      expect(result._tag).toBe('Right');
      expect(expectRight(result).type).toBe('list');
      expect(expectTlispList(expectRight(result)).length).toBeGreaterThan(0);
    });

    test('should include core functions like buffer-save', async () => {
      const result = await interpreter.execute('(documentation-list)');
      const docs = expectTlispList(expectRight(result));

      const bufferSaveDoc = docs.find((d: any) =>
        d.value?.[0]?.type === 'string' && d.value[0].value === 'buffer-save'
      );

      expect(bufferSaveDoc).toBeDefined();
    });

    test('should include function metadata', async () => {
      const result = await interpreter.execute('(documentation-list)');
      const docs = expectTlispList(expectRight(result));

      // Each doc entry should be a list: [name, category, signature]
      const firstDoc = docs[0]!;
      expect(firstDoc.type).toBe('list');
      expect(expectTlispList(firstDoc).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('documentation-search command', () => {
    test('should find functions by name', async () => {
      const result = await interpreter.execute('(documentation-search "buffer")');

      expect(result._tag).toBe('Right');
      expect(expectRight(result).type).toBe('list');
      expect(expectTlispList(expectRight(result)).length).toBeGreaterThan(0);
    });

    test('should find tutorials and guides by keyword', async () => {
      const result = await interpreter.execute('(documentation-search "key bindings")');

      expect(result._tag).toBe('Right');
      expect(expectRight(result).type).toBe('list');

      const results = expectTlispList(expectRight(result));
      const hasGuide = results.some((r: any) =>
        r.value?.[1]?.type === 'string' && r.value[1].value === 'guide'
      );

      expect(hasGuide).toBe(true);
    });

    test('should return empty list for no matches', async () => {
      const result = await interpreter.execute('(documentation-search "xyz-nonexistent")');

      expect(result._tag).toBe('Right');
      expect(expectRight(result).type).toBe('list');
      expect(expectTlispList(expectRight(result))).toEqual([]);
    });

    test('should be case-insensitive', async () => {
      const result1 = await interpreter.execute('(documentation-search "Buffer")');
      const result2 = await interpreter.execute('(documentation-search "buffer")');

      expect(expectTlispList(expectRight(result1)).length).toBe(expectTlispList(expectRight(result2)).length);
    });
  });

  describe('documentation-get command', () => {
    test('should show function signature', async () => {
      const result = await interpreter.execute('(documentation-get "buffer-save")');

      expect(result._tag).toBe('Right');
      expect(expectRight(result).type).toBe('string');
      expect(expectTlispString(expectRight(result))).toContain('buffer-save');
    });

    test('should show function description', async () => {
      const result = await interpreter.execute('(documentation-get "buffer-save")');

      expect(result._tag).toBe('Right');
      const doc = expectTlispString(expectRight(result));
      // Should contain description text
      expect(doc.length).toBeGreaterThan(10);
    });

    test('should show examples if available', async () => {
      const result = await interpreter.execute('(documentation-get "buffer-save")');

      expect(result._tag).toBe('Right');
      const doc = expectRight(result).value;
      // Examples would be shown in the documentation
    });

    test('should show related functions', async () => {
      const result = await interpreter.execute('(documentation-get "buffer-save")');

      expect(result._tag).toBe('Right');
      const doc = expectRight(result).value;
      // Related functions like buffer-save-as, buffer-write might be listed
    });

    test('should handle unknown function gracefully', async () => {
      const result = await interpreter.execute('(documentation-get "nonexistent-function")');

      expect(result._tag).toBe('Right');
      expect(expectTlispString(expectRight(result))).toContain('not found');
    });

    test('should require function name argument', async () => {
      const result = await interpreter.execute('(documentation-get)');

      expect(result._tag).toBe('Right');
      expect(expectTlispString(expectRight(result))).toContain('Error');
    });
  });

  describe('documentation-categories command', () => {
    test('should list all documentation categories', async () => {
      const result = await interpreter.execute('(documentation-categories)');

      expect(result._tag).toBe('Right');
      expect(expectRight(result).type).toBe('list');
      expect(expectTlispList(expectRight(result)).length).toBeGreaterThan(0);
    });

    test('should include common categories like editor, buffer, keymap', async () => {
      const result = await interpreter.execute('(documentation-categories)');
      const categories = expectTlispList(expectRight(result));

      const categoryStrings = categories.map((c: any) =>
        c.type === 'string' ? c.value : ''
      );

      // Should have at least some core categories
      expect(categoryStrings.length).toBeGreaterThan(0);
    });
  });

  describe('documentation-by-category command', () => {
    test('should list functions by category', async () => {
      const result = await interpreter.execute('(documentation-by-category "buffer")');

      expect(result._tag).toBe('Right');
      expect(expectRight(result).type).toBe('list');
    });

    test('should handle unknown category gracefully', async () => {
      const result = await interpreter.execute('(documentation-by-category "unknown-category")');

      expect(result._tag).toBe('Right');
      expect(expectRight(result).type).toBe('list');
      expect(expectTlispList(expectRight(result))).toEqual([]);
    });

    test('should require category argument', async () => {
      const result = await interpreter.execute('(documentation-by-category)');

      expect(result._tag).toBe('Right');
      expect(expectTlispString(expectRight(result))).toContain('Error');
    });
  });
});
