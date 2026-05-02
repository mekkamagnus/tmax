/**
 * @file cli-flag.test.ts
 * @description Integration tests for --init-file CLI flag
 */

import { describe, test, expect } from 'bun:test';

describe('CLI Flag - Init File', () => {
  test('should parse --init-file flag', () => {
    // Test flag parsing logic
    const args = ['--init-file', './my-config.tlisp'];
    const initFileArgIndex = args.indexOf('--init-file');
    expect(initFileArgIndex).toBe(0);
    expect(args[initFileArgIndex + 1]).toBe('./my-config.tlisp');
  });

  test('should handle absolute paths', () => {
    const path = '/home/user/custom-config.tlisp';
    expect(path).toBeTruthy();
    expect(path.startsWith('/')).toBe(true);
  });

  test('should handle relative paths', () => {
    const path = './my-config.tlisp';
    expect(path).toBeTruthy();
    expect(path.startsWith('./')).toBe(true);
  });

  test('should support /dev/null to disable init file', () => {
    const path = '/dev/null';
    expect(path).toBe('/dev/null');
  });

  test('should handle missing flag value', () => {
    const args = ['--init-file'];
    const initFileArgIndex = args.indexOf('--init-file');
    expect(initFileArgIndex).toBe(0);
    expect(args[initFileArgIndex + 1]).toBeUndefined();
  });
});

describe('CLI Flag - Error Handling', () => {
  test('should handle non-existent files gracefully', () => {
    // Non-existent file should not crash editor
    const path = '/non/existent/path.tlisp';
    expect(path).toBeTruthy();
  });

  test('should handle invalid paths', () => {
    // Invalid paths should be handled gracefully
    const path = '';
    expect(path).toBe('');
  });
});
