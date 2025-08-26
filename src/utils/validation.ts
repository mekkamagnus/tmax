/**
 * @file validation.ts
 * @description Validation Applicative pattern for error accumulation
 */

import { Either } from "./task-either.ts";

/**
 * Validation type that accumulates errors instead of failing fast
 */
export class Validation<E, A> {
  constructor(private readonly value: Either<E[], A>) {}
  
  /**
   * Create a successful validation
   */
  static success<E, A>(value: A): Validation<E, A> {
    return new Validation(Either.right(value));
  }
  
  /**
   * Create a failed validation with a single error
   */
  static failure<E, A>(error: E): Validation<E, A> {
    return new Validation(Either.left([error]));
  }
  
  /**
   * Create a failed validation with multiple errors
   */
  static failures<E, A>(errors: E[]): Validation<E, A> {
    return new Validation(Either.left(errors));
  }
  
  /**
   * Check if validation is successful
   */
  isSuccess(): boolean {
    return Either.isRight(this.value);
  }
  
  /**
   * Check if validation failed
   */
  isFailure(): boolean {
    return Either.isLeft(this.value);
  }
  
  /**
   * Get the success value (throws if failed)
   */
  getValue(): A {
    if (Either.isLeft(this.value)) {
      throw new Error(`Validation failed with errors: ${this.value.left.join(', ')}`);
    }
    return this.value.right;
  }
  
  /**
   * Get the errors (empty array if successful)
   */
  getErrors(): E[] {
    return Either.isLeft(this.value) ? this.value.left : [];
  }
  
  /**
   * Map over the success value
   */
  map<B>(f: (value: A) => B): Validation<E, B> {
    return new Validation(Either.map(this.value, f));
  }
  
  /**
   * Apply a function wrapped in a Validation to this value
   * This is the key operation that enables error accumulation
   */
  apply<B>(validationF: Validation<E, (value: A) => B>): Validation<E, B> {
    if (Either.isLeft(this.value) && Either.isLeft(validationF.value)) {
      // Both failed - accumulate errors
      return new Validation(Either.left([...validationF.value.left, ...this.value.left]));
    } else if (Either.isLeft(this.value)) {
      // This failed
      return new Validation(Either.left(this.value.left));
    } else if (Either.isLeft(validationF.value)) {
      // Function validation failed
      return new Validation(Either.left(validationF.value.left));
    } else {
      // Both succeeded
      return new Validation(Either.right(validationF.value.right(this.value.right)));
    }
  }
  
  /**
   * FlatMap for chaining validations (fails fast like Either)
   */
  flatMap<B>(f: (value: A) => Validation<E, B>): Validation<E, B> {
    if (Either.isLeft(this.value)) {
      return new Validation(Either.left(this.value.left));
    }
    return f(this.value.right);
  }
  
  /**
   * Fold over both success and failure cases
   */
  fold<B>(onFailures: (errors: E[]) => B, onSuccess: (value: A) => B): B {
    return Either.isLeft(this.value) 
      ? onFailures(this.value.left) 
      : onSuccess(this.value.right);
  }
  
  /**
   * Map over the error values
   */
  mapErrors<E2>(f: (error: E) => E2): Validation<E2, A> {
    return new Validation(
      Either.isLeft(this.value)
        ? Either.left(this.value.left.map(f))
        : Either.right(this.value.right)
    );
  }
  
  /**
   * Get the success value or return a default
   */
  getOrElse(defaultValue: A): A {
    return Either.getOrElse(this.value, defaultValue);
  }
  
  /**
   * Convert to Either (losing error accumulation)
   */
  toEither(): Either<E[], A> {
    return this.value;
  }
  
  /**
   * Combine with another validation, accumulating both successes and failures
   */
  zip<B>(other: Validation<E, B>): Validation<E, [A, B]> {
    return lift2<E, A, B, [A, B]>((a: A) => (b: B): [A, B] => [a, b])(this)(other);
  }
  
  /**
   * Filter the success value, converting to failure if predicate fails
   */
  filter(predicate: (value: A) => boolean, error: E): Validation<E, A> {
    if (Either.isLeft(this.value)) {
      return this;
    }
    return predicate(this.value.right) 
      ? this 
      : Validation.failure(error);
  }
  
  /**
   * Validate a condition, accumulating with existing errors if it fails
   */
  validate(predicate: (value: A) => boolean, error: E): Validation<E, A> {
    if (Either.isLeft(this.value)) {
      // Already failed - check predicate and potentially add more errors
      return this;
    }
    
    if (predicate(this.value.right)) {
      return this;
    }
    
    return Validation.failure(error);
  }
  
  /**
   * Add an additional validation check, accumulating errors
   */
  also(validation: (value: A) => Validation<E, A>): Validation<E, A> {
    if (Either.isLeft(this.value)) {
      return this;
    }
    
    const additionalValidation = validation(this.value.right);
    if (Either.isLeft(additionalValidation.value)) {
      return new Validation(Either.left(additionalValidation.value.left));
    }
    
    return this;
  }
  
  /**
   * Sequence multiple validations, accumulating all errors
   */
  static sequence<E, A>(validations: Validation<E, A>[]): Validation<E, A[]> {
    return validations.reduce(
      (acc, validation) => lift2<E, A[], A, A[]>((arr: A[]) => (item: A) => [...arr, item])(acc)(validation),
      Validation.success<E, A[]>([])
    );
  }
  
  /**
   * Traverse a list with a validation function, accumulating errors
   */
  static traverse<E, A, B>(
    items: A[],
    f: (item: A) => Validation<E, B>
  ): Validation<E, B[]> {
    return Validation.sequence(items.map(f));
  }
}

/**
 * Lift a function into the Validation context
 */
export const lift = <E, A, B>(f: (a: A) => B): ((validation: Validation<E, A>) => Validation<E, B>) =>
  (validation: Validation<E, A>) => validation.map(f);

/**
 * Lift a binary function into the Validation context (applicative style)
 */
export const lift2 = <E, A, B, C>(
  f: (a: A) => (b: B) => C
): ((va: Validation<E, A>) => (vb: Validation<E, B>) => Validation<E, C>) =>
  va => vb => {
    if (va.isFailure() && vb.isFailure()) {
      return Validation.failures([...va.getErrors(), ...vb.getErrors()]);
    } else if (va.isFailure()) {
      return va as unknown as Validation<E, C>;
    } else if (vb.isFailure()) {
      return vb as unknown as Validation<E, C>;
    } else {
      return Validation.success(f(va.getValue())(vb.getValue()));
    }
  };

/**
 * Lift a ternary function into the Validation context
 */
export const lift3 = <E, A, B, C, D>(
  f: (a: A) => (b: B) => (c: C) => D
): ((va: Validation<E, A>) => (vb: Validation<E, B>) => (vc: Validation<E, C>) => Validation<E, D>) =>
  va => vb => vc => {
    const errors: E[] = [];
    if (va.isFailure()) errors.push(...va.getErrors());
    if (vb.isFailure()) errors.push(...vb.getErrors());
    if (vc.isFailure()) errors.push(...vc.getErrors());
    
    if (errors.length > 0) {
      return Validation.failures(errors);
    } else {
      return Validation.success(f(va.getValue())(vb.getValue())(vc.getValue()));
    }
  };

/**
 * Lift a quaternary function into the Validation context
 */
export const lift4 = <E, A, B, C, D, F>(
  f: (a: A) => (b: B) => (c: C) => (d: D) => F
): ((va: Validation<E, A>) => (vb: Validation<E, B>) => (vc: Validation<E, C>) => (vd: Validation<E, D>) => Validation<E, F>) =>
  va => vb => vc => vd => {
    const errors: E[] = [];
    if (va.isFailure()) errors.push(...va.getErrors());
    if (vb.isFailure()) errors.push(...vb.getErrors());
    if (vc.isFailure()) errors.push(...vc.getErrors());
    if (vd.isFailure()) errors.push(...vd.getErrors());
    
    if (errors.length > 0) {
      return Validation.failures(errors);
    } else {
      return Validation.success(f(va.getValue())(vb.getValue())(vc.getValue())(vd.getValue()));
    }
  };

/**
 * Common validation utilities
 */
export const ValidationUtils = {
  /**
   * Validate that a value is not null or undefined
   */
  required: <T>(value: T | null | undefined, error: string): Validation<string, T> =>
    value != null ? Validation.success(value) : Validation.failure(error),
  
  /**
   * Validate string is not empty
   */
  nonEmpty: (value: string, error: string): Validation<string, string> =>
    value.trim().length > 0 ? Validation.success(value) : Validation.failure(error),
  
  /**
   * Validate string matches a pattern
   */
  matches: (value: string, pattern: RegExp, error: string): Validation<string, string> =>
    pattern.test(value) ? Validation.success(value) : Validation.failure(error),
  
  /**
   * Validate string length is within bounds
   */
  lengthBetween: (value: string, min: number, max: number, error: string): Validation<string, string> =>
    value.length >= min && value.length <= max 
      ? Validation.success(value) 
      : Validation.failure(error),
  
  /**
   * Validate number is within range
   */
  numberInRange: (value: number, min: number, max: number, error: string): Validation<string, number> =>
    value >= min && value <= max 
      ? Validation.success(value) 
      : Validation.failure(error),
  
  /**
   * Validate array is not empty
   */
  nonEmptyArray: <T>(value: T[], error: string): Validation<string, T[]> =>
    value.length > 0 ? Validation.success(value) : Validation.failure(error),
  
  /**
   * Validate email format
   */
  email: (value: string): Validation<string, string> =>
    ValidationUtils.matches(
      value, 
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/, 
      "Invalid email format"
    ),
  
  /**
   * Validate path format and security
   */
  securePath: (path: string): Validation<string, string> => {
    const errors: string[] = [];
    
    if (path.includes('..')) {
      errors.push("Path contains directory traversal");
    }
    
    if (path.length > 4096) {
      errors.push("Path too long (max 4096 characters)");
    }
    
    if (/[<>:"|?*\u0000-\u001f]/.test(path)) {
      errors.push("Path contains invalid characters");
    }
    
    if (path.startsWith('/') && Deno.build.os === 'windows') {
      errors.push("Unix-style absolute paths not supported on Windows");
    }
    
    return errors.length > 0 
      ? Validation.failures(errors)
      : Validation.success(path);
  },
  
  /**
   * Combine multiple validation checks for a single value
   */
  all: <E, A>(value: A, ...validators: Array<(value: A) => Validation<E, A>>): Validation<E, A> =>
    validators.reduce(
      (acc, validator) => {
        const result = validator(value);
        if (acc.isFailure() && result.isFailure()) {
          return Validation.failures([...acc.getErrors(), ...result.getErrors()]);
        } else if (acc.isFailure()) {
          return acc;
        } else if (result.isFailure()) {
          return result;
        } else {
          return acc;
        }
      },
      Validation.success<E, A>(value)
    ),
  
  /**
   * Validate object properties, accumulating all errors
   */
  validateObject: <T extends Record<string, unknown>, E>(
    obj: T,
    validators: { [K in keyof T]?: (value: T[K]) => Validation<E, T[K]> }
  ): Validation<E, T> => {
    type ValidationEntry = [keyof T, Validation<E, unknown>];
    
    const validationEntries: ValidationEntry[] = Object.entries(validators).map(
      ([key, validator]) => [key as keyof T, validator!(obj[key as keyof T])]
    );
    
    const failures = validationEntries
      .filter(([, validation]) => validation.isFailure())
      .flatMap(([, validation]) => validation.getErrors());
    
    if (failures.length > 0) {
      return Validation.failures(failures);
    }
    
    return Validation.success(obj);
  }
};

/**
 * Type-safe builder for complex validation scenarios
 */
export class ValidationBuilder<E, T> {
  private validations: Array<(value: T) => Validation<E, T>> = [];
  
  /**
   * Add a validation rule
   */
  rule(validator: (value: T) => Validation<E, T>): ValidationBuilder<E, T> {
    this.validations.push(validator);
    return this;
  }
  
  /**
   * Add a conditional validation rule
   */
  when(
    condition: (value: T) => boolean,
    validator: (value: T) => Validation<E, T>
  ): ValidationBuilder<E, T> {
    return this.rule(value => 
      condition(value) ? validator(value) : Validation.success(value)
    );
  }
  
  /**
   * Build the final validator
   */
  build(): (value: T) => Validation<E, T> {
    return (value: T) => ValidationUtils.all(value, ...this.validations);
  }
}

/**
 * Factory for creating validation builders
 */
export const validation = {
  /**
   * Create a new validation builder
   */
  builder: <E, T>() => new ValidationBuilder<E, T>(),
  
  /**
   * Create a validation from a predicate
   */
  predicate: <T>(predicate: (value: T) => boolean, error: string) =>
    (value: T): Validation<string, T> =>
      predicate(value) ? Validation.success(value) : Validation.failure(error),
  
  /**
   * Combine multiple validations with AND logic (all must pass)
   */
  and: <E, T>(...validators: Array<(value: T) => Validation<E, T>>) =>
    (value: T): Validation<E, T> =>
      ValidationUtils.all(value, ...validators),
  
  /**
   * Combine multiple validations with OR logic (at least one must pass)
   */
  or: <E, T>(...validators: Array<(value: T) => Validation<E, T>>) =>
    (value: T): Validation<E, T> => {
      for (const validator of validators) {
        const result = validator(value);
        if (result.isSuccess()) {
          return result;
        }
      }
      
      // All failed - collect all errors
      const allErrors = validators
        .map(v => v(value))
        .filter(v => v.isFailure())
        .flatMap(v => v.getErrors());
      
      return Validation.failures(allErrors);
    }
};

// Example usage patterns (commented for documentation)
/*
// Basic validation with error accumulation
const validateUser = (data: unknown): Validation<string, User> => {
  const nameValidation = ValidationUtils.required(data.name, "Name is required")
    .flatMap(name => ValidationUtils.nonEmpty(name, "Name cannot be empty"));
  
  const emailValidation = ValidationUtils.required(data.email, "Email is required")
    .flatMap(email => ValidationUtils.email(email));
  
  const ageValidation = ValidationUtils.required(data.age, "Age is required")
    .flatMap(age => ValidationUtils.numberInRange(age, 0, 120, "Age must be between 0 and 120"));
  
  return lift3((name: string) => (email: string) => (age: number): User => 
    ({ name, email, age })
  )(nameValidation)(emailValidation)(ageValidation);
};

// File path validation with multiple checks
const validateSaveRequest = (
  buffer: TextBuffer | null,
  filename: string | undefined,
  path: string
): Validation<string, SaveRequest> => {
  
  const bufferValidation = ValidationUtils.required(buffer, "No buffer to save");
  const filenameValidation = ValidationUtils.required(filename, "Filename is required")
    .flatMap(name => ValidationUtils.nonEmpty(name, "Filename cannot be empty"));
  const pathValidation = ValidationUtils.securePath(path);
  
  return lift3((buffer: TextBuffer) => (filename: string) => (path: string): SaveRequest =>
    ({ buffer, filename, path })
  )(bufferValidation)(filenameValidation)(pathValidation);
};

// Using validation builder for complex rules
const passwordValidator = validation.builder<string, string>()
  .rule(ValidationUtils.nonEmpty("Password is required"))
  .rule(ValidationUtils.lengthBetween(8, 128, "Password must be 8-128 characters"))
  .rule(ValidationUtils.matches(/[A-Z]/, "Password must contain uppercase letter"))
  .rule(ValidationUtils.matches(/[a-z]/, "Password must contain lowercase letter"))
  .rule(ValidationUtils.matches(/\d/, "Password must contain a number"))
  .build();
*/