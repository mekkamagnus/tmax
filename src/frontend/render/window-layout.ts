/**
 * @file window-layout.ts
 * @description COMPATIBILITY RE-EXPORT — the pure layout algorithms moved to
 * `src/core/window-layout.ts` (#261: the editor layer's directional-focus
 * primitive needs the geometry; core is the layering-clean home, same move
 * as #258's viewport clamp). Existing importers (buffer-lines, tests) are
 * unchanged.
 */
export { computeLayout, renderSeparators, type WindowCell } from "../../core/window-layout.ts";
