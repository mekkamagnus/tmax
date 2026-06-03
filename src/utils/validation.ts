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

/**
 * Validation value that can accumulate multiple errors.
 */
export class Validation<E, A> {
  private constructor(
    private readonly value: A | undefined,
    private readonly errors: E[]
  ) {}

  /**
   * Create a successful validation.
   */
  static success<E, A>(value: A): Validation<E, A> {
    return new Validation(value, []);
  }

  /**
   * Create a failed validation.
   */
  static failure<E, A = never>(errors: E | E[]): Validation<E, A> {
    return new Validation(undefined, Array.isArray(errors) ? errors : [errors]);
  }

  /**
   * Whether this validation succeeded.
   */
  isSuccess(): boolean {
    return this.errors.length === 0;
  }

  /**
   * Whether this validation failed.
   */
  isFailure(): boolean {
    return !this.isSuccess();
  }

  /**
   * Get the successful value.
   */
  getValue(): A {
    if (this.isFailure()) {
      throw new Error('Cannot get value from failed validation');
    }
    return this.value as A;
  }

  /**
   * Get accumulated errors.
   */
  getErrors(): E[] {
    return [...this.errors];
  }

  /**
   * Map a successful value.
   */
  map<B>(fn: (value: A) => B): Validation<E, B> {
    return this.isSuccess()
      ? Validation.success(fn(this.value as A))
      : Validation.failure(this.errors);
  }

  /**
   * Chain a validation-producing function.
   */
  flatMap<B>(fn: (value: A) => Validation<E, B>): Validation<E, B> {
    return this.isSuccess() ? fn(this.value as A) : Validation.failure(this.errors);
  }
}

/**
 * Lift a curried binary function into Validation.
 */
export const lift2 =
  <A, B, C>(fn: (a: A) => (b: B) => C) =>
  <E>(va: Validation<E, A>) =>
  (vb: Validation<E, B>): Validation<E, C> => {
    const errors = [...va.getErrors(), ...vb.getErrors()];
    return errors.length > 0
      ? Validation.failure(errors)
      : Validation.success(fn(va.getValue())(vb.getValue()));
  };

/**
 * Lift a curried ternary function into Validation.
 */
export const lift3 =
  <A, B, C, D>(fn: (a: A) => (b: B) => (c: C) => D) =>
  <E>(va: Validation<E, A>) =>
  (vb: Validation<E, B>) =>
  (vc: Validation<E, C>): Validation<E, D> => {
    const errors = [...va.getErrors(), ...vb.getErrors(), ...vc.getErrors()];
    return errors.length > 0
      ? Validation.failure(errors)
      : Validation.success(fn(va.getValue())(vb.getValue())(vc.getValue()));
  };

/**
 * Common validation helpers.
 */
export const ValidationUtils = {
  required: <T>(value: T | null | undefined, message: string): Validation<string, T> =>
    value === null || value === undefined
      ? Validation.failure(message)
      : Validation.success(value),

  nonEmpty: (value: string, message: string): Validation<string, string> =>
    value.length === 0 ? Validation.failure(message) : Validation.success(value),

  numberInRange: (
    value: number,
    min: number,
    max: number,
    message: string
  ): Validation<string, number> =>
    value < min || value > max ? Validation.failure(message) : Validation.success(value),

  email: (value: string, message = 'Invalid email'): Validation<string, string> =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      ? Validation.success(value)
      : Validation.failure(message),

  securePath: (path: string): Validation<string, string> =>
    path.includes('..')
      ? Validation.failure('Path contains directory traversal')
      : Validation.success(path),

  lengthBetween: (
    value: string,
    min: number,
    max: number,
    message: string
  ): Validation<string, string> =>
    value.length < min || value.length > max ? Validation.failure(message) : Validation.success(value),

  matches: (
    value: string,
    pattern: RegExp,
    message: string
  ): Validation<string, string> =>
    pattern.test(value) ? Validation.success(value) : Validation.failure(message),
};

/**
 * Builder helpers for composing validation rules.
 */
export const validation = {
  builder: <T, E = string>() => {
    const rules: Array<(value: T) => Validation<E, T>> = [];
    const builder = {
      rule(rule: (value: T) => Validation<E, T>) {
        rules.push(rule);
        return builder;
      },
      build() {
        return (value: T): Validation<E, T> => {
          const errors = rules.flatMap(rule => rule(value).getErrors());
          return errors.length > 0 ? Validation.failure(errors) : Validation.success(value);
        };
      }
    };
    return builder;
  }
};
