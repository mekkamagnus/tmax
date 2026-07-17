/**
 * @file registry.ts
 * @description CHORE-44 Change 7 — declarative editor API contribution
 * registry.
 *
 * `createEditorAPI` previously composed the T-Lisp primitive inventory by
 * manually copying `Map.entries()` from each `create*Ops` factory into a
 * combined Map through ~34 `for (const [k,v] of X.entries()) api.set(k,v)`
 * loops, plus ~84 inline `api.set(...)` sites. That construction had no
 * compile-time story for the inventory, no duplicate detection (later
 * primitives silently overwrote earlier ones), and no per-contribution
 * identity to cite in a failure message.
 *
 * This module replaces that with a typed contribution registry. Each
 * contribution carries:
 *
 * - a stable `name` (e.g. `"buffer"`, `"cursor"`, `"messages+observability"`)
 *   used as the contribution's identity in duplicate-error messages; and
 * - a `factory(ctx)` closure that derives its dependencies from the single
 *   typed {@link EditorAPIContext} and returns the primitives it owns as a
 *   `Map<string, TLispFunctionImpl>`.
 *
 * {@link registerContributions} merges contributions in declared order into a
 * fresh Map. On a duplicate primitive name across two contributions it returns
 * a deterministic typed `Either.left` whose `AppError` names BOTH the
 * colliding contribution `name`s and the duplicated primitive. Same-name
 * within ONE contribution (e.g. an intentional alias) is the factory's own
 * last-wins Map behaviour and is NOT reported as a collision — legitimate
 * aliases belong inside one contribution so they don't trip detection.
 *
 * AC7.4: the registry does not create per-contribution cache objects. Each
 * factory receives the SAME `ctx.caches` instance; AST and navigation
 * contributions share it by reading `ctx.caches`.
 *
 * AC7.5: factories are pure functions of `ctx`; no module-global mutable
 * state participates in contribution construction.
 */

import type { TLispFunctionImpl } from "../../tlisp/types.ts";
import type { AppError } from "../../error/types.ts";
import { createValidationError } from "../../error/types.ts";
import { Either } from "../../utils/task-either.ts";
import type { EditorAPIContext } from "../runtime/editor-api-context.ts";

/**
 * One declarative contribution to the editor API.
 *
 * `name` is the contribution's identity, cited in duplicate-collision errors.
 * `factory(ctx)` derives its dependencies from the single typed context and
 * returns the primitives it owns. Factories are pure with respect to `ctx`
 * (AC7.5) and share `ctx.caches` rather than creating their own (AC7.4).
 */
export interface EditorAPIContribution {
  /** Stable contribution identity, cited in duplicate-collision errors. */
  readonly name: string;
  /**
   * Build this contribution's primitives from the typed context. Returns a
   * `Map<string, TLispFunctionImpl>` so legitimate aliases (two names → one
   * impl) can live in one contribution without tripping collision detection.
   */
  factory: (ctx: EditorAPIContext) => Map<string, TLispFunctionImpl>;
}

/**
 * Merge contributions in declared order into a fresh Map.
 *
 * On a duplicate primitive name across two DISTINCT contributions, returns
 * `Either.left` with a {@link ValidationError} (variant `ConstraintViolation`)
 * whose `message` and `details` name BOTH the colliding contribution names
 * and the duplicated primitive. Same-name WITHIN one contribution is the
 * factory's own last-wins Map behaviour and is not reported (legitimate
 * aliases belong inside one contribution).
 *
 * Determinism (AC7.5): registering the same contribution list twice yields
 * identical key sets and insertion order. The merge walks contributions in
 * array order and primitives in each factory's Map insertion order.
 */
export function registerContributions(
  ctx: EditorAPIContext,
  contributions: readonly EditorAPIContribution[],
): Either<AppError, Map<string, TLispFunctionImpl>> {
  const api = new Map<string, TLispFunctionImpl>();
  // Track which contribution first registered each primitive name so the
  // duplicate error can name both the prior and the current contribution.
  const ownerOf = new Map<string, string>();

  for (const contribution of contributions) {
    const built = contribution.factory(ctx);
    for (const [primitiveName, impl] of built) {
      const priorOwner = ownerOf.get(primitiveName);
      if (priorOwner !== undefined && priorOwner !== contribution.name) {
        // Cross-contribution collision — deterministic typed failure.
        const message =
          `Editor API duplicate primitive '${primitiveName}': contribution ` +
          `'${contribution.name}' re-registers a name first registered by ` +
          `'${priorOwner}'. Merge the alias into one contribution or rename.`;
        return Either.left<AppError, Map<string, TLispFunctionImpl>>(
          createValidationError(
            "ConstraintViolation",
            message,
            /* field */ primitiveName,
            /* value */ undefined,
            /* constraint */ "unique-primitive-name-across-contributions",
            /* details */ {
              primitive: primitiveName,
              contributions: [priorOwner, contribution.name],
            },
          ),
        );
      }
      // Within ONE contribution an intentional alias (same primitive name
      // appearing twice) is last-wins — the factory's own Map semantics.
      // Across contributions it is the error above.
      api.set(primitiveName, impl);
      ownerOf.set(primitiveName, contribution.name);
    }
  }

  return Either.right(api);
}
