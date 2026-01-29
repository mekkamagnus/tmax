/**
 * @file reader.ts
 * @description Reader Monad pattern for dependency injection
 */

import { TaskEither } from "./task-either.ts";

/**
 * Reader monad for dependency injection
 * Represents a computation that depends on some environment/context
 */
export class Reader<R, A> {
  constructor(private computation: (deps: R) => A) {}
  
  /**
   * Create a Reader that returns a pure value (ignoring dependencies)
   */
  static of<R, A>(value: A): Reader<R, A> {
    return new Reader(() => value);
  }
  
  /**
   * Create a Reader that returns the entire dependency object
   */
  static ask<R>(): Reader<R, R> {
    return new Reader(deps => deps);
  }
  
  /**
   * Create a Reader that extracts a specific part of dependencies
   */
  static asks<R, A>(f: (deps: R) => A): Reader<R, A> {
    return new Reader(f);
  }
  
  /**
   * Run the Reader computation with provided dependencies
   */
  run(deps: R): A {
    return this.computation(deps);
  }
  
  /**
   * Map over the result value
   */
  map<B>(f: (value: A) => B): Reader<R, B> {
    return new Reader(deps => f(this.computation(deps)));
  }
  
  /**
   * FlatMap for chaining Reader computations
   */
  flatMap<B>(f: (value: A) => Reader<R, B>): Reader<R, B> {
    return new Reader(deps => f(this.computation(deps)).run(deps));
  }
  
  /**
   * Alias for flatMap
   */
  andThen<B>(f: (value: A) => Reader<R, B>): Reader<R, B> {
    return this.flatMap(f);
  }
  
  /**
   * Apply a function in a Reader to this Reader's value
   */
  apply<B>(readerF: Reader<R, (value: A) => B>): Reader<R, B> {
    return new Reader(deps => readerF.run(deps)(this.computation(deps)));
  }
  
  /**
   * Transform the dependency type (contravariant functor)
   */
  local<R2>(f: (deps: R2) => R): Reader<R2, A> {
    return new Reader(deps2 => this.computation(f(deps2)));
  }
  
  /**
   * Combine two Readers into a tuple
   */
  zip<B>(other: Reader<R, B>): Reader<R, [A, B]> {
    return new Reader(deps => [this.computation(deps), other.run(deps)]);
  }
  
  /**
   * Filter dependencies based on a predicate
   */
  filter<R2 extends R>(predicate: (deps: R) => deps is R2): Reader<R2, A> {
    return new Reader(deps => this.computation(deps));
  }
  
  /**
   * Handle errors in Reader computation
   */
  tryCatch<E>(onError: (error: unknown) => E): Reader<R, A | E> {
    return new Reader(deps => {
      try {
        return this.computation(deps);
      } catch (error) {
        return onError(error);
      }
    });
  }
}

/**
 * ReaderTaskEither combines Reader with TaskEither for async operations with dependencies
 */
export class ReaderTaskEither<R, L, A> {
  constructor(private computation: (deps: R) => TaskEither<L, A>) {}
  
  /**
   * Create a ReaderTaskEither that returns a pure value
   */
  static of<R, L, A>(value: A): ReaderTaskEither<R, L, A> {
    return new ReaderTaskEither(() => TaskEither.right<A, L>(value));
  }
  
  /**
   * Create a ReaderTaskEither that fails with an error
   */
  static left<R, L, A>(error: L): ReaderTaskEither<R, L, A> {
    return new ReaderTaskEither(() => TaskEither.left<L, A>(error));
  }
  
  /**
   * Get the dependencies
   */
  static ask<R, L>(): ReaderTaskEither<R, L, R> {
    return new ReaderTaskEither(deps => TaskEither.right<R, L>(deps));
  }
  
  /**
   * Get a part of dependencies
   */
  static asks<R, L, A>(f: (deps: R) => A): ReaderTaskEither<R, L, A> {
    return new ReaderTaskEither(deps => TaskEither.right<A, L>(f(deps)));
  }
  
  /**
   * Lift a TaskEither into ReaderTaskEither (ignoring dependencies)
   */
  static lift<R, L, A>(taskEither: TaskEither<L, A>): ReaderTaskEither<R, L, A> {
    return new ReaderTaskEither(() => taskEither);
  }
  
  /**
   * Lift a Reader into ReaderTaskEither (no error handling)
   */
  static liftReader<R, A>(reader: Reader<R, A>): ReaderTaskEither<R, never, A> {
    return new ReaderTaskEither(deps => TaskEither.right(reader.run(deps)));
  }
  
  /**
   * Create from a potentially throwing computation
   */
  static tryCatch<R, L, A>(
    computation: (deps: R) => Promise<A>,
    onError: (error: unknown) => L
  ): ReaderTaskEither<R, L, A> {
    return new ReaderTaskEither(deps => TaskEither.tryCatch(() => computation(deps), onError));
  }
  
  /**
   * Run the ReaderTaskEither with dependencies
   */
  run(deps: R): TaskEither<L, A> {
    return this.computation(deps);
  }
  
  /**
   * Map over the success value
   */
  map<B>(f: (value: A) => B): ReaderTaskEither<R, L, B> {
    return new ReaderTaskEither(deps => this.computation(deps).map(f));
  }
  
  /**
   * Map over the error value
   */
  mapLeft<L2>(f: (error: L) => L2): ReaderTaskEither<R, L2, A> {
    return new ReaderTaskEither(deps => this.computation(deps).mapLeft(f));
  }
  
  /**
   * FlatMap for chaining ReaderTaskEither computations
   */
  flatMap<B>(f: (value: A) => ReaderTaskEither<R, L, B>): ReaderTaskEither<R, L, B> {
    return new ReaderTaskEither(deps => 
      this.computation(deps).flatMap(value => f(value).run(deps))
    );
  }
  
  /**
   * Alias for flatMap
   */
  andThen<B>(f: (value: A) => ReaderTaskEither<R, L, B>): ReaderTaskEither<R, L, B> {
    return this.flatMap(f);
  }
  
  /**
   * Transform the dependency type
   */
  local<R2>(f: (deps: R2) => R): ReaderTaskEither<R2, L, A> {
    return new ReaderTaskEither(deps2 => this.computation(f(deps2)));
  }
  
  /**
   * Handle errors and recover
   */
  orElse(f: (error: L) => ReaderTaskEither<R, L, A>): ReaderTaskEither<R, L, A> {
    return new ReaderTaskEither(deps => 
      TaskEither.from(async () => {
        const result = await this.computation(deps).run();
        if (result._tag === 'Left') {
          return await f(result.left).run(deps).run();
        }
        return result;
      })
    );
  }
  
  /**
   * Combine two ReaderTaskEither computations
   */
  zip<B>(other: ReaderTaskEither<R, L, B>): ReaderTaskEither<R, L, [A, B]> {
    return new ReaderTaskEither(deps => 
      this.computation(deps).zip(other.run(deps))
    );
  }
  
  /**
   * Apply a function in ReaderTaskEither to this value
   */
  apply<B>(readerF: ReaderTaskEither<R, L, (value: A) => B>): ReaderTaskEither<R, L, B> {
    return new ReaderTaskEither(deps => 
      readerF.run(deps).flatMap(f => 
        this.computation(deps).map(f)
      )
    );
  }
  
  /**
   * Fold over both success and error cases
   */
  fold<B>(
    onLeft: (error: L) => B,
    onRight: (value: A) => B
  ): Reader<R, Promise<B>> {
    return new Reader(deps => 
      this.computation(deps).fold(onLeft, onRight).run()
    );
  }
  
  /**
   * Convert to TaskEither by providing dependencies
   */
  toTaskEither(deps: R): TaskEither<L, A> {
    return this.computation(deps);
  }
  
  /**
   * Sequence multiple ReaderTaskEither operations
   */
  static sequence<R, L, A>(operations: ReaderTaskEither<R, L, A>[]): ReaderTaskEither<R, L, A[]> {
    return new ReaderTaskEither(deps => 
      TaskEither.sequence(operations.map(op => op.run(deps)))
    );
  }
  
  /**
   * Run operations in parallel
   */
  static parallel<R, L, A>(operations: ReaderTaskEither<R, L, A>[]): ReaderTaskEither<R, L, A[]> {
    return new ReaderTaskEither(deps => 
      TaskEither.parallel(operations.map(op => op.run(deps)))
    );
  }
  
  /**
   * Traverse a list with a ReaderTaskEither operation
   */
  static traverse<R, L, A, B>(
    items: A[],
    f: (item: A) => ReaderTaskEither<R, L, B>
  ): ReaderTaskEither<R, L, B[]> {
    return ReaderTaskEither.sequence(items.map(f));
  }
}

/**
 * Utility functions for working with dependencies
 */
export const readerUtils = {
  /**
   * Create a Reader that accesses a specific property
   */
  prop: <R, K extends keyof R>(key: K): Reader<R, R[K]> =>
    Reader.asks(deps => deps[key]),
  
  /**
   * Create a Reader that accesses nested properties
   */
  path: <R, A>(pathFn: (deps: R) => A): Reader<R, A> =>
    Reader.asks(pathFn),
  
  /**
   * Create a conditional Reader
   */
  when: <R, A>(
    condition: (deps: R) => boolean,
    reader: Reader<R, A>,
    defaultValue: A
  ): Reader<R, A> =>
    Reader.asks(deps => condition(deps) ? reader.run(deps) : defaultValue),
  
  /**
   * Create a Reader that transforms dependencies
   */
  withDeps: <R, R2, A>(
    transform: (deps: R) => R2,
    reader: Reader<R2, A>
  ): Reader<R, A> =>
    Reader.asks(deps => reader.run(transform(deps))),
  
  /**
   * Create a Reader that provides default values for missing dependencies
   */
  withDefaults: <R, D>(defaults: D): Reader<R & D, R & D> =>
    Reader.asks(deps => ({ ...defaults, ...deps })),
  
  /**
   * Combine multiple dependency injections
   */
  combine: <R1, R2, A, B, C>(
    reader1: Reader<R1, A>,
    reader2: Reader<R2, B>,
    combiner: (a: A, b: B) => C
  ): Reader<R1 & R2, C> =>
    Reader.asks(deps => combiner(reader1.run(deps), reader2.run(deps))),
  
  /**
   * Cache the result of a Reader computation
   */
  memoize: <R, A>(reader: Reader<R, A>): Reader<R, A> => {
    const cache = new WeakMap<R, A>();
    return Reader.asks(deps => {
      if (cache.has(deps)) {
        return cache.get(deps)!;
      }
      const result = reader.run(deps);
      cache.set(deps, result);
      return result;
    });
  }
};

/**
 * Higher-level Reader operations
 */
export const readerCombiners = {
  /**
   * Run multiple Readers in sequence
   */
  sequence: <R, A>(readers: Reader<R, A>[]): Reader<R, A[]> =>
    Reader.asks(deps => readers.map(reader => reader.run(deps))),
  
  /**
   * Apply a function to multiple Reader values
   */
  lift2: <R, A, B, C>(
    f: (a: A, b: B) => C,
    readerA: Reader<R, A>,
    readerB: Reader<R, B>
  ): Reader<R, C> =>
    Reader.asks(deps => f(readerA.run(deps), readerB.run(deps))),
  
  /**
   * Apply a function to three Reader values
   */
  lift3: <R, A, B, C, D>(
    f: (a: A, b: B, c: C) => D,
    readerA: Reader<R, A>,
    readerB: Reader<R, B>,
    readerC: Reader<R, C>
  ): Reader<R, D> =>
    Reader.asks(deps => f(readerA.run(deps), readerB.run(deps), readerC.run(deps))),
  
  /**
   * Choose between Readers based on dependencies
   */
  choose: <R, A>(
    selector: (deps: R) => number,
    readers: Reader<R, A>[]
  ): Reader<R, A> =>
    Reader.asks(deps => {
      const index = selector(deps);
      const reader = readers[index];
      if (!reader) {
        throw new Error(`No reader at index ${index}`);
      }
      return reader.run(deps);
    }),
  
  /**
   * Run Readers until one succeeds
   */
  alternative: <R, A>(readers: Reader<R, A | null>[]): Reader<R, A | null> =>
    Reader.asks(deps => {
      for (const reader of readers) {
        const result = reader.run(deps);
        if (result !== null) {
          return result;
        }
      }
      return null;
    }),
  
  /**
   * Branch based on dependency value
   */
  branch: <R, A, B>(
    predicate: (deps: R) => boolean,
    onTrue: Reader<R, A>,
    onFalse: Reader<R, B>
  ): Reader<R, A | B> =>
    Reader.asks(deps => predicate(deps) ? onTrue.run(deps) : onFalse.run(deps))
};

// Dependency interfaces for tmax editor (example)
export interface FileSystemDeps {
  readonly filesystem: {
    readTextFile: (path: string) => Promise<string>;
    writeTextFile: (path: string, content: string) => Promise<void>;
    exists: (path: string) => Promise<boolean>;
    mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  };
}

export interface LoggerDeps {
  readonly logger: {
    log: (level: string, message: string, ...args: unknown[]) => void;
    debug: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
}

export interface ValidationDeps {
  readonly validator: {
    validatePath: (path: string) => boolean;
    sanitizePath: (path: string) => string;
    isSecure: (path: string) => boolean;
  };
}

export interface BufferDeps {
  readonly currentBuffer: {
    getContent: () => string;
    setContent: (content: string) => void;
    isDirty: () => boolean;
    markClean: () => void;
  } | null;
  readonly buffers: Map<string, {
    getContent: () => string;
    setContent: (content: string) => void;
    isDirty: () => boolean;
    markClean: () => void;
  }>;
}

// Combined dependencies for save operations
export interface SaveDependencies extends FileSystemDeps, LoggerDeps, ValidationDeps, BufferDeps {}

export interface EditorDependencies extends SaveDependencies {
  readonly terminal: {
    write: (text: string) => void;
    clear: () => void;
    moveCursor: (line: number, column: number) => void;
  };
  readonly keyHandler: {
    onKey: (key: string, handler: () => void) => void;
    removeHandler: (key: string) => void;
  };
  readonly statusRenderer: {
    render: (message: string) => void;
    clear: () => void;
  };
}

// Example usage patterns (commented for documentation)
/*
// Basic file operations with dependency injection
const readFileReader = (path: string): ReaderTaskEither<FileSystemDeps, string, string> =>
  ReaderTaskEither.asks<FileSystemDeps, string, FileSystemDeps['filesystem']>(deps => deps.filesystem)
    .flatMap(fs => ReaderTaskEither.lift(
      TaskEither.tryCatch(
        () => fs.readTextFile(path),
        error => `Failed to read ${path}: ${error}`
      )
    ));

const writeFileReader = (path: string, content: string): ReaderTaskEither<FileSystemDeps, string, void> =>
  ReaderTaskEither.asks<FileSystemDeps, string, FileSystemDeps['filesystem']>(deps => deps.filesystem)
    .flatMap(fs => ReaderTaskEither.lift(
      TaskEither.tryCatch(
        () => fs.writeTextFile(path, content),
        error => `Failed to write ${path}: ${error}`
      )
    ));

// Logging operations
const logDebugReader = (message: string): ReaderTaskEither<LoggerDeps, never, void> =>
  ReaderTaskEither.asks<LoggerDeps, never, LoggerDeps['logger']>(deps => deps.logger)
    .map(logger => logger.debug(message));

const logErrorReader = (message: string, error: unknown): ReaderTaskEither<LoggerDeps, never, void> =>
  ReaderTaskEither.asks<LoggerDeps, never, LoggerDeps['logger']>(deps => deps.logger)
    .map(logger => logger.error(message, error));

// Validation operations
const validatePathReader = (path: string): ReaderTaskEither<ValidationDeps, string, string> =>
  ReaderTaskEither.asks<ValidationDeps, string, ValidationDeps['validator']>(deps => deps.validator)
    .flatMap(validator => {
      if (!validator.isSecure(path)) {
        return ReaderTaskEither.left("Insecure path detected");
      }
      if (!validator.validatePath(path)) {
        return ReaderTaskEither.left("Invalid path format");
      }
      return ReaderTaskEither.of(validator.sanitizePath(path));
    });

// Buffer operations
const getCurrentBufferReader = (): ReaderTaskEither<BufferDeps, string, string> =>
  ReaderTaskEither.asks<BufferDeps, string, BufferDeps['currentBuffer']>(deps => deps.currentBuffer)
    .flatMap(buffer => {
      if (!buffer) {
        return ReaderTaskEither.left("No current buffer");
      }
      return ReaderTaskEither.of(buffer.getContent());
    });

// Complex save operation combining all dependencies
const saveCurrentBufferReader = (filename?: string): ReaderTaskEither<SaveDependencies, string, void> =>
  ReaderTaskEither.ask<SaveDependencies, string>()
    .flatMap(deps => {
      // Get current buffer content
      return getCurrentBufferReader()
        .flatMap(content => {
          // Determine filename
          const resolvedFilename = filename || "untitled.txt";
          
          // Validate path
          return validatePathReader(resolvedFilename)
            .tap(path => logDebugReader(`Saving to: ${path}`))
            // Write file
            .flatMap(path => writeFileReader(path, content))
            // Update buffer status
            .tap(() => ReaderTaskEither.asks<SaveDependencies, string, void>(deps => {
              if (deps.currentBuffer) {
                deps.currentBuffer.markClean();
              }
            }))
            // Log success
            .tap(() => logDebugReader(`Successfully saved ${resolvedFilename}`))
            .map(() => undefined);
        })
        .orElse(error => 
          logErrorReader("Save failed", error)
            .flatMap(() => ReaderTaskEither.left(error))
        );
    });

// Usage with actual dependencies
const dependencies: SaveDependencies = {
  filesystem: {
    readTextFile: async (path: string) => {
      const { readFile } = await import("node:fs/promises");
      return await readFile(path, "utf-8");
    },
    writeTextFile: async (path: string, content: string) => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path, content, "utf-8");
    },
    exists: async (path: string) => {
      try {
        const { stat } = await import("node:fs/promises");
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
    mkdir: async (path: string, options?: { recursive?: boolean }) => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(path, options);
    }
  },
  logger: {
    log: console.log,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error
  },
  validator: {
    validatePath: (path) => !path.includes('..'),
    sanitizePath: (path) => path.replace(/\\/g, '/'),
    isSecure: (path) => !path.includes('..')
  },
  currentBuffer: getCurrentBufferInstance(),
  buffers: getBuffersMap()
};

// Execute the save operation
const result = await saveCurrentBufferReader("example.txt")
  .run(dependencies)
  .run();

if (result._tag === 'Left') {
  console.error("Save failed:", result.left);
} else {
  console.log("Save successful");
}
*/