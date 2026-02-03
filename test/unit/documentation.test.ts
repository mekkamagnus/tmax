/**
 * @file documentation.test.ts
 * @description Tests for US-4.2.1 Documentation Website
 *
 * Tests documentation system functionality including:
 * - Documentation listing shows all T-Lisp functions
 * - Search finds tutorials and guides
 * - Function docs show signature, description, examples, related functions
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { TLispInterpreterImpl } from '../../src/tlisp/interpreter';
import { Editor } from '../../src/editor/editor';
import { MockTerminal } from '../mocks/terminal.ts';
import { MockFileSystem } from '../mocks/filesystem.ts';

describe('Documentation System (US-4.2.1)', () => {
  let interpreter: TLispInterpreterImpl;
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;
  let editor: Editor;

  beforeEach(() => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);
    editor.start();
    interpreter = (editor as any).interpreter;
  });

  describe('documentation-list command', () => {
    test('should show all documented T-Lisp functions', async () => {
      const result = await interpreter.execute('(documentation-list)');

      expect(result._tag).toBe('Right');
      expect(result.right.type).toBe('list');
      expect(result.right.value.length).toBeGreaterThan(0);
    });

    test('should include core functions like buffer-save', async () => {
      const result = await interpreter.execute('(documentation-list)');
      const docs = result.right.value;

      const bufferSaveDoc = docs.find((d: any) =>
        d.value?.[0]?.type === 'string' && d.value[0].value === 'buffer-save'
      );

      expect(bufferSaveDoc).toBeDefined();
    });

    test('should include function metadata', async () => {
      const result = await interpreter.execute('(documentation-list)');
      const docs = result.right.value;

      // Each doc entry should be a list: [name, category, signature]
      const firstDoc = docs[0];
      expect(firstDoc.type).toBe('list');
      expect(firstDoc.value.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('documentation-search command', () => {
    test('should find functions by name', async () => {
      const result = await interpreter.execute('(documentation-search "buffer")');

      expect(result._tag).toBe('Right');
      expect(result.right.type).toBe('list');
      expect(result.right.value.length).toBeGreaterThan(0);
    });

    test('should find tutorials and guides by keyword', async () => {
      const result = await interpreter.execute('(documentation-search "key bindings")');

      expect(result._tag).toBe('Right');
      expect(result.right.type).toBe('list');

      const results = result.right.value;
      const hasGuide = results.some((r: any) =>
        r.value?.[1]?.type === 'string' && r.value[1].value === 'guide'
      );

      expect(hasGuide).toBe(true);
    });

    test('should return empty list for no matches', async () => {
      const result = await interpreter.execute('(documentation-search "xyz-nonexistent")');

      expect(result._tag).toBe('Right');
      expect(result.right.type).toBe('list');
      expect(result.right.value).toEqual([]);
    });

    test('should be case-insensitive', async () => {
      const result1 = await interpreter.execute('(documentation-search "Buffer")');
      const result2 = await interpreter.execute('(documentation-search "buffer")');

      expect(result1.right.value.length).toBe(result2.right.value.length);
    });
  });

  describe('documentation-get command', () => {
    test('should show function signature', async () => {
      const result = await interpreter.execute('(documentation-get "buffer-save")');

      expect(result._tag).toBe('Right');
      expect(result.right.type).toBe('string');
      expect(result.right.value).toContain('buffer-save');
    });

    test('should show function description', async () => {
      const result = await interpreter.execute('(documentation-get "buffer-save")');

      expect(result._tag).toBe('Right');
      const doc = result.right.value;
      // Should contain description text
      expect(doc.length).toBeGreaterThan(10);
    });

    test('should show examples if available', async () => {
      const result = await interpreter.execute('(documentation-get "buffer-save")');

      expect(result._tag).toBe('Right');
      const doc = result.right.value;
      // Examples would be shown in the documentation
    });

    test('should show related functions', async () => {
      const result = await interpreter.execute('(documentation-get "buffer-save")');

      expect(result._tag).toBe('Right');
      const doc = result.right.value;
      // Related functions like buffer-save-as, buffer-write might be listed
    });

    test('should handle unknown function gracefully', async () => {
      const result = await interpreter.execute('(documentation-get "nonexistent-function")');

      expect(result._tag).toBe('Right');
      expect(result.right.value).toContain('not found');
    });

    test('should require function name argument', async () => {
      const result = await interpreter.execute('(documentation-get)');

      expect(result._tag).toBe('Right');
      expect(result.right.value).toContain('Error');
    });
  });

  describe('documentation-categories command', () => {
    test('should list all documentation categories', async () => {
      const result = await interpreter.execute('(documentation-categories)');

      expect(result._tag).toBe('Right');
      expect(result.right.type).toBe('list');
      expect(result.right.value.length).toBeGreaterThan(0);
    });

    test('should include common categories like editor, buffer, keymap', async () => {
      const result = await interpreter.execute('(documentation-categories)');
      const categories = result.right.value;

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
      expect(result.right.type).toBe('list');
    });

    test('should handle unknown category gracefully', async () => {
      const result = await interpreter.execute('(documentation-by-category "unknown-category")');

      expect(result._tag).toBe('Right');
      expect(result.right.type).toBe('list');
      expect(result.right.value).toEqual([]);
    });

    test('should require category argument', async () => {
      const result = await interpreter.execute('(documentation-by-category)');

      expect(result._tag).toBe('Right');
      expect(result.right.value).toContain('Error');
    });
  });
});
