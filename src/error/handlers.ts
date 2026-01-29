import { 
  AppError, 
  BufferError, 
  FileSystemError, 
  TerminalError, 
  ValidationError, 
  ConfigError 
} from './types';

/**
 * Formats an error object into a human-readable string
 */
export const formatError = (error: AppError): string => {
  let formatted = `${error.type}: ${error.variant}\n`;
  formatted += `Message: ${error.message}\n`;

  // Use type guards to safely access properties
  if ('path' in error && error.path) {
    formatted += `Path: ${error.path}\n`;
  }

  if ('configPath' in error && error.configPath) {
    formatted += `Config Path: ${error.configPath}\n`;
  }

  if ('field' in error && error.field) {
    formatted += `Field: ${error.field}\n`;
  }

  if ('value' in error && error.value !== undefined) {
    formatted += `Value: ${JSON.stringify(error.value)}\n`;
  }

  if ('constraint' in error && error.constraint) {
    formatted += `Constraint: ${error.constraint}\n`;
  }

  if ('details' in error && error.details) {
    formatted += `Details: ${JSON.stringify(error.details, null, 2)}\n`;
  }
  
  return formatted.trim();
};

/**
 * Logs an error to the console with formatting
 */
export const logError = (error: AppError): void => {
  const formattedError = formatError(error);
  console.error(formattedError);
};

/**
 * Type guard functions to check specific error types
 */
export const isBufferError = (error: AppError): error is BufferError => {
  return error.type === 'BufferError';
};

export const isFileSystemError = (error: AppError): error is FileSystemError => {
  return error.type === 'FileSystemError';
};

export const isTerminalError = (error: AppError): error is TerminalError => {
  return error.type === 'TerminalError';
};

export const isValidationError = (error: AppError): error is ValidationError => {
  return error.type === 'ValidationError';
};

export const isConfigError = (error: AppError): error is ConfigError => {
  return error.type === 'ConfigError';
};