/** #231: merge transient goggles flash spans over base (syntax) spans.
 * Shared by the capture-frame render path and the TUI client so the merge
 * logic (and its no-truncation guarantee) exists exactly once. */
import type { HighlightSpan } from "../core/contracts/editor.ts";

/** Merge to max(base, flash) length — truncating to the flash's length would
 * drop syntax spans on every line below the flash region for its TTL. */
export function mergeFlashSpans(
  base: HighlightSpan[][] | undefined,
  flash: HighlightSpan[][] | undefined,
): HighlightSpan[][] | undefined {
  if (!flash) return base;
  const b = base ?? [];
  const len = Math.max(b.length, flash.length);
  const out: HighlightSpan[][] = [];
  for (let i = 0; i < len; i++) {
    out.push([...(b[i] ?? []), ...(flash[i] ?? [])]);
  }
  return out;
}
