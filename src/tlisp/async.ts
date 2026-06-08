import type { AppError } from "../error/types.ts";
import type { EvalContext, TLispPromise, TLispValue } from "./types.ts";
import { Either } from "../utils/task-either.ts";
import { createPromise, isPromise } from "./values.ts";

export function createEvalContext(options?: Partial<EvalContext>): EvalContext {
  return {
    asyncMode: options?.asyncMode ?? false,
    sourceName: options?.sourceName,
  };
}

export function withAsyncMode(context: EvalContext): EvalContext {
  return {
    ...context,
    asyncMode: true,
  };
}

export function isAsyncMode(context?: EvalContext): boolean {
  return context?.asyncMode === true;
}

export function createResolvedPromise(value: TLispValue): TLispPromise {
  return createPromise(Promise.resolve(value));
}

export async function awaitPromiseValue(value: TLispPromise): Promise<Either<AppError, TLispValue>> {
  try {
    const result = await value.value;
    return Either.right(result);
  } catch (error) {
    const appError = normalizePromiseError(error);
    return Either.left(appError);
  }
}

export async function awaitIfPromise(value: TLispValue): Promise<Either<AppError, TLispValue>> {
  if (!isPromise(value)) {
    return Either.right(value);
  }
  return awaitPromiseValue(value);
}

export function normalizePromiseError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    type: "EvalError",
    variant: "RuntimeError",
    message,
    details: { error: message },
  };
}

function isAppError(error: unknown): error is AppError {
  return !!error && typeof error === "object" && "type" in error;
}
