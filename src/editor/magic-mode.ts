/**
 * @file magic-mode.ts
 * @description SPEC-103 — content-based (magic) major-mode detection. When the
 *   filename matches no rule, sniff the buffer's content: a shebang
 *   (`#!/usr/bin/env bash`) or a registered magic regexp (`<?xml`,
 *   `<!DOCTYPE html`). User magic rules beat fallback rules.
 *
 *   Only the HEAD of the buffer is scanned (bounded). Rules are anchored only
 *   by what their own regexp expresses; the detector runs each against the
 *   first chunk of text.
 */
import type { MagicRule } from "./mode-state.ts";

const regexpCache = new Map<string, RegExp>();
const compile = (pattern: string): RegExp => {
  let re = regexpCache.get(pattern);
  if (!re) {
    re = new RegExp(pattern);
    regexpCache.set(pattern, re);
  }
  return re;
};

/** How many leading characters of the buffer are inspected. */
const HEAD_BYTES = 512;

/**
 * Run magic rules against the head of `text`. `userRules` are tried before
 * `fallbackRules`; the first match wins. Returns the matched mode or undefined.
 */
export function detectMagicMode(
  text: string,
  userRules: readonly MagicRule[],
  fallbackRules: readonly MagicRule[],
): string | undefined {
  if (!text) return undefined;
  const head = text.length > HEAD_BYTES ? text.slice(0, HEAD_BYTES) : text;
  for (const rules of [userRules, fallbackRules]) {
    for (const rule of rules) {
      try {
        if (compile(rule.regexp).test(head)) return rule.mode;
      } catch {
        // A malformed regexp is skipped, not fatal.
      }
    }
  }
  return undefined;
}

/**
 * Map a shebang interpreter to a tmax major mode. Only interpreters whose mode
 * is registered in tmax are mapped (others fall through). `node` →
 * `typescript` because tmax's typescript-mode covers `.js`/`.ts`/`.mjs`.
 */
const INTERPRETER_MODE: Record<string, string> = {
  bash: "shell",
  sh: "shell",
  zsh: "shell",
  dash: "shell",
  python: "python",
  python3: "python",
  python2: "python",
  node: "typescript",
  ruby: "ruby",
  perl: "perl",
};

/**
 * Extract the interpreter from a shebang line. Handles both
 * `#!/bin/bash` and `#!/usr/bin/env python3` (incl. an optional single arg
 * after the interpreter, e.g. `python3 -u`). Returns undefined if not a shebang.
 */
export function parseShebang(line: string): string | undefined {
  const m = line.match(/^#!\s*(?:\S*\/)?(?:env\s+)?([A-Za-z_][\w.-]*)\b/);
  return m ? m[1] : undefined;
}

/**
 * Detect a mode from a shebang on the first line. Returns the mapped mode only
 * if it is present in `registeredModes` (so unmapped/unknown interpreters fall
 * through to other detection).
 */
export function detectShebang(
  text: string,
  registeredModes: ReadonlySet<string>,
): string | undefined {
  if (!text) return undefined;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const interp = parseShebang(firstLine);
  if (!interp) return undefined;
  const mode = INTERPRETER_MODE[interp];
  return mode && registeredModes.has(mode) ? mode : undefined;
}
