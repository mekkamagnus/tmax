/**
 * @file adt.ts
 * @description ADT pattern matching and bifunctor utilities for discriminated unions
 *
 * Provides exhaustive `match` on `_tag`-discriminated unions (compile-time safety
 * via `never`), partial `matchP` returning `Option`, and `bimap` for `Either`.
 */

import { Either } from "./task-either.ts";
import { Option, None, Some } from "./option.ts";

// ---------------------------------------------------------------------------
// Exhaustive pattern matching
// ---------------------------------------------------------------------------

/**
 * Required case handlers for every variant of a discriminated union D.
 * TypeScript enforces exhaustiveness: if a tag is missing from `cases`,
 * the function will not type-check (the return type falls through to `never`).
 */
export type MatchCases<D extends { _tag: string }, R> = {
  [K in D["_tag"]]: (value: Extract<D, { _tag: K }>) => R;
};

/**
 * Exhaustively match a discriminated union value against handlers for every variant.
 *
 * @example
 * match(outcome, {
 *   created: (v) => v.path,
 *   modified: (v) => v.path,
 *   noop: (v) => v.summary,
 * })
 */
export function match<D extends { _tag: string }, R>(
  value: D,
  cases: MatchCases<D, R>,
): R {
  const handler = cases[value._tag as keyof typeof cases];
  return handler(value as never);
}

/**
 * Partial match — returns `None` if no handler matches the tag.
 */
export function matchP<D extends { _tag: string }, R>(
  value: D,
  cases: Partial<MatchCases<D, R>>,
): Option<R> {
  const handler = cases[value._tag as keyof typeof cases];
  if (handler === undefined) return None;
  return Some(handler(value as never));
}

// ---------------------------------------------------------------------------
// Bifunctor operations
// ---------------------------------------------------------------------------

/**
 * Map both sides of an Either simultaneously.
 *
 * @example
 * bimap(
 *   (err) => err.toUpperCase(),
 *   (val) => val.trim(),
 *   Either.left("oops")   // → Either.left("OOPS")
 * )
 */
export function bimap<L, R, L2, R2>(
  onLeft: (left: L) => L2,
  onRight: (right: R) => R2,
  either: Either<L, R>,
): Either<L2, R2> {
  return Either.isLeft(either)
    ? Either.left(onLeft(either.left))
    : Either.right(onRight(either.right));
}
