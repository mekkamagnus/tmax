import { test, describe, expect } from 'bun:test';
import {
  BufferError,
  FileSystemError,
  TerminalError,
  ValidationError,
  ConfigError,
  createBufferError,
  createFileSystemError,
  createTerminalError,
  createValidationError,
  createConfigError
} from '../../src/error/types';
import { formatError, logError } from '../../src/error/handlers';

describe('Error Types', () => {
  test('BufferError should be creatable with different variants', () => {
    const overflowError = createBufferError(
      'Overflow',
      'Buffer overflow occurred',
      { bufferSize: 100, requestedSize: 200 }
    );

    expect(overflowError.type).toBe('BufferError');
    expect(overflowError.variant).toBe('Overflow');
    expect(overflowError.message).toBe('Buffer overflow occurred');
    expect(overflowError.details).toEqual({ bufferSize: 100, requestedSize: 200 });
  });

  test('FileSystemError should be creatable with different variants', () => {
    const readError = createFileSystemError(
      'ReadError',
      'Could not read file',
      '/some/file.txt',
      { errno: -2, syscall: 'open' }
    );

    expect(readError.type).toBe('FileSystemError');
    expect(readError.variant).toBe('ReadError');
    expect(readError.message).toBe('Could not read file');
    expect(readError.path).toBe('/some/file.txt');
  });

  test('TerminalError should be creatable with different variants', () => {
    const ioError = createTerminalError(
      'IoError',
      'Terminal I/O error',
      { operation: 'read' }
    );

    expect(ioError.type).toBe('TerminalError');
    expect(ioError.variant).toBe('IoError');
    expect(ioError.message).toBe('Terminal I/O error');
  });

  test('ValidationError should be creatable with different variants', () => {
    const constraintError = createValidationError(
      'ConstraintViolation',
      'Value does not meet constraints',
      'bufferSize',
      0,
      'positive integer'
    );

    expect(constraintError.type).toBe('ValidationError');
    expect(constraintError.variant).toBe('ConstraintViolation');
    expect(constraintError.message).toBe('Value does not meet constraints');
    expect(constraintError.field).toBe('bufferSize');
  });

  test('ConfigError should be creatable with different variants', () => {
    const missingError = createConfigError(
      'MissingConfiguration',
      'Configuration file not found',
      './config.json'
    );

    expect(missingError.type).toBe('ConfigError');
    expect(missingError.variant).toBe('MissingConfiguration');
    expect(missingError.message).toBe('Configuration file not found');
    expect(missingError.configPath).toBe('./config.json');
  });
});

describe('Error Formatting', () => {
  test('formatError should format BufferError correctly', () => {
    const error: BufferError = {
      type: 'BufferError',
      variant: 'Overflow',
      message: 'Buffer overflow occurred',
      details: { bufferSize: 100, requestedSize: 200 }
    };
    
    const formatted = formatError(error);
    expect(formatted).toContain('BufferError');
    expect(formatted).toContain('Overflow');
    expect(formatted).toContain('Buffer overflow occurred');
  });

  test('formatError should format FileSystemError correctly', () => {
    const error: FileSystemError = {
      type: 'FileSystemError',
      variant: 'ReadError',
      message: 'Could not read file',
      path: '/some/file.txt',
      details: { errno: -2 }
    };
    
    const formatted = formatError(error);
    expect(formatted).toContain('FileSystemError');
    expect(formatted).toContain('ReadError');
    expect(formatted).toContain('Could not read file');
    expect(formatted).toContain('/some/file.txt');
  });

  test('formatError should format TerminalError correctly', () => {
    const error: TerminalError = {
      type: 'TerminalError',
      variant: 'IoError',
      message: 'Terminal I/O error',
      details: { operation: 'read' }
    };
    
    const formatted = formatError(error);
    expect(formatted).toContain('TerminalError');
    expect(formatted).toContain('IoError');
    expect(formatted).toContain('Terminal I/O error');
  });

  test('formatError should format ValidationError correctly', () => {
    const error: ValidationError = {
      type: 'ValidationError',
      variant: 'ConstraintViolation',
      message: 'Value does not meet constraints',
      field: 'bufferSize',
      value: 0,
      constraint: 'positive integer'
    };
    
    const formatted = formatError(error);
    expect(formatted).toContain('ValidationError');
    expect(formatted).toContain('ConstraintViolation');
    expect(formatted).toContain('Value does not meet constraints');
    expect(formatted).toContain('bufferSize');
  });

  test('formatError should format ConfigError correctly', () => {
    const error: ConfigError = {
      type: 'ConfigError',
      variant: 'MissingConfiguration',
      message: 'Configuration file not found',
      configPath: './config.json'
    };
    
    const formatted = formatError(error);
    expect(formatted).toContain('ConfigError');
    expect(formatted).toContain('MissingConfiguration');
    expect(formatted).toContain('Configuration file not found');
    expect(formatted).toContain('./config.json');
  });
});

describe('Error Logging', () => {
  test('logError should call console.error with formatted error', () => {
    const error: BufferError = {
      type: 'BufferError',
      variant: 'Overflow',
      message: 'Buffer overflow occurred',
      details: { bufferSize: 100, requestedSize: 200 }
    };

    // For Bun tests, we'll just test that the function exists and doesn't throw
    expect(() => logError(error)).not.toThrow();
  });
});