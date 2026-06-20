/**
 * @file writer.ts
 * @description Writer monad and WriterT<TaskEither> for accumulating log entries alongside computations
 *
 * A Writer<W, A> pairs a value of type A with a log of type W[].
 * WriterT<W, E, A> stacks Writer on top of TaskEither for async effectful computations
 * that accumulate a log — useful for decoupling "what to log" from "when to persist."
 */

import { Either, TaskEither } from "./task-either.ts";

// ---------------------------------------------------------------------------
// Pure Writer
// ---------------------------------------------------------------------------

export interface Writer<W, A> {
  /** The computed value. */
  readonly value: A;
  /** The accumulated log entries. */
  readonly log: readonly W[];
}

/** Create a Writer that succeeds with a value and an empty log. */
export const pure = <W, A>(value: A): Writer<W, A> => ({ value, log: [] });

/** Create a Writer that appends a single log entry (void value). */
export const tell = <W>(entry: W): Writer<W, void> => ({ value: undefined, log: [entry] });

/** Map over the value, preserving the log. */
export const mapW = <W, A, B>(writer: Writer<W, A>, f: (a: A) => B): Writer<W, B> => ({
  value: f(writer.value),
  log: [...writer.log],
});

/** Chain Writers, concatenating logs. */
export const flatMapW = <W, A, B>(writer: Writer<W, A>, f: (a: A) => Writer<W, B>): Writer<W, B> => {
  const next = f(writer.value);
  return { value: next.value, log: [...writer.log, ...next.log] };
};

/** Extract both value and log. */
export const listen = <W, A>(writer: Writer<W, A>): [A, W[]] => [writer.value, [...writer.log]];

// ---------------------------------------------------------------------------
// WriterT — Writer stacked on top of TaskEither
// ---------------------------------------------------------------------------

/**
 * A TaskEither that also accumulates a log of type W.
 *
 * Internally carries [value, W[]] through the TaskEither, so errors
 * short-circuit normally while the log is threaded through on the success path.
 */
export class WriterTaskEither<W, E, A> {
  private constructor(
    private readonly computation: () => Promise<Either<E, [A, W[]]>>,
  ) {}

  // -- Constructors --

  /** Succeed with a value and an empty log. */
  static succeed<W, E = never, A = void>(value: A): WriterTaskEither<W, E, A> {
    return new WriterTaskEither<W, E, A>(() => Promise.resolve(Either.right([value, [] as W[]])));
  }

  /** Fail with an error (empty log). */
  static fail<W, E = string, A = never>(error: E): WriterTaskEither<W, E, A> {
    return new WriterTaskEither<W, E, A>(() => Promise.resolve(Either.left(error)));
  }

  /** Lift a plain TaskEither into WriterT (empty log). */
  static fromTaskEither<W, E, A>(te: TaskEither<E, A>): WriterTaskEither<W, E, A> {
    return new WriterTaskEither<W, E, A>(async () => {
      const result = await te.run();
      return Either.isLeft(result) ? result : Either.right([result.right, [] as W[]]);
    });
  }

  /** Wrap a potentially throwing async computation in tryCatch. */
  static tryCatch<W, A, E = Error>(
    computation: () => Promise<A>,
    onError: (error: unknown) => E,
  ): WriterTaskEither<W, E, A> {
    return new WriterTaskEither<W, E, A>(async () => {
      try {
        const value = await computation();
        return Either.right([value, [] as W[]]);
      } catch (error) {
        return Either.left(onError(error));
      }
    });
  }

  // -- Operations --

  /** Map over the success value, preserving the log. */
  map<B>(f: (a: A) => B): WriterTaskEither<W, E, B> {
    return new WriterTaskEither(async () => {
      const result = await this.computation();
      return Either.isLeft(result) ? result : Either.right([f(result.right[0]), result.right[1]]);
    });
  }

  /** Map over the error value, preserving the log. */
  mapLeft<E2>(f: (e: E) => E2): WriterTaskEither<W, E2, A> {
    return new WriterTaskEither(async () => {
      const result = await this.computation();
      return Either.isLeft(result) ? Either.left(f(result.left)) : result;
    });
  }

  /** Chain WriterTaskEithers, concatenating logs. */
  flatMap<B>(f: (a: A) => WriterTaskEither<W, E, B>): WriterTaskEither<W, E, B> {
    return new WriterTaskEither(async () => {
      const result = await this.computation();
      if (Either.isLeft(result)) return result;
      const [value, log] = result.right;
      const next = await f(value).computation();
      return Either.isLeft(next) ? next : Either.right([next.right[0], [...log, ...next.right[1]]]);
    });
  }

  /** Alias for flatMap. */
  andThen<B>(f: (a: A) => WriterTaskEither<W, E, B>): WriterTaskEither<W, E, B> {
    return this.flatMap(f);
  }

  /** Side-effect on the success value, preserving both value and log. */
  tap(f: (a: A) => void): WriterTaskEither<W, E, A> {
    return this.map((a) => { f(a); return a; });
  }

  /** Side-effect on the error value, preserving it. */
  tapError(f: (e: E) => void): WriterTaskEither<W, E, A> {
    return new WriterTaskEither(async () => {
      const result = await this.computation();
      if (Either.isLeft(result)) f(result.left);
      return result;
    });
  }

  /** Execute and extract value + accumulated log. */
  async run(): Promise<Either<E, [A, W[]]>> {
    return await this.computation();
  }

  /** Convert to a plain TaskEither (discarding the log). */
  toTaskEither(): TaskEither<E, A> {
    return TaskEither.from(this.computation).map(([value]) => value);
  }

  /** Append a log entry without changing the value. */
  tell(entry: W): WriterTaskEither<W, E, A> {
    return new WriterTaskEither(async () => {
      const result = await this.computation();
      return Either.isLeft(result) ? result : Either.right([result.right[0], [...result.right[1], entry]]);
    });
  }
}

// ---------------------------------------------------------------------------
// Convenience re-exports for pipeline use
// ---------------------------------------------------------------------------

/** Append a log entry (void value) inside a WriterTaskEither. */
export const tellW = <W, E>(entry: W): WriterTaskEither<W, E, void> =>
  WriterTaskEither.succeed<W, E, void>(undefined).tell(entry);
