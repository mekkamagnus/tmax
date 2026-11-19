/**
 * @file process-callback-exports.test.ts
 * @description Live-path catch (fikra UI verification arc): make-process
 *   evaluates :filter/:sentinel callback NAMES via the editor's evalTlisp —
 *   an unexported module function is "Undefined symbol" there, and the
 *   silent Left meant fikra's turn-end sentinel NEVER fired (no
 *   `── completed ──` markers, threads stuck "running"). This lint pins the
 *   invariant: every callback string in core .tlisp must be exported by the
 *   module whose file mentions it.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CORE = join(process.cwd(), "src/tlisp/core");

function collectTlispFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...collectTlispFiles(p));
    else if (name.endsWith(".tlisp")) out.push(p);
  }
  return out;
}

/** All "name" strings passed as :filter or :sentinel in a file's source. */
function callbackNames(src: string): string[] {
  const names: string[] = [];
  const re = /:(filter|sentinel)\s+"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) names.push(m[2]!);
  return names;
}

/** The (export ...) clause's bare symbols for a file ("" when none). */
function exportedSymbols(src: string): Set<string> {
  const exports: Set<string> = new Set();
  const clause = src.match(/\(export\s+([\s\S]*?)\)\s*\n/);
  if (clause) {
    for (const tok of clause[1]!.split(/[\s()]+/)) {
      if (tok.length > 0) exports.add(tok);
    }
  }
  return exports;
}

describe("process callbacks are exported (live-turn sentinel catch)", () => {
  const files = collectTlispFiles(CORE);

  test("core tree scanned (sanity — the lint has something to check)", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  test("every :filter/:sentinel callback name resolves to an export", () => {
    const failures: string[] = [];
    let checked = 0;
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const exports = exportedSymbols(src);
      for (const cb of callbackNames(src)) {
        checked++;
        // Qualified callback "mod/sub/fn" — the tail after the LAST "/"
        // must be an export of THIS module (the defun lives here).
        const bare = cb.includes("/") ? cb.slice(cb.lastIndexOf("/") + 1) : cb;
        if (!exports.has(bare)) {
          failures.push(`${file}: :callback "${cb}" not in (export ...)`);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });
});
