/**
 * @file effect.ts
 * @description Effect Pattern for controlled side effects with explicit dependency management
 */

import { TaskEither } from "./task-either.ts";
import { Reader } from "./reader.ts";

/**
 * Effect type - represents a computation that depends on environment R,
 * may fail with error E, and produces value A
 */
export type Effect<R, E, A> = (deps: R) => TaskEither<E, A>;

/**
 * Effect constructors and utilities
 */
export const Effect = {
  /**
   * Create an Effect that succeeds with a value
   */
  succeed: <R, E, A>(value: A): Effect<R, E, A> =>
    () => TaskEither.right<A, E>(value),
  
  /**
   * Create an Effect that fails with an error
   */
  fail: <R, E, A>(error: E): Effect<R, E, A> =>
    () => TaskEither.left<E, A>(error),
  
  /**
   * Get the environment dependencies
   */
  access: <R, E>(): Effect<R, E, R> =>
    deps => TaskEither.right<R, E>(deps),
  
  /**
   * Get dependencies and immediately use them in another Effect
   */
  accessM: <R, E, A>(f: (deps: R) => TaskEither<E, A>): Effect<R, E, A> =>
    deps => f(deps),
  
  /**
   * Lift a TaskEither into an Effect (ignoring environment)
   */
  fromTaskEither: <R, E, A>(taskEither: TaskEither<E, A>): Effect<R, E, A> =>
    () => taskEither,
  
  /**
   * Create an Effect from a potentially throwing computation
   */
  tryCatch: <R, E, A>(
    f: (deps: R) => Promise<A>,
    onError: (error: unknown) => E
  ): Effect<R, E, A> =>
    deps => TaskEither.tryCatch(() => f(deps), onError),
  
  /**
   * Create an Effect from a synchronous computation
   */
  fromSync: <R, E, A>(
    f: (deps: R) => A,
    onError: (error: unknown) => E
  ): Effect<R, E, A> =>
    deps => TaskEither.fromSync(() => f(deps), onError),
  
  /**
   * Create an Effect that performs a side effect and returns void
   */
  sideEffect: <R, E>(f: (deps: R) => void): Effect<R, E, void> =>
    deps => TaskEither.fromSync(() => f(deps), () => undefined as E),
  
  /**
   * Create an Effect that performs an async side effect
   */
  asyncSideEffect: <R, E>(
    f: (deps: R) => Promise<void>,
    onError: (error: unknown) => E
  ): Effect<R, E, void> =>
    deps => TaskEither.tryCatch(() => f(deps), onError),
};

/**
 * Effect combinators for composition
 */
export const EffectOps = {
  /**
   * Map over the success value
   */
  map: <R, E, A, B>(effect: Effect<R, E, A>, f: (value: A) => B): Effect<R, E, B> =>
    deps => effect(deps).map(f),
  
  /**
   * Map over the error value
   */
  mapError: <R, E, A, E2>(effect: Effect<R, E, A>, f: (error: E) => E2): Effect<R, E2, A> =>
    deps => effect(deps).mapLeft(f),
  
  /**
   * FlatMap for chaining Effects
   */
  flatMap: <R, E, A, B>(
    effect: Effect<R, E, A>,
    f: (value: A) => Effect<R, E, B>
  ): Effect<R, E, B> =>
    deps => effect(deps).flatMap(value => f(value)(deps)),
  
  /**
   * Handle errors and recover
   */
  catchAll: <R, E, A>(
    effect: Effect<R, E, A>,
    handler: (error: E) => Effect<R, E, A>
  ): Effect<R, E, A> =>
    deps => TaskEither.from(async () => {
      const result = await effect(deps).run();
      if (result._tag === 'Left') {
        return await handler(result.left)(deps).run();
      }
      return result;
    }),
  
  /**
   * Handle specific errors
   */
  catch: <R, E, A, E2>(
    effect: Effect<R, E | E2, A>,
    predicate: (error: E | E2) => error is E,
    handler: (error: E) => Effect<R, E2, A>
  ): Effect<R, E2, A> =>
    deps => TaskEither.from(async () => {
      const result = await effect(deps).run();
      if (result._tag === 'Left' && predicate(result.left)) {
        return await handler(result.left)(deps).run();
      }
      return result as { _tag: 'Right'; right: A } | { _tag: 'Left'; left: E2 };
    }),
  
  /**
   * Transform the environment
   */
  provideSome: <R, R2, E, A>(
    effect: Effect<R, E, A>,
    f: (deps: R2) => R
  ): Effect<R2, E, A> =>
    deps2 => effect(f(deps2)),
  
  /**
   * Provide the full environment
   */
  provide: <R, E, A>(effect: Effect<R, E, A>, deps: R): TaskEither<E, A> =>
    effect(deps),
  
  /**
   * Apply a function Effect to a value Effect
   */
  apply: <R, E, A, B>(
    effectF: Effect<R, E, (value: A) => B>,
    effectA: Effect<R, E, A>
  ): Effect<R, E, B> =>
    deps => effectF(deps).flatMap(f => effectA(deps).map(f)),
  
  /**
   * Combine two Effects into a tuple
   */
  zip: <R, E, A, B>(
    effectA: Effect<R, E, A>,
    effectB: Effect<R, E, B>
  ): Effect<R, E, [A, B]> =>
    deps => effectA(deps).zip(effectB(deps)),
  
  /**
   * Run Effects in parallel
   */
  parallel: <R, E, A>(effects: Effect<R, E, A>[]): Effect<R, E, A[]> =>
    deps => TaskEither.parallel(effects.map(effect => effect(deps))),
  
  /**
   * Run Effects in sequence
   */
  sequence: <R, E, A>(effects: Effect<R, E, A>[]): Effect<R, E, A[]> =>
    deps => TaskEither.sequence(effects.map(effect => effect(deps))),
  
  /**
   * Race multiple Effects
   */
  race: <R, E, A>(effects: Effect<R, E, A>[]): Effect<R, E, A> =>
    deps => TaskEither.from(() => 
      Promise.race(effects.map(effect => effect(deps).run()))
    ),
  
  /**
   * Run an Effect and ignore its result
   */
  ignore: <R, E, A>(effect: Effect<R, E, A>): Effect<R, E, void> =>
    deps => effect(deps).map(() => undefined),
  
  /**
   * Conditional execution
   */
  when: <R, E>(
    condition: boolean,
    effect: Effect<R, E, void>
  ): Effect<R, E, void> =>
    condition ? effect : Effect.succeed<R, E, void>(undefined),
  
  /**
   * Execute Effect only if condition from environment is true
   */
  whenM: <R, E>(
    condition: Effect<R, E, boolean>,
    effect: Effect<R, E, void>
  ): Effect<R, E, void> =>
    deps => condition(deps).flatMap(cond => 
      cond ? effect(deps) : TaskEither.right<void, E>(undefined)
    ),
  
  /**
   * Retry an Effect with exponential backoff
   */
  retry: <R, E, A>(
    effect: Effect<R, E, A>,
    maxAttempts: number,
    baseDelayMs: number = 1000
  ): Effect<R, E, A> =>
    deps => {
      const attempt = async (attemptsLeft: number): Promise<{ _tag: 'Left'; left: E } | { _tag: 'Right'; right: A }> => {
        const result = await effect(deps).run();
        
        if (result._tag === 'Right' || attemptsLeft <= 1) {
          return result;
        }
        
        const delay = baseDelayMs * Math.pow(2, maxAttempts - attemptsLeft);
        await new Promise(resolve => setTimeout(resolve, delay));
        return attempt(attemptsLeft - 1);
      };
      
      return TaskEither.from(() => attempt(maxAttempts));
    },
  
  /**
   * Timeout an Effect
   */
  timeout: <R, E, A>(
    effect: Effect<R, E, A>,
    timeoutMs: number,
    onTimeout: () => E
  ): Effect<R, E, A> =>
    deps => {
      const timeoutPromise = new Promise<{ _tag: 'Left'; left: E }>((_, reject) =>
        setTimeout(() => reject({ _tag: 'Left', left: onTimeout() }), timeoutMs)
      );
      
      return TaskEither.from(() => 
        Promise.race([effect(deps).run(), timeoutPromise])
      );
    },
  
  /**
   * Measure execution time of an Effect
   */
  timed: <R, E, A>(effect: Effect<R, E, A>): Effect<R, E, [A, number]> =>
    deps => TaskEither.from(async () => {
      const start = performance.now();
      const result = await effect(deps).run();
      const duration = performance.now() - start;
      
      if (result._tag === 'Right') {
        return { _tag: 'Right', right: [result.right, duration] as [A, number] };
      } else {
        return result;
      }
    }),
  
  /**
   * Log the result of an Effect
   */
  tap: <R, E, A>(
    effect: Effect<R, E, A>,
    f: (value: A) => Effect<R, never, void>
  ): Effect<R, E, A> =>
    deps => effect(deps).flatMap(value => 
      f(value)(deps).map(() => value)
    )
};

/**
 * Pipeline builder for Effects
 */
export class EffectPipeline<R, E, A> {
  constructor(private effect: Effect<R, E, A>) {}
  
  /**
   * Map over the success value
   */
  map<B>(f: (value: A) => B): EffectPipeline<R, E, B> {
    return new EffectPipeline(EffectOps.map(this.effect, f));
  }
  
  /**
   * FlatMap for chaining
   */
  flatMap<B>(f: (value: A) => Effect<R, E, B>): EffectPipeline<R, E, B> {
    return new EffectPipeline(EffectOps.flatMap(this.effect, f));
  }
  
  /**
   * Handle errors
   */
  catchAll(handler: (error: E) => Effect<R, E, A>): EffectPipeline<R, E, A> {
    return new EffectPipeline(EffectOps.catchAll(this.effect, handler));
  }
  
  /**
   * Apply side effect
   */
  tap(f: (value: A) => Effect<R, never, void>): EffectPipeline<R, E, A> {
    return new EffectPipeline(EffectOps.tap(this.effect, f));
  }
  
  /**
   * Transform environment
   */
  provideSome<R2>(f: (deps: R2) => R): EffectPipeline<R2, E, A> {
    return new EffectPipeline(EffectOps.provideSome(this.effect, f));
  }
  
  /**
   * Retry with exponential backoff
   */
  retry(maxAttempts: number, baseDelayMs: number = 1000): EffectPipeline<R, E, A> {
    return new EffectPipeline(EffectOps.retry(this.effect, maxAttempts, baseDelayMs));
  }
  
  /**
   * Add timeout
   */
  timeout(timeoutMs: number, onTimeout: () => E): EffectPipeline<R, E, A> {
    return new EffectPipeline(EffectOps.timeout(this.effect, timeoutMs, onTimeout));
  }
  
  /**
   * Measure execution time
   */
  timed(): EffectPipeline<R, E, [A, number]> {
    return new EffectPipeline(EffectOps.timed(this.effect));
  }
  
  /**
   * Build the final Effect
   */
  build(): Effect<R, E, A> {
    return this.effect;
  }
  
  /**
   * Run with dependencies
   */
  provide(deps: R): TaskEither<E, A> {
    return this.effect(deps);
  }
}

/**
 * Effect pipeline factory
 */
export const effectPipe = {
  /**
   * Start with a pure value
   */
  succeed: <R, E, A>(value: A) => new EffectPipeline(Effect.succeed<R, E, A>(value)),
  
  /**
   * Start with an existing Effect
   */
  from: <R, E, A>(effect: Effect<R, E, A>) => new EffectPipeline(effect),
  
  /**
   * Start with a computation that may fail
   */
  tryCatch: <R, E, A>(
    f: (deps: R) => Promise<A>,
    onError: (error: unknown) => E
  ) => new EffectPipeline(Effect.tryCatch(f, onError)),
  
  /**
   * Start with environment access
   */
  access: <R, E>() => new EffectPipeline(Effect.access<R, E>()),
};

/**
 * Resource management with automatic cleanup
 */
export const effectResource = {
  /**
   * Bracket pattern for resource management
   */
  bracket: <R, E, A, B>(
    acquire: Effect<R, E, A>,
    use: (resource: A) => Effect<R, E, B>,
    release: (resource: A) => Effect<R, never, void>
  ): Effect<R, E, B> =>
    deps => TaskEither.from(async () => {
      const acquireResult = await acquire(deps).run();
      if (acquireResult._tag === 'Left') {
        return acquireResult;
      }
      
      const resource = acquireResult.right;
      try {
        const useResult = await use(resource)(deps).run();
        return useResult;
      } finally {
        // Always run cleanup, ignoring errors
        try {
          await release(resource)(deps).run();
        } catch {
          // Cleanup errors are ignored to not mask original errors
        }
      }
    }),
  
  /**
   * Acquire a resource that will be automatically cleaned up
   */
  scoped: <R, E, A>(
    acquire: Effect<R, E, A>,
    release: (resource: A) => Effect<R, never, void>
  ) => ({
    use: <B>(f: (resource: A) => Effect<R, E, B>): Effect<R, E, B> =>
      effectResource.bracket(acquire, f, release)
  }),
  
  /**
   * Finally block - always execute cleanup
   */
  ensuring: <R, E, A>(
    effect: Effect<R, E, A>,
    finalizer: Effect<R, never, void>
  ): Effect<R, E, A> =>
    deps => TaskEither.from(async () => {
      try {
        const result = await effect(deps).run();
        return result;
      } finally {
        try {
          await finalizer(deps).run();
        } catch {
          // Finalizer errors are ignored
        }
      }
    })
};

// Example usage patterns for tmax (commented for documentation)
/*
// File system operations
const readFileEffect = (path: string): Effect<FileSystemDeps, string, string> =>
  Effect.tryCatch(
    deps => deps.filesystem.readTextFile(path),
    error => `Failed to read ${path}: ${error}`
  );

const writeFileEffect = (path: string, content: string): Effect<FileSystemDeps, string, void> =>
  Effect.tryCatch(
    deps => deps.filesystem.writeTextFile(path, content),
    error => `Failed to write ${path}: ${error}`
  );

// Logging effects
const logEffect = (level: string, message: string): Effect<LoggerDeps, never, void> =>
  Effect.sideEffect(deps => deps.logger.log(level, message));

const debugEffect = (message: string): Effect<LoggerDeps, never, void> =>
  logEffect("debug", message);

const infoEffect = (message: string): Effect<LoggerDeps, never, void> =>
  logEffect("info", message);

const errorEffect = (message: string, error?: unknown): Effect<LoggerDeps, never, void> =>
  Effect.sideEffect(deps => deps.logger.error(message, error));

// Terminal operations
const writeTerminalEffect = (text: string): Effect<TerminalDeps, string, void> =>
  Effect.tryCatch(
    deps => Promise.resolve(deps.terminal.write(text)),
    error => `Terminal write failed: ${error}`
  );

const clearTerminalEffect = (): Effect<TerminalDeps, never, void> =>
  Effect.sideEffect(deps => deps.terminal.clear());

// Validation effects
const validatePathEffect = (path: string): Effect<ValidationDeps, string, string> =>
  Effect.accessM(deps => {
    if (!deps.validator.isSecure(path)) {
      return TaskEither.left("Security violation: path contains '..'");
    }
    if (!deps.validator.validatePath(path)) {
      return TaskEither.left("Invalid path format");
    }
    return TaskEither.right(deps.validator.sanitizePath(path));
  });

// Complex composed save effect
const saveFileEffect = (filename: string, content: string): Effect<SaveDependencies, string, void> =>
  effectPipe
    .from(debugEffect(`Starting save: ${filename}`))
    .flatMap(() => validatePathEffect(filename))
    .tap(validPath => infoEffect(`Validated path: ${validPath}`))
    .flatMap(validPath => effectPipe
      .from(writeFileEffect(validPath, content))
      .retry(3, 1000) // Retry up to 3 times with exponential backoff
      .timeout(5000, () => "Save operation timed out")
      .build()
    )
    .tap(() => infoEffect(`File saved successfully: ${filename}`))
    .catchAll(error => 
      effectPipe
        .from(errorEffect(`Save failed: ${error}`, error))
        .flatMap(() => Effect.fail<SaveDependencies, string, void>(error))
        .build()
    )
    .build();

// Resource-managed file operations
const safeFileOperation = (path: string): Effect<FileSystemDeps, string, string> =>
  effectResource.bracket(
    // Acquire: open file handle (conceptual)
    Effect.succeed({ path, handle: "file-handle" }),
    // Use: read file content
    handle => readFileEffect(handle.path),
    // Release: close file handle (conceptual)
    handle => Effect.sideEffect(() => console.log(`Closed ${handle.path}`))
  );

// Parallel operations
const loadProjectFiles = (projectPath: string): Effect<FileSystemDeps, string, string[]> =>
  EffectOps.parallel([
    readFileEffect(`${projectPath}/package.json`),
    readFileEffect(`${projectPath}/README.md`),
    readFileEffect(`${projectPath}/src/main.ts`)
  ]);

// Complex editor operation with multiple dependencies
const performSaveOperation = (filename: string): Effect<EditorDependencies, string, void> =>
  effectPipe
    .access<EditorDependencies, string>()
    .flatMap(deps => {
      if (!deps.currentBuffer) {
        return Effect.fail<EditorDependencies, string, void>("No buffer to save");
      }
      
      return effectPipe
        .succeed(deps.currentBuffer.getContent())
        .flatMap(content => saveFileEffect(filename, content))
        .tap(() => Effect.sideEffect<EditorDependencies, never, void>(deps => {
          deps.statusRenderer.render(`Saved ${filename}`);
          if (deps.currentBuffer) {
            deps.currentBuffer.markClean();
          }
        }))
        .provideSome((deps: EditorDependencies) => ({
          filesystem: deps.filesystem,
          logger: deps.logger,
          validator: deps.validator,
          currentBuffer: deps.currentBuffer,
          buffers: deps.buffers
        }))
        .build();
    })
    .build();

// Usage with dependency injection
const dependencies: EditorDependencies = {
  filesystem: {
    readTextFile: Deno.readTextFile,
    writeTextFile: Deno.writeTextFile,
    exists: async (path) => {
      try {
        await Deno.stat(path);
        return true;
      } catch {
        return false;
      }
    },
    mkdir: Deno.mkdir
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
  currentBuffer: getCurrentBuffer(),
  buffers: getBuffers(),
  terminal: getTerminal(),
  keyHandler: getKeyHandler(),
  statusRenderer: getStatusRenderer()
};

// Execute the effect
const result = await performSaveOperation("example.txt")(dependencies).run();
result.fold(
  error => console.error("Operation failed:", error),
  () => console.log("Operation completed successfully")
);
*/