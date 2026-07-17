/**
 * @file function-calls.ts
 * @description CHORE-44 Change 4 AC4.7 — shared function-call MACHINERY
 * extracted from the function-call path in `evaluator.ts`.
 *
 * What lives here: pure-ish helpers that the sync (`evalFunctionCall`) and
 * async (`evalFunctionCallAsync`) call paths share — macro-expansion
 * detection, coverage marking, and tracing enter/exit hooks.
 *
 * What does NOT live here: the tail-call trampoline. The TCO drive
 * (`TailCall`/`isTailCall`/`createTailCall`, the trampoline loop in
 * `eval`/`evalAsync`, the `inTailPosition` plumbing, and the actual
 * tail-call emission `return Either.right(createTailCall(...))`) stays in
 * `evaluator.ts`. Moving it would risk AC4.4 (100,000-step tail recursion)
 * for no semantic benefit — the trampoline is genuinely evaluator-owned.
 *
 * Each helper is a free function taking a narrow interface or value; the
 * evaluator passes its state explicitly. Behavior is preserved (the bodies
 * are MOVED out of `evalFunctionCall`, not rewritten).
 */

import type { TLispValue, TLispEnvironment } from "../types.ts";
import type { EvalError } from "../../error/types.ts";
import { Either } from "../../utils/task-either.ts";
import { isMacro } from "../values.ts";
import type { DebugState } from "../debug-state.ts";
import type { SourceSpan } from "../source.ts";
import { getSourceSpan } from "../source-metadata.ts";

/**
 * Narrow coverage surface. The evaluator's per-instance `CoverageState`
 * (AC4.8) implements this; both call paths consult it through this
 * interface so the coverage mark is owned per-evaluator, not module-globally.
 */
export interface FunctionCallCoverage {
  isEnabled(): boolean;
  markFunctionCovered(name: string): void;
}

/** Result of {@link tryMacroExpansion}. */
export type MacroExpansionResult =
  | { kind: "macro"; expanded: TLispValue }
  | { kind: "regular-call" }
  | { kind: "error"; error: EvalError };

/**
 * Look up `funcExpr` in `env`; if it is bound to a macro, expand it with the
 * (unevaluated) `argExprs`. Returns:
 * - `{ kind: "macro", expanded }` if `funcExpr` is a macro symbol — the
 *   caller re-evaluates `expanded` (sync: `evalInternal`; async:
 *   `evalInternalAsync`).
 * - `{ kind: "regular-call" }` if it is not a macro — the caller proceeds
 *   with normal function-call evaluation / tail-call emission.
 * - `{ kind: "error", error }` if the macro expansion itself failed.
 *
 * Body MOVED from the inline check at the top of `evalFunctionCall` and
 * `evalFunctionCallAsync` (which were byte-identical). Centralizing it here
 * removes the duplication and guarantees the sync and async paths perform
 * the SAME macro detection.
 */
export function tryMacroExpansion(
  env: TLispEnvironment,
  funcExpr: TLispValue,
  argExprs: TLispValue[],
): MacroExpansionResult {
  if (funcExpr.type !== "symbol") {
    return { kind: "regular-call" };
  }
  const symbolName = funcExpr.value as string;
  const value = env.lookup(symbolName);
  if (!value || !isMacro(value)) {
    return { kind: "regular-call" };
  }
  const macroImpl = value.value as (args: TLispValue[]) => Either<EvalError, TLispValue>;
  const expandedResult = macroImpl(argExprs);
  if (Either.isLeft(expandedResult)) {
    return { kind: "error", error: expandedResult.left };
  }
  return { kind: "macro", expanded: expandedResult.right };
}

/**
 * Mark the called function as covered for coverage tracking (US-0.6.6).
 * Body MOVED from the inline `if (isCoverageEnabled() && funcExpr.type === "symbol")`
 * blocks in both call paths. No-op when coverage is disabled or the callee
 * is anonymous.
 */
export function markFunctionCoverage(
  coverage: FunctionCallCoverage | null,
  funcExpr: TLispValue,
): void {
  if (!coverage || !coverage.isEnabled()) return;
  if (funcExpr.type !== "symbol") return;
  coverage.markFunctionCovered(funcExpr.value as string);
}

/** Trace-entry side effect descriptor (applied by {@link traceEnter}). */
export interface TraceEnterResult {
  wasTraced: boolean;
  frameName: string;
  span: SourceSpan | undefined;
}

/**
 * Begin a traced function-call frame: record the enter trace (if the
 * function is being traced) and push the frame onto the debug stack. The
 * caller MUST pair this with a {@link traceExit} call. Body MOVED from the
 * inline bracket in both call paths.
 */
export function traceEnter(
  debugState: DebugState,
  funcExpr: TLispValue,
  args: TLispValue[],
): TraceEnterResult {
  const frameName = funcExpr.type === "symbol" ? funcExpr.value as string : "<anonymous>";
  const span = getSourceSpan(funcExpr);
  const wasTraced = debugState.isTraced(frameName);
  if (wasTraced) {
    debugState.recordTrace({
      depth: debugState.getStackDepth(),
      functionName: frameName,
      args,
      span,
      direction: "enter",
    });
  }
  debugState.pushFrame(frameName, span);
  return { wasTraced, frameName, span };
}

/**
 * End a traced function-call frame: pop the debug stack and (if traced)
 * record the exit trace with the call result (tail calls record an
 * `undefined` result since the actual value is computed by the trampoline
 * drive). Body MOVED from the inline bracket in both call paths.
 */
export function traceExit(
  debugState: DebugState,
  enter: TraceEnterResult,
  callResult: Either<EvalError, TLispValue>,
  isTailCallResult: boolean,
): void {
  debugState.popFrame();
  if (enter.wasTraced && Either.isRight(callResult)) {
    debugState.recordTrace({
      depth: debugState.getStackDepth(),
      functionName: enter.frameName,
      args: [],
      result: isTailCallResult ? undefined : callResult.right,
      direction: "exit",
    });
  }
}
