/**
 * @file test-forms.ts
 * @description CHORE-44 Change 4 AC4.7 — test/suite/fixture handler logic
 * extracted from the ~5,000-line `evaluator.ts` facade.
 *
 * IMPORTANT: these TypeScript handlers (`deftest`, `deftest-async`,
 * `deftest-suite`, `deffixture`, `use-fixtures`, `suite-setup`,
 * `suite-teardown`, `setup`, `teardown`) are DORMANT — they are not wired
 * into the special-form dispatch switch and not registered as builtins.
 * The live T-Lisp test framework is the self-hosted `trt` package
 * (`src/tlisp/core/trt/*.tlisp`); `deftest` is a T-Lisp macro defined in
 * `trt.tlisp`, and the `trt-*` bridge builtins live in `trt/bootstrap.ts`.
 *
 * The dormant handlers are extracted anyway per AC4.7 so `evaluator.ts`
 * no longer contains their implementation bodies and the per-instance
 * `testRegistry`/`suiteRegistry`/`currentSuite` they operate on are clearly
 * owned by the evaluator (AC4.3). Each extracted handler is a free function
 * taking a narrow {@link TestFormsContext}; the evaluator's (unused) private
 * methods become one-line delegations. Behavior is byte-for-byte preserved
 * (the bodies are MOVED, not rewritten).
 */

import type { TLispValue, TLispEnvironment } from "../types.ts";
import type { EvalError } from "../../error/types.ts";
import { Either } from "../../utils/task-either.ts";
import { createBoolean, createNil, createString, createList } from "../values.ts";
import { validateDeftest } from "./form-shapes.ts";

/** Suite shape (mirrors the private `TestSuite` interface on `TLispEvaluator`). */
export interface TestSuite {
  name: string;
  description?: string;
  tests: string[];
  setup?: TLispValue[];
  teardown?: TLispValue[];
  parent?: string;
}

/** Test-definition shape stored in `testRegistry`. */
export interface TestDefinition {
  body: TLispValue[];
  name: string;
  params: TLispValue;
  isAsync?: boolean;
}

/**
 * Mutable per-instance test state. Owned by `TLispEvaluator`; passed by
 * reference to these handlers. The registries are NOT module globals
 * (AC4.3) — each evaluator instance has its own.
 */
export interface TestRegistryState {
  testRegistry: Map<string, TestDefinition>;
  suiteRegistry: Map<string, TestSuite>;
  currentSuite: string | null;
}

/**
 * Narrow evaluator surface required by test-form handlers. `TLispEvaluator`
 * implements this interface; tests may supply a fake.
 */
export interface TestFormsContext extends TestRegistryState {
  /** Evaluate a single T-Lisp form (sync). Used by `use-fixtures`. */
  evalForm(expr: TLispValue, env: TLispEnvironment): Either<EvalError, TLispValue>;
}

/**
 * Evaluate `(deftest name params body...)`. Registers the test in the
 * per-instance `testRegistry`. Body MOVED from `TLispEvaluator.evalDeftest`.
 */
export function evalDeftestForm(
  ctx: TestFormsContext,
  elements: TLispValue[],
): Either<EvalError, TLispValue> {
  const shape = validateDeftest(elements, "deftest");
  if (Either.isLeft(shape)) return Either.left(shape.left);
  const { name, parameters } = shape.right;
  const testName = name.value as string;
  const testBody = elements.slice(3);
  ctx.testRegistry.set(testName, { body: testBody, name: testName, params: parameters });
  return Either.right(name);
}

/**
 * Evaluate `(deftest-async name params body...)`. Registers the async test.
 * Body MOVED from `TLispEvaluator.evalDeftestAsync`.
 */
export function evalDeftestAsyncForm(
  ctx: TestFormsContext,
  elements: TLispValue[],
): Either<EvalError, TLispValue> {
  const shape = validateDeftest(elements, "deftest-async");
  if (Either.isLeft(shape)) return Either.left(shape.left);
  const { name, parameters } = shape.right;
  const testName = name.value as string;
  const testBody = elements.slice(3);
  ctx.testRegistry.set(testName, { body: testBody, name: testName, params: parameters, isAsync: true });
  return Either.right(name);
}

/**
 * Evaluate `(deftest-suite name [description] body...)`. Creates a suite,
 * recursively registers any nested `deftest`/`deftest-suite` forms, and
 * stores the suite in the per-instance `suiteRegistry`. Body MOVED from
 * `TLispEvaluator.evalDeftestSuite`.
 */
export function evalDeftestSuiteForm(
  ctx: TestFormsContext,
  elements: TLispValue[],
  env: TLispEnvironment,
): Either<EvalError, TLispValue> {
  if (elements.length < 2) {
    return Either.left({
      type: 'EvalError',
      variant: 'SyntaxError',
      message: "deftest-suite requires at least 1 argument: suite name",
      details: { expectedMin: 2, actual: elements.length },
    });
  }

  const nameArg = elements[1];
  if (!nameArg || (nameArg.type !== "string" && nameArg.type !== "symbol")) {
    return Either.left({
      type: 'EvalError',
      variant: 'TypeError',
      message: "deftest-suite name must be a string or symbol",
      details: { nameType: nameArg?.type },
    });
  }

  const suiteName = nameArg.value as string;

  // Parse optional description
  let description: string | undefined;
  let contentStart = 2;

  if (elements.length > 2 && elements[2]!.type === "string") {
    description = elements[2]!.value as string;
    contentStart = 3;
  }

  // Create suite
  const suite: TestSuite = {
    name: suiteName,
    description,
    tests: [],
    parent: ctx.currentSuite || undefined,
  };

  // Set as current suite for nested definitions
  const previousSuite = ctx.currentSuite;
  ctx.currentSuite = suiteName;

  // Process suite body
  for (let i = contentStart; i < elements.length; i++) {
    const element = elements[i]!;

    if (element.type === "list") {
      const elValues = element.value as TLispValue[];
      if (elValues.length > 0) {
        const first = elValues[0]!;
        if (first.type === "symbol" && first.value === "suite-setup") {
          suite.setup = elValues.slice(1);
          continue;
        }
        if (first.type === "symbol" && first.value === "suite-teardown") {
          suite.teardown = elValues.slice(1);
          continue;
        }
        if (first.type === "symbol" && first.value === "deftest") {
          const testResult = evalDeftestForm(ctx, elValues);
          if (Either.isLeft(testResult)) {
            console.warn(`Failed to define test in suite: ${testResult.left.message}`);
          } else {
            const testName = elValues[1];
            if (testName && testName.type === "symbol") {
              suite.tests.push(testName.value as string);
            }
          }
        }
        if (first.type === "symbol" && first.value === "deftest-suite") {
          const suiteResult = evalDeftestSuiteForm(ctx, elValues, env);
          if (Either.isLeft(suiteResult)) {
            console.warn(`Failed to define nested suite: ${suiteResult.left.message}`);
          } else {
            const nestedName = elValues[1];
            if (nestedName && (nestedName.type === "string" || nestedName.type === "symbol")) {
              suite.tests.push(nestedName.value as string);
            }
          }
        }
      }
    }
  }

  // Restore previous suite
  ctx.currentSuite = previousSuite;

  // Register suite
  ctx.suiteRegistry.set(suiteName, suite);

  return Either.right(createString(suiteName));
}

/** Evaluate `(suite-setup ...)` placeholder. Body MOVED from evaluator. */
export function evalSuiteSetupForm(ctx: TestFormsContext): Either<EvalError, TLispValue> {
  if (!ctx.currentSuite) {
    return Either.left({
      type: 'EvalError',
      variant: 'SyntaxError',
      message: "suite-setup must be used inside deftest-suite",
      details: {},
    });
  }
  return Either.right(createNil());
}

/** Evaluate `(suite-teardown ...)` placeholder. Body MOVED from evaluator. */
export function evalSuiteTeardownForm(ctx: TestFormsContext): Either<EvalError, TLispValue> {
  if (!ctx.currentSuite) {
    return Either.left({
      type: 'EvalError',
      variant: 'SyntaxError',
      message: "suite-teardown must be used inside deftest-suite",
      details: {},
    });
  }
  return Either.right(createNil());
}

/** Evaluate deprecated `(setup () body...)` form. Body MOVED from evaluator. */
export function evalSetupForm(elements: TLispValue[]): Either<EvalError, TLispValue> {
  if (elements.length < 2) {
    return Either.left({
      type: 'EvalError',
      variant: 'RuntimeError',
      message: "setup requires at least 1 argument: parameter list",
      details: { expectedMin: 1, actual: elements.length - 1 },
    });
  }
  const paramsArg = elements[1];
  if (!paramsArg || paramsArg.type !== "list") {
    return Either.left({
      type: 'EvalError',
      variant: 'TypeError',
      message: "setup first argument must be a list (parameters)",
      details: { argType: paramsArg?.type },
    });
  }
  // setup/teardown are deprecated; trt uses fixtures (SPEC-049)
  return Either.right(createBoolean(true));
}

/** Evaluate deprecated `(teardown () body...)` form. Body MOVED from evaluator. */
export function evalTeardownForm(elements: TLispValue[]): Either<EvalError, TLispValue> {
  if (elements.length < 2) {
    return Either.left({
      type: 'EvalError',
      variant: 'RuntimeError',
      message: "teardown requires at least 1 argument: parameter list",
      details: { expectedMin: 1, actual: elements.length - 1 },
    });
  }
  const paramsArg = elements[1];
  if (!paramsArg || paramsArg.type !== "list") {
    return Either.left({
      type: 'EvalError',
      variant: 'TypeError',
      message: "teardown first argument must be a list (parameters)",
      details: { argType: paramsArg?.type },
    });
  }
  return Either.right(createBoolean(true));
}

/**
 * Evaluate `(deffixture name params body...)`. Stores fixture info in the
 * process-global `__deffixture_data__` map (legacy MVP behavior — pre-existing
 * surface, not introduced by this refactor). Body MOVED from
 * `TLispEvaluator.evalDeffixture`.
 */
export function evalDeffixtureForm(
  elements: TLispValue[],
  env: TLispEnvironment,
): Either<EvalError, TLispValue> {
  if (elements.length < 3) {
    return Either.left({
      type: 'EvalError',
      variant: 'SyntaxError',
      message: "deffixture requires at least 2 arguments: name, parameters, and body",
      details: { expectedMin: 3, actual: elements.length },
    });
  }

  const name = elements[1];
  const parameters = elements[2];

  if (!name || !parameters) {
    return Either.left({
      type: 'EvalError',
      variant: 'SyntaxError',
      message: "deffixture missing required arguments",
      details: { hasName: !!name, hasParameters: !!parameters },
    });
  }
  if (name.type !== "symbol") {
    return Either.left({
      type: 'EvalError',
      variant: 'TypeError',
      message: "deffixture name must be a symbol",
      details: { nameType: name.type },
    });
  }
  if (parameters.type !== "list") {
    return Either.left({
      type: 'EvalError',
      variant: 'TypeError',
      message: "deffixture parameters must be a list",
      details: { parametersType: parameters.type },
    });
  }

  const fixtureName = name.value as string;

  let scope: 'each' | 'once' | 'all' = 'each';
  let bodyStartIndex = 3;

  if (elements.length > 3 && elements[3]!.type === "list") {
    const scopeList = elements[3]!.value as TLispValue[];
    if (scopeList.length >= 2) {
      const keyword = scopeList[0]!;
      const scopeValue = scopeList[1]!;
      if (keyword.type === "symbol" && keyword.value === "scope" && scopeValue.type === "symbol") {
        const scopeStr = scopeValue.value as string;
        if (scopeStr === "each" || scopeStr === "once" || scopeStr === "all") {
          scope = scopeStr;
          bodyStartIndex = 4;
        }
      }
    }
  }

  let setupBody: TLispValue[] = [];
  let teardownBody: TLispValue[] = [];
  let body: TLispValue[] = [];

  for (let i = bodyStartIndex; i < elements.length; i++) {
    const arg = elements[i]!;
    if (arg.type === "list") {
      const listItems = arg.value as TLispValue[];
      if (listItems.length > 0) {
        const first = listItems[0]!;
        if (first.type === "symbol") {
          if (first.value === "setup") {
            setupBody = listItems.slice(1);
          } else if (first.value === "teardown") {
            teardownBody = listItems.slice(1);
          } else {
            body.push(arg);
          }
        } else {
          body.push(arg);
        }
      }
    } else {
      body.push(arg);
    }
  }

  const fixtureData = {
    name: fixtureName,
    params: parameters,
    body,
    setupBody,
    teardownBody,
    scope,
  };

  (globalThis as any).__deffixture_data__ = (globalThis as any).__deffixture_data__ || new Map();
  (globalThis as any).__deffixture_data__.set(fixtureName, fixtureData);

  return Either.right(name);
}

/**
 * Evaluate `(use-fixtures fixture-name...)`. Applies each named fixture's
 * body and setup in `env`. Body MOVED from `TLispEvaluator.evalUseFixtures`.
 */
export function evalUseFixturesForm(
  ctx: TestFormsContext,
  elements: TLispValue[],
  env: TLispEnvironment,
): Either<EvalError, TLispValue> {
  if (elements.length < 2) {
    return Either.left({
      type: 'EvalError',
      variant: 'RuntimeError',
      message: "use-fixtures requires at least 1 argument: fixture name",
      details: { expectedMin: 2, actual: elements.length },
    });
  }

  const fixtureNames: string[] = [];
  for (let i = 1; i < elements.length; i++) {
    const arg = elements[i]!;
    if (arg.type === "symbol") {
      fixtureNames.push(arg.value as string);
    } else if (arg.type === "string") {
      fixtureNames.push(arg.value as string);
    } else {
      return Either.left({
        type: 'EvalError',
        variant: 'TypeError',
        message: "use-fixtures arguments must be symbols or strings (fixture names)",
        details: { argType: arg.type },
      });
    }
  }

  const globalFixtures = (globalThis as any).__deffixture_data__;
  if (!globalFixtures) {
    return Either.right(createBoolean(true));
  }

  for (const name of fixtureNames) {
    const fixtureData = globalFixtures.get(name);
    if (!fixtureData) {
      return Either.left({
        type: 'EvalError',
        variant: 'RuntimeError',
        message: `Fixture '${name}' not found`,
        details: { fixtureName: name },
      });
    }

    for (const expr of fixtureData.body || []) {
      const result = ctx.evalForm(expr, env);
      if (Either.isLeft(result)) {
        return result;
      }
    }
    for (const expr of fixtureData.setupBody || []) {
      const result = ctx.evalForm(expr, env);
      if (Either.isLeft(result)) {
        return result;
      }
    }

    const teardowns = env.lookup("__fixture_teardowns__") || createList([]);
    const teardownList: any[] = teardowns.type === "list" ? [...(teardowns.value as TLispValue[])] : [];
    teardownList.push({ fixture: name, teardown: fixtureData.teardownBody || [] });
    env.define("__fixture_teardowns__", createList(teardownList));
  }

  return Either.right(createBoolean(true));
}
