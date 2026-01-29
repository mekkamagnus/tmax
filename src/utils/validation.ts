import { Either } from './task-either';
import { ValidationError, createValidationError } from '../error/types';

/**
 * Validates the number of arguments passed to a function
 * @param args The arguments array
 * @param expectedCount The expected number of arguments
 * @param functionName The name of the function for error messages
 * @returns Either with error if validation fails, or void if successful
 */
export const validateArgsCount = (
  args: any[],
  expectedCount: number,
  functionName: string
): Either<ValidationError, void> => {
  if (args.length !== expectedCount) {
    return Either.left(
      createValidationError(
        'ConstraintViolation',
        `${functionName} requires exactly ${expectedCount} argument${expectedCount !== 1 ? 's' : ''}`,
        'args',
        args.length,
        `exactly ${expectedCount}`
      )
    );
  }
  return Either.right(undefined);
};

/**
 * Validates the type of an argument
 * @param arg The argument to validate
 * @param expectedType The expected type ('string', 'number', 'boolean', 'list', 'symbol', 'nil')
 * @param argPosition The position of the argument (for error messages)
 * @param functionName The name of the function for error messages
 * @returns Either with error if validation fails, or void if successful
 */
export const validateArgType = (
  arg: any,
  expectedType: 'string' | 'number' | 'boolean' | 'list' | 'symbol' | 'nil',
  argPosition: number,
  functionName: string
): Either<ValidationError, void> => {
  if (!arg) {
    return Either.left(
      createValidationError(
        'TypeError',
        `${functionName} requires a ${expectedType} for argument at position ${argPosition + 1}`,
        `arg${argPosition + 1}`,
        arg,
        expectedType
      )
    );
  }

  // Assuming TLispValue has a 'type' property
  if (arg.type !== expectedType) {
    return Either.left(
      createValidationError(
        'TypeError',
        `${functionName} requires a ${expectedType} for argument at position ${argPosition + 1}`,
        `arg${argPosition + 1}`,
        arg,
        expectedType
      )
    );
  }

  return Either.right(undefined);
};

/**
 * Validates that a buffer exists in the state
 * @param buffer The buffer to validate
 * @param bufferName The name of the buffer (for error messages)
 * @returns Either with error if validation fails, or void if successful
 */
export const validateBufferExists = (
  buffer: any | null,
  bufferName?: string
): Either<ValidationError, void> => {
  if (!buffer) {
    return Either.left(
      createValidationError(
        'ConstraintViolation',
        bufferName ? `Buffer '${bufferName}' not found` : 'No current buffer',
        'currentBuffer',
        buffer,
        'non-null buffer'
      )
    );
  }
  return Either.right(undefined);
};

/**
 * Validates a file path
 * @param path The file path to validate
 * @returns Either with error if validation fails, or void if successful
 */
export const validateFilePath = (
  path: string
): Either<ValidationError, void> => {
  if (!path || typeof path !== 'string') {
    return Either.left(
      createValidationError(
        'TypeError',
        'File path must be a non-empty string',
        'filePath',
        path,
        'non-empty string'
      )
    );
  }

  // Basic validation - could be expanded based on requirements
  if (path.length === 0) {
    return Either.left(
      createValidationError(
        'ConstraintViolation',
        'File path cannot be empty',
        'filePath',
        path,
        'non-empty string'
      )
    );
  }

  return Either.right(undefined);
};

/**
 * Validates that a mode is valid
 * @param mode The mode to validate
 * @returns Either with error if validation fails, or void if successful
 */
export const validateEditorMode = (
  mode: string
): Either<ValidationError, void> => {
  const validModes = ['normal', 'insert', 'visual', 'command', 'mx'];
  if (!validModes.includes(mode)) {
    return Either.left(
      createValidationError(
        'ConstraintViolation',
        `Invalid mode: ${mode}`,
        'mode',
        mode,
        `one of: ${validModes.join(', ')}`
      )
    );
  }
  return Either.right(undefined);
};