/**
 * @file manpage.ts
 * @description SPEC-114 (#181) — man-page formatter entry point + backend
 *   selector. Auto-selects the `man` binary backend when present (accurate),
 *   else the zero-dep `woman` roff renderer (resolves + parses the source).
 *   Also extracts the SEE ALSO cross-references from the rendered text.
 */

import { resolveManPage, readManSource } from "./resolver.ts";
import { formatRoff } from "./woman.ts";
import { isManAvailable, formatWithMan } from "./man-backend.ts";

export interface ManPageResult {
  /** The rendered page text (plain). */
  text: string;
  /** The section the page was found in (e.g. "1"). */
  section: string;
  /** The page title (first non-empty line). */
  title: string;
  /** Cross-reference targets from SEE ALSO, as `topic(section)`. */
  seeAlso: string[];
}

/** Parse "topic(section)" tokens from the SEE ALSO section of rendered text. */
function extractSeeAlso(text: string): string[] {
  const m = text.match(/SEE ALSO\s*\n([\s\S]*?)(?:\n\s*\n|$)/i);
  if (!m || !m[1]) return [];
  const tokens = new Set<string>();
  const re = /\b([a-z][a-z0-9_+-]*)\((\d[a-z0-9+-]*)\)/gi;
  let mm;
  while ((mm = re.exec(m[1])) !== null) {
    tokens.add(`${mm[1]}(${mm[2]})`);
  }
  return [...tokens];
}

/** Build a ManPageResult from rendered text + the resolved section. */
function finalize(text: string, fallbackSection: string): ManPageResult {
  const lines = text.split("\n");
  const title = lines.find((l) => l.trim().length > 0)?.trim() ?? "";
  return { text, section: fallbackSection, title, seeAlso: extractSeeAlso(text) };
}

/**
 * Render the man page for TOPIC (optionally in SECTION). Tries the `man` binary
 * backend first (accurate), falls back to the zero-dep `woman` renderer. Returns
 * null if the page cannot be found by either backend.
 */
export function formatManPage(topic: string, section?: string): ManPageResult | null {
  if (isManAvailable()) {
    const t = formatWithMan(topic, section);
    if (t !== null && t.trim().length > 0) {
      // The `man` binary renders text but doesn't report the section it found;
      // resolve it (best-effort) so the result carries the real section.
      const r = resolveManPage(topic, section);
      return finalize(t, r?.section ?? section ?? "");
    }
  }
  // woman fallback: resolve + render the source.
  const r = resolveManPage(topic, section);
  if (!r) return null;
  return finalize(formatRoff(readManSource(r)), r.section);
}

/** Whether the `man` binary backend will be used (vs woman). For diagnostics. */
export function usingManBackend(): boolean {
  return isManAvailable();
}
