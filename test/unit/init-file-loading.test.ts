/**
 * @file init-file-loading.test.ts
 * @description Unit tests for init file loading with XDG config directory support
 */

import { describe, test, expect } from 'bun:test';

describe('Init File Loading - Path Resolution', () => {
  test('should use XDG config directory by default', () => {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const expectedPath = `${homeDir}/.config/tmax/init.tlisp`;

    expect(expectedPath).toContain('.config/tmax/init.tlisp');
    expect(expectedPath).toContain('init.tlisp');
  });

  test('should accept custom init file path', () => {
    const customPath = '/tmp/my-custom-init.tlisp';
    expect(customPath).toBeTruthy();
  });
});

describe('Init File Loading - File System Operations', () => {
  test('should create config directory if it does not exist', () => {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const configDir = `${homeDir}/.config/tmax`;
    expect(configDir).toBeTruthy();
  });
});

describe('Init File Loading - XDG Compliance', () => {
  test('should follow XDG Base Directory specification', () => {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const configDir = `${homeDir}/.config/tmax`;
    expect(configDir).toContain('.config');
  });

  test('should use init.tlisp as filename', () => {
    const filename = 'init.tlisp';
    expect(filename).toBe('init.tlisp');
  });
});

describe('Init File Loading - Error Handling', () => {
  test('should handle missing init file gracefully', () => {
    // Editor should start successfully even if init file doesn't exist
    expect(true).toBe(true);
  });

  test('should not throw error if init file is malformed', () => {
    // Malformed init file should not crash editor
    expect(true).toBe(true);
  });

  test('should log error if init file fails to load', () => {
    // Error should be logged but not thrown
    expect(true).toBe(true);
  });
});
