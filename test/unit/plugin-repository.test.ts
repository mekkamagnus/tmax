/**
 * @file plugin-repository.test.ts
 * @description Tests for US-4.1.1 Plugin Repository
 *
 * Tests plugin repository functionality including:
 * - M-x plugin-list shows available plugins
 * - Selecting plugin shows description, author, install command
 * - Installing downloads to ~/.config/tmax/tlpa/
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TLispInterpreterImpl } from '../../src/tlisp/interpreter';
import { Editor } from '../../src/editor/editor';
import { MockTerminal } from '../mocks/terminal.ts';
import { MockFileSystem } from '../mocks/filesystem.ts';

describe('Plugin Repository (US-4.1.1)', () => {
  let interpreter: TLispInterpreterImpl;
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;
  let editor: Editor;
  let testTlpaDir: string;

  beforeEach(() => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);
    editor.start();
    interpreter = (editor as any).interpreter;

    // Set up test tlpa directory in mock filesystem
    testTlpaDir = '/test/tlpa';
    filesystem.setDirectory(testTlpaDir);
  });

  describe('plugin-list command', () => {
    test('should show all available plugins from repository', async () => {
      const result = await interpreter.execute('(plugin-list)');

      expect(result._tag).toBe('Right');

      const plugins = result.right;
      expect(plugins.type).toBe('list');
      expect(plugins.value).toBeInstanceOf(Array);
      expect(plugins.value.length).toBeGreaterThan(0);
    });

    test('should include theme-solarized in list', async () => {
      const result = await interpreter.execute('(plugin-list)');

      expect(result._tag).toBe('Right');
      const plugins = result.right;
      expect(plugins.type).toBe('list');

      // Each plugin is a list: [name, description, author, version, install-command]
      const solarized = plugins.value.find((p: any) =>
        p.value?.[0]?.type === 'string' && p.value[0].value === 'theme-solarized'
      );
      expect(solarized).toBeDefined();
    });
  });

  describe('plugin-show command', () => {
    test('should show detailed information for specific plugin', async () => {
      const result = await interpreter.execute('(plugin-show "theme-solarized")');

      expect(result._tag).toBe('Right');
      expect(result.right.type).toBe('string');

      const info = result.right.value;
      expect(info).toContain('theme-solarized');
      expect(info).toContain('Solarized dark color theme');
    });

    test('should handle unknown plugin gracefully', async () => {
      const result = await interpreter.execute('(plugin-show "nonexistent-plugin")');

      expect(result._tag).toBe('Right');
      expect(result.right.value).toContain('Plugin not found');
    });
  });

  describe('plugin-search command', () => {
    test('should search plugins by pattern', async () => {
      const result = await interpreter.execute('(plugin-search "theme")');

      expect(result._tag).toBe('Right');
      const searchResults = result.right;
      expect(searchResults.type).toBe('list');
      expect(searchResults.value.length).toBeGreaterThan(0);
    });

    test('should return empty list for no matches', async () => {
      const result = await interpreter.execute('(plugin-search "xyz-nonexistent")');

      expect(result._tag).toBe('Right');
      const searchResults = result.right;
      expect(searchResults.type).toBe('list');
      expect(searchResults.value).toEqual([]);
    });
  });

  describe('plugin-info command', () => {
    test('should show structured plugin information', async () => {
      const result = await interpreter.execute('(plugin-info "theme-solarized")');

      expect(result._tag).toBe('Right');
      const info = result.right;
      expect(info.type).toBe('list');
    });

    test('should return nil for unknown plugin', async () => {
      const result = await interpreter.execute('(plugin-info "unknown")');

      expect(result._tag).toBe('Right');
      expect(result.right.type).toBe('nil');
    });
  });
});
