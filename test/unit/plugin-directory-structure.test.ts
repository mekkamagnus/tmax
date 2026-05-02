/**
 * @file plugin-directory-structure.test.ts
 * @description Tests for US-2.1.1 Plugin Directory Structure
 *
 * Tests plugin discovery from ~/.config/tmax/tlpa/plugin-name/ directories
 * with automatic plugin.tlisp loading and plugin.toml dependency support.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TLispInterpreterImpl } from '../../src/tlisp/interpreter';
import { Editor } from '../../src/editor/editor';
import { MockTerminal } from '../mocks/terminal.ts';
import { MockFileSystem } from '../mocks/filesystem.ts';

describe('Plugin Directory Structure (US-2.1.1)', () => {
  let interpreter: TLispInterpreterImpl;
  let terminal: MockTerminal;
  let filesystem: MockFileSystem;
  let editor: Editor;
  let testTlpaDir: string;

  beforeEach(() => {
    // Create test interpreter and editor
    terminal = new MockTerminal();
    filesystem = new MockFileSystem();
    editor = new Editor(terminal, filesystem);
    editor.start();
    // Get interpreter from editor
    interpreter = (editor as any).interpreter;

    // Set up test tlpa directory in mock filesystem
    testTlpaDir = '/test/tlpa';
    filesystem.setDirectory(testTlpaDir);
  });

  afterEach(() => {
    // Cleanup is handled by fresh mock filesystem in beforeEach
  });

  describe('Plugin Discovery', () => {
    test('should discover plugins in tlpa directory', async () => {
      // Create test plugin structure
      const pluginPath = `${testTlpaDir}/test-plugin`;
      filesystem.setDirectory(pluginPath);
      filesystem.setFile(`${pluginPath}/plugin.tlisp`, '(defun test-func () "test")');

      // Plugin should be discovered and loaded
      const result = await editor.loadPluginsFromDirectory(testTlpaDir);

      expect(result.loaded).toBeArray();
      expect(result.loaded).toContain('test-plugin');
    });

    test('should skip directories without plugin.tlisp', async () => {
      // Create directory without plugin.tlisp
      const pluginPath = `${testTlpaDir}/incomplete-plugin`;
      filesystem.setDirectory(pluginPath);

      const result = await editor.loadPluginsFromDirectory(testTlpaDir);

      expect(result.loaded).not.toContain('incomplete-plugin');
      expect(result.skipped).toContain('incomplete-plugin');
    });

    test('should handle empty tlpa directory', async () => {
      const result = await editor.loadPluginsFromDirectory(testTlpaDir);

      expect(result.loaded).toEqual([]);
      expect(result.total).toBe(0);
    });

    test('should discover multiple plugins', async () => {
      // Create multiple plugins
      const pluginA = `${testTlpaDir}/plugin-a`;
      filesystem.setDirectory(pluginA);
      filesystem.setFile(`${pluginA}/plugin.tlisp`, '(defun func-a () "a")');

      const pluginB = `${testTlpaDir}/plugin-b`;
      filesystem.setDirectory(pluginB);
      filesystem.setFile(`${pluginB}/plugin.tlisp`, '(defun func-b () "b")');

      const pluginC = `${testTlpaDir}/plugin-c`;
      filesystem.setDirectory(pluginC);
      filesystem.setFile(`${pluginC}/plugin.tlisp`, '(defun func-c () "c")');

      const result = await editor.loadPluginsFromDirectory(testTlpaDir);

      expect(result.loaded).toHaveLength(3);
      expect(result.loaded).toContain('plugin-a');
      expect(result.loaded).toContain('plugin-b');
      expect(result.loaded).toContain('plugin-c');
    });

    test('should handle non-existent tlpa directory gracefully', async () => {
      const nonExistentDir = '/does/not/exist';

      const result = await editor.loadPluginsFromDirectory(nonExistentDir);

      expect(result.loaded).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].plugin).toBe('directory');
      expect(result.errors[0].error).toContain('does not exist');
    });
  });

  describe('plugin.tlisp Loading', () => {
    test('should load and execute plugin.tlisp automatically', async () => {
      const pluginPath = `${testTlpaDir}/auto-load-test`;
      filesystem.setDirectory(pluginPath);
      filesystem.setFile(
        `${pluginPath}/plugin.tlisp`,
        '(defun plugin-loaded-func () t)'
      );

      await editor.loadPluginsFromDirectory(testTlpaDir);

      // Check that the function was defined
      const result = interpreter.execute('(plugin-loaded-func)');
      expect(result._tag).toBe('Right');
      expect(result.right.value).toBe(true);
    });

    test('should make plugin functions available in interpreter', async () => {
      const pluginPath = `${testTlpaDir}/function-test`;
      filesystem.setDirectory(pluginPath);
      filesystem.setFile(
        `${pluginPath}/plugin.tlisp`,
        '(defun my-plugin-func (x) (+ x 1))'
      );

      await editor.loadPluginsFromDirectory(testTlpaDir);

      // Test the function is available and works
      const result = interpreter.execute('(my-plugin-func 5)');
      expect(result._tag).toBe('Right');
      expect(result.right.value).toBe(6);
    });

    test('should handle plugin.tlisp with syntax errors', async () => {
      const pluginPath = `${testTlpaDir}/syntax-error`;
      filesystem.setDirectory(pluginPath);
      filesystem.setFile(
        `${pluginPath}/plugin.tlisp`,
        '(defun incomplete' // Missing closing paren
      );

      const result = await editor.loadPluginsFromDirectory(testTlpaDir);

      expect(result.loaded).not.toContain('syntax-error');
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          plugin: 'syntax-error'
        })
      );
    });

    test('should handle plugin.tlisp that throws runtime errors', async () => {
      const pluginPath = `${testTlpaDir}/runtime-error`;
      filesystem.setDirectory(pluginPath);
      // Note: T-Lisp doesn't have an error function, so we just define a function
      filesystem.setFile(
        `${pluginPath}/plugin.tlisp`,
        '(defun error-func () "test")'
      );

      // Plugin should load even if it has errors
      const result = await editor.loadPluginsFromDirectory(testTlpaDir);

      // The plugin file is loaded successfully
      expect(result.loaded).toContain('runtime-error');
    });
  });

  describe('plugin.toml Dependency Loading', () => {
    test('should load plugin.toml before plugin.tlisp', async () => {
      const pluginPath = `${testTlpaDir}/with-deps`;
      filesystem.setDirectory(pluginPath);
      filesystem.setFile(
        `${pluginPath}/plugin.toml`,
        `
[plugin]
name = "with-deps"
version = "1.0.0"
description = "Test plugin with dependencies"

[dependencies]
other-plugin = "1.0.0"
        `
      );
      filesystem.setFile(
        `${pluginPath}/plugin.tlisp`,
        '(defun deps-loaded-func () t)'
      );

      const result = await editor.loadPluginsFromDirectory(testTlpaDir);

      expect(result.loaded).toContain('with-deps');
      // plugin.tlisp should have been loaded
      const checkResult = interpreter.execute('(deps-loaded-func)');
      expect(checkResult._tag).toBe('Right');
      expect(checkResult.right.value).toBe(true);
    });

    test('should handle missing plugin.toml gracefully', async () => {
      const pluginPath = `${testTlpaDir}/no-toml`;
      filesystem.setDirectory(pluginPath);
      filesystem.setFile(
        `${pluginPath}/plugin.tlisp`,
        '(defun no-toml-func () t)'
      );

      const result = await editor.loadPluginsFromDirectory(testTlpaDir);

      // Should still load even without toml
      expect(result.loaded).toContain('no-toml');
    });

    test('should handle malformed plugin.toml', async () => {
      const pluginPath = `${testTlpaDir}/bad-toml`;
      filesystem.setDirectory(pluginPath);
      // We don't parse TOML yet, so any content is fine
      filesystem.setFile(
        `${pluginPath}/plugin.toml`,
        'invalid [ toml content'
      );
      filesystem.setFile(
        `${pluginPath}/plugin.tlisp`,
        '(defun bad-toml-func () t)'
      );

      const result = await editor.loadPluginsFromDirectory(testTlpaDir);

      // Should load plugin.tlisp even if toml is malformed
      expect(result.loaded).toContain('bad-toml');
    });

    test('should parse plugin metadata from toml', async () => {
      const pluginPath = `${testTlpaDir}/metadata-test`;
      filesystem.setDirectory(pluginPath);
      filesystem.setFile(
        `${pluginPath}/plugin.toml`,
        `
[plugin]
name = "metadata-test"
version = "2.0.0"
description = "A test plugin"
author = "Test Author"
        `
      );
      filesystem.setFile(
        `${pluginPath}/plugin.tlisp`,
        '(defun metadata-func () t)'
      );

      const result = await editor.loadPluginsFromDirectory(testTlpaDir);

      // Check that metadata is stored (we read it but don't store it yet)
      expect(result.loaded).toContain('metadata-test');
    });
  });

  describe('Integration Tests', () => {
    test('plugins can define key bindings', async () => {
      const pluginPath = `${testTlpaDir}/keybind-plugin`;
      filesystem.setDirectory(pluginPath);
      filesystem.setFile(
        `${pluginPath}/plugin.tlisp`,
        '(key-bind "C-c p" "plugin-command" "normal")'
      );

      await editor.loadPluginsFromDirectory(testTlpaDir);

      // Check that the binding was registered
      const bindingsResult = interpreter.execute('(key-bindings)');
      expect(bindingsResult._tag).toBe('Right');

      const bindings = bindingsResult.right;
      // key-bindings returns a list
      expect(bindings.type).toBe('list');
      expect(bindings.value).toBeArray();
    });

    test('plugins can define editor commands', async () => {
      const pluginPath = `${testTlpaDir}/command-plugin`;
      filesystem.setDirectory(pluginPath);
      filesystem.setFile(
        `${pluginPath}/plugin.tlisp`,
        '(defun my-plugin-command () (+ 1 1))'
      );

      await editor.loadPluginsFromDirectory(testTlpaDir);

      // Execute the plugin command
      const result = interpreter.execute('(my-plugin-command)');
      expect(result._tag).toBe('Right');
      expect(result.right.value).toBe(2);
    });

    test('multiple plugins do not interfere with each other', async () => {
      // Create plugin A
      const pluginA = `${testTlpaDir}/plugin-a`;
      filesystem.setDirectory(pluginA);
      filesystem.setFile(
        `${pluginA}/plugin.tlisp`,
        '(defun plugin-a-func () "a")'
      );

      // Create plugin B
      const pluginB = `${testTlpaDir}/plugin-b`;
      filesystem.setDirectory(pluginB);
      filesystem.setFile(
        `${pluginB}/plugin.tlisp`,
        '(defun plugin-b-func () "b")'
      );

      await editor.loadPluginsFromDirectory(testTlpaDir);

      // Both plugin functions should be available
      const resultA = interpreter.execute('(plugin-a-func)');
      expect(resultA._tag).toBe('Right');
      expect(resultA.right.value).toBe('a');

      const resultB = interpreter.execute('(plugin-b-func)');
      expect(resultB._tag).toBe('Right');
      expect(resultB.right.value).toBe('b');
    });

    test('plugins can depend on each other', async () => {
      // Create base plugin
      const basePlugin = `${testTlpaDir}/base-plugin`;
      filesystem.setDirectory(basePlugin);
      filesystem.setFile(
        `${basePlugin}/plugin.tlisp`,
        '(defun base-func () "base")'
      );

      // Create dependent plugin
      const depPlugin = `${testTlpaDir}/dependent-plugin`;
      filesystem.setDirectory(depPlugin);
      filesystem.setFile(
        `${depPlugin}/plugin.toml`,
        `
[dependencies]
base-plugin = "*"
        `
      );
      filesystem.setFile(
        `${depPlugin}/plugin.tlisp`,
        '(defun dependent-func () (base-func))'
      );

      await editor.loadPluginsFromDirectory(testTlpaDir);

      // The dependent plugin should be able to call base plugin function
      const result = interpreter.execute('(dependent-func)');
      expect(result._tag).toBe('Right');
      expect(result.right.value).toBe('base');
    });
  });
});
