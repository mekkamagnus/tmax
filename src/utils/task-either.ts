/**
 * @file task-either.ts
 * @description TaskEither utility combining Task and Either for functional programming
 */

/**
 * Either type representing success (Right) or failure (Left)
 */
export type Either<L, R> = Left<L> | Right<R>;

export interface Left<L> {
  readonly _tag: 'Left';
  readonly left: L;
}

export interface Right<R> {
  readonly _tag: 'Right';
  readonly right: R;
}

/**
 * Either constructors and utilities
 */
export const Either = {
  left: <L, R = never>(value: L): Either<L, R> => ({ _tag: 'Left', left: value }),
  right: <R, L = never>(value: R): Either<L, R> => ({ _tag: 'Right', right: value }),
  
  isLeft: <L, R>(either: Either<L, R>): either is Left<L> => either._tag === 'Left',
  isRight: <L, R>(either: Either<L, R>): either is Right<R> => either._tag === 'Right',
  
  map: <L, R, R2>(either: Either<L, R>, f: (value: R) => R2): Either<L, R2> =>
    Either.isRight(either) ? Either.right(f(either.right)) : either,
    
  mapLeft: <L, R, L2>(either: Either<L, R>, f: (value: L) => L2): Either<L2, R> =>
    Either.isLeft(either) ? Either.left(f(either.left)) : either,
    
  flatMap: <L, R, R2>(either: Either<L, R>, f: (value: R) => Either<L, R2>): Either<L, R2> =>
    Either.isRight(either) ? f(either.right) : either,
    
  fold: <L, R, T>(either: Either<L, R>, onLeft: (left: L) => T, onRight: (right: R) => T): T =>
    Either.isLeft(either) ? onLeft(either.left) : onRight(either.right),
    
  getOrElse: <L, R>(either: Either<L, R>, defaultValue: R): R =>
    Either.isRight(either) ? either.right : defaultValue,
    
  tryCatch: <R>(f: () => R): Either<Error, R> => {
    try {
      return Either.right(f());
    } catch (error) {
      return Either.left(error instanceof Error ? error : new Error(String(error)));
    }
  }
};

/**
 * Task type representing a lazy computation
 */
export class Task<T> {
  constructor(private computation: () => Promise<T>) {}
  
  /**
   * Create a Task from a synchronous value
   */
  static of<T>(value: T): Task<T> {
    return new Task(() => Promise.resolve(value));
  }
  
  /**
   * Create a Task from a computation function
   */
  static from<T>(computation: () => Promise<T>): Task<T> {
    return new Task(computation);
  }
  
  /**
   * Create a Task from a synchronous computation
   */
  static fromSync<T>(computation: () => T): Task<T> {
    return new Task(() => Promise.resolve(computation()));
  }
  
  /**
   * Execute the task
   */
  async run(): Promise<T> {
    return await this.computation();
  }
  
  /**
   * Map over the task result
   */
  map<U>(f: (value: T) => U): Task<U> {
    return new Task(async () => {
      const result = await this.computation();
      return f(result);
    });
  }
  
  /**
   * FlatMap (chain) tasks
   */
  flatMap<U>(f: (value: T) => Task<U>): Task<U> {
    return new Task(async () => {
      const result = await this.computation();
      return await f(result).run();
    });
  }
  
  /**
   * Convert Task to TaskEither with error handling
   */
  tryCatch<L = Error>(onError?: (error: unknown) => L): TaskEither<L, T> {
    return TaskEither.from(async () => {
      try {
        const result = await this.computation();
        return Either.right(result);
      } catch (error) {
        const leftValue = onError 
          ? onError(error) 
          : (error instanceof Error ? error : new Error(String(error))) as L;
        return Either.left(leftValue);
      }
    });
  }
}

/**
 * TaskEither combining Task and Either for lazy error handling
 */
export class TaskEither<L, R> {
  constructor(private computation: () => Promise<Either<L, R>>) {}
  
  /**
   * Create a TaskEither from a Right value
   */
  static right<R, L = never>(value: R): TaskEither<L, R> {
    return new TaskEither(() => Promise.resolve(Either.right(value)));
  }
  
  /**
   * Create a TaskEither from a Left value
   */
  static left<L, R = never>(value: L): TaskEither<L, R> {
    return new TaskEither(() => Promise.resolve(Either.left(value)));
  }
  
  /**
   * Create a TaskEither from a computation
   */
  static from<L, R>(computation: () => Promise<Either<L, R>>): TaskEither<L, R> {
    return new TaskEither(computation);
  }
  
  /**
   * Create a TaskEither from a potentially throwing computation
   */
  static tryCatch<R, L = Error>(
    computation: () => Promise<R>,
    onError?: (error: unknown) => L
  ): TaskEither<L, R> {
    return new TaskEither(async () => {
      try {
        const result = await computation();
        return Either.right(result);
      } catch (error) {
        const leftValue = onError 
          ? onError(error) 
          : (error instanceof Error ? error : new Error(String(error))) as L;
        return Either.left(leftValue);
      }
    });
  }
  
  /**
   * Create a TaskEither from a synchronous computation
   */
  static fromSync<R, L = Error>(
    computation: () => R,
    onError?: (error: unknown) => L
  ): TaskEither<L, R> {
    return new TaskEither(() => {
      try {
        const result = computation();
        return Promise.resolve(Either.right(result));
      } catch (error) {
        const leftValue = onError 
          ? onError(error) 
          : (error instanceof Error ? error : new Error(String(error))) as L;
        return Promise.resolve(Either.left(leftValue));
      }
    });
  }
  
  /**
   * Execute the TaskEither
   */
  async run(): Promise<Either<L, R>> {
    return await this.computation();
  }
  
  /**
   * Map over the Right value
   */
  map<R2>(f: (value: R) => R2): TaskEither<L, R2> {
    return new TaskEither(async () => {
      const either = await this.computation();
      return Either.map(either, f);
    });
  }
  
  /**
   * Map over the Left value
   */
  mapLeft<L2>(f: (value: L) => L2): TaskEither<L2, R> {
    return new TaskEither(async () => {
      const either = await this.computation();
      return Either.mapLeft(either, f);
    });
  }
  
  /**
   * FlatMap (chain) TaskEithers
   */
  flatMap<R2>(f: (value: R) => TaskEither<L, R2>): TaskEither<L, R2> {
    return new TaskEither(async () => {
      const either = await this.computation();
      if (Either.isLeft(either)) {
        return either;
      }
      return await f(either.right).run();
    });
  }
  
  /**
   * Alias for flatMap
   */
  andThen<R2>(f: (value: R) => TaskEither<L, R2>): TaskEither<L, R2> {
    return this.flatMap(f);
  }
  
  /**
   * Apply a function to both Left and Right cases
   */
  fold<T>(onLeft: (left: L) => T, onRight: (right: R) => T): Task<T> {
    return new Task(async () => {
      const either = await this.computation();
      return Either.fold(either, onLeft, onRight);
    });
  }
  
  /**
   * Get the Right value or return a default
   */
  getOrElse(defaultValue: R): Task<R> {
    return new Task(async () => {
      const either = await this.computation();
      return Either.getOrElse(either, defaultValue);
    });
  }
  
  /**
   * Convert to a regular Task, handling errors
   */
  toTask(onError: (left: L) => R): Task<R> {
    return new Task(async () => {
      const either = await this.computation();
      return Either.isRight(either) ? either.right : onError(either.left);
    });
  }
  
  /**
   * Combine two TaskEithers (both must succeed)
   */
  zip<R2>(other: TaskEither<L, R2>): TaskEither<L, [R, R2]> {
    return new TaskEither(async () => {
      const [either1, either2] = await Promise.all([
        this.computation(),
        other.run()
      ]);
      
      if (Either.isLeft(either1)) return either1;
      if (Either.isLeft(either2)) return either2;
      
      return Either.right([either1.right, either2.right] as [R, R2]);
    });
  }
  
  /**
   * Run multiple TaskEithers in sequence
   */
  static sequence<L, R>(tasks: TaskEither<L, R>[]): TaskEither<L, R[]> {
    return new TaskEither(async () => {
      const results: R[] = [];
      
      for (const task of tasks) {
        const either = await task.run();
        if (Either.isLeft(either)) {
          return either;
        }
        results.push(either.right);
      }
      
      return Either.right(results);
    });
  }
  
  /**
   * Run multiple TaskEithers in parallel
   */
  static parallel<L, R>(tasks: TaskEither<L, R>[]): TaskEither<L, R[]> {
    return new TaskEither(async () => {
      const eithers = await Promise.all(tasks.map(task => task.run()));
      const results: R[] = [];
      
      for (const either of eithers) {
        if (Either.isLeft(either)) {
          return either;
        }
        results.push(either.right);
      }
      
      return Either.right(results);
    });
  }
}

/**
 * Utility functions for common operations
 */
export const TaskEitherUtils = {
  /**
   * Create a TaskEither for file reading
   */
  readFile: (path: string): TaskEither<string, string> =>
    TaskEither.tryCatch(
      () => Deno.readTextFile(path),
      (error) => `Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`
    ),
  
  /**
   * Create a TaskEither for file writing
   */
  writeFile: (path: string, content: string): TaskEither<string, void> =>
    TaskEither.tryCatch(
      () => Deno.writeTextFile(path, content),
      (error) => `Failed to write file ${path}: ${error instanceof Error ? error.message : String(error)}`
    ),
  
  /**
   * Create a TaskEither for JSON parsing
   */
  parseJSON: <T>(content: string): TaskEither<string, T> =>
    TaskEither.fromSync(
      () => JSON.parse(content) as T,
      (error) => `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`
    ),
  
  /**
   * Create a TaskEither for JSON stringifying
   */
  stringifyJSON: (value: unknown): TaskEither<string, string> =>
    TaskEither.fromSync(
      () => JSON.stringify(value, null, 2),
      (error) => `Failed to stringify JSON: ${error instanceof Error ? error.message : String(error)}`
    ),
  
  /**
   * Delay execution
   */
  delay: (ms: number): TaskEither<never, void> =>
    TaskEither.from(() => 
      new Promise(resolve => setTimeout(() => resolve(Either.right(undefined)), ms))
    ),
  
  /**
   * Retry a TaskEither operation
   */
  retry: <L, R>(
    task: () => TaskEither<L, R>, 
    maxAttempts: number, 
    delayMs: number = 1000
  ): TaskEither<L, R> => {
    const attempt = async (attemptsLeft: number): Promise<Either<L, R>> => {
      const result = await task().run();
      
      if (Either.isRight(result) || attemptsLeft <= 1) {
        return result;
      }
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return attempt(attemptsLeft - 1);
    };
    
    return TaskEither.from(() => attempt(maxAttempts));
  }
};