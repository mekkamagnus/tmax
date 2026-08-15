/**
 * @file wiki-link-faces.ts
 * @description SPEC-118 (#193): classify [[wiki-link]] spans as resolved or
 *   dangling so the renderer can show link health at a glance (resolved →
 *   link face, dangling → dimmed variant).
 *
 * Resolution mirrors SPEC-116's follow rule (knowledge.tlisp):
 *   - ".md" appended when the target has no extension;
 *   - relative targets resolve against the buffer's directory;
 *   - `[[file#heading]]` / `[[file#^block]]`: the FILE part drives resolution;
 *   - `[[#heading]]`: resolved iff that heading exists in the current buffer.
 */

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { TextBuffer } from "../core/contracts/buffer.ts";
import { Either } from "../utils/task-either.ts";

export type WikiLinkClass = "wiki-link-resolved" | "wiki-link-dangling";

/** Short TTL memo so a repaint doesn't stat the vault per keystroke (SPEC-118
 *  perf guard). 2s bounds staleness after a note is created/renamed. */
const EXISTS_TTL_MS = 2_000;
const existsCache = new Map<string, { exists: boolean; at: number }>();

/** Test hook: force re-resolution after a filesystem mutation. */
export function clearWikiLinkExistenceCache(): void {
  existsCache.clear();
}

function cachedExists(path: string): boolean {
  const now = Date.now();
  const hit = existsCache.get(path);
  if (hit && now - hit.at < EXISTS_TTL_MS) return hit.exists;
  const exists = existsSync(path);
  existsCache.set(path, { exists, at: now });
  return exists;
}

function slugify(text: string): string {
  // Mirrors markdown-anchor-slug (links.tlisp): lowercase, non-alnum runs → "-".
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * Build a target → face-class classifier for one buffer. The heading-slug
 * scan (only needed for `[[#heading]]` forms) is lazy AND single-pass: one
 * multiline regex over getContent() (not per-line exec calls), only when a
 * heading-only link is actually classified — plain file links never pay for
 * it, and neither does a buffer with no heading-only links.
 */
export function makeWikiLinkResolver(
  buffer: TextBuffer,
  bufferFilename: string | undefined,
): (target: string) => WikiLinkClass {
  const dir = bufferFilename ? dirname(bufferFilename) : ".";
  let slugs: Set<string> | undefined;
  const headingSlugs = (): Set<string> => {
    if (!slugs) {
      slugs = new Set<string>();
      const content = buffer.getContent();
      const text = Either.isRight(content) ? content.right : "";
      const headingRe = /^#{1,6}[ \t]+(.+)$/gm;
      for (let m = headingRe.exec(text); m !== null; m = headingRe.exec(text)) {
        slugs.add(slugify(m[1]!));
      }
    }
    return slugs;
  };

  return (target: string): WikiLinkClass => {
    const hash = target.indexOf("#");
    // No "#" → plain [[file]]; "#" at 0 → [[#heading]]; else [[file#fragment]].
    const filePart = hash === -1 ? target : hash === 0 ? "" : target.slice(0, hash);

    if (!filePart) {
      // [[#heading]] / [[#^block]]: resolved iff the heading exists here.
      const heading = target.slice(1).replace(/^\^/, "");
      return headingSlugs().has(slugify(heading))
        ? "wiki-link-resolved"
        : "wiki-link-dangling";
    }

    // [[file]] / [[file#heading]]: the file part drives resolution. Extension
    // rule mirrors the T-Lisp follow EXACTLY (knowledge.tlisp:
    // string-contains-p "." on the whole target) — a dot anywhere (even in an
    // intermediate path segment like docs.v2/note) counts as "has extension",
    // so face and follow never disagree on the same link.
    let path = filePart.includes(".") ? filePart : `${filePart}.md`;
    if (!path.startsWith("/")) path = `${dir}/${path}`;
    return cachedExists(path) ? "wiki-link-resolved" : "wiki-link-dangling";
  };
}
