/**
 * @file pipeline.ts
 * @description Pipeline/Kleisli composition enhancement for readable functional pipelines
 */

import { TaskEither } from "./task-either.ts";

/**
 * Pipeline builder for clean, readable sequential operations
 */
export class PipelineBuilder<E, A> {
  constructor(private current: TaskEither<E, A>) {}
  
  /**
   * Execute a computation step that may fail
   */
  step<B>(f: (value: A) => TaskEither<E, B>): PipelineBuilder<E, B> {
    return new PipelineBuilder(this.current.flatMap(f));
  }
  
  /**
   * Transform the current value
   */
  map<B>(f: (value: A) => B): PipelineBuilder<E, B> {
    return new PipelineBuilder(this.current.map(f));
  }
  
  /**
   * Perform a side effect without changing the value
   */
  effect(f: (value: A) => void): PipelineBuilder<E, A> {
    return new PipelineBuilder(this.current.map(value => {
      f(value);
      return value;
    }));
  }
  
  /**
   * Perform an async side effect, discarding its result
   */
  tap<B>(f: (value: A) => TaskEither<E, B>): PipelineBuilder<E, A> {
    return new PipelineBuilder(this.current.flatMap(value => 
      f(value).map(() => value)
    ));
  }
  
  /**
   * Handle errors by providing an alternative computation
   */
  recover(f: (error: E) => TaskEither<E, A>): PipelineBuilder<E, A> {
    return new PipelineBuilder(
      TaskEither.from(async () => {
        const result = await this.current.run();
        if (result._tag === 'Left') {
          return await f(result.left).run();
        }
        return result;
      })
    );
  }
  
  /**
   * Conditionally execute a step based on the current value
   */
  when(predicate: (value: A) => boolean, f: (value: A) => TaskEither<E, A>): PipelineBuilder<E, A> {
    return new PipelineBuilder(this.current.flatMap(value => 
      predicate(value) ? f(value) : TaskEither.right<A, E>(value)
    ));
  }
  
  /**
   * Filter values, converting to error if predicate fails
   */
  filter(predicate: (value: A) => boolean, error: E): PipelineBuilder<E, A> {
    return new PipelineBuilder(this.current.flatMap(value => 
      predicate(value) ? TaskEither.right<A, E>(value) : TaskEither.left<E, A>(error)
    ));
  }
  
  /**
   * Validate the current value
   */
  validate<B extends A>(
    validator: (value: A) => value is B,
    error: E
  ): PipelineBuilder<E, B> {
    return new PipelineBuilder(this.current.flatMap(value => 
      validator(value) ? TaskEither.right<B, E>(value) : TaskEither.left<E, B>(error)
    ));
  }
  
  /**
   * Apply a transformation only if the value is not null/undefined
   */
  mapOptional<B>(
    f: (value: NonNullable<A>) => B,
    error: E
  ): PipelineBuilder<E, B> {
    return new PipelineBuilder(this.current.flatMap(value => 
      value != null ? TaskEither.right<B, E>(f(value as NonNullable<A>)) : TaskEither.left<E, B>(error)
    ));
  }
  
  /**
   * Execute all steps in parallel and combine results
   */
  parallel<B, C>(
    other: PipelineBuilder<E, B>,
    combiner: (a: A, b: B) => C
  ): PipelineBuilder<E, C> {
    return new PipelineBuilder(
      TaskEither.parallel([this.current, other.current])
        .map(([a, b]) => combiner(a, b))
    );
  }
  
  /**
   * Race with another pipeline, taking the first to complete
   */
  race(other: PipelineBuilder<E, A>): PipelineBuilder<E, A> {
    return new PipelineBuilder(
      TaskEither.from(() => 
        Promise.race([this.current.run(), other.current.run()])
      )
    );
  }
  
  /**
   * Build the final TaskEither
   */
  build(): TaskEither<E, A> {
    return this.current;
  }
  
  /**
   * Execute the pipeline and return the result
   */
  async run() {
    return await this.current.run();
  }
}

/**
 * Pipeline factory functions
 */
export const pipe = {
  /**
   * Start a pipeline with a pure value
   */
  start: <A>(value: A) => new PipelineBuilder(TaskEither.right(value)),
  
  /**
   * Start a pipeline from an existing TaskEither
   */
  from: <E, A>(taskEither: TaskEither<E, A>) => new PipelineBuilder(taskEither),
  
  /**
   * Start a pipeline from a computation that may fail
   */
  tryCatch: <A, E = Error>(
    computation: () => Promise<A>,
    onError?: (error: unknown) => E
  ) => new PipelineBuilder(TaskEither.tryCatch(computation, onError)),
  
  /**
   * Start a pipeline from a synchronous computation
   */
  fromSync: <A, E = Error>(
    computation: () => A,
    onError?: (error: unknown) => E
  ) => new PipelineBuilder(TaskEither.fromSync(computation, onError)),
};

/**
 * Kleisli composition utilities for function composition
 */
export const kleisli = {
  /**
   * Compose two Kleisli arrows (functions returning TaskEither)
   */
  compose: <E, A, B, C>(
    f: (a: A) => TaskEither<E, B>,
    g: (b: B) => TaskEither<E, C>
  ) => (a: A): TaskEither<E, C> => f(a).flatMap(g),
  
  /**
   * Compose multiple Kleisli arrows
   */
  composeAll: <E, A>(...functions: Array<(a: A) => TaskEither<E, A>>) => 
    (initial: A): TaskEither<E, A> => 
      functions.reduce(
        (acc, f) => acc.flatMap(f),
        TaskEither.right<A, E>(initial)
      ),
  
  /**
   * Lift a pure function into the TaskEither context
   */
  lift: <A, B>(f: (a: A) => B) => (a: A): TaskEither<never, B> => 
    TaskEither.right<B, never>(f(a)),
  
  /**
   * Lift a function that may throw into TaskEither
   */
  liftTryCatch: <A, B, E = Error>(
    f: (a: A) => B,
    onError?: (error: unknown) => E
  ) => (a: A): TaskEither<E, B> => 
    TaskEither.fromSync(() => f(a), onError),
};

/**
 * Utility functions for common pipeline patterns
 */
export const pipeUtils = {
  /**
   * Log a value at a specific point in the pipeline
   */
  log: <A>(message: string) => (value: A): A => {
    console.log(`${message}:`, value);
    return value;
  },
  
  /**
   * Assert a condition in the pipeline
   */
  assert: <E>(predicate: boolean, error: E): TaskEither<E, void> =>
    predicate ? TaskEither.right<void, E>(undefined) : TaskEither.left<E, void>(error),
  
  /**
   * Delay execution in the pipeline
   */
  delay: (ms: number): TaskEither<never, void> =>
    TaskEither.from(() => 
      new Promise(resolve => setTimeout(() => resolve({ _tag: 'Right', right: undefined } as const), ms))
    ),
  
  /**
   * Retry a pipeline operation with exponential backoff
   */
  retry: <E, A>(
    pipeline: () => PipelineBuilder<E, A>,
    maxAttempts: number,
    baseDelayMs: number = 1000
  ): TaskEither<E, A> => {
    const attempt = async (attemptsLeft: number): Promise<{ _tag: 'Left'; left: E } | { _tag: 'Right'; right: A }> => {
      const result = await pipeline().run();
      
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
   * Execute pipelines in sequence, collecting all results
   */
  sequence: <E, A>(pipelines: Array<() => PipelineBuilder<E, A>>): TaskEither<E, A[]> =>
    TaskEither.sequence(pipelines.map(p => p().build())),
  
  /**
   * Execute pipelines in parallel, collecting all results
   */
  parallel: <E, A>(pipelines: Array<() => PipelineBuilder<E, A>>): TaskEither<E, A[]> =>
    TaskEither.parallel(pipelines.map(p => p().build())),
};

/**
 * Type-safe pipeline operators using symbol
 */
export const $ = Symbol('pipeline-operator');

// Example pipeline usage patterns (commented for documentation)
/*
// Basic pipeline usage
const result = await pipe
  .start(inputData)
  .step(validateInput)
  .step(processData)
  .map(formatOutput)
  .effect(logResult)
  .run();

// Complex pipeline with error handling
const saveFilePipeline = (filename: string, content: string) =>
  pipe
    .start({ filename, content })
    .step(({ filename }) => validateFilename(filename))
    .step(({ filename, content }) => ensureDirectoryExists(filename).map(() => ({ filename, content })))
    .step(({ filename, content }) => writeFileContent(filename, content))
    .effect(({ filename }) => logSuccess(`File saved: ${filename}`))
    .recover(error => logError(error).map(() => ({ filename, content })))
    .map(() => undefined);

// Parallel operations
const loadProjectData = (projectPath: string) =>
  pipe
    .start(projectPath)
    .parallel(
      pipe.from(loadConfig(projectPath)),
      (path, config) => ({ path, config })
    )
    .step(({ path, config }) => loadMainFile(path, config))
    .build();
*/