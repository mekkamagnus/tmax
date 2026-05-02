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

describe('Plugin Submission (US-4.1.2)', () => {
  let interpreter: TLispInterpreterImpl;
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;
  let editor: Editor;

  beforeEach(async () => {
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);
    editor.start();
    interpreter = (editor as any).interpreter;

    // Clear any existing submissions before each test
    await interpreter.execute('(plugin-clear-submissions)');
  });

  describe('plugin-submit command', () => {
    test('should submit plugin for review', async () => {
      const result = await interpreter.execute(
        '(plugin-submit "test-plugin" "Test description" "Test Author")'
      );

      expect(result._tag).toBe('Right');
      expect(result.right.type).toBe('string');
      expect(result.right.value).toContain('submitted for review');
    });

    test('should require plugin name', async () => {
      const result = await interpreter.execute('(plugin-submit)');

      expect(result._tag).toBe('Right');
      expect(result.right.value).toContain('Error');
    });

    test('should require description', async () => {
      const result = await interpreter.execute('(plugin-submit "test-plugin")');

      expect(result._tag).toBe('Right');
      expect(result.right.value).toContain('Error');
    });

    test('should require author', async () => {
      const result = await interpreter.execute('(plugin-submit "test-plugin" "description")');

      expect(result._tag).toBe('Right');
      expect(result.right.value).toContain('Error');
    });

    test('should validate plugin name format', async () => {
      const result = await interpreter.execute(
        '(plugin-submit "Invalid Name!" "description" "author")'
      );

      expect(result._tag).toBe('Right');
      expect(result.right.value).toContain('Error');
    });

    test('should check for duplicate plugin names', async () => {
      // Try to submit with existing plugin name
      const result = await interpreter.execute(
        '(plugin-submit "theme-solarized" "Duplicate" "author")'
      );

      expect(result._tag).toBe('Right');
      expect(result.right.value).toContain('already exists');
    });
  });

  describe('plugin-review-list command', () => {
    test('should list pending submissions', async () => {
      // Submit a plugin first
      await interpreter.execute(
        '(plugin-submit "pending-plugin" "description" "author")'
      );

      const result = await interpreter.execute('(plugin-review-list)');

      expect(result._tag).toBe('Right');
      expect(result.right.type).toBe('list');
      expect(result.right.value.length).toBeGreaterThan(0);
    });

    test('should show empty list when no submissions', async () => {
      const result = await interpreter.execute('(plugin-review-list)');

      expect(result._tag).toBe('Right');
      expect(result.right.type).toBe('list');
      expect(result.right.value).toEqual([]);
    });
  });

  describe('plugin-approve command', () => {
    test('should approve plugin submission', async () => {
      // Submit a plugin first
      await interpreter.execute(
        '(plugin-submit "approvable-plugin" "description" "author")'
      );

      const result = await interpreter.execute('(plugin-approve "approvable-plugin")');

      expect(result._tag).toBe('Right');
      expect(result.right.type).toBe('string');
      expect(result.right.value).toContain('approved');
    });

    test('should add approved plugin to repository', async () => {
      // Submit and approve
      await interpreter.execute(
        '(plugin-submit "new-approved-plugin" "Test" "Author")'
      );
      await interpreter.execute('(plugin-approve "new-approved-plugin")');

      // Check it appears in plugin-list
      const listResult = await interpreter.execute('(plugin-list)');
      const plugins = listResult.right.value;

      const found = plugins.find((p: any) =>
        p.value?.[0]?.type === 'string' && p.value[0].value === 'new-approved-plugin'
      );

      expect(found).toBeDefined();
    });

    test('should handle non-existent plugin', async () => {
      const result = await interpreter.execute('(plugin-approve "nonexistent")');

      expect(result._tag).toBe('Right');
      expect(result.right.value).toContain('not found');
    });

    test('should require plugin name argument', async () => {
      const result = await interpreter.execute('(plugin-approve)');

      expect(result._tag).toBe('Right');
      expect(result.right.value).toContain('Error');
    });
  });

  describe('plugin-reject command', () => {
    test('should reject plugin submission', async () => {
      // Submit a plugin first
      await interpreter.execute(
        '(plugin-submit "rejectable-plugin" "description" "author")'
      );

      const result = await interpreter.execute('(plugin-reject "rejectable-plugin" "Quality issues")');

      expect(result._tag).toBe('Right');
      expect(result.right.type).toBe('string');
      expect(result.right.value).toContain('rejected');
    });

    test('should not add rejected plugin to repository', async () => {
      // Submit and reject
      await interpreter.execute(
        '(plugin-submit "rejected-plugin" "description" "author")'
      );
      await interpreter.execute('(plugin-reject "rejected-plugin" "Not ready")');

      // Check it does NOT appear in plugin-list
      const listResult = await interpreter.execute('(plugin-list)');
      const plugins = listResult.right.value;

      const found = plugins.find((p: any) =>
        p.value?.[0]?.type === 'string' && p.value[0].value === 'rejected-plugin'
      );

      expect(found).toBeUndefined();
    });

    test('should require rejection reason', async () => {
      await interpreter.execute(
        '(plugin-submit "test-plugin" "description" "author")'
      );

      const result = await interpreter.execute('(plugin-reject "test-plugin")');

      expect(result._tag).toBe('Right');
      expect(result.right.value).toContain('Error');
    });
  });

  describe('Submission state persistence', () => {
    test('should maintain submission state across operations', async () => {
      // Submit plugin
      await interpreter.execute(
        '(plugin-submit "state-test-plugin" "description" "author")'
      );

      // Check it's in review list
      const reviewResult = await interpreter.execute('(plugin-review-list)');
      expect(reviewResult.right.value.length).toBeGreaterThan(0);

      // Approve it
      await interpreter.execute('(plugin-approve "state-test-plugin")');

      // Should no longer be in review list
      const afterReviewResult = await interpreter.execute('(plugin-review-list)');
      const stillPending = afterReviewResult.right.value.find(
        (p: any) => p.value?.[0]?.value === 'state-test-plugin'
      );
      expect(stillPending).toBeUndefined();

      // But should be in main repository
      const listResult = await interpreter.execute('(plugin-list)');
      const found = listResult.right.value.find((p: any) =>
        p.value?.[0]?.type === 'string' && p.value[0].value === 'state-test-plugin'
      );
      expect(found).toBeDefined();
    });
  });
});
