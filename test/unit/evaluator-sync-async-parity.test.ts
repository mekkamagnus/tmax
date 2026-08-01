/**
 * @file evaluator-sync-async-parity.test.ts
 * @description CHORE-44 Change 4 — table-driven parity between the synchronous
 * `execute()` and asynchronous `executeAsync()` evaluator paths.
 *
 * Authored BEFORE any evaluator code is moved (spec §Change 4): it
 * characterizes current behavior so the shared form-shape validators +
 * unified special-form table can be extracted without semantic drift (AC4.1).
 * Forms supported by both paths must yield equivalent Right/Left results.
 */

import { describe, test, expect } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { Either } from "../../src/utils/task-either.ts";
import type { TLispValue, EvalError } from "../../src/tlisp/types.ts";

/** Structural equality over TLispValue (type + value, lists recursive). */
function equalValue(a: TLispValue, b: TLispValue): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "list" || a.type === "hashmap") {
    const av = a.value as TLispValue[];
    const bv = b.value as TLispValue[];
    if (av.length !== bv.length) return false;
    return av.every((x, i) => equalValue(x, bv[i]!));
  }
  if (a.type === "number" || a.type === "string" || a.type === "boolean") return a.value === b.value;
  if (a.type === "symbol") return (a.value as { name?: string }).name === (b.value as { name?: string }).name;
  // nil / promise / function-ref compare by type only.
  return true;
}

/** Normalize a result to { ok, value, code, variant, message } so sync + async can be compared. */
function normalize(result: Either<EvalError, TLispValue>): { ok: boolean; value: TLispValue | null; code: string | null; variant: string | null; message: string | null } {
  if (Either.isLeft(result)) {
    return { ok: false, value: null, code: result.left.type ?? "Error", variant: result.left.variant ?? null, message: result.left.message ?? null };
  }
  return { ok: true, value: result.right, code: null, variant: null, message: null };
}

/** Unwrap a TLispValue to a plain JS value for correctness comparison (#48 / BUG-42):
 *  lists recurse, nil -> null, scalars -> their .value. */
function unwrap(v: TLispValue): unknown {
  if (v.type === "list") return (v.value as TLispValue[]).map(unwrap);
  if (v.type === "nil") return null;
  if (v.type === "symbol") return { symbol: (v.value as { name?: string }).name ?? String(v.value) };
  return v.value;
}

const cases: { name: string; source: string; expected?: unknown; expectedError?: boolean }[] = [
  { name: "literal number", source: "42", expected: 42 },
  { name: "literal string", source: '"hello"', expected: "hello" },
  { name: "literal boolean true", source: "t", expected: true },
  { name: "literal nil", source: "nil", expected: null },
  { name: "arithmetic", source: "(+ 1 2 3)", expected: 6 },
  { name: "symbol lookup", source: "(let ((x 7)) x)", expected: 7 },
  { name: "quote", source: "(quote (1 2 3))", expected: [1, 2, 3] },
  { name: "quasiquote", source: "`(1 ,(+ 1 1) 3)", expected: [1, 2, 3] },
  { name: "if true", source: "(if t 1 2)", expected: 1 },
  { name: "if false", source: "(if nil 1 2)", expected: 2 },
  { name: "let", source: "(let ((a 1) (b 2)) (+ a b))", expected: 3 },
  { name: "let*", source: "(let* ((a 1) (b (+ a 1))) b)", expected: 2 },
  { name: "cond", source: "(cond (nil 1) (t 2))", expected: 2 },
  { name: "progn", source: "(progn 1 2 3)", expected: 3 },
  { name: "and short-circuit", source: "(and 1 2 nil)", expected: null },
  { name: "or", source: "(or nil nil 5)", expected: 5 },
  { name: "dolist accumulator (setq)", source: "(progn (defvar acc 0) (dolist (x (quote (1 2 3))) (setq acc (+ acc x))) acc)", expected: 6 },
  { name: "while accumulator (setq)", source: "(progn (defvar i 0) (defvar sum 0) (while (< i 3) (setq sum (+ sum 1)) (setq i (+ i 1))) sum)", expected: 3 },
  { name: "user function", source: "(progn (defun dbl (n) (+ n n)) (dbl 21))", expected: 42 },
  { name: "macro", source: "(progn (defmacro unless (c body) `(if ,c nil ,body)) (unless nil 99))", expected: 99 },
  { name: "error: undefined symbol", source: "(undefined-thing-xyz)", expectedError: true },
  { name: "error: non-numeric +", source: '(+ "a" 1)', expectedError: true },
];

describe("CHORE-44 Change 4 — sync/async evaluator parity", () => {
  for (const c of cases) {
    test(`sync and async agree: ${c.name}`, async () => {
      const sync = new TLispInterpreterImpl();
      const async_ = new TLispInterpreterImpl();
      const syncResult = normalize(sync.execute(c.source));
      const asyncResult = normalize(await async_.executeAsync(c.source));

      // Correctness oracle (BUG-42 / #48): assert the RIGHT value, not just
      // sync==async agreement. An agreed-but-wrong result now fails the suite.
      if (c.expectedError) {
        expect(syncResult.ok).toBe(false);
        expect(asyncResult.ok).toBe(false);
      } else if (c.expected !== undefined) {
        expect(syncResult.ok).toBe(true);
        expect(asyncResult.ok).toBe(true);
        expect(unwrap(syncResult.value!)).toEqual(c.expected);
        expect(unwrap(asyncResult.value!)).toEqual(c.expected);
      }

      // Parity (unchanged): sync + async agree on ok + value + error category.
      expect(asyncResult.ok).toBe(syncResult.ok);
      if (syncResult.ok && asyncResult.ok && syncResult.value && asyncResult.value) {
        expect(equalValue(syncResult.value, asyncResult.value)).toBe(true);
      }
      if (!syncResult.ok) {
        // Both should reject; error category should match.
        expect(asyncResult.code).toBe(syncResult.code);
      }
    });
  }

  test("async-let is rejected by sync execute and accepted by executeAsync (AC4.5)", async () => {
    const sync = new TLispInterpreterImpl();
    const async_ = new TLispInterpreterImpl();
    expect(Either.isLeft(sync.execute("(async-let ((p (make-promise nil))) p)"))).toBe(true);
    // executeAsync accepts async-let (it may still produce nil here, but must not be a syntax/undefined-symbol error).
    const r = await async_.executeAsync("(async-let ((p 5)) p)");
    expect(Either.isRight(r)).toBe(true);
  });

  // AC4.1 validation-error parity: every form whose argument shape is
  // validated by a shared validator in `form-shapes.ts` must produce the
  // SAME error (variant + message) under both sync and async execution.
  // This is the regression net for "validation cannot drift between paths".
  const validationCases: { name: string; source: string }[] = [
    { name: "if: too few arguments", source: "(if t)" },
    { name: "if: too many arguments", source: "(if t 1 2 3)" },
    { name: "let: missing body", source: "(let ((x 1)))" },
    { name: "let: missing bindings", source: "(let)" },
    { name: "let: bindings not a list", source: "(let 5 1)" },
    { name: "quote: wrong arity", source: "(quote a b)" },
    { name: "quasiquote: wrong arity", source: "(quasiquote a b)" },
    { name: "cond: zero clauses", source: "(cond)" },
    { name: "cond: clause wrong shape", source: "(cond (t 1 2))" },
    { name: "while: missing body", source: "(while t)" },
    { name: "dolist: binding spec not a list", source: "(dolist 5 (print x))" },
    { name: "defun: missing body", source: "(defun name (x))" },
    { name: "lambda: missing body", source: "(lambda (x))" },
    { name: "provide: missing feature name", source: "(provide)" },
    { name: "featurep: wrong type", source: "(featurep 5)" },
    { name: "require: missing feature name", source: "(require)" },
  ];

  for (const c of validationCases) {
    test(`validation error parity (AC4.1): ${c.name}`, async () => {
      const sync = new TLispInterpreterImpl();
      const async_ = new TLispInterpreterImpl();
      const syncResult = normalize(sync.execute(c.source));
      const asyncResult = normalize(await async_.executeAsync(c.source));
      // Both paths must reject.
      expect(syncResult.ok).toBe(false);
      expect(asyncResult.ok).toBe(false);
      // The shared validator produces the SAME error variant + message in
      // both paths (this is the core AC4.1 invariant: drift = bug).
      expect(asyncResult.variant).toBe(syncResult.variant);
      expect(asyncResult.message).toBe(syncResult.message);
    });
  }
});
