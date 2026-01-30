/**
 * Discriminated union type for Buffer errors
 */
export type BufferError = {
  type: 'BufferError';
  variant: 'Overflow' | 'Underflow' | 'InvalidOperation' | 'OutOfBounds';
  message: string;
  details?: Record<string, any>;
};

/**
 * Discriminated union type for File System errors
 */
export type FileSystemError = {
  type: 'FileSystemError';
  variant: 'ReadError' | 'WriteError' | 'StatError' | 'NotFoundError' | 'PermissionError';
  message: string;
  path?: string;
  details?: Record<string, any>;
};

/**
 * Discriminated union type for Terminal errors
 */
export type TerminalError = {
  type: 'TerminalError';
  variant: 'IoError' | 'ModeError' | 'ResizeError' | 'UnsupportedOperation';
  message: string;
  details?: Record<string, any>;
};

/**
 * Discriminated union type for Validation errors
 */
export type ValidationError = {
  type: 'ValidationError';
  variant: 'ConstraintViolation' | 'TypeError' | 'FormatError' | 'RangeError';
  message: string;
  field?: string;
  value?: any;
  constraint?: string;
  details?: Record<string, any>;
};

/**
 * Discriminated union type for Configuration errors
 */
export type ConfigError = {
  type: 'ConfigError';
  variant: 'MissingConfiguration' | 'InvalidConfiguration' | 'ParseError' | 'ValidationError';
  message: string;
  configPath?: string;
  details?: Record<string, any>;
};

/**
 * Evaluation error types
 */
export type EvalError = {
  type: 'EvalError';
  variant: 'SyntaxError' | 'RuntimeError' | 'TypeError' | 'ArithmeticError' | 'UndefinedSymbol';
  message: string;
  details?: Record<string, any>;
};

/**
 * Union type of all error types
 */
export type AppError =
  | BufferError
  | FileSystemError
  | TerminalError
  | ValidationError
  | ConfigError
  | EvalError;

// Export the error creation functions
export const createBufferError = (
  variant: BufferError['variant'],
  message: string,
  details?: Record<string, any>
): BufferError => ({
  type: 'BufferError',
  variant,
  message,
  details
});

export const createFileSystemError = (
  variant: FileSystemError['variant'],
  message: string,
  path?: string,
  details?: Record<string, any>
): FileSystemError => ({
  type: 'FileSystemError',
  variant,
  message,
  path,
  details
});

export const createTerminalError = (
  variant: TerminalError['variant'],
  message: string,
  details?: Record<string, any>
): TerminalError => ({
  type: 'TerminalError',
  variant,
  message,
  details
});

export const createValidationError = (
  variant: ValidationError['variant'],
  message: string,
  field?: string,
  value?: any,
  constraint?: string,
  details?: Record<string, any>
): ValidationError => ({
  type: 'ValidationError',
  variant,
  message,
  field,
  value,
  constraint,
  details
});

export const createConfigError = (
  variant: ConfigError['variant'],
  message: string,
  configPath?: string,
  details?: Record<string, any>
): ConfigError => ({
  type: 'ConfigError',
  variant,
  message,
  configPath,
  details
});