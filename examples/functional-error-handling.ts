/**
 * @file functional-error-handling.ts
 * @description Examples of functional error handling patterns in tmax
 * Demonstrates validation, async operations, nullable handling, error recovery, and logging
 */

import { Either, TaskEither } from "../src/utils/task-either.ts";
import { Option, Some, None, isSome, isNone, Option as OptionUtils } from "../src/utils/option.ts";

// =============================================================================
// 1. VALIDATION WITH EITHER
// =============================================================================

/**
 * Example: Validate user input using Either pattern
 */
interface User {
  name: string;
  email: string;
  age: number;
}

type ValidationError = 
  | { type: 'NameTooShort'; name: string }
  | { type: 'InvalidEmail'; email: string }
  | { type: 'AgeTooYoung'; age: number };

/**
 * Validate a user object
 */
function validateUser(user: Partial<User>): Either<ValidationError[], User> {
  const errors: ValidationError[] = [];

  // Validate name
  if (!user.name || user.name.length < 2) {
    errors.push({ type: 'NameTooShort', name: user.name || '' });
  }

  // Validate email
  if (!user.email || !user.email.includes('@')) {
    errors.push({ type: 'InvalidEmail', email: user.email || '' });
  }

  // Validate age
  if (typeof user.age !== 'number' || user.age < 0 || user.age > 150) {
    errors.push({ type: 'AgeTooYoung', age: user.age || 0 });
  }

  if (errors.length > 0) {
    return Either.left(errors);
  }

  return Either.right({
    name: user.name!,
    email: user.email!,
    age: user.age!
  });
}

// Example usage
console.log("=== Validation Examples ===");

const validUser = validateUser({ name: "Alice", email: "alice@example.com", age: 30 });
console.log("Valid user:", Either.isRight(validUser) ? validUser.right : "Validation failed");

const invalidUser = validateUser({ name: "A", email: "invalid-email", age: -5 });
console.log("Invalid user:", Either.isLeft(invalidUser) ? invalidUser.left : "Validation passed");

// =============================================================================
// 2. ASYNC OPERATIONS WITH TASKEITHER
// =============================================================================

/**
 * Example: Async file operations with TaskEither
 */
async function readFileAsync(filename: string): Promise<string> {
  // Simulate reading a file
  return `Contents of ${filename}`;
}

async function writeFileAsync(filename: string, content: string): Promise<void> {
  // Simulate writing a file
  console.log(`Writing to ${filename}: ${content.substring(0, 20)}...`);
}

/**
 * Safe file reading with error handling
 */
function safeReadFile(filename: string): TaskEither<string, string> {
  return TaskEither.from(async () => {
    try {
      if (filename.includes("error")) {
        return Either.left(`File not found: ${filename}`);
      }
      const content = await readFileAsync(filename);
      return Either.right(content);
    } catch (error) {
      return Either.left(`Failed to read ${filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

/**
 * Safe file writing with error handling
 */
function safeWriteFile(filename: string, content: string): TaskEither<string, void> {
  return TaskEither.from(async () => {
    try {
      if (filename.includes("readonly")) {
        return Either.left(`Permission denied: ${filename}`);
      }
      await writeFileAsync(filename, content);
      return Either.right(undefined);
    } catch (error) {
      return Either.left(`Failed to write ${filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

// Example usage
console.log("\n=== Async Operations Examples ===");

async function runAsyncExamples() {
  // Try to read a valid file
  const readFileResult = await safeReadFile("example.txt").run();
  if (Either.isRight(readFileResult)) {
    console.log("File content:", readFileResult.right);
  } else {
    console.log("Read error:", readFileResult.left);
  }

  // Try to read an invalid file
  const errorFileResult = await safeReadFile("error-file.txt").run();
  if (Either.isLeft(errorFileResult)) {
    console.log("Expected error:", errorFileResult.left);
  }

  // Chain operations with flatMap
  const chainedResult = await safeReadFile("example.txt")
    .flatMap(content => safeWriteFile("output.txt", content + "\nModified"))
    .run();

  if (Either.isRight(chainedResult)) {
    console.log("Chained operation succeeded");
  } else {
    console.log("Chained operation failed:", chainedResult.left);
  }
}

// Run async examples
runAsyncExamples();

// =============================================================================
// 3. NULLABLE HANDLING WITH OPTION
// =============================================================================

/**
 * Example: Handling nullable values with Option
 */
interface UserProfile {
  id: number;
  name: string;
  email?: string;
}

const users: UserProfile[] = [
  { id: 1, name: "Alice", email: "alice@example.com" },
  { id: 2, name: "Bob" }, // No email
  { id: 3, name: "Charlie", email: "charlie@example.com" }
];

/**
 * Find user by ID using Option
 */
function findUserById(id: number): Option<UserProfile> {
  const user = users.find(u => u.id === id);
  return user ? Some(user) : None;
}

/**
 * Get email safely using Option
 */
function getUserEmail(userId: number): Option<string> {
  return findUserById(userId)
    .flatMap(user => user.email ? Some(user.email) : None);
}

// Example usage
console.log("\n=== Nullable Handling Examples ===");

const alice = findUserById(1);
console.log("Found Alice:", isSome(alice) ? alice.value.name : "Not found");

const bobEmail = getUserEmail(2);
console.log("Bob's email:", isSome(bobEmail) ? bobEmail.value : "No email");

const charlieEmail = getUserEmail(3);
console.log("Charlie's email:", isSome(charlieEmail) ? charlieEmail.value : "No email");

// =============================================================================
// 4. ERROR RECOVERY AND RETRY PATTERNS
// =============================================================================

/**
 * Example: Retry operation with exponential backoff
 */
function withRetry<T, E>(
  operation: () => TaskEither<E, T>,
  maxRetries: number,
  delayMs: number = 1000
): TaskEither<E, T> {
  return TaskEither.from(async () => {
    let lastError: E | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await operation().run();
      
      if (Either.isRight(result)) {
        return result; // Success
      }

      lastError = result.left;
      
      if (attempt < maxRetries) {
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, attempt)));
      }
    }

    // All retries exhausted
    return Either.left(lastError!);
  });
}

/**
 * Simulate an operation that sometimes fails
 */
function unreliableOperation(): TaskEither<string, string> {
  return TaskEither.from(async () => {
    // Simulate 70% failure rate
    if (Math.random() < 0.7) {
      return Either.left("Temporary failure");
    }
    return Either.right("Success after retry");
  });
}

// Example usage
console.log("\n=== Error Recovery Examples ===");

async function runRecoveryExample() {
  const result = await withRetry(unreliableOperation, 3, 100).run();
  console.log("Retry result:", Either.isRight(result) ? result.right : `Failed: ${result.left}`);
}

runRecoveryExample();

// =============================================================================
// 5. ERROR LOGGING PATTERNS
// =============================================================================

/**
 * Example: Structured error logging
 */
interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
}

class Logger {
  private static logs: LogEntry[] = [];

  static info(message: string, context?: Record<string, unknown>) {
    this.logs.push({ timestamp: new Date(), level: 'info', message, context });
    console.log(`INFO: ${message}`, context ? JSON.stringify(context) : '');
  }

  static warn(message: string, context?: Record<string, unknown>) {
    this.logs.push({ timestamp: new Date(), level: 'warn', message, context });
    console.warn(`WARN: ${message}`, context ? JSON.stringify(context) : '');
  }

  static error(message: string, context?: Record<string, unknown>) {
    this.logs.push({ timestamp: new Date(), level: 'error', message, context });
    console.error(`ERROR: ${message}`, context ? JSON.stringify(context) : '');
  }

  static getLogs(): LogEntry[] {
    return [...this.logs]; // Return copy
  }
}

/**
 * Log errors with context using TaskEither
 */
function withLogging<L, R>(task: TaskEither<L, R>, operationName: string): TaskEither<L, R> {
  return TaskEither.from(async () => {
    Logger.info(`Starting ${operationName}`);
    
    const result = await task.run();
    
    if (Either.isRight(result)) {
      Logger.info(`${operationName} succeeded`, { result: typeof result.right });
    } else {
      Logger.error(`${operationName} failed`, { error: result.left });
    }
    
    return result;
  });
}

// Example usage
console.log("\n=== Error Logging Examples ===");

async function runLoggingExample() {
  const loggedOperation = withLogging(
    safeReadFile("example.txt"),
    "readExampleFile"
  );
  
  const result = await loggedOperation.run();
  console.log("Logged operation result:", Either.isRight(result) ? "Success" : "Failure");
}

runLoggingExample();

// =============================================================================
// 6. COMBINING PATTERNS
// =============================================================================

/**
 * Example: Combining validation, async operations, and error handling
 */
function processUserData(userId: number): TaskEither<string, string> {
  return TaskEither.from(async () => {
    const userOption = findUserById(userId);

    if (!isSome(userOption)) {
      return Either.left("User not found");
    }

    const user = userOption.value;
    if (!user.email) {
      return Either.left("User has no email address");
    }

    // Simulate sending email
    return Either.right(`Email sent to ${user.name} at ${user.email}`);
  });
}

// Example usage
console.log("\n=== Combined Patterns Examples ===");

async function runCombinedExample() {
  const result = await processUserData(1).run();
  console.log("Combined result:", Either.isRight(result) ? result.right : result.left);
  
  const result2 = await processUserData(999).run(); // Non-existent user
  console.log("Combined result (missing user):", Either.isRight(result2) ? result2.right : result2.left);
}

runCombinedExample();

console.log("\n=== All Examples Completed ===");