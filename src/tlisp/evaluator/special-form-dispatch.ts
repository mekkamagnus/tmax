/**
 * @file special-form-dispatch.ts
 * @description CHORE-44 Change 4 AC4.2 — ONE authoritative special-form
 * classification table consulted by BOTH the synchronous (`evalList`) and
 * asynchronous (`evalListAsync`) evaluator paths.
 *
 * Before this module existed, each path maintained its own independent
 * special-form switch table; the recognized-form list and the error metadata
 * for unknown/misused forms could (and did) drift. The async path now contains
 * only the genuinely-async EXECUTORS (`if`/`let`/`let*`/`async-let`/`cond`/
 * `progn`/`while`) and delegates every other recognized form to the
 * synchronous handler — so the recognized-form list is sourced from this
 * table alone.
 *
 * The classification itself is PURE: it maps a form name to a category +
 * optional arity/error metadata. It does NOT evaluate.
 *
 * `async-let` is intentionally absent — it is an async-only form (sync
 * `execute` rejects it; AC4.5), and the async path recognizes it explicitly.
 */

/**
 * Form categories drive the dispatch policy:
 * - `async-capable`: the form has a dedicated async executor AND a sync one
 *   (e.g. `if`, `let`, `cond`, `progn`, `while`). The async switch handles
 *   these itself; the sync switch always uses the sync executor.
 * - `sync-only`: the form has identical sync/async behavior, so the async
 *   path delegates to the synchronous handler (e.g. `quote`, `defun`,
 *   `provide`, `defmacro`).
 * - `async-only`: forms that exist ONLY in the async path (currently none —
 *   `async-let` is recognized inline in `evalListAsync` because of its
 *   special rejection semantics under sync `execute`).
 */
export type SpecialFormCategory = "async-capable" | "sync-only";

/** Shared error metadata for misuse of a special form (currently informational). */
export interface SpecialFormMeta {
  category: SpecialFormCategory;
  /** Minimum element count required for the form (form-symbol + args). */
  minArity?: number;
  /** Human-readable description (informational; not currently surfaced). */
  description?: string;
}

/**
 * The authoritative classification table. Keys are form names; values carry
 * the dispatch category + optional arity metadata. Both `evalList` and
 * `evalListAsync` consult this single record via {@link classifyForm}.
 */
export const SPECIAL_FORMS: Readonly<Record<string, SpecialFormMeta>> = {
  // Async-capable: each has a dedicated async executor.
  if: { category: "async-capable", minArity: 3, description: "(if cond then [else])" },
  let: { category: "async-capable", minArity: 3, description: "(let bindings body...)" },
  "let*": { category: "async-capable", minArity: 3, description: "(let* bindings body...)" },
  cond: { category: "async-capable", minArity: 2, description: "(cond (test expr)...)" },
  progn: { category: "async-capable", minArity: 1, description: "(progn body...)" },
  while: { category: "async-capable", minArity: 3, description: "(while test body...)" },

  // Sync-only: identical sync/async behavior — async path delegates to sync.
  quote: { category: "sync-only", minArity: 2, description: "(quote expr)" },
  quasiquote: { category: "sync-only", minArity: 2, description: "(quasiquote expr)" },
  unquote: { category: "sync-only", minArity: 2, description: "(unquote expr) — quasiquote-only" },
  "unquote-splicing": { category: "sync-only", minArity: 2, description: "(unquote-splicing expr) — quasiquote-only" },
  defmacro: { category: "sync-only", minArity: 3, description: "(defmacro name params body...)" },
  lambda: { category: "sync-only", minArity: 3, description: "(lambda params [docstring] body...)" },
  defun: { category: "sync-only", minArity: 4, description: "(defun name params [docstring] body...)" },
  defvar: { category: "sync-only", minArity: 3, description: "(defvar name value)" },
  set: { category: "sync-only", minArity: 3, description: "(set! name value)" },
  "current-module": { category: "sync-only", minArity: 1, description: "(current-module)" },
  provide: { category: "sync-only", minArity: 2, description: "(provide \"feature\")" },
  featurep: { category: "sync-only", minArity: 2, description: "(featurep \"feature\")" },
  require: { category: "sync-only", minArity: 2, description: '(require "feature")' },
  defmodule: { category: "sync-only", minArity: 3, description: "(defmodule name (export ...) body...)" },
  "require-module": { category: "sync-only", minArity: 2, description: "(require-module \"name\")" },
  "assert-type": { category: "sync-only", minArity: 4, description: "(assert-type value type message)" },
  "assert-error": { category: "sync-only", minArity: 2, description: "(assert-error body...)" },
  "condition-case": { category: "sync-only", minArity: 3, description: "(condition-case handler body...)" },
  dolist: { category: "sync-only", minArity: 2, description: "(dolist (var list) body...)" },
  and: { category: "sync-only", minArity: 1, description: "(and expr...)" },
  or: { category: "sync-only", minArity: 1, description: "(or expr...)" },
};

/**
 * Classify a form name. Returns the form's metadata, or `undefined` if the
 * name is not a recognized special form (i.e. it is a regular function call
 * or a user binding).
 */
export function classifyForm(name: string): SpecialFormMeta | undefined {
  return SPECIAL_FORMS[name];
}

/**
 * Whether the given name is a recognized special form. The recognized-form
 * list used by BOTH evaluator paths comes from this single helper (AC4.2).
 */
export function isSpecialForm(name: string): boolean {
  return name in SPECIAL_FORMS;
}

/**
 * Whether the form has a dedicated async executor (vs. delegating to the
 * sync handler). The async path uses this to decide whether to handle the
 * form itself or delegate via `evalList`.
 */
export function hasAsyncExecutor(name: string): boolean {
  const meta = SPECIAL_FORMS[name];
  return meta?.category === "async-capable";
}
