/**
 * @file fp.ts — functional utilities local to the tmax-patch-review skill.
 *
 * Mirrors the naming of the app's src/utils/{task-either,option}.ts so it reads
 * the same to contributors, but is self-contained: the skill does not couple to
 * src/ (which isn't in any tsconfig include, and shouldn't be a runtime dep of
 * a CI/agent tool). Three exports: Either, Option, TaskEither.
 */

// ───────────────────────── Either ─────────────────────────

export type Either<L, R> =
  | { readonly _tag: "Left"; readonly left: L }
  | { readonly _tag: "Right"; readonly right: R };

export const Left = <L, R = never>(left: L): Either<L, R> => ({ _tag: "Left", left });
export const Right = <R, L = never>(right: R): Either<L, R> => ({ _tag: "Right", right });

export const Either = {
  isLeft: <L, R>(e: Either<L, R>): boolean => e._tag === "Left",
  isRight: <L, R>(e: Either<L, R>): boolean => e._tag === "Right",
  map: <L, R, R2>(e: Either<L, R>, f: (r: R) => R2): Either<L, R2> =>
    e._tag === "Right" ? Right(f(e.right)) : e,
  mapLeft: <L, R, L2>(e: Either<L, R>, f: (l: L) => L2): Either<L2, R> =>
    e._tag === "Left" ? Left(f(e.left)) : e,
  flatMap: <L, R, R2>(e: Either<L, R>, f: (r: R) => Either<L, R2>): Either<L, R2> =>
    e._tag === "Right" ? f(e.right) : e,
  fold: <L, R, T>(e: Either<L, R>, onLeft: (l: L) => T, onRight: (r: R) => T): T =>
    e._tag === "Left" ? onLeft(e.left) : onRight(e.right),
  getOrElse: <L, R>(e: Either<L, R>, d: R): R => (e._tag === "Right" ? e.right : d),
  tryCatch: <R>(f: () => R): Either<Error, R> => {
    try {
      return Right(f());
    } catch (e) {
      return Left(e instanceof Error ? e : new Error(String(e)));
    }
  },
};

// ───────────────────────── Option ─────────────────────────

export type Option<T> =
  | { readonly _tag: "Some"; readonly value: T }
  | { readonly _tag: "None" };

export const Some = <T>(value: T): Option<T> => ({ _tag: "Some", value });
export const None: Option<never> = { _tag: "None" };

export const Option = {
  isSome: <T>(o: Option<T>): boolean => o._tag === "Some",
  isNone: <T>(o: Option<T>): boolean => o._tag === "None",
  fromNullable: <T>(v: T | null | undefined): Option<T> => (v == null ? None : Some(v)),
  map: <T, U>(o: Option<T>, f: (v: T) => U): Option<U> =>
    o._tag === "Some" ? Some(f(o.value)) : None,
  flatMap: <T, U>(o: Option<T>, f: (v: T) => Option<U>): Option<U> =>
    o._tag === "Some" ? f(o.value) : None,
  fold: <T, U>(o: Option<T>, onNone: () => U, onSome: (v: T) => U): U =>
    o._tag === "Some" ? onSome(o.value) : onNone(),
  getOrElse: <T>(o: Option<T>, d: T): T => (o._tag === "Some" ? o.value : d),
};

// ──────────────────────── TaskEither ──────────────────────
// Lazy async computation that resolves to Either. Used for the shell/file
// effects in audit.ts; errors propagate as Left (no throws across the boundary).

export class TaskEither<L, R> {
  private constructor(private readonly computation: () => Promise<Either<L, R>>) {}

  static right<R, L = never>(r: R): TaskEither<L, R> {
    return new TaskEither(() => Promise.resolve(Right(r)));
  }
  static left<L, R = never>(l: L): TaskEither<L, R> {
    return new TaskEither(() => Promise.resolve(Left(l)));
  }
  static from<L, R>(run: () => Promise<Either<L, R>>): TaskEither<L, R> {
    return new TaskEither(run);
  }
  static fromEither<L, R>(e: Either<L, R>): TaskEither<L, R> {
    return new TaskEither(() => Promise.resolve(e));
  }
  static tryCatch<R, L = Error>(
    run: () => Promise<R> | R,
    onErr?: (e: unknown) => L,
  ): TaskEither<L, R> {
    return new TaskEither(async () => {
      try {
        return Right(await run());
      } catch (e) {
        const l = onErr
          ? onErr(e)
          : ((e instanceof Error ? e : new Error(String(e))) as unknown as L);
        return Left(l);
      }
    });
  }
  static sequence<L, R>(tasks: ReadonlyArray<TaskEither<L, R>>): TaskEither<L, R[]> {
    return new TaskEither(async () => {
      const out: R[] = [];
      for (const t of tasks) {
        const e = await t.run();
        if (e._tag === "Left") return e;
        out.push(e.right);
      }
      return Right(out);
    });
  }

  async run(): Promise<Either<L, R>> {
    return this.computation();
  }

  map<R2>(f: (r: R) => R2): TaskEither<L, R2> {
    return new TaskEither(async () => Either.map(await this.run(), f));
  }
  mapLeft<L2>(f: (l: L) => L2): TaskEither<L2, R> {
    return new TaskEither(async () => Either.mapLeft(await this.run(), f));
  }
  flatMap<R2>(f: (r: R) => TaskEither<L, R2>): TaskEither<L, R2> {
    return new TaskEither(async () => {
      const e = await this.run();
      return e._tag === "Left" ? e : await f(e.right).run();
    });
  }
  andThen<R2>(f: (r: R) => TaskEither<L, R2>): TaskEither<L, R2> {
    return this.flatMap(f);
  }
  tap(effect: (r: R) => void): TaskEither<L, R> {
    return new TaskEither(async () => {
      const e = await this.run();
      if (e._tag === "Right") effect(e.right);
      return e;
    });
  }
}
