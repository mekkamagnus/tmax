/**
 * @file highlight-buffer.ts
 * @description Bridge from tokenizer/highlighter to HighlightSpan[][] for the render pipeline.
 */

import type { HighlightSpan } from "../core/contracts/editor.ts";
import { tokenize } from "./tokenizer.ts";
import { ParseState } from "./parse-state.ts";
import type { SyntaxToken } from "../core/contracts/editor.ts";
import { highlightLine } from "./highlighter.ts";
import type { WikiLinkClass } from "./wiki-link-faces.ts";
import { languageMap } from "./language-registry.ts";

const extToLang: Map<string, string> = new Map([
  [".ts", "typescript"], [".tsx", "tsx"], [".js", "javascript"], [".jsx", "jsx"], [".mjs", "javascript"],
  [".py", "python"], [".pyi", "python"],
  [".tlisp", "tlisp"], [".lisp", "lisp"], [".el", "lisp"],
  [".go", "go"],
  [".c", "c"], [".h", "h"], [".cpp", "cpp"], [".hpp", "cpp"],
  [".clj", "clojure"], [".cljs", "clojure"], [".cljc", "clojure"],
  [".md", "markdown"], [".markdown", "markdown"], [".mdx", "markdown"],
]);

export function languageFromFilename(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return undefined;
  return extToLang.get(filename.slice(dot).toLowerCase());
}

export function computeHighlightSpans(
  getLine: (line: number) => string,
  startLine: number,
  endLine: number,
  filename?: string,
  /** SPEC-118: re-classify [[wiki-link]] tokens as resolved/dangling. Only
   *  applied to markdown buffers; callers pass the classifier built from the
   *  buffer under render (see wiki-link-faces.ts). */
  resolveWikiLink?: (target: string) => WikiLinkClass,
): HighlightSpan[][] {
  const lang = languageFromFilename(filename);
  if (!lang) return [];

  const rules = languageMap.get(lang);
  if (!rules) return [];

  const spans: HighlightSpan[][] = [];
  // BUG-82: the stateful path must be primed, not optional. `tokenize` takes
  // the STATELESS branch whenever no ParseState is passed and returns plain
  // tokens — the old `state ?? undefined` call could therefore never assign
  // state (line 1 had none), so multi-line constructs (code fences, block
  // comments, triple-quoted strings) never engaged.
  let state = new ParseState();

  // Prime [0, startLine): callers pass viewport windows, so a fence opened
  // above the window still applies to the lines being rendered. Warm-up is
  // O(startLine) per call and output-discarding; per-revision state caching
  // is the RFC-019 follow-up, not this fix.
  for (let warm = 0; warm < startLine; warm++) {
    // A state is always passed, so the array form never occurs at runtime —
    // but tokenize's declared return is a union (it has no overload
    // signatures), so tsc needs the guard for narrowing.
    const warmed = tokenize(getLine(warm), warm, rules, state, lang);
    if (Array.isArray(warmed)) continue;
    state = warmed.nextState;
  }

  for (let lineNum = startLine; lineNum < endLine; lineNum++) {
    const lineText = getLine(lineNum);
    const result = tokenize(lineText, lineNum, rules, state, lang);

    let tokens: SyntaxToken[];
    if (Array.isArray(result)) {
      tokens = result;
    } else {
      tokens = result.tokens;
      state = result.nextState;
    }
    if (resolveWikiLink && lang === "markdown") {
      for (const token of tokens) {
        // SPEC-121: inline markdown links whose target is a RELATIVE FILE
        // get the same resolved/dangling health faces as wiki-links;
        // URLs, mailto, and #anchors keep the plain link face.
        if (token.type === "link") {
          const m = /\]\(([^()]*)\)/.exec(lineText.slice(token.startCol, token.endCol));
          const url = m?.[1] ?? "";
          if (url !== "" && !/^(https?:|mailto:|#)/.test(url)) {
            token.type = resolveWikiLink(url);
          }
          continue;
        }
        if (token.type !== "wiki-link") continue;
        const target = lineText
          .slice(token.startCol, token.endCol)
          .replace(/^\[\[/, "")
          .replace(/\]\]$/, "");
        token.type = resolveWikiLink(target);
      }
    }
    spans[lineNum] = highlightLine(tokens);
  }

  return spans;
}
