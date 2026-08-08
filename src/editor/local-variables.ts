/**
 * @file local-variables.ts
 * @description Pure scanner for a file's major-mode declaration (Emacs
 *   file-local variables), used by SPEC-102. Two forms:
 *
 *   1. First-line magic comment, between `-*-` markers. Two sub-forms:
 *        # -*- mode: python; -*-            (key:value)
 *        <!-- -*- mode: markdown; -*- -->    (embedded in a comment)
 *        -*- python -*-                       (bare shorthand → mode name)
 *   2. A trailing `Local Variables:` block:
 *        Local Variables:
 *        mode: ruby
 *        End:
 *
 *   Returns the declared mode name (lowercased) or `undefined`. Deliberately
 *   narrow: only the `mode:` variable is honored. Other locals (notably
 *   `eval:`) are intentionally NOT implemented (security).
 */

const MODE_NAME = "[a-z][a-z0-9-]*";

/** Parse the text between `-*-` markers into a mode name (or undefined). */
function parseFileLocalVar(content: string): string | undefined {
  const trimmed = content.trim();
  if (!trimmed) return undefined;
  // key:value pairs separated by `;` — look for `mode: NAME`.
  for (const seg of trimmed.split(";")) {
    const m = seg.trim().match(new RegExp(`^mode:\\s*(${MODE_NAME})\\s*$`, "i"));
    if (m) return m[1]!.toLowerCase();
  }
  // Shorthand: a single bare token IS the mode name.
  if (new RegExp(`^${MODE_NAME}$`, "i").test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return undefined;
}

/**
 * Find the file-local major-mode declaration in `text`.
 * First-line `-*-…-*-` is checked before a trailing `Local Variables:` block.
 * Returns the mode name (lowercased) or `undefined` when no well-formed
 * declaration is present.
 */
export function findFileLocalMode(text: string): string | undefined {
  if (!text) return undefined;

  // 1. First-line magic comment.
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const marker = firstLine.match(/-\*-([^*]*)-\*-/);
  if (marker) {
    const mode = parseFileLocalVar(marker[1]!);
    if (mode) return mode;
  }

  // 2. Trailing `Local Variables:` … `End:` block (scan the tail only).
  const tail = text.length > 3000 ? text.slice(text.length - 3000) : text;
  const block = tail.match(/Local Variables:[\s\S]*?\n[ \t]*End:/);
  if (block) {
    const m = block[0].match(new RegExp(`^[ \\t]*mode:[ \\t]*(${MODE_NAME})[ \\t]*$`, "im"));
    if (m) return m[1]!.toLowerCase();
  }

  return undefined;
}
